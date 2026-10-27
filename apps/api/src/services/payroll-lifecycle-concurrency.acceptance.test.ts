import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { hairPayrollExample, type PayrollStaffSettingsWrite } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../lib/http-error.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { createStaff, updateStaff } from "./staff.service.js";
import {
  assignPayrollPlan,
  createPayrollPlan,
  publishPayrollDraft,
  readPayrollConfiguration,
  savePayrollStaffSettings,
} from "./payroll-configuration.service.js";

function oneWinner(results: PromiseSettledResult<unknown>[]) {
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.ok(rejected.reason instanceof HttpError, "Expected a domain refusal, not a DB failure");
  assert.ok([400, 409].includes(rejected.reason.statusCode));
  return results.findIndex((result) => result.status === "fulfilled");
}

test(
  "CP-003 concurrent lifecycle writes preserve atomic identity, timelines and audit",
  { skip: process.env.RUN_CP003_ACCEPTANCE !== "true" },
  async (t) => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.ok(["55473", "55474"].includes(url.port));
    assert.equal(url.pathname, "/payroll_configuration_test");
    const tenantId = `cp003-race-${randomUUID()}`;
    const ownerId = `${tenantId}-owner`;
    const reason = "Synthetic lifecycle concurrency verification";
    const scope = <T>(fn: () => T) => runAsTenant(tenantId, fn, ownerId);
    await runAsPlatform(() =>
      prisma.tenant.create({
        data: { id: tenantId, slug: tenantId, name: "Synthetic lifecycle races" },
      }),
    );
    try {
      await scope(async () => {
        await prisma.user.create({
          data: {
            id: ownerId,
            tenantId,
            name: "Owner",
            passwordHash: "unused-synthetic-hash",
            email: `${ownerId}@example.test`,
            globalRole: "SUPER_ADMIN",
            twoFactorEnabled: true,
          },
        });
        const date = (await readPayrollConfiguration()).today;
        const nextDay = new Date(`${date}T00:00:00Z`);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        const tomorrow = nextDay.toISOString().slice(0, 10);
        const plan = await createPayrollPlan({
          name: "Race plan",
          description: "Synthetic",
          positions: [],
          outletIds: [],
          definition: hairPayrollExample(),
          reason,
        });
        await publishPayrollDraft(plan.id, { expectedRevision: 1, reason });
        const department = await prisma.department.create({
          data: { tenantId, name: "Race department" },
        });
        const staffInput = (name: string) => ({
          name,
          posPin: "654321",
          startDate: date,
          departmentIds: [department.id],
          payrollClassification: { commissionRole: "NON_COMMISSION" as const, reason },
        });
        const settingsInput = (expectedRevision: number): PayrollStaffSettingsWrite => ({
          expectedRevision,
          expectedJoinDate: date,
          joinDate: date,
          stageEndOverride: null,
          commissionRole: "NON_COMMISSION",
          reason,
        });

        await t.test(
          "competing atomic creations roll back losing identity and department links",
          async () => {
            const before = await readPayrollConfiguration();
            const usersBefore = await prisma.user.count();
            const linksBefore = await prisma.staffDepartment.count();
            const auditBefore = await prisma.payrollConfigurationEvent.count();
            const names = ["Concurrent creation A", "Concurrent creation B"];
            const results = await Promise.allSettled(
              names.map((name) =>
                createStaff({
                  ...staffInput(name),
                  payrollClassification: { commissionRole: "COMMISSION_EARNING", reason },
                  payrollAssignment: {
                    expectedRevision: before.assignments.revision,
                    planId: plan.id,
                    fromDate: date,
                    reason,
                  },
                }),
              ),
            );
            const winner = oneWinner(results);
            const after = await readPayrollConfiguration();
            assert.equal(await prisma.user.count(), usersBefore + 1);
            assert.equal(await prisma.staffDepartment.count(), linksBefore + 1);
            assert.equal(await prisma.payrollConfigurationEvent.count(), auditBefore + 2);
            assert.equal(after.assignments.revision, before.assignments.revision + 1);
            const created = await prisma.user.findMany({ where: { name: { in: names } } });
            assert.equal(created.length, 1);
            assert.equal(created[0].name, names[winner]);
            assert.equal(
              after.assignments.rows.filter((row) => row.staffId === created[0].id).length,
              1,
            );
            assert.equal(
              after.staff.find((staff) => staff.id === created[0].id)?.settings.commissionRole,
              "COMMISSION_EARNING",
            );
          },
        );

        await t.test("join-date edit and earlier assignment cannot both commit", async () => {
          const staff = await createStaff(staffInput("Join-date race"));
          const before = await readPayrollConfiguration();
          const auditBefore = await prisma.payrollConfigurationEvent.count();
          const results = await Promise.allSettled([
            savePayrollStaffSettings(staff.id, { ...settingsInput(1), joinDate: tomorrow }),
            assignPayrollPlan({
              expectedRevision: before.assignments.revision,
              staffIds: [staff.id],
              planId: plan.id,
              fromDate: date,
              reason,
            }),
          ]);
          const winner = oneWinner(results);
          const after = await readPayrollConfiguration();
          const row = after.staff.find((person) => person.id === staff.id)!;
          const assignments = after.assignments.rows.filter((entry) => entry.staffId === staff.id);
          assert.equal(row.settings.joinDate, winner === 0 ? tomorrow : date);
          assert.equal(row.settings.revision, winner === 0 ? 2 : 1);
          assert.equal(assignments.length, winner === 0 ? 0 : 1);
          assert.equal(
            after.assignments.revision,
            before.assignments.revision + (winner === 1 ? 1 : 0),
          );
          assert.ok(assignments.every((entry) => entry.fromDate >= row.settings.joinDate!));
          assert.equal(await prisma.payrollConfigurationEvent.count(), auditBefore + 1);
          assert.equal(await prisma.staffDepartment.count({ where: { userId: staff.id } }), 1);
        });

        await t.test(
          "classification and scheduled plan removal never strand a commission earner",
          async () => {
            const staff = await createStaff(staffInput("Classification race"));
            const initial = await readPayrollConfiguration();
            await assignPayrollPlan({
              expectedRevision: initial.assignments.revision,
              staffIds: [staff.id],
              planId: plan.id,
              fromDate: date,
              reason,
            });
            const before = await readPayrollConfiguration();
            const auditBefore = await prisma.payrollConfigurationEvent.count();
            const results = await Promise.allSettled([
              savePayrollStaffSettings(staff.id, {
                ...settingsInput(1),
                commissionRole: "COMMISSION_EARNING",
              }),
              assignPayrollPlan({
                expectedRevision: before.assignments.revision,
                staffIds: [staff.id],
                planId: null,
                fromDate: tomorrow,
                reason,
              }),
            ]);
            const winner = oneWinner(results);
            const after = await readPayrollConfiguration();
            const settings = after.staff.find((person) => person.id === staff.id)!.settings;
            const assignment = after.assignments.rows.find((entry) => entry.staffId === staff.id)!;
            assert.equal(
              settings.commissionRole,
              winner === 0 ? "COMMISSION_EARNING" : "NON_COMMISSION",
            );
            assert.equal(settings.revision, winner === 0 ? 2 : 1);
            assert.equal(assignment.toDate, winner === 0 ? null : date);
            assert.equal(
              after.assignments.revision,
              before.assignments.revision + (winner === 1 ? 1 : 0),
            );
            assert.equal(await prisma.payrollConfigurationEvent.count(), auditBefore + 1);
          },
        );

        await t.test(
          "reactivation racing audited repair never bypasses join-date validation",
          async () => {
            const staff = await prisma.user.create({
              data: {
                tenantId,
                name: "Unrepaired suspended staff",
                passwordHash: "unused",
                disabled: true,
                startDate: null,
              },
            });
            await prisma.payrollConfigurationEvent.create({
              data: {
                tenantId,
                kind: "STAFF",
                targetId: staff.id,
                revision: 1,
                actorId: ownerId,
                reason,
                payload: { commissionRole: "NON_COMMISSION", stageEndOverride: null },
              },
            });
            const auditBefore = await prisma.payrollConfigurationEvent.count();
            const [repair, reactivate] = await Promise.allSettled([
              savePayrollStaffSettings(staff.id, { ...settingsInput(1), expectedJoinDate: null }),
              updateStaff(staff.id, {
                disabled: false,
                name: "Reactivated after repair",
                departmentIds: [department.id],
              }),
            ]);
            assert.equal(repair.status, "fulfilled");
            if (reactivate.status === "rejected") {
              assert.ok(reactivate.reason instanceof HttpError);
              assert.equal(reactivate.reason.statusCode, 400);
              assert.match(reactivate.reason.message, /join date/);
            }
            const persisted = await prisma.user.findFirstOrThrow({ where: { id: staff.id } });
            assert.equal(persisted.startDate?.toISOString().slice(0, 10), date);
            assert.equal(persisted.disabled, reactivate.status === "rejected");
            assert.equal(
              persisted.name,
              reactivate.status === "fulfilled"
                ? "Reactivated after repair"
                : "Unrepaired suspended staff",
            );
            assert.equal(
              await prisma.staffDepartment.count({ where: { userId: staff.id } }),
              reactivate.status === "fulfilled" ? 1 : 0,
            );
            assert.equal(await prisma.payrollConfigurationEvent.count(), auditBefore + 1);
            if (reactivate.status === "rejected") {
              await updateStaff(staff.id, {
                disabled: false,
                name: "Reactivated after repair",
                departmentIds: [department.id],
              });
              assert.equal(
                (await prisma.user.findFirstOrThrow({ where: { id: staff.id } })).disabled,
                false,
              );
              assert.equal(await prisma.staffDepartment.count({ where: { userId: staff.id } }), 1);
            }
          },
        );

        await t.test("same-revision settings edits retain exactly one audited winner", async () => {
          const staff = await createStaff(staffInput("Settings race"));
          const auditBefore = await prisma.payrollConfigurationEvent.count();
          const results = await Promise.allSettled(
            [2, 4].map((stageEndOverride) =>
              savePayrollStaffSettings(staff.id, { ...settingsInput(1), stageEndOverride }),
            ),
          );
          const winner = oneWinner(results);
          const after = await readPayrollConfiguration();
          const settings = after.staff.find((person) => person.id === staff.id)!.settings;
          assert.equal(settings.revision, 2);
          assert.equal(settings.stageEndOverride, [2, 4][winner]);
          assert.equal(settings.joinDate, date);
          assert.equal(await prisma.payrollConfigurationEvent.count(), auditBefore + 1);
          assert.equal(
            await prisma.payrollConfigurationEvent.count({
              where: { kind: "STAFF", targetId: staff.id },
            }),
            2,
          );
        });
      });
    } finally {
      // Keep immutable synthetic evidence in the disposable database; never weaken triggers.
      await prisma.$disconnect();
    }
  },
);
