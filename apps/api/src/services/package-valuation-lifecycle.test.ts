import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test(
  "valuation lifecycle, failure rollback and conflicting void actions",
  { skip: process.env.PACKAGE_VALUATION_LIFECYCLE_TEST !== "1" },
  async (t) => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55462");
    assert.equal(url.pathname, "/valuation_test");
    const { prisma } = await import("../lib/prisma.js");
    const { runAsTenant, runAsPlatform } = await import("../lib/tenant-context.js");
    const { activatePackageValuation } = await import("./package-valuation.service.js");
    const { createPackage } = await import("./package.service.js");
    const { createSale, voidSale } = await import("./sale.service.js");
    const { transferSessionPackage } = await import("./session-transfer.service.js");
    const { packageValuationReport } = await import("./package-valuation-report.service.js");
    const tenant = await prisma.tenant.create({
      data: { name: "Valuation lifecycle", slug: randomUUID() },
    });
    try {
      const manager = await runAsTenant(tenant.id, () =>
        prisma.user.create({
          data: {
            tenantId: tenant.id,
            name: "Manager",
            passwordHash: "fixture",
            globalRole: "MANAGER",
          },
        }),
      );
      await runAsTenant(
        tenant.id,
        async () => {
          for (const code of ["sales", "catalogue", "packages", "vouchers"]) {
            const module = await prisma.module.upsert({
              where: { code },
              update: {},
              create: {
                code,
                name: code,
                category: "Core",
                isCore: false,
              },
            });
            await prisma.tenantModule.create({
              data: { tenantId: tenant.id, moduleId: module.id },
            });
          }
          await activatePackageValuation(
            { policyVersion: 1, currency: "SGD", reason: "Lifecycle fixture", confirmed: true },
            manager.id,
          );
          const a = await prisma.customer.create({ data: { tenantId: tenant.id, name: "Buyer" } });
          const b = await prisma.customer.create({
            data: { tenantId: tenant.id, name: "Recipient" },
          });
          const serviceA = await prisma.service.create({
            data: {
              tenantId: tenant.id,
              name: "A",
              memberPrice: 10,
              nonmemberPrice: 10,
            },
          });
          const serviceB = await prisma.service.create({
            data: {
              tenantId: tenant.id,
              name: "B",
              memberPrice: 20,
              nonmemberPrice: 20,
            },
          });
          const pkg = await createPackage({
            name: "Whole set",
            sessionCount: 3,
            memberPrice: 100,
            nonmemberPrice: 100,
            redemptionMode: "SERVICE_SET",
            serviceIds: [serviceA.id, serviceB.id],
            serviceSet: [
              { serviceId: serviceA.id, quantity: 2 },
              { serviceId: serviceB.id, quantity: 1 },
            ],
          });
          const purchase = () =>
            createSale({
              customerId: a.id,
              lines: [{ itemType: "PACKAGE", itemId: pkg.id, quantity: 1 }],
              payments: [],
            });
          const holdingFor = (saleId: string) =>
            prisma.customerPackageHolding.findFirstOrThrow({ where: { saleLine: { saleId } } });
          const snapshotFor = (holdingId: string) =>
            prisma.packagePurchaseSnapshot.findUniqueOrThrow({
              where: { tenantId_holdingId: { tenantId: tenant.id, holdingId } },
            });
          const redeem = (customerId: string, holdingId: string) =>
            createSale({
              customerId,
              lines: [
                { itemType: "SERVICE", itemId: serviceA.id, quantity: 2 },
                { itemType: "SERVICE", itemId: serviceB.id, quantity: 1 },
              ],
              payments: [{ method: "PACKAGE", amount: 40, holdingId }],
            });
          const transfer = async (from: string, to: string, holdingId: string) => {
            const holding = await prisma.customerPackageHolding.findUniqueOrThrow({
              where: { id: holdingId },
            });
            return transferSessionPackage(
              from,
              holdingId,
              {
                targetCustomerId: to,
                expectedUpdatedAt: holding.updatedAt.toISOString(),
                confirmed: true,
                reason: "Lifecycle transfer",
              },
              manager.id,
            );
          };

          await t.test(
            "whole-set release and transfer-back preserve cents and original customers",
            async () => {
              const sale = await purchase();
              const holding = await holdingFor(sale.id);
              const snapshot = await snapshotFor(holding.id);
              assert.equal(
                snapshot.grantedSessions,
                3,
                "Each session is a whole set, not three service units.",
              );
              const first = await redeem(a.id, holding.id);
              assert.equal((await packageValuationReport()).active.net, "66.66");
              await transfer(a.id, b.id, holding.id);
              const second = await redeem(b.id, holding.id);
              assert.equal((await packageValuationReport()).active.net, "33.33");
              await transfer(b.id, a.id, holding.id);
              await voidSale(
                second.id,
                { reason: "Restore recipient draw to current owner" },
                manager.id,
              );
              await voidSale(first.id, { reason: "Restore original draw" }, manager.id);
              const report = await packageValuationReport();
              assert.equal(report.active.net, "100.00");
              assert.equal(report.active.sessionsRemaining, 3);
              const movements = await prisma.packageValuationMovement.findMany({
                where: { purchaseId: snapshot.id },
              });
              assert.deepEqual(
                movements.filter((row) => row.kind === "REDEEM").map((row) => row.quantity),
                [-1, -1],
              );
              assert.ok(
                movements
                  .filter((row) => row.kind === "RESTORE")
                  .every((row) => row.customerId === a.id),
              );
              assert.equal(
                movements
                  .filter((row) => row.kind.startsWith("TRANSFER"))
                  .reduce((sum, row) => sum + row.netCents, 0n),
                0n,
              );
              assert.equal(
                (await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).customerId,
                a.id,
              );
              assert.equal(
                (await prisma.sale.findUniqueOrThrow({ where: { id: first.id } })).customerId,
                a.id,
              );
              assert.equal(
                (await prisma.sale.findUniqueOrThrow({ where: { id: second.id } })).customerId,
                b.id,
              );
              await assert.rejects(
                () =>
                  voidSale(sale.id, { reason: "Still forbidden after transfer back" }, manager.id),
                { code: "HOLDING_ALREADY_TRANSFERRED" },
              );

              // Either draw wins and makes the expected transfer stale, or transfer wins
              // and the old customer cannot draw. Never both, never lost value.
              const before = await prisma.customerPackageHolding.findUniqueOrThrow({
                where: { id: holding.id },
              });
              const results = await Promise.allSettled([
                redeem(a.id, holding.id),
                transferSessionPackage(
                  a.id,
                  holding.id,
                  {
                    targetCustomerId: b.id,
                    expectedUpdatedAt: before.updatedAt.toISOString(),
                    confirmed: true,
                    reason: "Competing transfer",
                  },
                  manager.id,
                ),
                packageValuationReport(),
              ]);
              assert.equal(results[2]!.status, "fulfilled");
              assert.equal(
                results.slice(0, 2).filter((result) => result.status === "fulfilled").length,
                1,
              );
              const after = await packageValuationReport();
              if (results[0]!.status === "fulfilled") {
                assert.equal(after.active.net, "66.66");
                await voidSale(
                  results[0]!.value.id,
                  { reason: "Restore winning draw" },
                  manager.id,
                );
              } else {
                assert.equal(after.active.net, "100.00");
                await transfer(b.id, a.id, holding.id);
              }
              assert.equal((await packageValuationReport()).active.net, "100.00");
            },
          );

          await t.test(
            "voucher discounts eligible mixed-sale services, not the package grant",
            async () => {
              const code = `VALUE-${randomUUID()}`.toUpperCase();
              await prisma.voucher.create({
                data: {
                  tenantId: tenant.id,
                  code,
                  discountType: "FIXED",
                  value: 5,
                  startsAt: new Date(Date.now() - 60_000),
                  endsAt: new Date(Date.now() + 60_000),
                },
              });
              await assert.rejects(
                () =>
                  createSale({
                    customerId: a.id,
                    voucherCode: code,
                    lines: [{ itemType: "PACKAGE", itemId: pkg.id, quantity: 1 }],
                    payments: [],
                  }),
                { code: "VOUCHER_NOT_APPLICABLE" },
              );
              const sale = await createSale({
                customerId: a.id,
                voucherCode: code,
                lines: [
                  { itemType: "PACKAGE", itemId: pkg.id, quantity: 1 },
                  { itemType: "SERVICE", itemId: serviceA.id, quantity: 1 },
                ],
                payments: [],
              });
              const snapshot = await snapshotFor((await holdingFor(sale.id)).id);
              const lines = await prisma.saleLine.findMany({ where: { saleId: sale.id } });
              assert.equal(
                lines.find((row) => row.itemType === "PACKAGE")!.voucherDiscountAmount.toFixed(2),
                "0.00",
              );
              assert.equal(
                lines.find((row) => row.itemType === "SERVICE")!.voucherDiscountAmount.toFixed(2),
                "5.00",
              );
              assert.equal(snapshot.netCents, 10000n);
              const report = await packageValuationReport();
              assert.equal(report.active.net, "200.00");
              assert.equal(
                report.unpaidPurchases.sourceSaleOutstanding,
                "205.00",
                "Whole mixed-sale debt is counted once.",
              );
              await voidSale(sale.id, { reason: "Cancel mixed sale" }, manager.id);
              assert.equal((await packageValuationReport()).active.net, "100.00");
            },
          );

          await t.test(
            "post-expiry void restores original cents only into expired bucket",
            async () => {
              // A disposable-only trigger shortens the holding before its immutable
              // purchase snapshot is recorded. Never edit evidence or a live holding.
              await prisma.$executeRawUnsafe(
                `CREATE FUNCTION valuation_lifecycle_short_expiry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW."expiresAt" := (clock_timestamp() AT TIME ZONE 'UTC') + interval '3 seconds'; RETURN NEW; END $$`,
              );
              await prisma.$executeRawUnsafe(
                `CREATE TRIGGER valuation_lifecycle_short_expiry BEFORE INSERT ON customer_package_holdings FOR EACH ROW WHEN (NEW."tenantId" = '${tenant.id}') EXECUTE FUNCTION valuation_lifecycle_short_expiry()`,
              );
              let sale;
              try {
                sale = await purchase();
              } finally {
                await prisma.$executeRawUnsafe(
                  `DROP TRIGGER valuation_lifecycle_short_expiry ON customer_package_holdings`,
                );
                await prisma.$executeRawUnsafe(`DROP FUNCTION valuation_lifecycle_short_expiry()`);
              }
              const holding = await holdingFor(sale.id);
              const snapshot = await snapshotFor(holding.id);
              const draw = await redeem(a.id, holding.id);
              await new Promise((resolve) =>
                setTimeout(resolve, Math.max(0, holding.expiresAt!.getTime() - Date.now()) + 50),
              );
              const expired = await packageValuationReport();
              assert.equal(expired.active.net, "100.00");
              assert.equal(expired.expired.net, "66.66");
              await voidSale(draw.id, { reason: "Restore after expiry" }, manager.id);
              await voidSale(draw.id, { reason: "Retry same void" }, manager.id);
              const restored = await packageValuationReport();
              assert.equal(restored.active.net, "100.00");
              assert.equal(restored.expired.net, "100.00");
              assert.equal(restored.expired.sessionsRemaining, 3);
              const movements = await prisma.packageValuationMovement.findMany({
                where: { purchaseId: snapshot.id },
              });
              const restores = movements.filter((row) => row.kind === "RESTORE");
              assert.equal(restores.length, 1);
              assert.equal(restores[0]!.bucket, "EXPIRED");
              assert.equal(restores[0]!.netCents, 3334n);
              assert.equal(movements.filter((row) => row.kind === "EXPIRE_IN").length, 1);
              await assert.rejects(() => redeem(a.id, holding.id));
              await assert.rejects(() => transfer(a.id, b.id, holding.id), {
                code: "HOLDING_EXPIRED",
              });
              await voidSale(sale.id, { reason: "Cancel restored expired grant" }, manager.id);
              assert.equal((await packageValuationReport()).expired.net, "0.00");
              assert.deepEqual(await snapshotFor(holding.id), snapshot);
            },
          );
          const evidence = async (holdingId: string, saleIds: string[]) => {
            const snapshot = await snapshotFor(holdingId);
            return {
              holding: await prisma.customerPackageHolding.findUnique({ where: { id: holdingId } }),
              snapshot,
              state: await prisma.packageValuationState.findFirstOrThrow({
                where: { purchaseId: snapshot.id },
              }),
              movements: await prisma.packageValuationMovement.findMany({
                where: { purchaseId: snapshot.id },
                orderBy: { id: "asc" },
              }),
              sales: await prisma.sale.findMany({
                where: { id: { in: saleIds } },
                orderBy: { id: "asc" },
              }),
              redemptions: await prisma.customerRedemption.findMany({
                where: { saleId: { in: saleIds } },
                orderBy: { id: "asc" },
              }),
              transfers: await prisma.sessionPackageTransferEvent.findMany({
                where: { holdingId },
                orderBy: { id: "asc" },
              }),
              outstanding: await prisma.customerOutstanding.findMany({
                where: { saleId: { in: saleIds } },
                orderBy: { id: "asc" },
              }),
              points: await prisma.customerPoint.findMany({
                where: { saleId: { in: saleIds } },
                orderBy: { id: "asc" },
              }),
              performance: await prisma.employeePerformance.findMany({
                where: { saleId: { in: saleIds } },
                orderBy: { id: "asc" },
              }),
              commissions: await prisma.employeeCommission.findMany({
                where: { saleId: { in: saleIds } },
                orderBy: { id: "asc" },
              }),
              audit: await prisma.auditLog.findMany({
                where: { tenantId: tenant.id },
                orderBy: { id: "asc" },
              }),
            };
          };
          const withMovementFailure = async (
            kind: "RESTORE" | "TRANSFER_IN" | "PURCHASE_VOID",
            action: () => Promise<unknown>,
          ) => {
            await prisma.$executeRawUnsafe(
              `CREATE FUNCTION valuation_lifecycle_reject_movement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced lifecycle movement failure'; END $$`,
            );
            try {
              await prisma.$executeRawUnsafe(
                `CREATE TRIGGER valuation_lifecycle_reject_movement BEFORE INSERT ON package_valuation_movements FOR EACH ROW WHEN (NEW."tenantId" = '${tenant.id}' AND NEW.kind = '${kind}') EXECUTE FUNCTION valuation_lifecycle_reject_movement()`,
              );
              try {
                await assert.rejects(action, /forced lifecycle movement failure/);
              } finally {
                await prisma.$executeRawUnsafe(
                  `DROP TRIGGER valuation_lifecycle_reject_movement ON package_valuation_movements`,
                );
              }
            } finally {
              await prisma.$executeRawUnsafe(`DROP FUNCTION valuation_lifecycle_reject_movement()`);
            }
          };

          await t.test(
            "failed restoration rolls back sale, holding, redemption and valuation before safe retry",
            async () => {
              const sale = await purchase();
              const holding = await holdingFor(sale.id);
              const draw = await redeem(a.id, holding.id);
              const before = await evidence(holding.id, [sale.id, draw.id]);
              await withMovementFailure("RESTORE", () =>
                voidSale(draw.id, { reason: "Forced restoration failure" }, manager.id),
              );
              assert.deepEqual(await evidence(holding.id, [sale.id, draw.id]), before);
              assert.equal((await packageValuationReport()).active.net, "166.66");
              const [one, two, report] = await Promise.all([
                voidSale(draw.id, { reason: "First concurrent restoration" }, manager.id),
                voidSale(draw.id, { reason: "Second concurrent restoration" }, manager.id),
                packageValuationReport(),
              ]);
              assert.equal(one.status, "VOID");
              assert.equal(two.status, "VOID");
              assert.ok(["166.66", "200.00"].includes(report.active.net));
              const after = await evidence(holding.id, [sale.id, draw.id]);
              const voided = after.sales.find((row) => row.id === draw.id)!;
              assert.ok(
                ["First concurrent restoration", "Second concurrent restoration"].includes(
                  voided.voidReason!,
                ),
              );
              assert.equal(voided.voidedById, manager.id);
              await voidSale(draw.id, { reason: "Do not replace original evidence" }, manager.id);
              assert.deepEqual(await evidence(holding.id, [sale.id, draw.id]), after);
              assert.equal(after.movements.filter((row) => row.kind === "RESTORE").length, 1);
              assert.equal(after.holding!.quantityRemaining, 3);
              assert.ok(after.redemptions.every((row) => row.revertedAt !== null));
              assert.equal((await packageValuationReport()).active.net, "200.00");
              await voidSale(sale.id, { reason: "Clean restored purchase" }, manager.id);
            },
          );

          await t.test(
            "failed transfer-in rolls back paired movement, ownership, history and audit",
            async () => {
              const sale = await purchase();
              const holding = await holdingFor(sale.id);
              const before = await evidence(holding.id, [sale.id]);
              await withMovementFailure("TRANSFER_IN", () => transfer(a.id, b.id, holding.id));
              assert.deepEqual(await evidence(holding.id, [sale.id]), before);
              assert.equal((await packageValuationReport()).active.net, "200.00");
              await transfer(a.id, b.id, holding.id);
              const after = await evidence(holding.id, [sale.id]);
              assert.equal(after.holding!.customerId, b.id);
              assert.equal(after.state.customerId, b.id);
              assert.equal(after.transfers.length, 1);
              assert.equal(
                after.movements.filter((row) => row.kind.startsWith("TRANSFER")).length,
                2,
              );
              assert.equal(
                after.movements.reduce((sum, row) => sum + row.netCents, 0n),
                10000n,
              );
              // Transferred purchases cannot be voided. Consume the three sets so
              // later subtests retain the existing fixture's SGD 100 baseline.
              await redeem(b.id, holding.id);
              await redeem(b.id, holding.id);
              await redeem(b.id, holding.id);
              assert.equal((await packageValuationReport()).active.net, "100.00");
            },
          );

          await t.test(
            "failed purchase void retains holding, debt, status and immutable evidence",
            async () => {
              const sale = await purchase();
              const holding = await holdingFor(sale.id);
              const before = await evidence(holding.id, [sale.id]);
              await withMovementFailure("PURCHASE_VOID", () =>
                voidSale(sale.id, { reason: "Forced purchase void failure" }, manager.id),
              );
              assert.deepEqual(await evidence(holding.id, [sale.id]), before);
              assert.equal((await packageValuationReport()).active.net, "200.00");
              await voidSale(sale.id, { reason: "Retry purchase void" }, manager.id);
              const after = await evidence(holding.id, [sale.id]);
              assert.equal(after.holding, null);
              assert.equal(after.state.voided, true);
              assert.equal(after.outstanding.length, 0);
              assert.equal(after.sales[0]!.status, "VOID");
              assert.equal(after.movements.filter((row) => row.kind === "PURCHASE_VOID").length, 1);
              assert.deepEqual(after.snapshot, before.snapshot);
              assert.equal((await packageValuationReport()).active.net, "100.00");
            },
          );

          await t.test(
            "purchase void competing with draw or transfer leaves one coherent winner",
            async () => {
              for (const action of ["draw", "transfer"] as const) {
                const sale = await purchase();
                const holding = await holdingFor(sale.id);
                const results = await Promise.allSettled([
                  voidSale(sale.id, { reason: `Purchase void versus ${action}` }, manager.id),
                  action === "draw" ? redeem(a.id, holding.id) : transfer(a.id, b.id, holding.id),
                  packageValuationReport(),
                ]);
                assert.equal(results[2]!.status, "fulfilled");
                assert.equal(
                  results.slice(0, 2).filter((result) => result.status === "fulfilled").length,
                  1,
                );
                const after = await evidence(holding.id, [sale.id]);
                const report = await packageValuationReport();
                if (results[0]!.status === "fulfilled") {
                  assert.equal(after.holding, null);
                  assert.equal(after.state.voided, true);
                  assert.equal(after.sales[0]!.status, "VOID");
                  assert.equal(after.transfers.length, 0);
                  assert.equal(report.active.net, "100.00");
                } else {
                  assert.equal(after.sales[0]!.status, "COMPLETED");
                  assert.equal(after.state.voided, false);
                  if (action === "draw") {
                    assert.equal(after.holding!.quantityRemaining, 2);
                    assert.equal(report.active.net, "166.66");
                    const draw = await prisma.customerRedemption.findFirstOrThrow({
                      where: { holdingId: holding.id, revertedAt: null },
                    });
                    await voidSale(draw.saleId!, { reason: "Restore winning draw" }, manager.id);
                    await voidSale(sale.id, { reason: "Cancel restored purchase" }, manager.id);
                  } else {
                    assert.equal(after.holding!.customerId, b.id);
                    assert.equal(after.transfers.length, 1);
                    assert.equal(report.active.net, "200.00");
                    await redeem(b.id, holding.id);
                    await redeem(b.id, holding.id);
                    await redeem(b.id, holding.id);
                  }
                }
                assert.equal((await packageValuationReport()).active.net, "100.00");
              }
            },
          );
        },
        manager.id,
      );
    } finally {
      await runAsPlatform(() => prisma.tenant.delete({ where: { id: tenant.id } }));
      await prisma.$disconnect();
    }
  },
);
