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
          joinDate: "2026-09-01",
          stageEndOverride: null,
          reason,
        });
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
