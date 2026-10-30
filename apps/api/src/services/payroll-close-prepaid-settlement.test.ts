import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  allocatePayrollSplit,
  capturePayrollPackagePurchase,
  payrollBaseLineSchema,
  payrollPackageRefundAmounts,
  refundPayrollPackageSchema,
} from "@glampro_suite/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { loadPayrollPrepaidSettlement } from "./payroll-close-prepaid-settlement.js";
import { payrollInputHash } from "./payroll-close-state.js";
import { payrollBusinessDate } from "./payroll-source-event.js";

const tenantId = "salon";
const holdingId = "holding";
const saleId = "sale";
const lineId = "line";
const outletId = "branch";
const actorId = "manager";
const timeZone = "Asia/Singapore";
const soldAt = new Date("2026-10-01T00:00:00.000Z");
const occurredAt = new Date("2026-10-20T00:00:00.000Z");
const updatedAt = new Date("2026-10-10T00:00:00.000Z");
const shares = [{ staffId: "seller", share: 10000 }];

function json<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  ) as T;
}
const hash = (value: unknown) => payrollInputHash(json(value));

type SettlementRow = {
  id: string;
  tenantId: string;
  sourceKey: string;
  itemType: string;
  holdingId: string;
  saleId: string;
  saleLineId: string;
  actorId: string;
  actorRole: string;
  reason: string;
  reference: string;
  requestHash: string;
  currency: string;
  netCents: bigint;
  taxCents: bigint;
  grossCents: bigint;
  cancelledGrossCents: bigint;
  payoutMethod: string;
  occurredAt: Date;
  createdAt: Date;
  evidence: {
    version: number;
    request: { settlement?: { reference: string } };
    operationalHash: string;
    operational: { amounts: Record<string, string> };
    [key: string]: unknown;
  };
};
type CaptureRow = {
  id: string;
  tenantId: string;
  sourceKey: string;
  sourceType: string;
  sourceId: string;
  saleId: string;
  outletId: string;
  actorId: string;
  reason: string;
  occurredAt: Date;
  createdAt: Date;
  evidence: {
    version: number;
    status: string;
    postingStatus: string;
    currency: string;
    requestHash: string;
    lines: { baseAmount: string }[];
    remainingOrdinals: unknown;
    [key: string]: unknown;
  };
};
type HoldingRow = {
  id: string;
  tenantId: string;
  saleLineId: string;
  quantityRemaining: number;
  payrollAvailableOrdinals: unknown[];
  updatedAt: Date;
  [key: string]: unknown;
};

/** Mirrors payroll-package-refund: one confirmed settlement for unused-session cancellation. */
function fixture() {
  const purchase = capturePayrollPackagePurchase({
    saleId,
    saleLineId: lineId,
    packageId: "package",
    originalCustomerId: "buyer",
    outletId,
    purchasedAt: soldAt.toISOString(),
    currency: "SGD",
    grantedSessions: 5,
    grossCents: "545000",
    netCents: "500000",
    taxCents: "45000",
    sellers: shares,
    commissionSettings: {
      sale: { mode: "FOLLOW_PLAN" },
      redemption: { mode: "FOLLOW_PLAN" },
      minimumDepositPct: "0",
    },
  });
  const available = [{ first: 3, last: 5 }];
  const amounts = payrollPackageRefundAmounts({
    purchase,
    available,
    quantityRemaining: 3,
    collectedNet: 500000n,
    collectedTax: 45000n,
    adminFeeNet: 0n,
  });
  const request = refundPayrollPackageSchema.parse({
    idempotencyKey: "settlement-0001",
    expectedUpdatedAt: updatedAt.toISOString(),
    reason: "Customer cancelled unused sessions",
    adminFeeNetCents: "0",
    payoutGrossCents: amounts.gross.toString(),
    payoutMethod: "CASH",
    settlement: { confirmed: true, reference: "cash-voucher-0001" },
  });
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ ...request, holdingId, actorId }))
    .digest("hex");
  const sale = {
    id: saleId,
    tenantId,
    outletId,
    status: "COMPLETED",
    collectionCurrency: "SGD",
    customerId: "buyer",
    soldAt,
    voidedAt: null,
  };
  const line = {
    id: lineId,
    tenantId,
    saleId,
    itemType: "PACKAGE",
    itemId: "package",
    lineTotal: new Prisma.Decimal("545"),
    voucherDiscountAmount: new Prisma.Decimal("0"),
    taxAmount: new Prisma.Decimal("45"),
  };
  const originalLine = payrollBaseLineSchema.parse({
    id: `${lineId}:base`,
    staffId: "seller",
    outletId,
    commissionType: "PKG_SALE",
    baseAmount: "5000.0000",
    units: "5.0000",
    businessDate: "2026-10-01",
    mode: "FOLLOW_PLAN",
    status: "EARNED",
    fallbackRatePct: "0",
  });
  const source = {
    id: "collection-capture",
    tenantId,
    sourceKey: "collection:allocation",
    sourceType: "COLLECTION",
    sourceId: "allocation",
    saleId,
    outletId,
    occurredAt: soldAt,
    createdAt: soldAt,
    evidence: {
      version: 1,
      status: "CAPTURED",
      postingStatus: "PENDING_RELEASE",
      currency: "SGD",
      lines: [originalLine],
    },
  };
  const allocation = {
    id: "allocation",
    tenantId,
    collectionId: "collection",
    saleLineId: lineId,
    grossCents: 545000n,
    netCents: 500000n,
    taxCents: 45000n,
    evidence: { version: 1, attributionStatus: "KNOWN", sellers: shares },
    collection: { id: "collection", tenantId, saleId, currency: "SGD", occurredAt: soldAt },
  };
  const preHolding = {
    id: holdingId,
    tenantId,
    saleLineId: lineId,
    packageId: "package",
    quantity: 5,
    quantityRemaining: 3,
    payrollAvailableOrdinals: available,
    payrollPurchaseSnapshot: purchase,
    familyId: null,
    customerId: "buyer",
    updatedAt,
  };
  const holding: HoldingRow = {
    ...preHolding,
    quantityRemaining: 0,
    payrollAvailableOrdinals: [],
    updatedAt: occurredAt,
  };
  const operational = {
    holding: preHolding,
    sale,
    line,
    allocations: [allocation],
    sources: [source],
    outstanding: null,
    amounts: Object.fromEntries(
      Object.entries(amounts).map(([key, value]) => [key, value.toString()]),
    ),
  };
  const sourceKey = `package-refund:${request.idempotencyKey}`;
  const bases =
    amounts.net > 0n
      ? allocatePayrollSplit(
          `-${amounts.net / 100n}.${(amounts.net % 100n).toString().padStart(2, "0")}00`,
          shares,
        )
      : [];
  const lines = bases.map((base) =>
    payrollBaseLineSchema.parse({
      ...originalLine,
      id: `${sourceKey}:${base.staffId}`,
      baseAmount: base.amount,
      units: "0.0000",
      status: "EARNED",
      businessDate: payrollBusinessDate(occurredAt, timeZone),
    }),
  );
  const event: CaptureRow = {
    id: "refund-capture",
    tenantId,
    sourceKey,
    sourceType: "PACKAGE_REFUND",
    sourceId: holdingId,
    saleId,
    outletId,
    actorId,
    reason: request.reason,
    occurredAt,
    createdAt: occurredAt,
    evidence: {
      version: 1,
      status: "CAPTURED",
      postingStatus: "PENDING_RELEASE",
      requestHash,
      currency: "SGD",
      netCents: amounts.net.toString(),
      taxCents: amounts.tax.toString(),
      grossCents: amounts.gross.toString(),
      adminFeeNetCents: "0",
      usedBaseTicks: amounts.usedTicks.toString(),
      originalSourceIds: [source.id],
      payoutMethod: request.payoutMethod,
      lines,
      purchase,
      remainingOrdinals: available,
    },
  };
  const settlement: SettlementRow = {
    id: "settlement",
    tenantId,
    sourceKey,
    itemType: "PACKAGE",
    holdingId,
    saleId,
    saleLineId: lineId,
    actorId,
    actorRole: "MANAGER",
    reason: request.reason,
    reference: request.settlement!.reference,
    requestHash,
    currency: "SGD",
    netCents: amounts.net,
    taxCents: amounts.tax,
    grossCents: amounts.gross,
    cancelledGrossCents: amounts.cancelledGross,
    payoutMethod: request.payoutMethod,
    occurredAt,
    createdAt: occurredAt,
    evidence: { version: 1, request, operationalHash: hash(operational), operational },
  };
  const state = { settlements: [settlement], captures: [event], sources: [source] };
  // Prisma Json columns round-trip evidence through JSON; timestamps stay Date.
  const stored = (rows: { evidence: unknown }[]) =>
    rows.map((row) => ({ ...row, evidence: json(row.evidence) }));
  const tx = {
    prepaidRefundSettlement: { findMany: async () => stored(state.settlements) },
    payrollSourceEvent: {
      findMany: async (args: { where: { sourceType?: string } }) =>
        stored(args.where.sourceType === "COLLECTION" ? state.sources : state.captures),
    },
    sale: { findFirst: async () => sale },
    saleLine: { findFirst: async () => line },
    commissionCollectionAllocation: { findMany: async () => [allocation] },
    customerOutstanding: { findFirst: async () => null },
  };
  type Input = Parameters<typeof loadPayrollPrepaidSettlement>[1];
  const load = () =>
    loadPayrollPrepaidSettlement(
      tx as never,
      {
        tenantId,
        holding,
        event,
        timeZone,
      } as unknown as Input,
    );
  return { settlement, event, request, state, holding, load };
}
const unconfirmed = /PREPAID_REFUND_SETTLEMENT_UNCONFIRMED/;

test("confirmed prepaid settlement reconciles pre-cancellation holding evidence", async () => {
  const f = fixture();
  const loaded = await f.load();
  assert.equal(loaded.settlement.id, "settlement");
  assert.equal(loaded.preHolding.quantityRemaining, 3);
  assert.deepEqual(loaded.preHolding.payrollAvailableOrdinals, [{ first: 3, last: 5 }]);
  assert.deepEqual(loaded.amounts, {
    net: 300000n,
    tax: 27000n,
    gross: 327000n,
    usedTicks: 20000000n,
    cancelledGross: 0n,
  });
  assert.equal(loaded.allocations.length, 1);
  assert.equal(loaded.sources.length, 1);
});

test("settlement validation rejects every unbound or tampered fact", async () => {
  const mutations: [string, (f: ReturnType<typeof fixture>) => void][] = [
    ["foreign tenant", (f) => void (f.settlement.tenantId = "other")],
    ["foreign actor", (f) => void (f.settlement.actorId = "other")],
    ["actor role", (f) => void (f.settlement.actorRole = "STAFF")],
    ["reason drift", (f) => void (f.settlement.reason = "Different reason")],
    ["reference drift", (f) => void (f.request.settlement!.reference = "other-voucher")],
    ["capture time drift", (f) => void (f.event.occurredAt = new Date("2026-10-19T00:00:00Z"))],
    ["net tampering", (f) => void (f.settlement.netCents = 299999n)],
    ["gross tampering", (f) => void (f.settlement.cancelledGrossCents = 1n)],
    ["payout method", (f) => void (f.settlement.payoutMethod = "CARD")],
    ["source key", (f) => void (f.settlement.sourceKey = "package-refund:forged")],
    ["sale line", (f) => void (f.settlement.saleLineId = "other")],
    ["request hash", (f) => void (f.settlement.requestHash = "0".repeat(64))],
    ["holding package", (f) => void (f.holding.packageId = "other")],
    [
      "holding snapshot",
      (f) => void ((f.holding.payrollPurchaseSnapshot as Record<string, unknown>).netCents = "1"),
    ],
    ["operational hash", (f) => void (f.settlement.evidence.operationalHash = "0".repeat(64))],
    [
      "operational amounts",
      (f) =>
        void (f.settlement.evidence.operational.amounts = {
          ...f.settlement.evidence.operational.amounts,
          usedTicks: "1",
        }),
    ],
    [
      "duplicate settlements",
      (f) => void f.state.settlements.push({ ...f.settlement, id: "settlement-2" }),
    ],
    ["duplicate captures", (f) => void f.state.captures.push({ ...f.event, id: "capture-2" })],
    ["no settlement", (f) => void (f.state.settlements = [])],
    [
      "remaining ordinals",
      (f) => void (f.event.evidence.remainingOrdinals = [{ first: 4, last: 5 }]),
    ],
    [
      "clawback lines",
      (f) => {
        f.event.evidence.lines[0].baseAmount = "-2999.0000";
      },
    ],
    ["capture request hash", (f) => void (f.event.evidence.requestHash = "forged")],
    [
      "original source inventory",
      (f) => void f.state.sources.push({ ...f.state.sources[0], id: "collection-capture-2" }),
    ],
  ];
  for (const [name, mutate] of mutations) {
    const f = fixture();
    mutate(f);
    await assert.rejects(f.load, unconfirmed, name);
  }
});

test("credit captures cannot reuse package settlement evidence", async () => {
  const f = fixture();
  f.event.sourceType = "VALUE_PACKAGE_REFUND";
  await assert.rejects(f.load, unconfirmed);
});
