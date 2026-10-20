import {
  customerConsentSchema,
  privacyNoticeSchema,
  type ConfigurePrivacyNoticeInput,
  type RecordCustomerConsentInput,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { conflict, forbidden, notFound } from "../lib/http-error.js";
import { Prisma } from "../../generated/prisma/client.js";
import { withdrawMessagingChoices } from "./messaging-consent.js";
import { currentScope } from "../lib/tenant-context.js";

function serializeNotice(row: NonNullable<Awaited<ReturnType<typeof currentNotice>>>) {
  return privacyNoticeSchema.parse({
    id: row.id,
    version: row.version,
    dataConsentText: row.dataConsentText,
    marketingConsentText: row.marketingConsentText,
    createdAt: row.createdAt.toISOString(),
  });
}

function currentNotice() {
  return prisma.privacyNotice.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}

export async function getPrivacyNotice() {
  const row = await currentNotice();
  return row ? serializeNotice(row) : null;
}

export async function configurePrivacyNotice(input: ConfigurePrivacyNoticeInput, actorId: string) {
  // Versions cannot be reused, even after a newer version has been published.
  if (await prisma.privacyNotice.findFirst({ where: { version: input.version } })) {
    throw conflict(
      "Use a new notice version; published wording cannot be changed.",
      "NOTICE_VERSION_EXISTS",
    );
  }
  try {
    const row = await prisma.privacyNotice.create({
      data: { tenantId: "", ...input, createdById: actorId },
    });
    return serializeNotice(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw conflict(
        "Use a new notice version; published wording cannot be changed.",
        "NOTICE_VERSION_EXISTS",
      );
    }
    throw error;
  }
}

export async function getCustomerConsent(customerId: string, page = 1, pageSize = 20) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId } });
  if (!customer) throw notFound("That customer does not exist.", "CUSTOMER_NOT_FOUND");
  const [notice, events, total] = await Promise.all([
    getPrivacyNotice(),
    prisma.customerConsentEvent.findMany({
      where: { customerId },
      orderBy: { revision: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { notice: true },
    }),
    prisma.customerConsentEvent.count({ where: { customerId } }),
  ]);
  return customerConsentSchema.parse({
    pdpaConsent: customer.pdpaConsent,
    marketingOptIn: customer.marketingOptIn,
    revision: customer.consentRevision,
    currentNotice: notice,
    total,
    page,
    pageSize,
    history: events.map((event) => ({
      ...event,
      recordedAt: event.recordedAt.toISOString(),
      notice: event.notice ? serializeNotice(event.notice) : null,
    })),
  });
}

export async function recordCustomerConsent(
  customerId: string,
  input: RecordCustomerConsentInput,
  actorId: string,
) {
  await prisma.$transaction(async (tx) => {
    const scope = currentScope();
    if (scope?.kind !== "tenant") throw forbidden();
    await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId} AND "tenantId" = ${scope.tenantId} FOR UPDATE`;
    const customer = await tx.customer.findFirst({ where: { id: customerId } });
    if (!customer) throw notFound("That customer does not exist.", "CUSTOMER_NOT_FOUND");
    if (customer.consentRevision !== input.expectedRevision) {
      throw conflict("Consent changed. Reload before recording a new choice.", "CONSENT_CHANGED");
    }
    const notice = await tx.privacyNotice.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const granting =
      (!customer.pdpaConsent && input.pdpaConsent) ||
      (!customer.marketingOptIn && input.marketingOptIn);
    if (granting && (!notice || notice.id !== input.noticeId)) {
      throw conflict(
        "Review the current privacy notice before recording consent.",
        "PRIVACY_NOTICE_REQUIRED",
      );
    }
    if (input.marketingOptIn && !input.pdpaConsent) {
      throw forbidden("Marketing opt-in requires personal-data consent.", "CONSENT_REQUIRED");
    }
    if (
      customer.pdpaConsent === input.pdpaConsent &&
      customer.marketingOptIn === input.marketingOptIn
    )
      return;
    const changed = await tx.customer.updateMany({
      where: { id: customerId, consentRevision: input.expectedRevision },
      data: {
        pdpaConsent: input.pdpaConsent,
        marketingOptIn: input.marketingOptIn,
        consentRevision: { increment: 1 },
      },
    });
    if (changed.count !== 1)
      throw conflict("Consent changed. Reload before recording a new choice.", "CONSENT_CHANGED");
    await tx.customerConsentEvent.create({
      data: {
        tenantId: "",
        customerId,
        revision: input.expectedRevision + 1,
        pdpaConsent: input.pdpaConsent,
        marketingOptIn: input.marketingOptIn,
        recordedById: actorId,
        // Withdrawal never asserts that newly published wording was presented.
        noticeId: notice?.id === input.noticeId ? notice.id : null,
      },
    });
    if (!input.pdpaConsent || !input.marketingOptIn) {
      await withdrawMessagingChoices(
        tx,
        customerId,
        actorId,
        !input.pdpaConsent ? "DATA_CONSENT_WITHDRAWN" : "MARKETING_WITHDRAWN",
        input.pdpaConsent,
      );
    }
  });
  return getCustomerConsent(customerId);
}

/** Future promotional consumers must call this immediately before dispatch, not at queue time. */
export async function requireMarketingConsent(customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId },
    select: { pdpaConsent: true, marketingOptIn: true },
  });
  if (!customer) throw notFound("That customer does not exist.", "CUSTOMER_NOT_FOUND");
  if (!customer.pdpaConsent || !customer.marketingOptIn) {
    throw forbidden("This customer has not opted in to marketing.", "MARKETING_CONSENT_REQUIRED");
  }
}
