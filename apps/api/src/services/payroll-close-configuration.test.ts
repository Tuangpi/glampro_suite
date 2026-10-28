import assert from "node:assert/strict";
import { test } from "node:test";
import { hairPayrollExample, PAYROLL_DEFAULT_SETTINGS } from "@glampro_suite/shared";
import {
  approvePayrollClose,
  calculatePayrollClose,
  openPayrollClose,
  payrollInputHash,
  type PayrollCloseInputs,
} from "./payroll-close-state.js";
import {
  resolvePayrollCloseConfiguration,
  type PayrollCloseConfigurationRecords,
} from "./payroll-close-configuration.js";

function fixture(): PayrollCloseConfigurationRecords {
  const event = (
    kind: "SETTINGS" | "ASSIGNMENT" | "STAFF" | "PROFILE",
    targetId: string,
    payload: unknown,
  ) => ({
    id: `${kind}-${targetId}`,
    tenantId: "salon",
    kind,
    targetId,
    revision: 1,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    payload,
  });
  return {
    tenantId: "salon",
    periodKey: "2026-09",
    timeZone: "Asia/Singapore",
    events: [
      event("SETTINGS", "company", PAYROLL_DEFAULT_SETTINGS),
      event("ASSIGNMENT", "company", [
        {
          id: "assignment",
          staffId: "departed",
          planId: "hair",
          outletIds: ["branch"],
          fromDate: "2026-09-15",
          toDate: null,
        },
      ]),
      event("STAFF", "departed", {
        joinDate: "2020-01-01",
        stageEndOverride: 0,
        commissionRole: "COMMISSION_EARNING",
      }),
      event("PROFILE", "departed", {
        basicSalary: "2000",
        fixedOvertime: "100",
        levy: "50",
        salesAlertPct: "40",
      }),
    ],
    versions: [
      {
        tenantId: "salon",
        id: "version",
        planId: "hair",
        versionNo: 1,
        status: "PUBLISHED",
        effectiveFrom: "2026-09-01",
        definition: hairPayrollExample(),
      },
    ],
    staff: [{ tenantId: "salon", id: "departed", name: "Departed", disabled: true }],
    requiredStaffIds: ["departed"],
  };
}
const resolve = (raw = fixture()) => resolvePayrollCloseConfiguration(raw);

test("monthly configuration retains departed staff, zero stage override and full selected audit", () => {
  const result = resolve();
  assert.equal(result.status, "CONFIGURATION_READY");
  assert.equal(result.earningsActive, false);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.startsAt, "2026-08-31T16:00:00.000Z");
  assert.equal(result.endsAt, "2026-09-30T16:00:00.000Z");
  const row = result.configuration!.staff[0];
  assert.equal(row.staff.disabled, true);
  assert.equal(row.settings!.stageEndOverride, 0);
  assert.equal(row.profile!.basicSalary, "2000");
  assert.equal(row.profileRevision, 1);
  assert.equal(row.profileEvent!.id, "PROFILE-departed");
  assert.deepEqual(row.assignment!.outletIds, ["branch"]);
  assert.equal(row.version!.id, "version");
  assert.doesNotThrow(() => payrollInputHash(result));
});

test("profile, employment and salon audit at the exclusive end never replace historical values", () => {
  const input = fixture();
  for (const kind of ["STAFF", "PROFILE", "SETTINGS"] as const) {
    const prior = input.events.find((row) => row.kind === kind)!;
    input.events.push({
      ...prior,
      id: `${kind}-future`,
      revision: 2,
      createdAt: new Date("2026-09-30T16:00:00.000Z"),
      payload: { invalid: true },
    });
  }
  assert.equal(resolve(input).status, "CONFIGURATION_READY");
  assert.equal(resolve(input).configuration!.staff[0].profileEvent!.id, "PROFILE-departed");
});

test("latest invalid historical evidence blocks the entire configuration, never falls back", () => {
  for (const kind of ["STAFF", "PROFILE", "SETTINGS"] as const) {
    const input = fixture();
    const previous = input.events.find((row) => row.kind === kind)!;
    input.events.push({
      ...previous,
      id: "bad-audit",
      revision: 2,
      createdAt: new Date("2026-09-20T00:00:00.000Z"),
      payload: {},
    });
    const result = resolve(input);
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.configuration, null);
    assert.ok(result.blockers.some((row) => row.eventId === "bad-audit"));
  }
});

test("missing salary, staff or salon audit cannot become zero or current defaults", () => {
  for (const kind of ["PROFILE", "STAFF", "SETTINGS"]) {
    const input = fixture();
    input.events = input.events.filter((row) => row.kind !== kind);
    const result = resolve(input);
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.configuration, null);
    assert.ok(result.blockers.length > 0);
  }
});

test("month-end timeline selects midmonth switch and ignores next-month publication", () => {
  const input = fixture();
  input.events.find((row) => row.kind === "ASSIGNMENT")!.createdAt = new Date(
    "2026-10-01T00:00:00.000Z",
  );
  input.versions.push({
    ...input.versions[0],
    id: "next-version",
    versionNo: 2,
    effectiveFrom: "2026-10-01",
  });
  assert.equal(resolve(input).configuration!.staff[0].version!.id, "version");
  const assignment = input.events.find((row) => row.kind === "ASSIGNMENT")!;
  assignment.payload = [
    {
      id: "switch",
      staffId: "departed",
      planId: "hair",
      fromDate: "2026-09-30",
      toDate: null,
      outletIds: ["other-branch"],
    },
  ];
  assert.deepEqual(resolve(input).configuration!.staff[0].assignment!.outletIds, ["other-branch"]);
});

test("ambiguous or unpublished assigned plans block, rather than flat fallback", () => {
  for (const mutate of [
    (input: PayrollCloseConfigurationRecords) => {
      input.versions[0].status = "DRAFT";
    },
    (input: PayrollCloseConfigurationRecords) => {
      input.versions.push({ ...input.versions[0], id: "duplicate-publication" });
    },
    (input: PayrollCloseConfigurationRecords) => {
      input.events.find((row) => row.kind === "ASSIGNMENT")!.payload = [
        { id: "a", staffId: "departed", planId: "hair", fromDate: "2026-09-01", toDate: null },
        { id: "b", staffId: "departed", planId: "hair", fromDate: "2026-09-15", toDate: null },
      ];
    },
  ]) {
    const input = fixture();
    mutate(input);
    assert.equal(resolve(input).configuration, null);
    assert.ok(resolve(input).blockers.some((row) => row.code === "MONTH_END_PLAN_UNRESOLVED"));
  }
});

test("noncommission staff without plan retain salary configuration and explicit no-plan selection", () => {
  const input = fixture();
  input.events = input.events.filter((row) => row.kind !== "ASSIGNMENT");
  input.events.find((row) => row.kind === "STAFF")!.payload = {
    joinDate: "2020-01-01",
    stageEndOverride: null,
    commissionRole: "NON_COMMISSION",
  };
  const result = resolve(input);
  assert.equal(result.status, "CONFIGURATION_READY");
  assert.equal(result.configuration!.staff[0].assignment, null);
  assert.equal(result.configuration!.staff[0].version, null);
  input.events.find((row) => row.kind === "STAFF")!.payload = {
    joinDate: "2020-01-01",
    stageEndOverride: null,
    commissionRole: "COMMISSION_EARNING",
  };
  assert.ok(
    resolve(input).blockers.some((row) => row.code === "COMMISSION_STAFF_PLAN_UNAVAILABLE"),
  );
});

test("active staff are included, disabled staff require activity/carry/owed evidence", () => {
  const input = fixture();
  input.requiredStaffIds = [];
  assert.equal(resolve(input).configuration!.staff.length, 0);
  input.staff[0].disabled = false;
  assert.equal(resolve(input).configuration!.staff.length, 1);
  input.staff[0].disabled = true;
  input.requiredStaffIds = ["departed", "departed"];
  assert.equal(resolve(input).configuration!.staff.length, 1);
});

test("missing required identity blocks rather than losing amounts owed", () => {
  const input = fixture();
  input.staff = [];
  assert.deepEqual(resolve(input).blockers, [
    { code: "REQUIRED_STAFF_IDENTITY_UNAVAILABLE", staffId: "departed", eventId: null },
  ]);
  assert.equal(resolve(input).configuration, null);
});

test("future joins do not earn current salary; activity before employment blocks close", () => {
  const input = fixture();
  input.events.find((row) => row.kind === "STAFF")!.payload = {
    joinDate: "2026-10-01",
    stageEndOverride: null,
    commissionRole: "NON_COMMISSION",
  };
  assert.ok(resolve(input).blockers.some((row) => row.code === "ACTIVITY_PRECEDES_EMPLOYMENT"));
  input.requiredStaffIds = [];
  input.staff[0].disabled = false;
  assert.equal(resolve(input).status, "CONFIGURATION_READY");
  assert.deepEqual(resolve(input).configuration!.staff, []);
});

test("cross-tenant records, duplicate identities and duplicate audit revisions fail closed", () => {
  for (const mutate of [
    (input: PayrollCloseConfigurationRecords) => {
      input.events[0].tenantId = "other";
    },
    (input: PayrollCloseConfigurationRecords) => {
      input.versions[0].tenantId = "other";
    },
    (input: PayrollCloseConfigurationRecords) => {
      input.staff[0].tenantId = "other";
    },
    (input: PayrollCloseConfigurationRecords) => {
      input.staff.push({ ...input.staff[0] });
    },
    (input: PayrollCloseConfigurationRecords) => {
      input.events.push({ ...input.events[0], id: "duplicate-revision" });
    },
    (input: PayrollCloseConfigurationRecords) => {
      input.versions.push({ ...input.versions[0] });
    },
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(() => resolve(input));
  }
});

test("deterministic output ignores database row order and owns deep copies", () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = resolve(input);
  input.events.reverse();
  input.versions.reverse();
  input.staff.reverse();
  assert.equal(payrollInputHash(resolve(input)), payrollInputHash(result));
  assert.deepEqual([...input.events].reverse(), before.events);
  result.configuration!.staff[0].profile!.basicSalary = "9999";
  result.configuration!.staff[0].version!.definition.components[0].name = "Changed";
  assert.equal(resolve(input).configuration!.staff[0].profile!.basicSalary, "2000");
  assert.notEqual(
    resolve(input).configuration!.staff[0].version!.definition.components[0].name,
    "Changed",
  );
});

test("selected audit revisions change the configuration fingerprint even for equal salary values", () => {
  const input = fixture();
  const oldHash = payrollInputHash(resolve(input));
  const prior = input.events.find((row) => row.kind === "PROFILE")!;
  input.events.push({
    ...prior,
    id: "salary-reconfirmed",
    revision: 2,
    createdAt: new Date("2026-09-20T00:00:00.000Z"),
  });
  assert.notEqual(payrollInputHash(resolve(input)), oldHash);
  assert.equal(resolve(input).configuration!.staff[0].profileRevision, 2);
});

test("invalid assignment payload blocks; no historical profile is inferred from later audit", () => {
  const input = fixture();
  input.events.find((row) => row.kind === "ASSIGNMENT")!.payload = "invalid";
  assert.ok(resolve(input).blockers.some((row) => row.code === "ASSIGNMENT_TIMELINE_INVALID"));
  input.events.find((row) => row.kind === "PROFILE")!.createdAt = new Date(
    "2026-10-01T00:00:00.000Z",
  );
  assert.ok(
    resolve(input).blockers.some((row) => row.code === "HISTORICAL_PAYROLL_PROFILE_UNAVAILABLE"),
  );
});

test("DST month uses exact salon-local month boundaries", () => {
  const input = fixture();
  input.periodKey = "2026-03";
  input.timeZone = "America/New_York";
  input.requiredStaffIds = [];
  input.events = [{ ...input.events[0], createdAt: new Date("2026-01-01T00:00:00.000Z") }];
  const result = resolve(input);
  assert.equal(result.startsAt, "2026-03-01T05:00:00.000Z");
  assert.equal(result.endsAt, "2026-04-01T04:00:00.000Z");
  assert.equal(result.status, "CONFIGURATION_READY");
});

test("resolved configuration feeds close hashing and rejects changed historical salary audit", () => {
  const records = fixture();
  records.events = records.events.filter((row) => row.kind !== "ASSIGNMENT");
  records.events.find((row) => row.kind === "STAFF")!.payload = {
    joinDate: "2020-01-01",
    stageEndOverride: null,
    commissionRole: "NON_COMMISSION",
  };
  // Deliberately empty activity/carry/collection fixture; this is not a production loader.
  const closeInputs = (): PayrollCloseInputs => {
    const result = resolve(records);
    assert.equal(result.status, "CONFIGURATION_READY");
    const row = result.configuration!.staff[0];
    return {
      periodKey: result.periodKey,
      timeZone: result.timeZone,
      startsAt: result.startsAt,
      endsAt: result.endsAt,
      currency: "SGD",
      evidence: result.configuration,
      staff: [
        {
          staff: row.staff,
          profile: row.profile!,
          profileRevision: row.profileRevision!,
          adjustments: [],
          collection: "0",
          calculation: {
            staffId: row.staff.id,
            periodKey: result.periodKey,
            joinDate: row.settings!.joinDate,
            plan: null,
            lines: [],
            negativeBase: result.configuration!.settings!.negativeBase,
            joinAfterDay: result.configuration!.settings!.joinAfterDay,
          },
        },
      ],
    };
  };
  const actor = { id: "owner", role: "SUPER_ADMIN", disabled: false, twoFactorEnabled: true };
  const at = "2026-10-01T00:00:00.000Z";
  const draft = calculatePayrollClose(openPayrollClose("2026-09"), 0, closeInputs(), actor, at);
  const approved = approvePayrollClose(draft, 1, closeInputs(), actor, at, "Salary checked");
  assert.equal(approved.calculation!.statements[0].payroll.takeHome, "2100.00");
  const profile = records.events.find((row) => row.kind === "PROFILE")!;
  records.events.push({
    ...profile,
    id: "salary-revised",
    revision: 2,
    createdAt: new Date("2026-09-20T00:00:00.000Z"),
    payload: { basicSalary: "3000", fixedOvertime: "100", levy: "50", salesAlertPct: "40" },
  });
  assert.throws(
    () => approvePayrollClose(draft, 1, closeInputs(), actor, at, "Salary checked"),
    /inputs changed/,
  );
  assert.equal(approved.calculation!.statements[0].payroll.takeHome, "2100.00");
});

test("configuration resolution leaves all caller records unchanged", () => {
  const input = fixture();
  const before = structuredClone(input);
  resolve(input);
  assert.deepEqual(input, before);
});
