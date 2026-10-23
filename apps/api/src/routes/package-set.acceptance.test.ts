import assert from "node:assert/strict";
import { test } from "node:test";

test(
  "service-set purchase snapshots, complete matching, allocation and reversal",
  { skip: process.env.PACKAGE_SET_ACCEPTANCE !== "1" },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55440");
    assert.equal(url.pathname, "/package_expiry_test");
    const { prisma } = await import("../lib/prisma.js");
    const { runAsTenant, runAsPlatform } = await import("../lib/tenant-context.js");
    const { createPackage, updatePackage } = await import("../services/package.service.js");
    const { createSale, voidSale } = await import("../services/sale.service.js");
    const { getCustomerHoldings } = await import("../services/customer.service.js");
    const id = "package-set-acceptance";
    const scope = <T>(fn: () => T) => runAsTenant(id, fn);
    const purge = () => runAsPlatform(() => prisma.tenant.deleteMany({ where: { id } }));
    try {
      await purge();
      const fixture = await runAsPlatform(async () => {
        await prisma.tenant.create({ data: { id, slug: id, name: "Service sets" } });
        for (const code of ["catalogue", "sale", "customers", "packages"]) {
          const module = await prisma.module.upsert({
            where: { code },
            update: {},
            create: { code, name: code, category: "Core", isCore: code !== "packages" },
          });
          await prisma.tenantModule.create({ data: { tenantId: id, moduleId: module.id } });
        }
        const a = await prisma.service.create({
          data: { tenantId: id, name: "A", memberPrice: 10, nonmemberPrice: 10 },
        });
        const b = await prisma.service.create({
          data: { tenantId: id, name: "B", memberPrice: 20, nonmemberPrice: 20 },
        });
        const customer = await prisma.customer.create({ data: { tenantId: id, name: "Buyer" } });
        const actor = await prisma.user.create({
          data: {
            tenantId: id,
            name: "Owner",
            globalRole: "SUPER_ADMIN",
            passwordHash: "unused",
            twoFactorEnabled: true,
          },
        });
        const extra = await prisma.service.create({
          data: { tenantId: id, name: "Extra", memberPrice: 100, nonmemberPrice: 100 },
        });
        return { a, b, extra, customer, actor };
      });
      const { a, b, extra, customer, actor } = fixture;
      const bundle = await scope(() =>
        createPackage({
          name: "Set",
          sessionCount: 3,
          memberPrice: 100,
          nonmemberPrice: 100,
          redemptionMode: "SERVICE_SET",
          serviceIds: [a.id, b.id],
          serviceSet: [
            { serviceId: a.id, quantity: 2 },
            { serviceId: b.id, quantity: 1 },
          ],
        }),
      );
      const purchase = await scope(() =>
        createSale({
          customerId: customer.id,
          lines: [{ itemType: "PACKAGE", itemId: bundle.id, quantity: 1 }],
          payments: [{ method: "CASH", amount: 100 }],
        }),
      );
      const holding = await scope(() =>
        prisma.customerPackageHolding.findFirstOrThrow({
          where: { saleLine: { saleId: purchase.id } },
        }),
      );
      const lines = [
        { itemType: "SERVICE" as const, itemId: a.id, quantity: 5 },
        { itemType: "SERVICE" as const, itemId: b.id, quantity: 2 },
      ];
      const sale = await scope(() =>
        createSale({
          customerId: customer.id,
          lines,
          payments: [
            { method: "PACKAGE", holdingId: holding.id, amount: 80 },
            { method: "CASH", amount: 10 },
          ],
        }),
      );
      assert.equal(
        (
          await scope(() =>
            prisma.customerPackageHolding.findFirstOrThrow({ where: { id: holding.id } }),
          )
        ).quantityRemaining,
        1,
      );
      assert.equal(
        (
          await scope(() =>
            prisma.customerRedemption.findFirstOrThrow({ where: { saleId: sale.id } }),
          )
        ).quantity,
        2,
      );
      await scope(() => voidSale(sale.id, { reason: "Undo visit" }, actor.id));
      assert.equal(
        (
          await scope(() =>
            prisma.customerPackageHolding.findFirstOrThrow({ where: { id: holding.id } }),
          )
        ).quantityRemaining,
        3,
      );
      await scope(() =>
        updatePackage(bundle.id, {
          redemptionMode: "PER_UNIT",
          serviceSet: [],
          serviceIds: [b.id],
        }),
      );
      const read = await scope(() => getCustomerHoldings(customer.id));
      assert.equal(
        read.holdings.find((row) => row.id === holding.id)?.redemptionMode,
        "SERVICE_SET",
      );
      const code = (error: unknown) =>
        !!error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "HOLDING_NOT_COVERED";
      await assert.rejects(
        scope(() =>
          createSale({
            customerId: customer.id,
            lines: [
              { itemType: "SERVICE", itemId: a.id, quantity: 1 },
              { itemType: "SERVICE", itemId: b.id, quantity: 1 },
            ],
            payments: [{ method: "PACKAGE", holdingId: holding.id, amount: 30 }],
          }),
        ),
        code,
      );
      // Two tenders cannot cover the same units; refusal rolls back both deductions.
      await assert.rejects(
        scope(() =>
          createSale({
            customerId: customer.id,
            lines: [
              { itemType: "SERVICE", itemId: a.id, quantity: 2 },
              { itemType: "SERVICE", itemId: b.id, quantity: 1 },
              { itemType: "SERVICE", itemId: extra.id, quantity: 1 },
            ],
            payments: [
              { method: "PACKAGE", holdingId: holding.id, amount: 40 },
              { method: "PACKAGE", holdingId: holding.id, amount: 40 },
              { method: "CASH", amount: 60 },
            ],
          }),
        ),
        code,
      );
      assert.equal(
        (
          await scope(() =>
            prisma.customerPackageHolding.findFirstOrThrow({ where: { id: holding.id } }),
          )
        ).quantityRemaining,
        3,
      );
      const discounted = await scope(() =>
        createSale({
          customerId: customer.id,
          lines: [
            { itemType: "SERVICE", itemId: a.id, quantity: 2, discountPercent: 50 },
            { itemType: "SERVICE", itemId: b.id, quantity: 1 },
          ],
          payments: [{ method: "PACKAGE", holdingId: holding.id, amount: 30 }],
        }),
      );
      assert.equal(discounted.totalAmount, "30.00");
      await assert.rejects(
        scope(() => updatePackage(bundle.id, { redemptionMode: "SERVICE_SET", serviceSet: [] })),
        /./,
      );
    } finally {
      await purge();
      await prisma.$disconnect();
    }
  },
);
