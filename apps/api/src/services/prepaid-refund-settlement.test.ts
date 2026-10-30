import assert from "node:assert/strict";
import { test } from "node:test";
import type { RefundPayrollPackage } from "@glampro_suite/shared";
import { runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";
import {
  recordPrepaidRefundSettlement,
  verifyPrepaidRefundSettlementRetry,
} from "./prepaid-refund-settlement.js";

function fixture() {
  const input: RefundPayrollPackage = {
    idempotencyKey: "confirmed-refund",
    expectedUpdatedAt: "2026-10-30T00:00:00.000Z",
    reason: "Reviewed actual refund",
    adminFeeNetCents: "0",
    payoutGrossCents: "10900",
    payoutMethod: "CASH",
    settlement: { confirmed: true, reference: "cash-voucher-123" },
  };
  const facts = {
    sourceKey: "value-package-refund:confirmed-refund",
    requestHash: "a".repeat(64),
    holdingId: "holding",
    itemType: "VALUE_PACKAGE" as const,
    saleId: "sale",
    saleLineId: "line",
    actorId: "manager",
    actorRole: "MANAGER",
    occurredAt: new Date(),
    netCents: 10000n,
    taxCents: 900n,
    cancelledGrossCents: 2000n,
    evidence: { holding: { amountRemaining: "100.00" }, allocation: { netCents: 10000n } },
  };
  let row: Record<string, unknown> | null = null;
  let writes = 0;
  const actor = { id: "manager", globalRole: "MANAGER", twoFactorEnabled: false };
  const tx = {
    user: { findFirst: async () => actor },
    prepaidRefundSettlement: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes++;
        row = data;
        return data;
      },
      findFirst: async () => row,
    },
  } as unknown as PayrollCloseTransaction;
  const record = () =>
    runAsTenant("salon", () => recordPrepaidRefundSettlement(tx, input, facts), "manager");
  const retry = () =>
    runAsTenant(
      "salon",
      () => verifyPrepaidRefundSettlementRetry(tx, input, facts.sourceKey, facts.requestHash),
      "manager",
    );
  return {
    input,
    facts,
    actor,
    record,
    retry,
    tx,
    get row() {
      return row;
    },
    get writes() {
      return writes;
    },
  };
}

test("settlement freezes independent operational facts and retries without a second payout", async () => {
  const f = fixture();
  await f.record();
  assert.equal(f.writes, 1);
  assert.equal(f.row?.grossCents, 10900n);
  assert.equal(f.row?.cancelledGrossCents, 2000n);
  f.facts.evidence.holding.amountRemaining = "0.00";
  assert.equal(
    (f.row?.evidence as { operational: typeof f.facts.evidence }).operational.holding
      .amountRemaining,
    "100.00",
  );
  await f.retry();
  assert.equal(f.writes, 1);
  f.input.settlement!.reference = "changed-reference";
  await assert.rejects(f.retry, /unavailable/);
});

test("legacy capture and retry never fabricate missing settlement", async () => {
  const f = fixture();
  await assert.rejects(f.retry, /unavailable/);
  delete f.input.settlement;
  await f.record();
  assert.equal(f.writes, 0);
});

test("zero payout cancellation records NONE without creating money", async () => {
  const f = fixture();
  f.input.payoutGrossCents = "0";
  f.input.payoutMethod = "NONE";
  f.facts.netCents = 0n;
  f.facts.taxCents = 0n;
  await f.record();
  assert.equal(f.row?.grossCents, 0n);
  assert.equal(f.row?.cancelledGrossCents, 2000n);
  assert.equal(f.row?.payoutMethod, "NONE");
  await f.retry();
  assert.equal(f.writes, 1);
});

test("settlement refuses foreign actor, outlet context, disabled authorization and invalid money", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.facts.actorId = "foreign";
    },
    (f: ReturnType<typeof fixture>) => {
      f.actor.globalRole = "STAFF";
    },
    (f: ReturnType<typeof fixture>) => {
      f.actor.globalRole = f.facts.actorRole = "SUPER_ADMIN";
    },
    (f: ReturnType<typeof fixture>) => {
      f.input.payoutGrossCents = "1";
    },
    (f: ReturnType<typeof fixture>) => {
      f.facts.cancelledGrossCents = -1n;
    },
    (f: ReturnType<typeof fixture>) => {
      f.input.payoutMethod = "NONE";
    },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(f.record);
    assert.equal(f.writes, 0);
  }
  const f = fixture();
  await assert.rejects(
    runAsTenant(
      "salon",
      () => runAtOutlet("branch", () => recordPrepaidRefundSettlement(f.tx, f.input, f.facts)),
      "manager",
    ),
    /salon-wide/,
  );
  assert.equal(f.writes, 0);
});
