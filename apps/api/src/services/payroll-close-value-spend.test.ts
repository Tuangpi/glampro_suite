import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import { verifyPayrollValueSpend } from "./payroll-close-value-spend.js";

function fixture(): Parameters<typeof verifyPayrollValueSpend>[0] {
  const at = new Date("2026-09-15T00:00:00Z");
  const purchase = {
    version: 1,
    saleId: "purchase",
    saleLineId: "purchase-line",
    currency: "SGD",
    paidNet: "500.00",
    credit: "600.00",
    sellers: [{ staffId: "seller", share: 10000 }],
  };
  const performers = [{ staffId: "performer", share: 10000 }];
  return {
    tenantId: "salon",
    timeZone: "Asia/Singapore",
    purchase,
    spentBefore: "0.00",
    holding: { id: "holding", valuePackageId: "value", customerId: "buyer", expiresAt: null },
    redemption: {
      id: "draw",
      tenantId: "salon",
      customerId: "buyer",
      saleId: "usage",
      itemType: "VALUE_PACKAGE",
      itemId: "value",
      holdingId: "holding",
      quantity: 1,
      amount: new Prisma.Decimal("100"),
      usedAt: at,
      revertedAt: null,
    },
    sale: {
      id: "usage",
      tenantId: "salon",
      customerId: "buyer",
      outletId: "branch",
      status: "COMPLETED",
      collectionCurrency: "SGD",
      soldAt: at,
      lines: [
        {
          id: "service-line",
          tenantId: "salon",
          saleId: "usage",
          itemType: "SERVICE",
          attribution: { performers },
        },
      ],
    },
    event: {
      id: "event",
      tenantId: "salon",
      sourceKey: "value-spend:draw",
      sourceType: "VALUE_SPEND",
      sourceId: "draw",
      saleId: "usage",
      outletId: "branch",
      occurredAt: at,
      createdAt: new Date(at.getTime() + 1),
      evidence: {
        version: 1,
        status: "CAPTURED",
        postingStatus: "PENDING_RELEASE",
        currency: "SGD",
        missingEvidence: [],
        itemId: "value",
        lines: [
          {
            id: "value-spend:draw:performer",
            staffId: "performer",
            outletId: "branch",
            commissionType: "VP_SPEND",
            baseAmount: "83.3333",
            units: "1.0000",
            businessDate: "2026-09-15",
            mode: "FOLLOW_PLAN",
            status: "EARNED",
            fallbackRatePct: "7",
          },
        ],
        rateProvenance: {
          version: 1,
          rateAt: at.toISOString(),
          itemId: "value",
          category: null,
          selections: [
            {
              staffId: "performer",
              legacyServiceRate: "99",
              selection: { rate: "7", source: "PACKAGE", ruleId: "rate" },
            },
          ],
        },
        sourceSnapshot: {
          version: 1,
          purchase,
          baseAmount: "83.3333",
          spentBefore: "0.00",
          spentNow: "100.00",
          performers,
          sourceSaleId: "usage",
          postingStatus: "PENDING_RELEASE",
        },
      },
    },
    rules: [
      {
        id: "rate",
        tenantId: "salon",
        staffId: null,
        itemKind: "STORED_CREDIT_SPEND",
        scope: "PACKAGE",
        targetId: "value",
        rate: "7",
        effectiveAt: new Date("2026-01-01"),
        createdAt: new Date("2026-01-01"),
      },
    ],
  };
}
test("value spend replays paid-to-credit ratio and dedicated historical spend rates", () => {
  const f = fixture();
  assert.equal(verifyPayrollValueSpend(f).baseAmount, "83.3333");
  const detached = verifyPayrollValueSpend(f);
  detached.performers[0].share = 1;
  assert.equal(verifyPayrollValueSpend(f).performers[0].share, 10000);
  f.rules[0].itemKind = "SERVICE";
  assert.throws(() => verifyPayrollValueSpend(f), /RATE_PROVENANCE_UNCONFIRMED/);
});
test("value spends reject altered purchase, operational identity, ownership, lifecycle and captured amounts", () => {
  const mutations: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.redemption.tenantId = "foreign";
    },
    (f) => {
      f.sale.tenantId = "foreign";
    },
    (f) => {
      f.event.tenantId = "foreign";
    },
    (f) => {
      f.redemption.customerId = "other";
    },
    (f) => {
      f.sale.customerId = "other";
    },
    (f) => {
      f.redemption.holdingId = "other";
    },
    (f) => {
      f.redemption.itemId = "other";
    },
    (f) => {
      f.redemption.quantity = 2;
    },
    (f) => {
      f.redemption.amount = new Prisma.Decimal("100.001");
    },
    (f) => {
      f.redemption.revertedAt = new Date();
    },
    (f) => {
      f.sale.status = "VOIDED";
    },
    (f) => {
      f.sale.collectionCurrency = null;
    },
    (f) => {
      f.sale.outletId = null;
    },
    (f) => {
      f.holding.expiresAt = f.redemption.usedAt;
    },
    (f) => {
      f.spentBefore = "100.00";
    },
    (f) => {
      f.event.sourceKey = "other";
    },
    (f) => {
      f.event.sourceId = "other";
    },
    (f) => {
      f.event.saleId = "other";
    },
    (f) => {
      f.event.occurredAt = new Date("2026-09-16");
    },
    (f) => {
      f.sale.lines = [];
    },
    (f) => {
      f.sale.lines[0].tenantId = "foreign";
    },
    (f) => {
      f.sale.lines[0].attribution = { performers: [{ staffId: "other", share: 10000 }] };
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    assert.throws(() => verifyPayrollValueSpend(f));
  }
  type CapturedEvidence = {
    sourceSnapshot: Record<string, unknown>;
    lines: Record<string, unknown>[];
  };
  for (const change of [
    (e: CapturedEvidence) => {
      e.sourceSnapshot.purchase = { paidNet: "1.00", credit: "600.00" };
    },
    (e: CapturedEvidence) => {
      e.sourceSnapshot.baseAmount = "100.0000";
    },
    (e: CapturedEvidence) => {
      e.lines[0].baseAmount = "100.0000";
    },
    (e: CapturedEvidence) => {
      e.lines[0].units = "2.0000";
    },
    (e: CapturedEvidence) => {
      e.lines[0].commissionType = "SVC";
    },
    (e: CapturedEvidence) => {
      e.lines[0].mode = "EXCLUDE";
    },
    (e: CapturedEvidence) => {
      e.lines.push({ ...e.lines[0] });
    },
  ]) {
    const f = fixture();
    change(f.event.evidence as CapturedEvidence);
    assert.throws(() => verifyPayrollValueSpend(f));
  }
});
