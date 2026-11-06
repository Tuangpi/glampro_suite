import { z } from "zod";
import {
  payrollPeriodKeySchema,
  payrollStatementHistoryQuerySchema,
  type PayrollAdjustment,
  type PayrollOwnStatements,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentOutletId, currentScope } from "../lib/tenant-context.js";
import { conflict, forbidden, notFound, HttpError } from "../lib/http-error.js";
import { resolveTenantStatus } from "../lib/tenant-status.js";
import { lockPrepaid } from "../lib/prepaid-lock.js";
import { lockCommissionConfiguration } from "./commission.service.js";
import { loadAuthoritativePayrollCloseInputs } from "./payroll-close-loader.js";
import {
  loadStoredPayrollCarry,
  verifiedCarryAuthorizations,
} from "./payroll-close-authorizations.js";
import { resolvePayrollCarrySettlements } from "./payroll-close-settlements.js";
import {
  attachPayrollLineSources,
  payrollPeriodReport,
  selectPayrollStatementLines,
  type PayrollStatementLineQuery,
} from "./payroll-report.js";
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
import { ownPayrollStatement, payrollProgressView, salonPeriodKey } from "./payroll-progress.js";

export type PayrollCloseTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
/** Server-owned loader only. Must resolve complete authoritative inputs in this
 * transaction while prepaid then tenant source/configuration locks are held. Never accept
 * this function or its returned records from an HTTP request. */
export type PayrollCloseLoader = (
  tx: PayrollCloseTransaction,
  state: PayrollCloseState,
) => Promise<PayrollCloseInputs>;
type Json = Parameters<PayrollCloseTransaction["payrollClose"]["create"]>[0]["data"]["state"];

function verifiedState<T extends { state: unknown; revision: number; status: string }>(
  stored: T,
  audit: { stateHash: string } | null,
  periodKey: string,
  auditState: { state: unknown } | null,
) {
  const state = stored.state as unknown as PayrollCloseState;
  if (
    !audit ||
    audit.stateHash !== payrollInputHash(stored.state) ||
    // The event carries its own copy of the snapshot; re-hash it whenever it was read.
    (auditState !== null && audit.stateHash !== payrollInputHash(auditState.state)) ||
    state.periodKey !== periodKey ||
    state.revision !== stored.revision ||
    state.status !== stored.status
  )
    throw conflict("Payroll close audit does not match its stored snapshot.");
  return { stored, state };
}

/** Full verification: the stored snapshot **and** the audit event's own copy must hash
 * to the audited `stateHash`. Use this wherever the event payload is read or returned. */
export async function verifiedPayrollClose(tx: PayrollCloseTransaction, periodKey: string) {
  const stored = await tx.payrollClose.findFirst({ where: { periodKey } });
  if (!stored) return null;
  const audit = await tx.payrollCloseEvent.findFirst({
    where: { periodKey, revision: stored.revision },
  });
  return verifiedState(stored, audit, periodKey, audit);
}

/**
 * Snapshot verification for read models that never return the audit payload.
 *
 * The snapshot being shown is still proved against the audited `stateHash`; only the
 * event's second copy is left unread. That copy costs about as much as the snapshot
 * itself — one 1.4 MB row read plus one canonical hash over 50 statements and 1,000
 * receipt lines measured ~300 ms against a 500 ms month-to-date budget (NFR-03) — and
 * it proves a payload this path does not return. Tampering with the event payload is
 * still refused everywhere the payload is actually exposed or acted on, because those
 * call sites keep the full check.
 */
export async function verifiedPayrollCloseSnapshot(tx: PayrollCloseTransaction, periodKey: string) {
  const stored = await tx.payrollClose.findFirst({ where: { periodKey } });
  if (!stored) return null;
  const audit = await tx.payrollCloseEvent.findFirst({
    where: { periodKey, revision: stored.revision },
    select: { stateHash: true },
  });
  return verifiedState(stored, audit, periodKey, null);
}

function context() {
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId || currentOutletId())
    throw forbidden("Payroll close requires a salon-wide authenticated actor.");
  return { tenantId: scope.tenantId, actorId: scope.actorId };
}

/** Roles that hold commission statements, and so may read their own. Cashiers hold none. */
const selfServiceRoles: readonly string[] = ["SUPER_ADMIN", "MANAGER", "STAFF"];

/**
 * Self-service reads are allowed at a branch, because they never leave the caller's own
 * statement: a seller standing at an outlet till may read their own progress. A
 * salon-wide payroll table still refuses an outlet picker (see `context`).
 */
function selfServiceContext() {
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId)
    throw forbidden("Payroll self-service requires an authenticated salon actor.");
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
      // Source loaders may re-enter prepaid locking. Take it before the tenant
      // row, matching checkout/reversal writers, never from inside a tenant lock.
      if (action === "CALCULATE" || action === "APPROVE") await lockPrepaid(tx, scope.tenantId);
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
          // Transaction-start timestamps can predate a source writer that won
          // the shared lock. Audit the actual transition append time instead.
          createdAt: new Date(),
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
    if (!user || !["SUPER_ADMIN", "MANAGER", "STAFF"].includes(user.globalRole))
      throw forbidden("Payroll actor unavailable.");
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

/**
 * CP-006 period report: frozen totals and the per-staff breakdown of the approved month.
 *
 * Managers may read it because it carries commission, incentives, collections and base
 * amounts only — never salary or take-home. The same transaction verifies the stored
 * snapshot so a newer draft can never appear here.
 */
export async function readStoredPayrollReport(period: string) {
  const scope = context();
  const periodKey = payrollPeriodKeySchema.parse(period);
  return prisma.$transaction(async (tx) => {
    await lockCommissionConfiguration(tx, scope.tenantId);
    await actor(tx, false);
    const verified = await verifiedPayrollClose(tx, periodKey);
    if (!verified) throw conflict("Approve payroll before reporting on frozen statements.");
    return payrollPeriodReport(verified.state);
  });
}

/**
 * CP-006 drill-down: one staff member's frozen base lines plus the captured source
 * reference for each line.
 *
 * The frozen statement stays the source of truth for money; the source event supplies
 * identity only (type, ID, sale ID, occurrence) and is resolved in the same transaction
 * so a line cannot be paired with a different period's evidence.
 */
export async function readStoredPayrollStatementLines(
  period: string,
  staffId: string,
  query: PayrollStatementLineQuery,
) {
  const scope = context();
  const periodKey = payrollPeriodKeySchema.parse(period);
  const target = z.string().trim().min(1).max(128).parse(staffId);
  return prisma.$transaction(async (tx) => {
    await lockCommissionConfiguration(tx, scope.tenantId);
    await actor(tx, false);
    const verified = await verifiedPayrollClose(tx, periodKey);
    if (!verified) throw conflict("Approve payroll before reporting on frozen statements.");
    const selection = selectPayrollStatementLines(verified.state, target, query);
    const events = selection.sourceKeys.length
      ? await tx.payrollSourceEvent.findMany({
          where: { sourceKey: { in: selection.sourceKeys } },
          select: {
            sourceKey: true,
            sourceType: true,
            sourceId: true,
            saleId: true,
            occurredAt: true,
          },
        })
      : [];
    return attachPayrollLineSources(selection, events);
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

/** Page size and scan ceiling for the own-statement history; never loads every month at once. */
const STATEMENT_HISTORY_PAGE = 4;
const STATEMENT_HISTORY_SCAN = 120;

/** The payroll month is a wall-clock month at the salon, so the zone is read from the tenant. */
async function salonTimeZone(tx: PayrollCloseTransaction, tenantId: string) {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { timeZone: true },
  });
  if (!tenant) throw notFound("Salon not found.", "TENANT_NOT_FOUND");
  return tenant.timeZone;
}

/**
 * CP-006 month-to-date progress (FR-RPT-04, FR-POS-09).
 *
 * The figures are read from the stored calculation snapshot, never recomputed: an
 * unapproved month is the same engine arithmetic on inputs that later postings may
 * still extend, which the caller is told about through `estimated` and `basis`. No
 * salary field leaves this function.
 *
 * Visibility is decided here rather than in the browser: a manager or owner sees the
 * salon table, a staff member sees only their own line, and an outlet-scoped actor sees
 * only their own line as well — a branch picker must not widen a salon-wide statement.
 *
 * `requestedScope` is the caller asking for their own line (`?scope=SELF`), which is
 * what the self-service screen reads. An owner or manager holds a commission statement
 * too, so under a "Your month-to-date progress" heading the salon table is the wrong
 * answer even though they are allowed to see it. The flag only ever narrows: it is
 * OR-ed with the role and outlet rules, so nothing here can widen a read.
 */
export async function readStoredPayrollProgress(period?: string, requestedScope?: "SELF") {
  const scope = selfServiceContext();
  const requested = period === undefined ? undefined : payrollPeriodKeySchema.parse(period);
  return prisma.$transaction(async (tx) => {
    await lockCommissionConfiguration(tx, scope.tenantId);
    const user = await tx.user.findFirst({
      where: { id: scope.actorId, disabled: false },
      select: { id: true, globalRole: true },
    });
    if (!user || !selfServiceRoles.includes(user.globalRole))
      throw forbidden("Payroll progress is not available to this account.");
    const selfOnly =
      requestedScope === "SELF" || user.globalRole === "STAFF" || currentOutletId() !== undefined;
    const periodKey =
      requested ?? salonPeriodKey(await salonTimeZone(tx, scope.tenantId), new Date());
    const verified = await verifiedPayrollCloseSnapshot(tx, periodKey);
    const state = verified?.state ?? openPayrollClose(periodKey);
    const planIds = [
      ...new Set(
        (state.calculation?.statements ?? []).flatMap((statement) =>
          statement.result.planId ? [statement.result.planId] : [],
        ),
      ),
    ];
    const plans = planIds.length
      ? await tx.payrollPlan.findMany({
          where: { id: { in: planIds } },
          select: { id: true, name: true },
        })
      : [];
    return payrollProgressView(state, {
      scope: selfOnly ? "SELF" : "SALON",
      staffId: selfOnly ? user.id : null,
      planNames: new Map(plans.map((plan) => [plan.id, plan.name])),
    });
  });
}

/**
 * CP-006 own-data staff self-service (FR-RPT-05): the caller's own frozen statements.
 *
 * Approved months are paged newest-first and every month that holds one of this staff
 * member's statements is hash-verified in the same transaction, so a tampered snapshot
 * is refused instead of being listed. Months that do not mention the caller cost one
 * row read and are skipped. Salary and take-home never enter the projection.
 */
export async function readStoredPayrollStatements(limit: number): Promise<PayrollOwnStatements> {
  const scope = selfServiceContext();
  const query = payrollStatementHistoryQuerySchema.parse({ limit });
  return prisma.$transaction(async (tx) => {
    await lockCommissionConfiguration(tx, scope.tenantId);
    const user = await tx.user.findFirst({
      where: { id: scope.actorId, disabled: false },
      select: { id: true, globalRole: true },
    });
    if (!user || !selfServiceRoles.includes(user.globalRole))
      throw forbidden("Payroll self-service is not available to this account.");
    const statements: PayrollOwnStatements["statements"] = [];
    let scanned = 0;
    while (scanned < STATEMENT_HISTORY_SCAN && statements.length <= query.limit) {
      const page = await tx.payrollClose.findMany({
        where: { status: "APPROVED" },
        orderBy: { periodKey: "desc" },
        skip: scanned,
        take: STATEMENT_HISTORY_PAGE,
        select: { periodKey: true, state: true },
      });
      if (!page.length) break;
      scanned += page.length;
      for (const row of page) {
        const stored = row.state as unknown as PayrollCloseState;
        if (!stored.calculation?.statements.some((item) => item.staff.id === user.id)) continue;
        const verified = await verifiedPayrollClose(tx, row.periodKey);
        const summary = verified ? ownPayrollStatement(verified.state, user.id) : null;
        if (summary) statements.push(summary);
        if (statements.length > query.limit) break;
      }
      if (page.length < STATEMENT_HISTORY_PAGE) break;
    }
    return {
      statements: statements.slice(0, query.limit),
      limit: query.limit,
      hasMore: statements.length > query.limit,
    };
  });
}
