import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import jwt from "jsonwebtoken";

test(
  "owner-authorized disposal is scoped, stale-safe, audited and atomic",
  { skip: process.env.TREATMENT_DISPOSAL_ACCEPTANCE !== "1" },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55440");
    assert.equal(url.pathname, "/package_expiry_test");
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "isolated-treatment-disposal-secret";
    const { prisma } = await import("../lib/prisma.js");
    const { env } = await import("../lib/env.js");
    const { runAsPlatform, runAsTenant } = await import("../lib/tenant-context.js");
    const { previewTreatmentDisposal, disposeTreatment } =
      await import("./treatment-disposal.service.js");
    const {
      createTreatmentRecord,
      recordTreatmentConsentEvent,
      createTreatmentConsentForm,
      updateTreatmentRecord,
      reviewTreatmentRetention,
      addTreatmentPhoto,
      deleteTreatmentRecord,
    } = await import("./treatment.service.js");
    const { createApp } = await import("../app.js");
    const { signAccessToken } = await import("../lib/tokens.js");
    const ids = ["treatment-disposal-a", "treatment-disposal-b"];
    const tenantId = ids[0];
    const code = (expected: string) => (error: unknown) =>
      !!error && typeof error === "object" && "code" in error && error.code === expected;
    const purge = () =>
      runAsPlatform(async () => {
        await prisma.treatmentConsentEvent.deleteMany({ where: { tenantId: { in: ids } } });
        await prisma.treatmentRecord.updateMany({
          where: { tenantId: { in: ids } },
          data: { retentionHold: false, retentionHoldReason: null },
        });
        await prisma.auditLog.deleteMany({
          where: { tenantId: { in: ids }, action: "TREATMENT_DISPOSED" },
        });
        await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
      });
    let moduleId: string | undefined;
    let originalCore = false;
    try {
      await purge();
      await runAsPlatform(() =>
        prisma.tenant.createMany({ data: ids.map((id) => ({ id, name: id, slug: id })) }),
      );
      await runAsTenant(tenantId, async () => {
        const customer = await prisma.customer.create({
          data: { tenantId, name: "Disposal fixture customer" },
        });
        const owner = await prisma.user.create({
          data: {
            tenantId,
            name: "Owner",
            email: "owner@disposal.test",
            passwordHash: "unused",
            globalRole: "SUPER_ADMIN",
            twoFactorEnabled: true,
          },
        });
        const staff = await prisma.user.create({
          data: {
            tenantId,
            name: "Manager",
            email: "manager@disposal.test",
            passwordHash: "unused",
            globalRole: "MANAGER",
          },
        });
        const input = {
          customerId: customer.id,
          treatmentType: "Disposal",
          status: "CANCELLED" as const,
          quantityConsumed: 0,
        };
        const form = await createTreatmentConsentForm({
          treatmentType: input.treatmentType,
          title: "Private form",
          content: "Original wording",
          isActive: true,
          version: 1,
        });
        const record = await createTreatmentRecord({ ...input, notes: "PRIVATE CLINICAL NOTES" });
        const consent = {
          treatmentRecordId: record.id,
          customerId: customer.id,
          treatmentConsentFormId: form.id,
          consented: true,
        };
        const signatureData = JSON.stringify({
          strokes: [
            [
              { x: 0, y: 0 },
              { x: 20, y: 20 },
            ],
          ],
        });
        const grant = await recordTreatmentConsentEvent({ ...consent, signatureData }, staff.id);
        const withdrawal = await recordTreatmentConsentEvent(
          { ...consent, consented: false, eventType: "WITHDRAWAL", previousEventId: grant.id },
          staff.id,
        );
        await recordTreatmentConsentEvent(
          { ...consent, eventType: "RECONSENT", previousEventId: withdrawal.id },
          staff.id,
        );
        const photo = await prisma.customerPhoto.create({
          data: {
            tenantId,
            customerId: customer.id,
            caption: "Original gallery image",
            mimeType: "image/png",
            content: Buffer.from("original-photo-bytes"),
            createdById: owner.id,
          },
        });
        await addTreatmentPhoto({
          treatmentRecordId: record.id,
          customerPhotoId: photo.id,
          photoType: "BEFORE",
        });
        const otherRecord = await createTreatmentRecord(input);
        await addTreatmentPhoto({
          treatmentRecordId: otherRecord.id,
          customerPhotoId: photo.id,
          photoType: "BEFORE",
        });
        await assert.rejects(
          deleteTreatmentRecord(record.id),
          code("TREATMENT_HAS_CONSENT_EVIDENCE"),
        );
        const initial = await previewTreatmentDisposal(record.id, owner.id);
        assert.equal(initial.consentEvents, 3);
        assert.equal(initial.signatures, 1);
        assert.equal(initial.photoLinks, 1);
        assert.equal(
          await prisma.auditLog.count({ where: { tenantId, action: "TREATMENT_DISPOSED" } }),
          0,
        );
        const approval = (previewToken: string) => ({
          previewToken,
          reason: "Retention no longer needed",
          confirmation: "DISPOSE" as const,
        });
        await assert.rejects(previewTreatmentDisposal(record.id, staff.id));
        await prisma.user.update({ where: { id: owner.id }, data: { globalRole: "MANAGER" } });
        await assert.rejects(disposeTreatment(record.id, approval(initial.previewToken), owner.id));
        await prisma.user.update({ where: { id: owner.id }, data: { globalRole: "SUPER_ADMIN" } });
        await updateTreatmentRecord(record.id, { notes: "Changed private notes" });
        await assert.rejects(
          disposeTreatment(record.id, approval(initial.previewToken), owner.id),
          code("TREATMENT_DISPOSAL_STALE"),
        );
        const current = await previewTreatmentDisposal(record.id, owner.id);
        await assert.rejects(
          disposeTreatment(otherRecord.id, approval(current.previewToken), owner.id),
          code("TREATMENT_DISPOSAL_STALE"),
        );
        await assert.rejects(
          disposeTreatment(record.id, approval(current.previewToken + "tampered"), owner.id),
          code("TREATMENT_DISPOSAL_STALE"),
        );
        const claims = jwt.decode(current.previewToken) as jwt.JwtPayload;
        const expired = jwt.sign(
          { ...claims, exp: Math.floor(Date.now() / 1000) - 1 },
          env.jwtSecret,
          { algorithm: "HS256" },
        );
        await assert.rejects(
          disposeTreatment(record.id, approval(expired), owner.id),
          code("TREATMENT_DISPOSAL_STALE"),
        );
        const review = {
          reviewAt: "2027-01-01T00:00:00.000Z",
          reason: "Documented review",
          hold: true,
          holdReason: "Dispute",
        };
        await reviewTreatmentRetention(record.id, review, owner.id);
        await assert.rejects(
          disposeTreatment(record.id, approval(current.previewToken), owner.id),
          code("TREATMENT_RETENTION_HOLD"),
        );
        await reviewTreatmentRetention(
          record.id,
          { ...review, hold: false, holdReason: null },
          owner.id,
        );
        const scheduled = await createTreatmentRecord({ ...input, status: "SCHEDULED" });
        await assert.rejects(
          previewTreatmentDisposal(scheduled.id, owner.id),
          code("TREATMENT_DISPOSAL_STATUS"),
        );
        await runAsTenant(ids[1], async () => {
          const foreignOwner = await prisma.user.create({
            data: {
              tenantId: ids[1],
              name: "Foreign owner",
              email: "foreign@disposal.test",
              passwordHash: "unused",
              globalRole: "SUPER_ADMIN",
              twoFactorEnabled: true,
            },
          });
          await assert.rejects(
            previewTreatmentDisposal(record.id, foreignOwner.id),
            code("TREATMENT_NOT_FOUND"),
          );
          await assert.rejects(
            disposeTreatment(record.id, approval(current.previewToken), foreignOwner.id),
            code("TREATMENT_DISPOSAL_STALE"),
          );
        });
        const module = await runAsPlatform(() =>
          prisma.module.upsert({
            where: { code: "treatments" },
            update: {},
            create: { code: "treatments", name: "Treatments", category: "Add-on", isCore: false },
          }),
        );
        moduleId = module.id;
        originalCore = module.isCore;
        await runAsPlatform(() =>
          prisma.module.update({ where: { id: module.id }, data: { isCore: false } }),
        );
        const token = signAccessToken({
          id: owner.id,
          email: owner.email!,
          tenantId,
          globalRole: "SUPER_ADMIN",
          realm: "web",
          tokenVersion: owner.tokenVersion,
        }).token;
        const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
        const server = createApp().listen(0, "127.0.0.1");
        await once(server, "listening");
        try {
          const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/treatments/${record.id}`;
          assert.equal((await fetch(`${base}/disposal-preview`)).status, 401);
          assert.equal((await fetch(`${base}/disposal-preview`, { headers })).status, 403);
          await prisma.tenantModule.create({ data: { tenantId, moduleId: module.id } });
          const response = await fetch(`${base}/disposal-preview`, { headers });
          assert.equal(response.status, 200);
          const fresh = (await response.json()).data;
          const post = (body: unknown) =>
            fetch(`${base}/dispose`, { method: "POST", headers, body: JSON.stringify(body) });
          assert.equal(
            (await post({ ...approval(fresh.previewToken), confirmation: "wrong" })).status,
            422,
          );
          assert.equal((await post({ ...approval(fresh.previewToken), reason: " " })).status, 422);
          assert.equal(
            (await post({ ...approval(fresh.previewToken), actorId: staff.id })).status,
            422,
          );
          await runAsPlatform(() =>
            prisma.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } }),
          );
          assert.equal((await post(approval(fresh.previewToken))).status, 403);
          await assert.rejects(disposeTreatment(record.id, approval(fresh.previewToken), owner.id));
          await runAsPlatform(() =>
            prisma.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE" } }),
          );
          await prisma.user.update({ where: { id: owner.id }, data: { globalRole: "MANAGER" } });
          assert.equal((await post(approval(fresh.previewToken))).status, 403);
          await prisma.user.update({
            where: { id: owner.id },
            data: { globalRole: "SUPER_ADMIN" },
          });
          // Disposable-only fault injection proves an audit failure rolls back
          // treatment, consent chain and photo-link deletion together.
          await prisma.$executeRawUnsafe(
            `CREATE FUNCTION disposal_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId" = 'treatment-disposal-a' AND NEW.action = 'TREATMENT_DISPOSED' THEN RAISE EXCEPTION 'Injected disposal audit failure'; END IF; RETURN NEW; END; $$`,
          );
          try {
            await prisma.$executeRawUnsafe(
              `CREATE TRIGGER disposal_test_reject_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION disposal_test_reject_audit()`,
            );
            await assert.rejects(
              disposeTreatment(record.id, approval(fresh.previewToken), owner.id),
            );
            assert.equal(await prisma.treatmentRecord.count({ where: { id: record.id } }), 1);
            assert.equal(
              await prisma.treatmentConsentEvent.count({ where: { treatmentRecordId: record.id } }),
              3,
            );
            assert.equal(
              await prisma.treatmentPhoto.count({ where: { treatmentRecordId: record.id } }),
              1,
            );
          } finally {
            await prisma.$executeRawUnsafe(
              `DROP TRIGGER IF EXISTS disposal_test_reject_audit ON audit_logs`,
            );
            await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS disposal_test_reject_audit()`);
          }
          const disposed = await post(approval(fresh.previewToken));
          assert.equal(disposed.status, 200);
          const receipt = (await disposed.json()).data;
          assert.ok(receipt.receiptId);
          assert.equal(receipt.treatmentRecordId, record.id);
          assert.equal(await prisma.treatmentRecord.count({ where: { id: record.id } }), 0);
          assert.equal(
            await prisma.treatmentConsentEvent.count({ where: { treatmentRecordId: record.id } }),
            0,
          );
          assert.equal(
            await prisma.treatmentPhoto.count({ where: { treatmentRecordId: record.id } }),
            0,
          );
          assert.equal(await prisma.customer.count({ where: { id: customer.id } }), 1);
          assert.equal(await prisma.customerPhoto.count({ where: { id: photo.id } }), 1);
          assert.equal(
            await prisma.treatmentPhoto.count({ where: { treatmentRecordId: otherRecord.id } }),
            1,
          );
          assert.equal(await prisma.treatmentConsentForm.count({ where: { id: form.id } }), 1);
          const audit = await prisma.auditLog.findFirstOrThrow({
            where: { id: receipt.receiptId, tenantId },
          });
          assert.deepEqual(audit.metadata, {
            actorUserId: owner.id,
            reason: "Retention no longer needed",
            consentEvents: 3,
            signatures: 1,
            photoLinks: 1,
          });
          assert.ok(!JSON.stringify(audit).includes("PRIVATE CLINICAL"));
          assert.ok(!JSON.stringify(audit).includes(signatureData));
          assert.equal((await post(approval(fresh.previewToken))).status, 404);
          assert.equal(
            await prisma.auditLog.count({
              where: { tenantId, action: "TREATMENT_DISPOSED", targetId: record.id },
            }),
            1,
          );
        } finally {
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        }
        const changedEvidence = await createTreatmentRecord(input);
        const beforeEvidence = await previewTreatmentDisposal(changedEvidence.id, owner.id);
        await recordTreatmentConsentEvent(
          { ...consent, treatmentRecordId: changedEvidence.id },
          staff.id,
        );
        await assert.rejects(
          disposeTreatment(changedEvidence.id, approval(beforeEvidence.previewToken), owner.id),
          code("TREATMENT_DISPOSAL_STALE"),
        );
        const beforePhoto = await previewTreatmentDisposal(changedEvidence.id, owner.id);
        await addTreatmentPhoto({
          treatmentRecordId: changedEvidence.id,
          customerPhotoId: photo.id,
          photoType: "AFTER",
        });
        await assert.rejects(
          disposeTreatment(changedEvidence.id, approval(beforePhoto.previewToken), owner.id),
          code("TREATMENT_DISPOSAL_STALE"),
        );
        const duplicate = await createTreatmentRecord(input);
        const duplicatePreview = await previewTreatmentDisposal(duplicate.id, owner.id);
        const duplicates = await Promise.allSettled([
          disposeTreatment(duplicate.id, approval(duplicatePreview.previewToken), owner.id),
          disposeTreatment(duplicate.id, approval(duplicatePreview.previewToken), owner.id),
        ]);
        assert.equal(duplicates.filter((result) => result.status === "fulfilled").length, 1);
        assert.equal(
          await prisma.auditLog.count({
            where: { tenantId, targetId: duplicate.id, action: "TREATMENT_DISPOSED" },
          }),
          1,
        );
        // Concurrent holds/disposal cannot both succeed; denied disposal leaves evidence.
        for (let index = 0; index < 4; index++) {
          const race = await createTreatmentRecord(input);
          const preview = await previewTreatmentDisposal(race.id, owner.id);
          const results = await Promise.allSettled([
            disposeTreatment(race.id, approval(preview.previewToken), owner.id),
            reviewTreatmentRetention(race.id, review, owner.id),
          ]);
          assert.notEqual(results[0].status, results[1].status);
          if (results[1].status === "fulfilled") {
            assert.equal(
              await prisma.treatmentRecord.count({ where: { id: race.id, retentionHold: true } }),
              1,
            );
            assert.equal(
              await prisma.auditLog.count({ where: { tenantId, targetId: race.id } }),
              0,
            );
          }
        }
      });
    } finally {
      if (moduleId)
        await runAsPlatform(() =>
          prisma.module.update({ where: { id: moduleId }, data: { isCore: originalCore } }),
        );
      await purge();
      await prisma.$disconnect();
    }
  },
);
