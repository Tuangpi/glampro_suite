import { randomUUID } from "node:crypto";
import { z } from "zod";
import { payrollPeriodKeySchema } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentOutletId, currentScope } from "../lib/tenant-context.js";
import { conflict, forbidden } from "../lib/http-error.js";
import { resolveTenantStatus } from "../lib/tenant-status.js";
import { salonDayBounds } from "../lib/wall-clock.js";
import { lockCommissionConfiguration } from "./commission.service.js";
import { resolvePayrollOpeningCarry, type PayrollOpeningCarry } from "./payroll-close-opening.js";
import {
  resolvePayrollCarrySettlements,
  type PayrollCarrySettlement,
} from "./payroll-close-settlements.js";
import { resolvePayrollCloseCarry } from "./payroll-close-carry.js";
import { payrollInputHash } from "./payroll-close-state.js";
import { verifiedPayrollClose, type PayrollCloseTransaction } from "./payroll-close-store.js";

type Authorization = Awaited<
  ReturnType<PayrollCloseTransaction["payrollCarryAuthorization"]["findMany"]>
>[number];
type Json = Parameters<
  PayrollCloseTransaction["payrollCarryAuthorization"]["create"]
>[0]["data"]["payload"];

/** Immutable approvals are historical evidence; later owner disablement does not
 * revoke them. Authenticated actor/time/reason are stamped by the write boundary. */
export function verifiedCarryAuthorizations(rows: Authorization[], tenantId: string) {
  const latest = new Map<string, Authorization>();
  for (const row of [...rows].sort((a, b) => a.revision - b.revision)) {
    const payload = row.payload as unknown as PayrollOpeningCarry | PayrollCarrySettlement;
    const key = JSON.stringify([row.kind, row.periodKey, row.targetId]);
    if (
      row.tenantId !== tenantId ||
      !["OPENING", "SETTLEMENT"].includes(row.kind) ||
      row.payloadHash !== payrollInputHash(payload) ||
      payload.id !== row.id ||
      payload.tenantId !== tenantId ||
      payload.periodKey !== row.periodKey ||
      payload.revision !== row.revision ||
      payload.approval.actorId !== row.actorId ||
      payload.approval.reason !== row.reason ||
      payload.approval.at !== row.createdAt.toISOString() ||
      (row.kind === "OPENING"
        ? row.targetId !== "opening"
        : row.targetId !== (payload as PayrollCarrySettlement).staffId) ||
      row.revision !== (latest.get(key)?.revision ?? 0) + 1
    )
      throw conflict("Payroll carry authorization audit mismatch.");
    latest.set(key, row);
  }
  return [...latest.values()];
}

export async function loadStoredPayrollCarry(
  tx: PayrollCloseTransaction,
  tenantId: string,
  periodKey: string,
  replacingSettlementStaffId?: string,
) {
  const [year, month] = periodKey.split("-").map(Number);
  const previousKey = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  const previous = await verifiedPayrollClose(tx, previousKey);
  const rows = verifiedCarryAuthorizations(
    await tx.payrollCarryAuthorization.findMany({
      where: { tenantId, OR: [{ kind: "OPENING" }, { kind: "SETTLEMENT", periodKey }] },
    }),
    tenantId,
  );
  const openings = rows.filter((row) => row.kind === "OPENING");
  if (openings.length > 1 || openings.some((row) => row.periodKey > periodKey))
    throw conflict("Payroll month precedes or conflicts with the authorized opening.");
  const opening = openings.find((row) => row.periodKey === periodKey);
  if (
    opening &&
    (await tx.payrollClose.count({ where: { tenantId, periodKey: { lt: periodKey } } }))
  )
    throw conflict("Payroll opening conflicts with existing earlier close history.");
  const carry = {
    tenantId,
    periodKey,
    previous: previous ? { id: previous.stored.id, tenantId, state: previous.state } : null,
    ...(opening ? { opening: opening.payload as unknown as PayrollOpeningCarry } : {}),
  };
  const resolved = resolvePayrollCloseCarry(carry);
  if (!resolved.carry)
    throw conflict(
      "Authoritative payroll inputs unavailable: APPROVED_PREVIOUS_CLOSE_OR_PERSISTED_OPENING_REQUIRED.",
    );
  const settlements = resolvePayrollCarrySettlements(
    rows
      .filter((row) => row.kind === "SETTLEMENT" && row.targetId !== replacingSettlementStaffId)
      .map((row) => row.payload as unknown as PayrollCarrySettlement),
    tenantId,
    periodKey,
    resolved.carry.staff,
  );
  return { carry, resolved: resolved.carry, settlements };
}

type OpeningRequest = Pick<PayrollOpeningCarry, "staff" | "evidence">;
type SettlementRequest = Pick<
  PayrollCarrySettlement,
  "staffId" | "balanceHash" | "components" | "fallbackWriteOff" | "evidence"
>;

/** Internal only. No HTTP activation. Opening is a complete owner-attested cutover
 * inventory, not a fabricated reconstruction of legacy debts or cash repayment. */
export function authorizeStoredPayrollCarry(
  kind: "OPENING",
  period: string,
  expectedRevision: number,
  request: OpeningRequest,
  reason: string,
): Promise<PayrollOpeningCarry>;
export function authorizeStoredPayrollCarry(
  kind: "SETTLEMENT",
  period: string,
  expectedRevision: number,
  request: SettlementRequest,
  reason: string,
): Promise<PayrollCarrySettlement>;
export async function authorizeStoredPayrollCarry(
  kind: "OPENING" | "SETTLEMENT",
  period: string,
  expectedRevision: number,
  request: OpeningRequest | SettlementRequest,
  reason: string,
): Promise<PayrollOpeningCarry | PayrollCarrySettlement> {
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId || currentOutletId())
    throw forbidden("Carry authorization requires a salon-wide authenticated owner.");
  const periodKey = payrollPeriodKeySchema.parse(period);
  z.number().int().safe().nonnegative().parse(expectedRevision);
  const auditReason = z.string().trim().min(3).max(1000).parse(reason);
  return prisma.$transaction(
    async (tx) => {
      await lockCommissionConfiguration(tx, scope.tenantId);
      const user = await tx.user.findFirst({ where: { id: scope.actorId, disabled: false } });
      if (!user || user.globalRole !== "SUPER_ADMIN" || !user.twoFactorEnabled)
        throw forbidden("Carry authorization requires a verified owner.");
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: scope.tenantId } });
      const now = new Date();
      const subscription = await tx.subscription.findFirst({
        where: { status: { in: ["ACTIVE", "EXPIRED"] }, startDate: { lte: now } },
        orderBy: { endDate: "desc" },
      });
      if (resolveTenantStatus(tenant.status, subscription?.endDate ?? null) !== "ACTIVE")
        throw forbidden("Carry authorization requires a writable salon.");
      if ((await verifiedPayrollClose(tx, periodKey))?.state.status === "APPROVED")
        throw conflict("Approved payroll carry is immutable.");
      const targetId =
        kind === "OPENING"
          ? "opening"
          : z
              .string()
              .trim()
              .min(1)
              .max(128)
              .parse((request as SettlementRequest).staffId);
      const existing = verifiedCarryAuthorizations(
        await tx.payrollCarryAuthorization.findMany({
          where: { tenantId: scope.tenantId, kind, periodKey, targetId },
        }),
        scope.tenantId,
      )[0];
      if ((existing?.revision ?? 0) !== expectedRevision)
        throw conflict("Carry authorization changed. Reload before saving.");
      const metadata = {
        id: randomUUID(),
        tenantId: scope.tenantId,
        periodKey,
        revision: expectedRevision + 1,
        approval: { actorId: user.id, at: now.toISOString(), reason: auditReason },
      };
      let payload: PayrollOpeningCarry | PayrollCarrySettlement;
      if (kind === "OPENING") {
        if (
          (await tx.payrollClose.count({ where: { periodKey: { not: periodKey } } })) ||
          (await tx.payrollCarryAuthorization.count({
            where: { kind: "OPENING", periodKey: { not: periodKey } },
          }))
        )
          throw conflict("Opening requires the salon's first payroll close.");
        const input = request as OpeningRequest;
        const staff = await tx.user.findMany({ select: { id: true } });
        if (
          staff.length !== input.staff.length ||
          staff.some((row) => !input.staff.some((entry) => entry.staffId === row.id))
        )
          throw conflict(
            "Opening inventory must explicitly include every salon staff member, including zero and departed balances.",
          );
        payload = resolvePayrollOpeningCarry(
          {
            staff: input.staff,
            evidence: input.evidence,
            ...metadata,
            timeZone: tenant.timeZone,
            effectiveAt: salonDayBounds(`${periodKey}-01`, tenant.timeZone).from.toISOString(),
            firstClose: true,
            completeInventory: true,
          },
          scope.tenantId,
          periodKey,
        );
      } else {
        const loaded = await loadStoredPayrollCarry(tx, scope.tenantId, periodKey, targetId);
        const input = request as SettlementRequest;
        payload = resolvePayrollCarrySettlements(
          [
            {
              staffId: input.staffId,
              balanceHash: input.balanceHash,
              components: input.components,
              fallbackWriteOff: input.fallbackWriteOff,
              evidence: input.evidence,
              ...metadata,
            },
          ],
          scope.tenantId,
          periodKey,
          loaded.resolved.staff,
        )[0];
      }
      await tx.payrollCarryAuthorization.create({
        data: {
          id: metadata.id,
          tenantId: scope.tenantId,
          periodKey,
          revision: metadata.revision,
          kind,
          targetId,
          actorId: user.id,
          reason: auditReason,
          createdAt: now,
          payload: payload as unknown as Json,
          payloadHash: payrollInputHash(payload),
        },
      });
      return payload;
    },
    { timeout: 30000 },
  );
}
