import assert from "node:assert/strict";
import { test } from "node:test";
import { hairPayrollExample, calculatePayrollStaffPeriod } from "@glampro_suite/shared";
import {
  approvePayrollClose,
  calculatePayrollClose,
  openPayrollClose,
  payrollInputHash,
  type PayrollCloseInputs,
} from "./payroll-close-state.js";
import { resolvePayrollCloseCarry, type PayrollCloseCarryRecords } from "./payroll-close-carry.js";

function fixture(planned = false): PayrollCloseCarryRecords {
  const owner = { id: "owner", role: "SUPER_ADMIN", disabled: false, twoFactorEnabled: true };
  const inputs: PayrollCloseInputs = {
    periodKey: "2026-09",
    timeZone: "Asia/Singapore",
    currency: "SGD",
    startsAt: "2026-08-31T16:00:00.000Z",
    endsAt: "2026-09-30T16:00:00.000Z",
    evidence: { sourceIds: ["negative-source"] },
    staff: [
      {
        staff: { id: "departed", name: "Departed", disabled: true },
        profile: { basicSalary: "2000", fixedOvertime: "0", levy: "100", salesAlertPct: "50" },
        profileRevision: 1,
        collection: "0",
        adjustments: [],
        calculation: {
          staffId: "departed",
          periodKey: "2026-09",
          joinDate: "2020-01-01",
          plan: planned
            ? {
                planId: "hair",
                versionId: "v1",
                definition: { ...hairPayrollExample(), incentives: [] },
              }
            : null,
          lines: [
            {
              id: "line",
              staffId: "departed",
              outletId: "branch",
              commissionType: "SVC",
              baseAmount: "-100.0000",
              units: "0.0000",
              businessDate: "2026-09-15",
              mode: "FOLLOW_PLAN",
              status: "EARNED",
              fallbackRatePct: "10",
            },
          ],
        },
      },
    ],
  };
  const at = "2026-10-01T00:00:00.000Z";
  const draft = calculatePayrollClose(openPayrollClose("2026-09"), 0, inputs, owner, at);
  const state = approvePayrollClose(draft, 1, inputs, owner, at, "Reviewed prior close");
  return {
    tenantId: "salon",
    periodKey: "2026-10",
    previous: { id: "prior-close", tenantId: "salon", state },
  };
}

test("approved fallback debt retains exact resolved money and departed staff", () => {
  const result = resolvePayrollCloseCarry(fixture());
  assert.equal(result.status, "CARRY_EVIDENCE_READY");
  assert.equal(result.earningsActive, false);
  assert.deepEqual(result.carry!.staff, [
    { staffId: "departed", carryForward: [], fallbackCarryCommission: "-10.0000000000" },
  ]);
  assert.deepEqual(result.carry!.requiredStaffIds, ["departed"]);
  assert.equal(result.carry!.previousCloseId, "prior-close");
  assert.doesNotThrow(() => payrollInputHash(result));
});

test("component debt retains stable keys and four-decimal bases without repricing", () => {
  const result = resolvePayrollCloseCarry(fixture(true));
  assert.equal(result.status, "CARRY_EVIDENCE_READY");
  assert.ok(result.carry!.staff[0].carryForward.some((row) => row.base === "-100.0000"));
  assert.equal(result.carry!.staff[0].fallbackCarryCommission, "0.0000000000");
});

test("missing prior close never becomes assumed zero carry", () => {
  const result = resolvePayrollCloseCarry({ ...fixture(), previous: null });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.carry, null);
  assert.deepEqual(result.blockers, ["APPROVED_PREVIOUS_CLOSE_UNAVAILABLE"]);
});

test("draft, unapproved and wrong-month closes cannot provide carry", () => {
  for (const change of [
    (input: PayrollCloseCarryRecords) => {
      input.previous!.state.status = "CALCULATED";
    },
    (input: PayrollCloseCarryRecords) => {
      input.previous!.state.approval = null;
    },
    (input: PayrollCloseCarryRecords) => {
      input.previous!.state.calculation = null;
    },
    (input: PayrollCloseCarryRecords) => {
      input.previous!.state.periodKey = "2026-08";
    },
  ]) {
    const input = fixture();
    change(input);
    assert.equal(resolvePayrollCloseCarry(input).carry, null);
  }
});

test("cross-tenant prior close fails closed", () => {
  const input = fixture();
  input.previous!.tenantId = "other";
  assert.throws(() => resolvePayrollCloseCarry(input), /another salon/);
});

test("modified frozen inputs, outputs, carry or calculation version are unavailable", () => {
  for (const change of [
    (input: PayrollCloseCarryRecords) => {
      input.previous!.state.calculation!.inputs.staff[0].profile.basicSalary = "9999";
    },
    (input: PayrollCloseCarryRecords) => {
      input.previous!.state.calculation!.statements[0].payroll.takeHome = "9999.00";
    },
    (input: PayrollCloseCarryRecords) => {
      input.previous!.state.calculation!.statements[0].result.fallbackCarryCommission =
        "0.0000000000";
    },
    (input: PayrollCloseCarryRecords) => {
      input.previous!.state.calculation!.inputHash = "wrong";
    },
    (input: PayrollCloseCarryRecords) => {
      input.previous!.state.calculation!.version = "unknown-version";
    },
    (input: PayrollCloseCarryRecords) => {
      input.previous!.state.calculation!.inputs.staff.push(
        structuredClone(input.previous!.state.calculation!.inputs.staff[0]),
      );
    },
    (input: PayrollCloseCarryRecords) => {
      input.previous!.state.adjustments.push({
        id: "new",
        staffId: "departed",
        kind: "ADDITION",
        amount: "1.00",
        actorId: "owner",
        reason: "Changed audit",
      });
    },
  ]) {
    const input = fixture();
    change(input);
    assert.deepEqual(resolvePayrollCloseCarry(input).blockers, ["PREVIOUS_CLOSE_SNAPSHOT_INVALID"]);
  }
});

test("approval timing, actor, reason and revision are validated", () => {
  for (const change of [
    (input: PayrollCloseCarryRecords) => {
      input.previous!.state.approval!.at = "2026-09-01T00:00:00.000Z";
    },
    (input: PayrollCloseCarryRecords) => {
      input.previous!.state.approval!.actorId = "";
    },
    (input: PayrollCloseCarryRecords) => {
      input.previous!.state.approval!.reason = "";
    },
    (input: PayrollCloseCarryRecords) => {
      input.previous!.state.revision = -1;
    },
    (input: PayrollCloseCarryRecords) => {
      input.previous!.state.calculation!.calculatedAt = "2026-10-02T00:00:00.000Z";
    },
  ]) {
    const input = fixture();
    change(input);
    assert.equal(resolvePayrollCloseCarry(input).carry, null);
  }
});

test("resolved debt offsets future source-rate earnings without repricing the old debt", () => {
  const debt = resolvePayrollCloseCarry(fixture()).carry!.staff[0];
  const calculation = structuredClone(
    fixture().previous!.state.calculation!.inputs.staff[0].calculation,
  );
  calculation.periodKey = "2026-10";
  calculation.lines[0].businessDate = "2026-10-10";
  calculation.lines[0].baseAmount = "100";
  calculation.lines[0].fallbackRatePct = "20";
  calculation.fallbackCarryCommission = debt.fallbackCarryCommission;
  assert.equal(calculatePayrollStaffPeriod(calculation).commissionTotal, "10.00");
  calculation.plan = {
    planId: "hair",
    versionId: "v2",
    definition: { ...hairPayrollExample(), incentives: [] },
  };
  assert.throws(() => calculatePayrollStaffPeriod(calculation), /explicit settlement/);
});

test("returned evidence is a deep copy and resolution does not mutate frozen history", () => {
  const input = fixture(true);
  const before = structuredClone(input);
  const result = resolvePayrollCloseCarry(input);
  assert.deepEqual(input, before);
  result.carry!.staff[0].carryForward[0].base = "0.0000";
  result.carry!.calculation!.inputs.staff[0].profile.basicSalary = "9999";
  assert.deepEqual(input, before);
});

test("January requires the preceding December close, not a same-year month", () => {
  const input = fixture();
  input.periodKey = "2027-01";
  const result = resolvePayrollCloseCarry(input);
  assert.equal(result.previousPeriodKey, "2026-12");
  assert.equal(result.carry, null);
});
