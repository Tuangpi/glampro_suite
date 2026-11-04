import type { CompanyPurgeInput } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform } from "../lib/tenant-context.js";
import { conflict, notFound } from "../lib/http-error.js";

/**
 * Every table in a company's slice, children before parents.
 *
 * Derived from the foreign keys, not from habit: a table appears here when it has
 * a `tenantId` of its own, and it appears *before* every table it points at, so
 * each `DELETE` finds no children left. The eleven `ON DELETE RESTRICT` tenant
 * references (`treatment_consent_events`, `commission_periods`,
 * `employee_commissions`, the payroll ledgers, ...) are what makes the order
 * matter — a cascade would have covered them otherwise.
 *
 * `audit_logs` is deliberately absent. Its `tenantId` is a *reference* rather than
 * a scope (`prisma.ts` → `TENANT_REFERENCE_MODELS`), the operator's record of the
 * purge has to outlive the company, and `ON DELETE SET NULL` clears the column
 * when the tenant row goes.
 *
 * `prisma.test.ts` asserts this list covers every model that carries a `tenantId`,
 * so adding a tenant-scoped model without adding it here fails the build.
 */
export const TENANT_PURGE_ORDER = [
  "payroll_cutover_events",
  "payroll_cutovers",
  "voucher_redemptions",
  "vouchers",
  "value_package_services",
  "treatment_photos",
  "treatment_consent_events",
  "treatment_records",
  "treatment_consent_forms",
  "tenant_operating_hours",
  "tenant_modules",
  "staff_shifts",
  "staff_departments",
  "session_package_transfer_events",
  "service_resources",
  "sale_refunds",
  "sale_payments",
  "public_links",
  "products",
  "prepaid_transfer_events",
  "prepaid_refund_settlements",
  "prepaid_family_members",
  "prepaid_family_events",
  "prepaid_balance_events",
  "payroll_source_events",
  "payroll_plan_versions",
  "payroll_plans",
  "payroll_configuration_events",
  "payroll_closes",
  "payroll_close_events",
  "payroll_carry_authorizations",
  "payments",
  "subscriptions",
  "package_valuation_states",
  "package_valuation_movements",
  "package_services",
  "package_purchase_snapshots",
  "package_valuation_activations",
  "owner_invitations",
  "messaging_settings",
  "message_jobs",
  "employee_performances",
  "employee_leaves",
  "employee_commissions",
  "direct_staff_tips",
  "customer_value_package_holdings",
  "value_packages",
  "prepaid_families",
  "customer_redemptions",
  "customer_points",
  "customer_photos",
  "customer_package_holdings",
  "packages",
  "customer_outstanding_payments",
  "customer_outstandings",
  "customer_gift_card_holdings",
  "sale_lines",
  "sales",
  "gift_cards",
  "customer_departments",
  "customer_consent_events",
  "privacy_notices",
  "commission_rules",
  "commission_redemption_snapshots",
  "commission_periods",
  "commission_collection_allocations",
  "commission_collections",
  "commission_attribution_policies",
  "channel_consents",
  "channel_consent_events",
  "assistant_draft_events",
  "assistant_drafts",
  "appointment_lines",
  "resources",
  "appointments",
  "users",
  "services",
  "departments",
  "customers",
  "outlets",
  "appointment_series",
] as const;

/** What the operator is told they just destroyed — and what the audit row keeps. */
export type PurgedCompany = { id: string; name: string; slug: string };

/**
 * Permanently removes one company and everything recorded under it.
 *
 * Suspending, cancelling and expiring all keep the data; this does not. The typed
 * slug is the last line of defence against a mis-click, and the whole purge is one
 * transaction so a failure halfway leaves the company exactly as it was.
 */
export async function purgeCompany(id: string, input: CompanyPurgeInput, actorId: string) {
  return runAsPlatform(() =>
    prisma.$transaction(
      async (tx) => {
        // Same lock as lifecycle writes: nobody may activate a subscription or
        // post a sale against this company while it is being taken apart.
        const locked = await tx.$queryRaw<PurgedCompany[]>`
          SELECT id, name, slug FROM tenants WHERE id = ${id} FOR UPDATE
        `;
        const company = locked[0];
        if (!company) throw notFound("Company not found.");
        if (company.slug !== input.confirmSlug)
          throw conflict(
            `Type ${company.slug} to confirm this purge.`,
            "COMPANY_CONFIRMATION_MISMATCH",
          );
        // Break-glass for the append-only guards; see the migration that adds it.
        // `true` keeps it transaction-local, so a pooled connection cannot hand it
        // to a later salon request.
        await tx.$queryRaw`SELECT set_config('glampro.purge_tenant', ${id}, true)`;
        // `tenants.ownerUserId` references `users` with ON DELETE RESTRICT and the
        // owner row is deleted below, so the reference has to be dropped first.
        await tx.$executeRaw`UPDATE tenants SET "ownerUserId" = NULL WHERE id = ${id}`;
        let deletedRows = 0;
        for (const table of TENANT_PURGE_ORDER) {
          // The table name comes from the literal list above, never from input.
          deletedRows += await tx.$executeRawUnsafe(
            `DELETE FROM "${table}" WHERE "tenantId" = $1`,
            id,
          );
        }
        await tx.$executeRaw`DELETE FROM tenants WHERE id = ${id}`;
        // Written last, after its tenant is gone: the row has to survive the purge,
        // and the company's identity rides in metadata because the FK now points at
        // nothing.
        await tx.auditLog.create({
          data: {
            actorPlatformAdminId: actorId,
            action: "company.purge",
            targetType: "Tenant",
            targetId: id,
            metadata: {
              reason: input.reason,
              company: { id: company.id, name: company.name, slug: company.slug },
              deletedRows,
            },
          },
        });
        return { purged: true as const, company, deletedRows };
      },
      { timeout: 120_000, maxWait: 30_000 },
    ),
  );
}
