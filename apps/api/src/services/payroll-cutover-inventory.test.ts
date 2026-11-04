import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyPayrollCutover,
  nextPeriodKey,
  payrollCutoverBlockers,
  payrollCutoverWindow,
  previousPeriodKey,
  type PayrollCutoverClassificationInput,
  type PayrollCutoverLegacyRow,
} from "./payroll-cutover-inventory.js";

let sequence = 0;

/** One legacy earning with the least interesting defaults: paid, traceable, ten dollars. */
function row(
  overrides: Partial<PayrollCutoverLegacyRow> & { periodKey: string },
): PayrollCutoverLegacyRow {
  sequence += 1;
  return {
    id: `legacy-${sequence}`,
    staffId: "staff-1",
    saleId: "sale-1",
    amount: "10.00",
    paid: false,
    clawback: false,
    ...overrides,
  };
}

function input(
  overrides: Partial<PayrollCutoverClassificationInput> = {},
): PayrollCutoverClassificationInput {
  return {
    periodKeys: ["2026-08", "2026-09"],
    currentPeriodKey: "2026-09",
    effectivePeriodKey: "2026-09",
    legacy: [],
    payroll: [],
    ...overrides,
  };
}

test("month arithmetic walks across year boundaries", () => {
  assert.equal(previousPeriodKey("2026-01"), "2025-12");
  assert.equal(nextPeriodKey("2026-12"), "2027-01");
  assert.deepEqual(payrollCutoverWindow("2026-02", 4), [
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
  ]);
  assert.deepEqual(payrollCutoverWindow("2026-02", 1), ["2026-02"]);
});

test("coverage starts at the activation month and nothing before it is covered", () => {
  const result = classifyPayrollCutover(
    input({ legacy: [row({ periodKey: "2026-08", paid: true })] }),
  );

  assert.deepEqual(
    result.months.map((month) => [month.periodKey, month.covered]),
    [
      ["2026-08", false],
      ["2026-09", true],
    ],
  );
  assert.equal(result.totals.coveredMonths, 1);
  // A historic payout is evidence, not a decision: it cannot block an activation.
  assert.deepEqual(result.issues, []);
  assert.equal(result.months[0]!.verdict, "ALREADY_PAID");
});

test("paying the same sale twice inside the covered month is a blocker", () => {
  const result = classifyPayrollCutover(
    input({ legacy: [row({ periodKey: "2026-09", paid: true })] }),
  );

  assert.deepEqual(
    payrollCutoverBlockers(result.issues).map((issue) => [issue.code, issue.severity]),
    [["LEGACY_PAYOUT_INSIDE_COVERED_MONTH", "BLOCKER"]],
  );
  assert.deepEqual(result.months[1]!.legacy.paid, { rows: 1, amount: "10.00" });
  assert.equal(result.months[1]!.verdict, "ALREADY_PAID");
});

test("an unpaid earning no plan can re-derive blocks, an untraceable payout only warns", () => {
  const result = classifyPayrollCutover(
    input({
      legacy: [
        row({ periodKey: "2026-08", saleId: null, paid: true }),
        row({ periodKey: "2026-09", saleId: null }),
      ],
    }),
  );

  assert.deepEqual(
    result.issues.map((issue) => [issue.code, issue.severity, issue.periodKey]),
    [
      ["LEGACY_WITHOUT_SALE", "WARNING", "2026-08"],
      ["LEGACY_EARNING_WITHOUT_SOURCE", "BLOCKER", "2026-09"],
    ],
  );
  assert.equal(result.months[0]!.verdict, "ALREADY_PAID");
  assert.equal(result.months[1]!.verdict, "INCOMPLETE");
  assert.deepEqual(
    payrollCutoverBlockers(result.issues).map((issue) => issue.code),
    ["LEGACY_EARNING_WITHOUT_SOURCE"],
  );
});

test("an outstanding clawback blocks even in a month the plan will not pay", () => {
  const result = classifyPayrollCutover(
    input({ legacy: [row({ periodKey: "2026-08", clawback: true, paid: true })] }),
  );

  assert.deepEqual(
    result.issues.map((issue) => [issue.code, issue.severity]),
    [["LEGACY_CLAWBACK_OUTSTANDING", "BLOCKER"]],
  );
  assert.deepEqual(result.months[0]!.legacy.clawback, { rows: 1, amount: "10.00" });
});

test("an activation month before the current month is refused", () => {
  const result = classifyPayrollCutover(input({ effectivePeriodKey: "2026-08" }));

  assert.deepEqual(
    result.issues.map((issue) => [issue.code, issue.severity, issue.periodKey]),
    [["EFFECTIVE_PERIOD_PRECEDES_CURRENT_MONTH", "BLOCKER", "2026-08"]],
  );
  assert.equal(result.totals.coveredMonths, 2);
});

test("unpaid traceable rows are acknowledged warnings, aggregated exactly per staff", () => {
  const result = classifyPayrollCutover(
    input({
      legacy: [
        row({ periodKey: "2026-09", amount: "0.10" }),
        row({ periodKey: "2026-09", amount: "0.20" }),
        row({ periodKey: "2026-09", amount: "5.00", staffId: "staff-2" }),
      ],
    }),
  );

  assert.deepEqual(result.issues, [
    {
      code: "LEGACY_EARNING_SUPERSEDED",
      severity: "WARNING",
      periodKey: "2026-09",
      staffId: "staff-1",
      rows: 2,
      amount: "0.30",
    },
    {
      code: "LEGACY_EARNING_SUPERSEDED",
      severity: "WARNING",
      periodKey: "2026-09",
      staffId: "staff-2",
      rows: 1,
      amount: "5.00",
    },
  ]);
  // Plan payroll re-derives every one of these, so the month is still reliable.
  assert.equal(result.months[1]!.verdict, "RELIABLE");
  assert.deepEqual(result.totals.legacy.total, { rows: 3, amount: "5.30" });
  assert.deepEqual(result.totals.legacy.unpaid, { rows: 3, amount: "5.30" });
  assert.deepEqual(result.totals.legacy.paid, { rows: 0, amount: "0.00" });
  assert.deepEqual(payrollCutoverBlockers(result.issues), []);
});

test("a dry run with no activation month classifies past months without covering them", () => {
  const result = classifyPayrollCutover(
    input({
      effectivePeriodKey: null,
      legacy: [row({ periodKey: "2026-09", paid: true })],
      payroll: [{ periodKey: "2026-09", status: "APPROVED", payoutConfirmed: true }],
    }),
  );

  assert.equal(result.totals.coveredMonths, 0);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.months[1]!.payroll, { status: "APPROVED", payoutConfirmed: true });
  assert.deepEqual(result.months[0]!.payroll, { status: null, payoutConfirmed: false });
});
