import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { createSale } from "./sale.service.js";
import { recordSaleCollection } from "./sale-collection.service.js";
import { refundPayrollPackage } from "./payroll-package-refund.js";
import { transferSessionPackage } from "./session-transfer.service.js";
import { voidPayrollSession } from "./payroll-session-void.js";
import { publishCommissionAttributionPolicy } from "./commission-attribution-policy.js";

test(
  "CP004 split original session bases and competing redemption/payment/refund/transfer",
  {
    skip: process.env.COMMISSION_COLLECTION_ACCEPTANCE !== "1",
  },
  async (t) => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55476");
    assert.equal(url.pathname, "/commission_collection_test");
    const tenantId = `cp004-session-${randomUUID()}`;
    const actorId = `${tenantId}-owner`;
    const sellerId = `${tenantId}-seller`;
    try {
      await runAsPlatform(() =>
        prisma.tenant.create({
          data: { id: tenantId, name: "Synthetic session races", slug: tenantId },
        }),
      );
      await runAsTenant(
        tenantId,
        async () => {
          for (const id of [actorId, sellerId])
            await prisma.user.create({
              data: {
                id,
                tenantId,
                name: "Synthetic staff",
                passwordHash: "synthetic",
                globalRole: "SUPER_ADMIN",
                twoFactorEnabled: true,
              },
            });
          for (const code of ["catalogue", "packages", "sales"]) {
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
            data: { tenantId, name: "Session", memberPrice: "1000", nonmemberPrice: "1000" },
          });
          const item = await prisma.package.create({
            data: {
              tenantId,
              name: "Five original sessions",
              memberPrice: "5000",
              nonmemberPrice: "5000",
              sessionCount: 5,
              commissionSettings: {
                sale: { mode: "FOLLOW_PLAN" },
                redemption: { mode: "FOLLOW_PLAN" },
                minimumDepositPct: "40",
              },
            },
          });
          await prisma.packageService.create({
            data: { tenantId, packageId: item.id, serviceId: service.id },
          });
          const sellers = [
            { staffId: actorId, share: 5000 },
            { staffId: sellerId, share: 5000 },
          ];
          const buy = async (partial = false) => {
            const sale = await createSale({
              customerId: buyer.id,
              lines: [
                { itemType: "PACKAGE", itemId: item.id, quantity: 1, attribution: { sellers } },
              ],
              payments: [{ method: "CASH", amount: partial ? 2000 : 5000 }],
              collection: {
                currency: "SGD",
                allocations: [
                  { paymentIndex: 0, linePosition: 0, grossCents: partial ? "200000" : "500000" },
                ],
              },
            });
            const holding = await prisma.customerPackageHolding.findFirstOrThrow({
              where: { saleLine: { saleId: sale.id } },
            });
            return { sale, holding };
          };
          const redeem = (id: string, quantity = 1) =>
            createSale({
              customerId: buyer.id,
              lines: [
                {
                  itemType: "SERVICE",
                  itemId: service.id,
                  quantity,
                  attribution: { performers: [{ staffId: actorId, share: 10000 }] },
                },
              ],
              payments: [{ method: "PACKAGE", holdingId: id, amount: 1000 * quantity }],
            });
          const request = (updatedAt: Date, payoutGrossCents = "490000") => ({
            idempotencyKey: randomUUID(),
            expectedUpdatedAt: updatedAt.toISOString(),
            reason: "Synthetic refund race",
            adminFeeNetCents: "10000",
            payoutGrossCents,
            payoutMethod: "CASH" as const,
          });
          const collect = (saleId: string, saleLineId: string) =>
            recordSaleCollection(saleId, {
              idempotencyKey: randomUUID(),
              currency: "SGD",
              collected: true,
              grossCents: "300000",
              reason: "Synthetic later balance",
              allocations: [{ saleLineId, grossCents: "300000" }],
            });
          await t.test(
            "TC09/12 deposit and balance split, original session economics and refund -1450 each",
            async () => {
              const { sale, holding } = await buy(true);
              const deposit = await prisma.payrollSourceEvent.findMany({
                where: { saleId: sale.id, sourceType: "COLLECTION" },
              });
              assert.deepEqual(
                (deposit[0]!.evidence as { lines: { baseAmount: string }[] }).lines.map(
                  (row) => row.baseAmount,
                ),
                ["1000.0000", "1000.0000"],
              );
              const used = await redeem(holding.id, 2);
              const earned = await prisma.payrollSourceEvent.findMany({
                where: { saleId: used.id },
              });
              await collect(sale.id, holding.saleLineId!);
              const all = await prisma.payrollSourceEvent.findMany({
                where: { saleId: sale.id, sourceType: "COLLECTION" },
              });
              const balance = all.find((row) => row.id !== deposit[0]!.id)!;
              assert.deepEqual(
                (balance.evidence as { lines: { baseAmount: string }[] }).lines.map(
                  (row) => row.baseAmount,
                ),
                ["1500.0000", "1500.0000"],
              );
              const current = await prisma.customerPackageHolding.findFirstOrThrow({
                where: { id: holding.id },
              });
              const result = await refundPayrollPackage(
                holding.id,
                request(current.updatedAt, "290000"),
              );
              assert.deepEqual(
                (result.evidence as { lines: { baseAmount: string }[] }).lines.map(
                  (row) => row.baseAmount,
                ),
                ["-1450.0000", "-1450.0000"],
              );
              assert.deepEqual(
                await prisma.payrollSourceEvent.findMany({ where: { saleId: used.id } }),
                earned,
              );
            },
          );
          await t.test("refund versus redemption leaves exactly one valid ending", async () => {
            const { holding } = await buy();
            const results = await Promise.allSettled([
              redeem(holding.id),
              refundPayrollPackage(holding.id, request(holding.updatedAt)),
            ]);
            assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
            const final = await prisma.customerPackageHolding.findFirstOrThrow({
              where: { id: holding.id },
            });
            const refunds = await prisma.payrollSourceEvent.count({
              where: { sourceType: "PACKAGE_REFUND", sourceId: holding.id },
            });
            assert.equal(final.quantityRemaining, refunds ? 0 : 4);
          });
          await t.test(
            "refund versus transfer never cancels recipient credit using stale owner evidence",
            async () => {
              const { holding } = await buy();
              const results = await Promise.allSettled([
                transferSessionPackage(
                  buyer.id,
                  holding.id,
                  {
                    targetCustomerId: recipient.id,
                    expectedUpdatedAt: holding.updatedAt.toISOString(),
                    reason: "Synthetic transfer race",
                    confirmed: true,
                  },
                  actorId,
                ),
                refundPayrollPackage(holding.id, request(holding.updatedAt)),
              ]);
              assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
              const final = await prisma.customerPackageHolding.findFirstOrThrow({
                where: { id: holding.id },
              });
              assert.deepEqual(final.payrollPurchaseSnapshot, holding.payrollPurchaseSnapshot);
              assert.equal(
                final.customerId,
                final.quantityRemaining === 0 ? buyer.id : recipient.id,
              );
            },
          );
          await t.test(
            "refund versus session void retains only the winning session state",
            async () => {
              const { holding } = await buy();
              const used = await redeem(holding.id);
              const redemption = await prisma.customerRedemption.findFirstOrThrow({
                where: { saleId: used.id },
              });
              const current = await prisma.customerPackageHolding.findFirstOrThrow({
                where: { id: holding.id },
              });
              const results = await Promise.allSettled([
                voidPayrollSession(used.id, redemption.id, {
                  idempotencyKey: randomUUID(),
                  expectedRevision: 0,
                  reason: "Synthetic void race",
                }),
                refundPayrollPackage(holding.id, request(current.updatedAt, "390000")),
              ]);
              assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
              const final = await prisma.customerPackageHolding.findFirstOrThrow({
                where: { id: holding.id },
              });
              const refunds = await prisma.payrollSourceEvent.count({
                where: { sourceType: "PACKAGE_REFUND", sourceId: holding.id },
              });
              assert.equal(final.quantityRemaining, refunds ? 0 : 5);
              assert.equal(
                !!(
                  await prisma.customerRedemption.findFirstOrThrow({ where: { id: redemption.id } })
                ).revertedAt,
                !refunds,
              );
            },
          );
          await t.test(
            "payment versus refund cannot overpay or retain cancelled debt",
            async () => {
              const { sale, holding } = await buy(true);
              const results = await Promise.allSettled([
                collect(sale.id, holding.saleLineId!),
                refundPayrollPackage(holding.id, request(holding.updatedAt, "190000")),
              ]);
              assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
              assert.equal(
                (
                  await prisma.customerOutstanding.findFirstOrThrow({ where: { saleId: sale.id } })
                ).unpaidAmount.toFixed(2),
                "0.00",
              );
            },
          );
          await t.test(
            "TC18 required seller policy refuses checkout with no persisted sale",
            async () => {
              await publishCommissionAttributionPolicy(
                {
                  expectedRevision: null,
                  requireSellers: true,
                  requireServicePerformers: false,
                  requireRedemptionPerformers: false,
                  reason: "Synthetic required seller policy",
                },
                actorId,
              );
              const before = await prisma.sale.count();
              await assert.rejects(
                createSale({
                  customerId: buyer.id,
                  lines: [{ itemType: "PACKAGE", itemId: item.id, quantity: 1 }],
                  payments: [{ method: "CASH", amount: 5000 }],
                  collection: {
                    currency: "SGD",
                    allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "500000" }],
                  },
                }),
                /seller|sold by/i,
              );
              assert.equal(await prisma.sale.count(), before);
            },
          );
          assert.equal(await prisma.employeeCommission.count(), 0);
        },
        actorId,
      );
    } finally {
      await prisma.$disconnect();
    }
  },
);
