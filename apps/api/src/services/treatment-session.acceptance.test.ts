import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

test(
  "treatment links POS sessions without double deduction",
  { skip: process.env.TREATMENT_SESSION_ACCEPTANCE !== "1" },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55440");
    assert.equal(url.pathname, "/package_expiry_test");
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "treatment-selector-isolated-test-secret";
    const { prisma } = await import("../lib/prisma.js");
    const { runAsPlatform, runAsTenant } = await import("../lib/tenant-context.js");
    const {
      createTreatmentRecord,
      updateTreatmentRecord,
      deleteTreatmentRecord,
      getTreatmentRecord,
      listTreatmentRedemptions,
      addTreatmentPhoto,
      removeTreatmentPhoto,
    } = await import("./treatment.service.js");
    const { previewTreatmentDisposal, disposeTreatment } =
      await import("./treatment-disposal.service.js");
    const tenantId = "treatment-session-a";
    const foreignId = "treatment-session-b";
    async function purge() {
      await runAsPlatform(async () => {
        await prisma.auditLog.deleteMany({
          where: { tenantId: { in: [tenantId, foreignId] }, action: "TREATMENT_DISPOSED" },
        });
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
          // Linkage does not require starting treatment; consent gates that separately.
          status: "SCHEDULED" as const,
          quantityConsumed: 0,
          packageRedemptionId: redemption.id,
        };
        const query = { customerId: customer.id, page: 1, pageSize: 1 };
        const options = await listTreatmentRedemptions(query);
        assert.equal(options.total, 1);
        assert.deepEqual(options.data[0], {
          id: redemption.id,
          receiptNumber: null,
          usedAt: redemption.usedAt.toISOString(),
          packageName: "Sessions",
          quantity: 2,
          services: [{ id: service.id, name: "Facial" }],
        });
        assert.equal((await listTreatmentRedemptions({ ...query, customerId: other.id })).total, 0);
        assert.equal(
          (await listTreatmentRedemptions({ ...query, serviceId: "not-covered" })).total,
          0,
        );
        const saleLine = await prisma.saleLine.findFirstOrThrow({ where: { saleId: sale.id } });
        await prisma.saleLine.update({
          where: { id: saleLine.id },
          data: { itemId: "not-covered" },
        });
        assert.equal((await listTreatmentRedemptions(query)).total, 0);
        await prisma.saleLine.update({ where: { id: saleLine.id }, data: { itemId: service.id } });
        await prisma.customerRedemption.update({
          where: { id: redemption.id },
          data: { holdingId: "missing-holding" },
        });
        assert.equal((await listTreatmentRedemptions(query)).total, 0);
        await prisma.customerRedemption.update({
          where: { id: redemption.id },
          data: { holdingId: holding.id },
        });
        await assert.rejects(
          runAsTenant(foreignId, () => listTreatmentRedemptions(query)),
          code("CUSTOMER_NOT_FOUND"),
        );
        const second = await prisma.customerRedemption.create({
          data: {
            tenantId,
            customerId: customer.id,
            saleId: sale.id,
            itemType: "PACKAGE",
            itemId: pkg.id,
            holdingId: holding.id,
            quantity: 1,
            usedAt: new Date(redemption.usedAt.getTime() - 1000),
          },
        });
        assert.equal((await listTreatmentRedemptions(query)).pageCount, 2);
        assert.equal(
          (await listTreatmentRedemptions({ ...query, page: 2 })).data[0]?.id,
          second.id,
        );
        await prisma.customerRedemption.update({
          where: { id: second.id },
          data: { revertedAt: new Date() },
        });
        assert.equal((await listTreatmentRedemptions(query)).total, 1);
        await prisma.sale.update({ where: { id: sale.id }, data: { status: "VOID" } });
        assert.equal((await listTreatmentRedemptions(query)).total, 0);
        await prisma.sale.update({ where: { id: sale.id }, data: { status: "COMPLETED" } });
        // The route is authenticated, entitled, validated and registered before /:id.
        const { createApp } = await import("../app.js");
        const { signAccessToken } = await import("../lib/tokens.js");
        const user = await prisma.user.create({
          data: {
            tenantId,
            name: "Picker staff",
            email: "picker@treatment.test",
            passwordHash: "unused",
            globalRole: "STAFF",
          },
        });
        const module = await runAsPlatform(() =>
          prisma.module.upsert({
            where: { code: "treatments" },
            update: {},
            create: { code: "treatments", name: "Treatments", category: "Add-on", isCore: false },
          }),
        );
        await runAsPlatform(() =>
          prisma.module.update({ where: { id: module.id }, data: { isCore: false } }),
        );
        const token = signAccessToken({
          id: user.id,
          email: user.email!,
          tenantId,
          globalRole: user.globalRole,
          realm: "web",
          tokenVersion: user.tokenVersion,
        }).token;
        const photoRecord = await createTreatmentRecord({
          customerId: customer.id,
          treatmentType: "Photos",
          status: "SCHEDULED",
          quantityConsumed: 0,
        });
        const otherRecord = await createTreatmentRecord({
          customerId: customer.id,
          treatmentType: "Other photos",
          status: "SCHEDULED",
          quantityConsumed: 0,
        });
        const photo = await prisma.customerPhoto.create({
          data: {
            tenantId,
            customerId: customer.id,
            caption: "Before",
            mimeType: "image/png",
            content: Buffer.from("private-image"),
            createdById: user.id,
          },
        });
        const otherPhoto = await prisma.customerPhoto.create({
          data: {
            tenantId,
            customerId: other.id,
            caption: "Other",
            mimeType: "image/png",
            content: Buffer.from("other-private-image"),
            createdById: user.id,
          },
        });
        const photoInput = {
          treatmentRecordId: photoRecord.id,
          customerPhotoId: photo.id,
          photoType: "BEFORE" as const,
        };
        await assert.rejects(
          addTreatmentPhoto({ ...photoInput, customerPhotoId: otherPhoto.id }),
          code("PHOTO_NOT_FOUND"),
        );
        await assert.rejects(
          runAsTenant(foreignId, () => addTreatmentPhoto(photoInput)),
          code("TREATMENT_NOT_FOUND"),
        );
        const photoAttempts = await Promise.allSettled([
          addTreatmentPhoto(photoInput),
          addTreatmentPhoto(photoInput),
        ]);
        assert.equal(photoAttempts.filter((result) => result.status === "fulfilled").length, 1);
        const photoFailure = photoAttempts.find((result) => result.status === "rejected");
        assert.ok(
          photoFailure?.status === "rejected" && code("PHOTO_TYPE_EXISTS")(photoFailure.reason),
        );
        const tagged = (await getTreatmentRecord(photoRecord.id)).photos!;
        assert.equal(tagged.length, 1);
        assert.equal(tagged[0].customerPhotoId, photo.id);
        assert.equal(
          (await updateTreatmentRecord(photoRecord.id, { notes: "Photo follow-up" })).photos
            ?.length,
          1,
        );
        await assert.rejects(
          removeTreatmentPhoto(otherRecord.id, tagged[0].id),
          code("TREATMENT_PHOTO_NOT_FOUND"),
        );
        const server = createApp().listen(0, "127.0.0.1");
        await once(server, "listening");
        try {
          const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/treatments/redemptions`;
          const headers = { Authorization: `Bearer ${token}` };
          assert.equal((await fetch(`${base}?customerId=${customer.id}`)).status, 401);
          assert.equal((await fetch(`${base}?customerId=${customer.id}`, { headers })).status, 403);
          await prisma.tenantModule.create({ data: { tenantId, moduleId: module.id } });
          assert.equal((await fetch(base, { headers })).status, 422);
          assert.equal(
            (await fetch(`${base}?customerId=${customer.id}&page=0`, { headers })).status,
            422,
          );
          const response = await fetch(`${base}?customerId=${customer.id}`, { headers });
          assert.equal(response.status, 200);
          assert.equal(((await response.json()) as { data: { total: number } }).data.total, 1);
          const photoBase = base.replace("/redemptions", `/${photoRecord.id}/photos`);
          const postPhoto = () =>
            fetch(photoBase, {
              method: "POST",
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify({ ...photoInput, photoType: "AFTER" }),
            });
          assert.equal((await fetch(photoBase, { method: "POST" })).status, 401);
          assert.equal((await postPhoto()).status, 201);
          assert.equal((await postPhoto()).status, 409);
          assert.equal((await getTreatmentRecord(photoRecord.id)).photos?.length, 2);
          assert.equal(
            (
              await fetch(photoBase.replace(photoRecord.id, otherRecord.id) + `/${tagged[0].id}`, {
                method: "DELETE",
                headers,
              })
            ).status,
            404,
          );
          await runAsPlatform(() =>
            prisma.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } }),
          );
          assert.equal((await postPhoto()).status, 403);
          assert.equal(
            (await fetch(`${photoBase}/${tagged[0].id}`, { method: "DELETE", headers })).status,
            403,
          );
          await runAsPlatform(() =>
            prisma.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE" } }),
          );
          assert.equal(
            (await fetch(`${photoBase}/${tagged[0].id}`, { method: "DELETE", headers })).status,
            204,
          );
          assert.ok(await prisma.customerPhoto.findFirst({ where: { id: photo.id } }));
          await deleteTreatmentRecord(photoRecord.id);
          assert.ok(await prisma.customerPhoto.findFirst({ where: { id: photo.id } }));
        } finally {
          await runAsPlatform(() =>
            prisma.module.update({ where: { id: module.id }, data: { isCore: module.isCore } }),
          );
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        }
        const record = await createTreatmentRecord(input);
        assert.equal((await listTreatmentRedemptions(query)).total, 0);
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
        const disposalOwner = await prisma.user.create({
          data: {
            tenantId,
            name: "Disposal owner",
            email: "disposal-owner@session.test",
            passwordHash: "unused",
            globalRole: "SUPER_ADMIN",
            twoFactorEnabled: true,
          },
        });
        const disposalPreview = await previewTreatmentDisposal(record.id, disposalOwner.id);
        const saleBefore = await prisma.sale.findFirstOrThrow({ where: { id: sale.id } });
        const redemptionBefore = await prisma.customerRedemption.findFirstOrThrow({
          where: { id: redemption.id },
        });
        const holdingBefore = await prisma.customerPackageHolding.findFirstOrThrow({
          where: { id: holding.id },
        });
        await disposeTreatment(
          record.id,
          {
            previewToken: disposalPreview.previewToken,
            confirmation: "DISPOSE",
            reason: "Clinical retention complete",
          },
          disposalOwner.id,
        );
        assert.deepEqual(
          await prisma.sale.findFirstOrThrow({ where: { id: sale.id } }),
          saleBefore,
        );
        assert.deepEqual(
          await prisma.customerRedemption.findFirstOrThrow({ where: { id: redemption.id } }),
          redemptionBefore,
        );
        assert.deepEqual(
          await prisma.customerPackageHolding.findFirstOrThrow({ where: { id: holding.id } }),
          holdingBefore,
        );
        // Continue ordinary unlink regressions using a replacement scheduled record.
        const replacement = await createTreatmentRecord(input);
        assert.equal(
          (await prisma.customerPackageHolding.findFirstOrThrow({ where: { id: holding.id } }))
            .quantityRemaining,
          3,
        );
        await updateTreatmentRecord(replacement.id, { packageRedemptionId: null });
        assert.equal((await listTreatmentRedemptions(query)).total, 1);
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
