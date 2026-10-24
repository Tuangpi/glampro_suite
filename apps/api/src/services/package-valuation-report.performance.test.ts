import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { test } from "node:test";

test(
  "synthetic valuation report scale and prepaid-lock contention diagnostics",
  { skip: process.env.PACKAGE_VALUATION_PERFORMANCE_TEST !== "1", timeout: 180_000 },
  async (t) => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55462");
    assert.equal(url.pathname, "/valuation_test");
    const { prisma } = await import("../lib/prisma.js");
    const { runAsTenant, runAsPlatform } = await import("../lib/tenant-context.js");
    const { lockPrepaid } = await import("../lib/prepaid-lock.js");
    const { activatePackageValuation } = await import("./package-valuation.service.js");
    const { packageValuationReport } = await import("./package-valuation-report.service.js");
    const tenant = await prisma.tenant.create({
      data: { name: "Synthetic report scale", slug: randomUUID() },
    });
    try {
      const actor = await runAsTenant(tenant.id, () =>
        prisma.user.create({
          data: {
            tenantId: tenant.id,
            name: "Manager",
            globalRole: "MANAGER",
            passwordHash: "fixture",
          },
        }),
      );
      await runAsTenant(
        tenant.id,
        async () => {
          const activation = await activatePackageValuation(
            {
              policyVersion: 1,
              currency: "SGD",
              reason: "Synthetic benchmark only",
              confirmed: true,
            },
            actor.id,
          );
          const customer = await prisma.customer.create({
            data: { tenantId: tenant.id, name: "Synthetic owner" },
          });
          const pkg = await prisma.package.create({
            data: {
              tenantId: tenant.id,
              name: "Synthetic three sessions",
              sessionCount: 3,
              memberPrice: 100,
              nonmemberPrice: 100,
            },
          });
          // Storage-level fixtures deliberately bypass POS setup cost. They model
          // live holdings and valid immutable grant/draw/restore history, NOT sales
          // throughput, unpaid-sale fanout, expiry processing or production data.
          let seeded = 0;
          for (const count of [1_000, 10_000]) {
            while (seeded < count) {
              const rows = Array.from({ length: Math.min(250, count - seeded) }, (_, offset) => {
                const id = `${tenant.id}-${seeded + offset}`;
                return {
                  id,
                  holdingId: `holding-${id}`,
                  lineId: `line-${id}`,
                  saleId: `sale-${id}`,
                };
              });
              await prisma.$transaction(async (tx) => {
                await tx.customerPackageHolding.createMany({
                  data: rows.map((row) => ({
                    id: row.holdingId,
                    tenantId: tenant.id,
                    customerId: customer.id,
                    packageId: pkg.id,
                    quantity: 3,
                    quantityRemaining: 3,
                  })),
                });
                await tx.packagePurchaseSnapshot.createMany({
                  data: rows.map((row) => ({
                    id: row.id,
                    tenantId: tenant.id,
                    activationId: activation.id,
                    currency: "SGD",
                    policyVersion: 1,
                    holdingId: row.holdingId,
                    saleId: row.saleId,
                    saleLineId: row.lineId,
                    originalCustomerId: customer.id,
                    grantedSessions: 3,
                    netCents: 10000n,
                    taxCents: 0n,
                    grossCents: 10000n,
                    purchasedAt: new Date(),
                    actorId: actor.id,
                  })),
                });
                await tx.packageValuationState.createMany({
                  data: rows.map((row) => ({
                    tenantId: tenant.id,
                    purchaseId: row.id,
                    customerId: customer.id,
                    availableOrdinals: [{ first: 1, last: 3 }],
                  })),
                });
                await tx.packageValuationMovement.createMany({
                  data: rows.flatMap((row) =>
                    [
                      { kind: "GRANT", sourceKey: "grant", quantity: 3, cents: 10000n, last: 3 },
                      {
                        kind: "REDEEM",
                        sourceKey: "redeem:one",
                        quantity: -1,
                        cents: -3334n,
                        last: 1,
                      },
                      {
                        kind: "RESTORE",
                        sourceKey: "restore:one",
                        quantity: 1,
                        cents: 3334n,
                        last: 1,
                      },
                      {
                        kind: "REDEEM",
                        sourceKey: "redeem:two",
                        quantity: -1,
                        cents: -3334n,
                        last: 1,
                      },
                      {
                        kind: "RESTORE",
                        sourceKey: "restore:two",
                        quantity: 1,
                        cents: 3334n,
                        last: 1,
                      },
                    ].map((event) => ({
                      tenantId: tenant.id,
                      purchaseId: row.id,
                      customerId: customer.id,
                      kind: event.kind,
                      sourceKey: event.sourceKey,
                      bucket: "ACTIVE",
                      quantity: event.quantity,
                      netCents: event.cents,
                      taxCents: 0n,
                      grossCents: event.cents,
                      ordinals: [{ first: 1, last: event.last }],
                      actorId: actor.id,
                      effectiveAt: new Date(),
                    })),
                  ),
                });
              });
              seeded += rows.length;
            }
            const samples: number[] = [];
            const heapBefore = process.memoryUsage().heapUsed;
            for (let repeat = 0; repeat < 3; repeat++) {
              const started = performance.now();
              const report = await packageValuationReport();
              samples.push(Math.round(performance.now() - started));
              assert.equal(report.active.net, `${count * 100}.00`);
              assert.equal(report.active.sessionsRemaining, count * 3);
              assert.equal(report.reconciliation.movements, count * 5);
              assert.equal(report.reconciliation.purchases, count);
              assert.equal(report.unpaidPurchases.sales, 0);
            }
            t.diagnostic(
              JSON.stringify({
                holdings: count,
                movements: count * 5,
                reportMs: samples,
                heapBeforeMiB: Math.round(heapBefore / 1048576),
                heapAfterMiB: Math.round(process.memoryUsage().heapUsed / 1048576),
              }),
            );
          }
          // Start a real report first, then measure a competing prepaid-lock holder.
          // This is a local lock-contention observation, not a POS latency guarantee.
          const started = performance.now();
          const report = packageValuationReport();
          const wait = prisma.$transaction(
            async (tx) => {
              await lockPrepaid(tx, tenant.id);
              return Math.round(performance.now() - started);
            },
            { timeout: 30_000 },
          );
          const [, lockAcquiredMs] = await Promise.all([report, wait]);
          t.diagnostic(
            JSON.stringify({
              competingLockAcquiredMs: lockAcquiredMs,
              note: "Scheduling-dependent synthetic observation; no production SLO asserted.",
            }),
          );

          // Add source sales/debt for every live holding to exercise the report's
          // large IN filter, deduplication and monetary aggregation. These remain
          // synthetic storage fixtures, not a receivable-collection workflow.
          for (let first = 0; first < 10_000; first += 250) {
            const ids = Array.from(
              { length: 250 },
              (_, offset) => `sale-${tenant.id}-${first + offset}`,
            );
            await prisma.$transaction(async (tx) => {
              await tx.sale.createMany({
                data: ids.map((id) => ({
                  id,
                  tenantId: tenant.id,
                  customerId: customer.id,
                  status: "COMPLETED",
                  totalQuantity: 1,
                  totalAmount: 100,
                  paidAmount: 25,
                  soldAt: new Date(),
                })),
              });
              await tx.customerOutstanding.createMany({
                data: ids.map((saleId) => ({
                  tenantId: tenant.id,
                  customerId: customer.id,
                  saleId,
                  unpaidAmount: 75,
                })),
              });
            });
          }
          // Past expiry is supplied at insert, consistently on holding and immutable
          // snapshot. GRANT starts ACTIVE so the first report must process backlog.
          const expiresAt = new Date(Date.now() - 1000);
          const expiredRows = Array.from(
            { length: 500 },
            (_, index) => `${tenant.id}-expired-${index}`,
          );
          await prisma.$transaction(async (tx) => {
            await tx.customerPackageHolding.createMany({
              data: expiredRows.map((id) => ({
                id: `holding-${id}`,
                tenantId: tenant.id,
                customerId: customer.id,
                packageId: pkg.id,
                quantity: 3,
                quantityRemaining: 3,
                expiresAt,
              })),
            });
            await tx.packagePurchaseSnapshot.createMany({
              data: expiredRows.map((id) => ({
                id,
                tenantId: tenant.id,
                activationId: activation.id,
                currency: "SGD",
                policyVersion: 1,
                holdingId: `holding-${id}`,
                saleId: `sale-${id}`,
                saleLineId: `line-${id}`,
                originalCustomerId: customer.id,
                grantedSessions: 3,
                netCents: 10000n,
                taxCents: 0n,
                grossCents: 10000n,
                originalExpiresAt: expiresAt,
                purchasedAt: new Date(),
                actorId: actor.id,
              })),
            });
            await tx.packageValuationState.createMany({
              data: expiredRows.map((purchaseId) => ({
                tenantId: tenant.id,
                purchaseId,
                customerId: customer.id,
                availableOrdinals: [{ first: 1, last: 3 }],
              })),
            });
            await tx.packageValuationMovement.createMany({
              data: expiredRows.map((purchaseId) => ({
                tenantId: tenant.id,
                purchaseId,
                customerId: customer.id,
                kind: "GRANT",
                sourceKey: "grant",
                bucket: "ACTIVE",
                quantity: 3,
                netCents: 10000n,
                taxCents: 0n,
                grossCents: 10000n,
                ordinals: [{ first: 1, last: 3 }],
                actorId: actor.id,
                effectiveAt: new Date(),
              })),
            });
          });
          const loadedSamples: number[] = [];
          const retainedHeapMiB: number[] = [];
          for (let repeat = 0; repeat < 10; repeat++) {
            const started = performance.now();
            const snapshot = await packageValuationReport();
            loadedSamples.push(Math.round(performance.now() - started));
            assert.equal(snapshot.active.net, "1000000.00");
            assert.equal(snapshot.expired.net, "50000.00");
            assert.equal(snapshot.expired.sessionsRemaining, 1500);
            assert.equal(snapshot.reconciliation.purchases, 10_500);
            assert.equal(
              snapshot.reconciliation.movements,
              51_500,
              "Expiry transitions occur once, not on every refresh.",
            );
            assert.deepEqual(snapshot.unpaidPurchases, {
              sales: 10_000,
              holdings: 10_000,
              sourceSaleOutstanding: "750000.00",
            });
            // Only diagnostic: --expose-gc allows comparable post-GC readings.
            // No environment-dependent memory/latency threshold is asserted.
            globalThis.gc?.();
            retainedHeapMiB.push(Math.round(process.memoryUsage().heapUsed / 1048576));
          }
          t.diagnostic(
            JSON.stringify({
              debtSales: 10_000,
              expiredBacklog: 500,
              reportMs: loadedSamples,
              postGcHeapMiB: retainedHeapMiB,
              explicitGc: typeof globalThis.gc === "function",
              note: "First sample processes expiry; subsequent samples verify idempotence. Local synthetic evidence only.",
            }),
          );
        },
        actor.id,
      );
    } finally {
      await runAsPlatform(() => prisma.tenant.delete({ where: { id: tenant.id } }));
      await prisma.$disconnect();
    }
  },
);
