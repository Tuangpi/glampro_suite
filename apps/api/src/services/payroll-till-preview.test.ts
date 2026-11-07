import assert from "node:assert/strict";
import { test } from "node:test";
import { previewTillCommission, tillPreviewSchema } from "./payroll-till-preview.js";
import { calculatedPayrollExportState } from "./payroll-export.test-helper.js";
import { openPayrollClose } from "./payroll-close-state.js";
import { payrollProgressRow } from "./payroll-progress.js";

const input = {
  commissionType: "SVC",
  baseAmount: "100",
  quantity: 1,
  shares: [{ staffId: "staff-a", share: 10000 }],
};
test("till preview uses the plan delta and does not mutate the calculation", () => {
  const state = calculatedPayrollExportState();
  const before = JSON.stringify(state);
  const result = previewTillCommission(state, input);
  assert.equal(result.rows.length, 1);
  assert.notEqual(result.rows[0].amount, null);
  assert.equal(JSON.stringify(state), before);
});
test("missing calculations and fallback staff are unavailable, never invented zeroes", () => {
  assert.equal(previewTillCommission(openPayrollClose("2026-09"), input).rows[0].amount, null);
  assert.equal(
    previewTillCommission(calculatedPayrollExportState(), {
      ...input,
      shares: [{ staffId: "staff-b", share: 10000 }],
    }).rows[0].amount,
    null,
  );
});
test("split allocations bind to staff identity, not caller order", () => {
  const state = calculatedPayrollExportState();
  const shares = [
    { staffId: "staff-b", share: 2500 },
    { staffId: "staff-a", share: 7500 },
  ];
  const first = previewTillCommission(state, { ...input, shares });
  const second = previewTillCommission(state, { ...input, shares: [...shares].reverse() });
  assert.deepEqual(
    first.rows.find((row) => row.staffId === "staff-a"),
    second.rows.find((row) => row.staffId === "staff-a"),
  );
});
test("preview refuses malformed splits and unsupported source types", () => {
  assert.equal(tillPreviewSchema.safeParse({ ...input, commissionType: "UNKNOWN" }).success, false);
  assert.equal(tillPreviewSchema.safeParse({ ...input, baseAmount: "-1" }).success, false);
  assert.equal(
    tillPreviewSchema.safeParse({ ...input, shares: [{ staffId: "staff-a", share: 5000 }] })
      .success,
    false,
  );
});
test("own activity excludes reversed lines and exposes bases, not per-type earnings", () => {
  const statement = calculatedPayrollExportState().calculation!.statements[0];
  const row = payrollProgressRow(statement, "Plan");
  assert.deepEqual(
    row.activity?.find((item) => item.commissionType === "SVC"),
    { commissionType: "SVC", baseAmount: "2000.0000", units: "1.0000" },
  );
  assert.deepEqual(
    row.activity?.find((item) => item.commissionType === "PRD"),
    { commissionType: "PRD", baseAmount: "0.0000", units: "0.0000" },
  );
});
test("trusted source context resolves categories, outlet fallback, exclusion and fixed awards", () => {
  const state = calculatedPayrollExportState();
  const calculation = state.calculation!.statements[0].inputs.calculation;
  calculation.plan!.definition.components[0].categoryInclude = ["hair"];
  const source = {
    outletId: "outlet-a",
    category: "hair",
    businessDate: "2026-09-15",
    mode: "FOLLOW_PLAN" as const,
    fallbackRates: new Map([["staff-a", "5"]]),
  };
  assert.equal(previewTillCommission(state, input, source).rows[0].amount, "10.00");
  assert.equal(
    previewTillCommission(state, input, { ...source, category: "nails" }).rows[0].amount,
    "0.00",
  );
  calculation.plan!.outletIds = ["outlet-a"];
  assert.equal(
    previewTillCommission(state, input, { ...source, outletId: "outlet-b" }).rows[0].amount,
    "5.00",
  );
  assert.equal(
    previewTillCommission(state, input, { ...source, mode: "EXCLUDE" }).rows[0].amount,
    "0.00",
  );
  assert.equal(
    previewTillCommission(state, input, { ...source, mode: "FIXED", fixedCommission: "8.25" })
      .rows[0].amount,
    "8.25",
  );
});
