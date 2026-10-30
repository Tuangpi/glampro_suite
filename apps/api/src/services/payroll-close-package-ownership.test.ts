import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyPayrollPackageOwnership } from "./payroll-close-package-ownership.js";

function fixture() {
  const input = {
    tenantId: "salon",
    purchase: {
      originalCustomerId: "buyer",
      purchasedAt: "2026-08-01T00:00:00Z",
      grantedSessions: 3,
    },
    holding: {
      id: "holding",
      customerId: "recipient",
      quantityRemaining: 1,
      expiresAt: null as Date | null,
    },
    transfers: [
      {
        id: "transfer",
        tenantId: "salon",
        holdingId: "holding",
        fromCustomerId: "buyer",
        toCustomerId: "recipient",
        actorId: "manager",
        quantity: 2,
        expiresAt: null as Date | null,
        reason: "Gift remaining sessions",
        createdAt: new Date("2026-09-02T00:00:00Z"),
      },
    ],
    redemptions: [
      {
        id: "before",
        tenantId: "salon",
        holdingId: "holding",
        customerId: "buyer",
        quantity: 1,
        usedAt: new Date("2026-09-01T00:00:00Z"),
        revertedAt: null as Date | null,
      },
      {
        id: "after",
        tenantId: "salon",
        holdingId: "holding",
        customerId: "recipient",
        quantity: 1,
        usedAt: new Date("2026-09-03T00:00:00Z"),
        revertedAt: null as Date | null,
      },
    ],
  };
  return { input, verify: () => verifyPayrollPackageOwnership(input) };
}

test("ownership replays transfers and draws chronologically without changing original purchase", () => {
  const f = fixture();
  f.input.redemptions.reverse();
  assert.deepEqual(f.verify(), { customerId: "recipient", quantityRemaining: 1 });
  assert.equal(f.input.purchase.originalCustomerId, "buyer");
});

test("ownership rejects missing, altered, foreign, ambiguous and reversed histories", () => {
  const mutations: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.input.transfers = [];
    },
    (f) => {
      f.input.transfers.push({ ...f.input.transfers[0] });
    },
    (f) => {
      f.input.transfers[0].fromCustomerId = "other";
    },
    (f) => {
      f.input.transfers[0].toCustomerId = "buyer";
    },
    (f) => {
      f.input.transfers[0].tenantId = "foreign";
    },
    (f) => {
      f.input.transfers[0].holdingId = "other";
    },
    (f) => {
      f.input.transfers[0].actorId = "";
    },
    (f) => {
      f.input.transfers[0].reason = " ";
    },
    (f) => {
      f.input.transfers[0].quantity = 3;
    },
    (f) => {
      f.input.transfers[0].quantity = 1.5;
    },
    (f) => {
      f.input.transfers[0].createdAt = f.input.redemptions[0].usedAt;
    },
    (f) => {
      f.input.transfers[0].createdAt = new Date("invalid");
    },
    (f) => {
      f.input.transfers[0].createdAt = new Date("2026-07-01T00:00:00Z");
    },
    (f) => {
      f.input.transfers[0].expiresAt = new Date("2027-01-01T00:00:00Z");
    },
    (f) => {
      f.input.holding.expiresAt = new Date("2026-09-02T00:00:00Z");
    },
    (f) => {
      f.input.holding.customerId = "buyer";
    },
    (f) => {
      f.input.holding.quantityRemaining = 2;
    },
    (f) => {
      f.input.redemptions[1].customerId = "buyer";
    },
    (f) => {
      f.input.redemptions[1].revertedAt = new Date();
    },
    (f) => {
      f.input.redemptions[1].quantity = 3;
    },
    (f) => {
      f.input.redemptions.push({ ...f.input.redemptions[0] });
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const f = fixture();
    mutate(f);
    assert.throws(f.verify, /PACKAGE_OWNERSHIP_UNCONFIRMED/, `mutation ${index}`);
  }
});

test("untransferred holdings and no-draw transfers reconcile without invented usage", () => {
  const f = fixture();
  f.input.redemptions = [];
  f.input.transfers[0].quantity = 3;
  f.input.holding.quantityRemaining = 3;
  assert.equal(f.verify().customerId, "recipient");
  f.input.transfers = [];
  f.input.holding.customerId = "buyer";
  assert.equal(f.verify().customerId, "buyer");
});

test("ownership restores voided draws in timestamp order, including after expiry", () => {
  const f = fixture();
  f.input.redemptions[1].revertedAt = new Date("2026-09-05T00:00:00Z");
  f.input.holding.expiresAt = new Date("2026-09-04T00:00:00Z");
  f.input.transfers[0].expiresAt = f.input.holding.expiresAt;
  f.input.holding.quantityRemaining = 2;
  assert.deepEqual(f.verify(), { customerId: "recipient", quantityRemaining: 2 });
  f.input.redemptions[1].revertedAt = new Date("2026-09-02T12:00:00Z");
  assert.throws(f.verify, /PACKAGE_OWNERSHIP_UNCONFIRMED/);
});

test("restored sessions can be transferred without reassigning the original draw", () => {
  const f = fixture();
  f.input.redemptions[0].revertedAt = new Date("2026-09-01T12:00:00Z");
  f.input.transfers[0].quantity = 3;
  f.input.holding.quantityRemaining = 2;
  assert.equal(f.verify().quantityRemaining, 2);
  f.input.redemptions[0].revertedAt = f.input.transfers[0].createdAt;
  assert.throws(f.verify, /PACKAGE_OWNERSHIP_UNCONFIRMED/);
});
