import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { createSale, completeSale, voidSale } from "./sale.service.js";
import { activatePackageValuation } from "./package-valuation.service.js";
import { createPackage } from "./package.service.js";
import { transferSessionPackage } from "./session-transfer.service.js";
import {
  correctRedemptionAttribution,
  redemptionCommissionEvidenceSchema,
} from "./redemption-commission-evidence.js";
import { publishCommissionAttributionPolicy } from "./commission-attribution-policy.js";

test(
  "SC-003 immutable whole-set attribution, transfer, correction retries, policy rollback and void",
  {
    skip: process.env.SC003_REDEMPTION_TEST !== "1",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55464");
    assert.equal(url.pathname, "/commission_redemption_test");
    const tenantId = `sc003r-${randomUUID()}`;
    await runAsPlatform(() =>
      prisma.tenant.create({
        data: { id: tenantId, name: "Synthetic redemption", slug: tenantId },
      }),
    );
    try {
      const manager = await runAsTenant(tenantId, () =>
        prisma.user.create({
          data: { tenantId, name: "Manager", passwordHash: "fixture", globalRole: "MANAGER" },
        }),
      );
      await runAsTenant(
        tenantId,
        async () => {
          for (const code of ["sales", "packages", "catalogue", "vouchers"]) {
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
          const customer = await prisma.customer.create({ data: { tenantId, name: "Buyer" } });
          const recipient = await prisma.customer.create({ data: { tenantId, name: "Recipient" } });
          const a = await prisma.service.create({
            data: { tenantId, name: "A", memberPrice: 10, nonmemberPrice: 10 },
          });
          const b = await prisma.service.create({
            data: { tenantId, name: "B", memberPrice: 20, nonmemberPrice: 20 },
          });
          await activatePackageValuation(
            { policyVersion: 1, currency: "SGD", reason: "Synthetic acceptance", confirmed: true },
            manager.id,
          );
          const pkg = await createPackage({
            name: "Whole set",
            sessionCount: 3,
            memberPrice: 100,
            nonmemberPrice: 100,
            redemptionMode: "SERVICE_SET",
            serviceIds: [a.id, b.id],
            serviceSet: [
              { serviceId: a.id, quantity: 2 },
              { serviceId: b.id, quantity: 1 },
            ],
          });
          for (const [id, rate] of [
            [manager.id, "10.00"],
            [staff.id, "20.00"],
          ]) {
            await prisma.commissionRule.create({
              data: {
                tenantId,
                staffId: id!,
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
          const purchase = await createSale({
            customerId: customer.id,
            lines: [{ itemType: "PACKAGE", itemId: pkg.id, quantity: 1 }],
            payments: [{ method: "CASH", amount: 100 }],
          });
          const holding = await prisma.customerPackageHolding.findFirstOrThrow({
            where: { saleLineId: { in: purchase.lines.map((line) => line.id) } },
          });
          const split = [
            { staffId: manager.id, share: 2500 },
            { staffId: staff.id, share: 7500 },
          ];
          const sale = await createSale({
            customerId: customer.id,
            lines: [
              { itemType: "SERVICE", itemId: a.id, quantity: 2 },
              { itemType: "SERVICE", itemId: b.id, quantity: 1 },
            ],
            payments: [{ method: "PACKAGE", amount: 40, holdingId: holding.id, performers: split }],
          });
          const redemption = await prisma.customerRedemption.findFirstOrThrow({
            where: { saleId: sale.id },
          });
          const snapshot = await prisma.commissionRedemptionSnapshot.findFirstOrThrow({
            where: { redemptionId: redemption.id },
          });
          const evidence = redemptionCommissionEvidenceSchema.parse(snapshot.evidence);
          assert.equal(evidence.valuation?.netCents, "3334");
          assert.deepEqual(evidence.valuation?.ordinals, [{ first: 1, last: 1 }]);
          assert.deepEqual(
            evidence.coverage.map((line) => line.quantity),
            [2, 1],
          );
          assert.equal(
            evidence.rates.find((row) => row.staffId === manager.id)?.amount,
            "0.8335000000",
          );
          assert.equal(
            evidence.rates.find((row) => row.staffId === staff.id)?.amount,
            "5.0010000000",
          );
          assert.equal(await prisma.employeeCommission.count({ where: { ledgerVersion: 1 } }), 0);
          await assert.rejects(
            prisma.commissionRedemptionSnapshot.update({
              where: { id: snapshot.id },
              data: { reason: "Rewrite" },
            }),
            /append-only/,
          );
          await assert.rejects(
            prisma.commissionRedemptionSnapshot.delete({ where: { id: snapshot.id } }),
            /append-only/,
          );
          const correction = {
            expectedRevision: 0,
            idempotencyKey: randomUUID(),
            performers: [{ staffId: staff.id, share: 10000 }],
            reason: "Wrong staff corrected",
          };
          await assert.rejects(
            runAsTenant(
              tenantId,
              () => correctRedemptionAttribution(sale.id, redemption.id, correction, staff.id),
              staff.id,
            ),
            /Only salon/,
          );
          const corrected = await Promise.all([
            correctRedemptionAttribution(sale.id, redemption.id, correction, manager.id),
            correctRedemptionAttribution(sale.id, redemption.id, correction, manager.id),
          ]);
          assert.equal(corrected[0]!.id, corrected[1]!.id);
          assert.equal(
            redemptionCommissionEvidenceSchema.parse(corrected[0]!.evidence).previousSnapshotId,
            snapshot.id,
          );
          await assert.rejects(
            correctRedemptionAttribution(
              sale.id,
              redemption.id,
              { ...correction, reason: "Changed evidence" },
              manager.id,
            ),
            /different evidence/,
          );
          await assert.rejects(
            correctRedemptionAttribution(
              sale.id,
              redemption.id,
              { ...correction, idempotencyKey: randomUUID() },
              manager.id,
            ),
            /changed/,
          );
          const policy = await publishCommissionAttributionPolicy(
            {
              expectedRevision: null,
              requireSellers: false,
              requireServicePerformers: false,
              requireRedemptionPerformers: true,
              reason: "Require explicit session performers",
            },
            manager.id,
          );
          const { revision: _policyRevision, ...policyValues } = policy;
          await assert.rejects(
            publishCommissionAttributionPolicy(
              { ...policyValues, expectedRevision: null, reason: "Stale" },
              manager.id,
            ),
            /changed/,
          );
          const balance = (
            await prisma.customerPackageHolding.findFirstOrThrow({ where: { id: holding.id } })
          ).quantityRemaining;
          await assert.rejects(
            createSale({
              customerId: customer.id,
              lines: [
                { itemType: "SERVICE", itemId: a.id, quantity: 2 },
                { itemType: "SERVICE", itemId: b.id, quantity: 1 },
              ],
              payments: [{ method: "PACKAGE", amount: 40, holdingId: holding.id }],
            }),
            /attribution is required/,
          );
          assert.equal(
            (await prisma.customerPackageHolding.findFirstOrThrow({ where: { id: holding.id } }))
              .quantityRemaining,
            balance,
          );
          const transferable = await prisma.customerPackageHolding.findFirstOrThrow({
            where: { id: holding.id },
          });
          await transferSessionPackage(
            customer.id,
            holding.id,
            {
              targetCustomerId: recipient.id,
              expectedUpdatedAt: transferable.updatedAt.toISOString(),
              confirmed: true,
              reason: "Transfer remaining sessions",
            },
            manager.id,
          );
          const second = await createSale({
            customerId: recipient.id,
            lines: [
              { itemType: "SERVICE", itemId: a.id, quantity: 2 },
              { itemType: "SERVICE", itemId: b.id, quantity: 1 },
            ],
            payments: [{ method: "PACKAGE", amount: 40, holdingId: holding.id, performers: split }],
          });
          const nextRedemption = await prisma.customerRedemption.findFirstOrThrow({
            where: { saleId: second.id },
          });
          const nextSnapshot = await prisma.commissionRedemptionSnapshot.findFirstOrThrow({
            where: { redemptionId: nextRedemption.id },
          });
          assert.equal(
            redemptionCommissionEvidenceSchema.parse(nextSnapshot.evidence).valuation?.purchaseId,
            evidence.valuation?.purchaseId,
          );
          assert.equal(
            redemptionCommissionEvidenceSchema.parse(nextSnapshot.evidence).valuation?.netCents,
            "3333",
          );
          await voidSale(sale.id, { reason: "Void original session after transfer" }, manager.id);
          const voided = await prisma.commissionRedemptionSnapshot.findFirstOrThrow({
            where: { redemptionId: redemption.id },
            orderBy: { revision: "desc" },
          });
          assert.equal(voided.eventType, "VOID");
          assert.equal(voided.revision, 2);
          assert.equal(
            redemptionCommissionEvidenceSchema.parse(voided.evidence).previousSnapshotId,
            corrected[0]!.id,
          );
          await voidSale(sale.id, { reason: "Retry void" }, manager.id);
          assert.equal(
            await prisma.commissionRedemptionSnapshot.count({
              where: { redemptionId: redemption.id },
            }),
            3,
          );
          assert.equal(await prisma.employeeCommission.count({ where: { ledgerVersion: 1 } }), 0);
          const strictPolicy = await publishCommissionAttributionPolicy(
            {
              expectedRevision: policy.revision,
              requireSellers: true,
              requireServicePerformers: true,
              requireRedemptionPerformers: true,
              reason: "Require completed sale attribution",
            },
            manager.id,
          );
          await assert.rejects(
            runAsTenant(
              tenantId,
              () =>
                publishCommissionAttributionPolicy(
                  {
                    expectedRevision: strictPolicy.revision,
                    requireSellers: false,
                    requireServicePerformers: false,
                    requireRedemptionPerformers: false,
                    reason: "Unauthorized policy change",
                  },
                  staff.id,
                ),
              staff.id,
            ),
            /Only salon/,
          );
          const held = await createSale({
            hold: true,
            lines: [{ itemType: "SERVICE", itemId: a.id, quantity: 1 }],
            payments: [],
          });
          await assert.rejects(
            completeSale(held.id, {
              lines: [{ itemType: "SERVICE", itemId: a.id, quantity: 1 }],
              payments: [{ method: "CASH", amount: 10 }],
            }),
            /seller attribution is required/,
          );
          assert.equal(
            (await prisma.sale.findFirstOrThrow({ where: { id: held.id } })).status,
            "HELD",
          );
          await assert.rejects(
            completeSale(held.id, {
              lines: [
                { itemType: "SERVICE", itemId: a.id, quantity: 1, attribution: { sellers: split } },
              ],
              payments: [{ method: "CASH", amount: 10 }],
            }),
            /service attribution is required/,
          );
          await completeSale(held.id, {
            lines: [
              {
                itemType: "SERVICE",
                itemId: a.id,
                quantity: 1,
                attribution: { sellers: split, performers: split },
              },
            ],
            payments: [{ method: "CASH", amount: 10 }],
          });
          assert.equal(
            (await prisma.sale.findFirstOrThrow({ where: { id: held.id } })).status,
            "COMPLETED",
          );
          await assert.rejects(
            prisma.commissionAttributionPolicy.update({
              where: { id: strictPolicy.revision! },
              data: { reason: "Rewrite" },
            }),
            /append-only/,
          );
        },
        manager.id,
      );
    } finally {
      await runAsPlatform(() => prisma.tenant.delete({ where: { id: tenantId } }));
      await prisma.$disconnect();
    }
  },
);
