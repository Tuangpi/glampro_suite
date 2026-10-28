import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { salesRouter } from "../routes/sales.routes.js";
import { customersRouter } from "../routes/customers.routes.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { signAccessToken } from "../lib/tokens.js";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { createSale, voidSale } from "./sale.service.js";
import { recordSaleCollection } from "./sale-collection.service.js";
import { transferPrepaid } from "./prepaid.service.js";
import { getPayrollValueHoldingDetail } from "./payroll-value-holding-detail.js";
import {
  refundPayrollValuePackage,
  refundPayrollValuePackageInTransaction,
} from "./payroll-value-package-refund.js";

test(
  "CP004 value-package SQL lifecycle, rollback, tenant isolation and competing operations",
  {
    skip: process.env.COMMISSION_COLLECTION_ACCEPTANCE !== "1",
  },
  async (t) => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55476");
    assert.equal(url.pathname, "/commission_collection_test");
    const tenantId = `cp004-value-${randomUUID()}`;
    const actorId = `${tenantId}-owner`;
    const otherId = `${tenantId}-other`;
    try {
      await runAsPlatform(async () => {
        for (const id of [tenantId, otherId])
          await prisma.tenant.create({
            data: { id, name: "Synthetic value lifecycle", slug: id, gstEnabled: true },
          });
      });
      await runAsTenant(
        tenantId,
        async () => {
          await prisma.user.create({
            data: {
              id: actorId,
              tenantId,
              name: "Synthetic owner",
              passwordHash: "synthetic-no-login",
              globalRole: "SUPER_ADMIN",
              email: `${actorId}@example.invalid`,
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
          const item = await prisma.valuePackage.create({
            data: { tenantId, name: "545 for 600", price: "545", credit: "600" },
          });
          const service = await prisma.service.create({
            data: { tenantId, name: "Spend service", memberPrice: "100", nonmemberPrice: "100" },
          });
          const buy = async (partial = false) => {
            const sale = await createSale({
              customerId: buyer.id,
              lines: [
                {
                  itemType: "VALUE_PACKAGE",
                  itemId: item.id,
                  quantity: 1,
                  attribution: { sellers: [{ staffId: actorId, share: 10000 }] },
                },
              ],
              payments: partial
                ? [{ method: "CASH", amount: 218 }]
                : [
                    { method: "CASH", amount: 218 },
                    { method: "CARD", amount: 327 },
                  ],
              collection: {
                currency: "SGD",
                allocations: partial
                  ? [{ paymentIndex: 0, linePosition: 0, grossCents: "21800" }]
                  : [
                      { paymentIndex: 0, linePosition: 0, grossCents: "21800" },
                      { paymentIndex: 1, linePosition: 0, grossCents: "32700" },
                    ],
              },
            });
            const holding = await prisma.customerValuePackageHolding.findFirstOrThrow({
              where: { saleLine: { saleId: sale.id } },
            });
            return { sale, holding };
          };
          const spend = (holdingId: string) =>
            createSale({
              customerId: buyer.id,
              lines: [
                {
                  itemType: "SERVICE",
                  itemId: service.id,
                  quantity: 1,
                  attribution: { performers: [{ staffId: actorId, share: 10000 }] },
                },
              ],
              payments: [{ method: "PREPAID_CREDIT", holdingId, amount: 100 }],
            });
          const request = (updatedAt: Date, gross = "43600") => ({
            idempotencyKey: randomUUID(),
            expectedUpdatedAt: updatedAt.toISOString(),
            reason: "Synthetic unused credit refund",
            adminFeeNetCents: "10000",
            payoutGrossCents: gross,
            payoutMethod: "PAYNOW" as const,
          });

          await t.test(
            "mixed-tender purchase, earned spend, rollback, retry and post-refund guards",
            async () => {
              const { sale, holding } = await buy();
              const spent = await spend(holding.id);
              const current = await prisma.customerValuePackageHolding.findFirstOrThrow({
                where: { id: holding.id },
              });
              const input = request(current.updatedAt, "34516");
              const sources = await prisma.payrollSourceEvent.findMany({
                where: { saleId: sale.id },
              });
              const spendEvidence = await prisma.payrollSourceEvent.findMany({
                where: { saleId: spent.id },
              });
              const balanceCount = await prisma.prepaidBalanceEvent.count({
                where: { holdingId: holding.id },
              });
              await assert.rejects(
                prisma.$transaction(async (tx) => {
                  await refundPayrollValuePackageInTransaction(tx, holding.id, input);
                  throw new Error("Injected rollback after cancellation");
                }),
                /Injected rollback/,
              );
              assert.equal(
                await prisma.payrollSourceEvent.count({
                  where: { sourceType: "VALUE_PACKAGE_REFUND", sourceId: holding.id },
                }),
                0,
              );
              const afterRollback = await prisma.customerValuePackageHolding.findFirstOrThrow({
                where: { id: holding.id },
              });
              assert.equal(afterRollback.amountRemaining.toFixed(2), "500.00");
              assert.equal(
                await prisma.prepaidBalanceEvent.count({ where: { holdingId: holding.id } }),
                balanceCount,
              );
              assert.equal(afterRollback.updatedAt.toISOString(), current.updatedAt.toISOString());
              const [first, retry] = await Promise.all([
                refundPayrollValuePackage(holding.id, input),
                refundPayrollValuePackage(holding.id, input),
              ]);
              assert.equal(first.id, retry.id);
              const cancellation = await prisma.prepaidBalanceEvent.findMany({
                where: { holdingId: holding.id, reason: input.reason },
              });
              assert.equal(cancellation.length, 1);
              assert.equal(cancellation[0]!.actorId, actorId);
              assert.equal(cancellation[0]!.saleId, sale.id);
              assert.equal(cancellation[0]!.delta.toFixed(2), "-500.00");
              const evidence = first.evidence as {
                netCents: string;
                taxCents: string;
                lines: { status: string }[];
              };
              assert.equal(evidence.netCents, "31666");
              assert.equal(evidence.taxCents, "2850");
              assert.equal(evidence.lines[0]!.status, "EARNED");
              await assert.rejects(
                refundPayrollValuePackage(holding.id, {
                  ...input,
                  reason: "Conflicting retry reason",
                }),
                /different evidence/,
              );
              await assert.rejects(
                voidSale(sale.id, { reason: "Must not reverse package refund" }, actorId),
                /refunded package/,
              );
              await assert.rejects(
                voidSale(spent.id, { reason: "Must not restore cancelled credit" }, actorId),
                /cannot be restored/,
              );
              await assert.rejects(spend(holding.id));
              assert.deepEqual(
                await prisma.payrollSourceEvent.findMany({ where: { saleId: spent.id } }),
                spendEvidence,
              );
              assert.deepEqual(
                await prisma.payrollSourceEvent.findMany({
                  where: { saleId: sale.id, sourceType: "COLLECTION" },
                }),
                sources,
              );
              const detail = await getPayrollValueHoldingDetail(buyer.id, holding.id);
              assert.equal(detail.refunded, true);
              assert.equal(detail.refund?.grossCents, "34516");
              assert.equal(detail.creditRemaining, "0.00");
              await assert.rejects(
                prisma.payrollSourceEvent.update({
                  where: { id: first.id },
                  data: { reason: "Tamper" },
                }),
              );
              await assert.rejects(prisma.payrollSourceEvent.delete({ where: { id: first.id } }));
              await runAsTenant(otherId, async () => {
                assert.equal(await prisma.payrollSourceEvent.count({ where: { id: first.id } }), 0);
                await assert.rejects(
                  getPayrollValueHoldingDetail(buyer.id, holding.id),
                  /does not exist/,
                );
              });
            },
          );

          await t.test("competing distinct refunds yield one cancellation", async () => {
            const { holding } = await buy();
            const input = request(holding.updatedAt);
            const results = await Promise.allSettled([
              refundPayrollValuePackage(holding.id, input),
              refundPayrollValuePackage(holding.id, { ...input, idempotencyKey: randomUUID() }),
            ]);
            assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
            assert.equal(
              await prisma.payrollSourceEvent.count({
                where: { sourceType: "VALUE_PACKAGE_REFUND", sourceId: holding.id },
              }),
              1,
            );
          });
          await t.test(
            "spend/refund race never restores or overspends cancelled credit",
            async () => {
              const { holding } = await buy();
              const results = await Promise.allSettled([
                spend(holding.id),
                refundPayrollValuePackage(holding.id, request(holding.updatedAt)),
              ]);
              assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
              const final = await prisma.customerValuePackageHolding.findFirstOrThrow({
                where: { id: holding.id },
              });
              const refunds = await prisma.payrollSourceEvent.count({
                where: { sourceType: "VALUE_PACKAGE_REFUND", sourceId: holding.id },
              });
              assert.equal(final.amountRemaining.toFixed(2), refunds ? "0.00" : "500.00");
            },
          );
          await t.test(
            "transfer/refund race preserves ownership and original snapshot",
            async () => {
              const { holding } = await buy();
              const results = await Promise.allSettled([
                transferPrepaid(
                  buyer.id,
                  holding.id,
                  {
                    targetCustomerId: recipient.id,
                    expectedUpdatedAt: holding.updatedAt.toISOString(),
                    reason: "Synthetic ownership race",
                    confirmed: true,
                  },
                  actorId,
                ),
                refundPayrollValuePackage(holding.id, request(holding.updatedAt)),
              ]);
              assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
              const final = await prisma.customerValuePackageHolding.findFirstOrThrow({
                where: { id: holding.id },
              });
              assert.deepEqual(final.payrollPurchaseSnapshot, holding.payrollPurchaseSnapshot);
              assert.equal(
                final.customerId,
                final.amountRemaining.isZero() ? buyer.id : recipient.id,
              );
            },
          );
          await t.test(
            "later collection/refund race reconciles debt or rejects stale payout",
            async () => {
              const { sale, holding } = await buy(true);
              const results = await Promise.allSettled([
                recordSaleCollection(sale.id, {
                  idempotencyKey: randomUUID(),
                  currency: "SGD",
                  collected: true,
                  grossCents: "32700",
                  reason: "Synthetic balance race",
                  allocations: [{ saleLineId: holding.saleLineId!, grossCents: "32700" }],
                }),
                refundPayrollValuePackage(holding.id, request(holding.updatedAt, "10900")),
              ]);
              assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
              const debt = await prisma.customerOutstanding.findFirstOrThrow({
                where: { saleId: sale.id },
              });
              assert.equal(debt.unpaidAmount.toFixed(2), "0.00");
              const refundCount = await prisma.payrollSourceEvent.count({
                where: { sourceType: "VALUE_PACKAGE_REFUND", sourceId: holding.id },
              });
              assert.equal(
                await prisma.customerOutstandingPayment.count({ where: { saleId: sale.id } }),
                refundCount ? 0 : 1,
              );
            },
          );
          await t.test(
            "partial debt cancellation rolls back with refund and holding evidence",
            async () => {
              const { sale, holding } = await buy(true);
              const input = request(holding.updatedAt, "10900");
              const balances = await prisma.prepaidBalanceEvent.count({
                where: { holdingId: holding.id },
              });
              await assert.rejects(
                prisma.$transaction(async (tx) => {
                  await refundPayrollValuePackageInTransaction(tx, holding.id, input);
                  throw new Error("Injected debt rollback");
                }),
                /Injected debt rollback/,
              );
              assert.equal(
                (
                  await prisma.customerOutstanding.findFirstOrThrow({ where: { saleId: sale.id } })
                ).unpaidAmount.toFixed(2),
                "327.00",
              );
              assert.equal(
                (
                  await prisma.customerValuePackageHolding.findFirstOrThrow({
                    where: { id: holding.id },
                  })
                ).amountRemaining.toFixed(2),
                "600.00",
              );
              assert.equal(
                await prisma.prepaidBalanceEvent.count({ where: { holdingId: holding.id } }),
                balances,
              );
              assert.equal(
                await prisma.payrollSourceEvent.count({
                  where: { sourceType: "VALUE_PACKAGE_REFUND", sourceId: holding.id },
                }),
                0,
              );
              const result = await refundPayrollValuePackage(holding.id, input);
              assert.equal(
                (result.evidence as { cancelledGrossCents: string }).cancelledGrossCents,
                "32700",
              );
              assert.equal(
                (
                  await prisma.customerOutstanding.findFirstOrThrow({ where: { saleId: sale.id } })
                ).unpaidAmount.toFixed(2),
                "0.00",
              );
            },
          );
          await t.test(
            "zero payout cancels unused credit and remaining debt with no invented base",
            async () => {
              const { sale, holding } = await buy(true);
              const input = {
                ...request(holding.updatedAt, "0"),
                adminFeeNetCents: "50000",
                payoutMethod: "NONE" as const,
              };
              const result = await refundPayrollValuePackage(holding.id, input);
              assert.deepEqual((result.evidence as { lines: unknown[] }).lines, []);
              assert.equal(
                (
                  await prisma.customerOutstanding.findFirstOrThrow({ where: { saleId: sale.id } })
                ).unpaidAmount.toFixed(2),
                "0.00",
              );
              assert.equal(
                (
                  await prisma.customerValuePackageHolding.findFirstOrThrow({
                    where: { id: holding.id },
                  })
                ).amountRemaining.toFixed(2),
                "0.00",
              );
            },
          );
          await t.test("real HTTP auth, role loss, tenant isolation and refund retry", async () => {
            const { holding } = await buy();
            const input = request(holding.updatedAt);
            const app = express();
            app.use(express.json());
            app.use("/sales", salesRouter);
            app.use("/customers", customersRouter);
            app.use(errorHandler);
            const server = app.listen(0, "127.0.0.1");
            await new Promise<void>((resolve) => server.once("listening", resolve));
            const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
            const token = signAccessToken({
              id: actorId,
              email: `${actorId}@example.invalid`,
              globalRole: "SUPER_ADMIN",
              realm: "web",
              tenantId,
              tokenVersion: 0,
            }).token;
            const call = async (path: string, body?: unknown, bearer = token) => {
              const response = await fetch(`${base}${path}`, {
                method: body ? "POST" : "GET",
                headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
                ...(body ? { body: JSON.stringify(body) } : {}),
              });
              return { status: response.status, body: await response.json() };
            };
            try {
              const path = `/sales/value-package-holdings/${holding.id}/refund`;
              assert.equal(
                (await call(`/customers/${buyer.id}/prepaid/${holding.id}/payroll`)).status,
                200,
              );
              assert.equal(
                (await call(`/customers/${recipient.id}/prepaid/${holding.id}/payroll`)).status,
                404,
              );
              await prisma.user.update({ where: { id: actorId }, data: { globalRole: "STAFF" } });
              assert.equal((await call(path, input)).status, 403);
              await prisma.user.update({
                where: { id: actorId },
                data: { globalRole: "SUPER_ADMIN" },
              });
              const wrongTenant = signAccessToken({
                id: actorId,
                email: `${actorId}@example.invalid`,
                globalRole: "SUPER_ADMIN",
                realm: "web",
                tenantId: otherId,
                tokenVersion: 0,
              }).token;
              assert.equal((await call(path, input, wrongTenant)).status, 401);
              const first = await call(path, input);
              assert.equal(first.status, 200);
              const retry = await call(path, input);
              assert.equal(retry.status, 200);
              assert.equal(retry.body.data.id, first.body.data.id);
              assert.equal(
                (await call(path, { ...input, reason: "Different HTTP retry" })).status,
                409,
              );
              const detail = await call(`/customers/${buyer.id}/prepaid/${holding.id}/payroll`);
              assert.equal(detail.body.data.refund.grossCents, "43600");
              assert.equal(detail.body.data.refunded, true);
            } finally {
              server.closeAllConnections();
              await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve())),
              );
            }
          });
          assert.equal(await prisma.employeeCommission.count(), 0);
        },
        actorId,
      );
    } finally {
      await prisma.$disconnect();
    }
  },
);
