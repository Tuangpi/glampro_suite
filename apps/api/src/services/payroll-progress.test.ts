import assert from "node:assert/strict";
import { test } from "node:test";
import {
  payrollProgressViewSchema,
  type PayrollPlanDefinition,
  type PayrollStatementInput,
} from "@glampro_suite/shared";
import { salonDayBounds } from "../lib/wall-clock.js";
import {
  calculatePayrollClose,
  openPayrollClose,
  type PayrollCloseInputs,
  type PayrollCloseState,
} from "./payroll-close-state.js";
import { payrollPeriodReport } from "./payroll-report.js";
import { ownPayrollStatement, payrollProgressView, salonPeriodKey } from "./payroll-progress.js";
import {
  approvedPayrollExportState,
  calculatedPayrollExportState,
  exportOwner,
} from "./payroll-export.test-helper.js";

/**
 * CP-006 MTD/POS progress (FR-RPT-04, FR-POS-09) and own-data summaries (FR-RPT-05).
 *
 * The projection is pure, so these tests are the place where "estimated and reconciles
 * to the same frozen inputs and rules" is actually checked: a frozen month must equal
 * the period report to the cent, and a salary field must never appear anywhere.
 */

const PERIOD = "2026-09";
const TIME_ZONE = "Asia/Singapore";

/** A banded plan so the band rate and the distance to the next band are real values. */
const tierPlan: PayrollPlanDefinition = {
  stages: [{ key: "junior", name: "Junior stylist", fromMonth: 1, toMonth: null }],
  components: [
    {
      key: "svc",
      name: "Service tier",
      commissionTypes: ["SVC"],
      basePct: "100",
      method: "TIER_SLICE",
      bands: [
        { upperLimit: "5000", ratePct: "5", applyMode: "SLICE" },
        { upperLimit: null, ratePct: "8", applyMode: "SLICE" },
      ],
      sort: 0,
    },
  ],
  incentives: [],
};

function bandedStaff(): PayrollStatementInput {
  return {
    staff: { id: "staff-a", name: "Alice Tan", disabled: false },
    profile: {
      basicSalary: "2400.00",
      fixedOvertime: "120.00",
      levy: "60.00",
      salesAlertPct: "50",
    },
    profileRevision: 2,
    adjustments: [],
    collection: "1000",
    calculation: {
      staffId: "staff-a",
      periodKey: PERIOD,
      joinDate: "2026-07-01",
      plan: { planId: "plan-tier", versionId: "plan-tier-v1", definition: tierPlan },
      lines: [
        {
          id: "line-a-1",
          staffId: "staff-a",
          outletId: "outlet-a",
          commissionType: "SVC",
          baseAmount: "4000",
          units: "2",
          businessDate: "2026-09-12",
          status: "EARNED",
          mode: "FOLLOW_PLAN",
        },
      ],
    },
  };
}

function bandedInputs(): PayrollCloseInputs {
  return {
    periodKey: PERIOD,
    timeZone: TIME_ZONE,
    startsAt: salonDayBounds(`${PERIOD}-01`, TIME_ZONE).from.toISOString(),
    endsAt: salonDayBounds("2026-10-01", TIME_ZONE).from.toISOString(),
    currency: "SGD",
    evidence: { source: "progress-fixture" },
    staff: [bandedStaff()],
  };
}

/** Calculated but unapproved: an estimate over the engine's own output. */
function estimatedState(): PayrollCloseState {
  const open = openPayrollClose(PERIOD);
  return calculatePayrollClose(
    open,
    open.revision,
    bandedInputs(),
    exportOwner,
    "2026-10-01T00:10:00.000Z",
  );
}

const planNames = new Map([["plan-tier", "Tiered service plan"]]);

test("an approved month reports the frozen figures and reconciles to the period report", () => {
  const state = approvedPayrollExportState();
  const view = payrollProgressViewSchema.parse(
    payrollProgressView(state, { scope: "SALON", planNames: new Map([["plan", "Service plan"]]) }),
  );
  const report = payrollPeriodReport(state);
  assert.equal(view.basis, "APPROVED");
  assert.equal(view.estimated, false);
  assert.equal(view.calculation?.inputHash, state.calculation?.inputHash);
  assert.equal(view.approval?.at, state.approval?.at);
  assert.equal(view.currency, "SGD");
  assert.equal(view.timeZone, TIME_ZONE);
  // The same frozen statements, so every shared total matches the CP-006 report exactly.
  assert.equal(view.totals.commission, report.totals.commission);
  assert.equal(view.totals.incentive, report.totals.incentive);
  assert.equal(view.totals.baseAmount, report.totals.baseAmount);
  assert.equal(view.totals.units, report.totals.units);
  assert.equal(view.totals.lines, report.totals.lines);
  assert.equal(view.totals.staff, report.totals.staff);
  for (const row of view.rows) {
    const reported = report.staff.find((item) => item.staff.id === row.staff.id);
    assert.ok(reported, row.staff.id);
    assert.equal(row.commission, reported.payroll.commission);
    assert.equal(row.incentive, reported.payroll.incentive);
    assert.equal(row.baseAmount, reported.baseAmount);
    assert.equal(row.lines, reported.lines);
  }
  // The estimate is exactly the month's commission plus incentive, to the cent.
  assert.equal(view.totals.commission, "200.00");
  assert.equal(view.totals.incentive, "50.00");
  assert.equal(view.totals.estimate, "250.00");
});

test("an unapproved month is labelled an estimate and carries the snapshot time", () => {
  const state = calculatedPayrollExportState();
  const view = payrollProgressView(state, {
    scope: "SALON",
    planNames: new Map([["plan", "Service plan"]]),
  });
  assert.equal(view.status, "CALCULATED");
  assert.equal(view.basis, "ESTIMATED");
  assert.equal(view.estimated, true);
  assert.equal(view.approval, null);
  assert.equal(view.calculation?.calculatedAt, "2026-10-01T00:10:00.000Z");
  // The report refuses a draft, so compare against the same statements it reads when frozen.
  const frozen = {
    ...state,
    status: "APPROVED" as const,
    approval: { at: "2026-10-02T02:00:00.000Z", actorId: "owner", reason: "fixture" },
  };
  const report = payrollPeriodReport(frozen);
  assert.equal(view.totals.commission, report.totals.commission);
  assert.equal(view.totals.baseAmount, report.totals.baseAmount);
  assert.equal(view.totals.lines, report.totals.lines);
});

test("a month nobody calculated reports nothing rather than a zero", () => {
  const view = payrollProgressView(openPayrollClose(PERIOD), { scope: "SALON" });
  assert.equal(view.basis, "NOT_CALCULATED");
  assert.equal(view.estimated, true);
  assert.equal(view.calculation, null);
  assert.equal(view.approval, null);
  assert.equal(view.currency, null);
  assert.deepEqual(view.rows, []);
  assert.deepEqual(view.totals, {
    staff: 0,
    lines: 0,
    baseAmount: "0.0000",
    units: "0.0000",
    commission: "0.00",
    incentive: "0.00",
    estimate: "0.00",
  });
  assert.equal(payrollProgressViewSchema.safeParse(view).success, true);
});

test("the banded row copies the engine's band, rate and distance to the next band", () => {
  const state = estimatedState();
  const statement = state.calculation!.statements[0]!;
  const view = payrollProgressView(state, { scope: "SALON", planNames });
  const [row] = view.rows;
  const component = statement.result.components[0]!;
  assert.ok(row);
  assert.equal(row.planId, "plan-tier");
  assert.equal(row.planName, "Tiered service plan");
  assert.equal(row.stageKey, "junior");
  assert.equal(row.stageName, "Junior stylist");
  assert.equal(row.tenureMonth, 3);
  assert.equal(row.mainComponent, "Service tier");
  assert.equal(row.mainBase, "4000.0000");
  assert.equal(row.mainBase, component.pooledBase);
  assert.equal(row.currentRate, "5");
  assert.equal(row.currentRate, component.ratePct);
  assert.equal(row.nextThreshold, "5000.0000");
  assert.equal(row.gapToNext, "1000.0001");
  assert.equal(row.gapToNext, component.gapToNext);
  assert.equal(row.baseAmount, "4000.0000");
  assert.equal(row.units, "2.0000");
  assert.equal(row.commission, "200.00");
  assert.equal(row.estimate, "200.00");
  assert.equal(row.components[0]?.bandIndex, 0);
});

test("a plan-less statement reports the flat fallback instead of inventing a band", () => {
  const state = approvedPayrollExportState();
  const view = payrollProgressView(state, { scope: "SALON" });
  const flat = view.rows.find((row) => row.staff.id === "staff-b");
  assert.ok(flat);
  assert.equal(flat.planId, null);
  assert.equal(flat.planName, null);
  assert.equal(flat.mainComponent, null);
  assert.equal(flat.mainBase, "0.0000");
  assert.equal(flat.currentRate, null);
  assert.equal(flat.gapToNext, null);
  assert.equal(flat.stageKey, "std");
  assert.equal(flat.stageName, "Standard");
});

test("a self read returns only that staff member's line", () => {
  const state = approvedPayrollExportState();
  const own = payrollProgressView(state, { scope: "SELF", staffId: "staff-b" });
  assert.equal(own.scope, "SELF");
  assert.deepEqual(
    own.rows.map((row) => row.staff.id),
    ["staff-b"],
  );
  assert.equal(own.totals.staff, 1);
  const stranger = payrollProgressView(state, { scope: "SELF", staffId: "someone-else" });
  assert.deepEqual(stranger.rows, []);
  assert.equal(stranger.totals.commission, "0.00");
  // The salon read still shows everyone, so the filter is the caller's scope alone.
  assert.deepEqual(
    payrollProgressView(state, { scope: "SALON" }).rows.map((row) => row.staff.id),
    ["staff-a", "staff-b"],
  );
});

test("no salary, take-home or raw profile reaches the progress projection", () => {
  for (const state of [approvedPayrollExportState(), estimatedState()]) {
    const serialised = JSON.stringify(payrollProgressView(state, { scope: "SALON", planNames }));
    for (const forbidden of ["basicSalary", "fixedOvertime", "takeHome", "levy", "profile"])
      assert.equal(serialised.includes(forbidden), false, forbidden);
  }
});

test("own statements are frozen months only, and carry no salary", () => {
  const approved = approvedPayrollExportState();
  const own = ownPayrollStatement(approved, "staff-a");
  assert.ok(own);
  assert.equal(own.periodKey, PERIOD);
  assert.equal(own.status, "APPROVED");
  assert.equal(own.approvedAt, approved.approval?.at);
  assert.equal(own.paidAt, null);
  assert.equal(own.commission, "200.00");
  assert.equal(own.lines, 2);
  const serialised = JSON.stringify(own);
  for (const forbidden of ["basicSalary", "takeHome", "levy", "staff-a"])
    assert.equal(serialised.includes(forbidden), false, forbidden);
  // A draft is never a payslip, and another person's statement is never returned.
  assert.equal(ownPayrollStatement(calculatedPayrollExportState(), "staff-a"), null);
  assert.equal(ownPayrollStatement(approved, "someone-else"), null);
});

test("the default progress month is the salon-local one, not the server's UTC month", () => {
  // 17:00 UTC on 31 October is already 01:00 on 1 November in Singapore.
  assert.equal(salonPeriodKey(TIME_ZONE, new Date("2026-10-31T17:00:00.000Z")), "2026-11");
  assert.equal(salonPeriodKey(TIME_ZONE, new Date("2026-10-31T15:59:59.000Z")), "2026-10");
  assert.equal(salonPeriodKey("UTC", new Date("2026-10-31T23:59:59.000Z")), "2026-10");
});
