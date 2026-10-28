import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import { readPayrollValueHoldingDetail } from "./payroll-value-holding-detail.js";

type Transaction = Parameters<typeof readPayrollValueHoldingDetail>[0];
const decimal = (value: string) => new Prisma.Decimal(value);
function fixture() {
  const purchase = {
    version: 1,
    saleId: "sale",
    saleLineId: "line",
    currency: "SGD",
    paidNet: "500.00",
    credit: "600.00",
    sellers: [{ staffId: "seller", share: 10000 }],
  };
  const holding = {
    id: "holding",
    saleLineId: "line",
    valuePackageId: "catalogue",
    amount: decimal("600"),
    amountRemaining: decimal("500"),
    updatedAt: new Date("2026-10-28T00:00:00Z"),
    payrollPurchaseSnapshot: purchase as unknown,
  };
  const line = {
    id: "line",
    lineTotal: decimal("545"),
    voucherDiscountAmount: decimal("0"),
    taxAmount: decimal("45"),
    attribution: { sellers: purchase.sellers },
  };
  const allocation = {
    id: "allocation",
    netCents: 50000n,
    taxCents: 4500n,
    grossCents: 54500n,
    collection: { saleId: "sale", currency: "SGD" },
  };
  const allocations = [allocation];
  let event: unknown = null;
  const sources = [
    {
      id: "source",
      sourceId: "allocation",
      saleId: "sale",
      evidence: {
        status: "CAPTURED",
        currency: "SGD",
        lines: [
          {
            id: "original:seller",
            staffId: "seller",
            outletId: null,
            commissionType: "VP_SALE",
            mode: "FOLLOW_PLAN",
            baseAmount: "500.0000",
            units: "1.0000",
            businessDate: "2026-10-01",
            status: "EARNED",
            fallbackRatePct: "7",
          },
        ],
      },
    },
  ];
  let outstanding: { unpaidAmount: Prisma.Decimal } | null = null;
  let missing = false;
  let requested: unknown;
  const tx = {
    customerValuePackageHolding: {
      findFirst: async (args: unknown) => {
        requested = args;
        return missing ? null : holding;
      },
    },
    payrollSourceEvent: { findFirst: async () => event, findMany: async () => sources },
    customerOutstanding: { findFirst: async () => outstanding },
    sale: {
      findFirst: async () => ({
        id: "sale",
        outletId: null,
        status: "COMPLETED",
        collectionCurrency: "SGD",
        refund: null,
      }),
    },
    saleLine: { findFirst: async () => line },
    commissionCollectionAllocation: { findMany: async () => allocations },
    customerRedemption: { findMany: async () => [{ amount: decimal("100") }] },
  } as unknown as Transaction;
  return {
    holding,
    line,
    allocation,
    allocations,
    sources,
    setOutstanding: (value: typeof outstanding) => {
      outstanding = value;
    },
    run: () => readPayrollValueHoldingDetail(tx, "customer", "holding"),
    setEvent: (value: unknown) => {
      event = value;
    },
    setMissing: () => {
      missing = true;
    },
    requested: () => requested,
  };
}
test("value detail scopes holding to current customer and preserves exact original ratio/collections", async () => {
  const f = fixture();
  const result = await f.run();
  assert.deepEqual(f.requested(), { where: { id: "holding", customerId: "customer" } });
  assert.equal(result.purchase?.paidNet, "500.00");
  assert.equal(result.purchase?.credit, "600.00");
  assert.equal(result.collectedNetCents, "50000");
  assert.equal(result.originalTaxCents, "4500");
  assert.equal(result.usedBaseTicks, "833333");
  assert.deepEqual(result.missingEvidence, []);
});
test("customer-bound missing holding returns not found", async () => {
  const f = fixture();
  f.setMissing();
  await assert.rejects(f.run(), /does not exist/);
});
test("legacy evidence remains unavailable without inferred ratio or collections", async () => {
  const f = fixture();
  f.holding.payrollPurchaseSnapshot = null;
  const result = await f.run();
  assert.equal(result.purchase, null);
  assert.equal(result.collectedNetCents, null);
  assert.deepEqual(result.missingEvidence, ["ORIGINAL_PURCHASE_EVIDENCE"]);
});
test("contradictory usage disables preview instead of displaying invented economics", async () => {
  const f = fixture();
  f.holding.amountRemaining = decimal("501");
  const result = await f.run();
  assert.equal(result.usedBaseTicks, null);
  assert.deepEqual(result.missingEvidence, ["SOURCE_ECONOMICS_OR_USAGE"]);
});
test("corrupt collection components remain unavailable", async () => {
  const f = fixture();
  f.allocation.grossCents++;
  const result = await f.run();
  assert.equal(result.collectedNetCents, null);
  assert.deepEqual(result.missingEvidence, ["SOURCE_ECONOMICS_OR_USAGE"]);
});
test("recorded refund reads immutable payout rather than treating cancelled credit as usage", async () => {
  const f = fixture();
  f.holding.amountRemaining = decimal("0");
  f.setEvent({
    occurredAt: new Date("2026-10-28T01:00:00Z"),
    reason: "Approved refund",
    evidence: { grossCents: "34516", netCents: "31666", taxCents: "2850", payoutMethod: "PAYNOW" },
  });
  const result = await f.run();
  assert.equal(result.refunded, true);
  assert.equal(result.usedBaseTicks, null);
  assert.equal(result.refund?.grossCents, "34516");
  assert.equal(result.refund?.reason, "Approved refund");
  assert.equal(result.collectedNetCents, "50000");
  assert.deepEqual(result.missingEvidence, []);
});

for (const [name, corrupt] of [
  [
    "missing source",
    (f: ReturnType<typeof fixture>) => {
      f.sources.length = 0;
    },
  ],
  [
    "wrong seller",
    (f: ReturnType<typeof fixture>) => {
      f.sources[0]!.evidence.lines[0]!.staffId = "foreign";
    },
  ],
  [
    "wrong base",
    (f: ReturnType<typeof fixture>) => {
      f.sources[0]!.evidence.lines[0]!.baseAmount = "499.0000";
    },
  ],
  [
    "missing rate",
    (f: ReturnType<typeof fixture>) => {
      Reflect.deleteProperty(f.sources[0]!.evidence.lines[0]!, "fallbackRatePct");
    },
  ],
  [
    "unavailable source",
    (f: ReturnType<typeof fixture>) => {
      f.sources[0]!.evidence.status = "UNAVAILABLE";
    },
  ],
  [
    "reversed line",
    (f: ReturnType<typeof fixture>) => {
      f.sources[0]!.evidence.lines[0]!.status = "REVERSED";
    },
  ],
] as const) {
  test(`detail blocks refund with ${name} while preserving known economic totals`, async () => {
    const f = fixture();
    corrupt(f);
    const result = await f.run();
    assert.equal(result.collectedNetCents, "50000");
    assert.equal(result.usedBaseTicks, "833333");
    assert.deepEqual(result.missingEvidence, ["ORIGINAL_COLLECTION_SELLER_SOURCES"]);
  });
}
test("detail blocks missing uncollected debt evidence", async () => {
  const f = fixture();
  Object.assign(f.allocation, { netCents: 25000n, taxCents: 2250n, grossCents: 27250n });
  f.sources[0]!.evidence.lines[0]!.baseAmount = "250.0000";
  assert.deepEqual((await f.run()).missingEvidence, ["ORIGINAL_OUTSTANDING_BALANCE"]);
  f.setOutstanding({ unpaidAmount: decimal("272.49") });
  assert.deepEqual((await f.run()).missingEvidence, ["ORIGINAL_OUTSTANDING_BALANCE"]);
  f.setOutstanding({ unpaidAmount: decimal("272.50") });
  assert.deepEqual((await f.run()).missingEvidence, []);
});
test("detail blocks conflicting rates across collections", async () => {
  const f = fixture();
  Object.assign(f.allocation, { netCents: 25000n, taxCents: 2250n, grossCents: 27250n });
  f.sources[0]!.evidence.lines[0]!.baseAmount = "250.0000";
  f.allocations.push({ ...f.allocation, id: "second-allocation" });
  f.sources.push(structuredClone(f.sources[0]!));
  f.sources[1]!.sourceId = "second-allocation";
  f.sources[1]!.evidence.lines[0]!.fallbackRatePct = "12";
  assert.deepEqual((await f.run()).missingEvidence, ["ORIGINAL_COLLECTION_SELLER_SOURCES"]);
});
