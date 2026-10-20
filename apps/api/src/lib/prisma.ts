import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../generated/prisma/client.js";
import { requireScope } from "./tenant-context.js";

const connectionString = `${process.env.DATABASE_URL}`;

const adapter = new PrismaPg({ connectionString });

/**
 * Every model whose queries are filtered to the caller's tenant.
 *
 * This one list is the whole of layer 2 in `docs/saas/TENANCY.md` §1, so it is
 * kept as a single auditable constant and asserted against the schema by
 * `prisma.test.ts`. A model added to the schema with a `tenantId` and missing
 * from here fails that test.
 *
 * Names are the Prisma model names exactly as written in `schema.prisma`, which
 * is what `$allModels` handlers receive. Using the camelCase delegate name here
 * instead matches nothing and silently scopes nothing, so keep these in step with
 * the schema.
 *
 * `PlatformAdmin`, `Tenant`, `Module`, `Account`, `RefreshToken` and `JobRun`
 * are deliberately absent: they are not tenant-scoped.
 */
export const TENANT_SCOPED_MODELS = [
  "MessagingSettings",
  "ChannelConsent",
  "ChannelConsentEvent",
  "MessageJob",
  "PublicLink",
  "TenantModule",
  "Subscription",
  "Payment",
  // Domain. `User` is here because staff are user rows (Q4).
  "User",
  "Department",
  "StaffDepartment",
  "Customer",
  "CustomerPhoto",
  "PrivacyNotice",
  "CustomerConsentEvent",
  "CustomerDepartment",
  "Service",
  "Product",
  "Package",
  "PackageService",
  "ValuePackage",
  "ValuePackageService",
  "GiftCard",
  "Appointment",
  // A booking's service lines. Scoped in their own right because the overlap rule
  // queries them directly by performer and window (TK2610-0020 phase B).
  "AppointmentLine",
  "EmployeeCommission",
  "EmployeePerformance",
  "EmployeeLeave",
  "StaffShift",
  // POS. `SaleLine` is here rather than reaching the sale's tenant indirectly,
  // because a line is queried on its own (the cart) as well as through its sale.
  "Sale",
  "SaleLine",
  // A tender is queried on its own for the day's takings by method, not only through
  // its sale, so it is scoped in its own right.
  "SalePayment",
  // Customer holdings and their ledgers. Every one carries `tenantId` in its own
  // right: a redemption is read per customer, not only through its sale.
  "CustomerPackageHolding",
  "CustomerValuePackageHolding",
  "CustomerGiftCardHolding",
  "CustomerPoint",
  "CustomerOutstanding",
  "CustomerOutstandingPayment",
  "CustomerRedemption",
  // Voucher campaigns and the sales that consumed them (ADR 0020). Both carry their
  // own `tenantId`, so a code and its redemption history cannot cross salons.
  "Voucher",
  "VoucherRedemption",
  // One recorded full-sale refund per sale (ADR 0020 / R1).
  "SaleRefund",
  "DirectStaffTip",
  // Salon configuration written per tenant by Settings (P0-03). The service
  // always names `tenantId` itself, but the scope here means a handler that
  // forgets still cannot read or cross-write another salon's hours.
  "TenantOperatingHours",
] as const;

/**
 * Models that carry a `tenantId` as a *reference* rather than as a scope.
 *
 * `AuditLog.tenantId` records which tenant a privileged action was taken
 * against, and the console must read audit rows across every tenant, so it
 * cannot be scoped. Keeping the exemption named here — rather than leaving the
 * two sets to be confused — is what lets the schema test assert an exact match:
 * scoped models + these = every model with a `tenantId` column.
 */
export const TENANT_REFERENCE_MODELS = ["AuditLog"] as const;

const scopedModelSet = new Set<string>(TENANT_SCOPED_MODELS);

/** True when queries against `model` must be filtered to the caller's tenant. */
export function isTenantScoped(model: string): boolean {
  return scopedModelSet.has(model);
}

/**
 * Merges the caller's `tenantId` into a query's `where` clause.
 *
 * `findUnique` needs no special handling: Prisma has accepted extra non-unique
 * fields alongside a unique predicate since v5, so the tenant filter merges into
 * the same object. An earlier version of this file reissued `findUnique` as a
 * `findFirst` through the client delegate, which cost the call its return type
 * and added no isolation the merge does not already give.
 */
function scopeWhere<T>(args: T, tenantId: string): T {
  const source = args as { where?: Record<string, unknown> };
  return { ...source, where: { ...source.where, tenantId } } as T;
}

/** Merges the caller's `tenantId` into a single row's create `data`. */
function scopeCreateData<T>(args: T, tenantId: string): T {
  const source = args as { data: Record<string, unknown> };
  return { ...source, data: { ...source.data, tenantId } } as T;
}

/** Merges the caller's `tenantId` into every row of a `createMany` payload. */
function scopeCreateManyData<T>(args: T, tenantId: string): T {
  const source = args as { data: Record<string, unknown>[] };
  return { ...source, data: source.data.map((row) => ({ ...row, tenantId })) } as T;
}

/**
 * The tenant-scoped Prisma client.
 *
 * Scoping is applied by the extension rather than by each handler, so a handler
 * that forgets to filter still cannot read another salon's rows: every operation
 * on a model named in `TENANT_SCOPED_MODELS` passes through here first.
 *
 * Each handler is the same three-way branch, which is the entire policy. A model
 * that is not tenant-scoped is untouched. A platform scope is an explicit,
 * deliberate opt-out. Anything else must be inside `runAsTenant`, and a query
 * that is not is an error rather than an unscoped read.
 */
const prisma = new PrismaClient({ adapter }).$extends({
  name: "tenant-scope",
  query: {
    $allModels: {
      findUnique({ model, args, query }) {
        if (!isTenantScoped(model)) return query(args);
        const scope = requireScope(model);
        if (scope.kind === "platform") return query(args);
        return query(scopeWhere(args, scope.tenantId));
      },

      findUniqueOrThrow({ model, args, query }) {
        if (!isTenantScoped(model)) return query(args);
        const scope = requireScope(model);
        if (scope.kind === "platform") return query(args);
        return query(scopeWhere(args, scope.tenantId));
      },

      findFirst({ model, args, query }) {
        if (!isTenantScoped(model)) return query(args);
        const scope = requireScope(model);
        if (scope.kind === "platform") return query(args);
        return query(scopeWhere(args, scope.tenantId));
      },

      findFirstOrThrow({ model, args, query }) {
        if (!isTenantScoped(model)) return query(args);
        const scope = requireScope(model);
        if (scope.kind === "platform") return query(args);
        return query(scopeWhere(args, scope.tenantId));
      },

      findMany({ model, args, query }) {
        if (!isTenantScoped(model)) return query(args);
        const scope = requireScope(model);
        if (scope.kind === "platform") return query(args);
        return query(scopeWhere(args, scope.tenantId));
      },

      count({ model, args, query }) {
        if (!isTenantScoped(model)) return query(args);
        const scope = requireScope(model);
        if (scope.kind === "platform") return query(args);
        return query(scopeWhere(args, scope.tenantId));
      },

      aggregate({ model, args, query }) {
        if (!isTenantScoped(model)) return query(args);
        const scope = requireScope(model);
        if (scope.kind === "platform") return query(args);
        return query(scopeWhere(args, scope.tenantId));
      },

      groupBy({ model, args, query }) {
        if (!isTenantScoped(model)) return query(args);
        const scope = requireScope(model);
        if (scope.kind === "platform") return query(args);
        return query(scopeWhere(args, scope.tenantId));
      },

      create({ model, args, query }) {
        if (!isTenantScoped(model)) return query(args);
        const scope = requireScope(model);
        if (scope.kind === "platform") return query(args);
        // `tenantId` is written after the caller's own data, so a handler that
        // passes a foreign id cannot put the row in another tenant.
        return query(scopeCreateData(args, scope.tenantId));
      },

      createMany({ model, args, query }) {
        if (!isTenantScoped(model)) return query(args);
        const scope = requireScope(model);
        if (scope.kind === "platform") return query(args);
        return query(scopeCreateManyData(args, scope.tenantId));
      },

      update({ model, args, query }) {
        if (!isTenantScoped(model)) return query(args);
        const scope = requireScope(model);
        if (scope.kind === "platform") return query(args);
        return query(scopeWhere(args, scope.tenantId));
      },

      updateMany({ model, args, query }) {
        if (!isTenantScoped(model)) return query(args);
        const scope = requireScope(model);
        if (scope.kind === "platform") return query(args);
        return query(scopeWhere(args, scope.tenantId));
      },

      delete({ model, args, query }) {
        if (!isTenantScoped(model)) return query(args);
        const scope = requireScope(model);
        if (scope.kind === "platform") return query(args);
        return query(scopeWhere(args, scope.tenantId));
      },

      deleteMany({ model, args, query }) {
        if (!isTenantScoped(model)) return query(args);
        const scope = requireScope(model);
        if (scope.kind === "platform") return query(args);
        return query(scopeWhere(args, scope.tenantId));
      },
    },
  },
});

export { prisma };
