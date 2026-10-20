import { prisma } from "../lib/prisma.js";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
/** Call while holding the customer row lock, in the same transaction as the change. */
export async function withdrawMessagingChoices(
  tx: Tx,
  customerId: string,
  actorId: string,
  reason: string,
  marketingOnly = false,
) {
  const choices = await tx.channelConsent.findMany({ where: { customerId } });
  for (const choice of choices) {
    if (
      marketingOnly ? !choice.marketing : !choice.service && !choice.marketing && !choice.preferred
    )
      continue;
    const data = {
      service: marketingOnly ? choice.service : false,
      marketing: false,
      preferred: marketingOnly ? choice.preferred : false,
      revision: choice.revision + 1,
    };
    await tx.channelConsent.update({ where: { id: choice.id }, data });
    await tx.channelConsentEvent.create({
      data: {
        tenantId: choice.tenantId,
        customerId,
        channel: choice.channel,
        destination: choice.destination,
        ...data,
        noticeVersion: reason,
        serviceText: "Permission withdrawal; original wording retained in earlier events.",
        marketingText: "Permission withdrawal; original wording retained in earlier events.",
        actorId,
      },
    });
  }
  await tx.messageJob.updateMany({
    where: {
      customerId,
      status: { in: ["PENDING", "RETRY"] },
      ...(marketingOnly ? { kind: "REBOOKING" } : {}),
    },
    data: { status: "SUPPRESSED", errorCode: reason },
  });
}
