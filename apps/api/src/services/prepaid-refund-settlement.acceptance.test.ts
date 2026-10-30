import { loadPayrollPackageRedemptionHistory } from "./payroll-close-redemption-loader.js";
import { loadPayrollValueSpendHistory } from "./payroll-close-value-loader.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { createSale } from "./sale.service.js";
import {
  refundPayrollValuePackage,
  refundPayrollValuePackageInTransaction,
} from "./payroll-value-package-refund.js";
import type { RefundPayrollPackage } from "@glampro_suite/shared";
import { refundPayrollPackage } from "./payroll-package-refund.js";

test(
  "confirmed prepaid refund atomically records append-only payout and cancellation without provider payment",
  {
    skip: process.env.RUN_CP005_ACCEPTANCE !== "true",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55485");
    assert.equal(url.pathname, "/payroll_close_test");
    const tenantId = `cp005-settlement-${randomUUID()}`;
    const actorId = `${tenantId}-owner`;
    try {
      await runAsPlatform(() =>
        prisma.tenant.create({
          data: { id: tenantId, slug: tenantId, name: "Synthetic settlement", gstEnabled: true },
        }),
      );
      await runAsTenant(
        tenantId,
        async () => {
          await prisma.user.create({
            data: {
              id: actorId,
              tenantId,
              name: "Owner",
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
          const outlet = await prisma.outlet.create({
            data: { tenantId, name: "Outlet", slug: "settlement" },
          });
          const buyer = await prisma.customer.create({ data: { tenantId, name: "Buyer" } });
          const item = await prisma.valuePackage.create({
            data: { tenantId, name: "545 for 600", price: "545", credit: "600" },
          });
          const buy = await runAtOutlet(outlet.id, () =>
            createSale({
              customerId: buyer.id,
              lines: [
                {
                  itemType: "VALUE_PACKAGE",
                  itemId: item.id,
                  quantity: 1,
                  attribution: { sellers: [{ staffId: actorId, share: 10000 }] },
                },
              ],
              payments: [{ method: "CASH", amount: 545 }],
              collection: {
                currency: "SGD",
                allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "54500" }],
              },
            }),
          );
          const holding = await prisma.customerValuePackageHolding.findFirstOrThrow({
            where: { saleLine: { saleId: buy.id } },
          });
          const input: RefundPayrollPackage = {
            idempotencyKey: randomUUID(),
            expectedUpdatedAt: holding.updatedAt.toISOString(),
            reason: "Customer received confirmed cash refund",
            adminFeeNetCents: "0",
            payoutGrossCents: "54500",
            payoutMethod: "CASH",
            settlement: { confirmed: true, reference: "cash-voucher-disposable-001" },
          };
          const event = await refundPayrollValuePackage(holding.id, input);
          const settlement = await prisma.prepaidRefundSettlement.findFirstOrThrow({
            where: { holdingId: holding.id },
          });
          assert.equal(settlement.grossCents, 54500n);
          assert.equal(settlement.netCents, 50000n);
          assert.equal(settlement.taxCents, 4500n);
          assert.equal(settlement.cancelledGrossCents, 0n);
          assert.equal(settlement.sourceKey, event.sourceKey);
          assert.equal(
            (
              await prisma.customerValuePackageHolding.findFirstOrThrow({
                where: { id: holding.id },
              })
            ).amountRemaining.toFixed(2),
            "0.00",
          );
          assert.equal((await refundPayrollValuePackage(holding.id, input)).id, event.id);
          assert.equal(await prisma.prepaidRefundSettlement.count(), 1);
          await assert.rejects(
            () =>
              refundPayrollValuePackage(holding.id, {
                ...input,
                settlement: { confirmed: true, reference: "changed" },
              }),
            /different evidence/,
          );
          await assert.rejects(
            () =>
              prisma.prepaidRefundSettlement.update({
                where: { id: settlement.id },
                data: { reference: "changed" },
              }),
            /append-only/,
          );
          await assert.rejects(
            () => prisma.prepaidRefundSettlement.delete({ where: { id: settlement.id } }),
            /append-only/,
          );
          const snapshots = await prisma.prepaidBalanceEvent.findMany({
            where: { holdingId: holding.id },
          });
          assert.equal(snapshots.filter((row) => row.kind === "SPEND").length, 1);
          assert.equal(await prisma.saleRefund.count(), 0);
          const partialBuy = await runAtOutlet(outlet.id, () =>
            createSale({
              customerId: buyer.id,
              lines: [
                {
                  itemType: "VALUE_PACKAGE",
                  itemId: item.id,
                  quantity: 1,
                  attribution: { sellers: [{ staffId: actorId, share: 10000 }] },
                },
              ],
              payments: [{ method: "CASH", amount: 109 }],
              collection: {
                currency: "SGD",
                allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "10900" }],
              },
            }),
          );
          const partial = await prisma.customerValuePackageHolding.findFirstOrThrow({
            where: { saleLine: { saleId: partialBuy.id } },
          });
          const partialInput: RefundPayrollPackage = {
            ...input,
            idempotencyKey: randomUUID(),
            expectedUpdatedAt: partial.updatedAt.toISOString(),
            payoutGrossCents: "10900",
          };
          await assert.rejects(
            () =>
              prisma.$transaction(async (tx) => {
                await refundPayrollValuePackageInTransaction(tx, partial.id, partialInput);
                throw new Error("Synthetic rollback after all refund writes");
              }),
            /Synthetic rollback/,
          );
          assert.equal(
            await prisma.prepaidRefundSettlement.count({ where: { holdingId: partial.id } }),
            0,
          );
          const sessionItem = await prisma.package.create({
            data: {
              tenantId,
              name: "Five sessions",
              memberPrice: "545",
              nonmemberPrice: "545",
              sessionCount: 5,
              commissionSettings: {
                sale: { mode: "FOLLOW_PLAN" },
                redemption: { mode: "FOLLOW_PLAN" },
                minimumDepositPct: "0",
              },
            },
          });
          const sessionBuy = await runAtOutlet(outlet.id, () =>
            createSale({
              customerId: buyer.id,
              lines: [
                {
                  itemType: "PACKAGE",
                  itemId: sessionItem.id,
                  quantity: 1,
                  attribution: { sellers: [{ staffId: actorId, share: 10000 }] },
                },
              ],
              payments: [{ method: "CASH", amount: 545 }],
              collection: {
                currency: "SGD",
                allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "54500" }],
              },
            }),
          );
          const session = await prisma.customerPackageHolding.findFirstOrThrow({
            where: { saleLine: { saleId: sessionBuy.id } },
          });
          const sessionInput: RefundPayrollPackage = {
            ...input,
            idempotencyKey: randomUUID(),
            expectedUpdatedAt: session.updatedAt.toISOString(),
          };
          const sessionEvent = await refundPayrollPackage(session.id, sessionInput);
          const sessionSettlement = await prisma.prepaidRefundSettlement.findFirstOrThrow({
            where: { holdingId: session.id },
          });
          assert.equal(sessionSettlement.itemType, "PACKAGE");
          assert.equal(sessionSettlement.grossCents, 54500n);
          assert.equal(sessionSettlement.netCents, 50000n);
          assert.equal(sessionSettlement.taxCents, 4500n);
          assert.equal(
            (await prisma.customerPackageHolding.findFirstOrThrow({ where: { id: session.id } }))
              .quantityRemaining,
            0,
          );
          assert.equal((await refundPayrollPackage(session.id, sessionInput)).id, sessionEvent.id);
          assert.equal(
            await prisma.prepaidRefundSettlement.count({ where: { holdingId: session.id } }),
            1,
          );
          assert.equal(
            (
              await prisma.customerValuePackageHolding.findFirstOrThrow({
                where: { id: partial.id },
              })
            ).amountRemaining.toFixed(2),
            "600.00",
          );
          assert.equal(
            (
              await prisma.customerOutstanding.findFirstOrThrow({
                where: { saleId: partialBuy.id },
              })
            ).unpaidAmount.toFixed(2),
            "436.00",
          );
          const retries = await Promise.all([
            refundPayrollValuePackage(partial.id, partialInput),
            refundPayrollValuePackage(partial.id, partialInput),
          ]);
          assert.equal(retries[0].id, retries[1].id);
          const cancelled = await prisma.prepaidRefundSettlement.findFirstOrThrow({
            where: { holdingId: partial.id },
          });
          assert.equal(cancelled.grossCents, 10900n);
          assert.equal(cancelled.netCents, 10000n);
          assert.equal(cancelled.taxCents, 900n);
          assert.equal(cancelled.cancelledGrossCents, 43600n);
          const sessionHistory = await prisma.$transaction((tx) =>
            loadPayrollPackageRedemptionHistory(tx, session.id),
          );
          assert.equal(sessionHistory.refund?.settlement.id, sessionSettlement.id);
          assert.deepEqual(sessionHistory.verified.remaining, [{ first: 1, last: 5 }]);
          for (const id of [holding.id, partial.id]) {
            const history = await prisma.$transaction((tx) => loadPayrollValueSpendHistory(tx, id));
            assert.ok(history.refund);
            assert.equal(history.verified.length, 0, "cancellation is not usage");
          }

          assert.equal(
            (
              await prisma.customerOutstanding.findFirstOrThrow({
                where: { saleId: partialBuy.id },
              })
            ).unpaidAmount.toFixed(2),
            "0.00",
          );
          assert.equal(
            await prisma.prepaidRefundSettlement.count({ where: { holdingId: partial.id } }),
            1,
          );
          assert.equal(
            await runAsTenant("foreign", () => prisma.prepaidRefundSettlement.count()),
            0,
          );
        },
        actorId,
      );
    } finally {
      await prisma.$disconnect();
    }
  },
);
