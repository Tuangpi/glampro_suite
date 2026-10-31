import { createHash } from "node:crypto";
import { z } from "zod";
import {
  allocatePayrollSplit,
  allocatePackage,
  paidPayrollPackageSessions,
  payrollBaseLineSchema,
  readPayrollPackagePurchase,
  correctRedemptionAttributionSchema,
} from "@glampro_suite/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { conflict } from "../lib/http-error.js";
import {
  normalizeSessionRanges,
  takePackageSessions,
  restorePackageSessions,
} from "../lib/package-valuation.js";
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
  return verifyRedemption(input);
}

function verifyRedemption(
  input: Parameters<typeof verifyPayrollPackageRedemption>[0],
  correction?: { previousSnapshotId: string; requestHash: string },
) {
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
    storedHashMatches = correction
      ? snapshot.eventHash === correction.requestHash
      : [snapshot.evidence, restored].some(
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
    // POS writes the sale before drawing tenders in the same transaction. The
    // independently captured draw can occur later, never before the sale.
    sale.soldAt > redemption.usedAt ||
    snapshot.redemptionId !== redemption.id ||
    (correction ? snapshot.revision <= 0 : snapshot.revision !== 0) ||
    snapshot.eventType !== (correction ? "CORRECTION" : "CAPTURE") ||
    // PostgreSQL JSONB reorders object keys. The operational writer hashes the
    // schema-parsed object, whose field order must be reconstructed on reads.
    !storedHashMatches ||
    source.previousSnapshotId !== (correction?.previousSnapshotId ?? null) ||
    (correction
      ? source.attributionStatus !== "CORRECTED"
      : source.attributionStatus === "CORRECTED") ||
    source.evaluatedAt !== redemption.usedAt.toISOString() ||
    !source.performers ||
    !session ||
    session.status !== "CAPTURED" ||
    session.missingEvidence.length ||
    session.holdingId !== redemption.holdingId ||
    !session.ordinals?.length ||
    event.sourceType !== (correction ? "CORRECTION" : "REDEMPTION") ||
    event.sourceKey !== `redemption:${redemption.id}:${snapshot.revision}` ||
    event.sourceId !== redemption.id ||
    event.saleId !== sale.id ||
    event.outletId !== sale.outletId ||
    (correction
      ? event.occurredAt < redemption.usedAt
      : event.occurredAt.getTime() !== redemption.usedAt.getTime())
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
    source.attributionStatus === "EXPLICIT_TENDER" || correction ? source.performers : undefined,
  );
  if (
    (!correction && performers.status !== source.attributionStatus) ||
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
    redemption.usedAt,
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
      events: [{ ...event, sourceType: correction ? "CORRECTION" : "REDEMPTION" }],
      lineageEvents: [],
    }).sources
  )
    return fail();
  return structuredClone({ purchase, session: expected, coverage: source.coverage, provenance });
}

/** Complete supplied snapshot/source chain. Original draw verification remains
 * independent; corrections cannot consume ordinals, change coverage or create cash.
 * The authoritative caller must inventory all revisions and linked reversals.
 */
export function verifyPayrollRedemptionCorrections(input: {
  original: Parameters<typeof verifyPayrollPackageRedemption>[0];
  snapshots: (Parameters<typeof verifyPayrollPackageRedemption>[0]["snapshot"] & {
    id: string;
    eventKey: string;
    actorId: string | null;
    reason: string;
  })[];
  events: (Parameters<typeof verifyPayrollPackageRedemption>[0]["event"] & {
    actorId: string | null;
    reason: string;
  })[];
}) {
  try {
    const { original } = input;
    verifyPayrollPackageRedemption(original);
    const snapshots = [...input.snapshots].sort((a, b) => a.revision - b.revision);
    const initial = snapshots[0];
    if (
      !initial ||
      initial.revision !== 0 ||
      !initial.id ||
      new Set(snapshots.map((row) => row.id)).size !== snapshots.length ||
      new Set(snapshots.map((row) => row.eventKey)).size !== snapshots.length ||
      new Set(input.events.map((row) => row.id)).size !== input.events.length ||
      new Set(input.events.map((row) => row.sourceKey)).size !== input.events.length ||
      snapshots.length * 2 - 1 !== input.events.length ||
      initial.eventKey !== `capture:${original.redemption.id}` ||
      initial.tenantId !== original.tenantId ||
      initial.redemptionId !== original.redemption.id ||
      initial.eventHash !== original.snapshot.eventHash ||
      payrollInputHash(initial.evidence) !== payrollInputHash(original.snapshot.evidence)
    )
      return fail();
    let previous = initial;
    let priorEvent = input.events.find((row) => row.id === original.event.id);
    if (
      !priorEvent ||
      payrollInputHash(priorEvent.evidence) !== payrollInputHash(original.event.evidence)
    )
      return fail();
    const results = [];
    const consumedEvents = new Set([priorEvent.id]);
    for (const snapshot of snapshots.slice(1)) {
      const evidence = redemptionCommissionEvidenceSchema.parse(snapshot.evidence);
      const previousEvidence = redemptionCommissionEvidenceSchema.parse(previous.evidence);
      const event = input.events.find(
        (row) => row.sourceKey === `redemption:${original.redemption.id}:${snapshot.revision}`,
      );
      const reversals = input.events.filter(
        (row) => row.sourceType === "REVERSAL" && row.sourceId === priorEvent!.id,
      );
      if (
        snapshot.revision !== previous.revision + 1 ||
        !snapshot.actorId ||
        !snapshot.id ||
        !snapshot.eventKey.startsWith("correction:") ||
        !event ||
        reversals.length !== 1 ||
        snapshot.tenantId !== original.tenantId ||
        snapshot.redemptionId !== original.redemption.id ||
        event.actorId !== snapshot.actorId ||
        event.reason !== snapshot.reason ||
        event.occurredAt < priorEvent.occurredAt ||
        (evidence.payrollCorrectionPosting
          ? event.createdAt < new Date(evidence.payrollCorrectionPosting.correctionAt) ||
            event.occurredAt.toISOString() !== evidence.payrollCorrectionPosting.postingAt ||
            payrollInputHash(
              (event.evidence as { sourceSnapshot?: unknown }).sourceSnapshot ?? null,
            ) !== payrollInputHash(evidence.payrollCorrectionPosting)
          : event.createdAt < event.occurredAt) ||
        payrollInputHash(evidence.coverage) !== payrollInputHash(previousEvidence.coverage) ||
        payrollInputHash(evidence.valuation) !== payrollInputHash(previousEvidence.valuation) ||
        payrollInputHash(evidence.payrollSession?.ordinals ?? null) !==
          payrollInputHash(previousEvidence.payrollSession?.ordinals ?? null)
      )
        return fail();
      const request = correctRedemptionAttributionSchema.parse(evidence.correctionRequest);
      if (
        request.expectedRevision !== previous.revision ||
        request.idempotencyKey !== snapshot.eventKey.slice("correction:".length) ||
        request.reason !== snapshot.reason ||
        payrollInputHash(
          [...request.performers].sort((a, b) => a.staffId.localeCompare(b.staffId)),
        ) !== payrollInputHash(evidence.performers)
      )
        return fail();
      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            saleId: original.sale.id,
            redemptionId: original.redemption.id,
            actorId: snapshot.actorId,
            ...request,
          }),
        )
        .digest("hex");
      const result = verifyRedemption(
        { ...original, snapshot, event },
        {
          previousSnapshotId: previous.id,
          requestHash,
        },
      );
      const reversal = reversals[0];
      if (
        consumedEvents.has(event.id) ||
        consumedEvents.has(reversal.id) ||
        reversal.sourceKey !== `correction:${snapshot.id}:${priorEvent.id}` ||
        reversal.actorId !== snapshot.actorId ||
        reversal.reason !== snapshot.reason ||
        (evidence.payrollCorrectionPosting &&
          (reversal.occurredAt.toISOString() !== evidence.payrollCorrectionPosting.postingAt ||
            payrollInputHash(
              (reversal.evidence as { sourceSnapshot?: unknown }).sourceSnapshot ?? null,
            ) !== payrollInputHash(evidence.payrollCorrectionPosting))) ||
        reversal.occurredAt < priorEvent.occurredAt ||
        reversal.occurredAt > event.occurredAt
      )
        return fail();
      consumedEvents.add(event.id);
      consumedEvents.add(reversal.id);
      const parts = new Intl.DateTimeFormat("en", {
        timeZone: original.timeZone,
        year: "numeric",
        month: "2-digit",
      }).formatToParts(reversal.occurredAt);
      const periodKey = ["year", "month"]
        .map((type) => parts.find((row) => row.type === type)!.value)
        .join("-");
      if (
        !resolvePayrollCloseSources({
          tenantId: original.tenantId,
          timeZone: original.timeZone,
          periodKey,
          events: [{ ...reversal, sourceType: "REVERSAL" }],
          lineageEvents: [
            { ...priorEvent, sourceType: previous.revision ? "CORRECTION" : "REDEMPTION" },
          ],
        }).sources
      )
        return fail();
      results.push({
        snapshotId: snapshot.id,
        eventId: event.id,
        reversalEventId: reversal.id,
        ...result,
      });
      previous = snapshot;
      priorEvent = event;
    }
    if (consumedEvents.size !== input.events.length) return fail();
    return structuredClone(results);
  } catch {
    return fail();
  }
}

/** Verify the final VOID snapshot and exact reversal of the latest attribution.
 * Restoration inventory and manager request authorization are separate prerequisites. */
export function verifyPayrollRedemptionVoid(
  input: Parameters<typeof verifyPayrollRedemptionCorrections>[0],
) {
  try {
    const { original } = input;
    const revertedAt = original.redemption.revertedAt;
    if (!revertedAt || !Number.isFinite(revertedAt.getTime())) return fail();
    const active = { ...original, redemption: { ...original.redemption, revertedAt: null } };
    const snapshots = [...input.snapshots].sort((a, b) => a.revision - b.revision);
    const terminal = snapshots.at(-1);
    const previous = snapshots.at(-2);
    if (
      !terminal ||
      !previous ||
      terminal.eventType !== "VOID" ||
      terminal.revision !== previous.revision + 1 ||
      terminal.eventKey !== `void:${original.redemption.id}` ||
      terminal.redemptionId !== original.redemption.id ||
      terminal.tenantId !== original.tenantId ||
      !terminal.actorId ||
      !terminal.id ||
      new Set(snapshots.map((row) => row.id)).size !== snapshots.length ||
      new Set(snapshots.map((row) => row.eventKey)).size !== snapshots.length ||
      terminal.reason !== "Source redemption voided; original attribution retained"
    )
      return fail();
    const prior = input.events.find(
      (row) => row.sourceKey === `redemption:${original.redemption.id}:${previous.revision}`,
    );
    if (!prior) return fail();
    const reversals = input.events.filter(
      (row) => row.sourceType === "REVERSAL" && row.sourceId === prior.id,
    );
    if (reversals.length !== 1) return fail();
    const reversal = reversals[0];
    const corrections = verifyPayrollRedemptionCorrections({
      original: active,
      snapshots: snapshots.slice(0, -1),
      events: input.events.filter((row) => row.id !== reversal.id),
    });
    const evidence = redemptionCommissionEvidenceSchema.parse(terminal.evidence);
    const expected = redemptionCommissionEvidenceSchema.parse({
      ...redemptionCommissionEvidenceSchema.parse(previous.evidence),
      previousSnapshotId: previous.id,
    });
    // Reconstruct schema ordering before replaying the writer's SHA-256 hash.
    const restoredEvidence = structuredClone(evidence);
    if (restoredEvidence.payrollSession?.purchase)
      restoredEvidence.payrollSession.purchase = readPayrollPackagePurchase(
        restoredEvidence.payrollSession.purchase,
      );
    if (
      payrollInputHash(evidence) !== payrollInputHash(expected) ||
      ![evidence, restoredEvidence].some(
        (value) =>
          terminal.eventHash === createHash("sha256").update(JSON.stringify(value)).digest("hex"),
      ) ||
      reversal.sourceKey !== `session-void:${original.redemption.id}:${prior.id}` ||
      reversal.actorId !== terminal.actorId ||
      reversal.reason !== "Manager voided source session" ||
      reversal.occurredAt < prior.occurredAt ||
      reversal.createdAt < reversal.occurredAt ||
      reversal.occurredAt > revertedAt
    )
      return fail();
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: original.timeZone,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(reversal.occurredAt);
    const periodKey = ["year", "month"]
      .map((type) => parts.find((row) => row.type === type)!.value)
      .join("-");
    if (
      !resolvePayrollCloseSources({
        tenantId: original.tenantId,
        timeZone: original.timeZone,
        periodKey,
        events: [{ ...reversal, sourceType: "REVERSAL" }],
        lineageEvents: [{ ...prior, sourceType: previous.revision ? "CORRECTION" : "REDEMPTION" }],
      }).sources
    )
      return fail();
    return {
      corrections,
      snapshotId: terminal.id,
      reversalEventId: reversal.id,
      originalEventId: prior.id,
      actorId: terminal.actorId,
      previousRevision: previous.revision,
      ...verifyPayrollPackageRedemption(active),
    };
  } catch {
    return fail();
  }
}

/** Replay supplied draws and restorations. Callers must independently
 * inventory ALL redemptions/collections and reconcile each receipt's operational
 * payment and tax evidence first. This is not an authoritative loader, transfer
 * verifier or manager-PIN verifier. Unpaid draws require sale-bound writer audits;
 * ownership/transfer and void authorization remain independent caller prerequisites.
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
  overrides?: {
    id: string;
    tenantId: string | null;
    action: string;
    targetType: string;
    targetId: string | null;
    metadata: unknown;
    createdAt: Date;
  }[];
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
    const overrides = input.overrides ?? [];
    const consumedOverrides = new Set<string>();
    if (new Set(overrides.map((row) => row.id)).size !== overrides.length) return fail();
    const approvals = overrides.map((row) => {
      const metadata = z
        .strictObject({
          actorId: z.string().trim().min(1),
          managerId: z.string().trim().min(1),
          managerRole: z.enum(["SUPER_ADMIN", "MANAGER"]),
          saleId: z.string().min(1),
          reason: z.string().trim().min(1),
          quantity: z.number().int().positive(),
          paidSessions: z.number().int().nonnegative(),
          usedSessions: z.number().int().nonnegative(),
        })
        .parse(row.metadata);
      if (
        !row.id ||
        row.tenantId !== tenantId ||
        row.action !== "package.unpaid-session.override" ||
        row.targetType !== "CustomerPackageHolding" ||
        row.targetId !== holding.id ||
        !Number.isFinite(row.createdAt.getTime()) ||
        row.createdAt.getTime() < purchasedAt
      )
        return fail();
      return { row, metadata };
    });
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
    const restorations = redemptions
      .filter((row) => row.redemption.revertedAt !== null)
      .map((row) => ({
        at: row.redemption.revertedAt!.getTime(),
        row,
        result: verifyPayrollPackageRedemption({
          ...row,
          redemption: { ...row.redemption, revertedAt: null },
        }),
      }))
      .sort((a, b) => a.at - b.at);
    let restored = 0;
    const restore = (before: number) => {
      while (restored < restorations.length && restorations[restored].at < before) {
        const entry = restorations[restored++];
        if (
          !Number.isFinite(entry.at) ||
          entry.at <= entry.row.redemption.usedAt.getTime() ||
          (previousAt !== null && entry.at <= previousAt)
        )
          return fail();
        remaining = restorePackageSessions(
          purchase.grantedSessions,
          remaining,
          entry.result.session.ordinals!,
        );
        used -= entry.row.redemption.quantity;
        previousAt = entry.at;
      }
    };
    for (const row of redemptions) {
      const at = row.redemption.usedAt.getTime();
      restore(at);
      if (
        !Number.isFinite(at) ||
        previousAt === at ||
        restorations.some((entry) => entry.at === at) ||
        row.tenantId !== tenantId ||
        row.redemption.holdingId !== holding.id ||
        payrollInputHash(row.purchase) !== payrollInputHash(purchase) ||
        payrollInputHash(row.redemptionRules) !== payrollInputHash(holding.redemptionRules)
      )
        return fail();
      const result = verifyPayrollPackageRedemption({
        ...row,
        redemption: { ...row.redemption, revertedAt: null },
      });
      // Equal timestamps cannot establish whether a receipt preceded the draw.
      if (input.collections.some((receipt) => receipt.occurredAt.getTime() === at)) return fail();
      const collected = input.collections
        .filter((receipt) => receipt.occurredAt.getTime() < at)
        .reduce((sum, receipt) => sum + receipt.netCents, 0n);
      const paid = paidPayrollPackageSessions(purchase, collected);
      const matching = approvals.filter((approval) => approval.metadata.saleId === row.sale.id);
      if (used + row.redemption.quantity > paid) {
        if (matching.length !== 1) return fail();
        const { row: audit, metadata } = matching[0];
        if (
          consumedOverrides.has(audit.id) ||
          metadata.quantity !== row.redemption.quantity ||
          metadata.usedSessions !== used ||
          metadata.paidSessions !== paid ||
          // POS timestamps the usage before PIN verification; authorization must
          // be inside that sale's draw-to-capture transaction interval.
          audit.createdAt.getTime() < at ||
          audit.createdAt.getTime() > row.event.createdAt.getTime() ||
          (previousAt !== null && audit.createdAt.getTime() <= previousAt)
        )
          return fail();
        consumedOverrides.add(audit.id);
      } else if (matching.length) return fail();
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
      previousAt = at;
    }
    restore(Infinity);
    if (
      consumedOverrides.size !== overrides.length ||
      used !== holding.quantity - holding.quantityRemaining ||
      payrollInputHash(remaining) !== payrollInputHash(available)
    )
      return fail();
    return structuredClone({ purchase, remaining, redemptions: verified });
  } catch {
    return fail();
  }
}
