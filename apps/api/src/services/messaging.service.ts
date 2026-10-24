import { createHash, randomBytes } from "node:crypto";
import {
  messagingSettingsSchema,
  type MessagingSettingsInput,
  type ChannelConsentInput,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope, runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { conflict, forbidden, notFound } from "../lib/http-error.js";
import {
  publicOrigin,
  senderConfig,
  assertSender,
  type Channel,
} from "../lib/messaging-provider.js";
import { resolveTenantStatus } from "../lib/tenant-status.js";
import { moduleEntitlements } from "../lib/entitlements.js";
import { getSale } from "./sale.service.js";
import { getSalonProfile } from "./settings.service.js";
import { rebookingInterval } from "./rebooking-policy.js";

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export function tenantId() {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw forbidden();
  return scope.tenantId;
}
export async function lockBookingCalendar(tx: Tx): Promise<void> {
  await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId()} FOR NO KEY UPDATE`;
}
export function normalizePhone(value: string | null): string | null {
  const normalized = value?.replace(/[\s().-]/g, "") ?? "";
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}
export async function assertMessagingAccess(module?: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId() },
    include: { subscriptions: { orderBy: { endDate: "desc" }, take: 1 } },
  });
  if (resolveTenantStatus(tenant.status, tenant.subscriptions[0]?.endDate ?? null) !== "ACTIVE")
    throw forbidden("Messaging requires an active salon.");
  if (module && !(await moduleEntitlements()).entitled.has(module))
    throw forbidden("Module is not entitled.");
  return tenant;
}
export async function getMessagingSettings() {
  const settings = await prisma.messagingSettings.findFirst();
  return messagingSettingsSchema.parse(
    settings
      ? {
          whatsappEnabled: settings.whatsappEnabled,
          smsEnabled: settings.smsEnabled,
          reminderHours: settings.reminderHours,
          rebookingDays: settings.rebookingDays,
          quietStart: settings.quietStart,
          quietEnd: settings.quietEnd,
          cancellationHours: settings.cancellationHours,
          consentVersion: settings.consentVersion,
          serviceConsentText: settings.serviceConsentText,
          marketingConsentText: settings.marketingConsentText,
        }
      : {},
  );
}
export async function saveMessagingSettings(input: MessagingSettingsInput) {
  if (input.whatsappEnabled || input.smsEnabled) {
    publicOrigin();
    if (!input.consentVersion || !input.serviceConsentText || !input.marketingConsentText)
      throw conflict("Publish channel consent wording before enabling delivery.");
    for (const channel of ["SMS", "WHATSAPP"] as const) {
      if (channel === "SMS" ? input.smsEnabled : input.whatsappEnabled) {
        for (const kind of ["CONFIRMATION", "REMINDER", "REBOOKING", "RECEIPT"] as const)
          assertSender(senderConfig(tenantId()), channel, kind);
      }
    }
  }
  const previous = await getMessagingSettings();
  if (
    previous.consentVersion === input.consentVersion &&
    (previous.serviceConsentText !== input.serviceConsentText ||
      previous.marketingConsentText !== input.marketingConsentText)
  )
    throw conflict("Use a new consent version when changing wording.");
  const existingVersion = await prisma.channelConsentEvent.findFirst({
    where: { noticeVersion: input.consentVersion },
  });
  if (
    existingVersion &&
    (existingVersion.serviceText !== input.serviceConsentText ||
      existingVersion.marketingText !== input.marketingConsentText)
  )
    throw conflict("Consent versions cannot be reused with different wording.");
  const existing = await prisma.messagingSettings.findFirst();
  if (existing) await prisma.messagingSettings.update({ where: { id: existing.id }, data: input });
  else await prisma.messagingSettings.create({ data: { tenantId: tenantId(), ...input } });
  return getMessagingSettings();
}
export async function getChannelConsents(customerId: string) {
  if (!(await prisma.customer.findFirst({ where: { id: customerId } }))) throw notFound();
  return {
    choices: await prisma.channelConsent.findMany({ where: { customerId } }),
    settings: await getMessagingSettings(),
  };
}
export async function recordChannelConsent(
  customerId: string,
  input: ChannelConsentInput,
  actorId: string,
) {
  const settings = await getMessagingSettings();
  await prisma.$transaction(async (tx) => {
    // Shared customer lock serializes channel choices, worker dispatch and opt-out.
    await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId} AND "tenantId" = ${tenantId()} FOR UPDATE`;
    const customer = await tx.customer.findFirst({ where: { id: customerId } });
    if (!customer) throw notFound();
    const existing = await tx.channelConsent.findFirst({
      where: { customerId, channel: input.channel },
    });
    if ((existing?.revision ?? 0) !== input.expectedRevision)
      throw conflict("Channel choices changed. Reload.");
    const destination = normalizePhone(customer.phone);
    const granting =
      (input.service && (!existing?.service || existing.destination !== destination)) ||
      (input.marketing && (!existing?.marketing || existing.destination !== destination));
    if (
      granting &&
      (!destination ||
        !customer.pdpaConsent ||
        !input.presented ||
        !settings.consentVersion ||
        input.noticeVersion !== settings.consentVersion ||
        !settings.serviceConsentText ||
        !settings.marketingConsentText)
    )
      throw conflict(
        "Present the current channel notice, record data consent and save an international phone number first.",
      );
    if (granting && input.marketing && !customer.marketingOptIn)
      throw forbidden("Record optional marketing consent first.");
    if (input.preferred)
      await tx.channelConsent.updateMany({ where: { customerId }, data: { preferred: false } });
    const data = {
      destination: destination ?? existing?.destination ?? "",
      service: input.service,
      marketing: input.marketing,
      preferred: input.preferred,
      revision: input.expectedRevision + 1,
    };
    if (existing) await tx.channelConsent.update({ where: { id: existing.id }, data });
    else
      await tx.channelConsent.create({
        data: { tenantId: tenantId(), customerId, channel: input.channel, ...data },
      });
    await tx.channelConsentEvent.create({
      data: {
        tenantId: tenantId(),
        customerId,
        channel: input.channel,
        ...data,
        noticeVersion: settings.consentVersion,
        serviceText: settings.serviceConsentText,
        marketingText: settings.marketingConsentText,
        actorId,
      },
    });
  });
  return getChannelConsents(customerId);
}

export async function queueAppointmentMessages(tx: Tx, id: string) {
  const appointment = await tx.appointment.findFirstOrThrow({ where: { id } });
  await tx.messageJob.updateMany({
    where: { appointmentId: id, status: { in: ["PENDING", "RETRY"] } },
    data: { status: "CANCELLED" },
  });
  await tx.publicLink.updateMany({
    where: { kind: "BOOKING", targetId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!appointment.customerId) return;
  const settings = await tx.messagingSettings.findFirst();
  if (!settings?.whatsappEnabled && !settings?.smsEnabled) return;
  const now = new Date();
  const base = {
    tenantId: appointment.tenantId,
    appointmentId: id,
    customerId: appointment.customerId,
    revision: appointment.messageRevision,
  };
  if (appointment.status === "SCHEDULED" && appointment.startsAt > now) {
    await tx.messageJob.create({ data: { ...base, kind: "CONFIRMATION", dueAt: now } });
    const dueAt = new Date(
      appointment.startsAt.getTime() - (settings?.reminderHours ?? 24) * 3600000,
    );
    if (dueAt > now) await tx.messageJob.create({ data: { ...base, kind: "REMINDER", dueAt } });
  }
  if (appointment.status === "COMPLETED" && appointment.finishedAt) {
    const service = appointment.serviceId
      ? await tx.service.findFirst({
          where: { id: appointment.serviceId },
          select: { interval: true },
        })
      : null;
    await tx.messageJob.create({
      data: {
        ...base,
        kind: "REBOOKING",
        dueAt: new Date(
          appointment.finishedAt.getTime() +
            rebookingInterval(service?.interval, settings?.rebookingDays) * 86400000,
        ),
      },
    });
  }
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export async function issueLink(kind: "BOOKING" | "RECEIPT", targetId: string) {
  await assertMessagingAccess(kind === "BOOKING" ? "appointments" : "sales");
  const origin = publicOrigin();
  return prisma.$transaction(
    async (tx) => {
      let revision = 0;
      let expiresAt = new Date(Date.now() + 30 * 86400000);
      if (kind === "BOOKING") {
        await lockBookingCalendar(tx);
        await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${targetId} AND "tenantId" = ${tenantId()} FOR UPDATE`;
        const booking = await tx.appointment.findFirst({ where: { id: targetId } });
        if (!booking || booking.status !== "SCHEDULED" || booking.startsAt <= new Date())
          throw conflict("Only future scheduled bookings can have action links.");
        revision = booking.messageRevision;
        expiresAt = booking.startsAt;
      } else {
        const sale = await tx.sale.findFirst({ where: { id: targetId } });
        if (!sale || sale.status === "HELD") throw conflict("Complete the sale first.");
      }
      const token = randomBytes(32).toString("base64url");
      await tx.publicLink.create({
        data: {
          tenantId: tenantId(),
          kind,
          targetId,
          revision,
          tokenHash: hashToken(token),
          expiresAt,
        },
      });
      return { url: `${origin}/api/public/messages/${token}`, expiresAt };
    },
    { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 30_000 },
  );
}
export async function revokeLinks(kind: string, targetId: string) {
  await prisma.publicLink.updateMany({
    where: { kind, targetId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
export async function withPublicLink<T>(
  token: string,
  fn: (link: { id: string; targetId: string; revision: number; kind: string }) => Promise<T>,
) {
  if (!/^[\w-]{43}$/.test(token)) throw notFound("Link is unavailable.");
  const link = await runAsPlatform(() =>
    prisma.publicLink.findUnique({ where: { tokenHash: hashToken(token) } }),
  );
  if (!link || link.revokedAt || link.expiresAt <= new Date())
    throw notFound("Link is unavailable or expired.");
  return runAsTenant(link.tenantId, async () => {
    if (link.kind !== "UNSUBSCRIBE")
      await assertMessagingAccess(link.kind === "BOOKING" ? "appointments" : "sales");
    return fn(link);
  });
}
export async function publicBookingAction(
  link: { id: string; targetId: string; revision: number; kind: string },
  action: "confirm" | "cancel",
) {
  if (link.kind !== "BOOKING") throw notFound();
  const settings = await getMessagingSettings();
  await prisma.$transaction(
    async (tx) => {
      await lockBookingCalendar(tx);
      await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${link.targetId} AND "tenantId" = ${tenantId()} FOR UPDATE`;
      const currentLink = await tx.publicLink.findFirst({
        where: { id: link.id, revokedAt: null, expiresAt: { gt: new Date() } },
      });
      const booking = await tx.appointment.findFirst({ where: { id: link.targetId } });
      if (
        !currentLink ||
        !booking ||
        booking.messageRevision !== link.revision ||
        booking.status !== "SCHEDULED" ||
        booking.startsAt <= new Date()
      )
        throw conflict("This booking link is no longer current.");
      if (
        action === "cancel" &&
        booking.startsAt.getTime() - Date.now() <= settings.cancellationHours * 3600000
      )
        throw conflict("Contact the salon to cancel this appointment.");
      await tx.appointment.update({
        where: { id: booking.id },
        data:
          action === "confirm"
            ? { customerConfirmedAt: booking.customerConfirmedAt ?? new Date() }
            : { status: "CANCELLED", customerConfirmedAt: null, messageRevision: { increment: 1 } },
      });
      if (action === "cancel") await queueAppointmentMessages(tx, booking.id);
    },
    { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 30_000 },
  );
}
export async function queueReceipt(saleId: string, channel: Channel) {
  const sale = await getSale(saleId);
  if (sale.status === "HELD" || !sale.customerId)
    throw conflict("A completed sale with a saved customer is required.");
  const config = await getMessagingSettings();
  if (!(channel === "SMS" ? config.smsEnabled : config.whatsappEnabled))
    throw conflict("This channel is disabled.");
  assertSender(senderConfig(tenantId()), channel, "RECEIPT");
  publicOrigin();
  // Transaction lock prevents double-clicks from creating duplicate receipt jobs.
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM sales WHERE id = ${saleId} AND "tenantId" = ${tenantId()} FOR UPDATE`;
    const existing = await tx.messageJob.findFirst({
      where: {
        saleId,
        channel,
        kind: "RECEIPT",
        status: { notIn: ["FAILED", "CANCELLED", "SUPPRESSED"] },
      },
    });
    if (existing) return { id: existing.id, status: existing.status };
    const row = await tx.messageJob.create({
      data: {
        tenantId: tenantId(),
        saleId,
        customerId: sale.customerId,
        channel,
        kind: "RECEIPT",
        dueAt: new Date(),
      },
    });
    return { id: row.id, status: row.status };
  });
}
export async function retryMessage(id: string) {
  // Uncertain, accepted and delivered messages are never blindly resubmitted.
  const result = await prisma.messageJob.updateMany({
    where: { id, status: "FAILED", providerSid: null, errorCode: { not: "21610" } },
    data: { status: "RETRY", dueAt: new Date(), attempts: 0, errorCode: null },
  });
  if (!result.count) throw conflict("Only definitely failed, unaccepted messages can be retried.");
}
export async function publicReceipt(targetId: string) {
  const [sale, salon] = await Promise.all([getSale(targetId), getSalonProfile()]);
  if (sale.status === "HELD") throw notFound();
  return { sale, salon };
}
