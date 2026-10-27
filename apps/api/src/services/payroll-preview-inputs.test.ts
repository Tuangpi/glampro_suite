import assert from "node:assert/strict";
import { test } from "node:test";
import { hairPayrollExample, PAYROLL_DEFAULT_SETTINGS } from "@glampro_suite/shared";
import {
  payrollPreviewWindow,
  resolvePayrollPreviewConfiguration,
} from "./payroll-preview-inputs.js";

test("historical preview uses the salon month, including year rollover and DST", () => {
  assert.deepEqual(payrollPreviewWindow("Asia/Singapore", new Date("2026-12-31T16:00:00Z")), {
    periodKey: "2026-12",
    timeZone: "Asia/Singapore",
    from: new Date("2026-11-30T16:00:00Z"),
    to: new Date("2026-12-31T16:00:00Z"),
  });
  const dst = payrollPreviewWindow("America/New_York", new Date("2026-04-01T04:00:00Z"));
  assert.equal(dst.from.toISOString(), "2026-03-01T05:00:00.000Z");
  assert.equal(dst.to.toISOString(), "2026-04-01T04:00:00.000Z");
  assert.equal(
    payrollPreviewWindow("America/Los_Angeles", new Date("2026-10-01T00:00:00Z")).periodKey,
    "2026-08",
  );
});

function fixture() {
  return {
    planId: "hair",
    periodKey: "2026-09",
    endsAt: new Date("2026-09-30T16:00:00Z"),
    events: [
      {
        id: "assign-1",
        kind: "ASSIGNMENT",
        targetId: "company",
        revision: 1,
        createdAt: new Date("2026-10-01T00:00:00Z"),
        payload: [
          {
            id: "assignment-row",
            staffId: "departed",
            planId: "hair",
            fromDate: "2026-09-15",
            toDate: null,
            outletIds: ["branch"],
          },
        ],
      },
      {
        id: "staff-1",
        kind: "STAFF",
        targetId: "departed",
        revision: 1,
        createdAt: new Date("2026-09-01T00:00:00Z"),
        payload: { joinDate: "2020-01-01", stageEndOverride: null },
      },
      {
        id: "staff-2",
        kind: "STAFF",
        targetId: "departed",
        revision: 2,
        createdAt: new Date("2026-09-30T16:00:00Z"),
        payload: { joinDate: "2026-09-01", stageEndOverride: 6 },
      },
    ],
    versions: [
      {
        id: "published",
        planId: "hair",
        versionNo: 1,
        effectiveFrom: "2026-09-30",
        status: "PUBLISHED",
        definition: hairPayrollExample(),
      },
      {
        id: "future",
        planId: "hair",
        versionNo: 2,
        effectiveFrom: "2026-10-01",
        status: "PUBLISHED",
        definition: hairPayrollExample(),
      },
      {
        id: "draft",
        planId: "hair",
        versionNo: 3,
        effectiveFrom: "2026-09-01",
        status: "DRAFT",
        definition: hairPayrollExample(),
      },
    ],
    staff: [{ id: "departed", name: "Departed staff", disabled: true }],
  };
}

test("month-end assignment/version retains departed staff and uses pre-close staff audit", () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const result = resolvePayrollPreviewConfiguration(input);
  assert.equal(result.assignmentEventId, "assign-1");
  assert.equal(result.staff[0].version.id, "published");
  assert.equal(result.staff[0].joinDate, "2020-01-01");
  assert.equal(result.staff[0].staffRevision, 1);
  assert.equal(result.staff[0].disabled, true);
  assert.deepEqual(result.staff[0].assignment.outletIds, ["branch"]);
  assert.deepEqual(result.staff[0].blockers, []);
  assert.equal(JSON.stringify(input), before);
});

test("missing historical employment audit fails closed rather than using current identity", () => {
  const input = fixture();
  input.events = input.events.filter((e) => e.kind !== "STAFF");
  const row = resolvePayrollPreviewConfiguration(input).staff[0];
  assert.equal(row.joinDate, null);
  assert.deepEqual(row.blockers, ["HISTORICAL_STAFF_SETTINGS_UNAVAILABLE"]);
});

test("salon settings require pre-close audit instead of silently adopting current defaults", () => {
  const input = fixture();
  const missing = resolvePayrollPreviewConfiguration(input);
  assert.equal(missing.settings, null);
  assert.deepEqual(missing.blockers, ["HISTORICAL_SALON_SETTINGS_UNAVAILABLE"]);
  const events = [
    ...input.events,
    {
      id: "settings-1",
      kind: "SETTINGS",
      targetId: "company",
      revision: 1,
      createdAt: new Date("2026-09-01T00:00:00Z"),
      payload: PAYROLL_DEFAULT_SETTINGS,
    },
    {
      id: "settings-2",
      kind: "SETTINGS",
      targetId: "company",
      revision: 2,
      createdAt: input.endsAt,
      payload: { ...PAYROLL_DEFAULT_SETTINGS, minimumDepositPct: "99" },
    },
  ];
  const result = resolvePayrollPreviewConfiguration({ ...input, events });
  assert.equal(result.settingsEventId, "settings-1");
  assert.equal(result.settings?.minimumDepositPct, PAYROLL_DEFAULT_SETTINGS.minimumDepositPct);
  assert.deepEqual(result.blockers, []);
});

test("future assignments do not select staff and ambiguous timelines are rejected", () => {
  const input = fixture();
  input.events[0].payload = [
    {
      id: "future-row",
      staffId: "departed",
      planId: "hair",
      fromDate: "2026-10-01",
      toDate: null,
      outletIds: [],
    },
  ];
  assert.deepEqual(resolvePayrollPreviewConfiguration(input).staff, []);
  input.events[0].payload.push({
    id: "overlap-row",
    staffId: "departed",
    planId: "hair",
    fromDate: "2026-10-02",
    toDate: null,
    outletIds: [],
  });
  assert.throws(() => resolvePayrollPreviewConfiguration(input), /Overlapping/);
});
