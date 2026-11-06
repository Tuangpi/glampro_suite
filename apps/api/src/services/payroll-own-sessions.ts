import { z } from "zod";
import { payrollPeriodKeySchema } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { currentScope } from "../lib/tenant-context.js";
import { forbidden } from "../lib/http-error.js";
import { salonDayBounds } from "../lib/wall-clock.js";
import { redemptionCommissionEvidenceSchema } from "./redemption-commission-evidence.js";

export const ownSessionsQuerySchema = z.strictObject({
  period: payrollPeriodKeySchema,
  page: z.coerce.number().int().min(1).max(100000).default(1),
});

/** Caller identity is server-owned. No customer name, signature image, colleagues'
 * shares or salary can enter this self-service projection. */
export async function ownPayrollSessions(raw: unknown) {
  const query = ownSessionsQuerySchema.parse(raw);
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId) throw forbidden();
  return prisma.$transaction(
    async (tx) => {
      const actor = await tx.user.findFirst({
        where: { id: scope.actorId, disabled: false },
        select: { globalRole: true },
      });
      if (!actor || !["STAFF", "MANAGER", "SUPER_ADMIN"].includes(actor.globalRole))
        throw forbidden();
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: scope.tenantId },
        select: { timeZone: true },
      });
      const [year, month] = query.period.split("-").map(Number);
      const next = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
      const redemptions = await tx.customerRedemption.findMany({
        where: {
          itemType: "PACKAGE",
          usedAt: {
            gte: salonDayBounds(`${query.period}-01`, tenant.timeZone).from,
            lt: salonDayBounds(next, tenant.timeZone).from,
          },
        },
        orderBy: [{ usedAt: "desc" }, { id: "asc" }],
        select: { id: true, usedAt: true, quantity: true, revertedAt: true, itemId: true },
      });
      const snapshots = redemptions.length
        ? await tx.commissionRedemptionSnapshot.findMany({
            where: { redemptionId: { in: redemptions.map((row) => row.id) } },
            orderBy: [{ redemptionId: "asc" }, { revision: "desc" }],
            distinct: ["redemptionId"],
            select: { redemptionId: true, evidence: true },
          })
        : [];
      const latestById = new Map<string, (typeof snapshots)[number]>();
      for (const snapshot of snapshots) {
        if (!latestById.has(snapshot.redemptionId)) latestById.set(snapshot.redemptionId, snapshot);
      }
      const rows = redemptions.flatMap((row) => {
        const latest = latestById.get(row.id);
        const evidence = latest
          ? redemptionCommissionEvidenceSchema.safeParse(latest.evidence)
          : null;
        const own = evidence?.success
          ? evidence.data.performers?.find((staff) => staff.staffId === scope.actorId)
          : null;
        return own
          ? [
              {
                id: row.id,
                usedAt: row.usedAt.toISOString(),
                quantity: row.quantity,
                share: own.share,
                packageId: row.itemId,
                status: row.revertedAt ? "VOIDED" : "ACTIVE",
              },
            ]
          : [];
      });
      const start = (query.page - 1) * 25;
      return {
        period: query.period,
        scope: "SELF",
        page: query.page,
        pages: Math.ceil(rows.length / 25),
        total: rows.length,
        rows: rows.slice(start, start + 25),
        evidence:
          "Recorded package-session attribution only; unavailable legacy evidence is not inferred.",
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
