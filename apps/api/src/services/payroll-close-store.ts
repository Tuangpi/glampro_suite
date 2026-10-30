import { z } from "zod";
import { payrollPeriodKeySchema, type PayrollAdjustment } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentOutletId, currentScope } from "../lib/tenant-context.js";
import { conflict, forbidden, notFound, HttpError } from "../lib/http-error.js";
import { resolveTenantStatus } from "../lib/tenant-status.js";
import { lockCommissionConfiguration } from "./commission.service.js";
import { loadAuthoritativePayrollCloseInputs } from "./payroll-close-loader.js";
import {
  loadStoredPayrollCarry,
  verifiedCarryAuthorizations,
} from "./payroll-close-authorizations.js";
import { resolvePayrollCarrySettlements } from "./payroll-close-settlements.js";
import {
  adjustPayrollClose,
  approvePayrollClose,
  calculatePayrollClose,
  confirmPayrollPayout,
  openPayrollClose,
  payrollInputHash,
  readFrozenPayrollStatement,
  type PayrollCloseActor,
  type PayrollCloseInputs,
  type PayrollCloseState,
} from "./payroll-close-state.js";

export type PayrollCloseTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
/** Server-owned loader only. Must resolve complete authoritative inputs in this
 * transaction while the tenant source/configuration lock is held. Never accept
 * this function or its returned records from an HTTP request. */
export type PayrollCloseLoader = (
  tx: PayrollCloseTransaction,
  state: PayrollCloseState,
) => Promise<PayrollCloseInputs>;
type Json = Parameters<PayrollCloseTransaction["payrollClose"]["create"]>[0]["data"]["state"];

export async function verifiedPayrollClose(tx: PayrollCloseTransaction, periodKey: string) {
  const stored = await tx.payrollClose.findFirst({ where: { periodKey } });
  if (!stored) return null;
  const audit = await tx.payrollCloseEvent.findFirst({
    where: { periodKey, revision: stored.revision },
  });
  const state = stored.state as unknown as PayrollCloseState;
  if (
    !audit ||
    audit.stateHash !== payrollInputHash(stored.state) ||
    audit.stateHash !== payrollInputHash(audit.state) ||
    state.periodKey !== periodKey ||
    state.revision !== stored.revision ||
    state.status !== stored.status
  )
    throw conflict("Payroll close audit does not match its stored snapshot.");
  return { stored, state };
}

function context() {
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId || currentOutletId())
    throw forbidden("Payroll close requires a salon-wide authenticated actor.");
  return { tenantId: scope.tenantId, actorId: scope.actorId };
}
async function actor(tx: PayrollCloseTransaction, ownerOnly: boolean): Promise<PayrollCloseActor> {
  const user = await tx.user.findFirst({ where: { id: context().actorId, disabled: false } });
  if (
    !user ||
    !["SUPER_ADMIN", ...(ownerOnly ? [] : ["MANAGER"])].includes(user.globalRole) ||
    (user.globalRole === "SUPER_ADMIN" && !user.twoFactorEnabled)
  )
    throw forbidden("This payroll close action is not permitted.");
  return {
    id: user.id,
    role: user.globalRole,
    disabled: user.disabled,
    twoFactorEnabled: user.twoFactorEnabled,
  };
}
async function transition(
  period: string,
  expectedRevision: number,
  action: string,
  reason: string,
  ownerOnly: boolean,
  apply: (
    tx: PayrollCloseTransaction,
    state: PayrollCloseState,
    user: PayrollCloseActor,
  ) => Promise<PayrollCloseState>,
) {
  const scope = context();
  const periodKey = payrollPeriodKeySchema.parse(period);
  z.number().int().safe().nonnegative().parse(expectedRevision);
  const auditReason = z.string().trim().min(3).max(1000).parse(reason);
  return prisma.$transaction(
    async (tx) => {
      await lockCommissionConfiguration(tx, scope.tenantId);
      const user = await actor(tx, ownerOnly);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: scope.tenantId } });
      const subscription = await tx.subscription.findFirst({
        where: { status: { in: ["ACTIVE", "EXPIRED"] }, startDate: { lte: new Date() } },
        orderBy: { endDate: "desc" },
      });
      if (resolveTenantStatus(tenant.status, subscription?.endDate ?? null) !== "ACTIVE")
        throw forbidden("Payroll close requires a writable salon.");
      const verified = await verifiedPayrollClose(tx, periodKey);
      const stored = verified?.stored;
      const state = verified?.state ?? openPayrollClose(periodKey);
      if (state.revision !== expectedRevision)
        throw conflict("Payroll period changed. Reload before saving.");
      const next = await apply(tx, structuredClone(state), user);
      if (next.revision === state.revision) return structuredClone(state);
      const hash = payrollInputHash(next);
      const data = { revision: next.revision, status: next.status, state: next as unknown as Json };
      if (stored) {
        const updated = await tx.payrollClose.updateMany({
          where: { id: stored.id, revision: expectedRevision },
          data,
        });
        if (updated.count !== 1) throw conflict("Payroll period changed. Reload before saving.");
      } else
        await tx.payrollClose.create({ data: { tenantId: scope.tenantId, periodKey, ...data } });
      await tx.payrollCloseEvent.create({
        data: {
          tenantId: scope.tenantId,
          periodKey,
          revision: next.revision,
          action,
          actorId: user.id,
          reason: auditReason,
          previousHash: stored ? payrollInputHash(state) : null,
          stateHash: hash,
          state: next as unknown as Json,
        },
      });
      return structuredClone(next);
    },
    { timeout: 30000 },
  );
}

export function calculateStoredPayrollClose(
  periodKey: string,
  revision: number,
  load: PayrollCloseLoader = loadAuthoritativePayrollCloseInputs,
) {
  return transition(
    periodKey,
    revision,
    "CALCULATE",
    "Calculate monthly payroll",
    false,
    async (tx, state, user) =>
      calculatePayrollClose(state, revision, await load(tx, state), user, new Date().toISOString()),
  );
}
export function approveStoredPayrollClose(
  periodKey: string,
  revision: number,
  reason: string,
  load: PayrollCloseLoader = loadAuthoritativePayrollCloseInputs,
) {
  return transition(periodKey, revision, "APPROVE", reason, true, async (tx, state, user) =>
    approvePayrollClose(
      state,
      revision,
      await load(tx, state),
      user,
      new Date().toISOString(),
      reason,
    ),
  );
}
export function adjustStoredPayrollClose(
  periodKey: string,
  revision: number,
  adjustment: PayrollAdjustment,
) {
  return transition(
    periodKey,
    revision,
    "ADJUST",
    adjustment.reason,
    false,
    async (_tx, state, user) => adjustPayrollClose(state, revision, adjustment, user),
  );
}
export function confirmStoredPayrollPayout(
  periodKey: string,
  revision: number,
  reference: string,
  reason: string,
) {
  return transition(periodKey, revision, "PAYOUT", reason, true, async (_tx, state, user) =>
    confirmPayrollPayout(state, revision, user, new Date().toISOString(), reference, reason),
  );
}

/** Reasoned monetary correction only, not a replacement for immutable source-base
 * posting. Links the original approved snapshot into the next open period's audit. */
export function correctStoredPayrollClose(
  originalPeriod: string,
  targetPeriod: string,
  revision: number,
  adjustment: PayrollAdjustment,
) {
  const originalPeriodKey = payrollPeriodKeySchema.parse(originalPeriod);
  const targetPeriodKey = payrollPeriodKeySchema.parse(targetPeriod);
  return transition(
    targetPeriodKey,
    revision,
    "ADJUST",
    adjustment.reason,
    true,
    async (tx, state, user) => {
      const original = await verifiedPayrollClose(tx, originalPeriodKey);
      if (!original || original.state.status !== "APPROVED")
        throw conflict("Correction requires an original approved payroll close.");
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: context().tenantId } });
      const at = new Date();
      const parts = new Intl.DateTimeFormat("en", {
        timeZone: tenant.timeZone,
        year: "numeric",
        month: "2-digit",
      }).formatToParts(at);
      const currentMonth = ["year", "month"]
        .map((key) => parts.find((part) => part.type === key)!.value)
        .join("-");
      const following = (key: string) => {
        const [year, month] = key.split("-").map(Number);
        return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
      };
      let candidate =
        currentMonth > originalPeriodKey ? currentMonth : following(originalPeriodKey);
      if (targetPeriodKey < candidate)
        throw conflict("Correction cannot be backdated into a closed or earlier month.");
      const intervening = await tx.payrollClose.findMany({
        where: { periodKey: { gte: candidate, lte: targetPeriodKey } },
      });
      const skipped: { periodKey: string; revision: number; hash: string }[] = [];
      while (candidate < targetPeriodKey) {
        const record = intervening.find((row) => row.periodKey === candidate);
        if (!record || record.status !== "APPROVED")
          throw conflict("Correction must use the next open payroll month.");
        skipped.push({
          periodKey: candidate,
          revision: record.revision,
          hash: payrollInputHash(record.state),
        });
        candidate = following(candidate);
      }
      const linkedReason = `${adjustment.reason} [correction ${originalPeriodKey}@${original.state.revision}; snapshot ${payrollInputHash(original.state)}; skipped ${payrollInputHash(skipped)}]`;
      return adjustPayrollClose(state, revision, { ...adjustment, reason: linkedReason }, user);
    },
  );
}
export async function readStoredPayrollStatement(period: string, staffId: string) {
  const scope = context();
  const periodKey = payrollPeriodKeySchema.parse(period);
  return prisma.$transaction(async (tx) => {
    await lockCommissionConfiguration(tx, scope.tenantId);
    const user = await tx.user.findFirst({ where: { id: scope.actorId, disabled: false } });
    if (!user) throw forbidden("Payroll actor unavailable.");
    const verified = await verifiedPayrollClose(tx, periodKey);
    if (!verified) throw notFound("Payroll close not found.");
    return readFrozenPayrollStatement(verified.state, staffId, {
      id: user.id,
      role: user.globalRole,
      disabled: user.disabled,
      twoFactorEnabled: user.twoFactorEnabled,
    });
  });
}

/** Management read, never an implicit calculation or source reload. */
export async function readStoredPayrollClose(period: string) {
  const scope = context();
  const periodKey = payrollPeriodKeySchema.parse(period);
  return prisma.$transaction(async (tx) => {
    await lockCommissionConfiguration(tx, scope.tenantId);
    await actor(tx, false);
    return structuredClone(
      (await verifiedPayrollClose(tx, periodKey))?.state ?? openPayrollClose(periodKey),
    );
  });
}

/** Owner-only carry read in the same transaction as authorization and locking. */
export async function readStoredPayrollCarry(period: string) {
  const scope = context();
  const periodKey = payrollPeriodKeySchema.parse(period);
  return prisma.$transaction(async (tx) => {
    await lockCommissionConfiguration(tx, scope.tenantId);
    await actor(tx, true);
    const staffInventory = await tx.user.findMany({
      where: { tenantId: scope.tenantId },
      select: { id: true, name: true, disabled: true },
      orderBy: { id: "asc" },
    });
    const authorizations = verifiedCarryAuthorizations(
      await tx.payrollCarryAuthorization.findMany({
        where: { tenantId: scope.tenantId, kind: "OPENING" },
      }),
      scope.tenantId,
    );
    const opening = authorizations.find((row) => row.periodKey === periodKey);
    const openingEligible =
      !authorizations.some((row) => row.periodKey !== periodKey) &&
      !(await tx.payrollClose.count({
        where: { tenantId: scope.tenantId, periodKey: { not: periodKey } },
      }));
    const metadata = {
      periodKey,
      staffInventory,
      openingEligible,
      openingRevision: opening?.revision ?? 0,
      opening: opening?.payload ?? null,
    };
    let loaded;
    try {
      loaded = await loadStoredPayrollCarry(tx, scope.tenantId, periodKey, undefined, false);
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== "PAYROLL_CARRY_UNAVAILABLE") throw error;
      return { ...metadata, availability: "UNAVAILABLE" as const, balances: [], settlements: [] };
    }
    const balances = loaded.resolved.staff.map((balance) => ({
      ...balance,
      balanceHash: payrollInputHash(balance),
    }));
    const settlements = loaded.settlements.map((settlement) => {
      let stale = false;
      try {
        resolvePayrollCarrySettlements(
          [settlement],
          scope.tenantId,
          periodKey,
          loaded.resolved.staff,
        );
      } catch {
        stale = true;
      }
      return { ...settlement, stale };
    });
    return { ...metadata, availability: "READY" as const, balances, settlements };
  });
}
