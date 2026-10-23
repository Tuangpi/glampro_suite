import type {
  CommissionKind,
  CommissionRuleView,
  CommissionScope,
  PublishCommissionRule,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { badRequest, conflict, notFound } from "../lib/http-error.js";
import { commissionScopeKey, resolveCommission } from "./commission-rules.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
function tenantId() {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw new Error("Commission settings require tenant scope.");
  return scope.tenantId;
}
export async function lockCommissionConfiguration(tx: Transaction, id: string) {
  // All publishers and sale snapshots share this lock, avoiding mixed policy reads.
  await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${id} FOR UPDATE`;
}
async function revision(tx: Transaction) {
  return (
    (await tx.commissionRule.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] }))?.id ??
    null
  );
}
async function staffRecord(tx: Transaction, id: string) {
  const staff = await tx.user.findFirst({
    where: { id },
    select: { id: true, commissionRate: true },
  });
  if (!staff) throw notFound("Staff member not found.");
  return staff;
}
export async function publishCommissionRule(input: PublishCommissionRule, actorId: string) {
  const id = tenantId();
  return prisma.$transaction(async (tx) => {
    await lockCommissionConfiguration(tx, id);
    if ((await revision(tx)) !== input.expectedRevision)
      throw conflict("Commission settings changed. Reload before publishing.");
    const actor = await tx.user.findFirst({
      where: { id: actorId },
      select: { id: true, disabled: true, globalRole: true },
    });
    if (!actor || actor.disabled || !["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole))
      throw badRequest("Only a current salon administrator or manager can publish rules.");
    if (input.staffId) await staffRecord(tx, input.staffId);
    if (
      input.scope === "DEPARTMENT" &&
      !(await tx.department.findFirst({ where: { id: input.targetId! } }))
    )
      throw notFound("Department not found.");
    if (input.scope === "ITEM") {
      const args = {
        where: { id: input.targetId!, status: "ACTIVE" as const },
        select: { id: true },
      };
      const item =
        input.itemKind === "SERVICE"
          ? await tx.service.findFirst(args)
          : await tx.product.findFirst(args);
      if (!item) throw notFound("Active catalogue item not found.");
    }
    const now = new Date();
    const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : now;
    if (effectiveAt < now)
      throw badRequest(
        "Effective time must be now or in the future. Leave it blank for immediate publication.",
      );
    const latest = await tx.commissionRule.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const createdAt = new Date(Math.max(now.getTime(), (latest?.createdAt.getTime() ?? 0) + 1));
    const rule = await tx.commissionRule.create({
      data: {
        tenantId: id,
        staffId: input.staffId,
        itemKind: input.itemKind,
        scope: input.scope,
        targetId: input.targetId,
        scopeKey: commissionScopeKey(input.staffId, input.itemKind, input.scope, input.targetId),
        rate: input.rate,
        effectiveAt,
        createdAt,
        actorId,
        reason: input.reason,
      },
    });
    await tx.auditLog.create({
      data: {
        tenantId: id,
        action: "commission.rule.publish",
        targetType: "CommissionRule",
        targetId: rule.id,
        metadata: { ...input, actorId, effectiveAt: effectiveAt.toISOString() },
      },
    });
    return { id: rule.id };
  });
}

export async function commissionConfiguration(staffId: string | undefined, page: number) {
  return prisma.$transaction(async (tx) => {
    await lockCommissionConfiguration(tx, tenantId());
    const staff = staffId ? await staffRecord(tx, staffId) : null;
    const where = { staffId: staffId ?? null };
    const now = new Date();
    // Distinct-on ordered events: do not truncate the effective policy by history page.
    const effective = await tx.commissionRule.findMany({
      where: { ...where, effectiveAt: { lte: now } },
      orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      distinct: ["scopeKey"],
    });
    const [history, total, scheduled] = await Promise.all([
      tx.commissionRule.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * 20,
        take: 20,
      }),
      tx.commissionRule.count({ where }),
      tx.commissionRule.findMany({
        where: { ...where, effectiveAt: { gt: now } },
        orderBy: [{ effectiveAt: "asc" }, { createdAt: "desc" }, { id: "desc" }],
      }),
    ]);
    const rows = [...effective, ...history, ...scheduled];
    const [actors, departments, services, products] = await Promise.all([
      tx.user.findMany({
        where: { id: { in: rows.map((row) => row.actorId) } },
        select: { id: true, name: true },
      }),
      tx.department.findMany({ select: { id: true, name: true } }),
      tx.service.findMany({
        where: {
          id: {
            in: rows
              .filter((r) => r.scope === "ITEM" && r.itemKind === "SERVICE")
              .map((r) => r.targetId!),
          },
        },
        select: { id: true, name: true },
      }),
      tx.product.findMany({
        where: {
          id: {
            in: rows
              .filter((r) => r.scope === "ITEM" && r.itemKind === "PRODUCT")
              .map((r) => r.targetId!),
          },
        },
        select: { id: true, name: true },
      }),
    ]);
    const names = new Map(
      [...departments, ...services, ...products].map((row) => [row.id, row.name]),
    );
    const actorNames = new Map(actors.map((row) => [row.id, row.name]));
    function view(row: (typeof rows)[number]): CommissionRuleView {
      return {
        id: row.id,
        staffId: row.staffId,
        itemKind: row.itemKind as CommissionKind,
        scope: row.scope as CommissionScope,
        targetId: row.targetId,
        targetName: row.targetId ? (names.get(row.targetId) ?? "Archived item") : null,
        rate: row.rate?.toFixed(2) ?? null,
        effectiveAt: row.effectiveAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        actorId: row.actorId,
        actorName: actorNames.get(row.actorId) ?? "Former administrator",
        reason: row.reason,
      };
    }
    return {
      revision: await revision(tx),
      current: effective.map(view),
      scheduled: scheduled.map(view),
      history: history.map(view),
      total,
      page,
      legacyServiceRate: staff?.commissionRate.toFixed(2) ?? null,
    };
  });
}

export async function commissionOptions(itemKind: CommissionKind, search: string) {
  const where = {
    status: "ACTIVE" as const,
    name: { contains: search, mode: "insensitive" as const },
  };
  const [items, total] = await Promise.all([
    itemKind === "SERVICE"
      ? prisma.service.findMany({
          where,
          select: { id: true, name: true },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: 50,
        })
      : prisma.product.findMany({
          where,
          select: { id: true, name: true },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: 50,
        }),
    itemKind === "SERVICE" ? prisma.service.count({ where }) : prisma.product.count({ where }),
  ]);
  return { items, total };
}
export async function previewCommission(input: {
  staffId: string;
  itemKind: CommissionKind;
  itemId: string;
}) {
  return prisma.$transaction(async (tx) => {
    await lockCommissionConfiguration(tx, tenantId());
    const staff = await staffRecord(tx, input.staffId);
    const args = {
      where: { id: input.itemId, status: "ACTIVE" as const },
      select: { departmentId: true },
    };
    const item =
      input.itemKind === "SERVICE"
        ? await tx.service.findFirst(args)
        : await tx.product.findFirst(args);
    if (!item) throw notFound("Active catalogue item not found.");
    const at = new Date();
    const rules = await tx.commissionRule.findMany({
      where: { OR: [{ staffId: null }, { staffId: input.staffId }], effectiveAt: { lte: at } },
    });
    return resolveCommission(
      rules,
      {
        ...input,
        departmentId: item.departmentId,
        legacyServiceRate: staff.commissionRate.toString(),
      },
      at,
    );
  });
}
