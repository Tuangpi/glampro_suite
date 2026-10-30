import { Prisma } from "../../generated/prisma/client.js";
import { commissionAttributionSchema, minimumPayrollPackageDeposit } from "@glampro_suite/shared";
import { conflict } from "../lib/http-error.js";
import { allocateCollection } from "../lib/commission-collection.js";
import { packagePurchaseValue } from "../lib/package-valuation.js";
import { loadSaleVoidCashConfirmation } from "./sale-void-cash.js";
import { loadSaleVoidPurchaseHoldings } from "./sale-void-purchase-evidence.js";
import {
  verifyPayrollPackagePurchase,
  verifyPayrollPackageCollection,
} from "./payroll-close-package-purchase.js";
import {
  verifyPayrollValuePurchase,
  verifyPayrollValueCollection,
} from "./payroll-close-value-purchase.js";
import { verifyOrdinaryPayrollRateProvenance } from "./payroll-close-rate-provenance.js";
import { payrollInputHash } from "./payroll-close-state.js";
import { verifyPayrollOrdinaryVoidLine } from "./payroll-close-sale-void-loader.js";
import { replayPayrollValueOwnership } from "./payroll-close-value-ownership.js";
import type { PayrollValueSharing } from "./payroll-close-value-sharing.js";
import { resolvePayrollCloseVoids, type PayrollNoCashSaleVoid } from "./payroll-close-voids.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

const fail = (): never => {
  throw conflict("Authoritative payroll inputs unavailable: PURCHASE_VOID_HISTORY_UNCONFIRMED.");
};
const month = (at: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(at);
  return ["year", "month"].map((type) => parts.find((part) => part.type === type)!.value).join("-");
};

/** Prospective purchase/ordinary mixed path: unused, untransferred; session expiry
 * requires an exact independent bucket-transfer pair, credit expiry stays gated.
 * full or partial upfront external funding and explicitly attested NO_MOVEMENT. Deleted
 * holdings alone never establish eligibility. Every independent journal is frozen. */
export async function loadPayrollPurchaseSaleVoid(
  tx: PayrollCloseTransaction,
  tenantId: string,
  saleId: string,
  timeZone: string,
) {
  const cash = await loadSaleVoidCashConfirmation(tx, tenantId, saleId);
  const preserved = await loadSaleVoidPurchaseHoldings(tx, tenantId, saleId, cash.confirmation);
  const [sale, payments, receipts, events, redemptions, rules] = await Promise.all([
    tx.sale.findFirst({
      where: { tenantId, id: saleId },
      include: { lines: { orderBy: { id: "asc" } } },
    }),
    tx.salePayment.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
    tx.commissionCollection.findMany({
      where: { tenantId, saleId },
      include: { allocations: { orderBy: { id: "asc" } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    tx.payrollSourceEvent.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
    tx.customerRedemption.findMany({ where: { tenantId, saleId } }),
    tx.commissionRule.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
  ]);
  if (
    !sale ||
    sale.tenantId !== tenantId ||
    sale.status !== "VOID" ||
    !sale.outletId ||
    !sale.customerId ||
    !sale.voidedAt ||
    !sale.voidedById ||
    sale.collectionCurrency !== "SGD" ||
    !Number.isFinite(sale.soldAt.getTime()) ||
    sale.soldAt > sale.voidedAt ||
    !sale.lines.length ||
    redemptions.length ||
    sale.lines.some(
      (line) =>
        line.tenantId !== tenantId ||
        line.saleId !== saleId ||
        !["PACKAGE", "VALUE_PACKAGE", "SERVICE", "PRODUCT"].includes(line.itemType),
    ) ||
    new Set(sale.lines.map((line) => line.id)).size !== sale.lines.length ||
    new Set(payments.map((row) => row.id)).size !== payments.length ||
    new Set(receipts.map((row) => row.id)).size !== receipts.length ||
    new Set(events.map((row) => row.id)).size !== events.length
  )
    return fail();
  const until = new Date(cash.confirmation.recordedAt);
  const during = (at: Date) => Number.isFinite(at.getTime()) && at >= sale.soldAt && at <= until;
  const packagePurchases = new Map<string, ReturnType<typeof verifyPayrollPackagePurchase>>();
  const valuePurchases = new Map<string, ReturnType<typeof verifyPayrollValuePurchase>>();
  const journals: unknown[] = [];
  for (const line of sale.lines.filter((row) =>
    ["PACKAGE", "VALUE_PACKAGE"].includes(row.itemType),
  )) {
    const economics = packagePurchaseValue(
      line.lineTotal.toFixed(2),
      line.voucherDiscountAmount.toFixed(2),
      line.taxAmount.toFixed(2),
    );
    if (economics.grossCents <= 0n) return fail();
    const holding = [...preserved.snapshot.packages, ...preserved.snapshot.credits].find(
      (row) => row.saleLineId === line.id,
    )!;
    const [uses, transfers] = await Promise.all([
      tx.customerRedemption.findMany({ where: { tenantId, holdingId: holding.id } }),
      line.itemType === "PACKAGE"
        ? tx.sessionPackageTransferEvent.findMany({ where: { tenantId, holdingId: holding.id } })
        : tx.prepaidTransferEvent.findMany({ where: { tenantId, holdingId: holding.id } }),
    ]);
    if (uses.length || transfers.length) return fail();
    if (line.itemType === "VALUE_PACKAGE") {
      const credit = preserved.snapshot.credits.find((row) => row.id === holding.id)!;
      const expiresAt = credit.expiresAt;
      if (
        expiresAt !== null &&
        (typeof expiresAt !== "string" || !Number.isFinite(new Date(expiresAt).getTime()))
      )
        return fail();
      const amount = new Prisma.Decimal(credit.amount);
      valuePurchases.set(
        line.id,
        verifyPayrollValuePurchase([{ ...credit, amount }], line, tenantId, economics.netCents),
      );
      const balances = await tx.prepaidBalanceEvent.findMany({
        where: { tenantId, holdingId: holding.id },
        orderBy: { id: "asc" },
      });
      const grant = balances.filter((row) => row.kind === "GRANT");
      const removal = balances.filter((row) => row.kind === "REMOVAL");
      if (
        grant.length !== 1 ||
        removal.length !== 1 ||
        new Set(balances.map((row) => row.id)).size !== balances.length ||
        balances.some((row) => !["GRANT", "EXPIRY_CHANGE", "SHARING", "REMOVAL"].includes(row.kind))
      )
        return fail();
      const g = grant[0],
        r = removal[0];
      // Expiry/consent edits do not consume or transfer credit. Replay their
      // independent journals rather than substituting today's holding state.
      // Removal is verified separately because ownership replay retains balances.
      const history = balances.filter((row) => row.kind !== "REMOVAL");
      if (history.some((row) => row.createdAt > r.createdAt || row.createdAt > sale.voidedAt!))
        return fail();
      let sharing: PayrollValueSharing | undefined;
      if (history.some((row) => row.kind === "SHARING")) {
        const customerIds = [sale.customerId];
        const [members, membershipEvents] = await Promise.all([
          tx.prepaidFamilyMember.findMany({
            where: { tenantId, customerId: { in: customerIds } },
            orderBy: { id: "asc" },
          }),
          tx.prepaidFamilyEvent.findMany({
            where: { tenantId, customerId: { in: customerIds } },
            orderBy: { id: "asc" },
          }),
        ]);
        const familyIds = [
          ...new Set(
            [
              ...members.map((row) => row.familyId),
              ...membershipEvents.flatMap((row) => [row.fromFamilyId, row.toFamilyId]),
              ...history.flatMap((row) => [row.sharedFamilyId, row.previousSharedFamilyId]),
            ].filter((id): id is string => id !== null),
          ),
        ].sort();
        const families = await tx.prepaidFamily.findMany({
          where: { tenantId, id: { in: familyIds } },
          orderBy: { id: "asc" },
        });
        sharing = { customerIds, members, events: membershipEvents, families };
      }
      try {
        replayPayrollValueOwnership({
          tenantId,
          holdingId: holding.id,
          originalCustomerId: sale.customerId,
          customerId: credit.customerId,
          amount,
          amountRemaining: amount,
          expiresAt: expiresAt === null ? null : new Date(expiresAt),
          balances: history,
          transfers: [],
          sharedFamilyId: null,
          sharing,
        });
      } catch {
        return fail();
      }
      if (
        balances.some(
          (row) =>
            row.tenantId !== tenantId ||
            row.holdingId !== holding.id ||
            row.customerId !== sale.customerId ||
            // Trigger timestamps use transaction-start time, not the later
            // application void timestamp. Bind removal by sale/actor/reason and
            // the exact replayed chain instead of inventing wall-clock order.
            !Number.isFinite(row.createdAt.getTime()) ||
            row.createdAt > until,
        ) ||
        !g.actorId ||
        g.saleId !== saleId ||
        g.previousCustomerId !== null ||
        !g.amountBefore.isZero() ||
        !g.amountAfter.equals(amount) ||
        !g.delta.equals(amount) ||
        g.createdAt > sale.voidedAt ||
        r.createdAt < g.createdAt ||
        r.actorId !== sale.voidedById ||
        r.reason !== sale.voidReason ||
        r.saleId !== saleId ||
        r.sharedFamilyId !== null ||
        r.previousSharedFamilyId !== null ||
        (r.expiresAt?.toISOString() ?? null) !== (credit.expiresAt ?? null) ||
        r.previousCustomerId !== sale.customerId ||
        !r.amountBefore.equals(amount) ||
        !r.amountAfter.isZero() ||
        !r.delta.equals(amount.negated()) ||
        (r.expiresAt !== null && (r.expiresAt <= r.createdAt || r.expiresAt <= sale.voidedAt))
      )
        return fail();
      journals.push({
        holdingId: holding.id,
        balances,
        uses,
        transfers,
        ...(sharing && { sharing }),
      });
    } else {
      const pkg = preserved.snapshot.packages.find((row) => row.id === holding.id)!;
      packagePurchases.set(line.id, verifyPayrollPackagePurchase([pkg], line, sale, tenantId));
      const purchases = await tx.packagePurchaseSnapshot.findMany({
        where: { tenantId, holdingId: holding.id },
      });
      if (purchases.length !== 1) return fail();
      const p = purchases[0];
      const [movements, states, activation] = await Promise.all([
        tx.packageValuationMovement.findMany({
          where: { tenantId, purchaseId: p.id },
          orderBy: { id: "asc" },
        }),
        tx.packageValuationState.findMany({ where: { tenantId, purchaseId: p.id } }),
        tx.packageValuationActivation.findFirst({ where: { tenantId, id: p.activationId } }),
      ]);
      const grants = movements.filter((row) => row.kind === "GRANT"),
        removals = movements.filter((row) => row.kind === "PURCHASE_VOID"),
        expiryOut = movements.filter((row) => row.kind === "EXPIRE_OUT"),
        expiryIn = movements.filter((row) => row.kind === "EXPIRE_IN");
      if (grants.length !== 1 || removals.length !== 1) return fail();
      const grant = grants[0],
        removal = removals[0];
      const expired = p.originalExpiresAt !== null && p.originalExpiresAt <= removal.effectiveAt;
      if (
        !activation ||
        activation.tenantId !== tenantId ||
        activation.currency !== "SGD" ||
        activation.policyVersion !== p.policyVersion ||
        activation.activatedAt > p.purchasedAt ||
        p.tenantId !== tenantId ||
        p.holdingId !== holding.id ||
        p.saleId !== saleId ||
        p.saleLineId !== line.id ||
        p.originalCustomerId !== sale.customerId ||
        p.currency !== "SGD" ||
        p.grantedSessions !== pkg.quantity ||
        p.netCents !== economics.netCents ||
        p.taxCents !== economics.taxCents ||
        p.grossCents !== economics.grossCents ||
        p.purchasedAt.getTime() !== sale.soldAt.getTime() ||
        !during(p.recordedAt) ||
        p.recordedAt > sale.voidedAt ||
        (p.originalExpiresAt?.toISOString() ?? null) !== (pkg.expiresAt ?? null) ||
        states.length !== 1 ||
        states[0].tenantId !== tenantId ||
        states[0].purchaseId !== p.id ||
        states[0].customerId !== sale.customerId ||
        !states[0].voided ||
        states[0].expired !== expired ||
        payrollInputHash(states[0].availableOrdinals) !== payrollInputHash([]) ||
        movements.length !== (expired ? 4 : 2) ||
        new Set(movements.map((row) => row.id)).size !== movements.length ||
        expiryOut.length !== (expired ? 1 : 0) ||
        expiryIn.length !== (expired ? 1 : 0)
      )
        return fail();
      // The real writer moves all still-available ordinals into EXPIRED before
      // removing an expired purchase. Never infer that pair from today's expiry.
      if (expired) {
        const out = expiryOut[0],
          into = expiryIn[0];
        if (
          p.originalExpiresAt! <= grant.effectiveAt ||
          out.recordedAt < grant.recordedAt ||
          into.recordedAt < out.recordedAt ||
          removal.recordedAt < into.recordedAt
        )
          return fail();
      }
      for (const row of movements) {
        const expiry = row.kind === "EXPIRE_OUT" || row.kind === "EXPIRE_IN";
        const sign = row.kind === "GRANT" || row.kind === "EXPIRE_IN" ? 1 : -1;
        const sourceKey =
          row.kind === "GRANT"
            ? "grant"
            : row.kind === "PURCHASE_VOID"
              ? `void:${saleId}`
              : row.kind === "EXPIRE_OUT"
                ? "expiry:out"
                : "expiry:in";
        if (
          row.tenantId !== tenantId ||
          row.purchaseId !== p.id ||
          row.customerId !== sale.customerId ||
          row.bucket !==
            (row.kind === "EXPIRE_IN" || (row.kind === "PURCHASE_VOID" && expired)
              ? "EXPIRED"
              : "ACTIVE") ||
          row.sourceKey !== sourceKey ||
          (expiry ? row.actorId !== null : !row.actorId) ||
          (row.kind === "PURCHASE_VOID" && row.actorId !== sale.voidedById) ||
          row.quantity !== sign * pkg.quantity ||
          row.netCents !== BigInt(sign) * p.netCents ||
          row.taxCents !== BigInt(sign) * p.taxCents ||
          row.grossCents !== BigInt(sign) * p.grossCents ||
          payrollInputHash(row.ordinals) !== payrollInputHash([{ first: 1, last: pkg.quantity }]) ||
          !during(row.effectiveAt) ||
          !during(row.recordedAt) ||
          row.recordedAt < row.effectiveAt ||
          (row.kind === "GRANT"
            ? row.effectiveAt < p.recordedAt || row.recordedAt > sale.voidedAt
            : row.kind === "PURCHASE_VOID"
              ? row.effectiveAt < sale.voidedAt || row.recordedAt < grant.recordedAt
              : row.effectiveAt.getTime() !== p.originalExpiresAt?.getTime() ||
                row.effectiveAt > removal.effectiveAt) ||
          (row.kind === "GRANT" &&
            p.originalExpiresAt !== null &&
            p.originalExpiresAt <= row.effectiveAt)
        )
          return fail();
      }
      journals.push({
        holdingId: holding.id,
        purchase: p,
        movements,
        states,
        activation,
        uses,
        transfers,
      });
    }
  }
  // No outstanding-payment fallback: void deletes that operational source. The
  // writer also refuses voids after later payments. Require every surviving
  // collection to bind to an upfront tender, never infer money from a capture.
  if (
    !payments.length ||
    payments.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.saleId !== saleId ||
        row.sessionId !== null ||
        !["CASH", "CARD", "PAYNOW", "NETS", "BANK_TRANSFER"].includes(row.method) ||
        !row.amount.isPositive() ||
        !row.amount.mul(100).isInteger() ||
        !during(row.createdAt) ||
        row.createdAt > sale.voidedAt!,
    ) ||
    receipts.length !== payments.length
  )
    return fail();
  const upfrontGrossCents = payments.reduce(
    (sum, row) => sum + BigInt(row.amount.mul(100).toFixed(0)),
    0n,
  );
  const purchaseGrossCents = sale.lines.reduce(
    (sum, line) =>
      sum +
      packagePurchaseValue(
        line.lineTotal.toFixed(2),
        line.voucherDiscountAmount.toFixed(2),
        line.taxAmount.toFixed(2),
      ).grossCents,
    0n,
  );
  if (
    !sale.totalAmount?.mul(100).equals(purchaseGrossCents.toString()) ||
    !sale.paidAmount?.mul(100).equals(upfrontGrossCents.toString()) ||
    upfrontGrossCents > purchaseGrossCents ||
    sale.paymentStatus !== (upfrontGrossCents === purchaseGrossCents ? "PAID" : "UNPAID")
  )
    return fail();
  const collected = new Map<string, bigint>();
  const seenPayments = new Set<string>(),
    seenAllocations = new Set<string>(),
    seenEvents = new Set<string>();
  const counts = new Map<string, number>();
  const reversals: PayrollNoCashSaleVoid["reversals"] = [];
  for (const receipt of receipts) {
    const payment = payments.find((row) => row.id === receipt.sourceId);
    if (
      !payment ||
      receipt.tenantId !== tenantId ||
      receipt.saleId !== saleId ||
      receipt.currency !== "SGD" ||
      receipt.sourceType !== "SALE_PAYMENT" ||
      seenPayments.has(payment.id) ||
      receipt.grossCents <= 0n ||
      !payment.amount.mul(100).equals(receipt.grossCents.toString()) ||
      receipt.occurredAt.getTime() !== payment.createdAt.getTime() ||
      !during(receipt.createdAt) ||
      receipt.createdAt < receipt.occurredAt ||
      receipt.createdAt > sale.voidedAt!
    )
      return fail();
    seenPayments.add(payment.id);
    const expected = allocateCollection(
      receipt.grossCents,
      sale.lines.map((line) => ({
        lineId: line.id,
        purchase: packagePurchaseValue(
          line.lineTotal.toFixed(2),
          line.voucherDiscountAmount.toFixed(2),
          line.taxAmount.toFixed(2),
        ),
        collectedGrossCents: collected.get(line.id) ?? 0n,
      })),
      receipt.allocations.map((row) => ({ lineId: row.saleLineId, grossCents: row.grossCents })),
    );
    for (const part of receipt.allocations) {
      const line = sale.lines.find((row) => row.id === part.saleLineId);
      const delta = expected.find((row) => row.lineId === part.saleLineId);
      if (
        !line ||
        !delta ||
        seenAllocations.has(part.id) ||
        part.tenantId !== tenantId ||
        part.collectionId !== receipt.id ||
        part.netCents !== delta.netCents ||
        part.taxCents !== delta.taxCents ||
        part.grossCents !== delta.grossCents
      )
        return fail();
      seenAllocations.add(part.id);
      collected.set(line.id, (collected.get(line.id) ?? 0n) + part.grossCents);
      const attribution = commissionAttributionSchema.safeParse(line.attribution);
      const historical = part.evidence as {
        version?: unknown;
        attributionStatus?: unknown;
        sellers?: unknown;
      } | null;
      if (
        !attribution.success ||
        !historical ||
        historical.version !== 1 ||
        historical.attributionStatus !== "KNOWN" ||
        payrollInputHash(historical.sellers ?? null) !== payrollInputHash(attribution.data.sellers)
      )
        return fail();
      if (["SERVICE", "PRODUCT"].includes(line.itemType)) continue;
      const originals = events.filter(
        (row) => row.sourceType === "COLLECTION" && row.sourceId === part.id,
      );
      if (originals.length !== 1) return fail();
      const original = originals[0];
      const reversed = events.filter(
        (row) => row.sourceType === "REVERSAL" && row.sourceId === original.id,
      );
      if (reversed.length !== 1) return fail();
      const reversal = reversed[0];
      if (
        original.sourceKey !== `collection:${part.id}` ||
        original.occurredAt.getTime() !== receipt.occurredAt.getTime() ||
        !during(original.createdAt) ||
        original.createdAt > sale.voidedAt! ||
        reversal.sourceKey !== `void:${saleId}:${original.id}` ||
        reversal.actorId !== sale.voidedById ||
        reversal.reason !== "Source sale voided" ||
        !during(reversal.occurredAt) ||
        reversal.occurredAt < sale.voidedAt! ||
        !during(reversal.createdAt) ||
        reversal.createdAt < reversal.occurredAt ||
        month(reversal.occurredAt, timeZone) !== month(sale.voidedAt!, timeZone)
      )
        return fail();
      const count = counts.get(line.id) ?? 0;
      if (line.itemType === "PACKAGE") {
        const purchase = packagePurchases.get(line.id)!;
        if (
          count === 0 &&
          part.grossCents <
            minimumPayrollPackageDeposit(
              BigInt(purchase.grossCents),
              purchase.commissionSettings.minimumDepositPct,
            )
        )
          return fail();
        verifyPayrollPackageCollection(
          original.evidence,
          purchase,
          line.quantity,
          part.netCents,
          count,
        );
      } else
        verifyPayrollValueCollection(
          original.evidence,
          part.netCents,
          count ? "0.0000" : `${line.quantity}.0000`,
          valuePurchases.get(line.id)!.sellers,
        );
      counts.set(line.id, count + 1);
      if (
        verifyOrdinaryPayrollRateProvenance(
          original.evidence,
          line,
          original.occurredAt,
          original.createdAt,
          rules,
          tenantId,
        ).category !== null
      )
        return fail();
      seenEvents.add(original.id);
      seenEvents.add(reversal.id);
      reversals.push({
        eventId: reversal.id,
        originalEventId: original.id,
        originalSourceId: part.id,
        originalSourceType: "COLLECTION",
      });
    }
  }
  for (const line of sale.lines.filter((row) => ["SERVICE", "PRODUCT"].includes(row.itemType))) {
    const originals = events.filter(
      (row) => row.sourceType === "SALE_LINE" && row.sourceId === line.id,
    );
    if (originals.length !== 1) return fail();
    const original = originals[0];
    const reversed = events.filter(
      (row) => row.sourceType === "REVERSAL" && row.sourceId === original.id,
    );
    if (reversed.length !== 1) return fail();
    const reversal = reversed[0];
    if (
      original.sourceKey !== `sale-line:${line.id}` ||
      original.occurredAt.getTime() !== sale.soldAt.getTime() ||
      !during(original.createdAt) ||
      original.createdAt > sale.voidedAt ||
      reversal.sourceKey !== `void:${saleId}:${original.id}` ||
      reversal.actorId !== sale.voidedById ||
      reversal.reason !== "Source sale voided" ||
      !during(reversal.occurredAt) ||
      reversal.occurredAt < sale.voidedAt ||
      !during(reversal.createdAt) ||
      reversal.createdAt < reversal.occurredAt ||
      month(reversal.occurredAt, timeZone) !== month(sale.voidedAt, timeZone)
    )
      return fail();
    verifyPayrollOrdinaryVoidLine(line, sale.soldAt, original, rules, tenantId);
    seenEvents.add(original.id);
    seenEvents.add(reversal.id);
    reversals.push({
      eventId: reversal.id,
      originalEventId: original.id,
      originalSourceId: line.id,
      originalSourceType: "SALE_LINE",
    });
  }
  for (const [lineId, purchase] of packagePurchases) {
    if (
      (collected.get(lineId) ?? 0n) <
      minimumPayrollPackageDeposit(
        BigInt(purchase.grossCents),
        purchase.commissionSettings.minimumDepositPct,
      )
    )
      return fail();
  }
  if (
    events.length !== seenEvents.size ||
    events.some(
      (row) => row.tenantId !== tenantId || row.saleId !== saleId || row.outletId !== sale.outletId,
    ) ||
    sale.lines.some(
      (line) =>
        (collected.get(line.id) ?? 0n) >
        packagePurchaseValue(
          line.lineTotal.toFixed(2),
          line.voucherDiscountAmount.toFixed(2),
          line.taxAmount.toFixed(2),
        ).grossCents,
    )
  )
    return fail();
  const evidence: unknown = JSON.parse(
    JSON.stringify({ cash, preserved, journals, payments, receipts }, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
  const noCashSaleVoid: PayrollNoCashSaleVoid = {
    id: cash.audit.id,
    tenantId,
    saleId,
    outletId: sale.outletId,
    occurredAt: sale.voidedAt,
    currency: "SGD",
    cashDisposition: "NO_MOVEMENT",
    netCents: "0",
    taxCents: "0",
    grossCents: "0",
    evidence,
    reversals,
  };
  const periodKey = month(sale.voidedAt, timeZone);
  const result = resolvePayrollCloseVoids({
    tenantId,
    timeZone,
    periodKey,
    events: events.filter((row) => month(row.occurredAt, timeZone) === periodKey) as Parameters<
      typeof resolvePayrollCloseVoids
    >[0]["events"],
    lineageEvents: events.filter(
      (row) => month(row.occurredAt, timeZone) !== periodKey,
    ) as Parameters<typeof resolvePayrollCloseVoids>[0]["lineageEvents"],
    noCashSaleVoids: [noCashSaleVoid],
  });
  if (!result.reconciliation) return fail();
  return {
    sale,
    events,
    payments,
    receipts,
    noCashSaleVoid,
    evidence,
    packagePurchases,
    valuePurchases,
  };
}
