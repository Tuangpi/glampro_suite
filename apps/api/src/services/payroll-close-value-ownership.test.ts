import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import {
  replayPayrollValueOwnership,
  resolvePayrollValueOwnership,
} from "./payroll-close-value-ownership.js";

const D = (value: string) => new Prisma.Decimal(value);
function fixture(): Parameters<typeof resolvePayrollValueOwnership>[0] {
  const grant = {
    id: "grant",
    tenantId: "salon",
    holdingId: "holding",
    customerId: "buyer",
    previousCustomerId: null,
    actorId: "owner",
    saleId: "purchase",
    kind: "GRANT",
    amountBefore: D("0"),
    amountAfter: D("600"),
    delta: D("600"),
    sharedFamilyId: null,
    previousSharedFamilyId: null,
    expiresAt: null,
    reason: "Purchase",
    createdAt: new Date("2026-10-01"),
  };
  const before = {
    ...grant,
    id: "before",
    previousCustomerId: "buyer",
    kind: "SPEND",
    saleId: "usage-before",
    amountBefore: D("600"),
    amountAfter: D("550"),
    delta: D("-50"),
    createdAt: new Date("2026-10-02"),
  };
  const transfer = {
    ...before,
    id: "transfer",
    kind: "TRANSFER",
    saleId: null,
    customerId: "recipient",
    amountBefore: D("550"),
    delta: D("0"),
    reason: "Customer requested transfer",
    createdAt: new Date("2026-10-03"),
  };
  const after = {
    ...before,
    id: "after",
    previousCustomerId: "recipient",
    customerId: "recipient",
    saleId: "usage-after",
    amountBefore: D("550"),
    amountAfter: D("500"),
    createdAt: new Date("2026-10-04"),
  };
  return {
    tenantId: "salon",
    holdingId: "holding",
    originalCustomerId: "buyer",
    customerId: "recipient",
    amount: D("600"),
    amountRemaining: D("500"),
    expiresAt: null,
    balances: [after, transfer, grant, before],
    transfers: [
      {
        id: "audit",
        tenantId: "salon",
        holdingId: "holding",
        fromCustomerId: "buyer",
        toCustomerId: "recipient",
        actorId: "owner",
        amount: D("550"),
        expiresAt: null,
        reason: transfer.reason,
        createdAt: transfer.createdAt,
      },
    ],
  };
}

test("private transfer replay resolves spend-time owners independently of current owner", () => {
  assert.deepEqual([...resolvePayrollValueOwnership(fixture())].sort(), [
    ["after", "recipient"],
    ["before", "buyer"],
  ]);
});

function expiryFixture() {
  const f = fixture();
  const grant = f.balances.find((row) => row.kind === "GRANT")!;
  const spend = f.balances.find((row) => row.id === "before")!;
  grant.expiresAt = new Date("2026-10-02T12:00:00Z");
  spend.expiresAt = grant.expiresAt;
  const expiry = {
    ...spend,
    id: "expiry",
    kind: "EXPIRY_CHANGE",
    saleId: null as string | null,
    amountBefore: D("550"),
    amountAfter: D("550"),
    delta: D("0"),
    expiresAt: new Date("2026-11-01"),
    reason: "Reviewed expiry extension",
    createdAt: new Date("2026-10-02T06:00:00Z"),
  };
  f.balances = [expiry, spend, grant];
  f.transfers = [];
  f.customerId = "buyer";
  f.amountRemaining = D("550");
  f.expiresAt = expiry.expiresAt;
  f.redemptions = [{ saleId: spend.saleId!, customerId: "buyer", usedAt: spend.createdAt }];
  return { f, grant, spend, expiry };
}

test("expiry replay preserves spend-time expiry instead of using current holding expiry", () => {
  const { f, grant, spend, expiry } = expiryFixture();
  const replay = replayPayrollValueOwnership(f);
  assert.equal(replay.expiresAtByBalanceId.get(spend.id)?.getTime(), grant.expiresAt?.getTime());
  assert.equal(replay.expiresAtByBalanceId.get(expiry.id)?.getTime(), expiry.expiresAt.getTime());
  assert.deepEqual([...replay.owners], [[spend.id, "buyer"]]);
});

test("expiry replay rejects unaudited, ambiguous, balance-changing and retroactive edits", () => {
  const changes: ((value: ReturnType<typeof expiryFixture>) => void)[] = [
    ({ expiry }) => {
      expiry.actorId = "";
    },
    ({ expiry }) => {
      expiry.reason = "";
    },
    ({ expiry }) => {
      expiry.saleId = "unrelated-sale";
    },
    ({ expiry }) => {
      expiry.customerId = "foreign";
    },
    ({ expiry }) => {
      expiry.amountAfter = D("549");
      expiry.delta = D("-1");
    },
    ({ expiry, grant }) => {
      expiry.expiresAt = grant.expiresAt!;
    },
    ({ f, expiry }) => {
      f.balances.push({ ...expiry, id: "ambiguous" });
    },
    ({ f }) => {
      f.expiresAt = new Date("2027-01-01");
    },
    ({ f, expiry }) => {
      f.redemptions![0].usedAt = new Date(expiry.createdAt.getTime() + 1);
    },
    ({ f, grant }) => {
      f.redemptions![0].usedAt = grant.expiresAt!;
    },
  ];
  for (const mutate of changes) {
    const value = expiryFixture();
    mutate(value);
    assert.throws(
      () => replayPayrollValueOwnership(value.f),
      /VALUE_OWNERSHIP_HISTORY_UNCONFIRMED/,
    );
  }
});

test("transfer audit may follow its transaction-start ledger timestamp but cannot cross the next operation", () => {
  const f = fixture();
  f.transfers[0].createdAt = new Date("2026-10-03T00:00:00.013Z");
  assert.equal(resolvePayrollValueOwnership(f).get("after"), "recipient");
  f.transfers[0].createdAt = new Date("2026-10-05");
  assert.throws(() => resolvePayrollValueOwnership(f), /VALUE_OWNERSHIP_HISTORY_UNCONFIRMED/);
});

test("round-trip transfers without spending retain balances and reject ambiguous journal order", () => {
  const f = fixture();
  const original = f.balances.find((row) => row.kind === "TRANSFER")!;
  const returned = {
    ...original,
    id: "returned",
    previousCustomerId: "recipient",
    customerId: "buyer",
    createdAt: new Date("2026-10-04"),
  };
  f.balances = [
    f.balances.find((row) => row.kind === "GRANT")!,
    f.balances.find((row) => row.id === "before")!,
    original,
    returned,
  ];
  f.transfers.push({
    ...f.transfers[0],
    id: "return-audit",
    fromCustomerId: "recipient",
    toCustomerId: "buyer",
    createdAt: returned.createdAt,
  });
  f.customerId = "buyer";
  f.amountRemaining = D("550");
  assert.deepEqual([...resolvePayrollValueOwnership(f)], [["before", "buyer"]]);
  f.balances.push({ ...original, id: "ambiguous", customerId: "other" });
  assert.throws(() => resolvePayrollValueOwnership(f), /VALUE_OWNERSHIP_HISTORY_UNCONFIRMED/);
});

test("ownership replay refuses missing, duplicate, foreign, stale and changed transfer evidence", () => {
  const cases: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.transfers = [];
    },
    (f) => {
      f.transfers.push(f.transfers[0]);
    },
    (f) => {
      f.balances = f.balances.filter((row) => row.kind !== "TRANSFER");
    },
    (f) => {
      f.transfers[0].tenantId = "foreign";
    },
    (f) => {
      f.transfers[0].holdingId = "foreign";
    },
    (f) => {
      f.transfers[0].fromCustomerId = "other";
    },
    (f) => {
      f.transfers[0].toCustomerId = "other";
    },
    (f) => {
      f.transfers[0].amount = D("1");
    },
    (f) => {
      f.transfers[0].actorId = "other";
    },
    (f) => {
      f.transfers[0].reason = "Other reason";
    },
    (f) => {
      f.transfers[0].createdAt = new Date("2026-10-05");
    },
    (f) => {
      f.customerId = "buyer";
    },
    (f) => {
      f.balances[0].customerId = "buyer";
    },
    (f) => {
      f.balances[0].sharedFamilyId = "family";
    },
    (f) => {
      f.balances[0].kind = "RESTORE";
    },
    (f) => {
      f.balances[1].createdAt = new Date("2026-10-05");
    },
  ];
  for (const mutate of cases) {
    const f = fixture();
    mutate(f);
    assert.throws(() => resolvePayrollValueOwnership(f), /VALUE_OWNERSHIP_HISTORY_UNCONFIRMED/);
  }
});
