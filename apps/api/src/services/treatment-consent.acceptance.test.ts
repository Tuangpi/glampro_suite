import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { TreatmentConsentEvent } from "@glampro_suite/shared";

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
      deleteTreatmentRecord,
      reviewTreatmentRetention,
    } = await import("./treatment.service.js");
    const { createApp } = await import("../app.js");
    const { signAccessToken } = await import("../lib/tokens.js");
    const ids = ["treatment-consent-a", "treatment-consent-b"];
    const tenantId = ids[0];
    const foreignId = ids[1];
    const code = (expected: string) => (error: unknown) =>
      !!error && typeof error === "object" && "code" in error && error.code === expected;
    // Explicit fixture-only cleanup: production parent deletion must be restricted.
    const purge = () =>
      runAsPlatform(async () => {
        await prisma.treatmentConsentEvent.deleteMany({ where: { tenantId: { in: ids } } });
        await prisma.treatmentRecord.updateMany({
          where: { tenantId: { in: ids } },
          data: { retentionHold: false, retentionHoldReason: null },
        });
        await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
      });
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
        const reviewInput = {
          reviewAt: "2027-01-22T00:00:00.000Z",
          reason: "Continued clinical review",
          hold: true,
          holdReason: "Open dispute",
        };
        const held = await createTreatmentRecord({
          customerId: customer.id,
          treatmentType: "laser",
          status: "SCHEDULED",
          quantityConsumed: 0,
        });
        const reviewed = await reviewTreatmentRetention(held.id, reviewInput, user.id);
        assert.equal(reviewed.retentionHold, true);
        assert.equal(reviewed.retentionReviewAt, reviewInput.reviewAt);
        assert.equal(reviewed.retentionReviewedById, user.id);
        await assert.rejects(deleteTreatmentRecord(held.id), code("TREATMENT_RETENTION_HOLD"));
        await assert.rejects(prisma.treatmentRecord.delete({ where: { id: held.id } }));
        await assert.rejects(prisma.customer.delete({ where: { id: customer.id } }));
        await assert.rejects(
          reviewTreatmentRetention(foreign.record.id, reviewInput, user.id),
          code("TREATMENT_NOT_FOUND"),
        );
        await reviewTreatmentRetention(
          held.id,
          { ...reviewInput, hold: false, holdReason: null },
          user.id,
        );
        await deleteTreatmentRecord(held.id);
        // A successful hold must win against deletion, or review sees a missing record.
        for (let attempt = 0; attempt < 4; attempt++) {
          const competing = await createTreatmentRecord({
            customerId: customer.id,
            treatmentType: "laser",
            status: "SCHEDULED",
            quantityConsumed: 0,
          });
          const outcomes = await Promise.allSettled([
            reviewTreatmentRetention(competing.id, reviewInput, user.id),
            deleteTreatmentRecord(competing.id),
          ]);
          if (outcomes[0].status === "fulfilled") {
            assert.equal(outcomes[1].status, "rejected");
            if (outcomes[1].status === "rejected")
              assert.ok(code("TREATMENT_RETENTION_HOLD")(outcomes[1].reason));
            assert.equal((await getTreatmentRecord(competing.id)).retentionHold, true);
            await reviewTreatmentRetention(
              competing.id,
              { ...reviewInput, hold: false, holdReason: null },
              user.id,
            );
            await deleteTreatmentRecord(competing.id);
          } else {
            assert.ok(code("TREATMENT_NOT_FOUND")(outcomes[0].reason));
            assert.equal(outcomes[1].status, "fulfilled");
          }
        }
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
        const grant = (await listConsentEvents(record.id))[0]!;
        const withdrawalInput = {
          ...input,
          previousEventId: grant.id,
          eventType: "WITHDRAWAL" as const,
          consented: false,
        };
        const withdrawals = await Promise.allSettled([
          recordTreatmentConsentEvent(withdrawalInput, user.id),
          recordTreatmentConsentEvent(withdrawalInput, user.id),
        ]);
        assert.equal(withdrawals.filter((result) => result.status === "fulfilled").length, 1);
        const withdrawal = (await listConsentEvents(record.id))[0]!;
        assert.equal(withdrawal.eventType, "WITHDRAWAL");
        await assert.rejects(
          recordTreatmentConsentEvent(
            { ...withdrawalInput, previousEventId: withdrawal.id },
            user.id,
          ),
          code("CONSENT_TRANSITION_INVALID"),
        );
        const correctionInput = {
          ...input,
          consented: false,
          eventType: "CORRECTION" as const,
          previousEventId: withdrawal.id,
          correctsEventId: grant.id,
          reason: "Witness annotation; original preserved",
        };
        await assert.rejects(recordTreatmentConsentEvent(correctionInput, user.id));
        await prisma.user.update({ where: { id: user.id }, data: { globalRole: "MANAGER" } });
        await assert.rejects(
          recordTreatmentConsentEvent(
            { ...correctionInput, correctsEventId: foreign.form.id },
            user.id,
          ),
        );
        await assert.rejects(
          recordTreatmentConsentEvent({ ...correctionInput, reason: " " }, user.id),
        );
        await assert.rejects(
          recordTreatmentConsentEvent({ ...correctionInput, consented: true }, user.id),
        );
        const correction = await recordTreatmentConsentEvent(correctionInput, user.id);
        assert.equal(correction.correctsEventId, grant.id);
        await assert.rejects(
          prisma.treatmentConsentEvent.update({
            where: { id: grant.id },
            data: { consented: false },
          }),
        );
        await assert.rejects(
          prisma.treatmentConsentForm.update({
            where: { id: form.id },
            data: { content: "Rewritten" },
          }),
        );
        await assert.rejects(
          prisma.treatmentConsentForm.update({
            where: { id: form.id },
            data: { signatureRequired: true },
          }),
        );
        const reconsent = await recordTreatmentConsentEvent(
          { ...input, previousEventId: correction.id, eventType: "RECONSENT" },
          user.id,
        );
        assert.equal(reconsent.eventType, "RECONSENT");
        assert.equal(
          (await listConsentEvents(record.id)).find((event) => event.id === grant.id)?.consented,
          true,
        );
        await prisma.user.update({ where: { id: user.id }, data: { globalRole: "STAFF" } });

        const signedForm = await createTreatmentConsentForm({
          ...formInput,
          treatmentType: "signed",
          signatureRequired: true,
        });
        const signedRecord = await createTreatmentRecord({
          customerId: customer.id,
          treatmentType: "signed",
          status: "SCHEDULED",
          quantityConsumed: 0,
        });
        const signedInput = {
          ...input,
          treatmentRecordId: signedRecord.id,
          treatmentConsentFormId: signedForm.id,
        };
        await assert.rejects(
          recordTreatmentConsentEvent(signedInput, user.id),
          code("CONSENT_SIGNATURE_REQUIRED"),
        );
        await assert.rejects(
          recordTreatmentConsentEvent({ ...signedInput, signatureData: "<svg/>" }, user.id),
        );
        const signatureData = JSON.stringify({
          strokes: [
            [
              { x: 10, y: 10 },
              { x: 50, y: 30 },
            ],
          ],
        });
        const signed = await recordTreatmentConsentEvent(
          { ...signedInput, signatureData },
          user.id,
        );
        assert.equal(signed.signatureData, signatureData);
        assert.equal(signed.treatmentConsentForm?.signatureRequired, true);
        const signedWithdrawal = await recordTreatmentConsentEvent(
          { ...signedInput, consented: false, eventType: "WITHDRAWAL", previousEventId: signed.id },
          user.id,
        );
        await assert.rejects(
          recordTreatmentConsentEvent(
            { ...signedInput, eventType: "RECONSENT", previousEventId: signedWithdrawal.id },
            user.id,
          ),
          code("CONSENT_SIGNATURE_REQUIRED"),
        );
        const resigned = await recordTreatmentConsentEvent(
          {
            ...signedInput,
            eventType: "RECONSENT",
            previousEventId: signedWithdrawal.id,
            signatureData,
          },
          user.id,
        );
        await createTreatmentConsentForm({
          ...formInput,
          treatmentType: "signed",
          signatureRequired: false,
        });
        const inactiveWithdrawal = await recordTreatmentConsentEvent(
          {
            ...signedInput,
            consented: false,
            eventType: "WITHDRAWAL",
            previousEventId: resigned.id,
          },
          user.id,
        );
        assert.equal(inactiveWithdrawal.eventType, "WITHDRAWAL");
        await assert.rejects(
          recordTreatmentConsentEvent(
            {
              ...signedInput,
              eventType: "RECONSENT",
              previousEventId: inactiveWithdrawal.id,
              signatureData,
            },
            user.id,
          ),
          code("CONSENT_FORM_INACTIVE"),
        );
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
        assert.equal(history.length, 4);
        assert.equal(history[0].treatmentConsentForm?.content, "Original text");
        assert.equal(history[0].treatmentConsentForm?.version, 1);
        assert.equal(history[0].treatmentConsentForm?.isActive, false);
        assert.deepEqual((await getTreatmentRecord(record.id)).consentEvents, history);
        await assert.rejects(listConsentEvents(foreign.record.id), code("TREATMENT_NOT_FOUND"));
        await assert.rejects(listConsentEvents("missing"), code("TREATMENT_NOT_FOUND"));
        await assert.rejects(
          deleteTreatmentRecord(record.id),
          code("TREATMENT_HAS_CONSENT_EVIDENCE"),
        );
        assert.deepEqual(await listConsentEvents(record.id), history);
        await assert.rejects(deleteTreatmentRecord(foreign.record.id), code("TREATMENT_NOT_FOUND"));
        await assert.rejects(deleteTreatmentRecord("missing"), code("TREATMENT_NOT_FOUND"));

        // Capture and deletion share a treatment-row lock. No successful capture
        // may be followed by a successful deletion, regardless of who wins.
        const currentForm = await getActiveConsentForm("laser");
        assert.ok(currentForm);
        for (const consented of [true, false, true, false]) {
          const competingRecord = await createTreatmentRecord({
            customerId: customer.id,
            treatmentType: "laser",
            status: "SCHEDULED",
            quantityConsumed: 0,
          });
          const outcomes: [
            PromiseSettledResult<TreatmentConsentEvent>,
            PromiseSettledResult<void>,
          ] = await Promise.allSettled([
            recordTreatmentConsentEvent(
              {
                ...input,
                treatmentRecordId: competingRecord.id,
                treatmentConsentFormId: currentForm.id,
                consented,
              },
              user.id,
            ),
            deleteTreatmentRecord(competingRecord.id),
          ]);
          if (outcomes[0].status === "fulfilled") {
            assert.equal(outcomes[1].status, "rejected");
            if (outcomes[1].status === "rejected")
              assert.ok(code("TREATMENT_HAS_CONSENT_EVIDENCE")(outcomes[1].reason));
            assert.equal((await listConsentEvents(competingRecord.id))[0].consented, consented);
          } else {
            assert.ok(code("TREATMENT_NOT_FOUND")(outcomes[0].reason));
            assert.equal(outcomes[1].status, "fulfilled");
            assert.equal(
              await prisma.treatmentRecord.findFirst({ where: { id: competingRecord.id } }),
              null,
            );
          }
        }

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
          const reviewUrl = `${base}/${record.id}/retention-review`;
          const review = (body: unknown = reviewInput) =>
            fetch(reviewUrl, {
              method: "POST",
              headers,
              body: JSON.stringify(body),
            });
          const customerBase = base.replace(/\/treatments$/, "/customers");
          const archive = () =>
            fetch(`${customerBase}/${customer.id}/archive`, {
              method: "POST",
              headers,
              body: JSON.stringify({ reason: "No further visits planned" }),
            });
          assert.equal((await review()).status, 403);
          assert.equal((await archive()).status, 403);
          const publish = () =>
            fetch(forms, {
              method: "POST",
              headers,
              body: JSON.stringify({ ...formInput, treatmentType: "role-policy" }),
            });
          assert.equal((await publish()).status, 403);
          const annotate = () =>
            fetch(`${base}/${record.id}/consent`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                ...input,
                eventType: "CORRECTION",
                previousEventId: reconsent.id,
                correctsEventId: grant.id,
                reason: "HTTP annotation",
              }),
            });
          assert.equal((await annotate()).status, 403);
          assert.equal(
            await prisma.treatmentConsentForm.count({ where: { treatmentType: "role-policy" } }),
            0,
          );
          // Authorization uses the current database role, not the role in the token.
          for (const globalRole of ["MANAGER", "SUPER_ADMIN"] as const) {
            await prisma.user.update({
              where: { id: user.id },
              data: { globalRole, twoFactorEnabled: true },
            });
            assert.equal((await publish()).status, 201);
            assert.equal((await review()).status, 200);
            assert.equal((await review({ ...reviewInput, holdReason: null })).status, 422);
            assert.equal(
              (
                await fetch(`${base}/${foreign.record.id}/retention-review`, {
                  method: "POST",
                  headers,
                  body: JSON.stringify(reviewInput),
                })
              ).status,
              404,
            );
          }
          await prisma.user.update({ where: { id: user.id }, data: { globalRole: "STAFF" } });
          assert.equal((await review()).status, 403);
          await reviewTreatmentRetention(
            record.id,
            { ...reviewInput, hold: false, holdReason: null },
            user.id,
          );
          assert.equal((await publish()).status, 403);
          assert.equal(
            await prisma.treatmentConsentForm.count({ where: { treatmentType: "role-policy" } }),
            2,
          );
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
          await runAsPlatform(() =>
            prisma.tenant.update({
              where: { id: tenantId },
              data: { status: "CANCELLED" },
            }),
          );
          assert.equal((await fetch(eventUrl, { headers })).status, 403);
          assert.equal((await listConsentEvents(record.id)).length, 5);
          await runAsPlatform(() =>
            prisma.tenant.update({
              where: { id: tenantId },
              data: { status: "ACTIVE" },
            }),
          );
          const protectedDelete = await fetch(`${base}/${record.id}`, {
            method: "DELETE",
            headers,
          });
          assert.equal(protectedDelete.status, 409);
          assert.equal(
            ((await protectedDelete.json()) as { code: string }).code,
            "TREATMENT_HAS_CONSENT_EVIDENCE",
          );
          assert.equal((await listConsentEvents(record.id)).length, 5);
          // Declines are evidence too, independently of grants.
          const declinedRecord = await createTreatmentRecord({
            customerId: customer.id,
            treatmentType: "laser",
            status: "SCHEDULED",
            quantityConsumed: 0,
          });
          await recordTreatmentConsentEvent(
            { ...decision, treatmentRecordId: declinedRecord.id },
            user.id,
          );
          assert.equal(
            (await fetch(`${base}/${declinedRecord.id}`, { method: "DELETE", headers })).status,
            409,
          );
          assert.equal((await listConsentEvents(declinedRecord.id)).length, 1);
          assert.equal((await listConsentEvents(declinedRecord.id))[0].consented, false);
          const unprotected = await createTreatmentRecord({
            customerId: customer.id,
            treatmentType: "laser",
            status: "SCHEDULED",
            quantityConsumed: 0,
          });
          assert.equal(
            (await fetch(`${base}/${unprotected.id}`, { method: "DELETE" })).status,
            401,
          );
          assert.equal(
            (await fetch(`${base}/${foreign.record.id}`, { method: "DELETE", headers })).status,
            404,
          );
          assert.equal(
            (await fetch(`${base}/${unprotected.id}`, { method: "DELETE", headers })).status,
            204,
          );
          assert.equal(
            (await fetch(`${base}/${unprotected.id}`, { method: "DELETE", headers })).status,
            404,
          );
          const detailResponse = await fetch(`${base}/${record.id}`, { headers });
          assert.equal(detailResponse.status, 200);
          assert.equal(
            ((await detailResponse.json()) as { data: { consentEvents: unknown[] } }).data
              .consentEvents.length,
            5,
          );
          // Evidence prevents every direct parent deletion, not only API treatment deletion.
          await assert.rejects(
            prisma.customer.delete({ where: { id: customer.id } }),
            code("P2003"),
          );
          await assert.rejects(
            prisma.treatmentConsentForm.delete({ where: { id: form.id } }),
            code("P2003"),
          );
          await assert.rejects(
            runAsPlatform(() => prisma.tenant.delete({ where: { id: tenantId } })),
            code("P2003"),
          );
          await prisma.user.update({ where: { id: user.id }, data: { globalRole: "MANAGER" } });
          const archived = await archive();
          assert.equal(archived.status, 200);
          const archiveData = (
            (await archived.json()) as {
              data: { archivedAt: string; archivedById: string; archiveReason: string };
            }
          ).data;
          assert.ok(archiveData.archivedAt);
          assert.equal(archiveData.archivedById, user.id);
          assert.equal((await archive()).status, 200);
          assert.equal((await listConsentEvents(record.id)).length, 5);
          const { listCustomers } = await import("./customer.service.js");
          assert.equal(
            (await listCustomers({ page: 1, pageSize: 100 })).data.some(
              (row) => row.id === customer.id,
            ),
            false,
          );
          assert.equal(
            (await listCustomers({ page: 1, pageSize: 100, includeArchived: true })).data.some(
              (row) => row.id === customer.id,
            ),
            true,
          );
          await runAsPlatform(() =>
            prisma.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } }),
          );
          assert.equal((await post(decision)).status, 403);
          assert.equal((await review()).status, 403);
          assert.equal((await archive()).status, 403);
          assert.equal(
            (await fetch(`${base}/${record.id}`, { method: "DELETE", headers })).status,
            403,
          );
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
