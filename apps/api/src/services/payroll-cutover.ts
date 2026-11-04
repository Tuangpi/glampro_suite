/**
 * CP-007 prospective cutover — activation, rollback and the legacy-accrual guard.
 *
 * Three rules shape this module:
 *
 * 1. **Nothing historic moves.** Activation writes one row per salon plus its audit
 *    event; it never updates a legacy `employee_commissions` row and never
 *    recalculates a closed payroll month.
 * 2. **The switch is attested.** Activation must quote the `inventoryHash` of the
 *    legacy evidence the owner reviewed. If anything was recorded in between, the
 *    hash differs and the activation is refused with `PAYROLL_CUTOVER_INVENTORY_STALE`
 *    instead of covering money nobody looked at.
 * 3. **The legacy writer stops, the plan keeps paying.** `legacyAccrualSuperseded`
 *    is called from the sale writer under the tenant row lock, so a sale either
 *    records its legacy rows before the activation commits or records none at all.
 *    Everything the plan needs (`sale_lines`, collection evidence, holdings) is
 *    still written: only the legacy earnings row is skipped.
 */
import type {
  PayrollCutoverActivate,
  PayrollCutoverHistoryEntry,
  PayrollCutoverInventory,
  PayrollCutoverInventoryQuery,
  PayrollCutoverRollback,
  PayrollCutoverState,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentOutletId, currentScope } from "../lib/tenant-context.js";
import { conflict, forbidden, notFound } from "../lib/http-error.js";
import { salonDayBounds } from "../lib/wall-clock.js";
import { lockCommissionConfiguration } from "./commission.service.js";
import { payrollInputHash, type PayrollCloseState } from "./payroll-close-state.js";
import { salonPeriodKey } from "./payroll-progress.js";
import {
  classifyPayrollCutover,
  nextPeriodKey,
  payrollCutoverBlockers,
  payrollCutoverWindow,
  type PayrollCutoverLegacyRow,
  type PayrollCutoverPayrollMonth,
} from "./payroll-cutover-inventory.js";

export type PayrollCutoverTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export interface PayrollCutoverActor {
  id: string;
  role: string;
  disabled: boolean;
  twoFactorEnabled: boolean;
}

/** The frozen activation record. `inventory` is the evidence the owner attested. */
interface StoredPayrollCutover {
  revision: number;
  status: "ACTIVE" | "ROLLED_BACK";
  effectivePeriodKey: string;
  inventoryHash: string;
  inventory: PayrollCutoverInventory;
  activatedAt: string;
  activatedBy: string;
  activatedReason: string;
  rolledBackAt: string | null;
  rolledBackBy: string | null;
  rolledBackReason: string | null;
}

/** Cutover is an owner decision: manager access is not enough, and the owner must be verified. */
function permitted(actor: PayrollCutoverActor): void {
  if (actor.disabled || !actor.id || actor.role !== "SUPER_ADMIN")
    throw forbidden("Only the salon owner can change the payroll cutover.");
  if (!actor.twoFactorEnabled) throw forbidden("Owner verification is required.");
}

function scopeTenantId(): string {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw forbidden();
  return scope.tenantId;
}

/** Writes are salon-wide: a cutover at one branch would be a cutover everywhere. */
function authorizedContext(): { tenantId: string; actorId: string } {
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId || currentOutletId())
    throw forbidden("Payroll cutover requires a salon-wide authenticated actor.");
  return { tenantId: scope.tenantId, actorId: scope.actorId };
}

/** The role and the second factor are read from the database, never from the token. */
async function confirmedActor(
  tx: PayrollCutoverTransaction,
  actorId: string,
): Promise<PayrollCutoverActor> {
  const user = await tx.user.findFirst({
    where: { id: actorId, disabled: false },
    select: { id: true, globalRole: true, disabled: true, twoFactorEnabled: true },
  });
  if (!user) throw forbidden("Payroll cutover actor is unavailable.");
  const actor: PayrollCutoverActor = {
    id: user.id,
    role: user.globalRole,
    disabled: user.disabled,
    twoFactorEnabled: user.twoFactorEnabled,
  };
  permitted(actor);
  return actor;
}

/** The payroll month is a wall-clock month at the salon, so the zone is read from the tenant. */
async function salonTimeZone(tx: PayrollCutoverTransaction, tenantId: string): Promise<string> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { timeZone: true },
  });
  if (!tenant) throw notFound("Salon not found.", "TENANT_NOT_FOUND");
  return tenant.timeZone;
}

interface InventoryRequest {
  months: number;
  /** A candidate activation month being dry-run, rather than the stored one. */
  effectivePeriodKey?: string;
}

/**
 * Builds the attested window. The hash covers everything the owner is shown, so
 * quoting it back on activation proves the evidence did not move in between.
 */
function buildInventory(input: {
  timeZone: string;
  currentPeriodKey: string;
  months: number;
  effectivePeriodKey: string | null;
  proposed: boolean;
  legacy: readonly PayrollCutoverLegacyRow[];
  payroll: readonly PayrollCutoverPayrollMonth[];
}): PayrollCutoverInventory {
  const periodKeys = payrollCutoverWindow(input.currentPeriodKey, input.months);
  const classification = classifyPayrollCutover({
    periodKeys,
    currentPeriodKey: input.currentPeriodKey,
    effectivePeriodKey: input.effectivePeriodKey,
    legacy: input.legacy,
    payroll: input.payroll,
  });
  const body = {
    timeZone: input.timeZone,
    currentPeriodKey: input.currentPeriodKey,
    fromPeriodKey: periodKeys[0],
    toPeriodKey: periodKeys[periodKeys.length - 1],
    effectivePeriodKey: input.effectivePeriodKey,
    proposed: input.proposed,
    months: classification.months,
    issues: classification.issues,
    totals: classification.totals,
  };
  return { ...body, inventoryHash: payrollInputHash(body) };
}

/**
 * The dry run. Read-only by construction: it classifies legacy rows and plan
 * payroll status, and writes nothing at all.
 */
async function inventoryInTransaction(
  tx: PayrollCutoverTransaction,
  tenantId: string,
  request: InventoryRequest,
): Promise<PayrollCutoverInventory> {
  const timeZone = await salonTimeZone(tx, tenantId);
  const stored = await tx.payrollCutover.findFirst({
    where: { tenantId },
    select: { effectivePeriodKey: true, status: true },
  });
  const effectivePeriodKey =
    request.effectivePeriodKey ?? (stored?.status === "ACTIVE" ? stored.effectivePeriodKey : null);
  const currentPeriodKey = salonPeriodKey(timeZone, new Date());
  const periodKeys = payrollCutoverWindow(currentPeriodKey, request.months);
  const nextKey = nextPeriodKey(periodKeys[periodKeys.length - 1]);
  const from = salonDayBounds(`${periodKeys[0]}-01`, timeZone).from;
  const to = salonDayBounds(`${nextKey}-01`, timeZone).from;

  // A legacy row belongs to the month of the sale it names. A row that names no
  // sale can only be dated by when legacy recorded it, and is flagged as such.
  const [rows, closes] = await Promise.all([
    tx.employeeCommission.findMany({
      where: {
        ledgerVersion: null,
        OR: [
          { sale: { soldAt: { gte: from, lt: to } } },
          { saleId: null, createdAt: { gte: from, lt: to } },
        ],
      },
      select: {
        id: true,
        userId: true,
        saleId: true,
        amount: true,
        paidAt: true,
        reconciliationRequired: true,
        createdAt: true,
        sale: { select: { soldAt: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    tx.payrollClose.findMany({
      where: { periodKey: { in: periodKeys } },
      select: { periodKey: true, status: true, state: true },
    }),
  ]);

  const legacy: PayrollCutoverLegacyRow[] = rows.map((row) => ({
    id: row.id,
    staffId: row.userId,
    saleId: row.saleId,
    periodKey: salonPeriodKey(timeZone, row.sale?.soldAt ?? row.createdAt),
    // `Decimal.toFixed()` is exact: the stored scale is 10 and never a float.
    amount: row.amount.toFixed(),
    paid: row.paidAt !== null,
    clawback: row.reconciliationRequired,
  }));
  const payroll: PayrollCutoverPayrollMonth[] = closes.map((row) => ({
    periodKey: row.periodKey,
    status: row.status as PayrollCutoverPayrollMonth["status"],
    payoutConfirmed: (row.state as unknown as PayrollCloseState).payout !== null,
  }));

  return buildInventory({
    timeZone,
    currentPeriodKey,
    months: request.months,
    effectivePeriodKey,
    proposed: request.effectivePeriodKey !== undefined,
    legacy,
    payroll,
  });
}

/** How many months the dry run and the activation both cover unless asked otherwise. */
export const PAYROLL_CUTOVER_INVENTORY_MONTHS = 12;

type Json = Parameters<PayrollCutoverTransaction["payrollCutover"]["create"]>[0]["data"]["state"];

/**
 * Reads the activation record and verifies its append-only chain.
 *
 * The check is the same shape CP-005 uses for a frozen close: every event's hash
 * must match its own state, each event must point at its predecessor, and the
 * stored row must equal the newest event. A row edited outside this module
 * therefore fails loudly instead of being reported as a valid cutover.
 */
async function stateInTransaction(
  tx: PayrollCutoverTransaction,
  tenantId: string,
): Promise<PayrollCutoverState> {
  const [stored, events] = await Promise.all([
    tx.payrollCutover.findFirst({ where: { tenantId } }),
    tx.payrollCutoverEvent.findMany({
      where: { tenantId },
      orderBy: { revision: "asc" },
      select: {
        revision: true,
        action: true,
        actorId: true,
        reason: true,
        previousHash: true,
        stateHash: true,
        state: true,
        createdAt: true,
      },
    }),
  ]);

  let previous: string | null = null;
  for (const event of events) {
    if (event.previousHash !== previous || event.stateHash !== payrollInputHash(event.state))
      throw conflict(
        "Payroll cutover history failed verification.",
        "PAYROLL_CUTOVER_HISTORY_INVALID",
      );
    previous = event.stateHash;
  }
  if (stored && (events.length === 0 || events[events.length - 1].revision !== stored.revision))
    throw conflict(
      "Payroll cutover history failed verification.",
      "PAYROLL_CUTOVER_HISTORY_INVALID",
    );
  if (stored && events[events.length - 1].stateHash !== payrollInputHash(stored.state))
    throw conflict(
      "Payroll cutover history failed verification.",
      "PAYROLL_CUTOVER_HISTORY_INVALID",
    );

  const history: PayrollCutoverHistoryEntry[] = events.map((event) => {
    const state = event.state as unknown as StoredPayrollCutover;
    return {
      revision: event.revision,
      action: event.action as PayrollCutoverHistoryEntry["action"],
      actorId: event.actorId,
      reason: event.reason,
      at: event.createdAt.toISOString(),
      effectivePeriodKey: state.effectivePeriodKey,
      inventoryHash: event.action === "ACTIVATE" ? state.inventoryHash : null,
      stateHash: event.stateHash,
      previousHash: event.previousHash,
    };
  });

  if (!stored)
    return {
      status: "NOT_ACTIVATED",
      revision: 0,
      effectivePeriodKey: null,
      inventoryHash: null,
      activatedAt: null,
      activatedBy: null,
      rolledBackAt: null,
      rolledBackBy: null,
      rolledBackReason: null,
      history,
    };

  const state = stored.state as unknown as StoredPayrollCutover;
  return {
    status: stored.status as PayrollCutoverState["status"],
    revision: stored.revision,
    effectivePeriodKey: stored.effectivePeriodKey,
    inventoryHash: state.inventoryHash,
    activatedAt: state.activatedAt,
    activatedBy: state.activatedBy,
    rolledBackAt: state.rolledBackAt,
    rolledBackBy: state.rolledBackBy,
    rolledBackReason: state.rolledBackReason,
    history,
  };
}

/** `GET /api/payroll-cutover` — owner-visible record, open to management for reading. */
export function readPayrollCutover(): Promise<PayrollCutoverState> {
  const tenantId = scopeTenantId();
  return prisma.$transaction((tx) => stateInTransaction(tx, tenantId));
}

/** `GET /api/payroll-cutover/inventory` — the read-only dry run. */
export function readPayrollCutoverInventory(
  query: PayrollCutoverInventoryQuery,
): Promise<PayrollCutoverInventory> {
  const tenantId = scopeTenantId();
  return prisma.$transaction((tx) =>
    inventoryInTransaction(tx, tenantId, {
      months: query.months,
      ...(query.effectivePeriodKey === undefined
        ? {}
        : { effectivePeriodKey: query.effectivePeriodKey }),
    }),
  );
}

/**
 * Makes plan payroll the payroll of record from `effectivePeriodKey` onwards.
 *
 * Owner-only, revision-checked, inventory-attested, and refused while any blocker
 * stands. The append-only event is written in the same transaction as the row, so
 * there is no moment where the switch is on without its evidence.
 */
export function activatePayrollCutover(
  input: PayrollCutoverActivate,
): Promise<PayrollCutoverState> {
  const { tenantId, actorId } = authorizedContext();
  return prisma.$transaction(async (tx) => {
    // The last legacy row and the switch cannot cross: sale completion takes the
    // same tenant row lock before it writes earnings.
    await lockCommissionConfiguration(tx, tenantId);
    const actor = await confirmedActor(tx, actorId);

    const stored = await tx.payrollCutover.findFirst({ where: { tenantId } });
    if ((stored?.revision ?? 0) !== input.expectedRevision)
      throw conflict("Payroll cutover changed. Reload before saving.", "PAYROLL_CUTOVER_STALE");
    if (stored?.status === "ACTIVE")
      throw conflict("Plan payroll is already the payroll of record.", "PAYROLL_CUTOVER_ACTIVE");

    const last = await tx.payrollCutoverEvent.findFirst({
      where: { tenantId },
      orderBy: { revision: "desc" },
      select: { revision: true, stateHash: true },
    });
    if ((last?.revision ?? 0) !== (stored?.revision ?? 0))
      throw conflict(
        "Payroll cutover history failed verification.",
        "PAYROLL_CUTOVER_HISTORY_INVALID",
      );

    // Recomputed here, never taken from the request: the owner attests a hash, so a
    // window that grew a legacy row (or an approved month) in between is refused.
    const inventory = await inventoryInTransaction(tx, tenantId, {
      months: input.inventoryMonths,
      effectivePeriodKey: input.effectivePeriodKey,
    });
    if (inventory.inventoryHash !== input.inventoryHash)
      throw conflict(
        "Legacy earnings changed since this inventory was reviewed. Review it again before activating.",
        "PAYROLL_CUTOVER_INVENTORY_STALE",
        { inventoryHash: inventory.inventoryHash },
      );
    const blockers = payrollCutoverBlockers(inventory.issues);
    if (blockers.length > 0)
      throw conflict(
        "This salon still has legacy earnings that cannot be carried over. Resolve them first.",
        "PAYROLL_CUTOVER_BLOCKED",
        blockers,
      );

    const revision = (stored?.revision ?? 0) + 1;
    const state: StoredPayrollCutover = {
      revision,
      status: "ACTIVE",
      effectivePeriodKey: input.effectivePeriodKey,
      inventoryHash: inventory.inventoryHash,
      inventory,
      activatedAt: new Date().toISOString(),
      activatedBy: actor.id,
      activatedReason: input.reason,
      rolledBackAt: null,
      rolledBackBy: null,
      rolledBackReason: null,
    };
    const stateHash = payrollInputHash(state);

    // The trigger refuses an identity change and refuses to delete, so a re-activation
    // after a rollback is an update of the same row and keeps its whole history.
    if (stored)
      await tx.payrollCutover.update({
        where: { tenantId },
        data: {
          revision,
          status: "ACTIVE",
          effectivePeriodKey: input.effectivePeriodKey,
          state: state as unknown as Json,
        },
      });
    else
      await tx.payrollCutover.create({
        data: {
          tenantId,
          revision,
          status: "ACTIVE",
          effectivePeriodKey: input.effectivePeriodKey,
          state: state as unknown as Json,
        },
      });

    await tx.payrollCutoverEvent.create({
      data: {
        tenantId,
        revision,
        action: "ACTIVATE",
        actorId: actor.id,
        reason: input.reason,
        previousHash: last?.stateHash ?? null,
        stateHash,
        state: state as unknown as Json,
      },
    });

    return stateInTransaction(tx, tenantId);
  });
}

/**
 * Puts legacy accrual back from the current salon month.
 *
 * Refused while plan payroll owes money for a month that has not closed yet: legacy
 * would start paying the same sales again. Everything already recorded stays; only
 * future sales are affected.
 */
export function rollbackPayrollCutover(
  input: PayrollCutoverRollback,
): Promise<PayrollCutoverState> {
  const { tenantId, actorId } = authorizedContext();
  return prisma.$transaction(async (tx) => {
    await lockCommissionConfiguration(tx, tenantId);
    const actor = await confirmedActor(tx, actorId);

    const stored = await tx.payrollCutover.findFirst({ where: { tenantId } });
    if (!stored || stored.status !== "ACTIVE")
      throw conflict("Plan payroll is not the payroll of record.", "PAYROLL_CUTOVER_NOT_ACTIVE");
    if (stored.revision !== input.expectedRevision)
      throw conflict("Payroll cutover changed. Reload before saving.", "PAYROLL_CUTOVER_STALE");

    const last = await tx.payrollCutoverEvent.findFirst({
      where: { tenantId },
      orderBy: { revision: "desc" },
      select: { revision: true, stateHash: true },
    });
    if ((last?.revision ?? 0) !== stored.revision)
      throw conflict(
        "Payroll cutover history failed verification.",
        "PAYROLL_CUTOVER_HISTORY_INVALID",
      );

    const timeZone = await salonTimeZone(tx, tenantId);
    const currentPeriodKey = salonPeriodKey(timeZone, new Date());
    const owing = await tx.payrollClose.findMany({
      where: { status: "APPROVED", periodKey: { gte: currentPeriodKey } },
      select: { periodKey: true },
      orderBy: { periodKey: "asc" },
    });
    if (owing.length > 0)
      throw conflict(
        "Plan payroll is already approved for a month that has not been paid out. Roll back once that month is settled.",
        "PAYROLL_CUTOVER_ROLLBACK_BLOCKED",
        { periodKeys: owing.map((row) => row.periodKey) },
      );

    const previous = stored.state as unknown as StoredPayrollCutover;
    const revision = stored.revision + 1;
    const state: StoredPayrollCutover = {
      ...previous,
      revision,
      status: "ROLLED_BACK",
      rolledBackAt: new Date().toISOString(),
      rolledBackBy: actor.id,
      rolledBackReason: input.reason,
    };
    const stateHash = payrollInputHash(state);

    await tx.payrollCutover.update({
      where: { tenantId },
      data: { revision, status: "ROLLED_BACK", state: state as unknown as Json },
    });
    await tx.payrollCutoverEvent.create({
      data: {
        tenantId,
        revision,
        action: "ROLLBACK",
        actorId: actor.id,
        reason: input.reason,
        previousHash: last?.stateHash ?? null,
        stateHash,
        state: state as unknown as Json,
      },
    });

    return stateInTransaction(tx, tenantId);
  });
}

/**
 * The writer guard: `true` when legacy must **not** record an earning for `at`.
 *
 * Called from sale completion while the tenant row lock is held. A salon that never
 * activated a cutover pays one indexed read and keeps its exact previous behaviour.
 */
export async function legacyAccrualSuperseded(
  tx: PayrollCutoverTransaction,
  tenantId: string,
  at: Date,
): Promise<boolean> {
  const cutover = await tx.payrollCutover.findFirst({
    where: { tenantId, status: "ACTIVE" },
    select: { effectivePeriodKey: true },
  });
  if (!cutover) return false;
  const timeZone = await salonTimeZone(tx, tenantId);
  return salonPeriodKey(timeZone, at) >= cutover.effectivePeriodKey;
}
