import { createHash } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { commissionEventSchema } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/http-error.js";
import { lockPrepaid } from "../lib/prepaid-lock.js";
import { lockCommissionConfiguration } from "./commission.service.js";
import { commissionAmount, postCommission, reverseCommission } from "./commission-ledger.js";
import { redemptionCommissionEvidenceSchema } from "./redemption-commission-evidence.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type Snapshot = Awaited<
  ReturnType<Transaction["commissionRedemptionSnapshot"]["findFirstOrThrow"]>
>;
type Earning = Awaited<ReturnType<Transaction["employeeCommission"]["findFirstOrThrow"]>>;

function eventKey(operation: string, snapshotId: string, staffId: string) {
  return `redemption:${operation}:${createHash("sha256")
    .update(JSON.stringify([snapshotId, staffId]))
    .digest("hex")}`;
}

async function postingActor(tx: Transaction, actorId: string) {
  const scope = currentScope();
  if (scope?.kind !== "tenant" || (scope.actorId && scope.actorId !== actorId))
    throw forbidden("Redemption commission requires the current salon actor.");
  await lockPrepaid(tx, scope.tenantId, actorId);
  await lockCommissionConfiguration(tx, scope.tenantId);
  const actor = await tx.user.findFirst({ where: { id: actorId, disabled: false } });
  if (!actor || !["MANAGER", "SUPER_ADMIN"].includes(actor.globalRole))
    throw forbidden("Redemption financial integration requires a salon manager or administrator.");
}

/** Shared tenant configuration lock must be held; never pick a future/previous period. */
export async function currentCommissionPeriod(tx: Transaction) {
  const at = new Date();
  const period = await tx.commissionPeriod.findFirst({
    where: { startsAt: { lte: at }, endsAt: { gt: at }, lockedAt: null },
  });
  if (!period)
    throw conflict("No current open commission period. Nothing was corrected or reversed.");
  return { periodId: period.id, at };
}

/** All source entries, not just a guessed last row: a correction can replace 1–4 staff. */
export async function activeRedemptionEarnings(tx: Transaction, redemptionId: string) {
  const entries = await tx.employeeCommission.findMany({
    where: { ledgerVersion: 1, sourceType: "REDEMPTION", sourceId: redemptionId },
  });
  const reversed = new Set(entries.map((entry) => entry.reversesId).filter(Boolean));
  return entries.filter((entry) => entry.entryType !== "REVERSAL" && !reversed.has(entry.id));
}

function financialEvidence(snapshot: Snapshot) {
  const evidence = redemptionCommissionEvidenceSchema.parse(snapshot.evidence);
  if (!evidence.valuation || !evidence.performers || evidence.attributionStatus === "UNKNOWN")
    throw conflict(
      "Redemption has unknown attribution or original value; no earnings can be inferred.",
    );
  const cents = BigInt(evidence.valuation.netCents);
  const basis = `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
  commissionEventSchema.shape.basis.parse(basis);
  if (
    evidence.rates.length !== evidence.performers.length ||
    new Set(evidence.rates.map((row) => row.staffId)).size !== evidence.rates.length
  )
    throw conflict("Redemption rates do not match the immutable performer split.");
  for (const person of evidence.performers) {
    const rate = evidence.rates.find((row) => row.staffId === person.staffId);
    if (
      !rate ||
      rate.share !== person.share ||
      rate.amount !==
        commissionAmount(basis, new Prisma.Decimal(rate.rate).toFixed(2), person.share)
    )
      throw conflict(
        "Redemption candidate amount does not match immutable original value and own rate.",
      );
  }
  return { evidence, basis, currency: evidence.valuation.currency };
}

/** Reject incompatible/unlinked money rather than guessing how to repair historical postings. */
export function assertRedemptionEarnings(snapshot: Snapshot, active: Earning[]) {
  const { evidence, basis, currency } = financialEvidence(snapshot);
  if (active.length !== evidence.rates.length)
    throw conflict("Redemption earnings are incomplete or do not match the attribution revision.");
  for (const entry of active) {
    const person = evidence.rates.find((row) => row.staffId === entry.userId);
    const stored = commissionEventSchema.parse(entry.snapshot);
    if (
      !person ||
      entry.entryType !== "EARNING" ||
      entry.kind !== "PACKAGE_REDEMPTION" ||
      stored.redemptionEvidence?.snapshotId !== snapshot.id ||
      entry.currency !== currency ||
      !entry.basis?.equals(basis) ||
      !entry.rate?.equals(person.rate) ||
      entry.share !== person.share ||
      !entry.amount.equals(person.amount!) ||
      entry.ruleId !== person.ruleId ||
      entry.ruleSource !== person.source
    )
      throw conflict(
        "Redemption earnings do not match their immutable attribution/value snapshot.",
      );
  }
  if (new Set(active.map((entry) => entry.userId)).size !== active.length)
    throw conflict("Duplicate staff earnings for the redemption attribution revision.");
}

export async function postRedemptionSnapshot(
  tx: Transaction,
  snapshot: Snapshot,
  actorId: string,
  posting: { periodId: string; at: Date },
) {
  const { evidence, basis, currency } = financialEvidence(snapshot);
  const redemption = await tx.customerRedemption.findFirst({
    where: {
      id: snapshot.redemptionId,
      itemType: "PACKAGE",
      revertedAt: null,
      sale: { status: "COMPLETED" },
    },
  });
  if (!redemption) throw notFound("Active package redemption not found.");
  if (redemption.usedAt.toISOString() !== evidence.evaluatedAt)
    throw conflict("Redemption snapshot has a different source event time.");
  const coveredLines = await tx.saleLine.findMany({
    where: {
      saleId: redemption.saleId,
      id: { in: evidence.coverage.map((row) => row.saleLineId) },
    },
  });
  if (
    coveredLines.length !== evidence.coverage.length ||
    evidence.coverage.some(
      (covered) =>
        !coveredLines.some(
          (line) =>
            line.id === covered.saleLineId &&
            line.itemType === "SERVICE" &&
            line.itemId === covered.serviceId &&
            line.quantity >= covered.quantity,
        ),
    )
  )
    throw conflict("Redemption coverage does not match the source sale lines.");
  // Fail closed on existing legacy or mutually exclusive earnings on covered lines.
  if (
    await tx.employeeCommission.count({
      where: {
        saleId: redemption.saleId,
        OR: [
          { ledgerVersion: null },
          {
            saleLineId: { in: evidence.coverage.map((row) => row.saleLineId) },
            kind: { in: ["SERVICE", "FOC", "STORED_CREDIT_SPEND"] },
          },
        ],
      },
    })
  )
    throw conflict(
      "Covered service already has incompatible commission earnings; cutover must reconcile it first.",
    );
  const movement = await tx.packageValuationMovement.findFirst({
    where: {
      id: evidence.valuation!.movementId,
      purchaseId: evidence.valuation!.purchaseId,
      sourceKey: `redeem:${redemption.id}`,
      kind: "REDEEM",
    },
  });
  // Known zero is valid; absence of movement is not zero evidence.
  if (!movement || -movement.netCents !== BigInt(evidence.valuation!.netCents))
    throw conflict("Original redemption valuation movement is missing or inconsistent.");
  const purchase = await tx.packagePurchaseSnapshot.findFirst({
    where: { id: movement.purchaseId },
  });
  if (
    !purchase ||
    purchase.currency !== currency ||
    movement.quantity !== -redemption.quantity ||
    JSON.stringify(
      (movement.ordinals as { first: number; last: number }[]).map(({ first, last }) => [
        first,
        last,
      ]),
    ) !== JSON.stringify(evidence.valuation!.ordinals.map(({ first, last }) => [first, last]))
  )
    throw conflict(
      "Redemption original currency/session ordinals do not match valuation evidence.",
    );
  const results = [];
  for (const person of evidence.rates) {
    results.push(
      await postCommission(tx, {
        eventKey: eventKey("earn", snapshot.id, person.staffId),
        kind: "PACKAGE_REDEMPTION",
        userId: person.staffId,
        actorId,
        sourceType: "REDEMPTION",
        sourceId: redemption.id,
        saleId: redemption.saleId,
        saleLineId: null,
        occurredAt: posting.at.toISOString(),
        periodId: posting.periodId,
        currency,
        basis,
        rate: new Prisma.Decimal(person.rate).toFixed(2),
        share: person.share,
        ruleId: person.ruleId,
        ruleSource: person.source,
        reason: snapshot.reason,
        redemptionEvidence: {
          snapshotId: snapshot.id,
          sourceOccurredAt: evidence.evaluatedAt,
          correctsSnapshotId: evidence.previousSnapshotId,
        },
      }),
    );
  }
  return results;
}

/** Internal integration seam only. No route/POS caller, activation flag or historical backfill.
 * SC-006 must validate paid-session eligibility before wiring this into a release writer.
 * The caller must supply its transaction so eligibility, posting and source action roll back together.
 */
export async function postVerifiedRedemptionCommission(
  tx: Transaction,
  snapshotId: string,
  actorId: string,
) {
  await postingActor(tx, actorId);
  const snapshot = await tx.commissionRedemptionSnapshot.findFirst({ where: { id: snapshotId } });
  if (!snapshot || snapshot.eventType !== "CAPTURE")
    throw notFound("Initial redemption snapshot not found.");
  const latest = await tx.commissionRedemptionSnapshot.findFirst({
    where: { redemptionId: snapshot.redemptionId },
    orderBy: { revision: "desc" },
  });
  if (latest?.id !== snapshot.id)
    throw conflict("Cannot post a superseded redemption attribution snapshot.");
  const active = await activeRedemptionEarnings(tx, snapshot.redemptionId);
  if (active.length) {
    assertRedemptionEarnings(snapshot, active);
    if (active.some((row) => row.actorId !== actorId))
      throw conflict("Redemption posting retry actor differs.");
    return active;
  }
  if (
    await tx.employeeCommission.count({
      where: { ledgerVersion: 1, sourceType: "REDEMPTION", sourceId: snapshot.redemptionId },
    })
  )
    throw conflict(
      "Redemption earnings were already reversed; do not repost the original attribution.",
    );
  const at = new Date(redemptionCommissionEvidenceSchema.parse(snapshot.evidence).evaluatedAt);
  const period = await tx.commissionPeriod.findFirst({
    where: { startsAt: { lte: at }, endsAt: { gt: at }, lockedAt: null },
  });
  if (!period) throw conflict("No open commission period contains the original redemption time.");
  return postRedemptionSnapshot(tx, snapshot, actorId, { periodId: period.id, at });
}

export async function reverseRedemptionEarnings(
  tx: Transaction,
  snapshot: Snapshot,
  active: Earning[],
  actorId: string,
  reason: string,
  posting: { periodId: string; at: Date },
) {
  if (!actorId) throw badRequest("Redemption reversal needs an authenticated actor.");
  for (const entry of active)
    await reverseCommission(tx, {
      originalId: entry.id,
      eventKey: eventKey("reverse", snapshot.id, entry.id),
      actorId,
      reason,
      periodId: posting.periodId,
    });
}
