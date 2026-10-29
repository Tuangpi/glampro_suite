import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePayrollCloseCash } from "./payroll-close-cash.js";
import type { PayrollCloseCollectionRecords } from "./payroll-close-collections.js";
import type { PayrollCloseReversalRecords } from "./payroll-close-reversals.js";
import type { PayrollSaleRefund } from "./payroll-close-sale-refunds.js";
import { payrollInputHash } from "./payroll-close-state.js";

function fixture(): PayrollCloseCollectionRecords &
  PayrollCloseReversalRecords & { cashAttributions: [] } {
  const at = new Date("2026-09-15T00:00:00Z");
  const priorAt = new Date("2026-08-15T00:00:00Z");
  const capture = {
    version: 1,
    status: "CAPTURED",
    postingStatus: "PENDING_RELEASE",
    currency: "SGD",
  };
  const line = {
    id: "original-base",
    staffId: "departed",
    outletId: "branch",
    commissionType: "SVC",
    baseAmount: "100.0000",
    units: "1.0000",
    businessDate: "2026-08-15",
    status: "EARNED",
    mode: "FOLLOW_PLAN",
    fallbackRatePct: "10",
  };
  return {
    tenantId: "salon",
    periodKey: "2026-09",
    timeZone: "Asia/Singapore",
    operations: [],
    collections: [],
    cashAttributions: [],
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
    lineageEvents: [
      {
        id: "original",
        tenantId: "salon",
        sourceKey: "original",
        sourceType: "SALE_LINE",
        sourceId: "sale-line",
        saleId: "sale",
        outletId: "branch",
        occurredAt: priorAt,
        createdAt: priorAt,
        evidence: { ...capture, lines: [line] },
      },
    ],
    saleRefunds: [
      {
        id: "refund",
        tenantId: "salon",
        saleId: "sale",
        outletId: "branch",
        occurredAt: at,
        currency: "SGD",
        netCents: "10000",
        taxCents: "900",
        grossCents: "10900",
        evidence: { settledRevision: 1 },
        payouts: [
          { method: "CASH", grossCents: "5000" },
          { method: "CARD", grossCents: "5900" },
        ],
        allocations: [
          {
            id: "allocation",
            saleLineId: "sale-line",
            originalEventId: "original",
            reversalEventId: "reverse",
            itemType: "SERVICE",
            netCents: "10000",
            taxCents: "900",
            grossCents: "10900",
            shares: [{ staffId: "departed", share: 10000 }],
            evidence: { allocationRevision: 1 },
          },
        ],
      },
    ],
  };
}

const refund = (input: ReturnType<typeof fixture>): PayrollSaleRefund => input.saleRefunds![0];

test("full ordinary-sale refunds subtract net cash once across split tenders, excluding GST", () => {
  const result = resolvePayrollCloseCash(fixture());
  assert.equal(result.status, "CASH_EVIDENCE_READY", JSON.stringify(result.blockers));
  assert.equal(result.earningsActive, false);
  assert.equal(result.cash!.salonCash, "-100.0000");
  assert.deepEqual(result.cash!.staff, [{ staffId: "departed", collection: "-100.0000" }]);
  assert.deepEqual(result.cash!.outlets, [{ outletId: "branch", collection: "-100.0000" }]);
});

test("service and product lines reconcile independently within one full refund", () => {
  const input = fixture();
  const original = structuredClone(input.lineageEvents[0]);
  Object.assign(original, { id: "product", sourceKey: "product", sourceId: "product-line" });
  const originalEvidence = original.evidence as { lines: { id: string; commissionType: string }[] };
  Object.assign(originalEvidence.lines[0], { id: "product-base", commissionType: "PRD" });
  input.lineageEvents.push(original);
  const reversal = structuredClone(input.events[0]);
  Object.assign(reversal, {
    id: "product-reverse",
    sourceKey: "product-reverse",
    sourceId: "product",
  });
  const reversalEvidence = reversal.evidence as {
    originalEventId: string;
    lines: typeof originalEvidence.lines;
  };
  reversalEvidence.originalEventId = "product";
  Object.assign(reversalEvidence.lines[0], { id: "product-reverse-base", commissionType: "PRD" });
  input.events.push(reversal);
  refund(input).allocations.push({
    ...structuredClone(refund(input).allocations[0]),
    id: "product-allocation",
    saleLineId: "product-line",
    originalEventId: "product",
    reversalEventId: "product-reverse",
    itemType: "PRODUCT",
  });
  Object.assign(refund(input), {
    netCents: "20000",
    taxCents: "1800",
    grossCents: "21800",
    payouts: [{ method: "PAYNOW", grossCents: "21800" }],
  });
  assert.equal(resolvePayrollCloseCash(input).cash!.salonCash, "-200.0000");
});

test("missing full-sale payout evidence does not infer cash from negative bases", () => {
  const input = fixture();
  delete input.saleRefunds;
  assert.equal(resolvePayrollCloseCash(input).cash, null);
});

test("refund payout totals and allocation GST/net/gross must reconcile exactly", () => {
  for (const change of ["net", "tax", "gross", "payout", "zero", "allocation"]) {
    const input = fixture();
    const row = refund(input);
    if (change === "net") row.netCents = "9999";
    if (change === "tax") row.taxCents = "899";
    if (change === "gross") row.grossCents = "10899";
    if (change === "payout") row.payouts[0].grossCents = "4999";
    if (change === "zero") row.payouts[0].grossCents = "0";
    if (change === "allocation") row.allocations[0].taxCents = "899";
    assert.equal(resolvePayrollCloseCash(input).cash, null, change);
  }
});

test("sale refund identity, original type and date must match original and reversal", () => {
  for (const change of [
    "sale",
    "outlet",
    "month",
    "later",
    "line",
    "original",
    "reversal",
    "type",
  ]) {
    const input = fixture();
    const row = refund(input);
    if (change === "sale") row.saleId = "other";
    if (change === "outlet") row.outletId = "other";
    if (change === "month") row.occurredAt = new Date("2026-08-31T15:59:59Z");
    if (change === "later") row.occurredAt = new Date("2026-09-16");
    if (change === "line") row.allocations[0].saleLineId = "other";
    if (change === "original") row.allocations[0].originalEventId = "other";
    if (change === "reversal") row.allocations[0].reversalEventId = "other";
    if (change === "type") input.lineageEvents[0].sourceType = "COLLECTION";
    assert.equal(resolvePayrollCloseCash(input).cash, null, change);
  }
});

test("partial refunds, missing lines and wrong historical sellers fail closed", () => {
  for (const change of ["partial", "seller", "missing", "type"]) {
    const input = fixture();
    const row = refund(input);
    if (change === "partial") {
      Object.assign(row, { netCents: "5000", taxCents: "450", grossCents: "5450" });
      Object.assign(row.allocations[0], { netCents: "5000", taxCents: "450", grossCents: "5450" });
      row.payouts = [{ method: "CASH", grossCents: "5450" }];
    }
    if (change === "seller") row.allocations[0].shares[0].staffId = "cashier";
    if (change === "missing") input.lineageEvents = [];
    if (change === "type") row.allocations[0].itemType = "PRODUCT";
    assert.equal(resolvePayrollCloseCash(input).cash, null, change);
  }
});

test("foreign, duplicate and reused full-refund records are refused", () => {
  const foreign = fixture();
  refund(foreign).tenantId = "other";
  assert.throws(() => resolvePayrollCloseCash(foreign), /another salon/);
  const duplicate = fixture();
  duplicate.saleRefunds!.push({ ...structuredClone(refund(duplicate)), id: "second" });
  assert.throws(() => resolvePayrollCloseCash(duplicate), /Duplicate/);
  const allocation = fixture();
  refund(allocation).allocations.push(structuredClone(refund(allocation).allocations[0]));
  assert.throws(() => resolvePayrollCloseCash(allocation), /Duplicate/);
});

test("sale refund requires exact source reversal even when payout totals match", () => {
  const input = fixture();
  const evidence = input.events[0].evidence as { lines: { baseAmount: string }[] };
  evidence.lines[0].baseAmount = "-99.9999";
  assert.equal(resolvePayrollCloseCash(input).cash, null);
});

test("settlement and allocation revisions are frozen, detached and order independent", () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = resolvePayrollCloseCash(input);
  assert.deepEqual(input, before);
  const hash = payrollInputHash(result);
  refund(input).payouts.reverse();
  assert.equal(payrollInputHash(resolvePayrollCloseCash(input)), hash);
  refund(input).evidence = { settledRevision: 2 };
  assert.notEqual(payrollInputHash(resolvePayrollCloseCash(input)), hash);
  refund(input).evidence = { settledRevision: 1 };
  refund(input).allocations[0].evidence = { allocationRevision: 2 };
  assert.notEqual(payrollInputHash(resolvePayrollCloseCash(input)), hash);
  result.cash!.reversals!.saleRefunds!.refunds[0].saleId = "changed";
  assert.equal(refund(input).saleId, "sale");
});

test("foreign currency and non-JSON payout evidence are rejected", () => {
  for (const patch of [{ currency: "USD" }, { evidence: new Date() }, { evidence: null }]) {
    const input = fixture();
    Object.assign(refund(input), patch);
    assert.throws(() => resolvePayrollCloseCash(input));
  }
});

test("split seller refund cash preserves four-decimal residuals exactly", () => {
  const input = fixture();
  const row = refund(input);
  Object.assign(row, {
    netCents: "1",
    taxCents: "0",
    grossCents: "1",
    payouts: [{ method: "CASH", grossCents: "1" }],
  });
  Object.assign(row.allocations[0], {
    netCents: "1",
    taxCents: "0",
    grossCents: "1",
    shares: [
      { staffId: "a", share: 3333 },
      { staffId: "b", share: 6667 },
    ],
  });
  for (const [event, reverse] of [
    [input.lineageEvents[0], false],
    [input.events[0], true],
  ] as const) {
    const evidence = event.evidence as {
      lines: { id: string; staffId: string; baseAmount: string; units: string }[];
    };
    const template = evidence.lines[0];
    evidence.lines = [
      {
        ...template,
        id: `${event.id}-a`,
        staffId: "a",
        baseAmount: reverse ? "-0.0034" : "0.0034",
        units: reverse ? "-0.3333" : "0.3333",
      },
      {
        ...template,
        id: `${event.id}-b`,
        staffId: "b",
        baseAmount: reverse ? "-0.0066" : "0.0066",
        units: reverse ? "-0.6667" : "0.6667",
      },
    ];
  }
  const result = resolvePayrollCloseCash(input);
  assert.equal(result.cash!.salonCash, "-0.0100");
  assert.deepEqual(result.cash!.staff, [
    { staffId: "a", collection: "-0.0034" },
    { staffId: "b", collection: "-0.0066" },
  ]);
  row.allocations[0].shares.reverse();
  assert.equal(payrollInputHash(resolvePayrollCloseCash(input)), payrollInputHash(result));
});

test("one reversal cannot carry both ordinary refund cash and a no-cash assertion", () => {
  const input = fixture();
  input.noCashReversals = [
    {
      id: "no-cash",
      tenantId: "salon",
      eventId: "reverse",
      originalEventId: "original",
      originalSourceId: "sale-line",
      originalSourceType: "REDEMPTION",
      saleId: "sale",
      outletId: "branch",
      occurredAt: refund(input).occurredAt,
      currency: "SGD",
      netCents: "0",
      taxCents: "0",
      grossCents: "0",
      evidence: { revision: 1 },
    },
  ];
  const result = resolvePayrollCloseCash(input);
  assert.equal(result.cash, null);
  assert.ok(result.blockers.some((row) => row.code === "REVERSAL_CASH_EFFECT_CONFLICT"));
});
