import type {
  BulkPublishCommissionRules,
  CommissionKind,
  CommissionRuleView,
  CommissionScope,
  PublishCommissionRule,
} from "@glampro_suite/shared";
import {
  commissionKindSchema,
  publishCommissionRuleSchema,
  bulkPublishCommissionRulesSchema,
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
    select: { id: true, commissionRate: true, disabled: true },
  });
  if (!staff) throw notFound("Staff member not found.");
  return staff;
}
async function catalogueItem(tx: Transaction, kind: CommissionKind, itemId: string) {
  const args = { where: { id: itemId, status: "ACTIVE" as const } };
  if (kind === "SERVICE" || kind === "FOC") return tx.service.findFirst(args);
  if (kind === "PRODUCT") return tx.product.findFirst(args);
  if (kind === "PACKAGE_SALE" || kind === "PACKAGE_REDEMPTION") return tx.package.findFirst(args);
  return tx.valuePackage.findFirst(args);
}

export async function publishCommissionRule(input: PublishCommissionRule, actorId: string) {
  const parsed = publishCommissionRuleSchema.parse(input);
  const { expectedRevision, reason, effectiveAt, ...rule } = parsed;
  const result = await publishCommissionRules(
    { expectedRevision, reason, effectiveAt, rules: [rule] },
    actorId,
  );
  return { id: result.ids[0]! };
}

export async function publishCommissionRules(raw: BulkPublishCommissionRules, actorId: string) {
  const input = bulkPublishCommissionRulesSchema.parse(raw);
  const id = tenantId();
  return prisma.$transaction(async (tx) => {
    await lockCommissionConfiguration(tx, id);
    if ((await revision(tx)) !== input.expectedRevision)
      throw conflict("Commission settings changed. Reload before publishing.");
    const actor = await tx.user.findFirst({
      where: { id: actorId },
      select: { disabled: true, globalRole: true },
    });
    if (!actor || actor.disabled || !["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole))
      throw badRequest("Only a current salon administrator or manager can publish rules.");
    const tenant = await tx.tenant.findFirst({ where: { id }, select: { status: true } });
    if (!tenant || tenant.status !== "ACTIVE")
      throw badRequest("Commission settings require an active salon.");
    for (const rule of input.rules) {
      if (rule.staffId && (await staffRecord(tx, rule.staffId)).disabled)
        throw badRequest("Cannot publish rules for disabled staff.");
      if (
        rule.scope === "DEPARTMENT" &&
        !(await tx.department.findFirst({ where: { id: rule.targetId! } }))
      )
        throw notFound("Department not found.");
      if (
        ["ITEM", "PACKAGE"].includes(rule.scope) &&
        !(await catalogueItem(tx, rule.itemKind, rule.targetId!))
      )
        throw notFound("Active catalogue item not found.");
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
    const firstTime = Math.max(now.getTime(), (latest?.createdAt.getTime() ?? 0) + 1);
    const ids: string[] = [];
    for (const [index, rule] of input.rules.entries()) {
      const created = await tx.commissionRule.create({
        data: {
          ...rule,
          tenantId: id,
          scopeKey: commissionScopeKey(rule.staffId, rule.itemKind, rule.scope, rule.targetId),
          effectiveAt,
          createdAt: new Date(firstTime + index),
          actorId,
          reason: input.reason,
        },
      });
      ids.push(created.id);
      await tx.auditLog.create({
        data: {
          tenantId: id,
          action: "commission.rule.publish",
          targetType: "CommissionRule",
          targetId: created.id,
          metadata: {
            ...rule,
            actorId,
            reason: input.reason,
            expectedRevision: input.expectedRevision,
            effectiveAt: effectiveAt.toISOString(),
            bulkSize: input.rules.length,
          },
        },
      });
    }
    return { ids, revision: ids[ids.length - 1]! };
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
    const [actors, departments, services, products, packages, credits] = await Promise.all([
      tx.user.findMany({
        where: { id: { in: rows.map((row) => row.actorId) } },
        select: { id: true, name: true },
      }),
      tx.department.findMany({ select: { id: true, name: true } }),
      tx.service.findMany({
        where: {
          id: {
            in: rows
              .filter((r) => r.scope === "ITEM" && ["SERVICE", "FOC"].includes(r.itemKind))
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
      tx.package.findMany({
        where: {
          id: {
            in: rows
              .filter((r) => ["PACKAGE_SALE", "PACKAGE_REDEMPTION"].includes(r.itemKind))
              .map((r) => r.targetId!)
              .filter(Boolean),
          },
        },
        select: { id: true, name: true },
      }),
      tx.valuePackage.findMany({
        where: {
          id: {
            in: rows
              .filter((r) => ["STORED_CREDIT_SALE", "STORED_CREDIT_SPEND"].includes(r.itemKind))
              .map((r) => r.targetId!)
              .filter(Boolean),
          },
        },
        select: { id: true, name: true },
      }),
    ]);
    const names = new Map(
      [...departments, ...services, ...products, ...packages, ...credits].map((row) => [
        row.id,
        row.name,
      ]),
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
  const args = {
    where: { status: "ACTIVE" as const, name: { contains: search, mode: "insensitive" as const } },
    select: { id: true, name: true },
    orderBy: [{ name: "asc" as const }, { id: "asc" as const }],
    take: 50,
  };
  const items = await (itemKind === "SERVICE" || itemKind === "FOC"
    ? prisma.service.findMany(args)
    : itemKind === "PRODUCT"
      ? prisma.product.findMany(args)
      : itemKind === "PACKAGE_SALE" || itemKind === "PACKAGE_REDEMPTION"
        ? prisma.package.findMany(args)
        : prisma.valuePackage.findMany(args));
  const total = await (itemKind === "SERVICE" || itemKind === "FOC"
    ? prisma.service.count({ where: args.where })
    : itemKind === "PRODUCT"
      ? prisma.product.count({ where: args.where })
      : itemKind === "PACKAGE_SALE" || itemKind === "PACKAGE_REDEMPTION"
        ? prisma.package.count({ where: args.where })
        : prisma.valuePackage.count({ where: args.where }));
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
    if (staff.disabled) throw badRequest("Cannot preview disabled staff.");
    const item = await catalogueItem(tx, input.itemKind, input.itemId);
    if (!item) throw notFound("Active catalogue item not found.");
    const at = new Date();
    const rules = await tx.commissionRule.findMany({
      where: { OR: [{ staffId: null }, { staffId: input.staffId }], effectiveAt: { lte: at } },
    });
    return resolveCommission(
      rules,
      {
        ...input,
        departmentId: "departmentId" in item ? item.departmentId : null,
        legacyServiceRate: staff.commissionRate.toString(),
      },
      at,
    );
  });
}

export async function commissionMatrix(page: number, search: string) {
  return prisma.$transaction(async (tx) => {
    await lockCommissionConfiguration(tx, tenantId());
    const where = { disabled: false, name: { contains: search, mode: "insensitive" as const } };
    const [staff, total] = await Promise.all([
      tx.user.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (page - 1) * 20,
        take: 20,
        select: { id: true, name: true, commissionRate: true },
      }),
      tx.user.count({ where }),
    ]);
    const at = new Date();
    const rules = await tx.commissionRule.findMany({
      where: {
        OR: [{ staffId: null }, { staffId: { in: staff.map((s) => s.id) } }],
        effectiveAt: { lte: at },
      },
      orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    return {
      revision: await revision(tx),
      page,
      total,
      rows: staff.map((s) => ({
        staffId: s.id,
        name: s.name,
        cells: commissionKindSchema.options.map((itemKind) => {
          const configured = rules.find(
            (r) => r.staffId === s.id && r.itemKind === itemKind && r.scope === "STAFF",
          );
          const applied = resolveCommission(
            rules,
            {
              staffId: s.id,
              itemKind,
              itemId: "",
              departmentId: null,
              legacyServiceRate: s.commissionRate.toString(),
            },
            at,
          );
          return {
            itemKind,
            configured: !!configured,
            configuredRate: configured?.rate?.toFixed(2) ?? null,
            rate: applied.rate,
            source: applied.source,
          };
        }),
      })),
    };
  });
}
