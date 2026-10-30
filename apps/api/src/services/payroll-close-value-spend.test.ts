import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import { verifyPayrollValueSpend } from "./payroll-close-value-spend.js";
import { verifyPayrollValueRestoration } from "./payroll-close-value-restoration.js";

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

function restorationFixture(): Parameters<typeof verifyPayrollValueRestoration>[0] {
  const original = fixture();
  const at = new Date("2026-10-02T00:00:00Z");
  const spend = {
    ...original,
    sale: {
      ...original.sale,
      status: "VOID",
      voidedAt: at,
      voidedById: "manager",
      voidReason: "Customer cancelled",
    },
    redemption: {
      ...original.redemption,
      revertedAt: new Date(at.getTime() + 5),
    },
  };
  const evidence = original.event.evidence as { lines: Record<string, unknown>[] };
  return {
    spend,
    refundIds: [],
    balances: [
      {
        id: "restore",
        tenantId: "salon",
        holdingId: "holding",
        customerId: "buyer",
        previousCustomerId: "buyer",
        sharedFamilyId: null,
        previousSharedFamilyId: null,
        actorId: "manager",
        saleId: "usage",
        kind: "RESTORE",
        amountBefore: new Prisma.Decimal("500"),
        amountAfter: new Prisma.Decimal("600"),
        delta: new Prisma.Decimal("100"),
        expiresAt: null,
        reason: "Customer cancelled",
        createdAt: new Date(at.getTime() - 10),
      },
    ],
    reversals: [
      {
        ...original.event,
        id: "reversal",
        sourceKey: "void:usage:event",
        sourceType: "REVERSAL",
        sourceId: "event",
        actorId: "manager",
        reason: "Source sale voided",
        occurredAt: new Date(at.getTime() + 1),
        createdAt: new Date(at.getTime() + 2),
        evidence: {
          ...(original.event.evidence as object),
          originalEventId: "event",
          lines: evidence.lines.map((line) => ({
            ...line,
            id: "void:usage:event:performer",
            businessDate: "2026-10-02",
            baseAmount: "-83.3333",
            units: "-1.0000",
          })),
        } as Prisma.JsonValue,
      },
    ],
  };
}

test("credit restoration reconciles operational void, balance and exact historical reversal across months", () => {
  const f = restorationFixture();
  assert.deepEqual(verifyPayrollValueRestoration(f), {
    redemptionId: "draw",
    eventId: "event",
    baseAmount: "83.3333",
    spentBefore: "0.00",
    spentNow: "100.00",
    performers: [{ staffId: "performer", share: 10000 }],
    restorationBalanceId: "restore",
    reversalEventId: "reversal",
  });
  assert.throws(() => verifyPayrollValueSpend(f.spend));
});

test("credit restoration refuses absent, duplicate, foreign and contradictory independent evidence", () => {
  const mutations: ((f: ReturnType<typeof restorationFixture>) => void)[] = [
    (f) => {
      f.balances = [];
    },
    (f) => {
      f.balances.push(f.balances[0]);
    },
    (f) => {
      f.reversals = [];
    },
    (f) => {
      f.reversals.push(f.reversals[0]);
    },
    (f) => {
      f.refundIds.push("refund");
    },
    (f) => {
      f.spend.redemption.revertedAt = null;
    },
    (f) => {
      f.spend.sale.status = "COMPLETED";
    },
    (f) => {
      f.spend.sale.voidedAt = null;
    },
    (f) => {
      f.spend.sale.voidedAt = new Date("invalid");
    },
    (f) => {
      f.spend.redemption.revertedAt = new Date("2026-09-01");
    },
    (f) => {
      f.spend.sale.voidedById = "other";
    },
    (f) => {
      f.spend.sale.voidReason = "other";
    },
    (f) => {
      f.balances[0].tenantId = "foreign";
    },
    (f) => {
      f.balances[0].holdingId = "foreign";
    },
    (f) => {
      f.balances[0].saleId = "other";
    },
    (f) => {
      f.balances[0].kind = "SPEND";
    },
    (f) => {
      f.balances[0].delta = new Prisma.Decimal("99");
    },
    (f) => {
      f.balances[0].amountAfter = new Prisma.Decimal("601");
    },
    (f) => {
      f.balances[0].previousCustomerId = "other";
    },
    (f) => {
      f.balances[0].sharedFamilyId = "other";
    },
    (f) => {
      f.balances[0].createdAt = new Date("2026-10-03");
    },
    (f) => {
      f.reversals[0].actorId = "other";
    },
    (f) => {
      f.reversals[0].tenantId = "foreign";
    },
    (f) => {
      f.reversals[0].outletId = "foreign";
    },
    (f) => {
      f.reversals[0].occurredAt = new Date("invalid");
    },
    (f) => {
      f.reversals[0].sourceKey = "other";
    },
    (f) => {
      f.reversals[0].sourceType = "CORRECTION";
    },
    (f) => {
      f.reversals[0].occurredAt = new Date("2026-10-03");
    },
    (f) => {
      const evidence = f.reversals[0].evidence as { lines: { baseAmount: string }[] };
      evidence.lines[0].baseAmount = "-1.0000";
    },
    (f) => {
      const evidence = f.reversals[0].evidence as { lines: { units: string }[] };
      evidence.lines[0].units = "0.0000";
    },
    (f) => {
      const evidence = f.reversals[0].evidence as { lines: { fallbackRatePct: string }[] };
      evidence.lines[0].fallbackRatePct = "99";
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const f = restorationFixture();
    mutate(f);
    assert.throws(() => verifyPayrollValueRestoration(f), /UNCONFIRMED/, `mutation ${index}`);
  }
});
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
