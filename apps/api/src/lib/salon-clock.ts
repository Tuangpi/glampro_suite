import { prisma } from "./prisma.js";
import { currentScope } from "./tenant-context.js";

/**
 * The IANA zone the salon reads its clock in.
 *
 * A booking is an instant, but every time a person is shown — "booked
 * 09:00–09:45", a roster's opening hour — is that instant on the salon's wall
 * clock, not the server's. The zone is read per call rather than cached so a
 * salon that moves is followed immediately, and the read is one indexed row.
 */
export async function salonTimeZone(db: Pick<typeof prisma, "tenant"> = prisma): Promise<string> {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw new Error("The salon clock requires a tenant scope.");
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: scope.tenantId },
    select: { timeZone: true },
  });
  return tenant.timeZone;
}
