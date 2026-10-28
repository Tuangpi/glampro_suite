import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adjustPayrollClose,
  approvePayrollClose,
  calculatePayrollClose,
  confirmPayrollPayout,
  openPayrollClose,
  payrollInputHash,
  type PayrollCloseActor,
  type PayrollCloseInputs,
  readFrozenPayrollStatement,
} from "./payroll-close-state.js";

const manager: PayrollCloseActor = {
  id: "manager",
  role: "MANAGER",
  disabled: false,
  twoFactorEnabled: false,
};
const owner: PayrollCloseActor = {
  id: "owner",
  role: "SUPER_ADMIN",
  disabled: false,
  twoFactorEnabled: true,
};
const at = "2026-10-01T00:00:00.000Z";
function inputs(): PayrollCloseInputs {
  return {
    periodKey: "2026-09",
    timeZone: "Asia/Singapore",
    startsAt: "2026-08-31T16:00:00.000Z",
    endsAt: "2026-09-30T16:00:00.000Z",
    currency: "SGD",
    evidence: { sourceEventIds: ["source"], assignmentRevision: 1, carry: [] },
    staff: [
      {
        staff: { id: "departed", name: "Departed", disabled: true },
        profile: { basicSalary: "2000", fixedOvertime: "0", levy: "100", salesAlertPct: "50" },
        profileRevision: 1,
        adjustments: [],
        collection: "0",
        calculation: {
          staffId: "departed",
          periodKey: "2026-09",
          joinDate: null,
          plan: null,
          lines: [],
        },
      },
    ],
  };
}
function calculated() {
  return calculatePayrollClose(openPayrollClose("2026-09"), 0, inputs(), manager, at);
}
function approved() {
  return approvePayrollClose(calculated(), 1, inputs(), owner, at, "Reviewed close");
}

test("OPEN → CALCULATED → APPROVED does not imply payout", () => {
  const state = approved();
  assert.equal(state.status, "APPROVED");
  assert.equal(state.revision, 2);
  assert.equal(state.payout, null);
  assert.equal(state.calculation!.statements[0].staff.disabled, true);
  assert.equal(state.calculation!.statements[0].payroll.takeHome, "2000.00");
  const paid = confirmPayrollPayout(
    state,
    2,
    owner,
    at,
    "bank-reference",
    "Bank transfer completed",
  );
  assert.deepEqual(paid.calculation, state.calculation);
  assert.equal(paid.payout!.reference, "bank-reference");
  assert.equal(state.payout, null);
  assert.throws(() => confirmPayrollPayout(paid, 3, owner, at, "second", "Duplicate payout"));
});

test("manual adjustments invalidate drafts and survive repeated calculation", () => {
  const adjustment = {
    id: "adj",
    staffId: "departed",
    kind: "COMMISSION_ADJ" as const,
    amount: "-10.00",
    actorId: "manager",
    reason: "Correction amount",
  };
  const state = adjustPayrollClose(calculated(), 1, adjustment, manager);
  assert.equal(state.status, "OPEN");
  assert.equal(state.calculation, null);
  assert.deepEqual(adjustPayrollClose(state, 2, adjustment, manager), state);
  assert.throws(() => adjustPayrollClose(state, 2, { ...adjustment, amount: "20.00" }, manager));
  const rerun = calculatePayrollClose(state, 2, inputs(), manager, at);
  const again = calculatePayrollClose(rerun, 3, inputs(), manager, at);
  assert.equal(again.calculation!.statements[0].payroll.takeHome, "1990.00");
  assert.equal(again.adjustments.length, 1);
  assert.equal(
    approvePayrollClose(again, 4, inputs(), owner, at, "Reviewed again").status,
    "APPROVED",
  );
});

test("salary, attribution, source, carry and denominator changes reject stale approval", () => {
  const mutations: ((value: PayrollCloseInputs) => void)[] = [
    (value) => {
      value.staff[0].profile.basicSalary = "2100";
    },
    (value) => {
      value.staff[0].profileRevision++;
    },
    (value) => {
      value.staff[0].collection = "1";
    },
    (value) => {
      value.evidence = { assignmentRevision: 2 };
    },
    (value) => {
      value.evidence = { sourceEventIds: ["source", "late-posting"] };
    },
    (value) => {
      value.staff[0].calculation.fallbackCarryCommission = "-10.0000000000";
    },
    (value) => {
      value.staff[0].staff.name = "Renamed";
    },
  ];
  for (const mutate of mutations) {
    const fresh = inputs();
    mutate(fresh);
    assert.throws(
      () => approvePayrollClose(calculated(), 1, fresh, owner, at, "Reviewed close"),
      /inputs changed/,
    );
  }
});

test("approved entitlement cannot be recalculated, adjusted or approved again", () => {
  const state = approved();
  assert.throws(() => calculatePayrollClose(state, 2, inputs(), manager, at), /immutable/);
  assert.throws(
    () =>
      adjustPayrollClose(
        state,
        2,
        {
          id: "adj",
          staffId: "departed",
          kind: "ADDITION",
          amount: "1.00",
          actorId: "manager",
          reason: "Extra money",
        },
        manager,
      ),
    /immutable/,
  );
  assert.throws(
    () => approvePayrollClose(state, 2, inputs(), owner, at, "Reviewed again"),
    /immutable/,
  );
  const fresh = inputs();
  fresh.staff[0].profile.basicSalary = "9999";
  assert.equal(state.calculation!.statements[0].payroll.basicSalary, "2000.00");
});

test("revision conflicts reject concurrent stale actions", () => {
  assert.throws(
    () => calculatePayrollClose(calculated(), 0, inputs(), manager, at),
    /period changed/,
  );
  assert.throws(
    () => approvePayrollClose(calculated(), 0, inputs(), owner, at, "Reviewed close"),
    /period changed/,
  );
  assert.throws(
    () => confirmPayrollPayout(approved(), 1, owner, at, "ref", "Paid money"),
    /period changed/,
  );
  assert.throws(
    () =>
      approvePayrollClose(openPayrollClose("2026-09"), 0, inputs(), owner, at, "Reviewed close"),
    /Calculate payroll/,
  );
});

test("role and verified-owner boundaries apply to transitions", () => {
  for (const actor of [
    { ...manager, role: "STAFF" },
    { ...manager, disabled: true },
    { ...owner, twoFactorEnabled: false },
  ])
    assert.throws(() => calculatePayrollClose(openPayrollClose("2026-09"), 0, inputs(), actor, at));
  assert.throws(() =>
    approvePayrollClose(calculated(), 1, inputs(), manager, at, "Reviewed close"),
  );
  assert.throws(() => confirmPayrollPayout(approved(), 2, manager, at, "ref", "Paid money"));
  assert.throws(() => confirmPayrollPayout(calculated(), 1, owner, at, "ref", "Paid money"));
});

test("canonical hashes ignore object key order but reject lossy non-JSON evidence", () => {
  assert.equal(
    payrollInputHash({ b: [1, "2"], a: null }),
    payrollInputHash({ a: null, b: [1, "2"] }),
  );
  for (const evidence of [undefined, new Date(), NaN, Infinity, 1.5, 1n, { missing: undefined }])
    assert.throws(() => payrollInputHash(evidence));
});

test("input boundary rejects missing owed staff, duplicate staff and injected adjustments", () => {
  const adjustment = {
    id: "adj",
    staffId: "missing",
    kind: "ADDITION" as const,
    amount: "1.00",
    actorId: "manager",
    reason: "Money owed",
  };
  const state = adjustPayrollClose(openPayrollClose("2026-09"), 0, adjustment, manager);
  assert.throws(() => calculatePayrollClose(state, 1, inputs(), manager, at), /must be included/);
  const duplicate = inputs();
  duplicate.staff.push(structuredClone(duplicate.staff[0]));
  assert.throws(
    () => calculatePayrollClose(openPayrollClose("2026-09"), 0, duplicate, manager, at),
    /Duplicate/,
  );
  const injected = inputs();
  injected.staff[0].adjustments = [{ ...adjustment, staffId: "departed" }];
  assert.throws(
    () => calculatePayrollClose(openPayrollClose("2026-09"), 0, injected, manager, at),
    /period audit/,
  );
});

test("monthly close validates Singapore, DST and year-rollover half-open bounds", () => {
  for (const [periodKey, timeZone, startsAt, endsAt] of [
    ["2026-03", "America/New_York", "2026-03-01T05:00:00.000Z", "2026-04-01T04:00:00.000Z"],
    ["2026-12", "Asia/Singapore", "2026-11-30T16:00:00.000Z", "2026-12-31T16:00:00.000Z"],
  ]) {
    const raw = inputs();
    Object.assign(raw, { periodKey, timeZone, startsAt, endsAt });
    raw.staff[0].calculation.periodKey = periodKey;
    const result = calculatePayrollClose(openPayrollClose(periodKey), 0, raw, manager, at);
    assert.equal(result.calculation!.inputs.endsAt, endsAt);
    assert.throws(
      () =>
        calculatePayrollClose(
          openPayrollClose(periodKey),
          0,
          { ...raw, endsAt: endsAt.replace("00.000Z", "00.001Z") },
          manager,
          at,
        ),
      /calendar month/,
    );
  }
  assert.throws(
    () =>
      calculatePayrollClose(
        openPayrollClose("2026-09"),
        0,
        { ...inputs(), startsAt: "2026-09-01T00:00:00.000Z" },
        manager,
        at,
      ),
    /calendar month/,
  );
  assert.throws(
    () =>
      approvePayrollClose(
        calculated(),
        1,
        inputs(),
        owner,
        "2026-09-30T15:59:59.999Z",
        "Too early approval",
      ),
    /must end/,
  );
  assert.throws(
    () =>
      confirmPayrollPayout(
        approved(),
        2,
        owner,
        "2026-09-30T16:00:00.000Z",
        "ref",
        "Backdated payout",
      ),
    /predate/,
  );
});

test("frozen statement reads isolate own data and require verified owner for other salaries", () => {
  const self = { ...manager, id: "departed", role: "STAFF" };
  const result = readFrozenPayrollStatement(approved(), "departed", self);
  assert.equal(result.payroll.takeHome, "2000.00");
  assert.equal(readFrozenPayrollStatement(approved(), "departed", owner).staff.id, "departed");
  assert.throws(() => readFrozenPayrollStatement(approved(), "departed", manager));
  assert.throws(() => readFrozenPayrollStatement(approved(), "departed", { ...self, id: "other" }));
  assert.throws(() =>
    readFrozenPayrollStatement(approved(), "departed", { ...self, disabled: true }),
  );
  assert.throws(() => readFrozenPayrollStatement(calculated(), "departed", self));
  assert.throws(() => readFrozenPayrollStatement(approved(), "absent", owner));
  const state = approved();
  readFrozenPayrollStatement(state, "departed", self).inputs.profile.basicSalary = "9999";
  assert.equal(state.calculation!.statements[0].inputs.profile.basicSalary, "2000");
});
