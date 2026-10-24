import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import {
  sendProvider,
  senderConfig,
  publicOrigin,
  assertSender,
  type Channel,
  type MessageKind,
  type ProviderInput,
} from "../lib/messaging-provider.js";
import { wallClockAt } from "../lib/wall-clock.js";
import { logger } from "../lib/logger.js";
import {
  assertMessagingAccess,
  getMessagingSettings,
  hashToken,
  normalizePhone,
  tenantId,
} from "./messaging.service.js";
import { randomBytes } from "node:crypto";
import {
  rebookingChannel,
  rebookingInterval,
  REBOOKING_CONTACT_STATUSES,
} from "./rebooking-policy.js";

/** Minute stepping uses real instants, including DST gaps/repeated local hours. */
export function outsideQuietHours(
  date: Date,
  zone: string,
  start: number,
  end: number,
  direction: 1 | -1,
): Date {
  let value = date;
  for (let i = 0; i < 26 * 60; i++) {
    const hour = Math.floor(wallClockAt(value, zone).minutes / 60);
    const quiet = start < end ? hour >= start && hour < end : hour >= start || hour < end;
    if (!quiet) return value;
    value = new Date(value.getTime() + direction * 60000);
  }
  throw new Error("Cannot resolve quiet-hour boundary.");
}

export async function runMessageBatch(
  send: (input: ProviderInput) => Promise<string> = sendProvider,
  limit = 25,
) {
  if (process.env.MESSAGING_ENABLED !== "true") return 0;
  // A dead worker may have already submitted its message. Never resend its lease.
  await runAsPlatform(() =>
    prisma.messageJob.updateMany({
      where: { status: "SENDING", leaseUntil: { lt: new Date() } },
      data: { status: "UNCERTAIN", errorCode: "WORKER_INTERRUPTED" },
    }),
  );
  const candidates = await runAsPlatform(() =>
    prisma.messageJob.findMany({
      where: {
        status: { in: ["PENDING", "RETRY"] },
        dueAt: { lte: new Date(Date.now() + 26 * 3600000) },
      },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: limit,
    }),
  );
  for (const candidate of candidates)
    await runAsTenant(candidate.tenantId, async () => {
      const now = new Date();
      let settings;
      let tenant;
      try {
        settings = await getMessagingSettings();
        tenant = await assertMessagingAccess(
          candidate.kind === "RECEIPT" ? "sales" : "appointments",
        );
      } catch {
        await prisma.messageJob.updateMany({
          where: { id: candidate.id, status: { in: ["PENDING", "RETRY"] } },
          data: { status: "SUPPRESSED", errorCode: "TENANT_INELIGIBLE" },
        });
        return;
      }
      const scheduled = candidate.kind === "REMINDER" || candidate.kind === "REBOOKING";
      const effectiveDue =
        scheduled && candidate.status === "PENDING" && candidate.attempts === 0
          ? outsideQuietHours(
              candidate.dueAt,
              tenant.timeZone,
              settings.quietStart,
              settings.quietEnd,
              candidate.kind === "REMINDER" ? -1 : 1,
            )
          : candidate.dueAt;
      if (effectiveDue > now) return;
      const claimed = await prisma.messageJob.updateMany({
        where: { id: candidate.id, status: { in: ["PENDING", "RETRY"] } },
        data: {
          status: "SENDING",
          leaseUntil: new Date(Date.now() + 120000),
          attempts: { increment: 1 },
        },
      });
      if (!claimed.count) return;
      let submitted = false;
      try {
        await prisma.$transaction(
          async (tx) => {
            // Booking writes/customer withdrawals wait until this dispatch completes.
            if (candidate.appointmentId)
              await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${candidate.appointmentId} AND "tenantId" = ${tenantId()} FOR UPDATE`;
            if (candidate.customerId)
              await tx.$queryRaw`SELECT id FROM customers WHERE id = ${candidate.customerId} AND "tenantId" = ${tenantId()} FOR UPDATE`;
            const job = await tx.messageJob.findFirstOrThrow({ where: { id: candidate.id } });
            const suppress = async (reason: string) => {
              await tx.messageJob.update({
                where: { id: job.id },
                data: { status: "SUPPRESSED", errorCode: reason, leaseUntil: null },
              });
            };
            const customer = job.customerId
              ? await tx.customer.findFirst({ where: { id: job.customerId } })
              : null;
            const destination = normalizePhone(customer?.phone ?? null);
            if (!customer || customer.archivedAt || !customer.pdpaConsent || !destination)
              return suppress("CUSTOMER_INELIGIBLE");
            const consent = await tx.channelConsent.findFirst({
              where: {
                customerId: customer.id,
                ...(job.channel ? { channel: job.channel } : { preferred: true }),
              },
            });
            const promotional = job.kind === "REBOOKING";
            if (promotional) {
              const choices = await tx.channelConsent.findMany({
                where: { customerId: customer.id, preferred: true },
              });
              const eligible = rebookingChannel(customer, choices, settings);
              if (!eligible || (job.channel && eligible.channel !== job.channel))
                return suppress("CONSENT_REQUIRED");
            }
            if (
              !consent ||
              consent.destination !== destination ||
              (promotional ? !consent.marketing || !customer.marketingOptIn : !consent.service)
            )
              return suppress("CONSENT_REQUIRED");
            const channel = consent.channel as Channel;
            if (!(channel === "SMS" ? settings.smsEnabled : settings.whatsappEnabled))
              return suppress("CHANNEL_DISABLED");
            // Re-read guards after acquiring locks, not just when selecting candidates.
            await assertMessagingAccess(job.kind === "RECEIPT" ? "sales" : "appointments");
            const booking = job.appointmentId
              ? await tx.appointment.findFirst({ where: { id: job.appointmentId } })
              : null;
            if (
              job.appointmentId &&
              (!booking ||
                booking.messageRevision !== job.revision ||
                booking.customerId !== customer.id ||
                (promotional
                  ? booking.status !== "COMPLETED"
                  : booking.status !== "SCHEDULED" || booking.startsAt <= now))
            )
              return suppress("BOOKING_CHANGED");
            if (
              promotional &&
              (await tx.appointment.findFirst({
                where: {
                  customerId: customer.id,
                  endsAt: { gt: now },
                  status: { in: ["SCHEDULED", "IN_PROGRESS"] },
                },
              }))
            )
              return suppress("ALREADY_REBOOKED");
            if (promotional) {
              const latest = await tx.appointment.findFirst({
                where: { customerId: customer.id, status: "COMPLETED", endsAt: { lte: now } },
                orderBy: [{ startsAt: "desc" }, { id: "asc" }],
                select: { id: true, service: { select: { interval: true } } },
              });
              if (!latest || latest.id !== job.appointmentId) return suppress("LATER_VISIT");
              const interval = rebookingInterval(latest.service?.interval, settings.rebookingDays);
              const contacted = await tx.messageJob.findFirst({
                where: {
                  id: { not: job.id },
                  customerId: customer.id,
                  kind: "REBOOKING",
                  status: {
                    in: REBOOKING_CONTACT_STATUSES.filter(
                      (status) => !["PENDING", "RETRY", "SENDING"].includes(status),
                    ),
                  },
                  OR: [
                    { appointmentId: job.appointmentId },
                    { updatedAt: { gte: new Date(now.getTime() - interval * 86400000) } },
                  ],
                },
                select: { id: true },
              });
              if (contacted) return suppress("CONTACT_LIMIT");
            }
            if (scheduled) {
              const next = outsideQuietHours(
                now,
                tenant.timeZone,
                settings.quietStart,
                settings.quietEnd,
                1,
              );
              if (next > now) {
                if (job.kind === "REMINDER") return suppress("QUIET_HOURS_MISSED");
                await tx.messageJob.update({
                  where: { id: job.id },
                  data: { status: "RETRY", dueAt: next, leaseUntil: null },
                });
                return;
              }
            }
            const currentSettings = await getMessagingSettings();
            if (!(channel === "SMS" ? currentSettings.smsEnabled : currentSettings.whatsappEnabled))
              return suppress("CHANNEL_DISABLED");
            const config = senderConfig(candidate.tenantId);
            const kind = job.kind as MessageKind;
            assertSender(config, channel, kind);
            const origin = publicOrigin();
            let link = "";
            if ((booking && !promotional) || job.saleId) {
              if (job.saleId) {
                const sale = await tx.sale.findFirst({ where: { id: job.saleId } });
                if (!sale || sale.status === "HELD" || sale.customerId !== customer.id)
                  return suppress("SALE_CHANGED");
              }
              const token = randomBytes(32).toString("base64url");
              // Commit the capability before external submission. An uncertain network
              // response must not roll back a link the customer may already receive.
              await prisma.publicLink.create({
                data: {
                  tenantId: tenantId(),
                  tokenHash: hashToken(token),
                  kind: job.saleId ? "RECEIPT" : "BOOKING",
                  targetId: job.saleId ?? booking!.id,
                  revision: job.revision,
                  expiresAt: job.saleId ? new Date(Date.now() + 30 * 86400000) : booking!.startsAt,
                },
              });
              link = `${origin}/api/public/messages/${token}`;
            }
            const when = booking
              ? new Intl.DateTimeFormat(tenant.locale, {
                  timeZone: tenant.timeZone,
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(booking.startsAt)
              : "";
            const title =
              kind === "RECEIPT"
                ? "Your receipt"
                : kind === "REBOOKING"
                  ? "Ready for your next visit? Contact the salon to book."
                  : kind === "REMINDER"
                    ? "Appointment reminder"
                    : "Booking confirmation";
            const unsubscribeToken = randomBytes(32).toString("base64url");
            await prisma.publicLink.create({
              data: {
                tenantId: tenantId(),
                tokenHash: hashToken(unsubscribeToken),
                kind: "UNSUBSCRIBE",
                targetId: consent.id,
                expiresAt: new Date(Date.now() + 365 * 86400000),
              },
            });
            const unsubscribe = `${origin}/api/public/messages/${unsubscribeToken}`;
            const text = `${tenant.name}: ${title}${when && !promotional ? ` — ${when}` : ""}. ${link} Unsubscribe: ${unsubscribe}`;
            const callback = `${origin}/api/messaging/webhooks/${encodeURIComponent(tenantId())}/status/${job.id}`;
            await tx.messageJob.update({ where: { id: job.id }, data: { channel, destination } });
            submitted = true;
            const sid = await send({
              config: config!,
              channel,
              kind,
              destination,
              text,
              variables: {
                "1": tenant.name,
                "2": promotional ? "Your next visit" : when || "Receipt",
                "3": link || "Contact the salon",
                "4": unsubscribe,
              },
              callback,
            });
            await tx.messageJob.update({
              where: { id: job.id },
              data: { providerSid: sid, status: "ACCEPTED", leaseUntil: null, errorCode: null },
            });
          },
          { timeout: 25000 },
        );
      } catch (error) {
        const provider = error as { status?: number; code?: number };
        const definiteRejection =
          submitted &&
          provider.status !== undefined &&
          provider.status >= 400 &&
          provider.status < 500;
        const retryable = definiteRejection && provider.status === 429 && candidate.attempts < 3;
        const status =
          !submitted || definiteRejection ? (retryable ? "RETRY" : "FAILED") : "UNCERTAIN";
        await prisma.messageJob.updateMany({
          where: { id: candidate.id, status: { in: ["SENDING", "UNCERTAIN"] } },
          data: {
            status,
            errorCode: String(
              provider.code ?? (submitted ? "PROVIDER_UNCERTAIN" : "CONFIGURATION_ERROR"),
            ),
            dueAt: new Date(Date.now() + 60000 * 2 ** candidate.attempts),
            leaseUntil: null,
          },
        });
        logger.warn("Message dispatch did not complete", { jobId: candidate.id, status });
      }
    });
  return candidates.length;
}

export async function applyDeliveryStatus(id: string, body: Record<string, string>) {
  const known = ["queued", "sending", "sent", "delivered", "read", "failed", "undelivered"];
  if (!known.includes(body.MessageStatus ?? "")) return;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM message_jobs WHERE id = ${id} AND "tenantId" = ${tenantId()} FOR UPDATE`;
    const job = await tx.messageJob.findFirst({ where: { id } });
    if (
      !job ||
      (job.providerSid && job.providerSid !== body.MessageSid) ||
      !["SENDING", "UNCERTAIN", "ACCEPTED", "SENT", "DELIVERED", "READ", "UNDELIVERED"].includes(
        job.status,
      )
    )
      return;
    const next =
      body.MessageStatus === "failed" || body.MessageStatus === "undelivered"
        ? "UNDELIVERED"
        : body.MessageStatus === "queued" || body.MessageStatus === "sending"
          ? "ACCEPTED"
          : body.MessageStatus.toUpperCase();
    const rank: Record<string, number> = {
      SENDING: 0,
      UNCERTAIN: 0,
      ACCEPTED: 1,
      SENT: 2,
      UNDELIVERED: 3,
      DELIVERED: 4,
      READ: 5,
    };
    if ((rank[next] ?? 0) < (rank[job.status] ?? 0)) return;
    await tx.messageJob.update({
      where: { id },
      data: {
        providerSid: body.MessageSid,
        status: next,
        errorCode: /^\d+$/.test(body.ErrorCode ?? "") ? body.ErrorCode : null,
        leaseUntil: null,
      },
    });
  });
}

export async function inboundOptOut(body: Record<string, string>) {
  const channel = body.From?.startsWith("whatsapp:") ? "WHATSAPP" : "SMS";
  const config = senderConfig(tenantId());
  if (body.To !== (channel === "WHATSAPP" ? config?.whatsappFrom : config?.smsFrom)) return;
  if (
    !/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)$/i.test(body.Body?.trim() ?? "") &&
    body.OptOutType !== "STOP"
  )
    return;
  const destination = normalizePhone(body.From?.replace(/^whatsapp:/, "") ?? null);
  if (!destination) return;
  const consents = await prisma.channelConsent.findMany({ where: { channel, destination } });
  for (const consent of consents) await withdrawChannel(consent.id, "provider-webhook");
}

export async function withdrawChannel(consentId: string, actorId = "customer-link") {
  const consent = await prisma.channelConsent.findFirst({ where: { id: consentId } });
  if (!consent) return;
  const { channel, destination } = consent;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM customers WHERE id = ${consent.customerId} AND "tenantId" = ${tenantId()} FOR UPDATE`;
    const current = await tx.channelConsent.findFirst({ where: { id: consent.id } });
    if (!current || (!current.service && !current.marketing)) return;
    const data = {
      service: false,
      marketing: false,
      preferred: false,
      revision: current.revision + 1,
    };
    await tx.channelConsent.update({ where: { id: current.id }, data });
    await tx.channelConsentEvent.create({
      data: {
        tenantId: tenantId(),
        customerId: current.customerId,
        channel,
        destination,
        ...data,
        noticeVersion: actorId === "provider-webhook" ? "PROVIDER_STOP" : "CUSTOMER_UNSUBSCRIBE",
        serviceText: "Channel withdrawal",
        marketingText: "Channel withdrawal",
        actorId,
      },
    });
    await tx.messageJob.updateMany({
      where: {
        customerId: current.customerId,
        status: { in: ["PENDING", "RETRY"] },
        OR: [{ channel }, { channel: null }],
      },
      data: { status: "SUPPRESSED", errorCode: "OPTED_OUT" },
    });
  });
}
