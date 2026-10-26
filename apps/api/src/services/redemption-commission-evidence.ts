import { createHash } from "node:crypto";
import { z } from "zod";
import {
  commissionSharesSchema,
  correctRedemptionAttributionSchema,
  type CommissionShares,
  type CorrectRedemptionAttribution,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/http-error.js";
import { lockPrepaid } from "../lib/prepaid-lock.js";
import { lockCommissionConfiguration } from "./commission.service.js";
import { resolveCommission } from "./commission-rules.js";
import { commissionAmount } from "./commission-ledger.js";
import { Prisma } from "../../generated/prisma/client.js";
import { readCommissionAttributionPolicy } from "./commission-attribution-policy.js";
import {
  activeRedemptionEarnings,
  assertRedemptionEarnings,
  currentCommissionPeriod,
  postRedemptionSnapshot,
  reverseRedemptionEarnings,
} from "./redemption-commission-posting.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export const redemptionCoverageSchema = z
  .array(
    z
      .object({
        saleLineId: z.string().min(1),
        serviceId: z.string().min(1),
        quantity: z.number().int().positive(),
        performers: commissionSharesSchema.nullable(),
      })
      .strict(),
  )
  .min(1);
export type RedemptionCoverage = z.infer<typeof redemptionCoverageSchema>;
const rateSnapshotSchema = z.object({
  staffId: z.string(),
  share: z.number().int(),
  rate: z.string(),
  source: z.string(),
  ruleId: z.string().nullable(),
  amount: z.string().nullable(),
});
export const redemptionCommissionEvidenceSchema = z.object({
  version: z.literal(1),
  coverage: redemptionCoverageSchema,
  performers: commissionSharesSchema.nullable(),
  attributionStatus: z.enum(["EXPLICIT_TENDER", "CONSISTENT_LINES", "UNKNOWN", "CORRECTED"]),
  valuation: z
    .object({
      purchaseId: z.string(),
      currency: z.string(),
      netCents: z.string().regex(/^\d+$/),
      movementId: z.string(),
      ordinals: z.array(z.object({ first: z.number().int(), last: z.number().int() })),
    })
    .nullable(),
  evaluatedAt: z.string().datetime(),
  rates: z.array(rateSnapshotSchema),
  postingStatus: z.literal("PENDING_RELEASE"),
  previousSnapshotId: z.string().nullable(),
});
function tenant() {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw forbidden("Redemption attribution requires salon scope.");
  return scope;
}
function canonicalShares(shares: CommissionShares) {
  return [...shares].sort((a, b) => a.staffId.localeCompare(b.staffId));
}
/** Ambiguous service-set splits stay UNKNOWN: never infer weights from list prices. */
export function redemptionPerformers(coverage: RedemptionCoverage, explicit?: CommissionShares) {
  redemptionCoverageSchema.parse(coverage);
  if (explicit)
    return {
      performers: canonicalShares(commissionSharesSchema.parse(explicit)),
      status: "EXPLICIT_TENDER" as const,
    };
  const first = coverage[0]?.performers;
  if (
    !first ||
    !coverage.every(
      (line) =>
        line.performers &&
        JSON.stringify(canonicalShares(line.performers)) === JSON.stringify(canonicalShares(first)),
    )
  )
    return { performers: null, status: "UNKNOWN" as const };
  return { performers: canonicalShares(first), status: "CONSISTENT_LINES" as const };
}
async function validatePerformers(
  tx: Transaction,
  coverage: RedemptionCoverage,
  performers: CommissionShares,
) {
  const services = await tx.service.findMany({
    where: { id: { in: coverage.map((line) => line.serviceId) } },
    select: { id: true, departmentId: true },
  });
  if (new Set(coverage.map((line) => line.serviceId)).size !== services.length)
    throw badRequest("A covered service is unavailable for attribution.");
  const staff = await tx.user.findMany({
    where: { id: { in: performers.map((row) => row.staffId) }, disabled: false },
    select: { id: true, departments: { select: { departmentId: true } } },
  });
  if (
    staff.length !== performers.length ||
    staff.some((person) =>
      services.some(
        (service) =>
          service.departmentId &&
          !person.departments.some((link) => link.departmentId === service.departmentId),
      ),
    )
  )
    throw badRequest(
      "Redemption performers must be enabled salon staff eligible for all covered services.",
    );
}
async function rates(
  tx: Transaction,
  packageId: string,
  at: Date,
  coverage: RedemptionCoverage,
  performers: CommissionShares | null,
  netCents: string | undefined,
) {
  if (!performers) return [];
  await validatePerformers(tx, coverage, performers);
  const services = await tx.service.findMany({
    where: { id: { in: coverage.map((row) => row.serviceId) } },
    select: { departmentId: true },
  });
  const departments = new Set(services.map((row) => row.departmentId));
  // A whole set spanning departments has no single department override.
  const departmentId = departments.size === 1 ? (services[0]?.departmentId ?? null) : null;
  const rules = await tx.commissionRule.findMany({
    where: {
      effectiveAt: { lte: at },
      OR: [{ staffId: null }, { staffId: { in: performers.map((row) => row.staffId) } }],
    },
  });
  return performers.map((person) => {
    const selected = resolveCommission(
      rules,
      {
        staffId: person.staffId,
        itemKind: "PACKAGE_REDEMPTION",
        itemId: packageId,
        departmentId,
        legacyServiceRate: "0",
      },
      at,
    );
    const cents = netCents === undefined ? null : BigInt(netCents);
    const basis =
      cents === null ? null : `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
    return {
      ...person,
      ...selected,
      amount:
        basis === null
          ? null
          : commissionAmount(basis, new Prisma.Decimal(selected.rate).toFixed(2), person.share),
    };
  });
}

/** Called inside POS's transaction and prepaid lock. Persists evidence, not earnings. */
export async function captureRedemptionCommission(
  tx: Transaction,
  redemptionId: string,
  coverage: RedemptionCoverage,
  explicit?: CommissionShares,
) {
  const scope = tenant();
  await lockCommissionConfiguration(tx, scope.tenantId);
  const redemption = await tx.customerRedemption.findFirst({
    where: { id: redemptionId, itemType: "PACKAGE" },
  });
  if (!redemption) throw notFound("Package redemption not found.");
  const choice = redemptionPerformers(coverage, explicit);
  if ((await readCommissionAttributionPolicy(tx)).requireRedemptionPerformers && !choice.performers)
    throw badRequest(
      "Select explicit session/set performers: redemption attribution is required by salon policy.",
    );
  const movement = await tx.packageValuationMovement.findFirst({
    where: { sourceKey: `redeem:${redemptionId}`, kind: "REDEEM" },
  });
  const purchase = movement
    ? await tx.packagePurchaseSnapshot.findFirst({ where: { id: movement.purchaseId } })
    : null;
  const valuation =
    movement && purchase
      ? {
          purchaseId: purchase.id,
          currency: purchase.currency,
          netCents: (-movement.netCents).toString(),
          movementId: movement.id,
          ordinals: movement.ordinals,
        }
      : null;
  const evidence = redemptionCommissionEvidenceSchema.parse({
    version: 1,
    coverage,
    performers: choice.performers,
    attributionStatus: choice.status,
    valuation,
    evaluatedAt: redemption.usedAt.toISOString(),
    rates: await rates(
      tx,
      redemption.itemId,
      redemption.usedAt,
      coverage,
      choice.performers,
      valuation?.netCents,
    ),
    postingStatus: "PENDING_RELEASE",
    previousSnapshotId: null,
  });
  return tx.commissionRedemptionSnapshot.create({
    data: {
      tenantId: scope.tenantId,
      redemptionId,
      revision: 0,
      eventKey: `capture:${redemptionId}`,
      eventHash: createHash("sha256").update(JSON.stringify(evidence)).digest("hex"),
      eventType: "CAPTURE",
      actorId: scope.actorId ?? null,
      reason: "Package redemption attribution captured",
      evidence,
    },
  });
}

export async function correctRedemptionAttribution(
  saleId: string,
  redemptionId: string,
  value: CorrectRedemptionAttribution,
  actorId: string,
) {
  const input = correctRedemptionAttributionSchema.parse(value);
  const scope = tenant();
  if (scope.actorId && scope.actorId !== actorId) throw forbidden("Correction actor mismatch.");
  return prisma.$transaction(async (tx) => {
    await lockPrepaid(tx, scope.tenantId, actorId, input.reason);
    await lockCommissionConfiguration(tx, scope.tenantId);
    const actor = await tx.user.findFirst({ where: { id: actorId, disabled: false } });
    if (!actor || !["MANAGER", "SUPER_ADMIN"].includes(actor.globalRole))
      throw forbidden("Only salon administrators and managers can correct attribution.");
    const hash = createHash("sha256")
      .update(JSON.stringify({ saleId, redemptionId, actorId, ...input }))
      .digest("hex");
    const eventKey = `correction:${input.idempotencyKey}`;
    const retry = await tx.commissionRedemptionSnapshot.findFirst({ where: { eventKey } });
    if (retry) {
      if (retry.eventHash !== hash) throw conflict("Correction retry key has different evidence.");
      return retry;
    }
    const redemption = await tx.customerRedemption.findFirst({
      where: {
        id: redemptionId,
        saleId,
        itemType: "PACKAGE",
        revertedAt: null,
        sale: { status: "COMPLETED" },
      },
    });
    if (!redemption) throw notFound("Active package redemption not found.");
    const previous = await tx.commissionRedemptionSnapshot.findFirst({
      where: { redemptionId },
      orderBy: { revision: "desc" },
    });
    if (!previous || previous.revision !== input.expectedRevision)
      throw conflict(
        "Redemption attribution changed or has no verifiable snapshot. Reload before correcting.",
      );
    const active = await activeRedemptionEarnings(tx, redemptionId);
    if (active.length) assertRedemptionEarnings(previous, active);
    else if (
      await tx.employeeCommission.count({
        where: {
          ledgerVersion: 1,
          sourceType: "REDEMPTION",
          sourceId: redemptionId,
        },
      })
    )
      throw conflict(
        "Redemption earnings were already reversed; reconcile the source before correcting attribution.",
      );
    const original = redemptionCommissionEvidenceSchema.parse(previous.evidence);
    const performers = canonicalShares(input.performers);
    const evidence = redemptionCommissionEvidenceSchema.parse({
      ...original,
      performers,
      attributionStatus: "CORRECTED",
      previousSnapshotId: previous.id,
      rates: await rates(
        tx,
        redemption.itemId,
        new Date(original.evaluatedAt),
        original.coverage,
        performers,
        original.valuation?.netCents,
      ),
    });
    const corrected = await tx.commissionRedemptionSnapshot.create({
      data: {
        tenantId: scope.tenantId,
        redemptionId,
        revision: previous.revision + 1,
        eventKey,
        eventHash: hash,
        eventType: "CORRECTION",
        actorId,
        reason: input.reason,
        evidence,
      },
    });
    if (active.length) {
      const posting = await currentCommissionPeriod(tx);
      await reverseRedemptionEarnings(tx, corrected, active, actorId, input.reason, posting);
      await postRedemptionSnapshot(tx, corrected, actorId, posting);
    }
    return corrected;
  });
}

export async function voidRedemptionCommissionEvidence(
  tx: Transaction,
  redemptionId: string,
  actorId: string | null,
) {
  const scope = tenant();
  await lockCommissionConfiguration(tx, scope.tenantId);
  const previous = await tx.commissionRedemptionSnapshot.findFirst({
    where: { redemptionId },
    orderBy: { revision: "desc" },
  });
  if (!previous || previous.eventType === "VOID") return;
  const active = await activeRedemptionEarnings(tx, redemptionId);
  if (active.length) {
    if (!actorId) throw forbidden("Posted redemption void requires an authenticated manager.");
    assertRedemptionEarnings(previous, active);
    await reverseRedemptionEarnings(
      tx,
      previous,
      active,
      actorId,
      "Source redemption voided; original attribution retained",
      await currentCommissionPeriod(tx),
    );
  }
  const evidence = redemptionCommissionEvidenceSchema.parse({
    ...redemptionCommissionEvidenceSchema.parse(previous.evidence),
    previousSnapshotId: previous.id,
  });
  await tx.commissionRedemptionSnapshot.create({
    data: {
      tenantId: scope.tenantId,
      redemptionId,
      revision: previous.revision + 1,
      eventKey: `void:${redemptionId}`,
      eventHash: createHash("sha256").update(JSON.stringify(evidence)).digest("hex"),
      eventType: "VOID",
      actorId,
      reason: "Source redemption voided; original attribution retained",
      evidence,
    },
  });
}
