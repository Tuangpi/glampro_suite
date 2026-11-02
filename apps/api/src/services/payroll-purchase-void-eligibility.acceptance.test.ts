import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { createSale, voidSale } from "./sale.service.js";
import { transferPrepaid } from "./prepaid.service.js";
import { transferSessionPackage } from "./session-transfer.service.js";

const disabled = process.env.RUN_CP005_ACCEPTANCE !== "true";

// These tests must never use an application database, even when explicitly enabled.
async function assertDisposableTarget() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55485");
  assert.equal(url.pathname, "/payroll_close_test");
  const [identity] = await prisma.$queryRaw<
    { database: string; directory: string; timezone: string }[]
  >`SELECT current_database() AS database, current_setting('data_directory') AS directory,
    current_setting('TimeZone') AS timezone`;
  assert.equal(identity.database, "payroll_close_test");
  assert.match(identity.directory, /^\/tmp\/cp005-/);
  assert.equal(identity.timezone, "UTC");
}

for (const kind of ["PACKAGE", "VALUE_PACKAGE"] as const) {
  test(
    `CP-005-M1-14 ${kind} spent and transferred purchases refuse void without changing evidence`,
    { skip: disabled },
    async () => {
      await assertDisposableTarget();
      const tenantId = `cp005-eligibility-${randomUUID()}`;
      const actorId = randomUUID();
      await runAsPlatform(() =>
        prisma.tenant.create({
          data: { id: tenantId, slug: tenantId, name: "Void eligibility", status: "ACTIVE" },
        }),
      );
      await runAsTenant(
        tenantId,
        async () => {
          await prisma.user.create({
            data: {
              id: actorId,
              tenantId,
              name: "Synthetic owner",
              passwordHash: "synthetic-unused",
              globalRole: "SUPER_ADMIN",
              twoFactorEnabled: true,
            },
          });
          for (const code of ["catalogue", "packages", "sales", "customers"]) {
            const module = await prisma.module.upsert({
              where: { code },
              update: {},
              create: { code, name: code, category: "Core", isCore: true },
            });
            await prisma.tenantModule.create({ data: { tenantId, moduleId: module.id } });
          }
          const buyer = await prisma.customer.create({ data: { tenantId, name: "Buyer" } });
          const recipient = await prisma.customer.create({ data: { tenantId, name: "Recipient" } });
          const service = await prisma.service.create({
            data: { tenantId, name: "Service", memberPrice: 90, nonmemberPrice: 90 },
          });
          const item =
            kind === "PACKAGE"
              ? await prisma.package.create({
                  data: {
                    tenantId,
                    name: "Two sessions",
                    sessionCount: 2,
                    memberPrice: 180,
                    nonmemberPrice: 180,
                    services: { create: { tenantId, serviceId: service.id } },
                  },
                })
              : await prisma.valuePackage.create({
                  data: { tenantId, name: "Credit", price: 180, credit: 180 },
                });
          const purchase = await createSale({
            customerId: buyer.id,
            lines: [
              {
                itemType: kind,
                itemId: item.id,
                quantity: 1,
                attribution: { sellers: [{ staffId: actorId, share: 10000 }] },
              },
            ],
            payments: [{ method: "CASH", amount: 180 }],
            collection: {
              currency: "SGD",
              allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "18000" }],
            },
          });
          const holding =
            kind === "PACKAGE"
              ? await prisma.customerPackageHolding.findFirstOrThrow({
                  where: { saleLine: { saleId: purchase.id } },
                })
              : await prisma.customerValuePackageHolding.findFirstOrThrow({
                  where: { saleLine: { saleId: purchase.id } },
                });
          const spend = await createSale({
            customerId: buyer.id,
            lines: [{ itemType: "SERVICE", itemId: service.id, quantity: 1 }],
            payments: [
              {
                method: kind === "PACKAGE" ? "PACKAGE" : "PREPAID_CREDIT",
                holdingId: holding.id,
                amount: 90,
              },
            ],
          });
          // Snapshot all relevant state, not just the sale status. A refused void must
          // leave balances, valuation, transfers, captures and audit evidence untouched.
          const state = async () =>
            JSON.stringify(
              {
                sale: await prisma.sale.findFirstOrThrow({ where: { id: purchase.id } }),
                packages: await prisma.customerPackageHolding.findMany({ orderBy: { id: "asc" } }),
                credits: await prisma.customerValuePackageHolding.findMany({
                  orderBy: { id: "asc" },
                }),
                redemptions: await prisma.customerRedemption.findMany({ orderBy: { id: "asc" } }),
                balances: await prisma.prepaidBalanceEvent.findMany({ orderBy: { id: "asc" } }),
                creditTransfers: await prisma.prepaidTransferEvent.findMany({
                  orderBy: { id: "asc" },
                }),
                sessionTransfers: await prisma.sessionPackageTransferEvent.findMany({
                  orderBy: { id: "asc" },
                }),
                movements: await prisma.packageValuationMovement.findMany({
                  orderBy: { id: "asc" },
                }),
                sources: await prisma.payrollSourceEvent.findMany({ orderBy: { id: "asc" } }),
                audits: await prisma.auditLog.findMany({
                  where: { tenantId },
                  orderBy: { id: "asc" },
                }),
              },
              (_, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
            );
          const refusesWithoutMutation = async (code: string) => {
            const before = await state();
            await assert.rejects(
              voidSale(
                purchase.id,
                { reason: "Refuse ineligible purchase", cashDisposition: "NO_MOVEMENT" },
                actorId,
              ),
              { code },
            );
            assert.equal(await state(), before);
          };
          await refusesWithoutMutation("HOLDING_ALREADY_SPENT");
          // Returning the remaining balance to the buyer does not erase a transfer.
          // Exercise both ownership states, with actual transfer writers and journals.
          const transfer = async (from: string, to: string) => {
            const current =
              kind === "PACKAGE"
                ? await prisma.customerPackageHolding.findFirstOrThrow({
                    where: { id: holding.id },
                  })
                : await prisma.customerValuePackageHolding.findFirstOrThrow({
                    where: { id: holding.id },
                  });
            const input = {
              targetCustomerId: to,
              confirmed: true as const,
              expectedUpdatedAt: current.updatedAt.toISOString(),
              reason: "Synthetic ownership transfer",
            };
            if (kind === "PACKAGE") await transferSessionPackage(from, holding.id, input, actorId);
            else await transferPrepaid(from, holding.id, input, actorId);
          };
          await transfer(buyer.id, recipient.id);
          await refusesWithoutMutation("HOLDING_ALREADY_TRANSFERRED");
          await transfer(recipient.id, buyer.id);
          await refusesWithoutMutation("HOLDING_ALREADY_TRANSFERRED");
          await voidSale(spend.id, { reason: "Restore original spend" }, actorId);
          await refusesWithoutMutation("HOLDING_ALREADY_TRANSFERRED");
          assert.equal(
            await prisma.sale.count({ where: { id: purchase.id, status: "COMPLETED" } }),
            1,
          );
        },
        actorId,
      );
    },
  );
}
