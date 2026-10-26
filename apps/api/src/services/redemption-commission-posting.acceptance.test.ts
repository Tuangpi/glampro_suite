import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { createSale, voidSale } from "./sale.service.js";
import { activatePackageValuation } from "./package-valuation.service.js";
import { createPackage } from "./package.service.js";
import {
  correctRedemptionAttribution,
  redemptionCommissionEvidenceSchema,
} from "./redemption-commission-evidence.js";
import { postVerifiedRedemptionCommission } from "./redemption-commission-posting.js";

test(
  "SC-003 internal redemption posting, locked-period corrections, exact void and atomic retries",
  {
    skip: process.env.SC003_FINANCIAL_TEST !== "1",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55464");
    assert.equal(url.pathname, "/commission_redemption_test");
    const tenantId = `sc003-financial-${randomUUID()}`;
    await runAsPlatform(() =>
      prisma.tenant.create({ data: { id: tenantId, name: "Synthetic posting", slug: tenantId } }),
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
          const service = await prisma.service.create({
            data: { tenantId, name: "Service", memberPrice: 10, nonmemberPrice: 10 },
          });
          await activatePackageValuation(
            {
              policyVersion: 1,
              currency: "SGD",
              reason: "Synthetic financial integration",
              confirmed: true,
            },
            manager.id,
          );
          const pkg = await createPackage({
            name: "Three sessions",
            sessionCount: 3,
            memberPrice: 100,
            nonmemberPrice: 100,
            serviceIds: [service.id],
          });
          for (const [id, rate] of [
            [manager.id, "10.00"],
            [staff.id, "20.00"],
          ])
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
                reason: "Original own rate",
              },
            });
          const purchase = await createSale({
            customerId: customer.id,
            lines: [{ itemType: "PACKAGE", itemId: pkg.id, quantity: 1 }],
            payments: [{ method: "CASH", amount: 100 }],
          });
          const holding = await prisma.customerPackageHolding.findFirstOrThrow({
            where: { saleLineId: { in: purchase.lines.map((line) => line.id) } },
          });
          const sale = await createSale({
            customerId: customer.id,
            lines: [{ itemType: "SERVICE", itemId: service.id, quantity: 1 }],
            payments: [
              {
                method: "PACKAGE",
                amount: 10,
                holdingId: holding.id,
                performers: [
                  { staffId: manager.id, share: 2500 },
                  { staffId: staff.id, share: 7500 },
                ],
              },
            ],
          });
          const redemption = await prisma.customerRedemption.findFirstOrThrow({
            where: { saleId: sale.id },
          });
          const original = await prisma.commissionRedemptionSnapshot.findFirstOrThrow({
            where: { redemptionId: redemption.id },
          });
          assert.equal(
            await prisma.employeeCommission.count({ where: { ledgerVersion: 1 } }),
            0,
            "Normal POS is still evidence-only",
          );
          const post = () =>
            prisma.$transaction((tx) =>
              postVerifiedRedemptionCommission(tx, original.id, manager.id),
            );
          await assert.rejects(post(), /No open commission period/);
          const boundary = new Date(Date.now() + 1200);
          const past = await prisma.commissionPeriod.create({
            data: {
              tenantId,
              startsAt: new Date(redemption.usedAt.getTime() - 60000),
              endsAt: boundary,
              timezone: "UTC",
            },
          });
          await assert.rejects(
            runAsTenant(
              tenantId,
              () =>
                prisma.$transaction((tx) =>
                  postVerifiedRedemptionCommission(tx, original.id, staff.id),
                ),
              staff.id,
            ),
            /manager or administrator/,
          );
          await assert.rejects(
            prisma.$transaction(async (tx) => {
              await postVerifiedRedemptionCommission(tx, original.id, manager.id);
              throw new Error("Injected rollback");
            }),
            /Injected rollback/,
          );
          assert.equal(await prisma.employeeCommission.count({ where: { ledgerVersion: 1 } }), 0);
          const [first, retry] = await Promise.all([post(), post()]);
          assert.deepEqual(first.map((row) => row.id).sort(), retry.map((row) => row.id).sort());
          assert.equal(first.length, 2);
          assert.equal(
            first.find((row) => row.userId === manager.id)?.amount.toFixed(10),
            "0.8335000000",
          );
          assert.equal(
            first.find((row) => row.userId === staff.id)?.amount.toFixed(10),
            "5.0010000000",
          );
          await setTimeout(Math.max(0, boundary.getTime() - Date.now() + 50));
          await prisma.commissionPeriod.update({
            where: { id: past.id },
            data: { approvedAt: new Date(), lockedAt: new Date() },
          });
          assert.equal(
            (await post()).length,
            2,
            "Identical retry still works after original period locks",
          );
          const correction = {
            expectedRevision: 0,
            idempotencyKey: randomUUID(),
            performers: [{ staffId: staff.id, share: 10000 }],
            reason: "Correct wrong staff in current open period",
          };
          await assert.rejects(
            correctRedemptionAttribution(sale.id, redemption.id, correction, manager.id),
            /No current open/,
          );
          assert.equal(
            await prisma.commissionRedemptionSnapshot.count({
              where: { redemptionId: redemption.id },
            }),
            1,
          );
          assert.equal(await prisma.employeeCommission.count({ where: { ledgerVersion: 1 } }), 2);
          const nextBoundary = new Date(Date.now() + 3000);
          const current = await prisma.commissionPeriod.create({
            data: { tenantId, startsAt: boundary, endsAt: nextBoundary, timezone: "UTC" },
          });
          // Later rate publication must not change corrected service-time rate.
          await prisma.commissionRule.create({
            data: {
              tenantId,
              staffId: staff.id,
              itemKind: "PACKAGE_REDEMPTION",
              scope: "STAFF",
              scopeKey: randomUUID(),
              rate: "99.00",
              effectiveAt: new Date(),
              actorId: manager.id,
              reason: "Later rate is not service-time rate",
            },
          });
          await prisma.user.update({ where: { id: staff.id }, data: { disabled: true } });
          await assert.rejects(
            correctRedemptionAttribution(sale.id, redemption.id, correction, manager.id),
            /enabled salon staff/,
          );
          await prisma.user.update({ where: { id: staff.id }, data: { disabled: false } });
          const [fixed, fixedRetry] = await Promise.all([
            correctRedemptionAttribution(sale.id, redemption.id, correction, manager.id),
            correctRedemptionAttribution(sale.id, redemption.id, correction, manager.id),
          ]);
          assert.equal(fixed.id, fixedRetry.id);
          const rows = await prisma.employeeCommission.findMany({ where: { ledgerVersion: 1 } });
          assert.equal(rows.length, 5);
          for (const entry of first) {
            const reversal = rows.find((row) => row.reversesId === entry.id)!;
            assert.equal(reversal.periodId, current.id);
            assert.equal(reversal.amount.plus(entry.amount).toString(), "0");
            assert.deepEqual(reversal.snapshot, entry.snapshot);
          }
          const replacement = rows.find(
            (row) => row.entryType === "EARNING" && row.periodId === current.id,
          )!;
          assert.equal(replacement.amount.toFixed(10), "6.6680000000");
          assert.equal(replacement.rate?.toFixed(2), "20.00");
          assert.equal(replacement.userId, staff.id);
          assert.equal(
            redemptionCommissionEvidenceSchema.parse(fixed.evidence).previousSnapshotId,
            original.id,
          );
          assert.deepEqual(
            (replacement.snapshot as { redemptionEvidence: unknown }).redemptionEvidence,
            {
              snapshotId: fixed.id,
              sourceOccurredAt: redemption.usedAt.toISOString(),
              correctsSnapshotId: original.id,
            },
          );
          await assert.rejects(
            correctRedemptionAttribution(
              sale.id,
              redemption.id,
              { ...correction, reason: "Mismatched retry" },
              manager.id,
            ),
            /different evidence/,
          );
          await assert.rejects(post(), /superseded/);
          // Close the current period to prove sale status, session restoration, snapshot and money roll back.
          await prisma.commissionPeriod.update({
            where: { id: current.id },
            data: { approvedAt: new Date(), lockedAt: new Date() },
          });
          await assert.rejects(
            voidSale(sale.id, { reason: "Cannot reverse without current open period" }, manager.id),
            /No current open/,
          );
          assert.equal(
            (await prisma.sale.findFirstOrThrow({ where: { id: sale.id } })).status,
            "COMPLETED",
          );
          assert.equal(
            (await prisma.customerPackageHolding.findFirstOrThrow({ where: { id: holding.id } }))
              .quantityRemaining,
            2,
          );
          assert.equal(
            await prisma.commissionRedemptionSnapshot.count({
              where: { redemptionId: redemption.id },
            }),
            2,
          );
          assert.equal(await prisma.employeeCommission.count({ where: { ledgerVersion: 1 } }), 5);
          await setTimeout(Math.max(0, nextBoundary.getTime() - Date.now() + 50));
          const voidPeriod = await prisma.commissionPeriod.create({
            data: {
              tenantId,
              startsAt: nextBoundary,
              endsAt: new Date(Date.now() + 3600000),
              timezone: "UTC",
            },
          });
          // Departed original staff can still be reversed exactly; they need not be re-enabled.
          await prisma.user.update({ where: { id: staff.id }, data: { disabled: true } });
          await Promise.all([
            voidSale(sale.id, { reason: "Void corrected session" }, manager.id),
            voidSale(sale.id, { reason: "Concurrent void retry" }, manager.id),
          ]);
          const final = await prisma.employeeCommission.findMany({ where: { ledgerVersion: 1 } });
          assert.equal(final.length, 6);
          assert.equal(
            final.find((row) => row.reversesId === replacement.id)?.periodId,
            voidPeriod.id,
          );
          assert.equal(
            final.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0)).toString(),
            "0",
          );
          assert.equal(
            (await prisma.customerPackageHolding.findFirstOrThrow({ where: { id: holding.id } }))
              .quantityRemaining,
            3,
          );
          const unknown = await createSale({
            customerId: customer.id,
            lines: [{ itemType: "SERVICE", itemId: service.id, quantity: 1 }],
            payments: [{ method: "PACKAGE", amount: 10, holdingId: holding.id }],
          });
          const unknownRedemption = await prisma.customerRedemption.findFirstOrThrow({
            where: { saleId: unknown.id },
          });
          const unknownSnapshot = await prisma.commissionRedemptionSnapshot.findFirstOrThrow({
            where: { redemptionId: unknownRedemption.id },
          });
          await assert.rejects(
            prisma.$transaction((tx) =>
              postVerifiedRedemptionCommission(tx, unknownSnapshot.id, manager.id),
            ),
            /unknown attribution/,
          );
          const legacy = await createSale({
            customerId: customer.id,
            lines: [{ itemType: "SERVICE", itemId: service.id, quantity: 1, staffId: manager.id }],
            payments: [
              {
                method: "PACKAGE",
                amount: 10,
                holdingId: holding.id,
                performers: [{ staffId: manager.id, share: 10000 }],
              },
            ],
          });
          const legacyRedemption = await prisma.customerRedemption.findFirstOrThrow({
            where: { saleId: legacy.id },
          });
          const legacySnapshot = await prisma.commissionRedemptionSnapshot.findFirstOrThrow({
            where: { redemptionId: legacyRedemption.id },
          });
          // A legacy zero-valued row is still a source cutover conflict, not permission to double post.
          await prisma.employeeCommission.create({
            data: { tenantId, userId: manager.id, saleId: legacy.id, rate: 0, amount: 0 },
          });
          await assert.rejects(
            prisma.$transaction((tx) =>
              postVerifiedRedemptionCommission(tx, legacySnapshot.id, manager.id),
            ),
            /incompatible commission/,
          );
          assert.equal(await prisma.employeeCommission.count({ where: { ledgerVersion: 1 } }), 6);
          await runAsTenant(`${tenantId}-foreign`, async () => {
            await assert.rejects(
              prisma.$transaction((tx) =>
                postVerifiedRedemptionCommission(tx, original.id, manager.id),
              ),
              /manager or administrator/,
            );
          });
          assert.equal(
            (await prisma.customerRedemption.findFirstOrThrow({ where: { id: redemption.id } }))
              .revertedAt === null,
            false,
          );
          assert.equal(
            await prisma.commissionRedemptionSnapshot.count({
              where: { redemptionId: redemption.id },
            }),
            3,
          );
        },
        manager.id,
      );
    } finally {
      // Immutable financial fixtures are retained only in the explicitly disposable database.
      await prisma.$disconnect();
    }
  },
);
