import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { createSale, voidSale } from "./sale.service.js";
import { recordSaleCollection } from "./sale-collection.service.js";
import { correctRedemptionAttribution } from "./redemption-commission-evidence.js";
import { refundPayrollPackage } from "./payroll-package-refund.js";
import { hashPassword } from "../lib/password.js";
import { getPayrollHoldingDetail } from "./payroll-holding-detail.js";
import { voidPayrollSession } from "./payroll-session-void.js";
import { transferSessionPackage } from "./session-transfer.service.js";

test(
  "CP004 original session economics, payment gates, verified approval, correction, void and refund",
  { skip: process.env.COMMISSION_COLLECTION_ACCEPTANCE !== "1" },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55476");
    assert.equal(url.pathname, "/commission_collection_test");
    const tenantId = `cp004-life-${Date.now()}`,
      actorId = `${tenantId}-owner`,
      performerId = `${tenantId}-performer`;
    try {
      await runAsPlatform(() =>
        prisma.tenant.create({
          data: { id: tenantId, name: "Synthetic lifecycle", slug: tenantId },
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
              passwordHash: "synthetic",
              globalRole: "SUPER_ADMIN",
              twoFactorEnabled: true,
              posPinHash: await hashPassword("654321"),
            },
          });
          await prisma.user.create({
            data: {
              id: performerId,
              tenantId,
              name: "Performer",
              passwordHash: "synthetic",
              globalRole: "STAFF",
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
          const customer = await prisma.customer.create({ data: { tenantId, name: "Buyer" } });
          const service = await prisma.service.create({
            data: {
              tenantId,
              name: "Original session",
              nonmemberPrice: "1000",
              memberPrice: "1000",
            },
          });
          const packageItem = await prisma.package.create({
            data: {
              tenantId,
              name: "Five sessions",
              memberPrice: "5000",
              nonmemberPrice: "5000",
              sessionCount: 5,
              commissionSettings: {
                sale: { mode: "FIXED", amount: "100" },
                redemption: { mode: "FIXED", amount: "20" },
                minimumDepositPct: "40",
              },
            },
          });
          await prisma.packageService.create({
            data: { tenantId, packageId: packageItem.id, serviceId: service.id },
          });
          const input = {
            customerId: customer.id,
            lines: [
              {
                itemType: "PACKAGE" as const,
                itemId: packageItem.id,
                quantity: 1,
                attribution: { sellers: [{ staffId: actorId, share: 10000 }] },
              },
            ],
            payments: [{ method: "CASH" as const, amount: 2000 }],
            collection: {
              currency: "SGD" as const,
              allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "200000" }],
            },
          };
          const salesBefore = await prisma.sale.count();
          await assert.rejects(
            createSale({
              ...input,
              payments: [{ method: "CASH", amount: 1999 }],
              collection: {
                currency: "SGD",
                allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "199900" }],
              },
            }),
            /minimum deposit/,
          );
          assert.equal(await prisma.sale.count(), salesBefore);
          const purchaseSale = await createSale(input);
          let holding = await prisma.customerPackageHolding.findFirstOrThrow({
            where: { saleLine: { saleId: purchaseSale.id } },
          });
          const original = holding.payrollPurchaseSnapshot;
          await prisma.package.update({
            where: { id: packageItem.id },
            data: { memberPrice: "9999", nonmemberPrice: "9999" },
          });
          const redeem = (
            quantity: number,
            approval?: { managerId: string; pin: string; reason: string },
          ) =>
            createSale({
              customerId: customer.id,
              lines: [
                {
                  itemType: "SERVICE",
                  itemId: service.id,
                  quantity,
                  attribution: { performers: [{ staffId: performerId, share: 10000 }] },
                },
              ],
              payments: [
                {
                  method: "PACKAGE",
                  holdingId: holding.id,
                  amount: 1000 * quantity,
                  unpaidSessionOverride: approval,
                },
              ],
            });
          const two = await redeem(2);
          const firstRedemption = await prisma.customerRedemption.findFirstOrThrow({
            where: { saleId: two.id },
          });
          const event = await prisma.payrollSourceEvent.findFirstOrThrow({
            where: { sourceKey: `redemption:${firstRedemption.id}:0` },
          });
          assert.equal(
            (event.evidence as { lines: { baseAmount: string; fixedCommission: string }[] })
              .lines[0]!.baseAmount,
            "2000.0000",
          );
          assert.equal(
            (event.evidence as { lines: { fixedCommission: string }[] }).lines[0]!.fixedCommission,
            "40.0000",
          );
          assert.equal((event.evidence as { status: string }).status, "CAPTURED");
          const detail = await getPayrollHoldingDetail(customer.id, holding.id);
          assert.equal(detail.paidSessionsRemaining, 0);
          assert.equal(detail.balanceDueCents, "300000");
          assert.equal(detail.usedBaseTicks, "20000000");
          await assert.rejects(redeem(1), /Collect the package balance/);
          await assert.rejects(
            redeem(1, { managerId: performerId, pin: "654321", reason: "Not manager" }),
            /manager PIN/,
          );
          await assert.rejects(
            redeem(1, { managerId: actorId, pin: "000000", reason: "Invalid PIN" }),
            /manager PIN/,
          );
          const approval = await redeem(1, {
            managerId: actorId,
            pin: "654321",
            reason: "Approved exception",
          });
          assert.equal(
            await prisma.auditLog.count({
              where: { targetId: holding.id, action: "package.unpaid-session.override" },
            }),
            1,
          );
          assert.equal(
            JSON.stringify(
              await prisma.auditLog.findMany({ where: { targetId: holding.id } }),
            ).includes("654321"),
            false,
          );
          await voidSale(approval.id, { reason: "Return approved unused test session" }, actorId);
          const afterVoid = await prisma.customerPackageHolding.findFirstOrThrow({
            where: { id: holding.id },
          });
          assert.equal(afterVoid.quantityRemaining, 3);
          assert.deepEqual(afterVoid.payrollAvailableOrdinals, [{ first: 3, last: 5 }]);
          await correctRedemptionAttribution(
            two.id,
            firstRedemption.id,
            {
              idempotencyKey: "cp004-correction-0001",
              expectedRevision: 0,
              performers: [{ staffId: actorId, share: 10000 }],
              reason: "Correct performer",
            },
            actorId,
          );
          const collection = {
            idempotencyKey: "df92a200-72e0-4d93-9961-d904d4c60c01",
            currency: "SGD" as const,
            collected: true as const,
            grossCents: "300000",
            reason: "Collect remaining package balance",
            allocations: [{ saleLineId: holding.saleLineId!, grossCents: "300000" }],
          };
          await Promise.all([
            recordSaleCollection(purchaseSale.id, collection),
            recordSaleCollection(purchaseSale.id, collection),
          ]);
          const fixedEvents = await prisma.payrollSourceEvent.findMany({
            where: { saleId: purchaseSale.id, sourceType: "COLLECTION" },
          });
          assert.equal(
            fixedEvents
              .flatMap((row) => (row.evidence as { lines: { fixedCommission: string }[] }).lines)
              .reduce((sum, row) => sum + Number(row.fixedCommission), 0),
            100,
          );
          holding = await prisma.customerPackageHolding.findFirstOrThrow({
            where: { id: holding.id },
          });
          const refundInput = {
            idempotencyKey: "cp004-refund-0001",
            expectedUpdatedAt: holding.updatedAt.toISOString(),
            reason: "Unused sessions refund",
            adminFeeNetCents: "10000",
            payoutGrossCents: "290000",
            payoutMethod: "CASH" as const,
          };
          const refund = await refundPayrollPackage(holding.id, refundInput);
          const retry = await refundPayrollPackage(holding.id, refundInput);
          assert.equal(refund.id, retry.id);
          await assert.rejects(
            refundPayrollPackage(holding.id, { ...refundInput, reason: "Different retry" }),
            /different evidence/,
          );
          assert.equal(
            (refund.evidence as { lines: { baseAmount: string; fixedCommission: string }[] })
              .lines[0]!.baseAmount,
            "-2900.0000",
          );
          assert.equal(
            (refund.evidence as { lines: { fixedCommission: string }[] }).lines[0]!.fixedCommission,
            "-58.0000",
          );
          assert.deepEqual(
            (await prisma.customerPackageHolding.findFirstOrThrow({ where: { id: holding.id } }))
              .payrollPurchaseSnapshot,
            original,
          );
          assert.equal(await prisma.employeeCommission.count(), 0);
          await assert.rejects(
            prisma.payrollSourceEvent.update({
              where: { id: refund.id },
              data: { reason: "Rewrite" },
            }),
          );
          await assert.rejects(prisma.payrollSourceEvent.delete({ where: { id: refund.id } }));
          await assert.rejects(
            voidPayrollSession(two.id, firstRedemption.id, {
              idempotencyKey: "cp004-post-refund-void",
              expectedRevision: 1,
              reason: "Cannot restore refunded holding",
            }),
            /Refunded package/,
          );
          // Transferred holdings keep original seller and purchase economics; ownership races serialize.
          const recipient = await prisma.customer.create({ data: { tenantId, name: "Recipient" } });
          const secondPurchase = await createSale({
            ...input,
            payments: [{ method: "CASH", amount: 9999 }],
            collection: {
              currency: "SGD",
              allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "999900" }],
            },
          });
          const transferred = await prisma.customerPackageHolding.findFirstOrThrow({
            where: { saleLine: { saleId: secondPurchase.id } },
          });
          await transferSessionPackage(
            customer.id,
            transferred.id,
            {
              targetCustomerId: recipient.id,
              expectedUpdatedAt: transferred.updatedAt.toISOString(),
              reason: "Gift remaining sessions",
              confirmed: true,
            },
            actorId,
          );
          const transferredSale = await createSale({
            customerId: recipient.id,
            lines: [
              {
                itemType: "SERVICE",
                itemId: service.id,
                quantity: 1,
                attribution: { performers: [{ staffId: performerId, share: 10000 }] },
              },
            ],
            payments: [{ method: "PACKAGE", holdingId: transferred.id, amount: 1000 }],
          });
          const session = await prisma.customerRedemption.findFirstOrThrow({
            where: { saleId: transferredSale.id },
          });
          const transferredEvidence = await prisma.payrollSourceEvent.findFirstOrThrow({
            where: { sourceKey: `redemption:${session.id}:0` },
          });
          assert.equal(
            (transferredEvidence.evidence as { lines: { baseAmount: string }[] }).lines[0]!
              .baseAmount,
            "1999.8000",
          );
          const voidInput = {
            idempotencyKey: "cp004-standalone-void",
            expectedRevision: 0,
            reason: "Void original transferred session",
          };
          const voided = await voidPayrollSession(transferredSale.id, session.id, voidInput);
          assert.deepEqual(
            await voidPayrollSession(transferredSale.id, session.id, voidInput),
            voided,
          );
          assert.deepEqual(
            (
              await prisma.customerPackageHolding.findFirstOrThrow({
                where: { id: transferred.id },
              })
            ).payrollAvailableOrdinals,
            [{ first: 1, last: 5 }],
          );
          const credit = await prisma.valuePackage.create({
            data: { tenantId, name: "500 for 600", price: "500", credit: "600" },
          });
          const creditSale = await createSale({
            customerId: customer.id,
            lines: [
              {
                itemType: "VALUE_PACKAGE",
                itemId: credit.id,
                quantity: 1,
                attribution: { sellers: [{ staffId: actorId, share: 10000 }] },
              },
            ],
            payments: [{ method: "CASH", amount: 500 }],
            collection: {
              currency: "SGD",
              allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "50000" }],
            },
          });
          const creditHolding = await prisma.customerValuePackageHolding.findFirstOrThrow({
            where: { saleLine: { saleId: creditSale.id } },
          });
          const smallService = await prisma.service.create({
            data: { tenantId, name: "Credit service", memberPrice: "100", nonmemberPrice: "100" },
          });
          const spend = await createSale({
            customerId: customer.id,
            lines: [
              {
                itemType: "SERVICE",
                itemId: smallService.id,
                quantity: 1,
                attribution: { performers: [{ staffId: performerId, share: 10000 }] },
              },
            ],
            payments: [{ method: "PREPAID_CREDIT", holdingId: creditHolding.id, amount: 100 }],
          });
          const spendEvent = await prisma.payrollSourceEvent.findFirstOrThrow({
            where: { saleId: spend.id, sourceType: "VALUE_SPEND" },
          });
          assert.equal(
            (spendEvent.evidence as { lines: { baseAmount: string }[] }).lines[0]!.baseAmount,
            "83.3333",
          );
        },
        actorId,
      );
    } finally {
      await prisma.$disconnect();
    }
  },
);
