import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { createSale, completeSale } from "./sale.service.js";
import {
  captureCollectionEvidence,
  type CaptureCollection,
} from "./commission-collection-evidence.js";

const enabled = process.env.COMMISSION_COLLECTION_ACCEPTANCE === "1";
test(
  "explicit collection persistence is atomic, immutable, tenant scoped and retry safe",
  { skip: !enabled },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.ok(
      ["/commission_collection_test", "/commission_collection_replay"].includes(url.pathname),
    );
    assert.equal(url.port, "55476");
    const tenantId = `sc006-${Date.now()}`;
    const actorId = `${tenantId}-actor`;
    const sellerId = `${tenantId}-seller`;
    const otherId = `${tenantId}-other`;
    const at = new Date();
    try {
      await runAsPlatform(async () => {
        for (const id of [tenantId, otherId])
          await prisma.tenant.create({ data: { id, name: "Synthetic collections", slug: id } });
      });
      await runAsTenant(
        tenantId,
        async () => {
          for (const id of [actorId, sellerId])
            await prisma.user.create({
              data: {
                id,
                tenantId,
                name: id,
                passwordHash: "synthetic-no-login",
                globalRole: "MANAGER",
              },
            });
          const customer = await prisma.customer.create({
            data: { tenantId, name: "Synthetic buyer" },
          });
          const sale = await prisma.sale.create({
            data: {
              tenantId,
              customerId: customer.id,
              totalQuantity: 2,
              totalAmount: "309",
              paidAmount: "109",
              soldAt: at,
              status: "COMPLETED",
            },
          });
          const lineA = await prisma.saleLine.create({
            data: {
              tenantId,
              saleId: sale.id,
              itemType: "PACKAGE",
              itemId: "synthetic-package-a",
              itemName: "Package A",
              quantity: 1,
              unitPrice: "109",
              lineTotal: "109",
              taxAmount: "9",
              attribution: {
                sellers: [
                  { staffId: sellerId, share: 6000 },
                  { staffId: actorId, share: 4000 },
                ],
              },
            },
          });
          const lineB = await prisma.saleLine.create({
            data: {
              tenantId,
              saleId: sale.id,
              itemType: "PACKAGE",
              itemId: "synthetic-package-b",
              itemName: "Package B",
              quantity: 1,
              unitPrice: "200",
              lineTotal: "200",
            },
          });
          await prisma.commissionRule.create({
            data: {
              tenantId,
              itemKind: "PACKAGE_SALE",
              scope: "COMPANY",
              scopeKey: "synthetic-company",
              rate: "10",
              effectiveAt: new Date(at.getTime() - 1000),
              actorId,
              reason: "Synthetic collection rate",
            },
          });
          const payment = await prisma.salePayment.create({
            data: { tenantId, saleId: sale.id, method: "CASH", amount: "109" },
          });
          const input: CaptureCollection = {
            eventKey: "initial-receipt",
            sourceType: "SALE_PAYMENT",
            sourceId: payment.id,
            saleId: sale.id,
            currency: "SGD",
            reason: "Explicit synthetic receipt",
            allocations: [
              { saleLineId: lineA.id, grossCents: "5450" },
              { saleLineId: lineB.id, grossCents: "5450" },
            ],
          };
          const capture = (value: CaptureCollection) =>
            prisma.$transaction((tx) => captureCollectionEvidence(tx, value));
          const [first, retry] = await Promise.all([
            capture(input),
            capture({ ...input, allocations: [...input.allocations].reverse() }),
          ]);
          assert.equal(first.id, retry.id);
          assert.equal(first.grossCents, 10900n);
          const allocatedA = first.allocations.find((row) => row.saleLineId === lineA.id)!;
          const allocatedB = first.allocations.find((row) => row.saleLineId === lineB.id)!;
          assert.equal(allocatedA.netCents, 5000n);
          assert.equal(allocatedA.taxCents, 450n);
          assert.equal(allocatedB.netCents, 5450n);
          const evidence = allocatedA.evidence as {
            rates: { staffId: string; rate: string; amount: string }[];
            postingStatus: string;
          };
          assert.equal(evidence.postingStatus, "PENDING_RELEASE");
          assert.equal(
            evidence.rates.find((row) => row.staffId === sellerId)?.amount,
            "3.0000000000",
          );
          assert.equal(
            evidence.rates.find((row) => row.staffId === actorId)?.amount,
            "2.0000000000",
          );
          assert.equal(
            (allocatedB.evidence as { attributionStatus: string }).attributionStatus,
            "UNKNOWN",
          );
          await assert.rejects(capture({ ...input, reason: "Conflicting retry" }));
          await assert.rejects(capture({ ...input, eventKey: "duplicate-source" }));
          await assert.rejects(
            prisma.commissionCollection.update({
              where: { id: first.id },
              data: { currency: "USD" },
            }),
          );
          await assert.rejects(prisma.commissionCollection.delete({ where: { id: first.id } }));
          await assert.rejects(
            prisma.commissionCollectionAllocation.update({
              where: { id: allocatedA.id },
              data: { evidence: {} },
            }),
          );
          await assert.rejects(
            prisma.commissionCollectionAllocation.delete({ where: { id: allocatedA.id } }),
          );
          await runAsTenant(
            otherId,
            async () => {
              assert.equal(
                await prisma.commissionCollection.findFirst({ where: { id: first.id } }),
                null,
              );
              assert.equal(
                await prisma.commissionCollectionAllocation.findFirst({
                  where: { id: allocatedA.id },
                }),
                null,
              );
              await assert.rejects(capture(input));
            },
            actorId,
          );

          const outstanding = await prisma.customerOutstanding.create({
            data: { tenantId, customerId: customer.id, saleId: sale.id, unpaidAmount: "200" },
          });
          const laterAt = new Date(payment.createdAt.getTime() + 1000);
          await prisma.commissionRule.create({
            data: {
              tenantId,
              itemKind: "PACKAGE_SALE",
              scope: "COMPANY",
              scopeKey: "synthetic-company",
              rate: "20",
              effectiveAt: laterAt,
              actorId,
              reason: "Synthetic later rate",
            },
          });
          const later = await prisma.customerOutstandingPayment.create({
            data: {
              tenantId,
              customerId: customer.id,
              saleId: sale.id,
              outstandingId: outstanding.id,
              paidAmount: "54.50",
              paidAt: laterAt,
            },
          });
          // A departed seller remains the original seller, never the current cashier.
          await prisma.user.update({ where: { id: sellerId }, data: { disabled: true } });
          const laterInput: CaptureCollection = {
            ...input,
            eventKey: "later-collection",
            sourceType: "OUTSTANDING_PAYMENT",
            sourceId: later.id,
            allocations: [{ saleLineId: lineA.id, grossCents: "5450" }],
          };
          const laterResult = await capture(laterInput);
          const laterEvidence = laterResult.allocations[0]!.evidence as typeof evidence;
          assert.equal(
            laterEvidence.rates.find((row) => row.staffId === sellerId)?.amount,
            "6.0000000000",
          );
          assert.equal(
            laterEvidence.rates.find((row) => row.staffId === actorId)?.amount,
            "4.0000000000",
          );
          assert.deepEqual(
            (await prisma.saleLine.findFirstOrThrow({ where: { id: lineA.id } })).attribution,
            lineA.attribution,
          );
          assert.equal(
            (
              await prisma.customerOutstanding.findFirstOrThrow({ where: { id: outstanding.id } })
            ).unpaidAmount.toFixed(2),
            "200.00",
          );

          const rollbackPayment = await prisma.salePayment.create({
            data: { tenantId, saleId: sale.id, method: "CASH", amount: "1" },
          });
          const rollbackInput: CaptureCollection = {
            ...input,
            eventKey: "rollback-collection",
            sourceId: rollbackPayment.id,
            allocations: [{ saleLineId: lineB.id, grossCents: "100" }],
          };
          await assert.rejects(
            prisma.$transaction(async (tx) => {
              await captureCollectionEvidence(tx, rollbackInput);
              throw new Error("Synthetic downstream failure");
            }),
          );
          assert.equal(
            await prisma.commissionCollection.count({
              where: { eventKey: rollbackInput.eventKey },
            }),
            0,
          );
          await assert.rejects(
            capture({
              ...rollbackInput,
              allocations: [{ saleLineId: lineA.id, grossCents: "100" }],
            }),
          );
          await assert.rejects(
            capture({
              ...rollbackInput,
              allocations: [{ saleLineId: "foreign-line", grossCents: "100" }],
            }),
          );
          await assert.rejects(
            capture({
              ...rollbackInput,
              allocations: [{ saleLineId: lineB.id, grossCents: "99" }],
            }),
          );
          await assert.rejects(capture({ ...rollbackInput, currency: "USD" }));
          for (const [method, sessionId] of [
            ["PREPAID_CREDIT", null],
            ["PACKAGE", null],
            ["CARD", "unsettled-session"],
          ] as const) {
            const source = await prisma.salePayment.create({
              data: { tenantId, saleId: sale.id, amount: "1", method, sessionId },
            });
            await assert.rejects(capture({ ...rollbackInput, sourceId: source.id }));
          }
          // Database-level reconciliation catches incomplete writes even without service validation.
          await assert.rejects(
            prisma.commissionCollection.create({
              data: {
                tenantId,
                eventKey: "unallocated-direct",
                eventHash: "a".repeat(64),
                sourceType: "SALE_PAYMENT",
                sourceId: rollbackPayment.id,
                saleId: sale.id,
                currency: "SGD",
                grossCents: 100n,
                occurredAt: rollbackPayment.createdAt,
                actorId,
                reason: "Synthetic invalid direct write",
              },
            }),
          );
          assert.equal(
            await prisma.commissionCollection.count({ where: { eventKey: "unallocated-direct" } }),
            0,
          );
          // Direct allocation with incorrect cumulative tax is rejected inside the transaction.
          await assert.rejects(
            prisma.$transaction(async (tx) => {
              const c = await tx.commissionCollection.create({
                data: {
                  tenantId,
                  eventKey: "bad-tax-direct",
                  eventHash: "b".repeat(64),
                  sourceType: "SALE_PAYMENT",
                  sourceId: rollbackPayment.id,
                  saleId: sale.id,
                  currency: "SGD",
                  grossCents: 100n,
                  occurredAt: rollbackPayment.createdAt,
                  actorId,
                  reason: "Synthetic bad tax",
                },
              });
              await tx.commissionCollectionAllocation.create({
                data: {
                  tenantId,
                  collectionId: c.id,
                  saleLineId: lineB.id,
                  grossCents: 100n,
                  netCents: 99n,
                  taxCents: 1n,
                  evidence: {},
                },
              });
            }),
          );
          const raceSources = await Promise.all(
            [1, 2].map(() =>
              prisma.salePayment.create({
                data: { tenantId, saleId: sale.id, method: "CASH", amount: "100" },
              }),
            ),
          );
          const race = await Promise.allSettled(
            raceSources.map((source, index) =>
              capture({
                ...input,
                eventKey: `competing-collection-${index}`,
                sourceId: source.id,
                allocations: [{ saleLineId: lineB.id, grossCents: "10000" }],
              }),
            ),
          );
          assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
          assert.equal(race.filter((result) => result.status === "rejected").length, 1);
          const lineTotals = await prisma.commissionCollectionAllocation.aggregate({
            where: { saleLineId: lineB.id },
            _sum: { grossCents: true },
          });
          assert.equal(lineTotals._sum.grossCents, 15450n);
          await prisma.user.update({ where: { id: actorId }, data: { disabled: true } });
          await assert.rejects(capture(input));
          await prisma.user.update({ where: { id: actorId }, data: { disabled: false } });
          assert.equal(await prisma.employeeCommission.count(), 0);
          assert.equal(await prisma.packagePurchaseSnapshot.count(), 0);
          assert.equal(await prisma.commissionCollection.count(), 3);
          const service = await prisma.service.create({
            data: { tenantId, name: "Checkout service", nonmemberPrice: "109", memberPrice: "109" },
          });
          const catalogue = await prisma.module.upsert({
            where: { code: "catalogue" },
            update: {},
            create: {
              code: "catalogue",
              name: "Catalogue",
              category: "Core",
              isCore: true,
              sortOrder: 0,
            },
          });
          await prisma.tenantModule.create({ data: { tenantId, moduleId: catalogue.id } });
          const checkoutBody = {
            customerId: customer.id,
            lines: [{ itemType: "SERVICE" as const, itemId: service.id, quantity: 1 }],
            payments: [{ method: "CASH" as const, amount: 50 }],
            collection: {
              currency: "SGD" as const,
              allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "5000" }],
            },
          };
          const checkout = await createSale({
            ...checkoutBody,
            idempotencyKey: "sc006-checkout-idempotent",
          });
          assert.equal(checkout.outstandingAmount, "59.00");
          assert.equal(
            (await prisma.sale.findFirstOrThrow({ where: { id: checkout.id } })).collectionCurrency,
            "SGD",
          );
          assert.equal(
            await prisma.commissionCollection.count({ where: { saleId: checkout.id } }),
            1,
          );
          const checkoutRetry = await createSale({
            ...checkoutBody,
            idempotencyKey: "sc006-checkout-idempotent",
          });
          assert.equal(checkoutRetry.id, checkout.id);
          assert.equal(
            await prisma.commissionCollection.count({ where: { saleId: checkout.id } }),
            1,
          );
          await assert.rejects(
            prisma.sale.update({ where: { id: checkout.id }, data: { collectionCurrency: null } }),
          );
          const before = await prisma.sale.count();
          await assert.rejects(
            createSale({
              ...checkoutBody,
              collection: {
                ...checkoutBody.collection,
                allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "4999" }],
              },
            }),
          );
          assert.equal(await prisma.sale.count(), before);
          const held = await createSale({
            customerId: customer.id,
            lines: checkoutBody.lines,
            payments: [],
            hold: true,
          });
          const completed = await completeSale(held.id, checkoutBody);
          assert.equal(completed.id, held.id);
          assert.equal(await prisma.commissionCollection.count({ where: { saleId: held.id } }), 1);
          const split = await createSale({
            ...checkoutBody,
            payments: [
              { method: "CASH", amount: 30 },
              { method: "CARD", amount: 79 },
            ],
            collection: {
              currency: "SGD",
              allocations: [
                { paymentIndex: 0, linePosition: 0, grossCents: "3000" },
                { paymentIndex: 1, linePosition: 0, grossCents: "7900" },
              ],
            },
          });
          assert.equal(await prisma.commissionCollection.count({ where: { saleId: split.id } }), 2);
          for (const payments of [
            [{ method: "CASH" as const, amount: 110 }],
            [{ method: "CARD" as const, amount: 50, sessionId: "unsettled" }],
          ])
            await assert.rejects(createSale({ ...checkoutBody, payments }));
        },
        actorId,
      );
    } finally {
      await runAsPlatform(() =>
        prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherId] } } }),
      );
      await prisma.$disconnect();
    }
  },
);
