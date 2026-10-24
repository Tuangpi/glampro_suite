import { randomBytes } from "node:crypto";
import type { AssistantDraftInput } from "@glampro_suite/shared";
import type { AssistantDraft } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { conflict, forbidden, notFound } from "../lib/http-error.js";
import { moduleEntitlements } from "../lib/entitlements.js";
import { assertSender, publicOrigin, senderConfig } from "../lib/messaging-provider.js";
import { salonDayBounds } from "../lib/wall-clock.js";
import { aiAssistantService } from "./ai-assistant.service.js";
import { assertMessagingAccess, hashToken, tenantId, type Tx } from "./messaging.service.js";

export async function assistantActor(id: string, tokenVersion?: number) {
  const actor = await prisma.user.findFirst({ where: { id, disabled: false } });
  if (
    !actor ||
    !["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole) ||
    (tokenVersion !== undefined && actor.tokenVersion !== tokenVersion)
  )
    throw forbidden();
  return actor;
}
export async function assistantUnsubscribeIsCurrent(tx: Tx, draft: AssistantDraft) {
  const token = draft.body.split("/api/public/messages/").at(-1);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const link = await tx.publicLink.findFirst({
    where: {
      tokenHash: hashToken(token),
      kind: "UNSUBSCRIBE",
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  return (
    !!link &&
    !!(await tx.channelConsent.findFirst({
      where: {
        id: link.targetId,
        customerId: draft.customerId,
        channel: "SMS",
        destination: draft.destination,
      },
    }))
  );
}
async function access() {
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId) throw forbidden();
  const actor = await assistantActor(scope.actorId);
  const tenant = await assertMessagingAccess();
  const { entitled } = await moduleEntitlements();
  if (!["dashboard", "customers", "appointments"].every((code) => entitled.has(code)))
    throw forbidden();
  return { actor, tenant };
}
async function eligible(input: AssistantDraftInput) {
  const { nudges } = await aiAssistantService.rebookingNudges({});
  if (
    !nudges.some(
      (n) =>
        n.customerId === input.customerId &&
        n.appointmentId === input.appointmentId &&
        n.channel === input.channel &&
        n.destination === input.destination,
    )
  )
    throw conflict("Recipient is no longer eligible. Refresh recommendations.", "DRAFT_INELIGIBLE");
}
async function event(tx: Tx, draft: AssistantDraft, actorId: string, action: string) {
  await tx.assistantDraftEvent.create({
    data: {
      tenantId: tenantId(),
      draftId: draft.id,
      actorId,
      version: draft.version,
      action,
      snapshot: {
        customerId: draft.customerId,
        appointmentId: draft.appointmentId,
        channel: draft.channel,
        destination: draft.destination,
        message: draft.message,
        body: draft.body,
        sender: draft.sender,
        status: draft.status,
      },
    },
  });
}
export async function listAssistantDrafts(cursor?: string) {
  await access();
  const rows = await prisma.assistantDraft.findMany({
    where: cursor ? { id: { lt: cursor } } : {},
    orderBy: { id: "desc" },
    take: 21,
    include: { job: { select: { id: true, status: true, errorCode: true } } },
  });
  return { drafts: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19]!.id : null };
}
export async function assistantDraftHistory(id: string, cursor?: string) {
  await access();
  if (!(await prisma.assistantDraft.findFirst({ where: { id } }))) throw notFound();
  const rows = await prisma.assistantDraftEvent.findMany({
    where: { draftId: id, ...(cursor ? { id: { lt: cursor } } : {}) },
    orderBy: { id: "desc" },
    take: 21,
  });
  return { events: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19]!.id : null };
}
export async function saveAssistantDraft(
  input: AssistantDraftInput,
  id?: string,
  expectedVersion?: number,
) {
  const { actor, tenant } = await access();
  const origin = publicOrigin();
  const config = senderConfig(tenantId());
  assertSender(config, "SMS", "REBOOKING");
  return prisma.$transaction(async (tx) => {
    if (id)
      await tx.$queryRaw`SELECT id FROM assistant_drafts WHERE id = ${id} AND "tenantId" = ${tenantId()} FOR UPDATE`;
    const previous = id ? await tx.assistantDraft.findFirst({ where: { id } }) : null;
    if (id && !previous) throw notFound();
    if (previous && (previous.version !== expectedVersion || previous.status === "QUEUED"))
      throw conflict("Draft changed or is already queued. Reload it.", "DRAFT_STALE");
    await eligible(input);
    const choice = await tx.channelConsent.findFirstOrThrow({
      where: { customerId: input.customerId, channel: "SMS" },
    });
    const token = randomBytes(32).toString("base64url");
    await tx.publicLink.create({
      data: {
        tenantId: tenantId(),
        tokenHash: hashToken(token),
        kind: "UNSUBSCRIBE",
        targetId: choice.id,
        expiresAt: new Date(Date.now() + 365 * 86400000),
      },
    });
    const data = {
      ...input,
      body: `${tenant.name}: ${input.message} Unsubscribe: ${origin}/api/public/messages/${token}`,
      sender: config!.smsFrom!,
      origin,
      status: "DRAFT",
      approvedById: null,
      approvedTokenVersion: null,
    };
    const draft = previous
      ? await tx.assistantDraft.update({
          where: { id },
          data: { ...data, version: { increment: 1 } },
        })
      : await tx.assistantDraft.create({
          data: {
            ...data,
            tenantId: tenantId(),
            reviewDueAt: new Date(Date.now() + 30 * 86400000),
          },
        });
    await event(tx, draft, actor.id, previous ? "EDITED" : "CREATED");
    return draft;
  });
}
export async function reviewAssistantDraft(id: string, expectedVersion: number, reason: string) {
  const { actor } = await access();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM assistant_drafts WHERE id = ${id} AND "tenantId" = ${tenantId()} FOR UPDATE`;
    const draft = await tx.assistantDraft.findFirst({ where: { id } });
    if (!draft) throw notFound();
    if (draft.version !== expectedVersion)
      throw conflict("Draft changed. Reload it.", "DRAFT_STALE");
    // A review is a recorded decision to retain, not permission to send an old version.
    const updated = await tx.assistantDraft.update({
      where: { id },
      data: {
        reviewDueAt: new Date(Date.now() + 30 * 86400000),
        ...(draft.status !== "QUEUED"
          ? {
              status: "DRAFT",
              approvedById: null,
              approvedTokenVersion: null,
              version: { increment: 1 },
            }
          : {}),
      },
    });
    await tx.assistantDraftEvent.create({
      data: {
        tenantId: tenantId(),
        draftId: id,
        actorId: actor.id,
        version: updated.version,
        action: "RETENTION_REVIEWED",
        snapshot: { reason, reviewDueAt: updated.reviewDueAt.toISOString() },
      },
    });
    return updated;
  });
}

export async function actOnAssistantDraft(
  id: string,
  expectedVersion: number,
  action: "approve" | "queue",
) {
  const { actor, tenant } = await access();
  return prisma.$transaction(async (tx) => {
    // Tenant lock serializes daily quota checks; customer lock shares automatic dispatch exclusion.
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId()} FOR NO KEY UPDATE`;
    await tx.$queryRaw`SELECT id FROM assistant_drafts WHERE id = ${id} AND "tenantId" = ${tenantId()} FOR UPDATE`;
    const draft = await tx.assistantDraft.findFirst({ where: { id } });
    if (!draft) throw notFound();
    if (draft.version !== expectedVersion)
      throw conflict("Draft changed. Reload before approval.", "DRAFT_STALE");
    if (draft.status === "QUEUED" && action === "queue") return draft;
    if (draft.status !== (action === "approve" ? "DRAFT" : "APPROVED"))
      throw conflict("Invalid draft state.");
    if (draft.reviewDueAt <= new Date())
      throw conflict("Retention review is due. Delivery is blocked.");
    if (!(await assistantUnsubscribeIsCurrent(tx, draft)))
      throw conflict("Unsubscribe link expired or changed. Save a new version.");
    await tx.$queryRaw`SELECT id FROM customers WHERE id = ${draft.customerId} AND "tenantId" = ${tenantId()} FOR UPDATE`;
    await eligible({ ...draft, channel: "SMS" });
    const config = senderConfig(tenantId());
    assertSender(config, "SMS", "REBOOKING");
    if (draft.origin !== publicOrigin() || draft.sender !== config!.smsFrom)
      throw conflict("Sender configuration changed. Save a new version.");
    if (action === "queue") {
      await assistantActor(draft.approvedById!, draft.approvedTokenVersion!);
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: tenant.timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const bounds = salonDayBounds(day, tenant.timeZone);
      if (
        (await tx.messageJob.count({
          where: {
            assistantDraftId: { not: null },
            createdAt: { gte: bounds.from, lt: bounds.to },
          },
        })) >= 20
      )
        throw conflict(
          "Daily limit of 20 assistant queue entries reached.",
          "ASSISTANT_DAILY_LIMIT",
        );
      const booking = await tx.appointment.findFirstOrThrow({ where: { id: draft.appointmentId } });
      await tx.messageJob.create({
        data: {
          tenantId: tenantId(),
          customerId: draft.customerId,
          appointmentId: draft.appointmentId,
          revision: booking.messageRevision,
          assistantDraftId: draft.id,
          kind: "REBOOKING",
          channel: "SMS",
          destination: draft.destination,
          dueAt: new Date(),
        },
      });
    }
    const updated = await tx.assistantDraft.update({
      where: { id },
      data:
        action === "approve"
          ? { status: "APPROVED", approvedById: actor.id, approvedTokenVersion: actor.tokenVersion }
          : { status: "QUEUED", queuedById: actor.id, queuedTokenVersion: actor.tokenVersion },
    });
    await event(tx, updated, actor.id, action === "approve" ? "APPROVED" : "QUEUED");
    return updated;
  });
}
