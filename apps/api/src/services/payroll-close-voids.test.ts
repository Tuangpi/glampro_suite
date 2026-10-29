import assert from "node:assert/strict";
import { test } from "node:test";
import type { PayrollCashAttribution } from "./payroll-close-cash.js";
import { resolvePayrollCloseCash } from "./payroll-close-cash.js";
import type { PayrollCloseCollectionRecords } from "./payroll-close-collections.js";
import type { PayrollCloseReversalRecords } from "./payroll-close-reversals.js";
import { payrollInputHash } from "./payroll-close-state.js";

function fixture(
  type: "SALE_LINE" | "COLLECTION" = "COLLECTION",
): PayrollCloseCollectionRecords &
  PayrollCloseReversalRecords & { cashAttributions: PayrollCashAttribution[] } {
  const at = new Date("2026-09-15T00:00:00Z");
  const before = new Date("2026-08-15T00:00:00Z");
  const line = {
    id: "base",
    staffId: "departed",
    outletId: "branch",
    commissionType: type === "COLLECTION" ? "PKG_SALE" : "SVC",
    baseAmount: "100.0000",
    units: "1.0000",
    businessDate: "2026-08-15",
    status: "EARNED",
    mode: "FOLLOW_PLAN",
    fallbackRatePct: "10",
  };
  const capture = {
    version: 1,
    status: "CAPTURED",
    postingStatus: "PENDING_RELEASE",
    currency: "SGD",
  };
  return {
    tenantId: "salon",
    periodKey: "2026-09",
    timeZone: "Asia/Singapore",
    operations: [],
    collections: [],
    cashAttributions: [],
    lineageEvents: [
      {
        id: "original",
        tenantId: "salon",
        sourceKey: "original",
        sourceType: type,
        sourceId: "allocation",
        saleId: "sale",
        outletId: "branch",
        occurredAt: before,
        createdAt: before,
        evidence: { ...capture, lines: [line] },
      },
    ],
    events: [
      {
        id: "reverse",
        tenantId: "salon",
        sourceKey: "reverse",
        sourceType: "REVERSAL",
        sourceId: "original",
        saleId: "sale",
        outletId: "branch",
        occurredAt: at,
        createdAt: at,
        evidence: {
          ...capture,
          originalEventId: "original",
          lines: [
            {
              ...line,
              id: "reverse-base",
              baseAmount: "-100.0000",
              units: "-1.0000",
              businessDate: "2026-09-15",
            },
          ],
        },
      },
    ],
    noCashSaleVoids: [
      {
        id: "void",
        tenantId: "salon",
        saleId: "sale",
        outletId: "branch",
        occurredAt: at,
        currency: "SGD",
        cashDisposition: "NO_MOVEMENT",
        netCents: "0",
        taxCents: "0",
        grossCents: "0",
        evidence: { voidRevision: 1, cashDispositionRevision: 1 },
        reversals: [
          {
            eventId: "reverse",
            originalEventId: "original",
            originalSourceId: "allocation",
            originalSourceType: type,
          },
        ],
      },
    ],
  };
}

test("explicit no-movement sale-line and collection voids do not invent refund cash", () => {
  for (const type of ["SALE_LINE", "COLLECTION"] as const) {
    const result = resolvePayrollCloseCash(fixture(type));
    assert.equal(result.status, "CASH_EVIDENCE_READY", JSON.stringify(result.blockers));
    assert.equal(result.earningsActive, false);
    assert.equal(result.cash!.salonCash, "0.0000");
    assert.equal(result.cash!.reversals!.voids!.voids.length, 1);
  }
});

test("same-month collected cash remains when void independently records no money movement", () => {
  const input = fixture();
  const original = input.lineageEvents.shift()!;
  original.occurredAt = new Date("2026-09-10T00:00:00Z");
  original.createdAt = original.occurredAt;
  (original.evidence as { lines: { businessDate: string }[] }).lines[0].businessDate = "2026-09-10";
  input.events.push(original);
  const payment = {
    tenantId: "salon",
    sourceType: "SALE_PAYMENT" as const,
    sourceId: "payment",
    saleId: "sale",
    currency: "SGD" as const,
    grossCents: "10900",
    occurredAt: original.occurredAt,
  };
  input.operations = [payment];
  input.collections = [
    {
      ...payment,
      id: "collection",
      allocations: [
        {
          id: "allocation",
          tenantId: "salon",
          collectionId: "collection",
          saleLineId: "package-line",
          itemType: "PACKAGE",
          netCents: "10000",
          taxCents: "900",
          grossCents: "10900",
        },
      ],
    },
  ];
  input.cashAttributions = [
    {
      tenantId: "salon",
      allocationId: "allocation",
      saleLineId: "package-line",
      outletId: "branch",
      shares: [{ staffId: "departed", share: 10000 }],
      evidence: { revision: 1 },
    },
  ];
  const result = resolvePayrollCloseCash(input);
  assert.equal(result.status, "CASH_EVIDENCE_READY", JSON.stringify(result.blockers));
  assert.equal(result.cash!.salonCash, "100.0000");
  assert.deepEqual(result.cash!.staff, [{ staffId: "departed", collection: "100.0000" }]);
});

test("void status cannot substitute for independent cash disposition evidence", () => {
  const input = fixture();
  delete input.noCashSaleVoids;
  assert.equal(resolvePayrollCloseCash(input).cash, null);
});

test("void identity, original operation, timing and month must reconcile", () => {
  for (const change of [
    "sale",
    "outlet",
    "month",
    "late",
    "original",
    "operation",
    "type",
    "reverse",
  ]) {
    const input = fixture();
    const row = input.noCashSaleVoids![0];
    if (change === "sale") row.saleId = "other";
    if (change === "outlet") row.outletId = "other";
    if (change === "month") row.occurredAt = new Date("2026-08-31T15:59:59Z");
    if (change === "late") row.occurredAt = new Date("2026-09-16");
    if (change === "original") row.reversals[0].originalEventId = "other";
    if (change === "operation") row.reversals[0].originalSourceId = "other";
    if (change === "type") row.reversals[0].originalSourceType = "SALE_LINE";
    if (change === "reverse") row.reversals[0].eventId = "other";
    assert.equal(resolvePayrollCloseCash(input).cash, null, change);
  }
});

test("foreign and reused void identities are rejected", () => {
  const foreign = fixture();
  foreign.noCashSaleVoids![0].tenantId = "other";
  assert.throws(() => resolvePayrollCloseCash(foreign), /another salon/);
  const duplicate = fixture();
  duplicate.noCashSaleVoids!.push({
    ...structuredClone(duplicate.noCashSaleVoids![0]),
    id: "other",
  });
  assert.throws(() => resolvePayrollCloseCash(duplicate), /Duplicate/);
});

test("incomplete source inventory and non-exact reversal cannot be accepted as voids", () => {
  for (const change of ["missing", "extra", "amount"]) {
    const input = fixture();
    if (change === "missing") input.lineageEvents = [];
    if (change === "extra")
      input.lineageEvents.push({
        ...structuredClone(input.lineageEvents[0]),
        id: "extra",
        sourceKey: "extra",
        sourceId: "extra",
      });
    if (change === "amount")
      (input.events[0].evidence as { lines: { baseAmount: string }[] }).lines[0].baseAmount = "-99";
    assert.equal(resolvePayrollCloseCash(input).cash, null, change);
  }
});

test("nonzero or uncertain money and non-JSON evidence are refused", () => {
  for (const patch of [
    { grossCents: "1" },
    { cashDisposition: "UNKNOWN" },
    { evidence: new Date() },
    { currency: "USD" },
  ]) {
    const input = fixture();
    Object.assign(input.noCashSaleVoids![0], patch);
    assert.throws(() => resolvePayrollCloseCash(input));
  }
});

test("void cash-disposition revisions are detached and frozen for stale approval", () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = resolvePayrollCloseCash(input);
  assert.deepEqual(input, before);
  const hash = payrollInputHash(result);
  input.noCashSaleVoids![0].evidence = { voidRevision: 1, cashDispositionRevision: 2 };
  assert.notEqual(payrollInputHash(resolvePayrollCloseCash(input)), hash);
  result.cash!.reversals!.voids!.voids[0].saleId = "changed";
  assert.equal(input.noCashSaleVoids![0].saleId, "sale");
});

test("a sale cannot assert both no-movement void and package refund", () => {
  const input = fixture();
  input.events.push({
    ...structuredClone(input.events[0]),
    id: "refund",
    sourceKey: "refund",
    sourceType: "PACKAGE_REFUND",
  });
  const result = resolvePayrollCloseCash(input);
  assert.equal(result.cash, null);
  assert.ok(result.blockers.some((row) => row.code === "VOID_REFUND_CASH_EFFECT_CONFLICT"));
});

function returnedFixture(valuePackage = false) {
  const input = fixture();
  const originalVoid = input.noCashSaleVoids![0];
  input.noCashSaleVoids = [];
  input.returnedCashSaleVoids = [
    {
      ...originalVoid,
      cashDisposition: "RETURNED",
      netCents: "10000",
      taxCents: "900",
      grossCents: "10900",
      payouts: [
        { id: "cash-payout", method: "CASH", grossCents: "5000" },
        { id: "card-payout", method: "CARD", grossCents: "5900" },
      ],
      allocations: [
        {
          id: "allocation",
          originalEventId: "original",
          saleLineId: "package-line",
          itemType: valuePackage ? "VALUE_PACKAGE" : "PACKAGE",
          netCents: "10000",
          taxCents: "900",
          grossCents: "10900",
          shares: [{ staffId: "departed", share: 10000 }],
          evidence: { originalAllocationRevision: 1 },
        },
      ],
    },
  ];
  if (valuePackage) {
    for (const event of [...input.events, ...input.lineageEvents])
      (event.evidence as { lines: { commissionType: string }[] }).lines[0].commissionType =
        "VP_SALE";
  }
  return input;
}

test("settled returned package/value-package void cash subtracts net once across tenders", () => {
  for (const valuePackage of [false, true]) {
    const result = resolvePayrollCloseCash(returnedFixture(valuePackage));
    assert.equal(result.status, "CASH_EVIDENCE_READY", JSON.stringify(result.blockers));
    assert.equal(result.earningsActive, false);
    assert.equal(result.cash!.salonCash, "-100.0000");
    assert.deepEqual(result.cash!.staff, [{ staffId: "departed", collection: "-100.0000" }]);
    assert.deepEqual(result.cash!.outlets, [{ outletId: "branch", collection: "-100.0000" }]);
  }
});

test("returned void requires reconciled payout totals, GST and original collection amounts", () => {
  for (const change of [
    "net",
    "tax",
    "gross",
    "payout",
    "zero",
    "amount",
    "id",
    "original",
    "seller",
    "type",
  ]) {
    const input = returnedFixture();
    const row = input.returnedCashSaleVoids![0];
    if (change === "net") row.netCents = "9999";
    if (change === "tax") row.taxCents = "899";
    if (change === "gross") row.grossCents = "10899";
    if (change === "payout") row.payouts[0].grossCents = "4999";
    if (change === "zero") row.payouts[0].grossCents = "0";
    if (change === "amount") row.allocations[0].netCents = "9999";
    if (change === "id") row.allocations[0].id = "other";
    if (change === "original") row.allocations[0].originalEventId = "other";
    if (change === "seller") row.allocations[0].shares[0].staffId = "cashier";
    if (change === "type") row.allocations[0].itemType = "VALUE_PACKAGE";
    assert.equal(resolvePayrollCloseCash(input).cash, null, change);
  }
});

test("partial returned collection voids fail closed instead of silently clipping payout cash", () => {
  const input = returnedFixture();
  const row = input.returnedCashSaleVoids![0];
  Object.assign(row, { netCents: "5000", taxCents: "450", grossCents: "5450" });
  Object.assign(row.allocations[0], { netCents: "5000", taxCents: "450", grossCents: "5450" });
  row.payouts = [{ id: "payout", method: "CASH", grossCents: "5450" }];
  assert.equal(resolvePayrollCloseCash(input).cash, null);
});

test("returned cash and no-movement dispositions cannot claim the same sale", () => {
  const input = returnedFixture();
  input.noCashSaleVoids = fixture().noCashSaleVoids;
  assert.throws(() => resolvePayrollCloseCash(input), /Duplicate/);
});

test("duplicate payout/collection evidence and foreign returned voids are rejected", () => {
  for (const change of ["tenant", "payout", "allocation"]) {
    const input = returnedFixture();
    const row = input.returnedCashSaleVoids![0];
    if (change === "tenant") row.tenantId = "other";
    if (change === "payout") row.payouts.push(structuredClone(row.payouts[0]));
    if (change === "allocation") row.allocations.push(structuredClone(row.allocations[0]));
    assert.throws(() => resolvePayrollCloseCash(input), /another salon|Duplicate/);
  }
});

test("returned cash needs a known outlet and valid exact source reversal", () => {
  const input = returnedFixture();
  input.returnedCashSaleVoids![0].outletId = null;
  for (const event of [...input.events, ...input.lineageEvents]) {
    event.outletId = null;
    (event.evidence as { lines: { outletId: string | null }[] }).lines[0].outletId = null;
  }
  assert.equal(resolvePayrollCloseCash(input).cash, null);
  const broken = returnedFixture();
  (broken.events[0].evidence as { lines: { baseAmount: string }[] }).lines[0].baseAmount = "-99";
  assert.equal(resolvePayrollCloseCash(broken).cash, null);
});

test("returned cash evidence is detached, order independent and revision sensitive", () => {
  const input = returnedFixture();
  const before = structuredClone(input);
  const result = resolvePayrollCloseCash(input);
  assert.deepEqual(input, before);
  const hash = payrollInputHash(result);
  input.returnedCashSaleVoids![0].payouts.reverse();
  assert.equal(payrollInputHash(resolvePayrollCloseCash(input)), hash);
  input.returnedCashSaleVoids![0].allocations[0].evidence = { originalAllocationRevision: 2 };
  assert.notEqual(payrollInputHash(resolvePayrollCloseCash(input)), hash);
  result.cash!.reversals!.voids!.returnedCash[0].staff[0].staffId = "changed";
  assert.equal(input.returnedCashSaleVoids![0].allocations[0].shares[0].staffId, "departed");
});

for (const itemType of ["PACKAGE", "SERVICE", "PRODUCT"] as const) {
  test(`same-month ${itemType} collection and fully returned void cash reconcile to zero`, () => {
    const input = itemType === "PACKAGE" ? returnedFixture() : ordinaryReturnedFixture(itemType);
    const original = input.lineageEvents.shift()!;
    original.occurredAt = new Date("2026-09-10T00:00:00Z");
    original.createdAt = original.occurredAt;
    (original.evidence as { lines: { businessDate: string }[] }).lines[0].businessDate =
      "2026-09-10";
    input.events.push(original);
    const payment = {
      tenantId: "salon",
      sourceType: "SALE_PAYMENT" as const,
      sourceId: "payment",
      saleId: "sale",
      currency: "SGD" as const,
      grossCents: "10900",
      occurredAt: original.occurredAt,
    };
    input.operations = [payment];
    input.collections = [
      {
        ...payment,
        id: "collection",
        allocations: [
          {
            id: "allocation",
            tenantId: "salon",
            collectionId: "collection",
            saleLineId: input.returnedCashSaleVoids![0].allocations[0].saleLineId,
            itemType,
            netCents: "10000",
            taxCents: "900",
            grossCents: "10900",
          },
        ],
      },
    ];
    input.cashAttributions = [
      {
        tenantId: "salon",
        allocationId: "allocation",
        saleLineId: input.returnedCashSaleVoids![0].allocations[0].saleLineId,
        outletId: "branch",
        shares: [{ staffId: "departed", share: 10000 }],
        evidence: { revision: 1 },
      },
    ];
    const result = resolvePayrollCloseCash(input);
    assert.equal(result.status, "CASH_EVIDENCE_READY", JSON.stringify(result.blockers));
    assert.equal(result.cash!.salonCash, "0.0000");
    assert.deepEqual(result.cash!.staff, [{ staffId: "departed", collection: "0.0000" }]);
    for (const change of ["sale", "type", "outlet", "seller"]) {
      const broken = structuredClone(input);
      if (change === "sale") {
        broken.collections[0].saleId = "another-sale";
        broken.operations[0].saleId = "another-sale";
      }
      if (change === "type") broken.collections[0].allocations[0].itemType = "OTHER";
      if (change === "outlet") broken.cashAttributions[0].outletId = "another-outlet";
      if (change === "seller") broken.cashAttributions[0].shares[0].staffId = "cashier";
      assert.equal(resolvePayrollCloseCash(broken).cash, null, change);
    }
    input.returnedCashSaleVoids![0].allocations[0].saleLineId = "another-package";
    assert.equal(resolvePayrollCloseCash(input).cash, null);
  });
}

function ordinaryReturnedFixture(itemType: "SERVICE" | "PRODUCT" = "SERVICE") {
  const input = returnedFixture();
  const allocation = input.returnedCashSaleVoids![0].allocations[0];
  allocation.itemType = itemType;
  allocation.saleLineId = "ordinary-line";
  input.lineageEvents[0].sourceType = "SALE_LINE";
  input.lineageEvents[0].sourceId = allocation.saleLineId;
  const reversal = input.returnedCashSaleVoids![0].reversals[0];
  reversal.originalSourceType = "SALE_LINE";
  reversal.originalSourceId = allocation.saleLineId;
  for (const event of [...input.events, ...input.lineageEvents])
    (event.evidence as { lines: { commissionType: string }[] }).lines[0].commissionType =
      itemType === "SERVICE" ? "SVC" : "PRD";
  return input;
}

test("full ordinary returned voids use independent cash evidence and retain departed staff", () => {
  for (const type of ["SERVICE", "PRODUCT"] as const) {
    const input = ordinaryReturnedFixture(type);
    const before = structuredClone(input);
    const result = resolvePayrollCloseCash(input);
    assert.equal(result.status, "CASH_EVIDENCE_READY", JSON.stringify(result.blockers));
    assert.equal(result.cash!.salonCash, "-100.0000");
    assert.deepEqual(result.cash!.staff, [{ staffId: "departed", collection: "-100.0000" }]);
    assert.deepEqual(result.cash!.outlets, [{ outletId: "branch", collection: "-100.0000" }]);
    assert.deepEqual(input, before);
    input.returnedCashSaleVoids![0].payouts[0].id = "revised-settlement";
    assert.notEqual(payrollInputHash(resolvePayrollCloseCash(input)), payrollInputHash(result));
  }
});

test("ordinary returned voids reject partial cash, wrong line, type and historical seller", () => {
  for (const change of ["partial", "line", "type", "seller", "missing", "reversal"]) {
    const input = ordinaryReturnedFixture();
    const row = input.returnedCashSaleVoids![0];
    if (change === "partial") {
      Object.assign(row, { netCents: "5000", taxCents: "450", grossCents: "5450" });
      Object.assign(row.allocations[0], { netCents: "5000", taxCents: "450", grossCents: "5450" });
      row.payouts = [{ id: "partial", method: "CASH", grossCents: "5450" }];
    }
    if (change === "line") row.allocations[0].saleLineId = "another-line";
    if (change === "type") row.allocations[0].itemType = "PRODUCT";
    if (change === "seller") row.allocations[0].shares[0].staffId = "cashier";
    if (change === "missing") input.lineageEvents = [];
    if (change === "reversal")
      (input.events[0].evidence as { lines: { baseAmount: string }[] }).lines[0].baseAmount = "-99";
    assert.equal(resolvePayrollCloseCash(input).cash, null, change);
  }
});

test("ordinary returned voids require complete original sale-line inventory", () => {
  const input = ordinaryReturnedFixture();
  const extra = structuredClone(input.lineageEvents[0]);
  Object.assign(extra, { id: "extra", sourceKey: "extra", sourceId: "extra-line" });
  input.lineageEvents.push(extra);
  const result = resolvePayrollCloseCash(input);
  assert.equal(result.cash, null);
  assert.ok(result.blockers.some((row) => row.code === "VOID_SOURCE_INVENTORY_MISMATCH"));
});

test("full service/product sale void returns reconcile every line exactly once", () => {
  const input = ordinaryReturnedFixture();
  const product = ordinaryReturnedFixture("PRODUCT");
  const original = product.lineageEvents[0];
  Object.assign(original, {
    id: "product-original",
    sourceKey: "product-original",
    sourceId: "product-line",
  });
  const reverse = product.events[0];
  Object.assign(reverse, {
    id: "product-reverse",
    sourceKey: "product-reverse",
    sourceId: original.id,
  });
  (reverse.evidence as { originalEventId: string }).originalEventId = original.id;
  for (const event of [original, reverse])
    (event.evidence as { lines: { id: string }[] }).lines[0].id = `${event.id}-base`;
  input.lineageEvents.push(original);
  input.events.push(reverse);
  const row = input.returnedCashSaleVoids![0];
  row.reversals.push({
    eventId: reverse.id,
    originalEventId: original.id,
    originalSourceId: original.sourceId,
    originalSourceType: "SALE_LINE",
  });
  row.allocations.push({
    ...product.returnedCashSaleVoids![0].allocations[0],
    id: "product-allocation",
    originalEventId: original.id,
    saleLineId: original.sourceId,
  });
  Object.assign(row, { netCents: "20000", taxCents: "1800", grossCents: "21800" });
  row.payouts = [{ id: "full-return", method: "CARD", grossCents: "21800" }];
  const result = resolvePayrollCloseCash(input);
  assert.equal(result.status, "CASH_EVIDENCE_READY", JSON.stringify(result.blockers));
  assert.equal(result.cash!.salonCash, "-200.0000");
  assert.deepEqual(result.cash!.staff, [{ staffId: "departed", collection: "-200.0000" }]);
  const hash = payrollInputHash(result);
  row.allocations.reverse();
  row.reversals.reverse();
  assert.equal(payrollInputHash(resolvePayrollCloseCash(input)), hash);
  row.allocations.pop();
  assert.equal(resolvePayrollCloseCash(input).cash, null);
});

test("ordinary returned cash retains historical multi-staff splits rather than current sellers", () => {
  const input = ordinaryReturnedFixture();
  input.returnedCashSaleVoids![0].allocations[0].shares = [
    { staffId: "departed", share: 6000 },
    { staffId: "other", share: 4000 },
  ];
  for (const event of [...input.events, ...input.lineageEvents]) {
    const evidence = event.evidence as {
      lines: { id: string; staffId: string; baseAmount: string; units: string }[];
    };
    const line = evidence.lines[0];
    const negative = event.sourceType === "REVERSAL";
    evidence.lines = [
      { ...line, baseAmount: negative ? "-60" : "60", units: negative ? "-0.6" : "0.6" },
      {
        ...line,
        id: `${line.id}-other`,
        staffId: "other",
        baseAmount: negative ? "-40" : "40",
        units: negative ? "-0.4" : "0.4",
      },
    ];
  }
  const result = resolvePayrollCloseCash(input);
  assert.equal(result.status, "CASH_EVIDENCE_READY", JSON.stringify(result.blockers));
  assert.deepEqual(result.cash!.staff, [
    { staffId: "departed", collection: "-60.0000" },
    { staffId: "other", collection: "-40.0000" },
  ]);
});

test("ordinary returned void cannot also be a full sale refund", () => {
  const input = ordinaryReturnedFixture();
  const row = input.returnedCashSaleVoids![0];
  input.saleRefunds = [
    {
      ...row,
      outletId: "branch",
      allocations: row.allocations.map((part) => ({
        ...part,
        itemType: "SERVICE",
        reversalEventId: "reverse",
      })),
    },
  ];
  const result = resolvePayrollCloseCash(input);
  assert.equal(result.cash, null);
  assert.ok(result.blockers.some((part) => part.code === "VOID_REFUND_CASH_EFFECT_CONFLICT"));
});
