import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test(
  "valuation POS grant, exact redemption/void, transfer, expiry and immutable reconciliation",
  { skip: process.env.PACKAGE_VALUATION_LEDGER_TEST !== "1" },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55462");
    assert.equal(url.pathname, "/valuation_test");
    const { prisma } = await import("../lib/prisma.js");
    const { runAsTenant, runAsPlatform } = await import("../lib/tenant-context.js");
    const { lockPrepaid } = await import("../lib/prepaid-lock.js");
    const { activatePackageValuation } = await import("./package-valuation.service.js");
    const { createSale, completeSale, voidSale } = await import("./sale.service.js");
    const { transferSessionPackage } = await import("./session-transfer.service.js");
    const { expirePackageValuations } = await import("./package-valuation-ledger.js");
    const { packageValuationReport } = await import("./package-valuation-report.service.js");
    const { runAtOutlet } = await import("../lib/tenant-context.js");
    const tenant = await prisma.tenant.create({
      data: { name: "Valuation POS fixture", slug: randomUUID() },
    });
    try {
      const manager = await runAsTenant(tenant.id, () =>
        prisma.user.create({
          data: {
            tenantId: tenant.id,
            name: "Manager",
            email: `${randomUUID()}@valuation.test`,
            passwordHash: "fixture",
            globalRole: "MANAGER",
          },
        }),
      );
      await runAsTenant(tenant.id, async () => {
        for (const code of ["sales", "catalogue", "packages"]) {
          const module = await prisma.module.upsert({
            where: { code },
            update: {},
            create: { code, name: code, category: "Core", isCore: code !== "packages" },
          });
          await prisma.tenantModule.create({ data: { tenantId: tenant.id, moduleId: module.id } });
        }
      });
      await runAsTenant(
        tenant.id,
        async () => {
          const a = await prisma.customer.create({
            data: { tenantId: tenant.id, name: "Original" },
          });
          const b = await prisma.customer.create({
            data: { tenantId: tenant.id, name: "Recipient" },
          });
          const service = await prisma.service.create({
            data: { tenantId: tenant.id, name: "Session", memberPrice: 10, nonmemberPrice: 10 },
          });
          const pkg = await prisma.package.create({
            data: {
              tenantId: tenant.id,
              name: "Three sessions",
              sessionCount: 3,
              memberPrice: 100,
              nonmemberPrice: 100,
              services: { create: { tenantId: tenant.id, serviceId: service.id } },
            },
          });
          const purchaseInput = {
            customerId: a.id,
            lines: [{ itemType: "PACKAGE" as const, itemId: pkg.id, quantity: 1 }],
            payments: [],
          };
          const legacy = await createSale(purchaseInput);
          assert.equal(await prisma.packagePurchaseSnapshot.count(), 0);
          const inactiveReport = await packageValuationReport();
          assert.equal(inactiveReport.activation, null);
          assert.equal(inactiveReport.active.net, "0.00");
          assert.deepEqual(inactiveReport.unvalued.active, { holdings: 1, sessionsRemaining: 3 });
          await activatePackageValuation(
            { policyVersion: 1, currency: "SGD", reason: "Confirmed SGD", confirmed: true },
            manager.id,
          );
          // A ledger failure must roll back sale, grant, snapshot and receipt sequence.
          const failedKey = randomUUID();
          const beforeFailure = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
          await prisma.$executeRawUnsafe(
            `CREATE FUNCTION valuation_test_reject_movement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced valuation movement failure'; END $$`,
          );
          await prisma.$executeRawUnsafe(
            `CREATE TRIGGER valuation_test_reject_movement BEFORE INSERT ON package_valuation_movements FOR EACH ROW EXECUTE FUNCTION valuation_test_reject_movement()`,
          );
          try {
            await assert.rejects(
              () => createSale({ ...purchaseInput, idempotencyKey: failedKey }),
              /forced valuation movement failure/,
            );
            assert.equal(await prisma.sale.count({ where: { idempotencyKey: failedKey } }), 0);
            assert.equal(await prisma.packagePurchaseSnapshot.count(), 0);
            assert.equal(
              (await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).receiptCounter,
              beforeFailure.receiptCounter,
            );
          } finally {
            await prisma.$executeRawUnsafe(
              `DROP TRIGGER valuation_test_reject_movement ON package_valuation_movements`,
            );
            await prisma.$executeRawUnsafe(`DROP FUNCTION valuation_test_reject_movement()`);
          }
          const key = randomUUID();
          const purchase = await createSale({ ...purchaseInput, idempotencyKey: key });
          assert.equal(
            (await createSale({ ...purchaseInput, idempotencyKey: key })).id,
            purchase.id,
          );
          const holding = await prisma.customerPackageHolding.findFirstOrThrow({
            where: { saleLine: { saleId: purchase.id } },
          });
          const snapshot = await prisma.packagePurchaseSnapshot.findUniqueOrThrow({
            where: { tenantId_holdingId: { tenantId: tenant.id, holdingId: holding.id } },
          });
          assert.equal(snapshot.netCents, 10000n, "Unpaid purchase retains full consideration.");
          const initialReport = await packageValuationReport();
          assert.equal(initialReport.active.net, "100.00");
          assert.equal(initialReport.unpaidPurchases.sourceSaleOutstanding, "100.00");
          assert.equal(
            await prisma.packagePurchaseSnapshot.count(),
            1,
            "No retry duplication or legacy backfill.",
          );
          const redeem = (customerId: string) =>
            createSale({
              customerId,
              lines: [{ itemType: "SERVICE", itemId: service.id, quantity: 1 }],
              payments: [{ method: "PACKAGE", amount: 10, holdingId: holding.id }],
            });
          const first = await redeem(a.id);
          const second = await redeem(a.id);
          const current = await prisma.customerPackageHolding.findUniqueOrThrow({
            where: { id: holding.id },
          });
          await transferSessionPackage(
            a.id,
            holding.id,
            {
              targetCustomerId: b.id,
              expectedUpdatedAt: current.updatedAt.toISOString(),
              confirmed: true,
              reason: "Transfer remaining",
            },
            manager.id,
          );
          await voidSale(first.id, { reason: "Restore exact first ordinal" }, manager.id);
          const state = await prisma.packageValuationState.findUniqueOrThrow({
            where: { tenantId_purchaseId: { tenantId: tenant.id, purchaseId: snapshot.id } },
          });
          assert.equal(state.customerId, b.id);
          const transferredReport = await runAtOutlet("unrelated-outlet", packageValuationReport);
          assert.equal(transferredReport.scope, "COMPANY");
          assert.equal(transferredReport.active.net, "66.67");
          assert.equal(transferredReport.active.sessionsRemaining, 2);
          assert.equal(transferredReport.unpaidPurchases.sales, 1);
          assert.deepEqual(state.availableOrdinals, [
            { first: 1, last: 1 },
            { first: 3, last: 3 },
          ]);
          const movements = await prisma.packageValuationMovement.findMany({
            where: { purchaseId: snapshot.id },
          });
          assert.equal(
            movements.reduce((sum, row) => sum + row.netCents, 0n),
            6667n,
          );
          assert.equal(movements.find((row) => row.kind === "RESTORE")?.netCents, 3334n);
          assert.equal(movements.find((row) => row.kind === "RESTORE")?.customerId, b.id);
          assert.equal(
            movements
              .filter((row) => row.kind.startsWith("TRANSFER"))
              .reduce((sum, row) => sum + row.netCents, 0n),
            0n,
          );
          await assert.rejects(() =>
            voidSale(purchase.id, { reason: "Forbidden after transfer" }, manager.id),
          );
          await assert.rejects(
            () =>
              prisma.packageValuationMovement.update({
                where: { id: movements[0]!.id },
                data: { netCents: 0n },
              }),
            /append-only/,
          );
          await voidSale(second.id, { reason: "Restore second ordinal" }, manager.id);
          // Projection corruption must fail closed; a balance total alone is insufficient.
          await prisma.packageValuationState.update({
            where: { id: state.id },
            data: { customerId: a.id },
          });
          await assert.rejects(packageValuationReport, { code: "VALUATION_RECONCILIATION_FAILED" });
          await prisma.packageValuationState.update({
            where: { id: state.id },
            data: { customerId: b.id },
          });
          assert.equal((await packageValuationReport()).active.net, "100.00");

          // A separate unspent purchase may be voided; source deletion must preserve evidence.
          const removable = await createSale(purchaseInput);
          const removableHolding = await prisma.customerPackageHolding.findFirstOrThrow({
            where: { saleLine: { saleId: removable.id } },
          });
          await voidSale(removable.id, { reason: "Cancel unused purchase" }, manager.id);
          assert.equal(
            await prisma.customerPackageHolding.count({ where: { id: removableHolding.id } }),
            0,
          );
          const removedSnapshot = await prisma.packagePurchaseSnapshot.findUniqueOrThrow({
            where: { tenantId_holdingId: { tenantId: tenant.id, holdingId: removableHolding.id } },
          });
          const removedMovements = await prisma.packageValuationMovement.findMany({
            where: { purchaseId: removedSnapshot.id },
          });
          assert.equal(
            removedMovements.reduce((sum, row) => sum + row.netCents, 0n),
            0n,
          );

          // New expiring grant: repeat expiry jobs never duplicate movements.
          await prisma.package.update({ where: { id: pkg.id }, data: { validityDays: 1 } });
          // Short-lived disposable fixture: keep grant live, then let DB time cross
          // its immutable expiry so the report (not grant-time expiry) must move it.
          await prisma.$executeRawUnsafe(
            `CREATE FUNCTION valuation_test_short_expiry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW."expiresAt" := (clock_timestamp() AT TIME ZONE 'UTC') + interval '1 second'; RETURN NEW; END $$`,
          );
          await prisma.$executeRawUnsafe(
            `CREATE TRIGGER valuation_test_short_expiry BEFORE INSERT ON customer_package_holdings FOR EACH ROW WHEN (NEW."tenantId" = '${tenant.id}') EXECUTE FUNCTION valuation_test_short_expiry()`,
          );
          let expiring;
          try {
            expiring = await createSale(purchaseInput);
          } finally {
            await prisma.$executeRawUnsafe(
              `DROP TRIGGER valuation_test_short_expiry ON customer_package_holdings`,
            );
            await prisma.$executeRawUnsafe(`DROP FUNCTION valuation_test_short_expiry()`);
          }
          const expiringHolding = await prisma.customerPackageHolding.findFirstOrThrow({
            where: { saleLine: { saleId: expiring.id } },
          });
          const expiredSnapshot = await prisma.packagePurchaseSnapshot.findUniqueOrThrow({
            where: { tenantId_holdingId: { tenantId: tenant.id, holdingId: expiringHolding.id } },
          });
          const asOf = new Date(expiringHolding.expiresAt!.getTime() + 1);
          await new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, asOf.getTime() - Date.now()) + 50),
          );
          await prisma.packageValuationState.update({
            where: { id: state.id },
            data: { customerId: a.id },
          });
          await assert.rejects(packageValuationReport, { code: "VALUATION_RECONCILIATION_FAILED" });
          assert.equal(
            await prisma.packageValuationMovement.count({
              where: { purchaseId: expiredSnapshot.id, kind: "EXPIRE_IN" },
            }),
            0,
            "Failed reconciliation rolls report-triggered expiry back.",
          );
          await prisma.packageValuationState.update({
            where: { id: state.id },
            data: { customerId: b.id },
          });
          const expiredReport = await packageValuationReport();
          assert.equal(expiredReport.expired.net, "100.00");
          assert.equal(expiredReport.active.net, "100.00");
          for (let i = 0; i < 2; i++)
            await prisma.$transaction(async (tx) => {
              await lockPrepaid(tx, tenant.id);
              await expirePackageValuations(tx, asOf);
            });
          const expiry = await prisma.packageValuationMovement.findMany({
            where: { purchaseId: expiredSnapshot.id },
          });
          assert.equal(expiry.length, 3);
          assert.equal(
            expiry
              .filter((row) => row.bucket === "ACTIVE")
              .reduce((sum, row) => sum + row.netCents, 0n),
            0n,
          );
          assert.equal(
            expiry
              .filter((row) => row.bucket === "EXPIRED")
              .reduce((sum, row) => sum + row.netCents, 0n),
            10000n,
          );
          assert.ok(
            expiry
              .filter((row) => row.kind.startsWith("EXPIRE"))
              .every(
                (row) =>
                  row.actorId === null &&
                  row.effectiveAt.getTime() === expiringHolding.expiresAt!.getTime(),
              ),
          );
          assert.equal(
            await prisma.packagePurchaseSnapshot.count({ where: { saleId: legacy.id } }),
            0,
          );
          const report = await packageValuationReport();
          assert.equal(report.expired.net, "100.00");
          assert.equal(report.active.net, "100.00");
          assert.equal(report.unpaidPurchases.sales, 2);
          assert.equal(report.unpaidPurchases.sourceSaleOutstanding, "200.00");
          assert.equal(report.reconciliation.purchases, 3);
          const concurrent = await Promise.all([
            packageValuationReport(),
            packageValuationReport(),
          ]);
          assert.equal(concurrent[0]!.reconciliation.movements, report.reconciliation.movements);
          assert.equal(concurrent[1]!.expired.net, "100.00");
          // Equal-value ordinals still carry distinct immutable session identity.
          await prisma.package.update({
            where: { id: pkg.id },
            data: { validityDays: null, memberPrice: 0, nonmemberPrice: 0 },
          });
          const free = await createSale(purchaseInput);
          const freeHolding = await prisma.customerPackageHolding.findFirstOrThrow({
            where: { saleLine: { saleId: free.id } },
          });
          await createSale({
            customerId: a.id,
            lines: [{ itemType: "SERVICE", itemId: service.id, quantity: 1 }],
            payments: [{ method: "PACKAGE", amount: 10, holdingId: freeHolding.id }],
          });
          const freeSnapshot = await prisma.packagePurchaseSnapshot.findUniqueOrThrow({
            where: { tenantId_holdingId: { tenantId: tenant.id, holdingId: freeHolding.id } },
          });
          const freeState = await prisma.packageValuationState.findUniqueOrThrow({
            where: { tenantId_purchaseId: { tenantId: tenant.id, purchaseId: freeSnapshot.id } },
          });
          await prisma.packageValuationState.update({
            where: { id: freeState.id },
            data: { availableOrdinals: [{ first: 1, last: 2 }] },
          });
          await assert.rejects(packageValuationReport, { code: "VALUATION_RECONCILIATION_FAILED" });
          await prisma.packageValuationState.update({
            where: { id: freeState.id },
            data: { availableOrdinals: freeState.availableOrdinals! },
          });
          const freeReport = await packageValuationReport();
          assert.equal(freeReport.active.net, "100.00");
          assert.equal(freeReport.active.holdings, 2, "Known zero is not unvalued.");
          await voidSale(expiring.id, { reason: "Cancel unspent expired purchase" }, manager.id);
          assert.equal((await packageValuationReport()).expired.net, "0.00");

          // Held carts grant nothing. Completion snapshots discounted consideration
          // once across every purchased unit, including the original stored GST.
          await prisma.tenant.update({ where: { id: tenant.id }, data: { gstEnabled: true } });
          await prisma.package.update({
            where: { id: pkg.id },
            data: { memberPrice: 109, nonmemberPrice: 109 },
          });
          const discountedInput = {
            customerId: a.id,
            lines: [
              { itemType: "PACKAGE" as const, itemId: pkg.id, quantity: 2, discountPercent: 10 },
            ],
            payments: [{ method: "CASH" as const, amount: 50 }],
          };
          const held = await createSale({ ...discountedInput, payments: [], hold: true });
          assert.equal(
            await prisma.packagePurchaseSnapshot.count({ where: { saleId: held.id } }),
            0,
          );
          const completed = await completeSale(held.id, discountedInput);
          assert.equal((await completeSale(held.id, discountedInput)).id, completed.id);
          const discounted = await prisma.packagePurchaseSnapshot.findFirstOrThrow({
            where: { saleId: completed.id },
          });
          assert.equal(discounted.grantedSessions, 6);
          assert.equal(discounted.grossCents, 19620n);
          assert.equal(discounted.netCents, 18000n);
          assert.equal(discounted.taxCents, 1620n);
          assert.equal(
            await prisma.packagePurchaseSnapshot.count({ where: { saleId: held.id } }),
            1,
          );
          const debtReport = await packageValuationReport();
          assert.equal(debtReport.active.net, "280.00");
          assert.equal(debtReport.active.originalTax, "16.20");
          assert.equal(debtReport.unpaidPurchases.sourceSaleOutstanding, "246.20");
          // Later catalogue/tax changes cannot reprice the immutable grant.
          await prisma.package.update({
            where: { id: pkg.id },
            data: { memberPrice: 999, nonmemberPrice: 999, sessionCount: 99 },
          });
          await prisma.tenant.update({ where: { id: tenant.id }, data: { gstEnabled: false } });
          const redeemDiscounted = () =>
            createSale({
              customerId: a.id,
              lines: [{ itemType: "SERVICE", itemId: service.id, quantity: 1 }],
              payments: [{ method: "PACKAGE", amount: 10, holdingId: discounted.holdingId }],
            });
          const [drawOne, drawTwo] = await Promise.all([
            redeemDiscounted(),
            redeemDiscounted(),
            packageValuationReport(),
          ]);
          const afterDraw = await packageValuationReport();
          assert.equal(afterDraw.active.net, "220.00");
          assert.equal(afterDraw.active.originalTax, "10.80");
          await voidSale(drawTwo.id, { reason: "Restore later discounted draw first" }, manager.id);
          await voidSale(drawOne.id, { reason: "Restore earlier discounted draw" }, manager.id);
          assert.equal((await packageValuationReport()).active.gross, "296.20");
          assert.deepEqual(
            await prisma.packagePurchaseSnapshot.findUniqueOrThrow({
              where: { id: discounted.id },
            }),
            discounted,
          );
          await runAsTenant(tenant.id + "-other", async () => {
            const other = await packageValuationReport();
            assert.equal(other.reconciliation.purchases, 0);
            assert.equal(other.active.net, "0.00");
          });
        },
        manager.id,
      );
    } finally {
      await runAsPlatform(() => prisma.tenant.delete({ where: { id: tenant.id } }));
      await prisma.$disconnect();
    }
  },
);
