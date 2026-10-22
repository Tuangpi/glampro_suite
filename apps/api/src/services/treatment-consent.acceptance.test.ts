import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

test(
  "treatment consent integrity, publication and HTTP contracts",
  {
    skip: process.env.TREATMENT_CONSENT_ACCEPTANCE !== "1",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55440");
    assert.equal(url.pathname, "/package_expiry_test");
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "isolated-treatment-consent-test-secret";
    const { prisma } = await import("../lib/prisma.js");
    const { runAsPlatform, runAsTenant } = await import("../lib/tenant-context.js");
    const {
      createTreatmentConsentForm,
      recordTreatmentConsentEvent,
      listConsentEvents,
      getTreatmentRecord,
      createTreatmentRecord,
      getActiveConsentForm,
    } = await import("./treatment.service.js");
    const { createApp } = await import("../app.js");
    const { signAccessToken } = await import("../lib/tokens.js");
    const ids = ["treatment-consent-a", "treatment-consent-b"];
    const tenantId = ids[0];
    const foreignId = ids[1];
    const code = (expected: string) => (error: unknown) =>
      !!error && typeof error === "object" && "code" in error && error.code === expected;
    const purge = () =>
      runAsPlatform(() => prisma.tenant.deleteMany({ where: { id: { in: ids } } }));
    let moduleId: string | undefined;
    let originalCore: boolean | undefined;
    try {
      await purge();
      await runAsPlatform(() =>
        prisma.tenant.createMany({ data: ids.map((id) => ({ id, name: id, slug: id })) }),
      );
      const foreign = await runAsTenant(foreignId, async () => {
        const customer = await prisma.customer.create({
          data: { tenantId: foreignId, name: "Foreign" },
        });
        const record = await createTreatmentRecord({
          customerId: customer.id,
          treatmentType: "laser",
          status: "SCHEDULED",
          quantityConsumed: 0,
        });
        const form = await createTreatmentConsentForm({
          treatmentType: "laser",
          title: "Foreign",
          content: "Foreign text",
          version: 1,
          isActive: true,
        });
        return { customer, record, form };
      });
      await runAsTenant(tenantId, async () => {
        const customer = await prisma.customer.create({ data: { tenantId, name: "Customer" } });
        const other = await prisma.customer.create({ data: { tenantId, name: "Other" } });
        const user = await prisma.user.create({
          data: {
            tenantId,
            name: "Consent staff",
            email: "consent@treatment.test",
            passwordHash: "unused",
            globalRole: "STAFF",
          },
        });
        const record = await createTreatmentRecord({
          customerId: customer.id,
          treatmentType: "laser",
          status: "SCHEDULED",
          quantityConsumed: 0,
        });
        const formInput = {
          treatmentType: "laser",
          title: "Original",
          content: "Original text",
          version: 1,
          isActive: true,
        };
        const form = await createTreatmentConsentForm(formInput);
        const input = {
          treatmentRecordId: record.id,
          treatmentConsentFormId: form.id,
          customerId: customer.id,
          consented: true,
        };
        await assert.rejects(
          recordTreatmentConsentEvent({ ...input, customerId: other.id }, user.id),
          code("CONSENT_CUSTOMER_MISMATCH"),
        );
        await assert.rejects(
          recordTreatmentConsentEvent({ ...input, customerId: foreign.customer.id }, user.id),
          code("CUSTOMER_NOT_FOUND"),
        );
        await assert.rejects(
          recordTreatmentConsentEvent({ ...input, treatmentRecordId: foreign.record.id }, user.id),
          code("TREATMENT_NOT_FOUND"),
        );
        await assert.rejects(
          recordTreatmentConsentEvent(
            { ...input, treatmentConsentFormId: foreign.form.id },
            user.id,
          ),
          code("CONSENT_FORM_NOT_FOUND"),
        );
        const unrelated = await createTreatmentConsentForm({ ...formInput, treatmentType: "peel" });
        await assert.rejects(
          recordTreatmentConsentEvent({ ...input, treatmentConsentFormId: unrelated.id }, user.id),
          code("CONSENT_TYPE_MISMATCH"),
        );
        const draft = await createTreatmentConsentForm({ ...formInput, isActive: false });
        await assert.rejects(
          recordTreatmentConsentEvent({ ...input, treatmentConsentFormId: draft.id }, user.id),
          code("CONSENT_FORM_INACTIVE"),
        );
        assert.equal((await getActiveConsentForm("laser"))?.id, form.id);
        const decisions = await Promise.allSettled([
          recordTreatmentConsentEvent(input, user.id),
          recordTreatmentConsentEvent(input, user.id),
        ]);
        assert.equal(decisions.filter((result) => result.status === "fulfilled").length, 1);
        const rejected = decisions.find((result) => result.status === "rejected");
        assert.ok(rejected?.status === "rejected" && code("CONSENT_EVENT_EXISTS")(rejected.reason));
        // Deliberately fail the insert after deactivation; the original active form must survive.
        await assert.rejects(
          createTreatmentConsentForm({ ...formInput, title: undefined } as unknown as Parameters<
            typeof createTreatmentConsentForm
          >[0]),
        );
        assert.equal((await getActiveConsentForm("laser"))?.id, form.id);
        const versions = await Promise.all([
          createTreatmentConsentForm({ ...formInput, title: "Version three" }),
          createTreatmentConsentForm({ ...formInput, title: "Version four" }),
        ]);
        assert.deepEqual(versions.map((row) => row.version).sort(), [3, 4]);
        const firstVersions = await Promise.all([
          createTreatmentConsentForm({ ...formInput, treatmentType: "new type" }),
          createTreatmentConsentForm({ ...formInput, treatmentType: "new type" }),
        ]);
        assert.deepEqual(firstVersions.map((row) => row.version).sort(), [1, 2]);
        // Publication and recording must not deadlock. The decision either
        // precedes deactivation or rejects the stale version.
        const raceRecord = await createTreatmentRecord({
          customerId: customer.id,
          treatmentType: "laser",
          status: "SCHEDULED",
          quantityConsumed: 0,
        });
        const raceForm = await getActiveConsentForm("laser");
        assert.ok(raceForm);
        const race = await Promise.allSettled([
          recordTreatmentConsentEvent(
            { ...input, treatmentRecordId: raceRecord.id, treatmentConsentFormId: raceForm.id },
            user.id,
          ),
          createTreatmentConsentForm({ ...formInput, title: "Race publication" }),
        ]);
        assert.equal(race[1].status, "fulfilled");
        if (race[0].status === "rejected") assert.ok(code("CONSENT_FORM_INACTIVE")(race[0].reason));
        else assert.equal(race[0].value.treatmentConsentFormId, raceForm.id);
        assert.equal(
          await prisma.treatmentConsentForm.count({
            where: { treatmentType: "laser", isActive: true },
          }),
          1,
        );
        const history = await listConsentEvents(record.id);
        assert.equal(history.length, 1);
        assert.equal(history[0].treatmentConsentForm?.content, "Original text");
        assert.equal(history[0].treatmentConsentForm?.version, 1);
        assert.equal(history[0].treatmentConsentForm?.isActive, false);
        assert.deepEqual((await getTreatmentRecord(record.id)).consentEvents, history);
        await assert.rejects(listConsentEvents(foreign.record.id), code("TREATMENT_NOT_FOUND"));
        await assert.rejects(listConsentEvents("missing"), code("TREATMENT_NOT_FOUND"));

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
          id: user.id,
          email: user.email!,
          tenantId,
          globalRole: user.globalRole,
          realm: "web",
          tokenVersion: user.tokenVersion,
        }).token;
        const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
        const server = createApp().listen(0, "127.0.0.1");
        await once(server, "listening");
        try {
          const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/treatments`;
          const forms = `${base}/consent/forms`;
          assert.equal((await fetch(forms)).status, 401);
          assert.equal((await fetch(forms, { headers })).status, 403);
          await prisma.tenantModule.create({ data: { tenantId, moduleId: module.id } });
          for (const query of [
            "isActive=maybe",
            "isActive=true&isActive=false",
            "treatmentType=laser&treatmentType=peel",
          ]) {
            assert.equal((await fetch(`${forms}?${query}`, { headers })).status, 422);
          }
          const activeResponse = await fetch(`${forms}/active/laser`, { headers });
          assert.equal(activeResponse.status, 200);
          const active = ((await activeResponse.json()) as { data: { id: string } }).data;
          assert.equal((await fetch(`${forms}/active/unknown`, { headers })).status, 200);
          assert.equal(
            (await fetch(`${base}/${foreign.record.id}/consent`, { headers })).status,
            404,
          );
          const eventUrl = `${base}/${record.id}/consent`;
          const post = (body: unknown) =>
            fetch(eventUrl, { method: "POST", headers, body: JSON.stringify(body) });
          assert.equal(
            (
              await post({
                ...input,
                treatmentConsentFormId: active.id,
                signatureData: "unsupported",
              })
            ).status,
            422,
          );
          assert.equal(
            (await post({ ...input, treatmentConsentFormId: active.id, customerId: other.id }))
              .status,
            400,
          );
          const decision = { ...input, treatmentConsentFormId: active.id, consented: false };
          const response = await post({
            ...decision,
            consentedById: "spoof",
            treatmentRecordId: foreign.record.id,
          });
          assert.equal(response.status, 201);
          const saved = (
            (await response.json()) as {
              data: {
                consented: boolean;
                consentedById: string;
                treatmentRecordId: string;
                treatmentConsentForm: { id: string; createdAt: string };
              };
            }
          ).data;
          assert.equal(saved.consented, false);
          assert.equal(saved.consentedById, user.id);
          assert.equal(saved.treatmentRecordId, record.id);
          assert.equal(saved.treatmentConsentForm.id, active.id);
          assert.ok(saved.treatmentConsentForm.createdAt.endsWith("Z"));
          assert.equal((await post(decision)).status, 409);
          const actorlessResponse = await fetch(`${base}/${raceRecord.id}/consent`, {
            method: "POST",
            headers,
            body: JSON.stringify({ ...decision, treatmentRecordId: raceRecord.id }),
          });
          assert.equal(actorlessResponse.status, 201);
          assert.equal((await fetch(eventUrl, { headers })).status, 200);
          const detailResponse = await fetch(`${base}/${record.id}`, { headers });
          assert.equal(detailResponse.status, 200);
          assert.equal(
            ((await detailResponse.json()) as { data: { consentEvents: unknown[] } }).data
              .consentEvents.length,
            2,
          );
          await runAsPlatform(() =>
            prisma.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } }),
          );
          assert.equal((await post(decision)).status, 403);
          assert.equal(
            (await fetch(forms, { method: "POST", headers, body: JSON.stringify(formInput) }))
              .status,
            403,
          );
          assert.equal((await fetch(eventUrl, { headers })).status, 200);
        } finally {
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        }
      });
    } finally {
      if (moduleId && originalCore !== undefined) {
        await runAsPlatform(() =>
          prisma.module.update({ where: { id: moduleId }, data: { isCore: originalCore } }),
        );
      }
      await purge();
      await prisma.$disconnect();
    }
  },
);
