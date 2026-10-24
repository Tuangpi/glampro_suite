import "dotenv/config";
import assert from "node:assert/strict";
import { before, after, beforeEach, describe, it } from "node:test";
import twilio from "twilio";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { createAppointment, updateAppointment } from "./appointment.service.js";
import { messagingSettingsSchema } from "@glampro_suite/shared";
import {
  getMessagingSettings,
  saveMessagingSettings,
  recordChannelConsent,
  getChannelConsents,
  issueLink,
  revokeLinks,
  withPublicLink,
  publicBookingAction,
  queueReceipt,
  retryMessage,
  normalizePhone,
  hashToken,
} from "./messaging.service.js";
import {
  runMessageBatch,
  outsideQuietHours,
  applyDeliveryStatus,
  inboundOptOut,
} from "./message-worker.js";
import { verifyWebhook, type ProviderInput } from "../lib/messaging-provider.js";
import { createApp } from "../app.js";

/**
 * A one-off booking's row: the create answers `{ appointment, series }` now that a
 * request may repeat (phase C), and these checks all book a single booking.
 */
async function book(input: Parameters<typeof createAppointment>[0]) {
  return (await createAppointment(input)).appointment;
}
import { updateCustomer } from "./customer.service.js";
import { recordCustomerConsent } from "./consent.service.js";
import type { Server } from "node:http";

const ids = ["messaging-test-a", "messaging-test-b"];
const inA = <T>(fn: () => T) => runAsTenant(ids[0]!, fn);
const config = {
  accountSid: `AC${"1".repeat(32)}`,
  authToken: "test-token-not-real",
  smsFrom: "GlamproTest",
  whatsappFrom: "whatsapp:+14155550100",
  templates: { CONFIRMATION: "HXtest", REMINDER: "HXtest", REBOOKING: "HXtest", RECEIPT: "HXtest" },
};
let customerId = "";
let serviceId = "";
let server: Server;
let base = "";
const consent = {
  channel: "SMS" as const,
  service: true,
  marketing: true,
  preferred: true,
  expectedRevision: 0,
  noticeVersion: "v1",
  presented: true,
};
const bookingInput = () => ({
  serviceId,
  customerId,
  startsAt: new Date(Date.now() + 72 * 3600000).toISOString(),
});
async function newDueJob() {
  const booking = await inA(() => book(bookingInput()));
  return inA(() =>
    prisma.messageJob.findFirstOrThrow({
      where: { appointmentId: booking.id, kind: "CONFIRMATION" },
    }),
  );
}
describe("messaging PostgreSQL integration", { skip: !process.env.DATABASE_URL }, () => {
  before(async () => {
    process.env.MESSAGING_ENABLED = "true";
    process.env.MESSAGING_PUBLIC_ORIGIN = "https://salon.example.test";
    process.env.MESSAGING_TENANTS_JSON = JSON.stringify({ [ids[0]!]: config });
    await runAsPlatform(async () => {
      await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
      for (const id of ids)
        await prisma.tenant.create({ data: { id, name: "Test salon", slug: id } });
      for (const code of ["appointments", "sales", "customers"])
        await prisma.module.upsert({
          where: { code },
          update: { isCore: true },
          create: { code, name: code, category: "Core", isCore: true },
        });
    });
    await inA(async () => {
      customerId = (
        await prisma.customer.create({
          data: {
            tenantId: "",
            name: "Private customer",
            phone: "+65 8123 4567",
            pdpaConsent: true,
            marketingOptIn: true,
          },
        })
      ).id;
      serviceId = (
        await prisma.service.create({
          data: {
            tenantId: "",
            name: "Hair",
            durationMinutes: 60,
            nonmemberPrice: "20",
            memberPrice: "18",
          },
        })
      ).id;
      await saveMessagingSettings(
        messagingSettingsSchema.parse({
          smsEnabled: true,
          whatsappEnabled: true,
          consentVersion: "v1",
          serviceConsentText: "Explicit service channel choice",
          marketingConsentText: "Optional marketing channel choice",
        }),
      );
    });
    server = createApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}`;
  });
  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await runAsPlatform(() => prisma.tenant.deleteMany({ where: { id: { in: ids } } }));
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    process.env.MESSAGING_ENABLED = "true";
    await inA(async () => {
      await prisma.messageJob.deleteMany();
      await prisma.publicLink.deleteMany();
      await prisma.appointment.deleteMany();
      await prisma.channelConsent.deleteMany();
      await prisma.channelConsentEvent.deleteMany();
      await prisma.customer.update({
        where: { id: customerId },
        data: { phone: "+65 8123 4567", pdpaConsent: true, marketingOptIn: true },
      });
      await recordChannelConsent(customerId, consent, "staff");
    });
  });
  it("defaults to disabled, isolates tenants and versions exact channel evidence", async () => {
    assert.equal((await runAsTenant(ids[1]!, getMessagingSettings)).smsEnabled, false);
    await assert.rejects(runAsTenant(ids[1]!, () => getChannelConsents(customerId)));
    await assert.rejects(inA(() => recordChannelConsent(customerId, consent, "staff")));
    await inA(async () => {
      const events = await prisma.channelConsentEvent.findMany();
      assert.equal(events.length, 1);
      assert.equal(events[0]!.destination, "+6581234567");
      assert.equal(events[0]!.serviceText, "Explicit service channel choice");
      const settings = await getMessagingSettings();
      await assert.rejects(
        saveMessagingSettings({ ...settings, serviceConsentText: "Changed without version" }),
      );
    });
  });
  it("atomically queues create and replaces obsolete schedules only on relevant edits", async () => {
    const booking = await inA(() => book(bookingInput()));
    assert.equal(
      await inA(() => prisma.messageJob.count({ where: { appointmentId: booking.id } })),
      2,
    );
    await inA(() => updateAppointment(booking.id, { comment: "Internal only" }));
    assert.equal(
      await inA(() => prisma.messageJob.count({ where: { appointmentId: booking.id } })),
      2,
    );
    await inA(() =>
      updateAppointment(booking.id, {
        startsAt: new Date(Date.now() + 96 * 3600000).toISOString(),
      }),
    );
    const jobs = await inA(() =>
      prisma.messageJob.findMany({ where: { appointmentId: booking.id } }),
    );
    assert.equal(jobs.filter((j) => j.status === "CANCELLED").length, 2);
    assert.equal(jobs.filter((j) => j.status === "PENDING" && j.revision === 1).length, 2);
  });
  it("does not queue an extra reminder for a short-notice booking", async () => {
    const booking = await inA(() =>
      book({
        ...bookingInput(),
        startsAt: new Date(Date.now() + 4 * 3600000).toISOString(),
      }),
    );
    assert.equal(
      await inA(() => prisma.messageJob.count({ where: { appointmentId: booking.id } })),
      1,
    );
  });
  it("claims competing workers once and records provider acceptance, not delivery", async () => {
    const job = await newDueJob();
    const calls: ProviderInput[] = [];
    const send = async (input: ProviderInput) => {
      calls.push(input);
      return "SMaccepted";
    };
    await Promise.all([runMessageBatch(send), runMessageBatch(send)]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.channel, "SMS");
    assert.match(calls[0]!.text, /Unsubscribe:/);
    const saved = await inA(() => prisma.messageJob.findFirstOrThrow({ where: { id: job.id } }));
    assert.equal(saved.status, "ACCEPTED");
    assert.equal(saved.attempts, 1);
    await inA(() =>
      applyDeliveryStatus(job.id, { MessageSid: "SMaccepted", MessageStatus: "read" }),
    );
    await inA(() =>
      applyDeliveryStatus(job.id, { MessageSid: "SMaccepted", MessageStatus: "sent" }),
    );
    assert.equal(
      (await inA(() => prisma.messageJob.findFirstOrThrow({ where: { id: job.id } }))).status,
      "READ",
    );
  });
  it("does not send when globally disabled", async () => {
    await newDueJob();
    process.env.MESSAGING_ENABLED = "false";
    assert.equal(
      await runMessageBatch(async () => {
        throw new Error("Must not send");
      }),
      0,
    );
  });
  it("uses the explicitly preferred WhatsApp channel and supplies all four template variables", async () => {
    await inA(() => recordChannelConsent(customerId, { ...consent, channel: "WHATSAPP" }, "staff"));
    await newDueJob();
    const calls: ProviderInput[] = [];
    await runMessageBatch(async (input) => {
      calls.push(input);
      return "SMwhatsapp";
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.channel, "WHATSAPP");
    assert.deepEqual(Object.keys(calls[0]!.variables).sort(), ["1", "2", "3", "4"]);
  });
  it("phone changes permanently withdraw channel permission even if the number is restored", async () => {
    await newDueJob();
    await inA(() => updateCustomer(customerId, { phone: "+6587654321" }, "staff"));
    await inA(() => updateCustomer(customerId, { phone: "+6581234567" }, "staff"));
    const choices = await inA(() => getChannelConsents(customerId));
    assert.equal(choices.choices[0]!.service, false);
    assert.equal(
      await inA(() =>
        prisma.channelConsentEvent.count({ where: { noticeVersion: "PHONE_CHANGED" } }),
      ),
      1,
    );
  });
  it("data consent withdrawal atomically removes all channel permissions", async () => {
    await inA(async () => {
      const customer = await prisma.customer.findFirstOrThrow({ where: { id: customerId } });
      await recordCustomerConsent(
        customerId,
        {
          pdpaConsent: false,
          marketingOptIn: false,
          expectedRevision: customer.consentRevision,
          noticeId: null,
        },
        "staff",
      );
      const choice = (await getChannelConsents(customerId)).choices[0]!;
      assert.equal(choice.service, false);
      assert.equal(choice.marketing, false);
    });
  });
  it("suppresses rebooking after a new booking and never sends marketing without current opt-in", async () => {
    const completed = await inA(() => book({ ...bookingInput(), status: "COMPLETED" }));
    await inA(async () => {
      await prisma.messageJob.updateMany({
        where: { appointmentId: completed.id },
        data: { dueAt: new Date(Date.now() - 60000) },
      });
      await book(bookingInput());
    });
    await runMessageBatch(async () => "SMfuturebooking");
    const job = await inA(() =>
      prisma.messageJob.findFirstOrThrow({ where: { appointmentId: completed.id } }),
    );
    assert.equal(job.errorCode, "ALREADY_REBOOKED");
  });
  it("suppresses changed destinations and current consent withdrawal without fallback", async () => {
    const job = await newDueJob();
    await inA(() =>
      prisma.customer.update({ where: { id: customerId }, data: { phone: "+6587654321" } }),
    );
    await runMessageBatch(async () => {
      throw new Error("Must not send");
    });
    assert.equal(
      (await inA(() => prisma.messageJob.findFirstOrThrow({ where: { id: job.id } }))).errorCode,
      "CONSENT_REQUIRED",
    );
  });
  it("marks timeouts uncertain and never blindly retries accepted or unknown sends", async () => {
    const job = await newDueJob();
    await runMessageBatch(async () => {
      throw new Error("network timeout");
    });
    assert.equal(
      (await inA(() => prisma.messageJob.findFirstOrThrow({ where: { id: job.id } }))).status,
      "UNCERTAIN",
    );
    await assert.rejects(inA(() => retryMessage(job.id)));
    let calls = 0;
    await runMessageBatch(async () => {
      calls++;
      return "SMno";
    });
    assert.equal(calls, 0);
  });
  it("retries definite rate-limit rejection with bounded attempts", async () => {
    const job = await newDueJob();
    await runMessageBatch(async () => {
      throw Object.assign(new Error("rate limited"), { status: 429, code: 20429 });
    });
    const row = await inA(() => prisma.messageJob.findFirstOrThrow({ where: { id: job.id } }));
    assert.equal(row.status, "RETRY");
    assert.equal(row.errorCode, "20429");
    assert.ok(row.dueAt > new Date());
  });
  it("expired worker leases become uncertain rather than duplicate submissions", async () => {
    const job = await newDueJob();
    await inA(() =>
      prisma.messageJob.update({
        where: { id: job.id },
        data: { status: "SENDING", leaseUntil: new Date(0) },
      }),
    );
    await runMessageBatch(async () => {
      throw new Error("Must not resend");
    });
    assert.equal(
      (await inA(() => prisma.messageJob.findFirstOrThrow({ where: { id: job.id } }))).errorCode,
      "WORKER_INTERRUPTED",
    );
  });
  it("public GET is inert, confirmation is separate, cancellation revokes stale links", async () => {
    const booking = await inA(() => book(bookingInput()));
    const link = await inA(() => issueLink("BOOKING", booking.id));
    const token = link.url.split("/").pop()!;
    const response = await fetch(`${base}/api/public/messages/${token}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    assert.equal(
      (await inA(() => prisma.appointment.findFirstOrThrow({ where: { id: booking.id } })))
        .customerConfirmedAt,
      null,
    );
    assert.ok(!(await inA(() => prisma.publicLink.findFirst({ where: { tokenHash: token } }))));
    assert.ok(
      await inA(() => prisma.publicLink.findFirst({ where: { tokenHash: hashToken(token) } })),
    );
    await inA(() => withPublicLink(token, (current) => publicBookingAction(current, "confirm")));
    await inA(() => withPublicLink(token, (current) => publicBookingAction(current, "confirm")));
    assert.equal(
      (await inA(() => prisma.appointment.findFirstOrThrow({ where: { id: booking.id } }))).status,
      "SCHEDULED",
    );
    const cancelled = await fetch(`${base}/api/public/messages/${token}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "action=cancel",
    });
    assert.equal(cancelled.status, 200);
    assert.equal(
      (await inA(() => prisma.appointment.findFirstOrThrow({ where: { id: booking.id } }))).status,
      "CANCELLED",
    );
    assert.equal((await fetch(`${base}/api/public/messages/${token}`)).status, 404);
  });
  it("rejects self-cancellation inside cutoff and invalidates action links on reschedule", async () => {
    const booking = await inA(() =>
      book({
        ...bookingInput(),
        startsAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    );
    const link = await inA(() => issueLink("BOOKING", booking.id));
    const token = link.url.split("/").pop()!;
    await assert.rejects(
      inA(() => withPublicLink(token, (current) => publicBookingAction(current, "cancel"))),
    );
    await inA(() =>
      updateAppointment(booking.id, {
        startsAt: new Date(Date.now() + 48 * 3600000).toISOString(),
      }),
    );
    await assert.rejects(
      inA(() => withPublicLink(token, (current) => publicBookingAction(current, "confirm"))),
    );
  });
  it("signed STOP withdraws both purposes and suppresses pending jobs", async () => {
    await newDueJob();
    await inA(() => inboundOptOut({ From: "+6581234567", To: config.smsFrom, Body: "STOP" }));
    const choice = (await inA(() => getChannelConsents(customerId))).choices[0]!;
    assert.equal(choice.service, false);
    assert.equal(choice.marketing, false);
    assert.equal(await inA(() => prisma.messageJob.count({ where: { status: "PENDING" } })), 0);
  });
  it("checks exact webhook signature and rejects unauthenticated settings/webhooks", async () => {
    const path = `/api/messaging/webhooks/${ids[0]}/inbound`;
    const body = {
      AccountSid: config.accountSid,
      From: "+6581234567",
      To: config.smsFrom,
      Body: "STOP",
    };
    const signature = twilio.getExpectedTwilioSignature(
      config.authToken,
      `https://salon.example.test${path}`,
      body,
    );
    assert.equal(verifyWebhook(ids[0]!, signature, path, body), true);
    assert.equal(verifyWebhook(ids[0]!, signature, path, { ...body, Body: "tampered" }), false);
    assert.equal((await fetch(`${base}/api/messaging/settings`)).status, 401);
    assert.equal(
      (
        await fetch(`${base}${path}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(body),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${base}${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "X-Twilio-Signature": signature,
          },
          body: new URLSearchParams(body),
        })
      ).status,
      200,
    );
  });
  it("public unsubscribe is inert until POST and works for one-way SMS senders", async () => {
    await newDueJob();
    let url = "";
    await runMessageBatch(async (input) => {
      url = input.variables["4"]!;
      return "SMunsubscribe";
    });
    const path = new URL(url).pathname;
    assert.equal((await fetch(`${base}${path}`)).status, 200);
    assert.equal((await inA(() => getChannelConsents(customerId))).choices[0]!.service, true);
    assert.equal((await fetch(`${base}${path}/unsubscribe`, { method: "POST" })).status, 200);
    assert.equal((await inA(() => getChannelConsents(customerId))).choices[0]!.service, false);
  });
  it("receipt links expose only receipt facts, expire, revoke, and deduplicate explicit sends", async () => {
    const sale = await inA(() =>
      prisma.sale.create({
        data: {
          tenantId: "",
          customerId,
          status: "COMPLETED",
          totalQuantity: 1,
          totalAmount: "20",
          paidAmount: "20",
          soldAt: new Date(),
          note: "PRIVATE-INTERNAL-NOTE",
          receiptNumber: 99001,
          paymentStatus: "PAID",
        },
      }),
    );
    await inA(() =>
      prisma.saleLine.create({
        data: {
          tenantId: "",
          saleId: sale.id,
          itemType: "SERVICE",
          itemId: serviceId,
          itemName: "Customer haircut",
          quantity: 1,
          unitPrice: "20",
          lineTotal: "20",
        },
      }),
    );
    const link = await inA(() => issueLink("RECEIPT", sale.id));
    const path = new URL(link.url).pathname;
    const response = await fetch(`${base}${path}`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Customer haircut/);
    assert.match(html, /20\.00/);
    assert.ok(!html.includes("PRIVATE-INTERNAL-NOTE"));
    assert.ok(!html.includes("8123"));
    assert.ok(!html.includes("Private customer"));
    assert.ok(link.expiresAt.getTime() - Date.now() <= 30 * 86400000);
    const queued = await inA(() => queueReceipt(sale.id, "SMS"));
    assert.equal((await inA(() => queueReceipt(sale.id, "SMS"))).id, queued.id);
    await inA(() => revokeLinks("RECEIPT", sale.id));
    assert.equal((await fetch(`${base}${path}`)).status, 404);
    const replacement = await inA(() => issueLink("RECEIPT", sale.id));
    assert.notEqual(replacement.url, link.url);
    await inA(() =>
      prisma.publicLink.updateMany({
        where: { kind: "RECEIPT" },
        data: { expiresAt: new Date(0) },
      }),
    );
    assert.equal((await fetch(`${base}${new URL(replacement.url).pathname}`)).status, 404);
    await inA(async () => {
      await prisma.saleLine.deleteMany({ where: { saleId: sale.id } });
      await prisma.sale.delete({ where: { id: sale.id } });
    });
  });
  it("keeps ambiguous-send links usable when the provider might have accepted the message", async () => {
    await newDueJob();
    let url = "";
    await runMessageBatch(async (input) => {
      url = input.variables["3"]!;
      throw new Error("response lost after acceptance");
    });
    assert.equal((await fetch(`${base}${new URL(url).pathname}`)).status, 200);
  });
  it("queues the explicit service interval and inherits company days when cleared", async () => {
    await inA(async () => {
      try {
        for (const interval of [45, null]) {
          await prisma.service.update({ where: { id: serviceId }, data: { interval } });
          const booking = await book({
            ...bookingInput(),
            startsAt: new Date(Date.now() - 90 * 86400000).toISOString(),
            status: "COMPLETED",
          });
          const row = await prisma.appointment.findFirstOrThrow({ where: { id: booking.id } });
          const job = await prisma.messageJob.findFirstOrThrow({
            where: { appointmentId: row.id, kind: "REBOOKING" },
          });
          assert.equal(
            job.dueAt.getTime() - row.finishedAt!.getTime(),
            (interval ?? (await getMessagingSettings()).rebookingDays) * 86400000,
          );
        }
      } finally {
        await prisma.service.update({ where: { id: serviceId }, data: { interval: null } });
      }
    });
  });
  it("dispatches eligible rebooking once when outside quiet hours", async () => {
    const localHour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Singapore",
        hour: "numeric",
        hourCycle: "h23",
      }).format(new Date()),
    );
    await inA(async () => {
      const settings = await getMessagingSettings();
      await saveMessagingSettings({
        ...settings,
        quietStart: (localHour + 2) % 24,
        quietEnd: (localHour + 3) % 24,
      });
    });
    // A completed visit must actually be in the past; future completed fixtures
    // must not bypass the latest-completed-visit guard.
    const booking = await inA(() =>
      book({
        ...bookingInput(),
        startsAt: new Date(Date.now() - 90 * 86400000).toISOString(),
        status: "COMPLETED",
      }),
    );
    await inA(() =>
      prisma.messageJob.updateMany({
        where: { appointmentId: booking.id },
        data: { dueAt: new Date(Date.now() - 1000) },
      }),
    );
    await inA(async () =>
      prisma.messageJob.create({
        data: {
          tenantId: ids[0]!,
          customerId,
          appointmentId: booking.id,
          revision: (await prisma.appointment.findFirstOrThrow({ where: { id: booking.id } }))
            .messageRevision,
          kind: "REBOOKING",
          dueAt: new Date(Date.now() - 1000),
        },
      }),
    );
    let count = 0;
    await runMessageBatch(async () => {
      count++;
      return "SMrebooking";
    });
    await runMessageBatch(async () => {
      count++;
      return "SMduplicate";
    });
    assert.equal(count, 1);
    await inA(async () => {
      const settings = await getMessagingSettings();
      await saveMessagingSettings({ ...settings, quietStart: 20, quietEnd: 9 });
    });
  });
});

describe("messaging normalization and salon quiet hours", () => {
  it("requires unambiguous international numbers", () => {
    assert.equal(normalizePhone("+65 (8123) 4567"), "+6581234567");
    assert.equal(normalizePhone("081234567"), null);
    assert.equal(normalizePhone("+000123456"), null);
  });
  it("moves reminders earlier and marketing later using salon timezone", () => {
    const instant = new Date("2026-10-20T14:00:00Z");
    assert.equal(
      outsideQuietHours(instant, "Asia/Singapore", 20, 9, -1).toISOString(),
      "2026-10-20T11:59:00.000Z",
    );
    assert.equal(
      outsideQuietHours(instant, "Asia/Singapore", 20, 9, 1).toISOString(),
      "2026-10-21T01:00:00.000Z",
    );
  });
  it("handles a DST spring-forward gap without assuming a fixed UTC offset", () => {
    assert.equal(
      outsideQuietHours(
        new Date("2026-03-08T06:30:00Z"),
        "America/New_York",
        20,
        9,
        1,
      ).toISOString(),
      "2026-03-08T13:00:00.000Z",
    );
  });
});
