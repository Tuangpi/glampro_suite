import { z } from "zod";
import {
  commissionAttributionSchema,
  commissionSharesSchema,
  allocatePayrollSplit,
  payrollPeriodKeySchema,
  payrollPlanVersionSchema,
  type PayrollGroupMetric,
} from "@glampro_suite/shared";
import { currentOutletId, currentScope } from "../lib/tenant-context.js";
import { conflict, forbidden } from "../lib/http-error.js";
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
 * No caller records, paging, current salary fallback or inferred opening zero.
 * Unsupported operational workflows block the entire close, even without captures.
 */
export const loadAuthoritativePayrollCloseInputs: PayrollCloseLoader = async (tx, state) => {
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId || currentOutletId())
    throw forbidden("Payroll input loading requires a salon-wide authenticated actor.");
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
  ]);
  if (redemptions.length) unavailable("REDEMPTION_WORKFLOW_NOT_LOADED");
  if (
    refunds.length ||
    sales.some((sale) => sale.voidedAt && sale.voidedAt >= from && sale.voidedAt < to)
  )
    unavailable("REFUND_OR_VOID_WORKFLOW_NOT_LOADED");
  if (events.some((event) => !["SALE_LINE", "COLLECTION"].includes(event.sourceType)))
    unavailable("SOURCE_WORKFLOW_NOT_LOADED");
  // A prior usage can cover sale-line quantities. Until its coverage is loaded,
  // do not incorrectly treat a partially covered sale as an ordinary full line.
  const saleIds = [
    ...new Set([...sales.map((sale) => sale.id), ...collections.map((row) => row.saleId)]),
  ];
  if (await tx.customerRedemption.count({ where: { tenantId, saleId: { in: saleIds } } }))
    unavailable("SALE_USAGE_COVERAGE_NOT_LOADED");
  const {
    carry,
    resolved: carryResult,
    settlements,
  } = await loadStoredPayrollCarry(tx, tenantId, periodKey);

  const operations: PayrollCloseInputRecords["inventoryOperations"] = [];
  for (const sale of sales) {
    if (sale.soldAt < from || sale.soldAt >= to) continue;
    if (sale.collectionCurrency !== "SGD") unavailable("SALE_CURRENCY_UNCONFIRMED");
    for (const line of sale.lines) {
      if (["PACKAGE", "VALUE_PACKAGE"].includes(line.itemType))
        unavailable("PACKAGE_PURCHASE_WORKFLOW_NOT_LOADED");
      if (!["SERVICE", "PRODUCT"].includes(line.itemType)) continue;
      const gross = line.lineTotal.minus(line.voucherDiscountAmount);
      const foc = gross.isZero() ? resolvePayrollFocEconomics(line, sale.soldAt) : null;
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
          foc?.baseAmount ?? gross.minus(line.taxAmount).toFixed(4),
          shares,
        );
        const units = allocatePayrollSplit(`${line.quantity}.0000`, shares);
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
  for (const payment of payments) {
    if (["PACKAGE", "PREPAID_CREDIT"].includes(payment.method))
      unavailable("PREPAID_PAYMENT_WORKFLOW_NOT_LOADED");
    if (payment.sessionId !== null) unavailable("GATEWAY_SETTLEMENT_UNCONFIRMED");
    if (payment.sale.status === "HELD" || payment.sale.collectionCurrency !== "SGD")
      unavailable("PAYMENT_SALE_UNCONFIRMED");
    if (payment.amount.isZero()) continue;
    paymentOperations.push({
      tenantId,
      sourceType: "SALE_PAYMENT",
      sourceId: payment.id,
      saleId: payment.saleId,
      currency: "SGD",
      grossCents: payment.amount.mul(100).toFixed(0),
      occurredAt: payment.createdAt,
    });
  }
  for (const payment of outstanding) {
    if (
      !payment.sale ||
      payment.sale.status === "HELD" ||
      payment.sale.collectionCurrency !== "SGD" ||
      payment.sale.customerId !== payment.customerId ||
      payment.outstanding.saleId !== payment.saleId ||
      payment.outstanding.customerId !== payment.customerId ||
      payment.outstanding.tenantId !== tenantId
    )
      unavailable("OUTSTANDING_PAYMENT_IDENTITY_UNCONFIRMED");
    if (payment.paidAmount.isZero()) continue;
    paymentOperations.push({
      tenantId,
      sourceType: "OUTSTANDING_PAYMENT",
      sourceId: payment.id,
      saleId: payment.sale.id,
      currency: "SGD",
      grossCents: payment.paidAmount.mul(100).toFixed(0),
      occurredAt: payment.paidAt,
    });
  }
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
      include: { allocations: true },
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
    const allocations = collection.allocations.map((allocation) => {
      const line = sale.lines.find((row) => row.id === allocation.saleLineId);
      if (!line) unavailable("ALLOCATION_SALE_LINE_UNAVAILABLE");
      if (["PACKAGE", "VALUE_PACKAGE"].includes(line.itemType))
        unavailable("PACKAGE_PURCHASE_WORKFLOW_NOT_LOADED");
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
  const sources = {
    ...common,
    events: events as PayrollCloseInputRecords["sources"]["events"],
    lineageEvents: [],
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
  const cash = resolvePayrollCloseCash({ ...sources, cashAttributions });
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
  });
  if (!result.inputs) unavailable(result.blockers.map((blocker) => blocker.code).join(","));
  result.inputs.evidence = {
    resolved: result.inputs.evidence,
    authoritative: {
      version: 1,
      operations: snapshot({ sales, payments, outstanding }),
      priorCloses: priorEvidence,
    },
  };
  // Assert snapshot serializability now, not after attempting to persist a close.
  payrollInputHash(result.inputs);
  return result.inputs;
};
