import type {
  CompanyLifecycleInput,
  RecordSubscriptionInput,
  CompanyModuleInput,
  CompanyAuditQuery,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { runAsTenant } from "../lib/tenant-context.js";
import { badRequest, conflict, notFound } from "../lib/http-error.js";
import { resolveTenantStatus } from "../lib/tenant-status.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
async function lockCompany(tx: Transaction, id: string) {
  await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${id} FOR UPDATE`;
  const company = await tx.tenant.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!company) throw notFound("Company not found.");
  return company;
}

export async function companyAdministration(id: string) {
  return runAsTenant(id, () =>
    prisma.$transaction(async (tx) => {
      // Same lock as writers: the status, periods and grants form one coherent snapshot.
      const company = await lockCompany(tx, id);
      const [subscriptions, modules, grants, latest] = await Promise.all([
        tx.subscription.findMany({
          where: { tenantId: id },
          orderBy: [{ endDate: "desc" }, { id: "desc" }],
          take: 100,
        }),
        tx.module.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
        tx.tenantModule.findMany({ where: { tenantId: id } }),
        tx.subscription.findFirst({
          where: {
            tenantId: id,
            status: { in: ["ACTIVE", "EXPIRED"] },
            startDate: { lte: new Date() },
          },
          orderBy: { endDate: "desc" },
          select: { endDate: true },
        }),
      ]);
      const now = new Date();
      return {
        effectiveStatus: resolveTenantStatus(company.status, latest?.endDate ?? null),
        subscriptions: subscriptions.map((row) => ({
          id: row.id,
          startDate: row.startDate.toISOString(),
          endDate: row.endDate.toISOString(),
          status: row.status,
          amount: row.amount.toFixed(2),
          currency: row.currency,
          createdAt: row.createdAt.toISOString(),
        })),
        modules: modules.map((module) => {
          const grant = grants.find((row) => row.moduleId === module.id);
          return {
            code: module.code,
            name: module.name,
            isCore: module.isCore,
            enabled: module.isCore || !!grant,
            entitled:
              module.isCore || (!!grant && (grant.expiresAt === null || grant.expiresAt > now)),
            expiresAt: grant?.expiresAt?.toISOString() ?? null,
          };
        }),
      };
    }),
  );
}

export async function changeCompanyLifecycle(
  id: string,
  input: CompanyLifecycleInput,
  actorId: string,
) {
  await runAsTenant(id, () =>
    prisma.$transaction(async (tx) => {
      const company = await lockCompany(tx, id);
      const status = { suspend: "SUSPENDED", reactivate: "ACTIVE", cancel: "CANCELLED" }[
        input.action
      ] as "ACTIVE" | "SUSPENDED" | "CANCELLED";
      if (company.status === status) throw conflict("The company already has that status.");
      if (input.action === "suspend" && company.status !== "ACTIVE")
        throw conflict("Only an active company can be suspended.");
      if (input.action === "reactivate") {
        const latest = await tx.subscription.findFirst({
          where: {
            tenantId: id,
            status: { in: ["ACTIVE", "EXPIRED"] },
            startDate: { lte: new Date() },
          },
          orderBy: { endDate: "desc" },
          select: { endDate: true },
        });
        if (latest && latest.endDate <= new Date())
          throw conflict("Record a current subscription before reactivating this company.");
      }
      await tx.tenant.update({ where: { id }, data: { status, tokenVersion: { increment: 1 } } });
      // User versions are what existing web/POS/mobile tokens actually validate.
      await tx.user.updateMany({
        where: { tenantId: id },
        data: {
          tokenVersion: { increment: 1 },
          twoFactorCode: null,
          twoFactorCodeExpiresAt: null,
        },
      });
      await tx.refreshToken.updateMany({
        where: { user: { tenantId: id }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorPlatformAdminId: actorId,
          tenantId: id,
          action: `company.lifecycle.${input.action}`,
          targetType: "Tenant",
          targetId: id,
          metadata: { reason: input.reason, before: company.status, after: status },
        },
      });
    }),
  );
  return { success: true as const };
}

export async function recordCompanySubscription(
  id: string,
  input: RecordSubscriptionInput,
  actorId: string,
) {
  const startDate = new Date(input.startDate),
    endDate = new Date(input.endDate);
  if (startDate > new Date() || endDate <= new Date())
    throw badRequest(
      "Record a current period: start must not be in the future and end must be in the future.",
    );
  await runAsTenant(id, () =>
    prisma.$transaction(async (tx) => {
      await lockCompany(tx, id);
      const overlap = await tx.subscription.findFirst({
        where: {
          tenantId: id,
          status: "ACTIVE",
          startDate: { lt: endDate },
          endDate: { gt: startDate },
        },
        select: { id: true },
      });
      if (overlap) throw conflict("This period overlaps an existing active subscription.");
      const row = await tx.subscription.create({
        data: {
          tenantId: id,
          startDate,
          endDate,
          status: "ACTIVE",
          amount: input.amount,
          currency: input.currency,
        },
      });
      await tx.auditLog.create({
        data: {
          actorPlatformAdminId: actorId,
          tenantId: id,
          action: "company.subscription.record",
          targetType: "Subscription",
          targetId: row.id,
          metadata: {
            reason: input.reason,
            startDate: input.startDate,
            endDate: input.endDate,
            amount: input.amount,
            currency: input.currency,
          },
        },
      });
    }),
  );
  return { success: true as const };
}

export async function changeCompanyModule(id: string, input: CompanyModuleInput, actorId: string) {
  if (input.expiresAt && new Date(input.expiresAt) <= new Date())
    throw badRequest("Choose a future module expiry.");
  if (!input.enabled && input.expiresAt !== null)
    throw badRequest("A revoked module cannot have an expiry.");
  await runAsTenant(id, () =>
    prisma.$transaction(async (tx) => {
      await lockCompany(tx, id);
      const module = await tx.module.findUnique({ where: { code: input.code } });
      if (!module) throw notFound("Module not found.");
      if (module.isCore)
        throw badRequest("Core modules are always available and cannot be changed.");
      const where = { tenantId: id, moduleId: module.id };
      const before = await tx.tenantModule.findUnique({ where: { tenantId_moduleId: where } });
      let targetId = before?.id;
      if (input.enabled) {
        const grant = await tx.tenantModule.upsert({
          where: { tenantId_moduleId: where },
          create: { ...where, expiresAt: input.expiresAt },
          update: { expiresAt: input.expiresAt },
        });
        targetId = grant.id;
      } else {
        if (!before) throw conflict("The company does not have this add-on.");
        await tx.tenantModule.deleteMany({ where });
      }
      await tx.auditLog.create({
        data: {
          actorPlatformAdminId: actorId,
          tenantId: id,
          action: input.enabled ? "company.module.grant" : "company.module.revoke",
          targetType: "TenantModule",
          targetId,
          metadata: {
            reason: input.reason,
            code: input.code,
            before: { enabled: !!before, expiresAt: before?.expiresAt?.toISOString() ?? null },
            after: { enabled: input.enabled, expiresAt: input.expiresAt },
          },
        },
      });
    }),
  );
  return { success: true as const };
}

export async function companyAudit(id: string, query: CompanyAuditQuery) {
  if (!(await prisma.tenant.findUnique({ where: { id }, select: { id: true } })))
    throw notFound("Company not found.");
  // Only company administration events, never tenant business records or auth secrets.
  const where = { tenantId: id, action: { startsWith: "company." } };
  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        createdAt: true,
        metadata: true,
        actor: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return {
    items: items.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}
