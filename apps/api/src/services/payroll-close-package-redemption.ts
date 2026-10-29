import { createHash } from "node:crypto";
import { z } from "zod";
import {
  allocatePayrollSplit,
  allocatePackage,
  paidPayrollPackageSessions,
  payrollBaseLineSchema,
  readPayrollPackagePurchase,
} from "@glampro_suite/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { conflict } from "../lib/http-error.js";
import { normalizeSessionRanges, takePackageSessions } from "../lib/package-valuation.js";
import { holdingPackageRules } from "../lib/package-rules.js";
import {
  redemptionCommissionEvidenceSchema,
  redemptionPerformers,
} from "./redemption-commission-evidence.js";
import { payrollOrdinalSchema, payrollSessionEvidence } from "./payroll-package-session.js";
import { payrollInputHash } from "./payroll-close-state.js";
import { resolvePayrollCloseSources } from "./payroll-close-sources.js";
import { verifyOrdinaryPayrollRateProvenance } from "./payroll-close-rate-provenance.js";

const fail = (): never => {
  throw conflict(
    "Authoritative payroll inputs unavailable: PACKAGE_REDEMPTION_EVIDENCE_UNCONFIRMED.",
  );
};

/** Supplied-record verification only. This does NOT establish complete inventory,
 * paid-session authorization, ownership/transfer history or reversal/correction
 * lineage. The default loader must remain blocked until those gates are loaded.
 * purchase must already be independently reconciled to its original sale/holding.
 */
export function verifyPayrollPackageRedemption(input: {
  tenantId: string;
  timeZone: string;
  redemption: {
    id: string;
    tenantId: string;
    saleId: string;
    itemType: string;
    itemId: string;
    holdingId: string | null;
    quantity: number;
    usedAt: Date;
    revertedAt: Date | null;
  };
  purchase: unknown;
  /** Original holding rules only. Never substitute today's catalogue coverage. */
  redemptionRules: unknown;
  snapshot: {
    tenantId: string;
    redemptionId: string;
    revision: number;
    eventType: string;
    eventHash: string;
    evidence: unknown;
  };
  sale: { tenantId: string; id: string; outletId: string | null; status: string; soldAt: Date };
  coverageLines: {
    id: string;
    tenantId: string;
    saleId: string;
    itemType: string;
    itemId: string;
    quantity: number;
  }[];
  event: {
    id: string;
    sourceKey: string;
    tenantId: string;
    sourceType: string;
    sourceId: string;
    saleId: string;
    outletId: string | null;
    occurredAt: Date;
    createdAt: Date;
    evidence: unknown;
  };
  rules: Parameters<typeof verifyOrdinaryPayrollRateProvenance>[4];
}) {
  const { tenantId, redemption, snapshot, sale, event, coverageLines } = input;
  const evidence = redemptionCommissionEvidenceSchema.safeParse(snapshot.evidence);
  const capture = z.object({ lines: z.array(payrollBaseLineSchema) }).safeParse(event.evidence);
  if (!evidence.success || !capture.success) return fail();
  const source = evidence.data;
  const session = source.payrollSession;
  let storedHashMatches: boolean;
  try {
    const restored = structuredClone(source);
    if (restored.payrollSession?.purchase)
      restored.payrollSession.purchase = readPayrollPackagePurchase(
        restored.payrollSession.purchase,
      );
    storedHashMatches = [snapshot.evidence, restored].some(
      (value) =>
        snapshot.eventHash === createHash("sha256").update(JSON.stringify(value)).digest("hex"),
    );
  } catch {
    return fail();
  }
  if (
    redemption.tenantId !== tenantId ||
    sale.tenantId !== tenantId ||
    snapshot.tenantId !== tenantId ||
    event.tenantId !== tenantId ||
    redemption.itemType !== "PACKAGE" ||
    !redemption.holdingId ||
    !Number.isSafeInteger(redemption.quantity) ||
    redemption.quantity <= 0 ||
    redemption.revertedAt !== null ||
    sale.status !== "COMPLETED" ||
    !sale.outletId ||
    sale.id !== redemption.saleId ||
    sale.soldAt.getTime() !== redemption.usedAt.getTime() ||
    snapshot.redemptionId !== redemption.id ||
    snapshot.revision !== 0 ||
    snapshot.eventType !== "CAPTURE" ||
    // PostgreSQL JSONB reorders object keys. The operational writer hashes the
    // schema-parsed object, whose field order must be reconstructed on reads.
    !storedHashMatches ||
    source.previousSnapshotId !== null ||
    source.attributionStatus === "CORRECTED" ||
    source.evaluatedAt !== redemption.usedAt.toISOString() ||
    !source.performers ||
    !session ||
    session.status !== "CAPTURED" ||
    session.missingEvidence.length ||
    session.holdingId !== redemption.holdingId ||
    !session.ordinals?.length ||
    event.sourceType !== "REDEMPTION" ||
    event.sourceKey !== `redemption:${redemption.id}:0` ||
    event.sourceId !== redemption.id ||
    event.saleId !== sale.id ||
    event.outletId !== sale.outletId ||
    event.occurredAt.getTime() !== redemption.usedAt.getTime()
  ) {
    return fail();
  }

  let purchase;
  let expected;
  try {
    purchase = readPayrollPackagePurchase(input.purchase);
    if (
      purchase.missingEvidence.length ||
      purchase.currency !== "SGD" ||
      purchase.packageId !== redemption.itemId ||
      new Date(purchase.purchasedAt) > redemption.usedAt ||
      payrollInputHash(session.purchase) !== payrollInputHash(purchase)
    )
      return fail();
    const ordinals = normalizeSessionRanges(purchase.grantedSessions, session.ordinals);
    if (
      ordinals.reduce((sum, range) => sum + range.last - range.first + 1, 0) !== redemption.quantity
    )
      return fail();
    expected = payrollSessionEvidence(
      redemption.holdingId,
      {
        purchase,
        ordinals,
        missingEvidence: [],
      },
      source.performers,
    );
  } catch {
    return fail();
  }
  if (
    session.baseAmount !== expected.baseAmount ||
    payrollInputHash(session.bases) !== payrollInputHash(expected.bases) ||
    payrollInputHash(session.units) !== payrollInputHash(expected.units)
  )
    return fail();

  if (new Set(source.coverage.map((row) => row.saleLineId)).size !== source.coverage.length)
    return fail();
  for (const covered of source.coverage) {
    const matches = coverageLines.filter((row) => row.id === covered.saleLineId);
    const line = matches[0];
    if (
      matches.length !== 1 ||
      !line ||
      line.tenantId !== tenantId ||
      line.saleId !== sale.id ||
      line.itemType !== "SERVICE" ||
      line.itemId !== covered.serviceId ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0 ||
      covered.quantity > line.quantity
    )
      return fail();
  }
  try {
    if (input.redemptionRules == null) return fail();
    const rules = holdingPackageRules(input.redemptionRules, []);
    if (
      !rules.requirements.length ||
      new Set(rules.requirements.map((row) => row.serviceId)).size !== rules.requirements.length
    )
      return fail();
    // Replay precisely the claimed coverage, not the entire sale (which can have
    // cash-paid services or other package tenders). Every claimed unit must fit.
    const allocation = allocatePackage(
      rules,
      redemption.quantity,
      source.coverage.map((row) => ({
        itemType: "SERVICE",
        itemId: row.serviceId,
        quantity: row.quantity,
        totalCents: 0,
      })),
    );
    if (
      allocation.sessions !== redemption.quantity ||
      allocation.units.some((quantity, index) => quantity !== source.coverage[index].quantity)
    )
      return fail();
  } catch {
    return fail();
  }
  const performers = redemptionPerformers(
    source.coverage,
    source.attributionStatus === "EXPLICIT_TENDER" ? source.performers : undefined,
  );
  if (
    performers.status !== source.attributionStatus ||
    payrollInputHash(performers.performers) !== payrollInputHash(source.performers)
  )
    return fail();

  const policy = purchase.commissionSettings!.redemption;
  const fixed =
    policy.mode === "FIXED"
      ? allocatePayrollSplit(
          new Prisma.Decimal(policy.amount).mul(redemption.quantity).toFixed(4),
          source.performers,
        )
      : [];
  if (
    capture.data.lines.length !== expected.bases.length ||
    new Set(capture.data.lines.map((row) => row.staffId)).size !== expected.bases.length ||
    capture.data.lines.some(
      (row) =>
        row.commissionType !== "PKG_RED" ||
        row.mode !== policy.mode ||
        row.baseAmount !== expected.bases.find((part) => part.staffId === row.staffId)?.amount ||
        row.units !== expected.units.find((part) => part.staffId === row.staffId)?.amount ||
        row.fixedCommission !== fixed.find((part) => part.staffId === row.staffId)?.amount,
    )
  )
    return fail();
  const provenance = verifyOrdinaryPayrollRateProvenance(
    event.evidence,
    { itemId: redemption.itemId, itemType: "PACKAGE_REDEMPTION" },
    event.occurredAt,
    event.createdAt,
    input.rules,
    tenantId,
  );
  if (provenance.category !== null) return fail();
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: input.timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(event.occurredAt);
  const periodKey = ["year", "month"]
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join("-");
  if (
    !resolvePayrollCloseSources({
      tenantId,
      timeZone: input.timeZone,
      periodKey,
      events: [{ ...event, sourceType: "REDEMPTION" }],
      lineageEvents: [],
    }).sources
  )
    return fail();
  return structuredClone({ purchase, session: expected, coverage: source.coverage, provenance });
}

/** Reconcile supplied, unreversed holding history. Callers must independently
 * inventory ALL redemptions/collections and reconcile each receipt's operational
 * payment and tax evidence first. This is not an authoritative loader, transfer
 * verifier or manager-PIN override verifier. Unpaid or reversed draws fail closed;
 * ownership/transfer authorization remains an independent caller prerequisite.
 */
export function verifyPayrollPackageRedemptionInventory(input: {
  tenantId: string;
  purchase: unknown;
  holding: {
    id: string;
    tenantId: string;
    packageId: string;
    saleLineId: string | null;
    quantity: number;
    quantityRemaining: number;
    payrollAvailableOrdinals: unknown;
    redemptionRules: unknown;
  };
  redemptions: Parameters<typeof verifyPayrollPackageRedemption>[0][];
  collections: {
    id: string;
    tenantId: string;
    saleLineId: string;
    netCents: bigint;
    occurredAt: Date;
  }[];
}) {
  try {
    const purchase = readPayrollPackagePurchase(input.purchase);
    const { holding, tenantId } = input;
    const purchasedAt = new Date(purchase.purchasedAt).getTime();
    if (
      purchase.missingEvidence.length ||
      purchase.currency !== "SGD" ||
      holding.tenantId !== tenantId ||
      holding.packageId !== purchase.packageId ||
      holding.saleLineId !== purchase.saleLineId ||
      holding.quantity !== purchase.grantedSessions ||
      !Number.isSafeInteger(holding.quantityRemaining) ||
      holding.quantityRemaining < 0 ||
      holding.quantityRemaining > holding.quantity ||
      new Set(input.redemptions.map((row) => row.redemption.id)).size !==
        input.redemptions.length ||
      new Set(input.redemptions.map((row) => row.event.id)).size !== input.redemptions.length ||
      new Set(input.collections.map((row) => row.id)).size !== input.collections.length
    )
      return fail();
    const available = normalizeSessionRanges(
      purchase.grantedSessions,
      payrollOrdinalSchema.parse(holding.payrollAvailableOrdinals),
    );
    let totalCollected = 0n;
    for (const row of input.collections) {
      if (
        !row.id ||
        row.tenantId !== tenantId ||
        row.saleLineId !== purchase.saleLineId ||
        row.netCents < 0n ||
        !Number.isFinite(row.occurredAt.getTime()) ||
        row.occurredAt.getTime() < purchasedAt
      )
        return fail();
      totalCollected += row.netCents;
    }
    // Also reject overcollection when it happened after the final redemption.
    paidPayrollPackageSessions(purchase, totalCollected);
    let remaining = [{ first: 1, last: purchase.grantedSessions }];
    let used = 0;
    let previousAt: number | null = null;
    const coverage = new Map<string, { quantity: number; capacity: number; serviceId: string }>();
    const verified = [];
    const redemptions = [...input.redemptions].sort(
      (a, b) => a.redemption.usedAt.getTime() - b.redemption.usedAt.getTime(),
    );
    for (const row of redemptions) {
      const at = row.redemption.usedAt.getTime();
      if (
        !Number.isFinite(at) ||
        previousAt === at ||
        row.tenantId !== tenantId ||
        row.redemption.holdingId !== holding.id ||
        payrollInputHash(row.purchase) !== payrollInputHash(purchase) ||
        payrollInputHash(row.redemptionRules) !== payrollInputHash(holding.redemptionRules)
      )
        return fail();
      previousAt = at;
      const result = verifyPayrollPackageRedemption(row);
      // Equal timestamps cannot establish whether a receipt preceded the draw.
      if (input.collections.some((receipt) => receipt.occurredAt.getTime() === at)) return fail();
      const collected = input.collections
        .filter((receipt) => receipt.occurredAt.getTime() < at)
        .reduce((sum, receipt) => sum + receipt.netCents, 0n);
      if (used + row.redemption.quantity > paidPayrollPackageSessions(purchase, collected))
        return fail();
      const draw = takePackageSessions(
        purchase.grantedSessions,
        remaining,
        row.redemption.quantity,
      );
      if (payrollInputHash(draw.allocated) !== payrollInputHash(result.session.ordinals))
        return fail();
      remaining = draw.remaining;
      used += row.redemption.quantity;
      for (const line of result.coverage) {
        const saleLine = row.coverageLines.find((candidate) => candidate.id === line.saleLineId)!;
        const key = JSON.stringify([row.sale.id, line.saleLineId]);
        const prior = coverage.get(key);
        if (prior && (prior.capacity !== saleLine.quantity || prior.serviceId !== line.serviceId))
          return fail();
        const quantity = (prior?.quantity ?? 0) + line.quantity;
        if (quantity > saleLine.quantity) return fail();
        coverage.set(key, { quantity, capacity: saleLine.quantity, serviceId: line.serviceId });
      }
      verified.push({ redemptionId: row.redemption.id, ...result });
    }
    if (
      used !== holding.quantity - holding.quantityRemaining ||
      payrollInputHash(remaining) !== payrollInputHash(available)
    )
      return fail();
    return structuredClone({ purchase, remaining, redemptions: verified });
  } catch {
    return fail();
  }
}
