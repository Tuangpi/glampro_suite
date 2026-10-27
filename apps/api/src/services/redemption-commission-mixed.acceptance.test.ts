import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { CustomerPackageHolding } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { createSale, voidSale } from "./sale.service.js";
import { activatePackageValuation } from "./package-valuation.service.js";
import { createPackage } from "./package.service.js";
import {
  changePrepaidMembership,
  createPrepaidFamily,
  sharePrepaid,
} from "./prepaid-family.service.js";
import { redemptionCommissionEvidenceSchema } from "./redemption-commission-evidence.js";

test(
  "SC-003 mixed package, family bonus credit and cash retain separate evidence without earnings",
  { skip: process.env.SC003_MIXED_TEST !== "1" },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55464");
    assert.equal(url.pathname, "/commission_redemption_test");
    const tenantId = `sc003mixed-${randomUUID()}`;
    await runAsPlatform(() =>
      prisma.tenant.create({
        data: { id: tenantId, name: "Synthetic mixed funding", slug: tenantId },
      }),
    );
    try {
      const manager = await runAsTenant(tenantId, () =>
        prisma.user.create({
          data: {
            tenantId,
            name: "Cashier manager",
            passwordHash: "fixture",
            globalRole: "MANAGER",
          },
        }),
      );
      await runAsTenant(
        tenantId,
        async () => {
          for (const code of ["sales", "packages", "catalogue"]) {
            const module = await prisma.module.upsert({
              where: { code },
              update: {},
              create: { code, name: code, category: "Core", isCore: false },
            });
            await prisma.tenantModule.create({ data: { tenantId, moduleId: module.id } });
          }
          const staff = await prisma.user.create({
            data: { tenantId, name: "Therapist", passwordHash: "fixture", globalRole: "STAFF" },
          });
          const owner = await prisma.customer.create({ data: { tenantId, name: "Credit owner" } });
          const recipient = await prisma.customer.create({
            data: { tenantId, name: "Session owner" },
          });
          const service = await prisma.service.create({
            data: { tenantId, name: "Current service", memberPrice: 70, nonmemberPrice: 70 },
          });
          await activatePackageValuation(
            {
              policyVersion: 1,
              currency: "SGD",
              reason: "Synthetic mixed acceptance",
              confirmed: true,
            },
            manager.id,
          );
          for (const [staffId, rate] of [
            [manager.id, "10.00"],
            [staff.id, "20.00"],
          ]) {
            await prisma.commissionRule.create({
              data: {
                tenantId,
                staffId: staffId!,
                itemKind: "PACKAGE_REDEMPTION",
                scope: "STAFF",
                scopeKey: randomUUID(),
                rate: rate!,
                effectiveAt: new Date(0),
                actorId: manager.id,
                reason: "Synthetic own rate",
              },
            });
          }
          const sessions: CustomerPackageHolding[] = [];
          for (const price of [100, 50]) {
            const pkg = await createPackage({
              name: `Original ${price}`,
              sessionCount: 1,
              memberPrice: price,
              nonmemberPrice: price,
              serviceIds: [service.id],
            });
            const purchase = await createSale({
              customerId: recipient.id,
              lines: [{ itemType: "PACKAGE", itemId: pkg.id, quantity: 1 }],
              payments: [{ method: "CASH", amount: price }],
            });
            sessions.push(
              await prisma.customerPackageHolding.findFirstOrThrow({
                where: { saleLineId: { in: purchase.lines.map((line) => line.id) } },
              }),
            );
          }
          const credit = await prisma.valuePackage.create({
            data: { tenantId, name: "Paid 20 grants 30", price: 20, credit: 30 },
          });
          const credits = [];
          for (let i = 0; i < 2; i++) {
            const purchase = await createSale({
              customerId: owner.id,
              lines: [{ itemType: "VALUE_PACKAGE", itemId: credit.id, quantity: 1 }],
              payments: [{ method: "CASH", amount: 20 }],
            });
            credits.push(
              await prisma.customerValuePackageHolding.findFirstOrThrow({
                where: { saleLineId: { in: purchase.lines.map((line) => line.id) } },
              }),
            );
          }
          const family = (await createPrepaidFamily(
            owner.id,
            {
              name: "Explicit family",
              reason: "Owner request",
              confirmed: true,
            },
            manager.id,
          ))!;
          await changePrepaidMembership(
            recipient.id,
            {
              familyId: family.id,
              expectedFamilyId: null,
              reason: "Join family",
              confirmed: true,
            },
            manager.id,
          );
          const split = [
            { staffId: manager.id, share: 2500 },
            { staffId: staff.id, share: 7500 },
          ];
          const input = {
            customerId: recipient.id,
            lines: [
              {
                itemType: "SERVICE" as const,
                itemId: service.id,
                quantity: 3,
                attribution: { sellers: [{ staffId: staff.id, share: 10000 }], performers: split },
              },
            ],
            payments: [
              {
                method: "PACKAGE" as const,
                amount: 70,
                holdingId: sessions[0]!.id,
                performers: [{ staffId: staff.id, share: 10000 }],
              },
              { method: "PACKAGE" as const, amount: 70, holdingId: sessions[1]!.id },
              { method: "PREPAID_CREDIT" as const, amount: 50, holdingId: `family:${family.id}` },
              { method: "CASH" as const, amount: 20 },
            ],
          };
          const state = async () => ({
            sales: await prisma.sale.findMany({ orderBy: { id: "asc" } }),
            sessions: await prisma.customerPackageHolding.findMany({ orderBy: { id: "asc" } }),
            credits: await prisma.customerValuePackageHolding.findMany({ orderBy: { id: "asc" } }),
            redemptions: await prisma.customerRedemption.findMany(),
            snapshots: await prisma.commissionRedemptionSnapshot.findMany(),
            ledger: await prisma.employeeCommission.findMany(),
            movements: await prisma.packageValuationMovement.findMany(),
          });
          const before = await state();
          // Membership alone never authorizes private credit. Earlier package draws must roll back.
          await assert.rejects(createSale(input), { code: "HOLDING_INSUFFICIENT" });
          assert.deepEqual(await state(), before);
          for (const holding of credits) {
            await sharePrepaid(
              owner.id,
              holding.id,
              {
                familyId: family.id,
                expectedUpdatedAt: holding.updatedAt.toISOString(),
                reason: "Share this holding explicitly",
                confirmed: true,
              },
              manager.id,
            );
          }
          const sale = await createSale(input);
          assert.equal(sale.status, "COMPLETED");
          const line = await prisma.saleLine.findFirstOrThrow({ where: { saleId: sale.id } });
          assert.deepEqual(line.attribution, input.lines[0]!.attribution);
          const redemptions = await prisma.customerRedemption.findMany({
            where: { saleId: sale.id },
          });
          assert.equal(redemptions.length, 4);
          assert.ok(redemptions.every((row) => row.customerId === recipient.id));
          for (let i = 0; i < sessions.length; i++) {
            const redemption = redemptions.find((row) => row.holdingId === sessions[i]!.id)!;
            assert.equal(redemption.quantity, 1);
            const snapshot = await prisma.commissionRedemptionSnapshot.findFirstOrThrow({
              where: { redemptionId: redemption.id },
            });
            assert.equal(snapshot.actorId, manager.id);
            const evidence = redemptionCommissionEvidenceSchema.parse(snapshot.evidence);
            assert.equal(evidence.postingStatus, "PENDING_RELEASE");
            assert.equal(evidence.valuation?.netCents, i === 0 ? "10000" : "5000");
            assert.deepEqual(evidence.valuation?.ordinals, [{ first: 1, last: 1 }]);
            assert.deepEqual(evidence.coverage, [
              {
                saleLineId: line.id,
                serviceId: service.id,
                quantity: 1,
                performers: split,
              },
            ]);
            assert.equal(
              evidence.attributionStatus,
              i === 0 ? "EXPLICIT_TENDER" : "CONSISTENT_LINES",
            );
            assert.equal(
              evidence.rates.find((row) => row.staffId === staff.id)?.amount,
              i === 0 ? "20.0000000000" : "7.5000000000",
            );
            if (i === 1)
              assert.equal(
                evidence.rates.find((row) => row.staffId === manager.id)?.amount,
                "1.2500000000",
              );
          }
          const creditDraws = redemptions.filter((row) => row.itemType === "VALUE_PACKAGE");
          assert.deepEqual(creditDraws.map((row) => row.amount!.toFixed(2)).sort(), [
            "20.00",
            "30.00",
          ]);
          for (const holding of sessions) {
            assert.equal(
              (await prisma.customerPackageHolding.findFirstOrThrow({ where: { id: holding.id } }))
                .quantityRemaining,
              0,
            );
          }
          const remainingCredit = await prisma.customerValuePackageHolding.findMany();
          assert.deepEqual(remainingCredit.map((row) => row.amountRemaining.toFixed(2)).sort(), [
            "0.00",
            "10.00",
          ]);
          assert.equal(
            await prisma.commissionRedemptionSnapshot.count(),
            2,
            "Credit spending must not fabricate package-session evidence",
          );
          assert.equal(
            await prisma.employeeCommission.count(),
            0,
            "New attribution must not activate either legacy or version-1 earnings",
          );
          // Leaving withdraws sharing. Voids must still restore the original owners, not the spender.
          await changePrepaidMembership(
            owner.id,
            {
              familyId: null,
              expectedFamilyId: family.id,
              reason: "Leave after spending",
              confirmed: true,
            },
            manager.id,
          );
          await voidSale(sale.id, { reason: "Void mixed tender" }, manager.id);
          await voidSale(sale.id, { reason: "Retry mixed void" }, manager.id);
          assert.equal(
            (await prisma.sale.findFirstOrThrow({ where: { id: sale.id } })).status,
            "VOID",
          );
          for (const holding of sessions) {
            const restored = await prisma.customerPackageHolding.findFirstOrThrow({
              where: { id: holding.id },
            });
            assert.equal(restored.quantityRemaining, 1);
            assert.equal(restored.customerId, recipient.id);
          }
          for (const holding of credits) {
            const restored = await prisma.customerValuePackageHolding.findFirstOrThrow({
              where: { id: holding.id },
            });
            assert.equal(restored.amountRemaining.toFixed(2), "30.00");
            assert.equal(restored.customerId, owner.id);
            assert.equal(restored.sharedFamilyId, null);
          }
          const reverted = await prisma.customerRedemption.findMany({ where: { saleId: sale.id } });
          assert.ok(reverted.every((row) => row.revertedAt !== null));
          assert.equal(
            await prisma.commissionRedemptionSnapshot.count({ where: { eventType: "VOID" } }),
            2,
          );
          assert.equal(await prisma.commissionRedemptionSnapshot.count(), 4);
          assert.equal(await prisma.employeeCommission.count(), 0);
        },
        manager.id,
      );
    } finally {
      await runAsPlatform(() => prisma.tenant.delete({ where: { id: tenantId } }));
      await prisma.$disconnect();
    }
  },
);
