import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import { PAYROLL_DEFAULT_SETTINGS, payrollPlanDefinitionSchema } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { authorizeStoredPayrollCarry } from "../services/payroll-close-authorizations.js";
import { createSale } from "../services/sale.service.js";
import {
  createPayrollPlan,
  publishPayrollDraft,
  assignPayrollPlan,
} from "../services/payroll-configuration.service.js";

/** Historical configuration is synthetic; monthly HTTP inputs still use the real loader. */
export async function payrollCloseFixture(size = 4, withSales = false) {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55485");
  assert.equal(url.pathname, "/payroll_close_test");
  const [identity] = await prisma.$queryRaw<{ directory: string; timezone: string }[]>`
    SELECT current_setting('data_directory') AS directory, current_setting('TimeZone') AS timezone`;
  assert.match(identity.directory, /^\/tmp\/cp005-/);
  assert.equal(identity.timezone, "UTC");
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-08-15T00:00:00Z") });
  const tenantId = `cp005-m45-${randomUUID()}`;
  const ids = Array.from({ length: size }, () => randomUUID());
  const [ownerId, managerId, staffId, cashierId] = ids;
  await runAsPlatform(() =>
    prisma.tenant.create({ data: { id: tenantId, slug: tenantId, name: "M4 acceptance" } }),
  );
  const scope = <T>(fn: () => T) => runAsTenant(tenantId, fn, ownerId);
  try {
    await scope(async () => {
      const module = await prisma.module.upsert({
        where: { code: "staff" },
        update: {},
        create: { code: "staff", name: "Staff", category: "Core", isCore: true },
      });
      await prisma.tenantModule.create({ data: { tenantId, moduleId: module.id } });
      const outlet = await prisma.outlet.create({
        data: { tenantId, name: "Acceptance branch", slug: "branch" },
      });
      for (const [index, id] of ids.entries()) {
        await prisma.user.create({
          data: {
            id,
            tenantId,
            name:
              ["Close Owner", "Close Manager", "Close Staff", "Close Cashier"][index] ??
              `Close Staff ${index}`,
            email: `${id}@example.test`,
            passwordHash: "synthetic-unused",
            globalRole:
              index === 0
                ? "SUPER_ADMIN"
                : index === 1
                  ? "MANAGER"
                  : index === 3
                    ? "CASHIER"
                    : "STAFF",
            twoFactorEnabled: true,
            startDate: new Date("2020-01-01"),
          },
        });
        for (const [kind, payload] of [
          [
            "STAFF",
            { joinDate: "2020-01-01", stageEndOverride: null, commissionRole: "NON_COMMISSION" },
          ],
          [
            "PROFILE",
            { basicSalary: "2000.00", fixedOvertime: "0", levy: "100", salesAlertPct: "50" },
          ],
        ] as const)
          await prisma.payrollConfigurationEvent.create({
            data: {
              tenantId,
              kind,
              targetId: id,
              payload,
              revision: 1,
              actorId: ownerId,
              reason: "Reviewed synthetic historical configuration",
              createdAt: new Date("2026-08-15T00:00:00Z"),
            },
          });
      }
      await prisma.payrollConfigurationEvent.create({
        data: {
          tenantId,
          kind: "SETTINGS",
          targetId: "company",
          payload: PAYROLL_DEFAULT_SETTINGS,
          revision: 1,
          actorId: ownerId,
          reason: "Reviewed synthetic historical settings",
          createdAt: new Date("2026-08-15T00:00:00Z"),
        },
      });
      await authorizeStoredPayrollCarry(
        "OPENING",
        "2026-09",
        0,
        {
          staff: ids.map((id) => ({
            staffId: id,
            carryForward: [],
            fallbackCarryCommission: "0.0000000000",
          })),
          evidence: { inventoryReference: "Reviewed complete synthetic M4 opening inventory" },
        },
        "Reviewed synthetic opening inventory",
      );
      if (withSales) {
        const plan = await createPayrollPlan({
          name: "Acceptance service plan",
          description: "Synthetic flat ten percent",
          positions: [],
          outletIds: [],
          definition: payrollPlanDefinitionSchema.parse({
            stages: [],
            components: [
              {
                key: "service",
                name: "Service commission",
                sort: 1,
                commissionTypes: ["SVC"],
                basePct: "100",
                method: "FLAT",
                flatRatePct: "10",
                bands: [],
              },
            ],
            incentives: [],
          }),
          reason: "Reviewed synthetic plan",
        });
        await publishPayrollDraft(plan.id, {
          expectedRevision: plan.revision,
          reason: "Reviewed synthetic publication",
        });
        await assignPayrollPlan({
          expectedRevision: 0,
          staffIds: ids,
          planId: plan.id,
          fromDate: "2026-08-15",
          reason: "Reviewed synthetic assignments",
        });
        for (const code of ["sales", "catalogue"]) {
          const enabled = await prisma.module.upsert({
            where: { code },
            update: {},
            create: { code, name: code, category: "Core", isCore: true },
          });
          await prisma.tenantModule.create({ data: { tenantId, moduleId: enabled.id } });
        }
        const service = await prisma.service.create({
          data: {
            tenantId,
            name: "Performance service",
            memberPrice: "100",
            nonmemberPrice: "100",
          },
        });
        mock.timers.reset();
        mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-15T00:00:00Z") });
        for (const id of ids)
          await runAtOutlet(outlet.id, () =>
            createSale({
              lines: [
                {
                  itemType: "SERVICE",
                  itemId: service.id,
                  quantity: 1,
                  attribution: {
                    sellers: [{ staffId: id, share: 10000 }],
                    performers: [{ staffId: id, share: 10000 }],
                  },
                },
              ],
              payments: [{ method: "CASH", amount: 100 }],
              collection: {
                currency: "SGD",
                allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "10000" }],
              },
            }),
          );
      }
    });
  } finally {
    mock.timers.reset();
  }
  return { tenantId, ownerId, managerId, staffId, cashierId, ids, scope };
}
