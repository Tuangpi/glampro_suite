import assert from "node:assert/strict";
import { test } from "node:test";
import {
  commissionAttributionSchema,
  commissionSharesSchema,
  publishCommissionAttributionPolicySchema,
  correctRedemptionAttributionSchema,
} from "./commission-attribution.js";
import { saleLineInputSchema, salePaymentInputSchema } from "./sales.js";

test("independent seller and performer groups allow same-person credit", () => {
  const shares = [{ staffId: "amy", share: 10000 }];
  assert.deepEqual(commissionAttributionSchema.parse({ sellers: shares, performers: shares }), {
    sellers: shares,
    performers: shares,
  });
});
test("up to four distinct staff with integer basis points total exactly 100 percent", () => {
  assert.equal(
    commissionSharesSchema.safeParse([1, 2, 3, 4].map((i) => ({ staffId: String(i), share: 2500 })))
      .success,
    true,
  );
  for (const rows of [
    [],
    [{ staffId: "a", share: 9999 }],
    [
      { staffId: "a", share: 5000 },
      { staffId: "a", share: 5000 },
    ],
    [1, 2, 3, 4, 5].map((i) => ({ staffId: String(i), share: 2000 })),
    [{ staffId: "a", share: 10000.1 }],
  ])
    assert.equal(commissionSharesSchema.safeParse(rows).success, false);
});
test("sale input preserves explicit attribution, but old clients remain uncredited", () => {
  const line = { itemType: "PACKAGE", itemId: "package", quantity: 1 };
  assert.equal(saleLineInputSchema.parse(line).attribution, undefined);
  assert.deepEqual(
    saleLineInputSchema.parse({
      ...line,
      attribution: { sellers: [{ staffId: "amy", share: 10000 }] },
    }).attribution?.sellers,
    [{ staffId: "amy", share: 10000 }],
  );
  assert.equal(commissionAttributionSchema.safeParse({}).success, false);
  assert.equal(commissionAttributionSchema.safeParse({ cashier: "amy" }).success, false);
});

test("explicit whole-session attribution is accepted only on package tenders", () => {
  const performers = [{ staffId: "amy", share: 10000 }];
  assert.deepEqual(
    salePaymentInputSchema.parse({
      method: "PACKAGE",
      holdingId: "holding",
      amount: 10,
      performers,
    }).performers,
    performers,
  );
  for (const method of ["CASH", "PREPAID_CREDIT"])
    assert.equal(
      salePaymentInputSchema.safeParse({ method, holdingId: "holding", amount: 10, performers })
        .success,
      false,
    );
});

test("policy and correction contracts reject client financial inputs and stale shape", () => {
  const policy = {
    requireSellers: false,
    requireServicePerformers: true,
    requireRedemptionPerformers: true,
    expectedRevision: null,
    reason: "Require explicit attribution",
  };
  assert.equal(publishCommissionAttributionPolicySchema.safeParse(policy).success, true);
  assert.equal(
    publishCommissionAttributionPolicySchema.safeParse({ ...policy, activateEarnings: true })
      .success,
    false,
  );
  const correction = {
    expectedRevision: 0,
    idempotencyKey: "correction-key",
    performers: [{ staffId: "amy", share: 10000 }],
    reason: "Wrong staff",
  };
  assert.equal(correctRedemptionAttributionSchema.safeParse(correction).success, true);
  assert.equal(
    correctRedemptionAttributionSchema.safeParse({ ...correction, rate: "10.00" }).success,
    false,
  );
  assert.equal(
    correctRedemptionAttributionSchema.safeParse({ ...correction, expectedRevision: -1 }).success,
    false,
  );
});
