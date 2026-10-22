import assert from "node:assert/strict";
import { test } from "node:test";

test(
  "treatment links POS sessions without double deduction",
  { skip: process.env.TREATMENT_SESSION_ACCEPTANCE !== "1" },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55440");
    assert.equal(url.pathname, "/package_expiry_test");
    process.env.NODE_ENV = "test";
    const { prisma } = await import("../lib/prisma.js");
    const { runAsPlatform, runAsTenant } = await import("../lib/tenant-context.js");
    const {
      createTreatmentRecord,
      updateTreatmentRecord,
      deleteTreatmentRecord,
      getTreatmentRecord,
    } = await import("./treatment.service.js");
    const tenantId = "treatment-session-a";
    const foreignId = "treatment-session-b";
    async function purge() {
      await runAsPlatform(async () => {
        await prisma.treatmentRecord.deleteMany({
          where: { tenantId: { in: [tenantId, foreignId] } },
        });
        await prisma.sale.deleteMany({ where: { tenantId: { in: [tenantId, foreignId] } } });
        await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, foreignId] } } });
      });
    }
    const code = (expected: string) => (error: unknown) =>
      !!error && typeof error === "object" && "code" in error && error.code === expected;
    try {
      await purge();
      await runAsPlatform(() =>
        prisma.tenant.createMany({
          data: [tenantId, foreignId].map((id) => ({ id, name: id, slug: id })),
        }),
      );
      await runAsTenant(tenantId, async () => {
        const customer = await prisma.customer.create({ data: { tenantId, name: "Customer" } });
        const other = await prisma.customer.create({ data: { tenantId, name: "Other" } });
        const service = await prisma.service.create({
          data: { tenantId, name: "Facial", memberPrice: 10, nonmemberPrice: 10 },
        });
        const pkg = await prisma.package.create({
          data: {
            tenantId,
            name: "Sessions",
            sessionCount: 5,
            memberPrice: 50,
            nonmemberPrice: 50,
          },
        });
        await prisma.packageService.create({
          data: { tenantId, packageId: pkg.id, serviceId: service.id },
        });
        const holding = await prisma.customerPackageHolding.create({
          data: {
            tenantId,
            customerId: customer.id,
            packageId: pkg.id,
            quantity: 5,
            quantityRemaining: 3,
            expiresAt: new Date("2020-01-01Z"),
          },
        });
        const sale = await prisma.sale.create({
          data: {
            tenantId,
            customerId: customer.id,
            soldAt: new Date(),
            status: "COMPLETED",
            totalQuantity: 2,
            totalAmount: 20,
            paidAmount: 20,
            paymentStatus: "PAID",
          },
        });
        await prisma.saleLine.create({
          data: {
            tenantId,
            saleId: sale.id,
            itemType: "SERVICE",
            itemId: service.id,
            itemName: "Facial",
            quantity: 2,
            unitPrice: 10,
            lineTotal: 20,
            position: 0,
          },
        });
        const redemption = await prisma.customerRedemption.create({
          data: {
            tenantId,
            customerId: customer.id,
            saleId: sale.id,
            itemType: "PACKAGE",
            itemId: pkg.id,
            holdingId: holding.id,
            quantity: 2,
            usedAt: new Date(),
          },
        });
        const input = {
          customerId: customer.id,
          serviceId: service.id,
          treatmentType: "Facial",
          status: "COMPLETED" as const,
          quantityConsumed: 0,
          packageRedemptionId: redemption.id,
        };
        const record = await createTreatmentRecord(input);
        assert.equal(record.quantityConsumed, 2);
        assert.equal(record.packageHoldingId, holding.id);
        const historical = await prisma.treatmentRecord.create({
          data: {
            tenantId,
            customerId: customer.id,
            serviceId: service.id,
            treatmentType: "Historical",
            quantityConsumed: 4,
          },
        });
        assert.equal(
          (await updateTreatmentRecord(historical.id, { notes: "Preserve history" }))
            .quantityConsumed,
          4,
        );
        assert.equal(
          (await prisma.customerPackageHolding.findFirstOrThrow({ where: { id: holding.id } }))
            .quantityRemaining,
          3,
        );
        await assert.rejects(createTreatmentRecord(input), code("REDEMPTION_ALREADY_LINKED"));
        await assert.rejects(
          createTreatmentRecord({ ...input, customerId: other.id }),
          code("REDEMPTION_NOT_FOUND"),
        );
        await assert.rejects(
          createTreatmentRecord({ ...input, packageRedemptionId: null, quantityConsumed: 1 }),
          code("REDEMPTION_REQUIRED"),
        );
        await assert.rejects(
          createTreatmentRecord({ ...input, serviceId: undefined }),
          code("REDEMPTION_SERVICE_MISMATCH"),
        );
        await assert.rejects(
          runAsTenant(foreignId, () => createTreatmentRecord(input)),
          code("CUSTOMER_NOT_FOUND"),
        );
        await updateTreatmentRecord(record.id, { status: "CANCELLED", notes: null });
        assert.equal(
          (await prisma.customerPackageHolding.findFirstOrThrow({ where: { id: holding.id } }))
            .quantityRemaining,
          3,
        );
        await updateTreatmentRecord(record.id, { packageRedemptionId: null });
        await assert.rejects(
          createTreatmentRecord({ ...input, quantityConsumed: 1 }),
          code("REDEMPTION_QUANTITY_MISMATCH"),
        );
        const attempts = await Promise.allSettled([
          createTreatmentRecord(input),
          createTreatmentRecord(input),
        ]);
        assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
        const linked = attempts.find((r) => r.status === "fulfilled");
        assert.ok(linked?.status === "fulfilled");
        await prisma.customerRedemption.update({
          where: { id: redemption.id },
          data: { revertedAt: new Date() },
        });
        assert.ok((await getTreatmentRecord(linked.value.id)).packageRedemptionRevertedAt);
        await updateTreatmentRecord(linked.value.id, { notes: "Clinical history retained" });
        await deleteTreatmentRecord(linked.value.id);
        await assert.rejects(createTreatmentRecord(input), code("REDEMPTION_REVERSED"));
        assert.equal(
          (await prisma.customerPackageHolding.findFirstOrThrow({ where: { id: holding.id } }))
            .quantityRemaining,
          3,
        );
      });
    } finally {
      await purge();
      await prisma.$disconnect();
    }
  },
);
