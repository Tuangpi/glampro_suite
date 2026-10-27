import {
  PAYROLL_DEFAULT_SETTINGS,
  payrollCreatePlanSchema,
  payrollSaveDraftSchema,
  payrollRevisionSchema,
  payrollAssignmentWriteSchema,
  payrollStaffSettingsSchema,
  payrollProfileWriteSchema,
  payrollSettingsWriteSchema,
  payrollPlanDefinitionSchema,
  payrollAssignmentSchema,
  payrollSettingsSchema,
  payrollProfileSchema,
  payrollMonthEnd,
  payrollPlanMetadataSchema,
  type PayrollCreatePlan,
  type PayrollSaveDraft,
  type PayrollRevision,
  type PayrollAssignmentWrite,
  type PayrollStaffSettingsWrite,
  type PayrollProfileWrite,
  type PayrollSettingsWrite,
  type PayrollAssignment,
  type PayrollPlanMetadata,
} from "@glampro_suite/shared";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { currentScope, currentOutletId } from "../lib/tenant-context.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/http-error.js";
import { lockCommissionConfiguration } from "./commission.service.js";
import { resolveTenantStatus } from "../lib/tenant-status.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type Json = Parameters<Transaction["payrollConfigurationEvent"]["create"]>[0]["data"]["payload"];
function scope() {
  const value = currentScope();
  if (value?.kind !== "tenant" || !value.actorId) throw forbidden("A salon actor is required.");
  return value as typeof value & { actorId: string };
}
async function actor(tx: Transaction, ownerOnly = false) {
  const context = scope();
  const user = await tx.user.findFirst({ where: { id: context.actorId, disabled: false } });
  if (!user || !["SUPER_ADMIN", ...(ownerOnly ? [] : ["MANAGER"])].includes(user.globalRole))
    throw forbidden("This payroll configuration action is not permitted.");
  if (user.globalRole === "SUPER_ADMIN" && !user.twoFactorEnabled)
    throw forbidden("Owner verification is required.");
  return user;
}
async function write<T>(fn: (tx: Transaction) => Promise<T>, ownerOnly = false) {
  const context = scope();
  return prisma.$transaction(async (tx) => {
    await lockCommissionConfiguration(tx, context.tenantId);
    await actor(tx, ownerOnly);
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: context.tenantId } });
    const subscription = await tx.subscription.findFirst({
      where: { status: { in: ["ACTIVE", "EXPIRED"] }, startDate: { lte: new Date() } },
      orderBy: { endDate: "desc" },
    });
    if (resolveTenantStatus(tenant.status, subscription?.endDate ?? null) !== "ACTIVE")
      throw forbidden("Payroll configuration requires a writable salon.");
    return fn(tx);
  });
}
async function latest(tx: Transaction, kind: string, targetId: string) {
  return tx.payrollConfigurationEvent.findFirst({
    where: { kind, targetId },
    orderBy: { revision: "desc" },
  });
}
async function event(
  tx: Transaction,
  kind: string,
  targetId: string,
  expectedRevision: number,
  reason: string,
  payload: Json,
) {
  const context = scope();
  if ((await latest(tx, kind, targetId))?.revision !== (expectedRevision || undefined))
    throw conflict("Payroll configuration changed. Reload before saving.");
  return tx.payrollConfigurationEvent.create({
    data: {
      tenantId: context.tenantId,
      kind,
      targetId,
      revision: expectedRevision + 1,
      actorId: context.actorId,
      reason,
      payload,
    },
  });
}
function visible(plan: { outletIds: string[] }) {
  const outlet = currentOutletId();
  return !outlet || !plan.outletIds.length || plan.outletIds.includes(outlet);
}
async function planRecord(tx: Transaction, id: string, mutable = false) {
  const plan = await tx.payrollPlan.findFirst({
    where: { id },
    include: { versions: { orderBy: { versionNo: "desc" } } },
  });
  if (!plan || !visible(plan)) throw notFound("Plan not found.");
  if (
    mutable &&
    currentOutletId() &&
    (plan.outletIds.length !== 1 || plan.outletIds[0] !== currentOutletId())
  )
    throw forbidden("Change shared plans from the company-wide context.");
  return plan;
}
async function validOutlets(tx: Transaction, ids: string[]) {
  if (new Set(ids).size !== ids.length) throw badRequest("Outlet IDs must not repeat.");
  const context = currentOutletId();
  if (context && (ids.length !== 1 || ids[0] !== context))
    throw forbidden("An outlet session may only create plans for its own outlet.");
  if ((await tx.outlet.count({ where: { id: { in: ids }, status: "ACTIVE" } })) !== ids.length)
    throw badRequest("Unknown or archived outlet.");
}
async function bump(tx: Transaction, planId: string, input: PayrollRevision, payload: Json) {
  const updated = await tx.payrollPlan.updateMany({
    where: { id: planId, revision: input.expectedRevision },
    data: { revision: { increment: 1 } },
  });
  if (updated.count !== 1) throw conflict("Plan changed. Reload before saving.");
  await event(tx, "PLAN", planId, input.expectedRevision, input.reason, payload);
}
async function today(tx: Transaction) {
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: scope().tenantId },
    select: { timeZone: true },
  });
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tenant.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return ["year", "month", "day"]
    .map((key) => parts.find((part) => part.type === key)!.value)
    .join("-");
}
async function prospective(tx: Transaction, date: string) {
  if (date < (await today(tx)))
    throw badRequest("Configuration changes must be today or future dated.");
  // Compare using each frozen period's own zone, not a potentially changed salon zone.
  const locked = await tx.commissionPeriod.findMany({
    where: { OR: [{ lockedAt: { not: null } }, { approvedAt: { not: null } }] },
  });
  for (const period of locked) {
    const localDate = (value: Date) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: period.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(value);
    if (date <= localDate(new Date(period.endsAt.getTime() - 1)))
      throw conflict("The effective date would change a locked payroll period.");
  }
}
export async function createPayrollPlan(raw: PayrollCreatePlan) {
  const input = payrollCreatePlanSchema.parse(raw);
  return write(async (tx) => {
    await validOutlets(tx, input.outletIds);
    const { definition, reason, ...metadata } = input;
    const plan = await tx.payrollPlan.create({ data: { ...metadata, tenantId: scope().tenantId } });
    await tx.payrollPlanVersion.create({
      data: {
        tenantId: scope().tenantId,
        planId: plan.id,
        versionNo: 1,
        effectiveFrom: await today(tx),
        definition,
        reason,
        actorId: scope().actorId,
      },
    });
    await bump(
      tx,
      plan.id,
      { expectedRevision: 0, reason },
      { action: "CREATE", ...metadata, definition },
    );
    return planRecord(tx, plan.id);
  }, true);
}
export async function savePayrollDraft(id: string, raw: PayrollSaveDraft) {
  const input = payrollSaveDraftSchema.parse(raw);
  return write(async (tx) => {
    const plan = await planRecord(tx, id, true);
    if (plan.archived) throw conflict("Archived plans cannot be edited.");
    await prospective(tx, input.effectiveFrom);
    await bump(tx, id, input, {
      action: "SAVE_DRAFT",
      effectiveFrom: input.effectiveFrom,
      definition: input.definition,
    });
    const draft = plan.versions.find((version) => version.status === "DRAFT");
    const data = {
      definition: input.definition,
      effectiveFrom: input.effectiveFrom,
      actorId: scope().actorId,
      reason: input.reason,
    };
    if (draft) await tx.payrollPlanVersion.update({ where: { id: draft.id }, data });
    else
      await tx.payrollPlanVersion.create({
        data: {
          ...data,
          tenantId: scope().tenantId,
          planId: id,
          versionNo: (plan.versions[0]?.versionNo ?? 0) + 1,
        },
      });
    return planRecord(tx, id);
  }, true);
}
export async function publishPayrollDraft(id: string, raw: PayrollRevision) {
  const input = payrollRevisionSchema.parse(raw);
  return write(async (tx) => {
    const plan = await planRecord(tx, id, true);
    if (plan.archived) throw conflict("Archived plans cannot be published.");
    const draft = plan.versions.find((version) => version.status === "DRAFT");
    if (!draft) throw conflict("Save a draft before publishing.");
    payrollPlanDefinitionSchema.parse(draft.definition);
    await prospective(tx, draft.effectiveFrom);
    if (
      plan.versions.some((v) => v.status === "PUBLISHED" && v.effectiveFrom === draft.effectiveFrom)
    )
      throw conflict("A version is already published for that date.");
    await bump(tx, id, input, {
      action: "PUBLISH",
      versionId: draft.id,
      definition: draft.definition,
    });
    await tx.payrollPlanVersion.update({
      where: { id: draft.id },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        actorId: scope().actorId,
        reason: input.reason,
      },
    });
    return planRecord(tx, id);
  }, true);
}
export async function archivePayrollPlan(id: string, raw: PayrollRevision) {
  const input = payrollRevisionSchema.parse(raw);
  return write(async (tx) => {
    const plan = await planRecord(tx, id, true);
    if (plan.archived) throw conflict("Plan is already archived.");
    await bump(tx, id, input, { action: "ARCHIVE" });
    await tx.payrollPlan.update({ where: { id }, data: { archived: true } });
    return planRecord(tx, id);
  }, true);
}
export async function updatePayrollPlan(id: string, raw: PayrollPlanMetadata & PayrollRevision) {
  const input = payrollPlanMetadataSchema.extend(payrollRevisionSchema.shape).parse(raw);
  return write(async (tx) => {
    const plan = await planRecord(tx, id, true);
    if (plan.archived) throw conflict("Archived plans cannot be edited.");
    await validOutlets(tx, input.outletIds);
    // Scope is historical metadata: changing it must not strand assignments/history.
    if (JSON.stringify([...plan.outletIds].sort()) !== JSON.stringify([...input.outletIds].sort()))
      throw badRequest("Duplicate the plan to change its outlet scope.");
    const { expectedRevision, reason, ...metadata } = input;
    await bump(tx, id, { expectedRevision, reason }, { action: "METADATA", ...metadata });
    await tx.payrollPlan.update({ where: { id }, data: metadata });
    return planRecord(tx, id);
  }, true);
}
export async function duplicatePayrollPlan(id: string, raw: PayrollPlanMetadata & PayrollRevision) {
  const input = payrollPlanMetadataSchema.extend(payrollRevisionSchema.shape).parse(raw);
  return write(async (tx) => {
    const source = await planRecord(tx, id);
    if (source.revision !== input.expectedRevision)
      throw conflict("Source plan changed. Reload first.");
    await validOutlets(tx, input.outletIds);
    const definition = payrollPlanDefinitionSchema.parse(source.versions[0]?.definition);
    const { expectedRevision: _revision, reason, ...metadata } = input;
    const plan = await tx.payrollPlan.create({ data: { ...metadata, tenantId: scope().tenantId } });
    await tx.payrollPlanVersion.create({
      data: {
        tenantId: scope().tenantId,
        planId: plan.id,
        versionNo: 1,
        effectiveFrom: await today(tx),
        definition,
        actorId: scope().actorId,
        reason,
      },
    });
    await bump(
      tx,
      plan.id,
      { expectedRevision: 0, reason },
      { action: "DUPLICATE", sourcePlanId: id, ...metadata, definition },
    );
    return planRecord(tx, plan.id);
  }, true);
}
async function staffRecord(tx: Transaction, id: string) {
  if (currentOutletId())
    throw forbidden(
      "Staff assignments and payroll profiles are company-wide. Switch to company context.",
    );
  const staff = await tx.user.findFirst({
    where: { id },
    select: { id: true, startDate: true, disabled: true },
  });
  if (!staff) throw notFound("Staff member not found.");
  return staff;
}
async function assignInTransaction(tx: Transaction, input: PayrollAssignmentWrite) {
  await prospective(tx, input.fromDate);
  const revision = (await latest(tx, "ASSIGNMENT", "company"))?.revision ?? 0;
  if (input.expectedRevision !== revision) throw conflict("Assignments changed. Reload first.");
  let outletIds: string[] = [];
  if (input.planId) {
    const plan = await planRecord(tx, input.planId);
    if (plan.archived) throw badRequest("Staff require a non-archived plan.");
    await validOutlets(tx, plan.outletIds);
    outletIds = plan.outletIds;
    if (
      !plan.versions.some(
        (v) =>
          v.status === "PUBLISHED" &&
          v.effectiveFrom <= payrollMonthEnd(input.fromDate.slice(0, 7)),
      )
    )
      throw badRequest("Publish an effective version before assigning this plan.");
  }
  const all: PayrollAssignment[] = payrollAssignmentSchema
    .array()
    .parse((await latest(tx, "ASSIGNMENT", "company"))?.payload ?? []);
  for (const staffId of input.staffIds) {
    const staff = await staffRecord(tx, staffId);
    if (staff.disabled) throw badRequest("Disabled staff cannot receive new assignments.");
    const settings = await latest(tx, "STAFF", staffId);
    if (
      !input.planId &&
      (settings?.payload as { commissionRole?: string } | undefined)?.commissionRole ===
        "COMMISSION_EARNING"
    )
      throw badRequest("Commission-earning staff require a plan. Change the classification first.");
    if (input.planId && !staff.startDate)
      throw badRequest("Set the staff join date before assigning a plan.");
    if (input.planId && staff.startDate!.toISOString().slice(0, 10) > input.fromDate)
      throw badRequest("A payroll assignment cannot start before the staff join date.");
    const rows = all.filter((row) => row.staffId === staffId);
    if (rows.some((row) => row.fromDate >= input.fromDate))
      throw conflict("An assignment exists on or after this date; history cannot be overwritten.");
    const previous = rows.find((row) => row.toDate === null);
    if (previous) {
      const date = new Date(input.fromDate + "T00:00:00Z");
      date.setUTCDate(date.getUTCDate() - 1);
      previous.toDate = date.toISOString().slice(0, 10);
    }
    if (input.planId)
      all.push({
        id: randomUUID(),
        staffId,
        planId: input.planId,
        outletIds,
        fromDate: input.fromDate,
        toDate: null,
      });
  }
  return event(tx, "ASSIGNMENT", "company", revision, input.reason, all);
}
export async function assignPayrollPlan(raw: PayrollAssignmentWrite) {
  const input = payrollAssignmentWriteSchema.parse(raw);
  return write((tx) => assignInTransaction(tx, input), true);
}
/** Identity, department links and assignment audit commit together or not at all. */
export async function createStaffWithPayroll<T extends { id: string }>(
  assignment: Omit<PayrollAssignmentWrite, "staffIds"> | undefined,
  create: (tx: Transaction) => Promise<T>,
  classification?: Pick<PayrollStaffSettingsWrite, "commissionRole" | "reason">,
): Promise<T> {
  if (!classification?.commissionRole)
    throw badRequest("An explicit reasoned payroll classification is required for staff creation.");
  return write(async (tx) => {
    const staff = await create(tx);
    if (assignment)
      await assignInTransaction(
        tx,
        payrollAssignmentWriteSchema.parse({ ...assignment, staffIds: [staff.id] }),
      );
    if (classification) {
      const record = await staffRecord(tx, staff.id);
      if (!record.startDate)
        throw badRequest("A join date is required with a payroll classification.");
      const joinDate = record.startDate.toISOString().slice(0, 10);
      await saveStaffSettingsInTransaction(
        tx,
        staff.id,
        payrollStaffSettingsSchema.parse({
          ...classification,
          expectedRevision: 0,
          expectedJoinDate: joinDate,
          joinDate,
          stageEndOverride: null,
        }),
      );
    }
    return staff;
  }, true);
}
export async function savePayrollStaffSettings(id: string, raw: PayrollStaffSettingsWrite) {
  const input = payrollStaffSettingsSchema.parse(raw);
  return write((tx) => saveStaffSettingsInTransaction(tx, id, input), true);
}
async function saveStaffSettingsInTransaction(
  tx: Transaction,
  id: string,
  input: PayrollStaffSettingsWrite,
) {
  const staff = await staffRecord(tx, id);
  if ((staff.startDate?.toISOString().slice(0, 10) ?? null) !== input.expectedJoinDate)
    throw conflict("Staff join date changed. Reload before saving.");
  const assignments = payrollAssignmentSchema
    .array()
    .parse((await latest(tx, "ASSIGNMENT", "company"))?.payload ?? []);
  if (assignments.some((row) => row.staffId === id && row.fromDate < input.joinDate))
    throw badRequest("The join date cannot be after an existing payroll assignment.");
  const previousSettings = await latest(tx, "STAFF", id);
  const commissionRole =
    input.commissionRole ??
    (previousSettings?.payload as { commissionRole?: string } | undefined)?.commissionRole;
  if (commissionRole === "COMMISSION_EARNING")
    await assertCommissionPlanCoverage(tx, id, assignments);
  const { expectedRevision, expectedJoinDate: _expectedJoinDate, reason, ...payload } = input;
  const result = await event(tx, "STAFF", id, expectedRevision, reason, {
    ...payload,
    ...(commissionRole ? { commissionRole } : {}),
  });
  // User remains the authoritative staff identity and employment date.
  await tx.user.update({
    where: { id },
    data: { startDate: new Date(input.joinDate + "T00:00:00Z") },
  });
  return result;
}

async function assertCommissionPlanCoverage(
  tx: Transaction,
  id: string,
  assignments: PayrollAssignment[],
) {
  const monthEnd = payrollMonthEnd((await today(tx)).slice(0, 7));
  if (
    !assignments.some(
      (row) =>
        row.staffId === id && row.fromDate <= monthEnd && (!row.toDate || row.toDate >= monthEnd),
    )
  )
    throw badRequest(
      "Commission-earning staff require an assignment for the current payroll month.",
    );
  if (!assignments.some((row) => row.staffId === id && row.toDate === null))
    throw badRequest("Replace the scheduled plan removal before marking staff commission earning.");
}

/** Caller must hold the tenant configuration lock in the staff-write transaction. */
export async function assertStaffPayrollLifecycle(
  tx: Transaction,
  id: string,
  startDate: Date | null,
  disabled: boolean,
) {
  // Never prevent account suspension just because payroll configuration needs repair.
  if (disabled) return;
  const settings = await latest(tx, "STAFF", id);
  const commissionRole = (settings?.payload as { commissionRole?: string } | undefined)
    ?.commissionRole;
  if (!["COMMISSION_EARNING", "NON_COMMISSION"].includes(commissionRole ?? ""))
    throw badRequest(
      "Active staff require an audited payroll classification. Ask the owner to complete payroll settings first.",
    );
  if (!startDate)
    throw badRequest("Classified staff require a join date. Repair payroll settings first.");
  if (commissionRole === "COMMISSION_EARNING") {
    const assignments = payrollAssignmentSchema
      .array()
      .parse((await latest(tx, "ASSIGNMENT", "company"))?.payload ?? []);
    await assertCommissionPlanCoverage(tx, id, assignments);
  }
}
export async function savePayrollProfile(id: string, raw: PayrollProfileWrite) {
  const input = payrollProfileWriteSchema.parse(raw);
  return write(async (tx) => {
    await staffRecord(tx, id);
    const { expectedRevision, reason, ...payload } = input;
    return event(tx, "PROFILE", id, expectedRevision, reason, payload);
  }, true);
}
export async function savePayrollSettings(raw: PayrollSettingsWrite) {
  const input = payrollSettingsWriteSchema.parse(raw);
  return write(async (tx) => {
    if (currentOutletId()) throw forbidden("Change salon settings from company context.");
    const { expectedRevision, reason, ...payload } = input;
    return event(tx, "SETTINGS", "company", expectedRevision, reason, payload);
  }, true);
}
export async function readPayrollConfiguration(historyPage = 1) {
  if (!Number.isSafeInteger(historyPage) || historyPage < 1 || historyPage > 1000000)
    throw badRequest("Invalid audit page.");
  return prisma.$transaction(async (tx) => {
    await lockCommissionConfiguration(tx, scope().tenantId);
    const user = await actor(tx);
    // Only owner accounts receive salary values or salary audit payloads.
    const kinds =
      user.globalRole === "SUPER_ADMIN"
        ? ["PLAN", "SETTINGS", "STAFF", "ASSIGNMENT", "PROFILE"]
        : ["PLAN", "SETTINGS", "STAFF", "ASSIGNMENT"];
    const plans = (
      await tx.payrollPlan.findMany({
        include: { versions: { orderBy: { versionNo: "desc" } } },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      })
    ).filter(visible);
    const settings = await latest(tx, "SETTINGS", "company");
    const assignments = currentOutletId() ? null : await latest(tx, "ASSIGNMENT", "company");
    const rows = payrollAssignmentSchema.array().parse(assignments?.payload ?? []);
    const staff = currentOutletId()
      ? []
      : await tx.user.findMany({
          select: { id: true, name: true, startDate: true, disabled: true },
          orderBy: { name: "asc" },
        });
    const historyWhere = {
      kind: { in: kinds },
      ...(currentOutletId() ? { kind: "PLAN", targetId: { in: plans.map((p) => p.id) } } : {}),
    };
    const historyTotal = await tx.payrollConfigurationEvent.count({ where: historyWhere });
    const history = await tx.payrollConfigurationEvent.findMany({
      where: historyWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      skip: (historyPage - 1) * 100,
    });
    const date = await today(tx);
    return {
      today: date,
      outletId: currentOutletId() ?? null,
      plans: plans.map((plan) => ({
        ...plan,
        staffCount: rows.filter(
          (r) => r.planId === plan.id && r.fromDate <= date && (!r.toDate || r.toDate >= date),
        ).length,
      })),
      settings: {
        revision: settings?.revision ?? 0,
        ...payrollSettingsSchema.parse(settings?.payload ?? PAYROLL_DEFAULT_SETTINGS),
      },
      assignments: { revision: assignments?.revision ?? 0, rows },
      staff: await Promise.all(
        staff.map(async (s) => {
          const details = await latest(tx, "STAFF", s.id);
          const profile =
            user.globalRole === "SUPER_ADMIN" ? await latest(tx, "PROFILE", s.id) : null;
          return {
            ...s,
            settings: {
              revision: details?.revision ?? 0,
              stageEndOverride:
                (details?.payload as { stageEndOverride?: number | null } | undefined)
                  ?.stageEndOverride ?? null,
              joinDate: s.startDate?.toISOString().slice(0, 10) ?? null,
              commissionRole:
                (details?.payload as { commissionRole?: string } | undefined)?.commissionRole ??
                null,
            },
            ...(user.globalRole === "SUPER_ADMIN"
              ? {
                  profile: {
                    revision: profile?.revision ?? 0,
                    ...payrollProfileSchema.parse(
                      profile?.payload ?? {
                        basicSalary: "0",
                        fixedOvertime: "0",
                        levy: "0",
                        salesAlertPct: "0",
                      },
                    ),
                  },
                }
              : {}),
          };
        }),
      ),
      history,
      historyLimit: 100,
      historyPage,
      historyTotal,
      earningsActive: false,
    };
  });
}
