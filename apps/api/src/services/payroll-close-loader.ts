import { z } from "zod";
import {
  commissionAttributionSchema,
  commissionSharesSchema,
  allocatePayrollSplit,
  minimumPayrollPackageDeposit,
  payrollPeriodKeySchema,
  payrollPlanVersionSchema,
  type PayrollGroupMetric,
} from "@glampro_suite/shared";
import { currentOutletId, currentScope } from "../lib/tenant-context.js";
import { conflict, forbidden } from "../lib/http-error.js";
import { lockPrepaid } from "../lib/prepaid-lock.js";
import { salonDayBounds } from "../lib/wall-clock.js";
import { allocateCollection } from "../lib/commission-collection.js";
import { packagePurchaseValue } from "../lib/package-valuation.js";
import { lockCommissionConfiguration } from "./commission.service.js";
import {
  resolvePayrollCloseInputs,
  type PayrollCloseInputRecords,
} from "./payroll-close-inputs.js";
import { resolvePayrollCloseCash } from "./payroll-close-cash.js";
import { loadStoredPayrollCarry } from "./payroll-close-authorizations.js";
import { resolvePayrollCloseSources } from "./payroll-close-sources.js";
import { resolvePayrollCloseConfiguration } from "./payroll-close-configuration.js";
import { resolvePayrollCloseGroupMetrics } from "./payroll-close-group-metrics.js";
import { verifyOrdinaryPayrollRateProvenance } from "./payroll-close-rate-provenance.js";
import { resolvePayrollFocEconomics } from "./payroll-close-foc.js";
import { loadPayrollSalePackageCoverage } from "./payroll-close-sale-coverage.js";
import { verifyPayrollPackageTenders } from "./payroll-close-package-tender.js";
import { loadPayrollValueSaleAllocation } from "./payroll-close-value-sale.js";
import {
  verifyPayrollPackagePurchase,
  verifyPayrollPackageCollection,
} from "./payroll-close-package-purchase.js";
import {
  verifyPayrollValuePurchase,
  verifyPayrollValueCollection,
} from "./payroll-close-value-purchase.js";
import { payrollInputHash } from "./payroll-close-state.js";
import { verifiedPayrollClose, type PayrollCloseLoader } from "./payroll-close-store.js";

/** Convert DB dates/decimals/bigints to explicit, stable snapshot JSON. */
function snapshot(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item)),
  );
}
function unavailable(code: string): never {
  throw conflict(`Authoritative payroll inputs unavailable: ${code}.`);
}

/** Internal, non-activating loader. Invoke only inside the close transaction.
 * Callers must acquire prepaid before tenant if they already hold either lock.
 * No caller records, paging, current salary fallback or inferred opening zero.
 * Unsupported operational workflows block the entire close, even without captures.
 */
export const loadAuthoritativePayrollCloseInputs: PayrollCloseLoader = async (tx, state) => {
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId || currentOutletId())
    throw forbidden("Payroll input loading requires a salon-wide authenticated actor.");
  await lockPrepaid(tx, scope.tenantId);
  await lockCommissionConfiguration(tx, scope.tenantId);
  const actor = await tx.user.findFirst({
    where: { tenantId: scope.tenantId, id: scope.actorId, disabled: false },
  });
  if (
    !actor ||
    !["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole) ||
    (actor.globalRole === "SUPER_ADMIN" && !actor.twoFactorEnabled)
  )
    throw forbidden("Payroll input loading is not permitted.");
  const tenantId = scope.tenantId;
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const periodKey = payrollPeriodKeySchema.parse(state.periodKey);
  const [year, month] = periodKey.split("-").map(Number);
  const from = salonDayBounds(`${periodKey}-01`, tenant.timeZone).from;
  const to = salonDayBounds(
    new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    tenant.timeZone,
  ).from;
  const range = { gte: from, lt: to };
  const common = { tenantId, periodKey, timeZone: tenant.timeZone };

  // Independent operational inventories are deliberately NOT driven by capture IDs.
  const [
    sales,
    payments,
    outstanding,
    redemptions,
    refunds,
    events,
    configurationEvents,
    versions,
    staff,
    collections,
    legacy,
    closes,
    commissionRules,
    correctionSnapshots,
  ] = await Promise.all([
    tx.sale.findMany({
      where: { tenantId, OR: [{ soldAt: range, status: { not: "HELD" } }, { voidedAt: range }] },
      include: { lines: true },
      orderBy: { id: "asc" },
    }),
    tx.salePayment.findMany({
      where: { tenantId, createdAt: range },
      include: { sale: true },
      orderBy: { id: "asc" },
    }),
    tx.customerOutstandingPayment.findMany({
      where: { tenantId, paidAt: range },
      include: { outstanding: true, sale: true },
      orderBy: { id: "asc" },
    }),
    tx.customerRedemption.findMany({
      where: { tenantId, OR: [{ usedAt: range }, { revertedAt: range }] },
      orderBy: { id: "asc" },
    }),
    tx.saleRefund.findMany({ where: { tenantId, refundedAt: range }, orderBy: { id: "asc" } }),
    tx.payrollSourceEvent.findMany({
      where: { tenantId, occurredAt: range },
      orderBy: { id: "asc" },
    }),
    tx.payrollConfigurationEvent.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
    tx.payrollPlanVersion.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
    tx.user.findMany({
      where: { tenantId },
      select: { tenantId: true, id: true, name: true, disabled: true },
      orderBy: { id: "asc" },
    }),
    tx.commissionCollection.findMany({
      where: { tenantId, occurredAt: range },
      include: { allocations: { orderBy: { id: "asc" } } },
      orderBy: { id: "asc" },
    }),
    // Include unlinked/unpaid/zero/reversed rows, not just paid or current-month earnings.
    tx.employeeCommission.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
    tx.payrollClose.findMany({
      where: { tenantId, status: "APPROVED", periodKey: { not: periodKey } },
      orderBy: { periodKey: "asc" },
    }),
    tx.commissionRule.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
    // Complete operational inventory, independent of captured payroll IDs/dates.
    tx.commissionRedemptionSnapshot.findMany({
      where: { tenantId, eventType: "CORRECTION" },
      orderBy: { id: "asc" },
    }),
  ]);
  if (redemptions.some((row) => !["PACKAGE", "VALUE_PACKAGE"].includes(row.itemType)))
    unavailable("REDEMPTION_WORKFLOW_NOT_LOADED");
  if (
    refunds.length ||
    sales.some((sale) => sale.voidedAt && sale.voidedAt >= from && sale.voidedAt < to)
  )
    unavailable("REFUND_OR_VOID_WORKFLOW_NOT_LOADED");
  if (
    events.some(
      (event) =>
        ![
          "SALE_LINE",
          "COLLECTION",
          "REDEMPTION",
          "VALUE_SPEND",
          "CORRECTION",
          "REVERSAL",
        ].includes(event.sourceType),
    )
  )
    unavailable("SOURCE_WORKFLOW_NOT_LOADED");
  const correctionRedemptions = [];
  for (const redemptionId of [
    ...new Set(correctionSnapshots.map((row) => row.redemptionId)),
  ].sort()) {
    const redemption = await tx.customerRedemption.findFirst({
      where: { tenantId, id: redemptionId },
    });
    if (!redemption || redemption.itemType !== "PACKAGE")
      unavailable("CORRECTION_OPERATION_UNCONFIRMED");
    correctionRedemptions.push(redemption);
  }
  // A prior usage can cover sale-line quantities. Reconcile all holdings on
  // each affected sale before resolving any ordinary service economics.
  const saleIds = [
    ...new Set([
      ...sales.map((sale) => sale.id),
      ...collections.map((row) => row.saleId),
      ...payments.map((row) => row.saleId),
      ...events.map((row) => row.saleId),
      ...redemptions.map((row) => row.saleId),
      ...correctionRedemptions.map((row) => row.saleId),
    ]),
  ];
  const saleCoverage = new Map<
    string,
    Awaited<ReturnType<typeof loadPayrollSalePackageCoverage>>
  >();
  const packageTenders = new Map<string, unknown>();
  const verifiedPackagePaymentIds = new Set<string>();
  const valueSales = new Map<string, Awaited<ReturnType<typeof loadPayrollValueSaleAllocation>>>();
  const verifiedCreditPaymentIds = new Set<string>();
  const sameInventory = (actual: unknown[], expected: unknown[], code: string) => {
    const hashes = actual.map((row) => payrollInputHash(snapshot(row))).sort();
    const expectedHashes = expected.map((row) => payrollInputHash(snapshot(row))).sort();
    if (payrollInputHash(hashes) !== payrollInputHash(expectedHashes)) unavailable(code);
  };
  const inMonth = (at: Date) => at >= from && at < to;
  for (const saleId of saleIds) {
    const usageCount = await tx.customerRedemption.count({ where: { tenantId, saleId } });
    const creditCount = usageCount
      ? await tx.customerRedemption.count({
          where: { tenantId, saleId, itemType: "VALUE_PACKAGE" },
        })
      : 0;
    if (
      creditCount ||
      payments.some((row) => row.saleId === saleId && row.method === "PREPAID_CREDIT") ||
      events.some((row) => row.saleId === saleId && row.sourceType === "VALUE_SPEND")
    ) {
      if (!creditCount)
        unavailable(
          usageCount ? "PACKAGE_TENDER_UNCONFIRMED" : "PREPAID_PAYMENT_WORKFLOW_NOT_LOADED",
        );
      const value = await loadPayrollValueSaleAllocation(tx, saleId);
      if (value.evidence.redemptions.length !== usageCount || creditCount !== usageCount)
        unavailable("VALUE_REDEMPTION_MONTH_INVENTORY_UNCONFIRMED");
      sameInventory(
        sales.filter((row) => row.id === saleId),
        inMonth(value.evidence.sale.soldAt) ? [value.evidence.sale] : [],
        "VALUE_SALE_MONTH_INVENTORY_UNCONFIRMED",
      );
      sameInventory(
        payments.filter((row) => row.saleId === saleId).map(({ sale: _sale, ...row }) => row),
        value.evidence.payments.filter((row) => inMonth(row.createdAt)),
        "VALUE_TENDER_MONTH_INVENTORY_UNCONFIRMED",
      );
      sameInventory(
        redemptions.filter((row) => row.saleId === saleId),
        value.evidence.redemptions.filter((row) => inMonth(row.usedAt)),
        "VALUE_REDEMPTION_MONTH_INVENTORY_UNCONFIRMED",
      );
      sameInventory(
        events.filter((row) => row.saleId === saleId),
        value.evidence.events.filter((row) => inMonth(row.occurredAt)),
        "VALUE_CAPTURE_MONTH_INVENTORY_UNCONFIRMED",
      );
      sameInventory(
        collections.filter((row) => row.saleId === saleId),
        value.evidence.collections.filter((row) => inMonth(row.occurredAt)),
        "VALUE_COLLECTION_MONTH_INVENTORY_UNCONFIRMED",
      );
      valueSales.set(saleId, value);
      for (const id of value.creditPaymentIds) verifiedCreditPaymentIds.add(id);
      continue;
    }
    if (!usageCount) continue;
    const covered = await loadPayrollSalePackageCoverage(tx, saleId);
    const tenderPayments = await tx.salePayment.findMany({
      where: { tenantId, saleId },
      orderBy: { id: "asc" },
    });
    const tender = verifyPayrollPackageTenders(
      covered.evidence.sale,
      tenderPayments,
      covered.lines,
      covered.evidence.redemptions.length,
    );
    const monthlyTenders = payments.filter(
      (row) => row.saleId === saleId && row.method === "PACKAGE",
    );
    const expectedMonthlyTenders = tenderPayments.filter(
      (row) => row.method === "PACKAGE" && row.createdAt >= from && row.createdAt < to,
    );
    if (
      monthlyTenders.length !== expectedMonthlyTenders.length ||
      expectedMonthlyTenders.some(
        (row) =>
          !monthlyTenders.some((candidate) => {
            const { sale: _sale, ...payment } = candidate;
            return payrollInputHash(snapshot(payment)) === payrollInputHash(snapshot(row));
          }),
      )
    )
      unavailable("PACKAGE_TENDER_MONTH_INVENTORY_UNCONFIRMED");
    packageTenders.set(saleId, { tender, payments: snapshot(tenderPayments) });
    for (const id of tender.paymentIds) verifiedPackagePaymentIds.add(id);
    if (covered.evidence.redemptions.length !== usageCount)
      unavailable("SALE_PACKAGE_COVERAGE_UNCONFIRMED");
    const monthly = covered.evidence.redemptions.filter(
      (row) =>
        (row.usedAt >= from && row.usedAt < to) ||
        (row.revertedAt && row.revertedAt >= from && row.revertedAt < to),
    );
    const inventoried = redemptions.filter((row) => row.saleId === saleId);
    if (
      monthly.length !== inventoried.length ||
      monthly.some(
        (row) =>
          !inventoried.some(
            (other) => payrollInputHash(snapshot(row)) === payrollInputHash(snapshot(other)),
          ),
      )
    )
      unavailable("REDEMPTION_MONTH_INVENTORY_UNCONFIRMED");
    saleCoverage.set(saleId, covered);
  }
  if (redemptions.some((row) => !saleCoverage.has(row.saleId) && !valueSales.has(row.saleId)))
    unavailable("REDEMPTION_MONTH_INVENTORY_UNCONFIRMED");
  const {
    carry,
    resolved: carryResult,
    settlements,
  } = await loadStoredPayrollCarry(tx, tenantId, periodKey);

  const operations: PayrollCloseInputRecords["inventoryOperations"] = [];
  const noCashReversals: NonNullable<PayrollCloseInputRecords["noCashReversals"]> = [];
  const lineage = new Map<string, (typeof events)[number]>();
  const reconciledCorrections = new Set<string>();
  const correctionEvidence = [];
  for (const covered of saleCoverage.values()) {
    for (const history of covered.evidence.histories) {
      for (const restored of history.voids) {
        const reversal = history.evidence.correctionReversals.find(
          (row) => row.id === restored.reversalEventId,
        )!;
        if (reversal.occurredAt < from || reversal.occurredAt >= to) continue;
        if (operations.some((row) => row.sourceKey === reversal.sourceKey)) continue;
        const inventoried = events.filter((row) => row.id === reversal.id);
        if (
          inventoried.length !== 1 ||
          payrollInputHash(snapshot(inventoried[0])) !== payrollInputHash(snapshot(reversal))
        )
          unavailable("SESSION_VOID_MONTH_CAPTURE_UNCONFIRMED");
        const original = history.evidence.related.find(
          (row) => row.id === restored.originalEventId,
        )!;
        operations.push({
          tenantId,
          sourceType: "REVERSAL",
          sourceId: reversal.sourceId,
          sourceKey: reversal.sourceKey,
          saleId: reversal.saleId,
          outletId: reversal.outletId,
          occurredAt: reversal.occurredAt,
          evidence: snapshot(restored),
        });
        if (!events.some((row) => row.id === original.id)) lineage.set(original.id, original);
        noCashReversals.push({
          id: restored.snapshotId,
          tenantId,
          eventId: reversal.id,
          originalEventId: original.id,
          originalSourceId: original.sourceId,
          originalSourceType: original.sourceType as "REDEMPTION" | "CORRECTION",
          saleId: original.saleId,
          outletId: original.outletId,
          occurredAt: reversal.occurredAt,
          currency: "SGD",
          netCents: "0",
          taxCents: "0",
          grossCents: "0",
          evidence: snapshot(restored),
        });
      }
      for (const chain of history.corrections) {
        if (!correctionRedemptions.some((row) => row.id === chain.redemptionId)) continue;
        for (const revision of chain.revisions) {
          if (reconciledCorrections.has(revision.snapshotId)) continue;
          reconciledCorrections.add(revision.snapshotId);
          const operational = correctionSnapshots.find((row) => row.id === revision.snapshotId);
          const stored = history.evidence.snapshots.find((row) => row.id === revision.snapshotId);
          if (
            !operational ||
            payrollInputHash(snapshot(operational)) !== payrollInputHash(snapshot(stored))
          )
            unavailable("CORRECTION_OPERATION_UNCONFIRMED");
          const replacement = history.evidence.related.find((row) => row.id === revision.eventId)!;
          const reversal = history.evidence.correctionReversals.find(
            (row) => row.id === revision.reversalEventId,
          )!;
          const original = history.evidence.related.find((row) => row.id === reversal.sourceId)!;
          correctionEvidence.push(snapshot({ operational, revision }));
          for (const event of [replacement, reversal]) {
            if (event.occurredAt < from || event.occurredAt >= to) continue;
            const inventoried = events.filter((row) => row.id === event.id);
            if (
              inventoried.length !== 1 ||
              payrollInputHash(snapshot(inventoried[0])) !== payrollInputHash(snapshot(event))
            )
              unavailable("CORRECTION_MONTH_CAPTURE_UNCONFIRMED");
            operations.push({
              tenantId,
              sourceType: event.sourceType as "CORRECTION" | "REVERSAL",
              sourceId: event.sourceId,
              sourceKey: event.sourceKey,
              saleId: event.saleId,
              outletId: event.outletId,
              occurredAt: event.occurredAt,
              evidence: snapshot({ operational, revision }),
            });
            if (event.id === reversal.id) {
              if (!events.some((row) => row.id === original.id)) lineage.set(original.id, original);
              noCashReversals.push({
                id: operational.id,
                tenantId,
                eventId: reversal.id,
                originalEventId: original.id,
                originalSourceId: original.sourceId,
                originalSourceType: original.sourceType as "REDEMPTION" | "CORRECTION",
                saleId: original.saleId,
                outletId: original.outletId,
                occurredAt: reversal.occurredAt,
                currency: "SGD",
                netCents: "0",
                taxCents: "0",
                grossCents: "0",
                evidence: snapshot({
                  operational,
                  purchase: revision.purchase,
                  session: revision.session,
                }),
              });
            }
          }
        }
      }
    }
  }
  if (
    reconciledCorrections.size !== correctionSnapshots.length ||
    events.some(
      (event) =>
        ["CORRECTION", "REVERSAL"].includes(event.sourceType) &&
        !operations.some((row) => row.sourceKey === event.sourceKey),
    )
  )
    unavailable("CORRECTION_OPERATION_UNCONFIRMED");
  for (const redemption of redemptions) {
    if (redemption.usedAt < from || redemption.usedAt >= to) continue;
    const value = valueSales.get(redemption.saleId);
    if (value) {
      operations.push({
        tenantId,
        sourceType: "VALUE_SPEND",
        sourceId: redemption.id,
        saleId: redemption.saleId,
        outletId: value.evidence.sale.outletId,
        occurredAt: redemption.usedAt,
        evidence: snapshot({ redemption, histories: value.evidence.histories }),
      });
      continue;
    }
    const covered = saleCoverage.get(redemption.saleId)!;
    const capture = covered.evidence.captures.find((row) => row.sourceId === redemption.id);
    const monthly = events.filter(
      (row) => row.sourceType === "REDEMPTION" && row.sourceId === redemption.id,
    );
    if (
      !capture ||
      monthly.length !== 1 ||
      payrollInputHash(snapshot(capture)) !== payrollInputHash(snapshot(monthly[0]))
    )
      unavailable("REDEMPTION_MONTH_CAPTURE_UNCONFIRMED");
    operations.push({
      tenantId,
      sourceType: "REDEMPTION",
      sourceId: redemption.id,
      saleId: redemption.saleId,
      outletId: covered.evidence.sale.outletId,
      occurredAt: redemption.usedAt,
      evidence: snapshot({ redemption, coverage: covered.lines }),
    });
  }
  const packagePurchases = new Map<string, ReturnType<typeof verifyPayrollPackagePurchase>>();
  const packageCollections = new Set<string>();
  const loadPackagePurchase = async (
    line: (typeof sales)[number]["lines"][number],
    sale: (typeof sales)[number],
  ) => {
    const existing = packagePurchases.get(line.id);
    if (existing) return existing;
    if (sale.status !== "COMPLETED") unavailable("PACKAGE_PURCHASE_SALE_UNCONFIRMED");
    const holdings = await tx.customerPackageHolding.findMany({
      where: { tenantId, saleLineId: line.id },
      orderBy: { id: "asc" },
    });
    const purchase = verifyPayrollPackagePurchase(holdings, line, sale, tenantId);
    packagePurchases.set(line.id, purchase);
    return purchase;
  };
  const valuePurchases = new Map<string, ReturnType<typeof verifyPayrollValuePurchase>>();
  const loadValuePurchase = async (line: (typeof sales)[number]["lines"][number]) => {
    const existing = valuePurchases.get(line.id);
    if (existing) return existing;
    const holdings = await tx.customerValuePackageHolding.findMany({
      where: { tenantId, saleLineId: line.id },
      orderBy: { id: "asc" },
    });
    const purchase = verifyPayrollValuePurchase(
      holdings,
      line,
      tenantId,
      packagePurchaseValue(
        line.lineTotal.toFixed(2),
        line.voucherDiscountAmount.toFixed(2),
        line.taxAmount.toFixed(2),
      ).netCents,
    );
    valuePurchases.set(line.id, purchase);
    return purchase;
  };
  for (const sale of sales) {
    if (sale.soldAt < from || sale.soldAt >= to) continue;
    if (sale.collectionCurrency !== "SGD") unavailable("SALE_CURRENCY_UNCONFIRMED");
    for (const line of sale.lines) {
      if (line.itemType === "PACKAGE") {
        await loadPackagePurchase(line, sale);
        continue;
      }
      if (line.itemType === "VALUE_PACKAGE") {
        if (sale.status !== "COMPLETED") unavailable("VALUE_PURCHASE_SALE_UNCONFIRMED");
        await loadValuePurchase(line);
        continue;
      }
      if (!["SERVICE", "PRODUCT"].includes(line.itemType)) continue;
      const usage = saleCoverage.get(sale.id);
      if (
        usage &&
        payrollInputHash(snapshot(usage.evidence.sale)) !== payrollInputHash(snapshot(sale))
      )
        unavailable("SALE_USAGE_INVENTORY_UNCONFIRMED");
      const quantity =
        usage?.lines.find((row) => row.saleLineId === line.id)?.remainingQuantity ?? line.quantity;
      if (quantity === 0) {
        if (events.some((row) => row.sourceType === "SALE_LINE" && row.sourceId === line.id))
          unavailable("COVERED_SERVICE_SOURCE_UNEXPECTED");
        continue;
      }
      const gross = line.lineTotal.minus(line.voucherDiscountAmount);
      const foc = gross.isZero()
        ? resolvePayrollFocEconomics(line, sale.soldAt, line.quantity - quantity)
        : null;
      if (foc && !line.taxAmount.isZero()) unavailable("FOC_OPERATIONAL_TAX_MISMATCH");
      const event = events.find(
        (row) => row.sourceType === "SALE_LINE" && row.sourceId === line.id,
      );
      if (event) {
        const captured = z
          .object({
            lines: z.array(
              z.object({
                staffId: z.string(),
                baseAmount: z.string(),
                units: z.string(),
                commissionType: z.string(),
                mode: z.literal("FOLLOW_PLAN"),
                fixedCommission: z.never().optional(),
              }),
            ),
          })
          .parse(event.evidence);
        const attribution = commissionAttributionSchema.parse(line.attribution);
        const shares = line.itemType === "PRODUCT" ? attribution.sellers : attribution.performers;
        if (!shares) unavailable("ORDINARY_LINE_ATTRIBUTION_UNAVAILABLE");
        const expected = allocatePayrollSplit(
          valueSales.get(sale.id)?.ordinary.find((row) => row.saleLineId === line.id)?.baseAmount ??
            foc?.baseAmount ??
            gross.minus(line.taxAmount).mul(quantity).div(line.quantity).toFixed(4),
          shares,
        );
        const units = allocatePayrollSplit(`${quantity}.0000`, shares);
        if (
          captured.lines.length !== expected.length ||
          captured.lines.some(
            (part) =>
              part.commissionType !== (foc ? "FOC" : line.itemType === "PRODUCT" ? "PRD" : "SVC") ||
              part.baseAmount !==
                expected.find((entry) => entry.staffId === part.staffId)?.amount ||
              part.units !== units.find((entry) => entry.staffId === part.staffId)?.amount,
          )
        )
          unavailable("ORDINARY_SOURCE_ECONOMICS_MISMATCH");
        const provenance = verifyOrdinaryPayrollRateProvenance(
          event.evidence,
          { ...line, foc: !!foc },
          event.occurredAt,
          event.createdAt,
          commissionRules,
          tenantId,
        );
        if (foc && provenance.category !== foc.economics.category)
          unavailable("FOC_OPERATIONAL_CATEGORY_MISMATCH");
      }
      operations.push({
        tenantId,
        sourceType: "SALE_LINE",
        sourceId: line.id,
        saleId: sale.id,
        outletId: sale.outletId,
        occurredAt: sale.soldAt,
        evidence: snapshot({ sale, line }),
      });
    }
  }
  const paymentOperations: PayrollCloseInputRecords["sources"]["operations"] = [];
  const addSalePayment = (payment: (typeof payments)[number], target = paymentOperations) => {
    if (
      payment.tenantId !== tenantId ||
      payment.sale.tenantId !== tenantId ||
      payment.saleId !== payment.sale.id
    )
      unavailable("PAYMENT_SALE_UNCONFIRMED");
    if (payment.method === "PACKAGE") {
      if (!verifiedPackagePaymentIds.has(payment.id)) unavailable("PACKAGE_TENDER_UNCONFIRMED");
      // Matched prepaid session tender is consideration already collected at
      // purchase, not an external payment operation or current cash receipt.
      return;
    }
    if (payment.method === "PREPAID_CREDIT") {
      if (!verifiedCreditPaymentIds.has(payment.id))
        unavailable("PREPAID_PAYMENT_WORKFLOW_NOT_LOADED");
      return;
    }
    if (payment.sessionId !== null) unavailable("GATEWAY_SETTLEMENT_UNCONFIRMED");
    if (payment.sale.status === "HELD" || payment.sale.collectionCurrency !== "SGD")
      unavailable("PAYMENT_SALE_UNCONFIRMED");
    if (payment.amount.isZero()) return;
    target.push({
      tenantId,
      sourceType: "SALE_PAYMENT",
      sourceId: payment.id,
      saleId: payment.saleId,
      currency: "SGD",
      grossCents: payment.amount.mul(100).toFixed(0),
      occurredAt: payment.createdAt,
    });
  };
  const addOutstandingPayment = (
    payment: (typeof outstanding)[number],
    target = paymentOperations,
  ) => {
    if (
      !payment.sale ||
      payment.tenantId !== tenantId ||
      payment.sale.tenantId !== tenantId ||
      payment.sale.id !== payment.saleId ||
      payment.sale.status === "HELD" ||
      payment.sale.collectionCurrency !== "SGD" ||
      payment.sale.customerId !== payment.customerId ||
      payment.outstanding.saleId !== payment.saleId ||
      payment.outstanding.customerId !== payment.customerId ||
      payment.outstanding.id !== payment.outstandingId ||
      payment.outstanding.tenantId !== tenantId
    )
      unavailable("OUTSTANDING_PAYMENT_IDENTITY_UNCONFIRMED");
    if (payment.paidAmount.isZero()) return;
    target.push({
      tenantId,
      sourceType: "OUTSTANDING_PAYMENT",
      sourceId: payment.id,
      saleId: payment.sale.id,
      currency: "SGD",
      grossCents: payment.paidAmount.mul(100).toFixed(0),
      occurredAt: payment.paidAt,
    });
  };
  outstanding.forEach((payment) => addOutstandingPayment(payment));
  payments.forEach((payment) => addSalePayment(payment));
  const packageHistory = new Map<string, unknown>();
  const cashAttributions: PayrollCloseInputRecords["cashAttributions"] = [];
  const normalizedCollections: PayrollCloseInputRecords["sources"]["collections"] = [];
  for (const collection of collections) {
    const sale = await tx.sale.findFirstOrThrow({
      where: { tenantId, id: collection.saleId },
      include: { lines: true },
    });
    if (!sale.outletId || sale.collectionCurrency !== "SGD")
      unavailable("COLLECTION_SALE_SCOPE_UNCONFIRMED");
    // Replay cumulative exact-cent tax allocation from the operational purchase,
    // including prior-month instalments. Gross equality alone cannot prove net cash.
    const history = await tx.commissionCollection.findMany({
      where: { tenantId, saleId: sale.id },
      include: { allocations: { orderBy: { id: "asc" } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const collected = new Map<string, bigint>();
    for (const receipt of history) {
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
        receipt.allocations.map((allocation) => ({
          lineId: allocation.saleLineId,
          grossCents: allocation.grossCents,
        })),
      );
      for (const allocation of receipt.allocations) {
        const delta = expected.find((entry) => entry.lineId === allocation.saleLineId);
        if (
          !delta ||
          delta.netCents !== allocation.netCents ||
          delta.taxCents !== allocation.taxCents
        )
          unavailable("OPERATIONAL_COLLECTION_TAX_MISMATCH");
        collected.set(
          allocation.saleLineId,
          (collected.get(allocation.saleLineId) ?? 0n) + allocation.grossCents,
        );
      }
      if (receipt.id === collection.id) break;
    }
    for (const allocation of collection.allocations) {
      const line = sale.lines.find((row) => row.id === allocation.saleLineId);
      if (line?.itemType === "PACKAGE") {
        const purchase = await loadPackagePurchase(line, sale);
        const receipts = history.filter((row) =>
          row.allocations.some((part) => part.saleLineId === line.id),
        );
        if (
          sale.soldAt >= to ||
          !receipts.length ||
          new Set(receipts.map((row) => row.id)).size !== receipts.length ||
          new Set(receipts.map((row) => `${row.sourceType}:${row.sourceId}`)).size !==
            receipts.length ||
          !receipts.some((row) => row.id === collection.id) ||
          receipts.some(
            (row, index) =>
              !["SALE_PAYMENT", "OUTSTANDING_PAYMENT"].includes(row.sourceType) ||
              (index === 0 && row.sourceType !== "SALE_PAYMENT") ||
              row.occurredAt < sale.soldAt ||
              row.occurredAt >= to ||
              row.tenantId !== tenantId ||
              row.saleId !== sale.id ||
              row.currency !== "SGD" ||
              (index > 0 &&
                (row.createdAt <= receipts[index - 1].createdAt ||
                  row.occurredAt < receipts[index - 1].occurredAt)),
          )
        )
          unavailable("PACKAGE_COLLECTION_HISTORY_UNCONFIRMED");
        // Historical inventory is verification-only: never append it to monthly cash
        // operations, source lines, group metrics or required staff.
        let receiptPayments = paymentOperations;
        let receiptEvents = events;
        if (receipts.some((row) => row.occurredAt < from)) {
          const [priorPayments, priorOutstanding, priorEvents] = await Promise.all([
            tx.salePayment.findMany({
              where: { tenantId, saleId: sale.id, createdAt: { lt: from } },
              include: { sale: true },
              orderBy: { id: "asc" },
            }),
            tx.customerOutstandingPayment.findMany({
              where: { tenantId, saleId: sale.id, paidAt: { lt: from } },
              include: { outstanding: true, sale: true },
              orderBy: { id: "asc" },
            }),
            tx.payrollSourceEvent.findMany({
              where: { tenantId, saleId: sale.id, occurredAt: { lt: from } },
              orderBy: { id: "asc" },
            }),
          ]);
          receiptPayments = [...paymentOperations];
          priorPayments.forEach((payment) => {
            if (
              payment.tenantId !== tenantId ||
              payment.saleId !== sale.id ||
              payment.createdAt >= from
            )
              unavailable("PACKAGE_COLLECTION_PAYMENT_UNCONFIRMED");
            addSalePayment(payment, receiptPayments);
          });
          priorOutstanding.forEach((payment) => {
            if (payment.saleId !== sale.id || payment.paidAt >= from)
              unavailable("PACKAGE_COLLECTION_PAYMENT_UNCONFIRMED");
            addOutstandingPayment(payment, receiptPayments);
          });
          if (
            priorEvents.some(
              (event) =>
                event.saleId !== sale.id ||
                event.tenantId !== tenantId ||
                event.occurredAt >= from ||
                event.sourceType !== "COLLECTION" ||
                !history.some((receipt) =>
                  receipt.allocations.some((part) => part.id === event.sourceId),
                ),
            )
          )
            unavailable("PACKAGE_COLLECTION_HISTORY_UNCONFIRMED");
          receiptEvents = [...events, ...priorEvents];
          if (
            receiptPayments
              .filter((payment) => payment.saleId === sale.id && payment.occurredAt < from)
              .some(
                (payment) =>
                  history.filter(
                    (receipt) =>
                      receipt.sourceType === payment.sourceType &&
                      receipt.sourceId === payment.sourceId,
                  ).length !== 1,
              )
          )
            unavailable("PACKAGE_COLLECTION_PAYMENT_UNCONFIRMED");
          packageHistory.set(sale.id, snapshot({ priorPayments, priorOutstanding, priorEvents }));
        }
        if (
          receipts.some((receipt) => {
            const matching = receiptPayments.filter(
              (row) => row.sourceType === receipt.sourceType && row.sourceId === receipt.sourceId,
            );
            const payment = matching[0];
            return (
              matching.length !== 1 ||
              !payment ||
              payment.saleId !== sale.id ||
              payment.currency !== receipt.currency ||
              payment.grossCents !== receipt.grossCents.toString() ||
              payment.occurredAt.getTime() !== receipt.occurredAt.getTime()
            );
          })
        )
          unavailable("PACKAGE_COLLECTION_PAYMENT_UNCONFIRMED");
        if (
          receipts.some((receipt) => {
            if (receipt.occurredAt < from) return false;
            const inventoried = collections.find((row) => row.id === receipt.id);
            return (
              !inventoried ||
              payrollInputHash(snapshot(inventoried)) !== payrollInputHash(snapshot(receipt))
            );
          })
        )
          unavailable("PACKAGE_COLLECTION_HISTORY_UNCONFIRMED");
        const firstAllocation = receipts[0].allocations.find((row) => row.saleLineId === line.id)!;
        if (
          firstAllocation.grossCents <
          minimumPayrollPackageDeposit(
            BigInt(purchase.grossCents),
            purchase.commissionSettings.minimumDepositPct,
          )
        )
          unavailable("PACKAGE_MINIMUM_DEPOSIT_UNCONFIRMED");
        for (const [index, receipt] of receipts.entries()) {
          if (index > receipts.findIndex((row) => row.id === collection.id)) break;
          const part = receipt.allocations.find((row) => row.saleLineId === line.id)!;
          const captures = receiptEvents.filter(
            (row) => row.sourceType === "COLLECTION" && row.sourceId === part.id,
          );
          if (captures.length !== 1) unavailable("PACKAGE_COLLECTION_CAPTURE_MISSING");
          const event = captures[0];
          if (
            part.tenantId !== tenantId ||
            part.collectionId !== receipt.id ||
            event.tenantId !== tenantId ||
            event.saleId !== sale.id ||
            event.outletId !== sale.outletId ||
            event.occurredAt.getTime() !== receipt.occurredAt.getTime()
          )
            unavailable("PACKAGE_COLLECTION_HISTORY_UNCONFIRMED");
          // Reuse source-envelope validation in the receipt's own local month;
          // its returned lines are deliberately not included in current payroll.
          const dateParts = new Intl.DateTimeFormat("en", {
            timeZone: tenant.timeZone,
            year: "numeric",
            month: "2-digit",
          }).formatToParts(event.occurredAt);
          const receiptPeriod = ["year", "month"]
            .map((type) => dateParts.find((part) => part.type === type)!.value)
            .join("-");
          if (
            !resolvePayrollCloseSources({
              ...common,
              periodKey: receiptPeriod,
              events: [{ ...event, sourceType: "COLLECTION" }],
              lineageEvents: [],
            }).sources
          )
            unavailable("PACKAGE_COLLECTION_HISTORY_UNCONFIRMED");
          verifyPayrollPackageCollection(
            event.evidence,
            purchase,
            line.quantity,
            part.netCents,
            index,
          );
          const provenance = verifyOrdinaryPayrollRateProvenance(
            event.evidence,
            line,
            event.occurredAt,
            event.createdAt,
            commissionRules,
            tenantId,
          );
          if (provenance.category !== null) unavailable("PACKAGE_COLLECTION_CATEGORY_MISMATCH");
        }
        operations.push({
          tenantId,
          sourceType: "COLLECTION",
          sourceId: allocation.id,
          saleId: sale.id,
          outletId: sale.outletId,
          occurredAt: collection.occurredAt,
          evidence: snapshot({ sale, line, purchase, allocation, history }),
        });
        packageCollections.add(line.id);
        continue;
      }
      if (line?.itemType !== "VALUE_PACKAGE") continue;
      if (sale.status !== "COMPLETED" || collection.occurredAt < sale.soldAt)
        unavailable("VALUE_PURCHASE_SALE_UNCONFIRMED");
      const purchase = await loadValuePurchase(line);
      const receipts = history.filter((row) =>
        row.allocations.some((part) => part.saleLineId === line.id),
      );
      const first = receipts[0];
      if (
        !first ||
        !receipts.some((row) => row.id === collection.id) ||
        receipts.some(
          (row, index) =>
            index > 0 && row.createdAt.getTime() === receipts[index - 1].createdAt.getTime(),
        )
      )
        unavailable("VALUE_COLLECTION_ORDER_UNCONFIRMED");
      const event = events.find(
        (row) => row.sourceType === "COLLECTION" && row.sourceId === allocation.id,
      );
      if (!event) unavailable("VALUE_COLLECTION_CAPTURE_MISSING");
      verifyPayrollValueCollection(
        event.evidence,
        allocation.netCents,
        first.id === collection.id ? `${line.quantity}.0000` : "0.0000",
        purchase.sellers,
      );
      const provenance = verifyOrdinaryPayrollRateProvenance(
        event.evidence,
        line,
        event.occurredAt,
        event.createdAt,
        commissionRules,
        tenantId,
      );
      if (provenance.category !== null) unavailable("VALUE_COLLECTION_CATEGORY_MISMATCH");
      operations.push({
        tenantId,
        sourceType: "COLLECTION",
        sourceId: allocation.id,
        saleId: sale.id,
        outletId: sale.outletId,
        occurredAt: collection.occurredAt,
        evidence: snapshot({ sale, line, purchase, allocation, history }),
      });
    }
    const allocations = collection.allocations.map((allocation) => {
      const line = sale.lines.find((row) => row.id === allocation.saleLineId);
      if (!line) unavailable("ALLOCATION_SALE_LINE_UNAVAILABLE");
      const historical = z
        .object({
          version: z.literal(1),
          attributionStatus: z.literal("KNOWN"),
          sellers: commissionSharesSchema,
        })
        .safeParse(allocation.evidence);
      const attribution = commissionAttributionSchema.safeParse(line.attribution);
      if (
        !historical.success ||
        !attribution.success ||
        !attribution.data.sellers ||
        payrollInputHash(historical.data.sellers) !== payrollInputHash(attribution.data.sellers)
      )
        unavailable("HISTORICAL_CASH_ATTRIBUTION_UNCONFIRMED");
      cashAttributions.push({
        tenantId,
        allocationId: allocation.id,
        saleLineId: line.id,
        outletId: sale.outletId!,
        shares: historical.data.sellers,
        evidence: snapshot({
          allocation: allocation.evidence,
          attribution: line.attribution,
          outletId: sale.outletId,
        }),
      });
      return {
        ...allocation,
        grossCents: allocation.grossCents.toString(),
        netCents: allocation.netCents.toString(),
        taxCents: allocation.taxCents.toString(),
        itemType: ["SERVICE", "PRODUCT", "PACKAGE", "VALUE_PACKAGE"].includes(line.itemType)
          ? (line.itemType as "SERVICE" | "PRODUCT" | "PACKAGE" | "VALUE_PACKAGE")
          : ("OTHER" as const),
      };
    });
    normalizedCollections.push({
      ...collection,
      sourceType: z.enum(["SALE_PAYMENT", "OUTSTANDING_PAYMENT"]).parse(collection.sourceType),
      currency: z.literal("SGD").parse(collection.currency),
      grossCents: collection.grossCents.toString(),
      allocations,
    });
  }
  if ([...packagePurchases.keys()].some((id) => !packageCollections.has(id)))
    unavailable("PACKAGE_COLLECTION_REQUIRED");
  const sources = {
    ...common,
    events: events as PayrollCloseInputRecords["sources"]["events"],
    lineageEvents: [...lineage.values()] as PayrollCloseInputRecords["sources"]["lineageEvents"],
    operations: paymentOperations,
    collections: normalizedCollections,
    legacyCommissions: legacy.map((row) => ({ ...row, amount: row.amount.toFixed(10) })),
  };
  const sourceResult = resolvePayrollCloseSources(sources);
  if (!sourceResult.sources) unavailable("SOURCE_EVIDENCE_INVALID");
  const lineIds = new Set(sourceResult.sources.lines.map((line) => line.id));
  const priorEvidence = [];
  for (const close of closes) {
    const verified = await verifiedPayrollClose(tx, close.periodKey);
    if (!verified?.state.calculation) unavailable("PRIOR_APPROVED_CLOSE_INVALID");
    if (
      verified.state.calculation.inputs.staff.some((row) =>
        row.calculation.lines.some((line) => lineIds.has(line.id)),
      )
    )
      unavailable("SOURCE_ALREADY_APPROVED_IN_ANOTHER_PERIOD");
    priorEvidence.push({
      periodKey: close.periodKey,
      revision: close.revision,
      hash: payrollInputHash(verified.state),
    });
  }
  const cash = resolvePayrollCloseCash({ ...sources, cashAttributions, noCashReversals });
  if (!cash.cash) unavailable("CASH_RECONCILIATION_UNAVAILABLE");
  const requiredStaffIds = [
    ...new Set([
      ...sourceResult.sources.requiredStaffIds,
      ...carryResult.requiredStaffIds,
      ...cash.cash.staff.map((row) => row.staffId),
      ...state.adjustments.map((row) => row.staffId),
    ]),
  ].sort();
  const configuration = {
    ...common,
    events: configurationEvents as PayrollCloseInputRecords["configuration"]["events"],
    versions: versions.map((row) => ({
      ...payrollPlanVersionSchema.parse(row),
      tenantId: row.tenantId,
    })),
    staff,
    requiredStaffIds,
  };
  const selected = resolvePayrollCloseConfiguration(configuration);
  if (!selected.configuration) unavailable("HISTORICAL_CONFIGURATION_UNAVAILABLE");
  const requests = selected.configuration.staff.flatMap((row) =>
    (row.version?.definition.incentives ?? [])
      .filter(
        (rule) => rule.type === "GROUP_AND_INDIVIDUAL" && rule.groupMetric === "SUM_INDIVIDUAL",
      )
      .map((rule) => ({
        staffId: row.staff.id,
        planId: row.version!.planId,
        versionId: row.version!.id,
        outletIds: row.assignment!.outletIds ?? [],
        rule,
      })),
  );
  const groups = resolvePayrollCloseGroupMetrics({ ...sources, requests });
  if (!groups.groups) unavailable("GROUP_METRICS_UNAVAILABLE");
  const metrics = selected.configuration.staff.map((row) => {
    const groupMetrics: PayrollGroupMetric[] = groups
      .groups!.metrics.filter((entry) => entry.staffId === row.staff.id)
      .map((entry) => entry.metric);
    for (const rule of row.version?.definition.incentives ?? []) {
      if (rule.type !== "GROUP_AND_INDIVIDUAL" || rule.groupMetric !== "SALON_CASH") continue;
      const assignmentOutlets = row.assignment?.outletIds ?? [];
      const ownLines = sourceResult.sources!.lines.filter(
        (line) =>
          line.staffId === row.staff.id &&
          rule.individualMetricTypes.includes(line.commissionType) &&
          (!assignmentOutlets.length || assignmentOutlets.includes(line.outletId!)),
      );
      const outlets =
        rule.scope === "SALON"
          ? [null]
          : [...new Set(ownLines.map((line) => line.outletId))].sort();
      for (const outletId of outlets)
        groupMetrics.push({
          ruleKey: rule.key,
          periodKey,
          scope: rule.scope,
          outletId,
          metric: "SALON_CASH",
          amount:
            outletId === null
              ? cash.cash!.salonCash
              : (cash.cash!.outlets.find((entry) => entry.outletId === outletId)?.collection ??
                "0.0000"),
        });
    }
    return {
      tenantId,
      periodKey,
      staffId: row.staff.id,
      collection:
        cash.cash!.staff.find((entry) => entry.staffId === row.staff.id)?.collection ?? "0.0000",
      groupMetrics,
      evidence: { derivedFrom: "authoritative-operational-inventory-v1" },
    };
  });
  const result = resolvePayrollCloseInputs({
    state,
    configuration,
    sources,
    carry,
    carrySettlements: settlements,
    metrics,
    inventoryOperations: operations,
    cashAttributions,
    noCashReversals,
  });
  if (!result.inputs) unavailable(result.blockers.map((blocker) => blocker.code).join(","));
  result.inputs.evidence = {
    resolved: result.inputs.evidence,
    authoritative: {
      version: 1,
      operations: snapshot({ sales, payments, outstanding }),
      valuePurchases: snapshot([...valuePurchases].sort(([a], [b]) => a.localeCompare(b))),
      packageHistory: snapshot([...packageHistory].sort(([a], [b]) => a.localeCompare(b))),
      packagePurchases: snapshot([...packagePurchases].sort(([a], [b]) => a.localeCompare(b))),
      saleCoverage: snapshot([...saleCoverage].sort(([a], [b]) => a.localeCompare(b))),
      packageTenders: snapshot([...packageTenders].sort(([a], [b]) => a.localeCompare(b))),
      valueSales: snapshot([...valueSales].sort(([a], [b]) => a.localeCompare(b))),
      corrections: correctionEvidence,
      priorCloses: priorEvidence,
    },
  };
  // Assert snapshot serializability now, not after attempting to persist a close.
  payrollInputHash(result.inputs);
  return result.inputs;
};
