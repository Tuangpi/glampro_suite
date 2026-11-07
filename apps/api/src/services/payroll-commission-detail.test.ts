import assert from "node:assert/strict";
import { after, test } from "node:test";
import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma.js";
import { runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { commissionDetail, commissionDetailWorkbook } from "./payroll-commission-detail.js";
import {
  approvedPayrollExportState,
  calculatedPayrollExportState,
} from "./payroll-export.test-helper.js";
import { payrollInputHash } from "./payroll-close-state.js";

const original = prisma.$transaction;
after(() => {
  Reflect.set(prisma, "$transaction", original);
});
let state = approvedPayrollExportState();
let states: Map<string, typeof state> | null = null;
let role = "MANAGER";
Reflect.set(prisma, "$transaction", async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    user: { findFirst: async () => ({ globalRole: role }) },
    payrollClose: {
      findFirst: async ({ where }: { where: { periodKey: string } }) =>
        (states?.get(where.periodKey) ?? (where.periodKey === state.periodKey ? state : null))
          ? {
              state: states?.get(where.periodKey) ?? state,
              revision: (states?.get(where.periodKey) ?? state).revision,
              status: (states?.get(where.periodKey) ?? state).status,
            }
          : null,
    },
    payrollCloseEvent: {
      findFirst: async ({ where }: { where: { periodKey: string } }) => ({
        stateHash: payrollInputHash(states?.get(where.periodKey) ?? state),
      }),
    },
    payrollSourceEvent: {
      findMany: async () => [
        {
          id: "event",
          sourceKey: "line-a-1",
          saleId: "sale",
          sourceType: "COLLECTION",
          sourceId: "allocation",
        },
      ],
    },
    sale: { findMany: async () => [{ id: "sale", customerId: "customer" }] },
    customerRedemption: { findMany: async () => [] },
    customerPackageHolding: { findMany: async () => [] },
    saleLine: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.includes("package-line") ? [{ id: "package-line", itemId: "package" }] : [],
    },
    commissionCollectionAllocation: {
      findMany: async () => [{ id: "allocation", saleLineId: "package-line" }],
    },
  }),
);

test("detail filters across staff using frozen bases and explicit package source identity", async () => {
  const data = await runAsTenant(
    "salon",
    () => commissionDetail({ period: "2026-09", customerId: "customer", packageId: "package" }),
    "manager",
  );
  assert.equal(data.total, 1);
  assert.equal(data.rows[0].line.baseAmount, "2000");
  assert.equal(data.rows[0].packageId, "package");
  const serialized = JSON.stringify(data);
  assert.ok(!serialized.includes("basicSalary"));
  assert.ok(!serialized.includes("takeHome"));
});
test("a cross-month range never silently exports a partially approved range", async () => {
  const data = await runAsTenant(
    "salon",
    () => commissionDetail({ period: "2026-09", throughPeriod: "2026-10" }),
    "manager",
  );
  assert.equal(data.approved, false);
  assert.deepEqual(data.unavailablePeriods, ["2026-10"]);
  assert.deepEqual(data.rows, []);
  await assert.rejects(
    runAsTenant(
      "salon",
      () => commissionDetailWorkbook({ period: "2026-09", throughPeriod: "2026-10" }),
      "manager",
    ),
    /Approve payroll/,
  );
  await assert.rejects(
    runAsTenant(
      "salon",
      () => commissionDetail({ period: "2026-09", throughPeriod: "2026-08" }),
      "manager",
    ),
    /must not precede/,
  );
  await assert.rejects(
    runAsTenant(
      "salon",
      () => commissionDetail({ period: "2026-09", throughPeriod: "2028-09" }),
      "manager",
    ),
    /24 payroll months/,
  );
});
test("unknown package evidence is not guessed from another line on the receipt", async () => {
  const data = await runAsTenant(
    "salon",
    () => commissionDetail({ period: "2026-09", packageId: "other" }),
    "manager",
  );
  assert.equal(data.total, 0);
});
test("Excel uses the same filters and contains no salary worksheets", async () => {
  const file = await runAsTenant(
    "salon",
    () =>
      commissionDetailWorkbook({ period: "2026-09", staffId: "staff-a", commissionType: "SVC" }),
    "manager",
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(file.body).buffer);
  assert.equal(workbook.worksheets.length, 1);
  assert.equal(workbook.worksheets[0].rowCount, 3);
  assert.equal(workbook.worksheets[0].getRow(3).getCell(5).value, "2000");
});
test("detail rechecks database role and refuses outlet-scoped salon reads", async () => {
  role = "STAFF";
  await assert.rejects(
    runAsTenant("salon", () => commissionDetail({ period: "2026-09" }), "staff"),
    /Forbidden/,
  );
  role = "MANAGER";
  await assert.rejects(
    runAsTenant(
      "salon",
      () => runAtOutlet("branch", () => commissionDetail({ period: "2026-09" })),
      "manager",
    ),
    /Forbidden/,
  );
});
test("an existing calculated month is unavailable, and cannot be exported as approved", async () => {
  state = calculatedPayrollExportState();
  try {
    const data = await runAsTenant(
      "salon",
      () => commissionDetail({ period: "2026-09" }),
      "manager",
    );
    assert.equal(data.approved, false);
    assert.deepEqual(data.rows, []);
    await assert.rejects(
      runAsTenant("salon", () => commissionDetailWorkbook({ period: "2026-09" }), "manager"),
      /Approve payroll before exporting/,
    );
  } finally {
    state = approvedPayrollExportState();
  }
});
test("large approved cross-month reads paginate deterministically and export the entire filtered range", async () => {
  const september = approvedPayrollExportState();
  const october = structuredClone(september);
  october.periodKey = "2026-10";
  const statement = october.calculation!.statements[0];
  statement.inputs.calculation.lines = Array.from({ length: 1001 }, (_, index) => ({
    ...statement.inputs.calculation.lines[0],
    id: `large-${index}`,
    businessDate: "2026-10-05",
  }));
  states = new Map([
    ["2026-09", september],
    ["2026-10", october],
  ]);
  try {
    const filters = {
      period: "2026-09",
      throughPeriod: "2026-10",
      staffId: "staff-a",
      commissionType: "SVC",
      limit: 500,
    };
    const first = await runAsTenant("salon", () => commissionDetail(filters), "manager");
    const last = await runAsTenant(
      "salon",
      () => commissionDetail({ ...filters, page: 3 }),
      "manager",
    );
    assert.equal(first.approved, true);
    assert.equal(first.total, 1002);
    assert.equal(first.rows.length, 500);
    assert.equal(last.rows.length, 2);
    assert.equal(first.rows[0].period, "2026-09");
    const file = await runAsTenant(
      "salon",
      () => commissionDetailWorkbook({ ...filters, page: 3 }),
      "manager",
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(file.body).buffer);
    assert.equal(workbook.worksheets[0].rowCount, 1004);
    assert.match(file.filename, /2026-09-2026-10/);
  } finally {
    states = null;
  }
});
