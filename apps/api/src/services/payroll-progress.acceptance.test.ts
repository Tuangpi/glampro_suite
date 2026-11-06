import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Static, so the gate below reads `.env` instead of skipping silently.
import "dotenv/config";
import { after, before, test } from "node:test";
import type { GlobalRole } from "@glampro_suite/shared";

/**
 * CP-006 progress and own-data self-service against **real payroll rows**
 * (FR-RPT-04, FR-RPT-05, FR-POS-09).
 *
 * The pure and HTTP suites prove the projection and the route boundary. This one proves
 * the reads themselves: that the approved-snapshot lookup really filters on the period
 * and status, that the salon's own plan row names the plan, that paging the own-statement
 * history is newest-first and bounded, that tenant scoping keeps another salon's months
 * out, and that neither read writes anything.
 *
 * Gated on `CP006_PROGRESS_DB=1` and a disposable database, like the other database
 * suites: it creates its own salon and removes every row it made.
 */
const enabled = process.env.CP006_PROGRESS_DB === "1";

const { prisma } = await import("../lib/prisma.js");
const { runAsTenant, runAsPlatform, runAtOutlet } = await import("../lib/tenant-context.js");
const { salonDayBounds } = await import("../lib/wall-clock.js");
const { calculatePayrollClose, openPayrollClose, payrollInputHash } =
  await import("./payroll-close-state.js");
const { readStoredPayrollProgress, readStoredPayrollStatements, readStoredPayrollClose } =
  await import("./payroll-close-store.js");
const { exportInputs, exportOwner } = await import("./payroll-export.test-helper.js");

type CloseState = import("./payroll-close-state.js").PayrollCloseState;

const suffix = randomUUID().slice(0, 8);
const tenantId = `cp006-progress-${suffix}`;
const foreignTenantId = `cp006-progress-foreign-${suffix}`;
const planId = `plan-${suffix}`;
const foreignPlanId = `plan-foreign-${suffix}`;
const outletId = `outlet-${suffix}`;
const ids = {
  owner: `owner-${suffix}`,
  manager: `manager-${suffix}`,
  seller: `seller-${suffix}`,
  colleague: `colleague-${suffix}`,
  foreignSeller: `foreign-${suffix}`,
};

/** Fixture staff ids mapped onto the real user rows this suite creates. */
const staffMap: Record<string, string> = {
  "staff-a": ids.seller,
  "staff-b": ids.colleague,
};

const timeZone = "Asia/Singapore";

/**
 * A close at **revision 1** for the given month.
 *
 * Revision 1 keeps the fixture honest against the database's deferred audit-chain
 * trigger, which requires every revision above the first to name its predecessor's hash.
 * An approval here is the same snapshot with the frozen status applied, which is exactly
 * what the read path cares about.
 */
function closeState(periodKey: string, approved: boolean): CloseState {
  const [year = 0, month = 1] = periodKey.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const open = openPayrollClose(periodKey);
  const calculated = calculatePayrollClose(
    open,
    open.revision,
    {
      ...exportInputs,
      periodKey,
      startsAt: salonDayBounds(`${periodKey}-01`, timeZone).from.toISOString(),
      endsAt: salonDayBounds(nextMonth, timeZone).from.toISOString(),
      staff: exportInputs.staff.map((row) => ({
        ...row,
        calculation: {
          ...row.calculation,
          periodKey,
          // The engine refuses a base line outside the requested month, so the fixture's
          // days move with the period it is being stored for.
          lines: row.calculation.lines.map((line) => ({
            ...line,
            businessDate: `${periodKey}-${line.businessDate.slice(8, 10)}`,
          })),
        },
      })),
    },
    exportOwner,
    `${nextMonth}T00:10:00.000Z`,
  );
  if (!approved) return calculated;
  return {
    ...calculated,
    status: "APPROVED",
    approval: {
      at: `${nextMonth}T02:00:00.000Z`,
      actorId: exportOwner.id,
      reason: "CP-006 progress fixture",
    },
  };
}

/** Re-keys a frozen fixture onto this run's ids so re-runs cannot collide. */
function rekey(
  state: CloseState,
  staffIds: Record<string, string> = staffMap,
  targetPlanId = planId,
): CloseState {
  const next = structuredClone(state);
  const calculation = next.calculation;
  if (!calculation) return next;
  calculation.inputs.staff = [];
  for (const statement of calculation.statements) {
    const staffId = staffIds[statement.staff.id];
    if (!staffId) continue;
    statement.staff.id = staffId;
    statement.result.staffId = staffId;
    statement.inputs.staff.id = staffId;
    statement.inputs.calculation.staffId = staffId;
    for (const line of statement.inputs.calculation.lines) line.staffId = staffId;
    if (statement.inputs.calculation.plan) statement.inputs.calculation.plan.planId = targetPlanId;
    statement.result.planId = statement.result.planId ? targetPlanId : null;
    calculation.inputs.staff.push(statement.inputs);
  }
  return next;
}

/**
 * Writes the close and the append-only audit row the store verifies on every read.
 *
 * Both rows go in **one transaction**: the database defers a constraint trigger that
 * refuses a close whose matching audit row is not committed with it.
 */
async function store(tenant: string, state: CloseState) {
  const json = JSON.parse(JSON.stringify(state));
  await runAsTenant(tenant, () =>
    prisma.$transaction(async (tx) => {
      await tx.payrollClose.create({
        data: {
          tenantId: tenant,
          periodKey: state.periodKey,
          revision: state.revision,
          status: state.status,
          state: json,
        },
      });
      await tx.payrollCloseEvent.create({
        data: {
          tenantId: tenant,
          periodKey: state.periodKey,
          revision: state.revision,
          action: state.status === "APPROVED" ? "APPROVE" : "CALCULATE",
          actorId: ids.owner,
          reason: "cp006 progress fixture",
          previousHash: null,
          stateHash: payrollInputHash(state),
          state: json,
        },
      });
    }),
  );
}

/**
 * Removes this run's salon.
 *
 * The payroll close tables are append-only by trigger and referenced by a foreign key, so
 * the purge lifts replication triggers for the length of one transaction. That is only
 * ever attempted against the disposable `*test` database the guard below requires; a
 * database user that may not lift them simply leaves the rows behind, where a later run
 * cannot mistake them for its own.
 */
async function purge() {
  const tenants = [tenantId, foreignTenantId];
  await runAsPlatform(async () => {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        for (const table of [
          "payroll_close_events",
          "payroll_closes",
          "payroll_plans",
          "users",
          "outlets",
        ])
          await tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE "tenantId" = ANY($1)`, tenants);
        await tx.$executeRawUnsafe("DELETE FROM tenants WHERE id = ANY($1)", tenants);
      });
    } catch (error) {
      console.warn(`cp006 progress purge skipped: ${(error as Error).message}`);
    }
  });
}

before(async () => {
  if (!enabled) return;
  const url = new URL(process.env.DATABASE_URL ?? "");
  // A guard, not a convenience: this suite creates salons and must never point at anything
  // but a disposable database.
  assert.match(url.pathname, /test/, "CP006_PROGRESS_DB requires a database named *test*");
  process.env.NODE_ENV = "test";
  await purge();
  await runAsPlatform(() =>
    prisma.tenant.createMany({
      data: [
        { id: tenantId, name: "CP006 progress", slug: tenantId, timeZone: "Asia/Singapore" },
        { id: foreignTenantId, name: "CP006 foreign", slug: foreignTenantId },
      ],
    }),
  );
  const person = (id: string, tenant: string, role: GlobalRole) =>
    runAsTenant(tenant, () =>
      prisma.user.create({
        data: {
          id,
          tenantId: tenant,
          name: `${role} ${id.slice(0, 4)}`,
          email: `${id}@cp006.test`,
          passwordHash: "fixture",
          globalRole: role,
          twoFactorEnabled: true,
        },
      }),
    );
  await person(ids.owner, tenantId, "SUPER_ADMIN");
  await person(ids.manager, tenantId, "MANAGER");
  await person(ids.seller, tenantId, "STAFF");
  await person(ids.colleague, tenantId, "STAFF");
  await person(ids.foreignSeller, foreignTenantId, "STAFF");
  await runAsTenant(tenantId, async () => {
    await prisma.outlet.create({
      data: { id: outletId, tenantId, name: "Branch", slug: outletId, status: "ACTIVE" },
    });
  });
  for (const [tenant, id] of [
    [tenantId, planId],
    [foreignTenantId, foreignPlanId],
  ] as const)
    await runAsTenant(tenant, () =>
      prisma.payrollPlan.create({
        data: {
          id,
          tenantId: tenant,
          name: "Service plan",
          description: "Fixture",
          positions: [],
          outletIds: [],
        },
      }),
    );
});

after(async () => {
  if (!enabled) return;
  await purge();
  await prisma.$disconnect();
});

test("CP-006 progress and self-service read real payroll rows", { skip: !enabled }, async () => {
  const september = rekey(closeState("2026-09", true));
  const august = rekey(closeState("2026-08", true));
  const octoberDraft = rekey(closeState("2026-10", false));
  await store(tenantId, september);
  await store(tenantId, august);
  await store(tenantId, octoberDraft);
  // The other salon's month holds that salon's own staff row only.
  await store(
    foreignTenantId,
    rekey(closeState("2026-09", true), { "staff-a": ids.foreignSeller }, foreignPlanId),
  );

  // A management read sees this salon's table only, named from the salon's own plan row.
  const salon = await runAsTenant(
    tenantId,
    () => readStoredPayrollProgress("2026-09"),
    ids.manager,
  );
  assert.equal(salon.scope, "SALON");
  assert.equal(salon.basis, "APPROVED");
  assert.equal(salon.estimated, false);
  assert.deepEqual(
    salon.rows.map((row) => row.staff.id),
    [ids.seller, ids.colleague],
  );
  assert.equal(salon.rows[0]?.planName, "Service plan");
  assert.equal(salon.rows[1]?.planName, null);
  assert.equal(salon.totals.commission, "200.00");
  assert.equal(salon.totals.estimate, "250.00");
  assert.equal(JSON.stringify(salon).includes("basicSalary"), false);

  // A staff read is narrowed to that person's line, whatever the caller asks for.
  const own = await runAsTenant(tenantId, () => readStoredPayrollProgress("2026-09"), ids.seller);
  assert.equal(own.scope, "SELF");
  assert.deepEqual(
    own.rows.map((row) => row.staff.id),
    [ids.seller],
  );

  // An outlet picker narrows further: the manager has no statement, so no salon table appears.
  const atOutlet = await runAsTenant(
    tenantId,
    () => runAtOutlet(outletId, () => readStoredPayrollProgress("2026-09")),
    ids.manager,
  );
  assert.equal(atOutlet.scope, "SELF");
  assert.deepEqual(atOutlet.rows, []);

  // An owner or manager asking for a self read gets their own line — here none — instead
  // of the salon table a "Your month-to-date progress" card must never show.
  const ownManager = await runAsTenant(
    tenantId,
    () => readStoredPayrollProgress("2026-09", "SELF"),
    ids.manager,
  );
  assert.equal(ownManager.scope, "SELF");
  assert.deepEqual(ownManager.rows, []);
  assert.equal(ownManager.totals.staff, 0);

  // A month nobody calculated is not invented, and the default month is the salon's own.
  const uncalculated = await runAsTenant(
    tenantId,
    () => readStoredPayrollProgress("2026-07"),
    ids.manager,
  );
  assert.equal(uncalculated.basis, "NOT_CALCULATED");
  assert.deepEqual(uncalculated.rows, []);
  const current = await runAsTenant(tenantId, () => readStoredPayrollProgress(), ids.manager);
  assert.match(current.periodKey, /^[1-9]\d{3}-(0[1-9]|1[0-2])$/);

  // Own-statement history: frozen months only, newest first, and bounded.
  const history = await runAsTenant(tenantId, () => readStoredPayrollStatements(12), ids.seller);
  assert.deepEqual(
    history.statements.map((row) => row.periodKey),
    ["2026-09", "2026-08"],
  );
  assert.equal(history.hasMore, false);
  const firstOnly = await runAsTenant(tenantId, () => readStoredPayrollStatements(1), ids.seller);
  assert.deepEqual(
    firstOnly.statements.map((row) => row.periodKey),
    ["2026-09"],
  );
  assert.equal(firstOnly.hasMore, true);
  assert.equal(JSON.stringify(history).includes("takeHome"), false);

  // Another salon's approved month is invisible to both reads.
  const foreign = await runAsTenant(
    foreignTenantId,
    () => readStoredPayrollStatements(12),
    ids.foreignSeller,
  );
  assert.deepEqual(
    foreign.statements.map((row) => row.periodKey),
    ["2026-09"],
  );

  // Neither read writes: the stored snapshots and their audit rows are untouched.
  const count = (tenant: string) =>
    runAsTenant(tenant, () => prisma.payrollClose.count({ where: { tenantId: tenant } }));
  assert.equal(await count(tenantId), 3);
  assert.equal(await count(foreignTenantId), 1);
});

test(
  "CP-006 progress refuses a snapshot its audit row no longer covers",
  { skip: !enabled },
  async () => {
    await store(tenantId, rekey(closeState("2026-06", true)));
    // Rewriting a stored snapshot in place is what the history guard exists to stop, so a
    // tampered row only reaches the table with that guard lifted — the position a
    // compromised writer would be in. The read model must still refuse to show it: the
    // month-to-date read verifies the snapshot against the audited hash even though it
    // no longer reads the audit payload itself (see `verifiedPayrollCloseSnapshot`).
    await runAsPlatform(() =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        await tx.$executeRawUnsafe(
          `UPDATE payroll_closes SET state = jsonb_set(state, '{calculation,statements,0,staff,name}', '"Tampered"')
             WHERE "tenantId" = $1 AND "periodKey" = '2026-06'`,
          tenantId,
        );
      }),
    );
    await assert.rejects(
      runAsTenant(tenantId, () => readStoredPayrollProgress("2026-06"), ids.manager),
      /audit does not match/,
    );
    // The same snapshot read through the full check is refused too, so the cheaper read
    // path did not become the weak one.
    await assert.rejects(
      runAsTenant(tenantId, () => readStoredPayrollClose("2026-06"), ids.manager),
      /audit does not match/,
    );
  },
);
