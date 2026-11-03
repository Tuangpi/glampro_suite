import type {
  PayrollAdjustment,
  PayrollPlanDefinition,
  PayrollStatementInput,
} from "@glampro_suite/shared";
import { salonDayBounds } from "../lib/wall-clock.js";
import {
  adjustPayrollClose,
  approvePayrollClose,
  calculatePayrollClose,
  openPayrollClose,
  type PayrollCloseActor,
  type PayrollCloseInputs,
  type PayrollCloseState,
} from "./payroll-close-state.js";

/** Owner actor accepted by every payroll close transition in export tests. */
export const exportOwner: PayrollCloseActor = {
  id: "owner",
  role: "SUPER_ADMIN",
  disabled: false,
  twoFactorEnabled: true,
};

const plan: PayrollPlanDefinition = {
  stages: [],
  components: [
    {
      key: "svc",
      name: "Service commission",
      commissionTypes: ["SVC"],
      basePct: "100",
      method: "FLAT",
      flatRatePct: "10",
      bands: [],
      sort: 0,
    },
  ],
  incentives: [
    {
      key: "salon_target",
      name: "Salon target",
      type: "INDIVIDUAL_TARGET",
      individualMetricTypes: ["SVC"],
      groupMetric: "SALON_CASH",
      scope: "SALON",
      rows: [{ individualTarget: "100", amount: "50" }],
    },
  ],
};

function staffA(): PayrollStatementInput {
  return {
    staff: { id: "staff-a", name: "Alice Tan", disabled: false },
    profile: {
      basicSalary: "2400.00",
      fixedOvertime: "120.00",
      levy: "60.00",
      salesAlertPct: "50",
    },
    profileRevision: 1,
    adjustments: [],
    collection: "3000",
    calculation: {
      staffId: "staff-a",
      periodKey: "2026-09",
      joinDate: "2025-01-15",
      plan: { planId: "plan", versionId: "plan-v1", definition: plan },
      lines: [
        {
          id: "line-a-1",
          staffId: "staff-a",
          outletId: "outlet-a",
          commissionType: "SVC",
          baseAmount: "2000",
          units: "1",
          businessDate: "2026-09-05",
          status: "EARNED",
          mode: "FOLLOW_PLAN",
        },
        {
          id: "line-a-2",
          staffId: "staff-a",
          outletId: "outlet-b",
          commissionType: "PRD",
          baseAmount: "150.50",
          units: "2",
          businessDate: "2026-09-28",
          status: "REVERSED",
          mode: "FIXED",
          fixedCommission: "4.00",
        },
      ],
    },
  };
}

function staffB(): PayrollStatementInput {
  return {
    staff: { id: "staff-b", name: 'Bob "The Barber", Jr', disabled: true },
    profile: {
      basicSalary: "1200.00",
      fixedOvertime: "0.00",
      levy: "30.00",
      salesAlertPct: "40",
    },
    profileRevision: 3,
    adjustments: [],
    collection: "0",
    calculation: {
      staffId: "staff-b",
      periodKey: "2026-09",
      joinDate: null,
      plan: null,
      lines: [
        {
          id: "line-b-1",
          staffId: "staff-b",
          outletId: "outlet-a",
          commissionType: "SVC",
          baseAmount: "250.25",
          units: "3",
          businessDate: "2026-09-11",
          status: "EARNED",
          mode: "EXCLUDE",
        },
      ],
    },
  };
}

export const EXPORT_PERIOD = "2026-09";
export const EXPORT_TIME_ZONE = "Asia/Singapore";

/** Complete salon-local calendar month, as the payroll state transition requires. */
export const exportInputs: PayrollCloseInputs = {
  periodKey: EXPORT_PERIOD,
  timeZone: EXPORT_TIME_ZONE,
  startsAt: salonDayBounds(`${EXPORT_PERIOD}-01`, EXPORT_TIME_ZONE).from.toISOString(),
  endsAt: salonDayBounds("2026-10-01", EXPORT_TIME_ZONE).from.toISOString(),
  currency: "SGD",
  evidence: { source: "export-fixture" },
  staff: [staffA(), staffB()],
};

/** Manual amounts owed are period audit entries, never loader input. */
const exportAdjustments: PayrollAdjustment[] = [
  {
    id: "adj-addition",
    staffId: "staff-a",
    kind: "ADDITION",
    amount: "30.00",
    reason: "Anniversary bonus",
    actorId: "owner",
  },
  {
    id: "adj-overtime",
    staffId: "staff-a",
    kind: "OVERTIME",
    amount: "45.50",
    reason: "Late closing shifts",
    actorId: "owner",
  },
  {
    id: "adj-deduction",
    staffId: "staff-a",
    kind: "DEDUCTION",
    amount: "20.00",
    reason: "Uniform replacement",
    actorId: "owner",
  },
  {
    id: "adj-leave",
    staffId: "staff-a",
    kind: "UNPAID_LEAVE",
    amount: "100.00",
    reason: "Unpaid family leave",
    actorId: "owner",
  },
];

function openExportPeriod() {
  return exportAdjustments.reduce(
    (state, adjustment) => adjustPayrollClose(state, state.revision, adjustment, exportOwner),
    openPayrollClose(EXPORT_PERIOD),
  );
}

/** Calculated but unapproved close: exports must refuse it. */
export function calculatedPayrollExportState(): PayrollCloseState {
  const state = openExportPeriod();
  return calculatePayrollClose(
    state,
    state.revision,
    exportInputs,
    exportOwner,
    "2026-10-01T00:10:00.000Z",
  );
}

/** Frozen APPROVED close: the only state CP-006 may export. */
export function approvedPayrollExportState(): PayrollCloseState {
  const calculated = calculatedPayrollExportState();
  return approvePayrollClose(
    calculated,
    calculated.revision,
    exportInputs,
    exportOwner,
    "2026-10-02T02:00:00.000Z",
    "September payroll approved",
  );
}
