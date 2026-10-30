import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import { resolvePayrollValueOwnership } from "./payroll-close-value-ownership.js";
import {
  verifyPayrollValueSharing,
  type PayrollValueSharing,
} from "./payroll-close-value-sharing.js";

const date = (day: number) => new Date(Date.UTC(2026, 9, day));
function membership(): PayrollValueSharing {
  return {
    customerIds: ["buyer", "recipient"],
    families: [{ id: "family", tenantId: "salon", name: "Family", createdAt: date(1) }],
    members: ["buyer", "recipient"].map((customerId) => ({
      id: `member-${customerId}`,
      tenantId: "salon",
      customerId,
      familyId: "family",
      createdAt: date(2),
    })),
    events: ["buyer", "recipient"].map((customerId) => ({
      id: `join-${customerId}`,
      tenantId: "salon",
      customerId,
      fromFamilyId: null,
      toFamilyId: "family",
      actorId: "manager",
      reason: "Explicit membership",
      createdAt: date(2),
    })),
  };
}
function fixture(): Parameters<typeof resolvePayrollValueOwnership>[0] {
  const D = (amount: string) => new Prisma.Decimal(amount);
  const grant = {
    id: "grant",
    tenantId: "salon",
    holdingId: "holding",
    customerId: "buyer",
    previousCustomerId: null,
    actorId: "manager",
    saleId: "purchase",
    kind: "GRANT",
    amountBefore: D("0"),
    amountAfter: D("600"),
    delta: D("600"),
    sharedFamilyId: null,
    previousSharedFamilyId: null,
    expiresAt: null,
    reason: "Purchase",
    createdAt: date(1),
  };
  return {
    tenantId: "salon",
    holdingId: "holding",
    originalCustomerId: "buyer",
    customerId: "buyer",
    amount: D("600"),
    amountRemaining: D("550"),
    expiresAt: null,
    transfers: [],
    sharedFamilyId: "family",
    sharing: membership(),
    redemptions: [{ saleId: "usage", customerId: "recipient", usedAt: date(4) }],
    balances: [
      grant,
      {
        ...grant,
        id: "consent",
        previousCustomerId: "buyer",
        saleId: null,
        kind: "SHARING",
        amountBefore: D("600"),
        delta: D("0"),
        sharedFamilyId: "family",
        createdAt: date(3),
      },
      {
        ...grant,
        id: "spend",
        previousCustomerId: "buyer",
        saleId: "usage",
        kind: "SPEND",
        amountBefore: D("600"),
        amountAfter: D("550"),
        delta: D("-50"),
        sharedFamilyId: "family",
        previousSharedFamilyId: "family",
        createdAt: date(4),
      },
    ],
  };
}

test("shared spend resolves historical spender, not holding owner or current membership", () => {
  const f = fixture();
  f.sharing!.events.push({
    ...f.sharing!.events[1],
    id: "leave",
    fromFamilyId: "family",
    toFamilyId: null,
    createdAt: date(5),
  });
  f.sharing!.members = f.sharing!.members.filter((row) => row.customerId !== "recipient");
  assert.deepEqual([...resolvePayrollValueOwnership(f)], [["spend", "recipient"]]);
});

test("membership append can follow member creation; cannot precede it", () => {
  const f = membership();
  f.events[0].createdAt = new Date(date(2).getTime() + 5);
  assert.equal(verifyPayrollValueSharing("salon", f).familyAt("buyer", date(3)), "family");
  f.members[0].createdAt = date(3);
  assert.throws(() => verifyPayrollValueSharing("salon", f), /VALUE_SHARING_HISTORY_UNCONFIRMED/);
});

test("complete membership history rejects missing, duplicate, foreign, broken and ambiguous evidence", () => {
  const cases: ((f: PayrollValueSharing) => void)[] = [
    (f) => {
      f.events = [];
    },
    (f) => {
      f.members = [];
    },
    (f) => {
      f.families = [];
    },
    (f) => {
      f.events.push(f.events[0]);
    },
    (f) => {
      f.members.push(f.members[0]);
    },
    (f) => {
      f.families.push(f.families[0]);
    },
    (f) => {
      f.events[0].tenantId = "foreign";
    },
    (f) => {
      f.members[0].tenantId = "foreign";
    },
    (f) => {
      f.families[0].tenantId = "foreign";
    },
    (f) => {
      f.events[0].customerId = "foreign";
    },
    (f) => {
      f.events[0].fromFamilyId = "missing";
    },
    (f) => {
      f.events[0].actorId = "";
    },
    (f) => {
      f.events[0].reason = " ";
    },
    (f) => {
      f.families[0].createdAt = date(3);
    },
    (f) => {
      f.members[0].familyId = "other";
    },
    (f) => {
      f.events.push({ ...f.events[0], id: "ambiguous", fromFamilyId: "family", toFamilyId: null });
    },
  ];
  for (const [index, mutate] of cases.entries()) {
    const f = membership();
    mutate(f);
    assert.throws(
      () => verifyPayrollValueSharing("salon", f),
      /VALUE_SHARING_HISTORY_UNCONFIRMED/,
      `case ${index}`,
    );
  }
});

test("shared replay rejects missing consent, changed balances, identity and absent spend-time membership", () => {
  const cases: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.balances = f.balances.filter((row) => row.kind !== "SHARING");
    },
    (f) => {
      f.sharing = undefined;
    },
    (f) => {
      f.balances[1].actorId = null;
    },
    (f) => {
      f.balances[1].reason = "";
    },
    (f) => {
      f.balances[1].saleId = "usage";
    },
    (f) => {
      f.balances[1].sharedFamilyId = "other";
    },
    (f) => {
      f.balances[2].previousSharedFamilyId = null;
    },
    (f) => {
      f.balances[2].sharedFamilyId = null;
    },
    (f) => {
      f.sharedFamilyId = null;
    },
    (f) => {
      f.redemptions = [];
    },
    (f) => {
      f.redemptions!.push(f.redemptions![0]);
    },
    (f) => {
      f.redemptions![0].customerId = "foreign";
    },
    (f) => {
      f.redemptions![0].usedAt = date(3);
    },
    (f) => {
      f.sharing!.members[1].createdAt = date(5);
      f.sharing!.events[1].createdAt = date(5);
    },
  ];
  for (const [index, mutate] of cases.entries()) {
    const f = fixture();
    mutate(f);
    assert.throws(
      () => resolvePayrollValueOwnership(f),
      /VALUE_(OWNERSHIP|SHARING)_HISTORY_UNCONFIRMED/,
      `case ${index}`,
    );
  }
});

test("owner departure and rejoin cannot silently revive old holding consent", () => {
  const f = fixture();
  f.sharing!.events.push(
    {
      ...f.sharing!.events[0],
      id: "leave",
      fromFamilyId: "family",
      toFamilyId: null,
      createdAt: date(5),
    },
    { ...f.sharing!.events[0], id: "rejoin", createdAt: date(6) },
  );
  f.sharing!.members[0].createdAt = date(6);
  assert.throws(() => resolvePayrollValueOwnership(f), /VALUE_SHARING_HISTORY_UNCONFIRMED/);
});

test("recipient leave/rejoin between ledger and usage cannot masquerade as continuous access", () => {
  const f = fixture();
  f.redemptions![0].usedAt = date(7);
  f.sharing!.events.push(
    {
      ...f.sharing!.events[1],
      id: "leave",
      fromFamilyId: "family",
      toFamilyId: null,
      createdAt: date(5),
    },
    { ...f.sharing!.events[1], id: "rejoin", createdAt: date(6) },
  );
  f.sharing!.members[1].createdAt = date(6);
  assert.throws(() => resolvePayrollValueOwnership(f), /VALUE_SHARING_HISTORY_UNCONFIRMED/);
});

test("consent-only share/unshare cycles preserve money and require explicit repeat consent", () => {
  const f = fixture();
  const consent = f.balances[1];
  f.balances = [
    f.balances[0],
    consent,
    {
      ...consent,
      id: "withdraw",
      previousSharedFamilyId: "family",
      sharedFamilyId: null,
      createdAt: date(4),
    },
    {
      ...consent,
      id: "reshare",
      createdAt: date(5),
    },
  ];
  f.amountRemaining = f.amount;
  f.redemptions = [];
  assert.deepEqual([...resolvePayrollValueOwnership(f)], []);
  f.balances[2].amountAfter = f.amount.minus(1);
  f.balances[2].delta = f.amount.minus(f.amount).minus(1);
  assert.throws(() => resolvePayrollValueOwnership(f), /VALUE_OWNERSHIP_HISTORY_UNCONFIRMED/);
});
