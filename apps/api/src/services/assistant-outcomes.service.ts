import { assistantDelivery, assistantOutcomeSchema } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { moduleEntitlements } from "../lib/entitlements.js";
import { notFound } from "../lib/http-error.js";
import { assistantDraftAccess } from "./assistant-drafts.service.js";
import { tenantId } from "./messaging.service.js";

export async function assistantDraftOutcome(id: string) {
  await assistantDraftAccess();
  const companyId = tenantId();
  const draft = await prisma.assistantDraft.findFirst({
    where: { id, tenantId: companyId },
    select: { customerId: true, job: { select: { status: true, createdAt: true } } },
  });
  if (!draft) throw notFound();
  const { entitled } = await moduleEntitlements();
  const asOf = new Date();
  const from = draft.job?.createdAt ?? null;
  const to = from ? new Date(Math.min(asOf.getTime(), from.getTime() + 30 * 86400000)) : null;
  const salesVisible = entitled.has("sales");
  // Counts are observations, not conversions. Never read clinical notes, amounts or payment data.
  const [bookingsCreated, completedSales] =
    from && to
      ? await Promise.all([
          prisma.appointment.count({
            where: {
              tenantId: companyId,
              customerId: draft.customerId,
              createdAt: { gte: from, lt: to },
              status: { not: "CANCELLED" },
            },
          }),
          salesVisible
            ? prisma.sale.count({
                where: {
                  tenantId: companyId,
                  customerId: draft.customerId,
                  soldAt: { gte: from, lt: to },
                  status: "COMPLETED",
                },
              })
            : null,
        ])
      : [null, null];
  return assistantOutcomeSchema.parse({
    asOf: asOf.toISOString(),
    from: from?.toISOString() ?? null,
    to: to?.toISOString() ?? null,
    windowDays: 30,
    jobStatus: draft.job?.status ?? null,
    delivery: assistantDelivery(draft.job?.status ?? null),
    bookingsCreated,
    completedSales,
    salesVisible,
    limitations: [
      "Company-wide same-customer observations, not attributed conversions, incremental revenue or proof that the message caused activity. Do not sum across drafts.",
      "Half-open UTC window: queue creation through the earlier of 30 elapsed days or as-of. Activity may precede dispatch or occur after failed/suppressed messages.",
      "Bookings count records created in the window, excluding currently cancelled bookings; not visits or completed services. Sales count currently completed receipts by soldAt, not revenue, profit or refund-adjusted value.",
      "Current records and latest provider status only; later edits, cancellations, refunds or deletion can change observations. No click, campaign or booking-to-sale tracking exists.",
      "Provider-reported delivery is not proof of reading or action. Pending, retry, accepted and uncertain are not delivery confirmation. Never blindly resend uncertain messages.",
    ],
  });
}
