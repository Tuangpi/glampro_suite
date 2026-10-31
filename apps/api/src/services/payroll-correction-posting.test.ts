import assert from "node:assert/strict";
import { test } from "node:test";
import {
  selectPayrollCorrectionPosting as select,
  verifyPayrollCorrectionPosting as verify,
} from "./payroll-correction-posting.js";
import { payrollInputHash } from "./payroll-close-state.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

function fixture() {
  const rows = [
    { periodKey: "2026-10", revision: 2, status: "APPROVED" },
    { periodKey: "2026-11", revision: 4, status: "APPROVED" },
    { periodKey: "2026-12", revision: 1, status: "CALCULATED" },
  ].map((state) => ({ ...state, state, tenantId: "salon" }));
  const audits = rows.map((row) => ({
    ...row,
    stateHash: payrollInputHash(row.state),
    createdAt: new Date("2026-10-01"),
  }));
  const tx = {
    tenant: { findUniqueOrThrow: async () => ({ timeZone: "Asia/Singapore" }) },
    payrollClose: { findMany: async () => rows },
    payrollCloseEvent: {
      findFirst: async ({ where }: { where: { periodKey: string; revision?: number } }) =>
        audits.find(
          (row) =>
            row.periodKey === where.periodKey &&
            (where.revision === undefined || row.revision === where.revision),
        ) ?? null,
    },
  } as unknown as PayrollCloseTransaction;
  return { rows, audits, tx };
}
const originalAt = new Date("2026-09-15T00:00:00Z");
const at = new Date("2026-10-15T00:00:00Z");

test("correction selection skips consecutive approved months and freezes future posting separately", async () => {
  const { tx } = fixture();
  const result = await select(tx, "salon", originalAt, at);
  assert.equal(result.periodKey, "2026-12");
  assert.equal(result.postingAt, "2026-11-30T16:00:00.000Z");
  assert.equal(result.correctionAt, at.toISOString());
  assert.deepEqual(
    result.inspectedPeriods.map((row) => row.revision),
    [2, 4, 1],
  );
  assert.deepEqual(await verify(tx, "salon", originalAt, result), result);
});

test("an absent next close is explicit revision-zero OPEN, never skipped", async () => {
  const f = fixture();
  f.rows.splice(1);
  f.audits.splice(1);
  const result = await select(f.tx, "salon", originalAt, at);
  assert.equal(result.periodKey, "2026-11");
  assert.deepEqual(result.inspectedPeriods[1], {
    periodKey: "2026-11",
    revision: 0,
    status: "OPEN",
    stateHash: null,
  });
  assert.deepEqual(await verify(f.tx, "salon", originalAt, result), result);
  f.audits.push({
    tenantId: "salon",
    periodKey: "2026-11",
    revision: 1,
    status: "CALCULATED",
    state: { periodKey: "2026-11", revision: 1, status: "CALCULATED" },
    stateHash: "unused",
    createdAt: new Date(at.getTime() - 1),
  });
  await assert.rejects(verify(f.tx, "salon", originalAt, result), /posting evidence/);
});

test("posting verification rejects altered dates, skipped open months and corrupt close audit hashes", async () => {
  const f = fixture();
  const result = await select(f.tx, "salon", originalAt, at);
  for (const altered of [
    { ...result, periodKey: "2027-01" },
    { ...result, originalPeriodKey: "2026-08" },
    { ...result, postingAt: at.toISOString() },
    { ...result, inspectedPeriods: result.inspectedPeriods.slice(1) },
    {
      ...result,
      inspectedPeriods: result.inspectedPeriods.map((row, index) =>
        index === 0 ? { ...row, status: "OPEN" } : row,
      ),
    },
  ])
    await assert.rejects(verify(f.tx, "salon", originalAt, altered), /posting evidence/);
  f.audits[0].stateHash = "corrupt";
  await assert.rejects(select(f.tx, "salon", originalAt, at), /posting evidence/);
  await assert.rejects(verify(f.tx, "salon", originalAt, result), /posting evidence/);
  await assert.rejects(
    select(f.tx, "salon", originalAt, new Date("2026-09-01")),
    /posting evidence/,
  );
});
