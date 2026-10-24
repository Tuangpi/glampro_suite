import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import {
  saveAssistantDraft,
  actOnAssistantDraft,
  listAssistantDrafts,
  assistantDraftHistory,
  reviewAssistantDraft,
} from "./assistant-drafts.service.js";
import { runMessageBatch } from "./message-worker.js";
import { retryMessage } from "./messaging.service.js";
import type { ProviderInput } from "../lib/messaging-provider.js";

test(
  "OA-05 disposable approval, version, quota and dispatch acceptance",
  { skip: process.env.RUN_OA05_ACCEPTANCE !== "true" },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55443");
    assert.equal(url.pathname, "/oa05_acceptance");
    const tenantId = "oa05-salon";
    const actorId = "oa05-manager";
    const scoped = <T>(fn: () => T) => runAsTenant(tenantId, fn, actorId);
    process.env.MESSAGING_ENABLED = "true";
    process.env.MESSAGING_PUBLIC_ORIGIN = "https://salon.example.test";
    process.env.MESSAGING_TENANTS_JSON = JSON.stringify({
      [tenantId]: { accountSid: "ACfake", authToken: "fake", smsFrom: "TestSalon" },
    });
    try {
      await runAsPlatform(async () => {
        await prisma.tenant.create({
          data: { id: tenantId, slug: tenantId, name: "Test salon", timeZone: "UTC" },
        });
        await prisma.tenant.create({
          data: { id: "oa05-other", slug: "oa05-other", name: "Other" },
        });
        for (const code of ["dashboard", "customers", "appointments"])
          await prisma.module.upsert({
            where: { code },
            update: { isCore: true },
            create: { code, name: code, category: "Core", isCore: true },
          });
      });
      await scoped(async () => {
        await prisma.user.create({
          data: {
            id: actorId,
            tenantId,
            name: "Manager",
            email: "manager@oa05.example.test",
            passwordHash: "unused",
            globalRole: "MANAGER",
          },
        });
        const h = new Date().getUTCHours();
        await prisma.messagingSettings.create({
          data: { tenantId, smsEnabled: true, quietStart: (h + 1) % 24, quietEnd: (h + 2) % 24 },
        });
        const service = await prisma.service.create({
          data: { tenantId, name: "Service", memberPrice: 10, nonmemberPrice: 10, interval: 28 },
        });
        async function input(index: number) {
          const customer = await prisma.customer.create({
            data: {
              tenantId,
              name: `Customer ${index}`,
              phone: `+659123${String(index).padStart(4, "0")}`,
              pdpaConsent: true,
              marketingOptIn: true,
            },
          });
          await prisma.channelConsent.create({
            data: {
              tenantId,
              customerId: customer.id,
              channel: "SMS",
              destination: customer.phone!,
              marketing: true,
              preferred: true,
            },
          });
          const visit = await prisma.appointment.create({
            data: {
              tenantId,
              customerId: customer.id,
              serviceId: service.id,
              startsAt: new Date(Date.now() - 60 * 86400000),
              endsAt: new Date(Date.now() - 60 * 86400000 + 3600000),
              status: "COMPLETED",
            },
          });
          return {
            customerId: customer.id,
            appointmentId: visit.id,
            channel: "SMS" as const,
            destination: customer.phone!,
            message: "Ready for another visit?",
          };
        }
        const first = await input(1);
        const draft = await saveAssistantDraft(first);
        await assert.rejects(actOnAssistantDraft(draft.id, 1, "queue"));
        await actOnAssistantDraft(draft.id, 1, "approve");
        const edits = await Promise.allSettled([
          saveAssistantDraft({ ...first, message: "Edited message" }, draft.id, 1),
          saveAssistantDraft(first, draft.id, 1),
        ]);
        assert.equal(edits.filter((r) => r.status === "fulfilled").length, 1);
        await assert.rejects(actOnAssistantDraft(draft.id, 1, "approve"));
        await assert.rejects(actOnAssistantDraft(draft.id, 2, "queue"));
        await actOnAssistantDraft(draft.id, 2, "approve");
        await Promise.all([
          actOnAssistantDraft(draft.id, 2, "queue"),
          actOnAssistantDraft(draft.id, 2, "queue"),
        ]);
        assert.equal(await prisma.messageJob.count({ where: { assistantDraftId: draft.id } }), 1);
        const saved = await prisma.assistantDraft.findFirstOrThrow({ where: { id: draft.id } });
        const payloads: ProviderInput[] = [];
        await runMessageBatch(async (payload) => {
          payloads.push(payload);
          return "SMaccepted";
        });
        assert.equal(payloads.length, 1);
        assert.equal(payloads[0]!.text, saved.body);
        assert.equal(payloads[0]!.destination, first.destination);
        assert.equal(payloads[0]!.config.smsFrom, saved.sender);
        const accepted = await prisma.messageJob.findFirstOrThrow({
          where: { assistantDraftId: draft.id },
        });
        assert.equal(accepted.status, "ACCEPTED");
        await assert.rejects(retryMessage(accepted.id));
        await assert.rejects(saveAssistantDraft(first));
        const history = await assistantDraftHistory(draft.id);
        assert.equal(history.events.length, 5);
        await assert.rejects(
          prisma.assistantDraftEvent.update({
            where: { id: history.events[0]!.id },
            data: { action: "TAMPERED" },
          }),
        );
        assert.equal(
          (await runAsTenant("oa05-other", () => prisma.assistantDraft.findMany())).length,
          0,
        );
        await assert.rejects(
          runAsTenant("oa05-other", () => actOnAssistantDraft(draft.id, 2, "queue"), actorId),
        );
        for (const scenario of [
          "opt-out",
          "phone",
          "role",
          "tenant",
          "uncertain",
          "retry",
        ] as const) {
          const data = await input(
            10 + ["opt-out", "phone", "role", "tenant", "uncertain", "retry"].indexOf(scenario),
          );
          const row = await saveAssistantDraft(data);
          await actOnAssistantDraft(row.id, 1, "approve");
          await actOnAssistantDraft(row.id, 1, "queue");
          if (scenario === "opt-out")
            await prisma.customer.update({
              where: { id: data.customerId },
              data: { marketingOptIn: false },
            });
          if (scenario === "phone")
            await prisma.customer.update({
              where: { id: data.customerId },
              data: { phone: "+6599999999" },
            });
          if (scenario === "role")
            await prisma.user.update({ where: { id: actorId }, data: { globalRole: "STAFF" } });
          if (scenario === "tenant")
            await prisma.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } });
          let calls = 0;
          await runMessageBatch(async () => {
            calls++;
            if (scenario === "uncertain") throw new Error("socket timeout");
            if (scenario === "retry")
              throw Object.assign(new Error("rate limited"), { status: 429 });
            throw new Error("Must not send");
          });
          const job = await prisma.messageJob.findFirstOrThrow({
            where: { assistantDraftId: row.id },
          });
          if (scenario === "uncertain") {
            assert.equal(job.status, "UNCERTAIN");
            await assert.rejects(retryMessage(job.id));
          } else if (scenario === "retry") {
            assert.equal(job.status, "RETRY");
            await prisma.messageJob.update({ where: { id: job.id }, data: { dueAt: new Date() } });
            await runMessageBatch(async (p) => {
              assert.equal(p.text, row.body);
              return "SMretry";
            });
          } else {
            assert.equal(calls, 0);
            assert.equal(job.status, "SUPPRESSED");
          }
          await prisma.user.update({ where: { id: actorId }, data: { globalRole: "MANAGER" } });
          await prisma.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE" } });
        }
        // Existing seven assistant jobs consume quota even when suppressed/uncertain.
        for (let i = 0; i < 13; i++) {
          const data = await input(100 + i);
          const d = await saveAssistantDraft(data);
          await actOnAssistantDraft(d.id, 1, "approve");
          await actOnAssistantDraft(d.id, 1, "queue");
        }
        const extra = await saveAssistantDraft(await input(200));
        await actOnAssistantDraft(extra.id, 1, "approve");
        await assert.rejects(
          actOnAssistantDraft(extra.id, 1, "queue"),
          (e: unknown) => (e as { code: string }).code === "ASSISTANT_DAILY_LIMIT",
        );
        assert.equal((await listAssistantDrafts()).drafts.length, 20);
        assert.ok((await listAssistantDrafts()).nextCursor);
        await prisma.assistantDraft.update({
          where: { id: extra.id },
          data: { reviewDueAt: new Date(0) },
        });
        await assert.rejects(actOnAssistantDraft(extra.id, 1, "queue"));
        const reviewed = await reviewAssistantDraft(
          extra.id,
          1,
          "Retain for owner review of unsent draft",
        );
        assert.equal(reviewed.status, "DRAFT");
        assert.equal(reviewed.version, 2);
        assert.equal(reviewed.approvedById, null);
        assert.ok(reviewed.reviewDueAt > new Date());
        const firstPage = await listAssistantDrafts();
        const secondPage = await listAssistantDrafts(firstPage.nextCursor!);
        assert.ok(
          secondPage.drafts.every((row) => !firstPage.drafts.some((first) => first.id === row.id)),
        );
      });
      process.env.NODE_ENV = "test";
      process.env.JWT_SECRET = "oa05-disposable-acceptance-secret";
      const { createApp } = await import("../app.js");
      const { signAccessToken } = await import("../lib/tokens.js");
      const manager = await scoped(() => prisma.user.findFirstOrThrow({ where: { id: actorId } }));
      const { token } = signAccessToken({
        id: manager.id,
        email: manager.email!,
        globalRole: manager.globalRole,
        tokenVersion: manager.tokenVersion,
        realm: "web",
        tenantId,
      });
      const server = createApp().listen(0, "127.0.0.1");
      await once(server, "listening");
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ai-assistant/drafts`;
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      try {
        assert.equal((await fetch(base)).status, 401);
        assert.equal((await fetch(base, { headers })).status, 200);
        assert.equal(
          (
            await fetch(base, {
              headers,
              method: "POST",
              body: JSON.stringify({ channel: "WHATSAPP" }),
            })
          ).status,
          422,
        );
        assert.equal(
          (
            await fetch(`${base}/missing/queue`, {
              headers,
              method: "POST",
              body: JSON.stringify({ expectedVersion: 1 }),
            })
          ).status,
          404,
        );
        await scoped(() =>
          prisma.user.update({ where: { id: actorId }, data: { globalRole: "STAFF" } }),
        );
        assert.equal((await fetch(base, { headers })).status, 403);
        await scoped(() =>
          prisma.user.update({ where: { id: actorId }, data: { globalRole: "MANAGER" } }),
        );
        await runAsPlatform(() =>
          prisma.module.update({ where: { code: "dashboard" }, data: { isCore: false } }),
        );
        assert.equal((await fetch(base, { headers })).status, 403);
        await runAsPlatform(() =>
          prisma.module.update({ where: { code: "dashboard" }, data: { isCore: true } }),
        );
        await scoped(() =>
          prisma.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } }),
        );
        assert.equal(
          (
            await fetch(`${base}/missing/queue`, {
              headers,
              method: "POST",
              body: JSON.stringify({ expectedVersion: 1 }),
            })
          ).status,
          403,
        );
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    } finally {
      await prisma.$disconnect();
    }
  },
);
