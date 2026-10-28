import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import { runAsTenant } from "../lib/tenant-context.js";
import { HttpError } from "../lib/http-error.js";
import { captureCollectionEvidence } from "./commission-collection-evidence.js";
import {
  assertPayrollValuePackageRestorable,
  refundPayrollValuePackageInTransaction,
} from "./payroll-value-package-refund.js";
import type { RefundPayrollPackage } from "@glampro_suite/shared";
import { allocatePayrollSplit } from "@glampro_suite/shared";
import { readPayrollValueHoldingDetail } from "./payroll-value-holding-detail.js";

type Transaction = Parameters<typeof refundPayrollValuePackageInTransaction>[0];
const decimal = (value: string) => new Prisma.Decimal(value);
const request: RefundPayrollPackage = {
  idempotencyKey: "value-refund-request",
  expectedUpdatedAt: "2026-10-28T00:00:00.000Z",
  reason: "Customer requests unused credit refund",
  adminFeeNetCents: "10000",
  payoutGrossCents: "34516",
  payoutMethod: "CASH",
};

function fixture() {
  const purchase = {
    version: 1,
    saleId: "purchase",
    saleLineId: "line",
    currency: "SGD",
    paidNet: "500.00",
    credit: "600.00",
    sellers: [{ staffId: "seller", share: 10000 }],
  };
  const holding = {
    id: "holding",
    valuePackageId: "catalogue",
    saleLineId: "line",
    updatedAt: new Date(request.expectedUpdatedAt),
    amount: decimal("600"),
    amountRemaining: decimal("500"),
    payrollPurchaseSnapshot: purchase as unknown,
  };
  const sale = {
    id: "purchase",
    status: "COMPLETED",
    collectionCurrency: "SGD",
    outletId: null,
    refund: null as unknown,
  };
  const line = {
    id: "line",
    lineTotal: decimal("545"),
    voucherDiscountAmount: decimal("0"),
    taxAmount: decimal("45"),
    attribution: { sellers: purchase.sellers },
  };
  const allocations = [
    {
      id: "allocation",
      netCents: 50000n,
      taxCents: 4500n,
      grossCents: 54500n,
      collection: {
        saleId: "purchase",
        currency: "SGD",
        sourceType: "SALE_PAYMENT",
        sourceId: "cash-payment",
      },
    },
  ];
  const originalLine = {
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
  };
  const sources = [
    {
      id: "source",
      sourceId: "allocation",
      saleId: "purchase",
      evidence: { status: "CAPTURED", currency: "SGD", lines: [originalLine] },
    },
  ];
  const redemptions = [{ amount: decimal("100") }];
  const writes: { kind: string; data: unknown }[] = [];
  const events: {
    id: string;
    sourceKey: string;
    sourceType: string;
    sourceId: string;
    evidence: unknown;
  }[] = [];
  let role = "MANAGER";
  let outstanding: { id: string; unpaidAmount: Prisma.Decimal } | null = null;
  const locks: string[] = [];
  const tx = {
    $executeRaw: async () => {
      locks.push("prepaid");
    },
    $queryRaw: async () => {
      locks.push("context/configuration");
    },
    user: { findFirst: async () => ({ id: "manager", globalRole: role }) },
    customerValuePackageHolding: {
      findFirst: async () => holding,
      update: async ({ data }: { data: unknown }) => {
        writes.push({ kind: "holding", data });
        return holding;
      },
    },
    customerRedemption: { findMany: async () => redemptions },
    sale: { findFirst: async () => sale },
    saleLine: { findFirst: async () => line },
    commissionCollectionAllocation: { findMany: async () => allocations },
    payrollSourceEvent: {
      findFirst: async ({
        where,
      }: {
        where: { sourceKey?: string; sourceType?: string; sourceId?: string };
      }) =>
        events.find((event) =>
          where.sourceKey
            ? event.sourceKey === where.sourceKey
            : event.sourceType === where.sourceType && event.sourceId === where.sourceId,
        ) ?? null,
      findMany: async () => sources,
      create: async ({ data }: { data: (typeof events)[number] }) => {
        const event = { ...data, id: "refund-event" };
        events.push(event);
        writes.push({ kind: "event", data });
        return event;
      },
    },
    customerOutstanding: {
      findFirst: async () => outstanding,
      update: async ({ data }: { data: unknown }) => {
        writes.push({ kind: "outstanding", data });
      },
    },
    tenant: { findUniqueOrThrow: async () => ({ timeZone: "Asia/Singapore" }) },
  };
  const run = (input = request) =>
    runAsTenant(
      "tenant",
      () => refundPayrollValuePackageInTransaction(tx as unknown as Transaction, holding.id, input),
      "manager",
    );
  return {
    tx: tx as unknown as Transaction,
    run,
    writes,
    events,
    holding,
    purchase,
    sale,
    line,
    allocations,
    sources,
    redemptions,
    locks,
    setRole: (value: string) => {
      role = value;
    },
    setOutstanding: (value: typeof outstanding) => {
      outstanding = value;
    },
  };
}

test("value refund records source-time seller negative base and cancels credit without touching spends", async () => {
  const f = fixture();
  const before = JSON.stringify(f.sources);
  const result = await f.run();
  const evidence = result.evidence as {
    lines: (typeof f.sources)[number]["evidence"]["lines"];
    netCents: string;
    taxCents: string;
    cancelledCreditCents: string;
  };
  assert.equal(evidence.netCents, "31666");
  assert.equal(evidence.taxCents, "2850");
  assert.equal(evidence.cancelledCreditCents, "50000");
  assert.equal(evidence.lines[0]!.baseAmount, "-316.6600");
  assert.equal(evidence.lines[0]!.staffId, "seller");
  assert.equal(evidence.lines[0]!.fallbackRatePct, "7");
  assert.equal(evidence.lines[0]!.units, "0.0000");
  assert.deepEqual(
    f.writes.map((row) => row.kind),
    ["event", "holding"],
  );
  assert.deepEqual(f.writes[1]!.data, { amountRemaining: 0, updatedBy: "manager" });
  assert.equal(JSON.stringify(f.sources), before);
  assert.equal(f.locks[0], "prepaid");
});

test("identical retry returns original evidence and conflicting retry makes no extra writes", async () => {
  const f = fixture();
  const result = await f.run();
  f.holding.updatedAt = new Date("2026-10-29T00:00:00Z");
  assert.equal(await f.run(), result);
  await assert.rejects(
    f.run({ ...request, reason: "Different approved reason" }),
    /different evidence/,
  );
  assert.equal(f.writes.length, 2);
});

function multiPaymentFixture() {
  const f = fixture();
  f.purchase.sellers = [
    { staffId: "seller", share: 6000 },
    { staffId: "seller-b", share: 4000 },
  ];
  f.line.attribution = { sellers: [...f.purchase.sellers].reverse() };
  const template = f.sources[0]!;
  f.allocations.splice(
    0,
    1,
    {
      ...f.allocations[0]!,
      id: "cash-allocation",
      netCents: 20000n,
      taxCents: 1800n,
      grossCents: 21800n,
    },
    {
      id: "card-allocation",
      netCents: 15000n,
      taxCents: 1350n,
      grossCents: 16350n,
      collection: {
        saleId: "purchase",
        currency: "SGD",
        sourceType: "SALE_PAYMENT",
        sourceId: "card-payment",
      },
    },
    {
      id: "balance-allocation",
      netCents: 15000n,
      taxCents: 1350n,
      grossCents: 16350n,
      collection: {
        saleId: "purchase",
        currency: "SGD",
        sourceType: "OUTSTANDING_PAYMENT",
        sourceId: "later-payment",
      },
    },
  );
  f.sources.splice(
    0,
    1,
    ...f.allocations.map((allocation, index) => ({
      ...template,
      id: `source-${index}`,
      sourceId: allocation.id,
      evidence: {
        ...template.evidence,
        lines: allocatePayrollSplit(`${allocation.netCents / 100n}.0000`, f.purchase.sellers).map(
          (part) => ({
            ...template.evidence.lines[0]!,
            id: `${allocation.id}:${part.staffId}`,
            staffId: part.staffId,
            baseAmount: part.amount,
            businessDate: `2026-10-0${index + 1}`,
            fallbackRatePct: part.staffId === "seller" ? "7" : "9",
          }),
        ),
      },
    })),
  );
  return f;
}

test("three collection sources reconcile split original sellers and preserve payout tender independently", async () => {
  const f = multiPaymentFixture();
  const before = structuredClone(f.sources);
  const detail = await readPayrollValueHoldingDetail(f.tx, "customer", "holding");
  assert.deepEqual(detail.missingEvidence, []);
  assert.equal(detail.collectedNetCents, "50000");
  assert.equal(detail.collectedTaxCents, "4500");
  assert.equal(detail.usedBaseTicks, "833333");
  const result = await f.run({ ...request, payoutMethod: "PAYNOW" });
  const evidence = result.evidence as {
    originalSourceIds: string[];
    payoutMethod: string;
    netCents: string;
    taxCents: string;
    grossCents: string;
    lines: (typeof f.sources)[number]["evidence"]["lines"];
  };
  assert.deepEqual(evidence.originalSourceIds, ["source-0", "source-1", "source-2"]);
  assert.equal(evidence.payoutMethod, "PAYNOW");
  assert.equal(evidence.netCents, "31666");
  assert.equal(evidence.taxCents, "2850");
  assert.equal(evidence.grossCents, "34516");
  assert.deepEqual(
    evidence.lines.map((row) => [row.staffId, row.baseAmount, row.fallbackRatePct, row.units]),
    [
      ["seller", "-189.9960", "7", "0.0000"],
      ["seller-b", "-126.6640", "9", "0.0000"],
    ],
  );
  assert.deepEqual(f.sources, before);
  assert.deepEqual(
    f.writes.map((row) => row.kind),
    ["event", "holding"],
  );
});

test("reordered collections and seller rows cannot change refund economics or rates", async () => {
  const f = multiPaymentFixture();
  const first = (await f.run()).evidence as { lines: unknown[] };
  const reversed = multiPaymentFixture();
  reversed.allocations.reverse();
  reversed.sources.reverse();
  for (const source of reversed.sources) source.evidence.lines.reverse();
  const second = (await reversed.run()).evidence as { lines: unknown[] };
  assert.deepEqual(second.lines, first.lines);
});

for (const missing of ["cash-allocation", "card-allocation", "balance-allocation"])
  test(`missing ${missing} source fails before cancellation`, async () => {
    const f = multiPaymentFixture();
    f.sources.splice(
      f.sources.findIndex((row) => row.sourceId === missing),
      1,
    );
    await assert.rejects(f.run(), /source evidence is incomplete/);
    assert.equal(f.writes.length, 0);
  });

for (const reverse of [false, true])
  test(`conflicting recorded seller rates fail closed regardless of source order (${reverse})`, async () => {
    const f = multiPaymentFixture();
    f.sources[1]!.evidence.lines[0]!.fallbackRatePct = "12";
    if (reverse) f.sources.reverse();
    await assert.rejects(f.run(), /source-time rates/);
    assert.equal(f.writes.length, 0);
  });

test("numerically equal recorded rates do not require matching decimal formatting", async () => {
  const f = multiPaymentFixture();
  f.sources[1]!.evidence.lines[0]!.fallbackRatePct = "7.00";
  assert.equal((await f.run()).sourceType, "VALUE_PACKAGE_REFUND");
});

test("missing recorded rate refuses positive payout before writes", async () => {
  const f = multiPaymentFixture();
  Reflect.deleteProperty(f.sources[1]!.evidence.lines[0]!, "fallbackRatePct");
  await assert.rejects(f.run(), /source-time rates/);
  assert.equal(f.writes.length, 0);
});

test("three partial collections cancel only the remaining original debt", async () => {
  const f = multiPaymentFixture();
  f.allocations[2]!.netCents = 5000n;
  f.allocations[2]!.taxCents = 450n;
  f.allocations[2]!.grossCents = 5450n;
  f.sources[2]!.evidence.lines[0]!.baseAmount = "30.0000";
  f.sources[2]!.evidence.lines[1]!.baseAmount = "20.0000";
  f.setOutstanding({ id: "debt", unpaidAmount: decimal("109") });
  const result = await f.run({ ...request, payoutGrossCents: "23616", payoutMethod: "PAYNOW" });
  const evidence = result.evidence as { cancelledGrossCents: string; originalSourceIds: string[] };
  assert.equal(evidence.cancelledGrossCents, "10900");
  assert.equal(evidence.originalSourceIds.length, 3);
  assert.deepEqual(
    f.writes.map((row) => row.kind),
    ["event", "holding", "outstanding"],
  );
  assert.equal(
    (
      f.writes[2]!.data as { unpaidAmount: { decrement: Prisma.Decimal } }
    ).unpaidAmount.decrement.toFixed(2),
    "109.00",
  );
});

test("multi-payment aggregate overcollection is rejected before writes", async () => {
  const f = multiPaymentFixture();
  f.allocations[2]!.netCents++;
  f.allocations[2]!.grossCents++;
  await assert.rejects(f.run(), /refund economics/);
  assert.equal(f.writes.length, 0);
});

const invalidMultiSourceCases: [string, (f: ReturnType<typeof multiPaymentFixture>) => void][] = [
  [
    "later source wrong sale",
    (f) => {
      f.sources[2]!.saleId = "other-sale";
    },
  ],
  [
    "later source wrong currency",
    (f) => {
      f.sources[2]!.evidence.currency = "USD";
    },
  ],
  [
    "later source not captured",
    (f) => {
      f.sources[2]!.evidence.status = "PENDING";
    },
  ],
  [
    "later source missing split seller",
    (f) => {
      f.sources[2]!.evidence.lines.pop();
    },
  ],
  [
    "later source duplicate split seller",
    (f) => {
      f.sources[2]!.evidence.lines[1]!.staffId = "seller";
    },
  ],
  [
    "later source wrong commission kind",
    (f) => {
      f.sources[2]!.evidence.lines[0]!.commissionType = "VP_SPEND";
    },
  ],
  [
    "later source excluded mode",
    (f) => {
      f.sources[2]!.evidence.lines[0]!.mode = "EXCLUDE";
    },
  ],
  [
    "later source wrong outlet",
    (f) => {
      Reflect.set(f.sources[2]!.evidence.lines[0]!, "outletId", "other-outlet");
    },
  ],
  [
    "later seller split base corrupted",
    (f) => {
      f.sources[2]!.evidence.lines[1]!.baseAmount = "59.9999";
    },
  ],
];
for (const [name, corrupt] of invalidMultiSourceCases)
  test(`multi-payment ${name} fails before writes`, async () => {
    const f = multiPaymentFixture();
    corrupt(f);
    await assert.rejects(f.run(), /source.*evidence/i);
    assert.equal(f.writes.length, 0);
  });

test("fully consumed credit with differing original rates cancels without inventing negative bases", async () => {
  const f = multiPaymentFixture();
  f.holding.amountRemaining = decimal("0");
  f.redemptions[0]!.amount = decimal("600");
  f.sources[1]!.evidence.lines[0]!.fallbackRatePct = "12";
  const result = await f.run({
    ...request,
    adminFeeNetCents: "0",
    payoutGrossCents: "0",
    payoutMethod: "NONE",
  });
  const evidence = result.evidence as {
    lines: unknown[];
    usedBaseTicks: string;
    originalSourceIds: string[];
  };
  assert.deepEqual(evidence.lines, []);
  assert.equal(evidence.usedBaseTicks, "5000000");
  assert.equal(evidence.originalSourceIds.length, 3);
});

test("partial collection cancels only original uncollected debt alongside refund", async () => {
  const f = fixture();
  Object.assign(f.allocations[0]!, { netCents: 25000n, taxCents: 2250n, grossCents: 27250n });
  f.sources[0]!.evidence.lines[0]!.baseAmount = "250.0000";
  f.setOutstanding({ id: "debt", unpaidAmount: decimal("272.50") });
  await f.run({ ...request, payoutGrossCents: "7266" });
  assert.deepEqual(
    f.writes.map((row) => row.kind),
    ["event", "holding", "outstanding"],
  );
  const update = f.writes[2]!.data as { unpaidAmount: { decrement: Prisma.Decimal } };
  assert.equal(update.unpaidAmount.decrement.toFixed(2), "272.50");
});

test("zero collection permits NONE cancellation with no invented commission lines", async () => {
  const f = fixture();
  f.allocations.length = 0;
  f.sources.length = 0;
  f.setOutstanding({ id: "debt", unpaidAmount: decimal("545") });
  const result = await f.run({ ...request, payoutGrossCents: "0", payoutMethod: "NONE" });
  assert.deepEqual((result.evidence as { lines: unknown[] }).lines, []);
  assert.equal(f.writes.length, 3);
});

test("refund refuses unauthorized actor and absent tenant scope before any write", async () => {
  const f = fixture();
  f.setRole("STAFF");
  await assert.rejects(
    f.run(),
    (error: unknown) => error instanceof HttpError && error.statusCode === 403,
  );
  await assert.rejects(
    refundPayrollValuePackageInTransaction(f.tx, "holding", request),
    (error: unknown) => error instanceof HttpError && error.statusCode === 403,
  );
  assert.equal(f.writes.length, 0);
});

test("restoration guard refuses refunded credit and permits untouched holdings", async () => {
  const f = fixture();
  await assertPayrollValuePackageRestorable(f.tx, "holding");
  await f.run();
  await assert.rejects(assertPayrollValuePackageRestorable(f.tx, "holding"), /cannot be restored/);
});

for (const status of ["EARNED", "PAID", "REVERSED"])
  test(`refund respects original source line status ${status}`, async () => {
    const f = fixture();
    f.sources[0]!.evidence.lines[0]!.status = status;
    if (status === "REVERSED") {
      await assert.rejects(f.run(), /source-time evidence/);
      assert.equal(f.writes.length, 0);
    } else {
      const result = await f.run();
      const evidence = result.evidence as { lines: { status: string }[] };
      assert.equal(evidence.lines[0]!.status, "EARNED");
    }
  });

const invalidCases: [string, (f: ReturnType<typeof fixture>) => void][] = [
  [
    "stale holding",
    (f) => {
      f.holding.updatedAt = new Date("2026-10-29T00:00:00Z");
    },
  ],
  [
    "legacy evidence",
    (f) => {
      f.holding.payrollPurchaseSnapshot = null;
    },
  ],
  [
    "wrong source currency",
    (f) => {
      f.sale.collectionCurrency = "USD";
    },
  ],
  [
    "void purchase",
    (f) => {
      f.sale.status = "VOID";
    },
  ],
  [
    "already refunded sale",
    (f) => {
      f.sale.refund = {};
    },
  ],
  [
    "changed seller",
    (f) => {
      f.line.attribution = { sellers: [{ staffId: "other", share: 10000 }] };
    },
  ],
  [
    "changed purchase net",
    (f) => {
      f.line.lineTotal = decimal("546");
    },
  ],
  [
    "changed credit grant",
    (f) => {
      f.holding.amount = decimal("601");
    },
  ],
  [
    "unreconciled credit use",
    (f) => {
      f.redemptions[0]!.amount = decimal("99");
    },
  ],
  [
    "missing collection source",
    (f) => {
      f.sources.length = 0;
    },
  ],
  [
    "wrong source seller",
    (f) => {
      f.sources[0]!.evidence.lines[0]!.staffId = "other";
    },
  ],
  [
    "wrong source base",
    (f) => {
      f.sources[0]!.evidence.lines[0]!.baseAmount = "499.0000";
    },
  ],
  [
    "wrong collection currency",
    (f) => {
      f.allocations[0]!.collection.currency = "USD";
    },
  ],
  [
    "corrupt collection components",
    (f) => {
      f.allocations[0]!.grossCents++;
    },
  ],
];
for (const [name, change] of invalidCases)
  test(`value refund rejects ${name} before any write`, async () => {
    const f = fixture();
    change(f);
    await assert.rejects(f.run());
    assert.equal(f.writes.length, 0);
  });

test("payout mismatch exposes expected amount without persisting cancellation", async () => {
  const f = fixture();
  await assert.rejects(
    f.run({ ...request, payoutGrossCents: "34517" }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === "VALUE_PACKAGE_REFUND_PAYOUT_MISMATCH" &&
      (error.details as { expectedGrossCents: string }).expectedGrossCents === "34516",
  );
  assert.equal(f.writes.length, 0);
});

test("a second key cannot refund an already refunded holding", async () => {
  const f = fixture();
  await f.run();
  await assert.rejects(
    f.run({ ...request, idempotencyKey: "another-refund-key" }),
    /already refunded/,
  );
  assert.equal(f.writes.length, 2);
});

test("missing or insufficient outstanding debt rejects cancellation before writes", async () => {
  for (const balance of [null, decimal("272.49")]) {
    const f = fixture();
    Object.assign(f.allocations[0]!, { netCents: 25000n, taxCents: 2250n, grossCents: 27250n });
    f.sources[0]!.evidence.lines[0]!.baseAmount = "250.0000";
    if (balance) f.setOutstanding({ id: "debt", unpaidAmount: balance });
    await assert.rejects(
      f.run({ ...request, payoutGrossCents: "7266" }),
      /balance no longer reconciles/,
    );
    assert.equal(f.writes.length, 0);
  }
});

test("duplicate collection source identity cannot stand in for missing original evidence", async () => {
  const f = fixture();
  f.allocations.push({
    ...f.allocations[0]!,
    id: "second-allocation",
    netCents: 0n,
    taxCents: 0n,
    grossCents: 0n,
  });
  f.sources.push({ ...f.sources[0]!, id: "duplicate-source" });
  await assert.rejects(f.run(), /source evidence is inconsistent/);
  assert.equal(f.writes.length, 0);
});

test("malformed payout/tender evidence rejects before locks or writes", async () => {
  const f = fixture();
  await assert.rejects(f.run({ ...request, payoutMethod: "NONE" }));
  assert.equal(f.locks.length, 0);
  assert.equal(f.writes.length, 0);
});

test("collection capture refuses a refunded value-package line before looking up a money source", async () => {
  const f = fixture();
  const tx = {
    ...f.tx,
    commissionCollection: { findFirst: async () => null },
    payrollSourceEvent: {
      findMany: async ({ where }: { where: { sourceType: string } }) =>
        where.sourceType === "VALUE_PACKAGE_REFUND" ? [{ sourceId: "holding" }] : [],
    },
    customerValuePackageHolding: { findMany: async () => [{ saleLineId: "line" }] },
  } as unknown as Transaction;
  await assert.rejects(
    runAsTenant(
      "tenant",
      () =>
        captureCollectionEvidence(tx, {
          eventKey: "collection-after-refund",
          sourceType: "OUTSTANDING_PAYMENT",
          sourceId: "payment",
          saleId: "purchase",
          currency: "SGD",
          reason: "Collect outstanding balance",
          allocations: [{ saleLineId: "line", grossCents: "100" }],
        }),
      "manager",
    ),
    /Refunded value-package balances cannot receive new collections/,
  );
  assert.equal(f.writes.length, 0);
});
