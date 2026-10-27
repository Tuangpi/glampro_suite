import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import {
  hairPayrollExample,
  tpPayrollExample,
  resolvePayrollPlan,
  calculatePayrollComponent,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { createStaff, updateStaff } from "./staff.service.js";
import {
  readPayrollConfiguration,
  createPayrollPlan,
  savePayrollDraft,
  publishPayrollDraft,
  archivePayrollPlan,
  duplicatePayrollPlan,
  assignPayrollPlan,
  savePayrollStaffSettings,
  savePayrollProfile,
  savePayrollSettings,
  updatePayrollPlan,
} from "./payroll-configuration.service.js";

test(
  "CP-003 disposable lifecycle, audit, isolation, permissions and publication races",
  { skip: process.env.RUN_CP003_ACCEPTANCE !== "true" },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.ok(["55473", "55474"].includes(url.port));
    assert.equal(url.pathname, "/payroll_configuration_test");
    const tenantId = `cp003-${Date.now()}`;
    const ownerId = `${tenantId}-owner`;
    const managerId = `${tenantId}-manager`;
    const staffId = `${tenantId}-staff`;
    const scope = <T>(fn: () => T, actorId = ownerId) => runAsTenant(tenantId, fn, actorId);
    await runAsPlatform(async () => {
      for (const id of [tenantId, `${tenantId}-other`])
        await prisma.tenant.create({ data: { id, slug: id, name: "Synthetic CP003" } });
      await prisma.module.upsert({
        where: { code: "staff" },
        update: { isCore: true },
        create: { code: "staff", name: "Staff", category: "Core", isCore: true },
      });
    });
    try {
      await scope(async () => {
        for (const [id, globalRole] of [
          [ownerId, "SUPER_ADMIN"],
          [managerId, "MANAGER"],
          [staffId, "STAFF"],
        ] as const)
          await prisma.user.create({
            data: {
              id,
              tenantId,
              name: id,
              email: `${id}@example.test`,
              passwordHash: "synthetic-not-a-password",
              globalRole,
              twoFactorEnabled: true,
            },
          });
        const outlet = await prisma.outlet.create({
          data: { tenantId, name: "Branch", slug: "branch" },
        });
        const otherOutlet = await prisma.outlet.create({
          data: { tenantId, name: "Other branch", slug: "other-branch" },
        });
        let config = await readPayrollConfiguration();
        assert.equal(config.earningsActive, false);
        assert.equal(config.settings.minimumDepositPct, "30");
        const date = config.today;
        const reason = "Synthetic verification";
        const legacy = await prisma.user.create({
          data: {
            tenantId,
            name: "Unclassified legacy staff",
            email: `${tenantId}-legacy@example.test`,
            passwordHash: "unused",
          },
        });
        const legacyDepartment = await prisma.department.create({
          data: { tenantId, name: "Legacy lifecycle branch" },
        });
        const legacyAuditCount = await prisma.payrollConfigurationEvent.count();
        for (const actorId of [ownerId, managerId]) {
          await assert.rejects(
            scope(
              () =>
                updateStaff(legacy.id, {
                  name: "Must not persist",
                  globalRole: "MANAGER",
                  position: "Non-commission",
                  departmentIds: [legacyDepartment.id],
                }),
              actorId,
            ),
            /audited payroll classification/,
          );
        }
        assert.equal(
          (await prisma.user.findFirstOrThrow({ where: { id: legacy.id } })).name,
          "Unclassified legacy staff",
        );
        assert.equal(await prisma.staffDepartment.count({ where: { userId: legacy.id } }), 0);
        assert.equal(await prisma.payrollConfigurationEvent.count(), legacyAuditCount);
        await scope(() => updateStaff(legacy.id, { disabled: true }), managerId);
        await updateStaff(legacy.id, { name: "Suspended legacy staff" });
        await assert.rejects(
          scope(() => updateStaff(legacy.id, { disabled: false }), managerId),
          /audited payroll classification/,
        );
        assert.equal(
          (await prisma.user.findFirstOrThrow({ where: { id: legacy.id } })).disabled,
          true,
        );
        await assert.rejects(
          scope(
            () =>
              savePayrollStaffSettings(legacy.id, {
                expectedRevision: 0,
                expectedJoinDate: null,
                joinDate: date,
                stageEndOverride: null,
                commissionRole: "NON_COMMISSION",
                reason,
              }),
            managerId,
          ),
          /not permitted/,
        );
        await savePayrollStaffSettings(legacy.id, {
          expectedRevision: 0,
          expectedJoinDate: null,
          joinDate: date,
          stageEndOverride: null,
          commissionRole: "NON_COMMISSION",
          reason,
        });
        await scope(
          () =>
            updateStaff(legacy.id, {
              disabled: false,
              departmentIds: [legacyDepartment.id],
            }),
          managerId,
        );
        assert.equal(
          (await prisma.user.findFirstOrThrow({ where: { id: legacy.id } })).disabled,
          false,
        );
        assert.equal(await prisma.staffDepartment.count({ where: { userId: legacy.id } }), 1);
        const dateStaffId = `${tenantId}-date-race`;
        await prisma.user.create({
          data: {
            id: dateStaffId,
            tenantId,
            name: "Date race",
            passwordHash: "unused",
            disabled: true,
          },
        });
        await assert.rejects(updateStaff(dateStaffId, { startDate: "2026-09-01" }), /Reload/);
        await updateStaff(dateStaffId, { startDate: "2026-09-01", expectedStartDate: null });
        await assert.rejects(
          updateStaff(dateStaffId, {
            startDate: null,
            expectedStartDate: null,
            name: "Must not persist",
          }),
          /changed/,
        );
        await assert.rejects(
          savePayrollStaffSettings(dateStaffId, {
            expectedRevision: 0,
            expectedJoinDate: null,
            joinDate: "2026-08-01",
            stageEndOverride: null,
            reason,
          }),
          /changed/,
        );
        assert.equal(
          await prisma.payrollConfigurationEvent.count({
            where: { kind: "STAFF", targetId: dateStaffId },
          }),
          0,
        );
        const dateRace = await Promise.allSettled([
          updateStaff(dateStaffId, { startDate: "2026-07-01", expectedStartDate: "2026-09-01" }),
          savePayrollStaffSettings(dateStaffId, {
            expectedRevision: 0,
            expectedJoinDate: "2026-09-01",
            joinDate: "2026-08-01",
            stageEndOverride: null,
            reason,
          }),
        ]);
        assert.equal(dateRace.filter((result) => result.status === "fulfilled").length, 1);
        const winner = await prisma.user.findFirstOrThrow({ where: { id: dateStaffId } });
        const winnerDate = winner.startDate!.toISOString().slice(0, 10);
        assert.equal(winner.name, "Date race");
        assert.equal(winnerDate, dateRace[0]!.status === "fulfilled" ? "2026-07-01" : "2026-08-01");
        // Ensure payroll ownership is established regardless of which writer won.
        const dateRevision = dateRace[1]!.status === "fulfilled" ? 1 : 0;
        await savePayrollStaffSettings(dateStaffId, {
          expectedRevision: dateRevision,
          expectedJoinDate: winnerDate,
          joinDate: winnerDate,
          stageEndOverride: null,
          reason,
        });
        await assert.rejects(
          updateStaff(dateStaffId, {
            startDate: null,
            expectedStartDate: winnerDate,
            name: "Must not persist",
          }),
          /payroll settings/,
        );
        await updateStaff(dateStaffId, { name: "Profile only" });
        assert.equal(
          (await prisma.user.findFirstOrThrow({ where: { id: dateStaffId } }))
            .startDate!.toISOString()
            .slice(0, 10),
          winnerDate,
        );
        const dateAuditCount = await prisma.payrollConfigurationEvent.count({
          where: { kind: "STAFF", targetId: dateStaffId },
        });
        await assert.rejects(
          savePayrollStaffSettings(dateStaffId, {
            expectedRevision: dateRevision,
            expectedJoinDate: winnerDate,
            joinDate: "2026-06-01",
            stageEndOverride: null,
            reason,
          }),
          /changed/,
        );
        assert.equal(
          await prisma.payrollConfigurationEvent.count({
            where: { kind: "STAFF", targetId: dateStaffId },
          }),
          dateAuditCount,
        );
        const metadata = {
          name: "Hair",
          description: "Synthetic",
          positions: ["Stylist"],
          outletIds: [],
        };
        const first = await createPayrollPlan({
          ...metadata,
          definition: hairPayrollExample(),
          reason,
        });
        assert.equal(first.revision, 1);
        assert.equal(first.versions[0]!.status, "DRAFT");
        await assert.rejects(
          publishPayrollDraft(first.id, { expectedRevision: 0, reason }),
          /changed/,
        );
        await assert.rejects(
          savePayrollDraft(first.id, {
            expectedRevision: 1,
            reason: " ",
            definition: hairPayrollExample(),
            effectiveFrom: date,
          }),
        );
        const invalid = hairPayrollExample();
        invalid.components[0]!.bands[1]!.upperLimit = "1";
        await assert.rejects(
          savePayrollDraft(first.id, {
            expectedRevision: 1,
            reason,
            definition: invalid,
            effectiveFrom: date,
          }),
        );
        assert.equal((await readPayrollConfiguration()).plans[0]!.revision, 1);
        const race = await Promise.allSettled([
          publishPayrollDraft(first.id, { expectedRevision: 1, reason }),
          publishPayrollDraft(first.id, { expectedRevision: 1, reason }),
        ]);
        assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
        const published = await prisma.payrollPlanVersion.findFirstOrThrow({
          where: { planId: first.id, status: "PUBLISHED" },
        });
        assert.equal(
          calculatePayrollComponent(hairPayrollExample().components[0]!, "6830").amount,
          "546.40",
        );
        assert.deepEqual(published.definition, hairPayrollExample());
        await assert.rejects(
          prisma.payrollPlanVersion.update({
            where: { id: published.id },
            data: { reason: "tamper" },
          }),
          /immutable/,
        );
        await assert.rejects(
          prisma.payrollPlanVersion.delete({ where: { id: published.id } }),
          /immutable/,
        );
        const audit = await prisma.payrollConfigurationEvent.findFirstOrThrow({
          where: { kind: "PLAN", targetId: first.id },
        });
        await assert.rejects(
          prisma.payrollConfigurationEvent.update({
            where: { id: audit.id },
            data: { reason: "tamper" },
          }),
          /immutable/,
        );
        await assert.rejects(
          assignPayrollPlan({
            expectedRevision: 0,
            staffIds: [staffId],
            planId: first.id,
            fromDate: date,
            reason,
          }),
          /join date/,
        );
        await savePayrollStaffSettings(staffId, {
          expectedRevision: 0,
          expectedJoinDate: null,
          joinDate: "2026-09-01",
          stageEndOverride: null,
          reason,
        });
        await assert.rejects(
          savePayrollStaffSettings(staffId, {
            expectedRevision: 1,
            expectedJoinDate: "2026-09-01",
            joinDate: "2026-09-01",
            stageEndOverride: null,
            commissionRole: "COMMISSION_EARNING",
            reason,
          }),
          /require an assignment/,
        );
        assert.equal(
          (await readPayrollConfiguration()).staff.find((s) => s.id === staffId)!.settings
            .commissionRole,
          null,
        );
        assert.equal(
          (await prisma.user.findFirstOrThrow({ where: { id: staffId } }))
            .startDate!.toISOString()
            .slice(0, 10),
          "2026-09-01",
        );
        await assignPayrollPlan({
          expectedRevision: 0,
          staffIds: [staffId],
          planId: first.id,
          fromDate: date,
          reason,
        });
        // Date edits cannot strand assignment history, and failed writes add no audit.
        const afterAssignment = await readPayrollConfiguration();
        const nextYearJoinDate = `${Number(date.slice(0, 4)) + 1}-01-01`;
        await assert.rejects(
          savePayrollStaffSettings(staffId, {
            expectedRevision: 1,
            expectedJoinDate: "2026-09-01",
            joinDate: nextYearJoinDate,
            stageEndOverride: null,
            reason,
          }),
          /after an existing payroll assignment/,
        );
        assert.equal((await readPayrollConfiguration()).historyTotal, afterAssignment.historyTotal);
        assert.equal(
          (await prisma.user.findFirstOrThrow({ where: { id: staffId } }))
            .startDate!.toISOString()
            .slice(0, 10),
          "2026-09-01",
        );
        const preJoinStaff = await prisma.user.create({
          data: {
            tenantId,
            name: "Future join date",
            passwordHash: "unused",
            startDate: new Date(`${nextYearJoinDate}T00:00:00Z`),
          },
        });
        await assert.rejects(
          assignPayrollPlan({
            expectedRevision: 1,
            staffIds: [preJoinStaff.id],
            planId: first.id,
            fromDate: date,
            reason,
          }),
          /before the staff join date/,
        );
        assert.deepEqual(
          (await readPayrollConfiguration()).assignments,
          afterAssignment.assignments,
        );
        await assert.rejects(
          assignPayrollPlan({
            expectedRevision: 0,
            staffIds: [staffId],
            planId: first.id,
            fromDate: date,
            reason,
          }),
          /changed/,
        );
        await assert.rejects(
          assignPayrollPlan({
            expectedRevision: 1,
            staffIds: [staffId],
            planId: first.id,
            fromDate: date,
            reason,
          }),
          /history/,
        );
        const tp = await createPayrollPlan({
          ...metadata,
          name: "TP",
          definition: tpPayrollExample(),
          reason,
        });
        await publishPayrollDraft(tp.id, { expectedRevision: 1, reason });
        const future = `${Number(date.slice(0, 4)) + 1}-01-31`;
        await assignPayrollPlan({
          expectedRevision: 1,
          staffIds: [staffId],
          planId: tp.id,
          fromDate: future,
          reason,
        });
        config = await readPayrollConfiguration();
        const versions = config.plans
          .flatMap((p) => p.versions)
          .map((v) => ({
            id: v.id,
            planId: v.planId,
            versionNo: v.versionNo,
            effectiveFrom: v.effectiveFrom,
            status: v.status as "DRAFT" | "PUBLISHED",
            definition: v.definition as ReturnType<typeof hairPayrollExample>,
          }));
        assert.equal(
          resolvePayrollPlan(staffId, future.slice(0, 7), config.assignments.rows, versions)!
            .version.planId,
          tp.id,
        );
        assert.equal(
          config.assignments.rows.find((r) => r.planId === first.id)!.toDate,
          `${future.slice(0, 7)}-30`,
        );
        await assert.rejects(
          scope(
            () =>
              savePayrollStaffSettings(staffId, {
                expectedRevision: 1,
                expectedJoinDate: "2026-09-01",
                joinDate: "2026-09-01",
                stageEndOverride: null,
                commissionRole: "COMMISSION_EARNING",
                reason,
              }),
            managerId,
          ),
          /permitted/,
        );
        await savePayrollStaffSettings(staffId, {
          expectedRevision: 1,
          expectedJoinDate: "2026-09-01",
          joinDate: "2026-09-01",
          stageEndOverride: null,
          commissionRole: "COMMISSION_EARNING",
          reason,
        });
        // Older callers omitting classification cannot erase its plan requirement.
        await savePayrollStaffSettings(staffId, {
          expectedRevision: 2,
          expectedJoinDate: "2026-09-01",
          joinDate: "2026-09-01",
          stageEndOverride: null,
          reason,
        });
        const classified = await readPayrollConfiguration();
        assert.equal(
          classified.staff.find((s) => s.id === staffId)!.settings.commissionRole,
          "COMMISSION_EARNING",
        );
        await assert.rejects(
          assignPayrollPlan({
            expectedRevision: classified.assignments.revision,
            staffIds: [staffId],
            planId: null,
            fromDate: `${Number(date.slice(0, 4)) + 2}-01-01`,
            reason,
          }),
          /Change the classification first/,
        );
        assert.deepEqual((await readPayrollConfiguration()).assignments, classified.assignments);
        await assert.rejects(
          savePayrollStaffSettings(staffId, {
            expectedRevision: 2,
            expectedJoinDate: "2026-09-01",
            joinDate: "2026-09-01",
            stageEndOverride: null,
            commissionRole: "NON_COMMISSION",
            reason,
          }),
          /changed/,
        );
        await savePayrollProfile(staffId, {
          expectedRevision: 0,
          basicSalary: "2345.67",
          fixedOvertime: "100",
          levy: "250",
          salesAlertPct: "40",
          reason,
        });
        await assert.rejects(
          savePayrollProfile(staffId, {
            expectedRevision: 0,
            basicSalary: "1",
            fixedOvertime: "0",
            levy: "0",
            salesAlertPct: "40",
            reason,
          }),
          /changed/,
        );
        await savePayrollStaffSettings(staffId, {
          expectedRevision: 3,
          expectedJoinDate: "2026-09-01",
          joinDate: "2026-09-01",
          stageEndOverride: null,
          commissionRole: "NON_COMMISSION",
          reason,
        });
        const removalDate = `${Number(date.slice(0, 4)) + 2}-01-01`;
        await assignPayrollPlan({
          expectedRevision: (await readPayrollConfiguration()).assignments.revision,
          staffIds: [staffId],
          planId: null,
          fromDate: removalDate,
          reason,
        });
        await assert.rejects(
          savePayrollStaffSettings(staffId, {
            expectedRevision: 4,
            expectedJoinDate: "2026-09-01",
            joinDate: "2026-09-01",
            stageEndOverride: null,
            commissionRole: "COMMISSION_EARNING",
            reason,
          }),
          /scheduled plan removal/,
        );
        // Restore continuous coverage before continuing the lifecycle fixture.
        await assignPayrollPlan({
          expectedRevision: (await readPayrollConfiguration()).assignments.revision,
          staffIds: [staffId],
          planId: tp.id,
          fromDate: removalDate,
          reason,
        });
        const managerConfig = await scope(() => readPayrollConfiguration(), managerId);
        assert.ok(managerConfig.staff.every((s) => !("profile" in s)));
        assert.ok(!JSON.stringify(managerConfig).includes("2345.67"));
        await assert.rejects(
          scope(
            () =>
              savePayrollProfile(staffId, {
                expectedRevision: 1,
                basicSalary: "1",
                fixedOvertime: "0",
                levy: "0",
                salesAlertPct: "0",
                reason,
              }),
            managerId,
          ),
          /permitted/,
        );
        await assert.rejects(
          scope(() => readPayrollConfiguration(), staffId),
          /permitted/,
        );
        const scopedPlan = await runAtOutlet(outlet.id, () =>
          createPayrollPlan({
            ...metadata,
            outletIds: [outlet.id],
            definition: hairPayrollExample(),
            reason,
          }),
        );
        await runAtOutlet(otherOutlet.id, async () => {
          assert.ok(!(await readPayrollConfiguration()).plans.some((p) => p.id === scopedPlan.id));
          await assert.rejects(
            publishPayrollDraft(scopedPlan.id, { expectedRevision: 1, reason }),
            /not found/,
          );
          await assert.rejects(
            savePayrollDraft(first.id, {
              expectedRevision: 2,
              effectiveFrom: future,
              definition: hairPayrollExample(),
              reason,
            }),
            /company-wide/,
          );
          await assert.rejects(
            assignPayrollPlan({
              expectedRevision: 2,
              staffIds: [staffId],
              planId: first.id,
              fromDate: future,
              reason,
            }),
          );
        });
        await runAsTenant(`${tenantId}-other`, async () => {
          const foreignActor = await prisma.user.create({
            data: {
              tenantId: `${tenantId}-other`,
              name: "Foreign owner",
              passwordHash: "unused",
              globalRole: "SUPER_ADMIN",
              twoFactorEnabled: true,
            },
          });
          await runAsTenant(
            `${tenantId}-other`,
            async () => {
              assert.equal((await readPayrollConfiguration()).plans.length, 0);
              await assert.rejects(
                publishPayrollDraft(first.id, { expectedRevision: 2, reason }),
                /not found/,
              );
              await assert.rejects(
                savePayrollStaffSettings(staffId, {
                  expectedRevision: 0,
                  expectedJoinDate: null,
                  joinDate: date,
                  stageEndOverride: null,
                  reason,
                }),
                /not found/,
              );
            },
            foreignActor.id,
          );
        });
        const duplicate = await duplicatePayrollPlan(first.id, {
          ...metadata,
          name: "Copy",
          expectedRevision: 2,
          reason,
        });
        assert.deepEqual(duplicate.versions[0]!.definition, published.definition);
        await archivePayrollPlan(duplicate.id, { expectedRevision: 1, reason });
        await assert.rejects(
          publishPayrollDraft(duplicate.id, { expectedRevision: 2, reason }),
          /Archived/,
        );
        const settings = (await readPayrollConfiguration()).settings;
        const { revision: settingsRevision, ...values } = settings;
        await savePayrollSettings({
          ...values,
          expectedRevision: settingsRevision,
          reason,
          minimumDepositPct: "40",
        });
        assert.equal((await readPayrollConfiguration()).settings.minimumDepositPct, "40");
        // Metadata is revision-checked and must never mutate published rule snapshots.
        const renamed = await updatePayrollPlan(first.id, {
          ...metadata,
          name: "Hair renamed",
          expectedRevision: 2,
          reason,
        });
        assert.equal(renamed.revision, 3);
        assert.deepEqual(
          renamed.versions.find((v) => v.status === "PUBLISHED")!.definition,
          published.definition,
        );
        await assert.rejects(
          updatePayrollPlan(first.id, {
            ...metadata,
            expectedRevision: 2,
            reason,
          }),
          /changed/,
        );
        await assert.rejects(
          updatePayrollPlan(first.id, {
            ...metadata,
            outletIds: [outlet.id],
            expectedRevision: 3,
            reason,
          }),
          /Duplicate/,
        );
        // More than one page of immutable evidence must remain accessible.
        for (let index = 0; index < 103; index++) {
          const current = (await readPayrollConfiguration()).settings;
          const { revision, ...payload } = current;
          await savePayrollSettings({ ...payload, expectedRevision: revision, reason });
        }
        const pageOne = await readPayrollConfiguration(1);
        const pageTwo = await readPayrollConfiguration(2);
        assert.equal(pageOne.history.length, 100);
        assert.ok(pageTwo.history.length > 0);
        assert.equal(pageOne.historyTotal, pageTwo.historyTotal);
        assert.equal(pageOne.historyTotal, pageOne.history.length + pageTwo.history.length);
        assert.ok(
          pageTwo.history.every((entry) => !pageOne.history.some((other) => entry.id === other.id)),
        );
        await assert.rejects(readPayrollConfiguration(0), /Invalid audit page/);
        await scope(async () => {
          const managerHistory = await readPayrollConfiguration();
          assert.ok(managerHistory.history.every((entry) => entry.kind !== "PROFILE"));
          assert.ok(managerHistory.historyTotal < pageOne.historyTotal);
        }, managerId);
        await runAtOutlet(outlet.id, async () => {
          const outletHistory = await readPayrollConfiguration();
          assert.ok(
            outletHistory.history.every(
              (entry) =>
                entry.kind === "PLAN" &&
                outletHistory.plans.some((plan) => plan.id === entry.targetId),
            ),
          );
          assert.ok(outletHistory.historyTotal < pageOne.historyTotal);
        });
        const initialDepartment = await prisma.department.create({
          data: { tenantId, name: "Atomic creation branch" },
        });
        const initial = {
          name: "Atomic payroll identity",
          posPin: "123456",
          startDate: "2026-09-01",
          departmentIds: [initialDepartment.id],
        };
        const revisionBeforeCreate = (await readPayrollConfiguration()).assignments.revision;
        const initialAssignment = {
          planId: first.id,
          fromDate: date,
          expectedRevision: revisionBeforeCreate,
          reason,
        };
        const beforeUsers = await prisma.user.count();
        const beforeEvents = await prisma.payrollConfigurationEvent.count();
        const beforeLinks = await prisma.staffDepartment.count();
        await assert.rejects(
          createStaff({
            ...initial,
            payrollAssignment: { ...initialAssignment, planId: "missing-plan" },
          }),
          /not found/i,
        );
        await assert.rejects(
          runAsTenant(
            tenantId,
            () => createStaff({ ...initial, payrollAssignment: initialAssignment }),
            managerId,
          ),
          /not permitted/i,
        );
        assert.equal(await prisma.user.count(), beforeUsers);
        assert.equal(await prisma.payrollConfigurationEvent.count(), beforeEvents);
        assert.equal(await prisma.staffDepartment.count(), beforeLinks);
        const atomicStaff = await createStaff({ ...initial, payrollAssignment: initialAssignment });
        assert.equal(atomicStaff.startDate, initial.startDate);
        assert.equal(atomicStaff.departments[0]?.id, initialDepartment.id);
        assert.ok(
          (await readPayrollConfiguration()).assignments.rows.some(
            (row) => row.staffId === atomicStaff.id && row.planId === first.id,
          ),
        );
        await assert.rejects(
          createStaff({ ...initial, payrollAssignment: initialAssignment }),
          /changed/i,
        );
        assert.equal(await prisma.user.count(), beforeUsers + 1);
        assert.equal(await prisma.staffDepartment.count(), beforeLinks + 1);
        const classifiedInput = {
          ...initial,
          payrollClassification: {
            commissionRole: "COMMISSION_EARNING" as const,
            reason,
          },
        };
        await assert.rejects(createStaff(classifiedInput), /require an initial payroll plan/);
        const classifiedRevision = (await readPayrollConfiguration()).assignments.revision;
        const classifiedAssignment = { ...initialAssignment, expectedRevision: classifiedRevision };
        const classifiedCount = await prisma.user.count();
        const classifiedAuditCount = await prisma.payrollConfigurationEvent.count();
        // A future-only plan cannot satisfy classification for the current payroll month.
        await assert.rejects(
          createStaff({
            ...classifiedInput,
            payrollAssignment: {
              ...classifiedAssignment,
              fromDate: `${Number(date.slice(0, 4)) + 3}-01-01`,
            },
          }),
          /current payroll month/,
        );
        assert.equal(await prisma.user.count(), classifiedCount);
        assert.equal(await prisma.payrollConfigurationEvent.count(), classifiedAuditCount);
        assert.equal(await prisma.staffDepartment.count(), beforeLinks + 1);
        const classifiedCreated = await createStaff({
          ...classifiedInput,
          payrollAssignment: classifiedAssignment,
        });
        assert.equal(
          (await readPayrollConfiguration()).staff.find((s) => s.id === classifiedCreated.id)!
            .settings.commissionRole,
          "COMMISSION_EARNING",
        );
        await assert.rejects(
          scope(
            () =>
              createStaff({
                ...initial,
                payrollClassification: { commissionRole: "NON_COMMISSION", reason },
              }),
            managerId,
          ),
          /not permitted/,
        );
        const nonCommission = await createStaff({
          ...initial,
          payrollClassification: { commissionRole: "NON_COMMISSION", reason },
        });
        const classificationConfig = await readPayrollConfiguration();
        assert.equal(
          classificationConfig.staff.find((s) => s.id === nonCommission.id)!.settings
            .commissionRole,
          "NON_COMMISSION",
        );
        assert.ok(
          !classificationConfig.assignments.rows.some((r) => r.staffId === nonCommission.id),
        );
        await updateStaff(classifiedCreated.id, { name: "Valid classified profile edit" });
        // Synthetic imported inconsistent evidence: lifecycle edits must fail closed.
        const inconsistent = await prisma.user.create({
          data: {
            tenantId,
            name: "Imported commission earner",
            passwordHash: "unused",
            startDate: new Date("2026-09-01T00:00:00Z"),
          },
        });
        await prisma.payrollConfigurationEvent.create({
          data: {
            tenantId,
            kind: "STAFF",
            targetId: inconsistent.id,
            revision: 1,
            actorId: ownerId,
            reason: "Synthetic imported evidence",
            payload: {
              commissionRole: "COMMISSION_EARNING",
              joinDate: "2026-09-01",
              stageEndOverride: null,
            },
          },
        });
        const lifecycleAuditCount = await prisma.payrollConfigurationEvent.count();
        await assert.rejects(
          updateStaff(inconsistent.id, {
            name: "Must roll back",
            departmentIds: [initialDepartment.id],
          }),
          /current payroll month/,
        );
        const unchanged = await prisma.user.findFirstOrThrow({ where: { id: inconsistent.id } });
        assert.equal(unchanged.name, "Imported commission earner");
        assert.equal(await prisma.staffDepartment.count({ where: { userId: inconsistent.id } }), 0);
        await updateStaff(inconsistent.id, { disabled: true });
        await assert.rejects(
          updateStaff(inconsistent.id, { disabled: false }),
          /current payroll month/,
        );
        assert.equal(
          (await prisma.user.findFirstOrThrow({ where: { id: inconsistent.id } })).disabled,
          true,
        );
        assert.equal(await prisma.payrollConfigurationEvent.count(), lifecycleAuditCount);
        // The owner can repair classification before reactivation; managers cannot bypass it.
        await savePayrollStaffSettings(inconsistent.id, {
          expectedRevision: 1,
          expectedJoinDate: "2026-09-01",
          joinDate: "2026-09-01",
          stageEndOverride: null,
          commissionRole: "NON_COMMISSION",
          reason,
        });
        await scope(() => updateStaff(inconsistent.id, { disabled: false }), managerId);
        assert.equal(
          (await prisma.user.findFirstOrThrow({ where: { id: inconsistent.id } })).disabled,
          false,
        );
        const missingDate = await prisma.user.create({
          data: {
            tenantId,
            name: "Imported missing join date",
            passwordHash: "unused",
            disabled: true,
          },
        });
        await prisma.payrollConfigurationEvent.create({
          data: {
            tenantId,
            kind: "STAFF",
            targetId: missingDate.id,
            revision: 1,
            actorId: ownerId,
            reason: "Synthetic imported evidence",
            payload: { commissionRole: "NON_COMMISSION", stageEndOverride: null },
          },
        });
        await assert.rejects(
          scope(
            () => updateStaff(missingDate.id, { disabled: false, name: "Must not reactivate" }),
            managerId,
          ),
          /Classified staff require a join date/,
        );
        const stillDisabled = await prisma.user.findFirstOrThrow({ where: { id: missingDate.id } });
        assert.equal(stillDisabled.disabled, true);
        assert.equal(stillDisabled.name, "Imported missing join date");
        await savePayrollStaffSettings(missingDate.id, {
          expectedRevision: 1,
          expectedJoinDate: null,
          joinDate: "2026-09-01",
          stageEndOverride: null,
          reason,
        });
        await updateStaff(missingDate.id, { disabled: false });
        // Locked periods reject prospective dates that would retroactively select new rules.
        await prisma.commissionPeriod.create({
          data: {
            tenantId,
            startsAt: new Date("2098-01-01T00:00:00Z"),
            endsAt: new Date("2098-02-01T00:00:00Z"),
            timezone: "UTC",
            approvedAt: new Date(),
            lockedAt: new Date(),
          },
        });
        await assert.rejects(
          savePayrollDraft(first.id, {
            expectedRevision: 2,
            effectiveFrom: "2098-01-15",
            definition: hairPayrollExample(),
            reason,
          }),
          /locked/,
        );
      });
      const { createApp } = await import("../app.js");
      const { signAccessToken } = await import("../lib/tokens.js");
      const server = createApp().listen(0, "127.0.0.1");
      await once(server, "listening");
      try {
        const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/payroll-configuration`;
        const token = (id: string, role: "SUPER_ADMIN" | "MANAGER" | "STAFF") =>
          signAccessToken({
            id,
            email: `${id}@example.test`,
            globalRole: role,
            realm: "web",
            tokenVersion: 0,
            tenantId,
          }).token;
        const ownerToken = token(ownerId, "SUPER_ADMIN");
        const staffHeaders = {
          Authorization: `Bearer ${ownerToken}`,
          "Content-Type": "application/json",
        };
        const patchDate = (body: object) =>
          fetch(`${root.replace("/payroll-configuration", "/staff")}/${staffId}`, {
            method: "PATCH",
            headers: staffHeaders,
            body: JSON.stringify(body),
          });
        assert.equal((await patchDate({ startDate: "2026-08-01" })).status, 422);
        assert.equal(
          (await patchDate({ startDate: "2026-08-01", expectedStartDate: null })).status,
          409,
        );
        assert.equal(
          (await patchDate({ startDate: null, expectedStartDate: "2026-09-01" })).status,
          400,
        );
        const payrollDate = (body: object) =>
          fetch(`${root}/staff/${staffId}/settings`, {
            method: "POST",
            headers: staffHeaders,
            body: JSON.stringify(body),
          });
        assert.equal(
          (
            await payrollDate({
              expectedRevision: 1,
              joinDate: "2026-09-01",
              stageEndOverride: null,
              reason: "HTTP concurrency",
            })
          ).status,
          422,
        );
        assert.equal(
          (
            await payrollDate({
              expectedRevision: 1,
              expectedJoinDate: null,
              joinDate: "2026-09-01",
              stageEndOverride: null,
              reason: "HTTP concurrency",
            })
          ).status,
          409,
        );
        assert.equal((await fetch(root)).status, 401);
        assert.equal(
          (await fetch(root, { headers: { Authorization: `Bearer ${token(staffId, "STAFF")}` } }))
            .status,
          403,
        );
        assert.equal(
          (await fetch(root, { headers: { Authorization: `Bearer ${ownerToken}` } })).status,
          200,
        );
        assert.equal(
          (
            await fetch(`${root}?historyPage=0`, {
              headers: { Authorization: `Bearer ${ownerToken}` },
            })
          ).status,
          422,
        );
        const auditPage = await fetch(`${root}?historyPage=2`, {
          headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert.equal(auditPage.status, 200);
        assert.equal(
          ((await auditPage.json()) as { data: { historyPage: number } }).data.historyPage,
          2,
        );
        const calculator = await fetch(`${root}/calculator`, {
          method: "POST",
          headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ component: hairPayrollExample().components[0], base: "6830" }),
        });
        assert.equal(calculator.status, 200);
        assert.equal(
          ((await calculator.json()) as { data: { result: { amount: string } } }).data.result
            .amount,
          "546.40",
        );
        const stagedCalculator = await fetch(`${root}/calculator`, {
          method: "POST",
          headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            component: hairPayrollExample().components[0],
            base: "4000",
            stageKey: "new",
          }),
        });
        assert.equal(stagedCalculator.status, 200);
        const staged = (await stagedCalculator.json()) as {
          data: {
            result: { amount: string };
            chart: { base: string; methods: { method: string; result: { amount: string } }[] }[];
          };
        };
        assert.equal(staged.data.result.amount, "160.00");
        assert.equal(
          staged.data.chart
            .find((point) => point.base === "4000.0000")!
            .methods.find((method) => method.method === "TIER_WHOLE")!.result.amount,
          staged.data.result.amount,
        );
        assert.equal(
          (
            await fetch(`${root}/plans`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token(managerId, "MANAGER")}`,
                "Content-Type": "application/json",
              },
              body: "{}",
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await fetch(`${root}/plans`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${ownerToken}`,
                "Content-Type": "application/json",
              },
              body: "{}",
            })
          ).status,
          422,
        );
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    } finally {
      // Evidence is intentionally immutable. This test uses a disposable DB; do not delete audit rows.
      await prisma.$disconnect();
    }
  },
);
