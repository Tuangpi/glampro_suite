import assert from "node:assert/strict";
import { test } from "node:test";
import type { PayrollBaseLine } from "@glampro_suite/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { runAsTenant } from "../lib/tenant-context.js";
import {
  captureCollectionEvidence,
  type CaptureCollection,
} from "./commission-collection-evidence.js";
import { readPayrollValueHoldingDetail } from "./payroll-value-holding-detail.js";
import { refundPayrollValuePackageInTransaction } from "./payroll-value-package-refund.js";

type Transaction = Parameters<typeof captureCollectionEvidence>[0];
const decimal = (value: string) => new Prisma.Decimal(value);
const at = new Date("2026-10-01T00:00:00Z");
const refundInput = {
  idempotencyKey: "ingested-value-refund",
  expectedUpdatedAt: "2026-10-28T00:00:00.000Z",
  reason: "Refund unused credit after mixed receipts",
  adminFeeNetCents: "10000",
  payoutGrossCents: "34516",
  payoutMethod: "PAYNOW" as const,
};

// No Prisma client operations: only the services run; every persistence method is local.
function fixture() {
  const sellers = [
    { staffId: "seller-a", share: 6000 },
    { staffId: "seller-b", share: 4000 },
  ];
  const sale = {
    id: "sale",
    customerId: "customer",
    outletId: "outlet",
    status: "COMPLETED",
    collectionCurrency: "SGD",
    refund: null as unknown,
  };
  const line = {
    id: "line",
    itemId: "catalogue",
    itemType: "VALUE_PACKAGE",
    quantity: 1,
    lineTotal: decimal("545"),
    voucherDiscountAmount: decimal("0"),
    taxAmount: decimal("45"),
    attribution: { sellers },
  };
  const holding = {
    id: "holding",
    valuePackageId: "catalogue",
    saleLineId: "line",
    amount: decimal("600"),
    amountRemaining: decimal("500"),
    updatedAt: new Date(refundInput.expectedUpdatedAt),
    payrollPurchaseSnapshot: {
      version: 1,
      saleId: "sale",
      saleLineId: "line",
      currency: "SGD",
      paidNet: "500.00",
      credit: "600.00",
      sellers,
    },
  };
  const payments = [
    {
      id: "cash",
      method: "CASH",
      amount: decimal("218"),
      sessionId: null as string | null,
      createdAt: at,
    },
    {
      id: "card",
      method: "CARD",
      amount: decimal("163.50"),
      sessionId: null as string | null,
      createdAt: at,
    },
  ];
  const outstandingPayment = {
    id: "later",
    customerId: "customer",
    paidAmount: decimal("163.50"),
    paidAt: at,
    outstanding: { tenantId: "tenant", saleId: "sale", customerId: "customer" },
  };
  type Collection = {
    id: string;
    eventKey: string;
    eventHash: string;
    sourceType: string;
    sourceId: string;
    saleId: string;
    currency: string;
    grossCents: bigint;
    occurredAt: Date;
    reason: string;
  };
  type Allocation = {
    id: string;
    collectionId: string;
    saleLineId: string;
    netCents: bigint;
    taxCents: bigint;
    grossCents: bigint;
    evidence: unknown;
  };
  type Event = {
    id: string;
    sourceKey: string;
    sourceType: string;
    sourceId: string;
    saleId: string;
    evidence: { status: string; currency: string; lines: PayrollBaseLine[] } & Record<
      string,
      unknown
    >;
  };
  const collections: Collection[] = [];
  const allocations: Allocation[] = [];
  const events: Event[] = [];
  const writes: string[] = [];
  const sourceQueries: unknown[] = [];
  const rules = sellers.map((person) => ({
    id: `rate-${person.staffId}`,
    staffId: person.staffId,
    itemKind: "STORED_CREDIT_SALE",
    scope: "STAFF",
    targetId: null,
    rate: decimal(person.staffId === "seller-a" ? "7" : "9"),
    effectiveAt: at,
    createdAt: at,
  }));
  const collectionWithAllocations = (id: string) => ({
    ...collections.find((row) => row.id === id)!,
    allocations: allocations.filter((row) => row.collectionId === id),
  });
  const tx = {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    user: {
      findFirst: async () => ({
        id: "manager",
        globalRole: "MANAGER",
        commissionRate: decimal("0"),
      }),
    },
    sale: { findFirst: async () => sale, findFirstOrThrow: async () => sale },
    saleLine: {
      findMany: async () => [line],
      findFirst: async () => line,
      findFirstOrThrow: async () => line,
    },
    salePayment: {
      findFirst: async ({ where }: { where: { id: string; saleId: string } }) => {
        sourceQueries.push(where);
        return where.saleId === sale.id
          ? (payments.find((row) => row.id === where.id) ?? null)
          : null;
      },
    },
    customerOutstandingPayment: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; saleId: string; customerId: string };
      }) => {
        sourceQueries.push(where);
        return where.id === outstandingPayment.id &&
          where.saleId === sale.id &&
          where.customerId === outstandingPayment.customerId
          ? outstandingPayment
          : null;
      },
    },
    commissionCollection: {
      findFirst: async ({
        where,
      }: {
        where: {
          OR?: { eventKey?: string; sourceType?: string; sourceId?: string }[];
          currency?: { not: string };
        };
      }) => {
        const found = where.OR
          ? collections.find((row) =>
              where.OR!.some((part) =>
                part.eventKey
                  ? row.eventKey === part.eventKey
                  : row.sourceType === part.sourceType && row.sourceId === part.sourceId,
              ),
            )
          : collections.find((row) => row.currency !== where.currency?.not);
        return found ? collectionWithAllocations(found.id) : null;
      },
      create: async ({ data }: { data: Omit<Collection, "id"> }) => {
        const row = { ...data, id: `collection-${collections.length}` };
        collections.push(row);
        writes.push("collection");
        return row;
      },
      findFirstOrThrow: async ({ where }: { where: { id: string } }) =>
        collectionWithAllocations(where.id),
    },
    commissionCollectionAllocation: {
      groupBy: async () =>
        allocations.length
          ? [
              {
                saleLineId: "line",
                _sum: { grossCents: allocations.reduce((sum, row) => sum + row.grossCents, 0n) },
              },
            ]
          : [],
      create: async ({ data }: { data: Omit<Allocation, "id"> }) => {
        const row = { ...data, id: `allocation-${allocations.length}` };
        allocations.push(row);
        writes.push("allocation");
        return row;
      },
      findMany: async ({ where }: { where: { collectionId?: { not: string } } }) =>
        allocations
          .filter((row) => !where.collectionId || row.collectionId !== where.collectionId.not)
          .map((row) => ({
            ...row,
            collection: collections.find((collection) => collection.id === row.collectionId)!,
          })),
    },
    payrollSourceEvent: {
      findFirst: async ({
        where,
      }: {
        where: { sourceKey?: string; sourceType?: string; sourceId?: string };
      }) =>
        events.find((row) =>
          where.sourceKey
            ? row.sourceKey === where.sourceKey
            : row.sourceType === where.sourceType && row.sourceId === where.sourceId,
        ) ?? null,
      findMany: async ({ where }: { where: { sourceType: string; sourceId?: { in: string[] } } }) =>
        events.filter(
          (row) =>
            row.sourceType === where.sourceType &&
            (!where.sourceId || where.sourceId.in.includes(row.sourceId)),
        ),
      create: async ({ data }: { data: Omit<Event, "id"> }) => {
        const row = { ...data, id: `event-${events.length}` };
        events.push(row);
        writes.push("event");
        return row;
      },
    },
    commissionRule: { findMany: async () => rules },
    tenant: { findUniqueOrThrow: async () => ({ timeZone: "Asia/Singapore" }) },
    customerValuePackageHolding: {
      findFirst: async () => holding,
      findMany: async () => [{ saleLineId: holding.saleLineId }],
      update: async () => {
        writes.push("holding");
        return holding;
      },
    },
    customerRedemption: { findMany: async () => [{ amount: decimal("100") }] },
    customerOutstanding: { findFirst: async () => ({ id: "debt", unpaidAmount: decimal("0") }) },
  };
  const transaction = tx as unknown as Transaction;
  const input = (
    sourceId: string,
    grossCents: string,
    sourceType: CaptureCollection["sourceType"] = "SALE_PAYMENT",
  ): CaptureCollection => ({
    eventKey: `receipt-${sourceId}`,
    sourceType,
    sourceId,
    saleId: "sale",
    currency: "SGD",
    reason: "Capture original settled collection",
    allocations: [{ saleLineId: "line", grossCents }],
  });
  const run = (value: CaptureCollection) =>
    runAsTenant("tenant", () => captureCollectionEvidence(transaction, value), "manager");
  return {
    tx: transaction,
    sale,
    payments,
    outstandingPayment,
    collections,
    allocations,
    events,
    writes,
    sourceQueries,
    input,
    run,
  };
}

test("cash, card and later customer payment generate exact refund-ready original sources", async () => {
  const f = fixture();
  await f.run(f.input("cash", "21800"));
  await f.run(f.input("card", "16350"));
  await f.run(f.input("later", "16350", "OUTSTANDING_PAYMENT"));
  assert.deepEqual(f.sourceQueries, [
    { id: "cash", saleId: "sale" },
    { id: "card", saleId: "sale" },
    { id: "later", saleId: "sale", customerId: "customer" },
  ]);
  assert.deepEqual(
    f.allocations.map((row) => [row.netCents, row.taxCents, row.grossCents]),
    [
      [20000n, 1800n, 21800n],
      [15000n, 1350n, 16350n],
      [15000n, 1350n, 16350n],
    ],
  );
  assert.deepEqual(
    f.events.map((row) => row.evidence.status),
    ["CAPTURED", "CAPTURED", "CAPTURED"],
  );
  assert.deepEqual(
    f.events.map((row) => row.evidence.lines.map((line) => line.units)),
    [
      ["0.6000", "0.4000"],
      ["0.0000", "0.0000"],
      ["0.0000", "0.0000"],
    ],
  );
  const originalSources = structuredClone(f.events);
  const detail = await readPayrollValueHoldingDetail(f.tx, "customer", "holding");
  assert.deepEqual(detail.missingEvidence, []);
  assert.equal(detail.collectedNetCents, "50000");
  assert.equal(detail.collectedTaxCents, "4500");
  const refund = await runAsTenant(
    "tenant",
    () => refundPayrollValuePackageInTransaction(f.tx, "holding", refundInput),
    "manager",
  );
  const evidence = refund.evidence as {
    originalSourceIds: string[];
    grossCents: string;
    payoutMethod: string;
    lines: PayrollBaseLine[];
  };
  assert.equal(evidence.grossCents, "34516");
  assert.equal(evidence.payoutMethod, "PAYNOW");
  assert.deepEqual(
    evidence.originalSourceIds,
    originalSources.map((row) => row.id),
  );
  assert.deepEqual(
    evidence.lines.map((row) => [row.staffId, row.baseAmount, row.fallbackRatePct]),
    [
      ["seller-a", "-189.9960", "7"],
      ["seller-b", "-126.6640", "9"],
    ],
  );
  assert.deepEqual(f.events.slice(0, 3), originalSources);
});

for (const method of ["PACKAGE", "PREPAID_CREDIT"])
  test(`${method} is not a cash collection source`, async () => {
    const f = fixture();
    f.payments[0]!.method = method;
    await assert.rejects(f.run(f.input("cash", "21800")), /non-credit recorded payment/);
    assert.deepEqual(f.writes, []);
  });

test("gateway session payment cannot be captured as settled receipt", async () => {
  const f = fixture();
  f.payments[1]!.sessionId = "unsettled-gateway-session";
  await assert.rejects(f.run(f.input("card", "16350")), /unsettled gateway/);
  assert.deepEqual(f.writes, []);
});
test("missing recorded payment cannot create collection evidence", async () => {
  const f = fixture();
  await assert.rejects(f.run(f.input("absent", "21800")), /non-credit recorded payment/);
  assert.deepEqual(f.writes, []);
});
test("explicit allocation must equal authoritative payment, not client amount", async () => {
  const f = fixture();
  await assert.rejects(f.run(f.input("cash", "21799")), /equal the settled receipt/);
  assert.deepEqual(f.writes, []);
});
test("zero payment cannot create a collection", async () => {
  const f = fixture();
  f.payments[0]!.amount = decimal("0");
  await assert.rejects(f.run(f.input("cash", "21800")), /positive settled source/);
  assert.deepEqual(f.writes, []);
});
for (const field of ["tenantId", "saleId", "customerId"] as const)
  test(`outstanding payment with mismatched parent ${field} is rejected`, async () => {
    const f = fixture();
    f.outstandingPayment.outstanding[field] = "foreign";
    await assert.rejects(
      f.run(f.input("later", "16350", "OUTSTANDING_PAYMENT")),
      /original sale and customer/,
    );
    assert.deepEqual(f.writes, []);
  });
test("other customer payment is not selected by source id alone", async () => {
  const f = fixture();
  f.outstandingPayment.customerId = "other-customer";
  await assert.rejects(
    f.run(f.input("later", "16350", "OUTSTANDING_PAYMENT")),
    /original sale and customer/,
  );
  assert.deepEqual(f.sourceQueries, [{ id: "later", saleId: "sale", customerId: "customer" }]);
  assert.deepEqual(f.writes, []);
});
test("identical receipt retry does not recapture sale units or source lines", async () => {
  const f = fixture();
  const first = await f.run(f.input("cash", "21800"));
  const writes = [...f.writes];
  const second = await f.run(f.input("cash", "21800"));
  assert.deepEqual(second, first);
  assert.deepEqual(f.writes, writes);
  assert.equal(f.events.length, 1);
  assert.equal(f.sourceQueries.length, 1);
});
test("conflicting receipt retry cannot substitute a different allocation", async () => {
  const f = fixture();
  await f.run(f.input("cash", "21800"));
  const writes = [...f.writes];
  await assert.rejects(f.run(f.input("cash", "21799")), /different evidence/);
  assert.deepEqual(f.writes, writes);
});

test("captured collections drive post-refund collection refusal before reading a new payment", async () => {
  const f = fixture();
  await f.run(f.input("cash", "21800"));
  await f.run(f.input("card", "16350"));
  await f.run(f.input("later", "16350", "OUTSTANDING_PAYMENT"));
  await runAsTenant(
    "tenant",
    () => refundPayrollValuePackageInTransaction(f.tx, "holding", refundInput),
    "manager",
  );
  const writes = [...f.writes];
  const queries = [...f.sourceQueries];
  await assert.rejects(
    f.run(f.input("new-after-refund", "100")),
    /Refunded value-package balances/,
  );
  assert.deepEqual(f.writes, writes);
  assert.deepEqual(f.sourceQueries, queries);
});

test("cumulative collection GST consumes residual cents exactly across unequal receipts", async () => {
  const f = fixture();
  f.payments[0]!.amount = decimal("0.06");
  f.payments[1]!.amount = decimal("0.06");
  f.outstandingPayment.paidAmount = decimal("544.88");
  await f.run(f.input("cash", "6"));
  await f.run(f.input("card", "6"));
  await f.run(f.input("later", "54488", "OUTSTANDING_PAYMENT"));
  assert.deepEqual(
    f.allocations.map((row) => [row.netCents, row.taxCents]),
    [
      [6n, 0n],
      [5n, 1n],
      [49989n, 4499n],
    ],
  );
  const result = await runAsTenant(
    "tenant",
    () => refundPayrollValuePackageInTransaction(f.tx, "holding", refundInput),
    "manager",
  );
  assert.equal((result.evidence as { grossCents: string }).grossCents, "34516");
});

test("void purchase refuses collection before looking up receipt", async () => {
  const f = fixture();
  f.sale.status = "VOID";
  await assert.rejects(f.run(f.input("cash", "21800")), /completed unrefunded sale/);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.sourceQueries, []);
});
test("refunded purchase refuses collection before looking up receipt", async () => {
  const f = fixture();
  f.sale.refund = { id: "sale-refund" };
  await assert.rejects(f.run(f.input("cash", "21800")), /completed unrefunded sale/);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.sourceQueries, []);
});
test("client currency cannot replace confirmed sale currency", async () => {
  const f = fixture();
  await assert.rejects(
    f.run({ ...f.input("cash", "21800"), currency: "USD" }),
    /confirmed sale currency/,
  );
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.sourceQueries, []);
});
test("another collection currency refuses new source without extra writes", async () => {
  const f = fixture();
  await f.run(f.input("cash", "21800"));
  f.collections[0]!.currency = "USD";
  const writes = [...f.writes];
  await assert.rejects(f.run(f.input("card", "16350")), /original collection evidence/);
  assert.deepEqual(f.writes, writes);
});
test("unrelated sale line cannot receive a payment allocation", async () => {
  const f = fixture();
  await assert.rejects(
    f.run({
      ...f.input("cash", "21800"),
      allocations: [{ saleLineId: "foreign-line", grossCents: "21800" }],
    }),
    /distinct lines from this sale/,
  );
  assert.deepEqual(f.writes, []);
});
test("new recorded receipt cannot overcollect already fully paid line", async () => {
  const f = fixture();
  await f.run(f.input("cash", "21800"));
  await f.run(f.input("card", "16350"));
  await f.run(f.input("later", "16350", "OUTSTANDING_PAYMENT"));
  f.payments.push({ ...f.payments[0]!, id: "extra", amount: decimal("1") });
  const writes = [...f.writes];
  await assert.rejects(f.run(f.input("extra", "100")), /exceeds the line's contracted gross/);
  assert.deepEqual(f.writes, writes);
});
test("collection capture requires authenticated tenant scope before persistence", async () => {
  const f = fixture();
  await assert.rejects(
    captureCollectionEvidence(f.tx, f.input("cash", "21800")),
    /authenticated salon actor/,
  );
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.sourceQueries, []);
});
