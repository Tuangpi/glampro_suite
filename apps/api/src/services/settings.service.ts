/**
 * Settings — handoff screen 11, `/api/settings`.
 *
 * Two reads and one write. The profile read names the tenant from the ambient
 * scope rather than from the request — `Tenant` is deliberately **not** in
 * `TENANT_SCOPED_MODELS` (it *is* the scope), so there is no argument to forge
 * and no header to spoof (AGENTS.md rule 1). The modules read joins the
 * platform catalogue to this salon's grants using the **same rule
 * `requireModule` enforces**, so the panel and the routes can never disagree
 * about a lapsed grant — it is a read of the boundary, not a second
 * implementation of it.
 */
import {
  moduleSummarySchema,
  salonOperatingHoursSchema,
  salonProfileSchema,
} from "@glampro_suite/shared";
import type {
  ModuleSummary,
  SalonOperatingHours,
  SalonProfile,
  UpdateSalonOperatingHoursInput,
  UpdateSalonProfileInput,
} from "@glampro_suite/shared";

import { notFound, badRequest } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";

/**
 * The caller's tenant id, or an exception.
 *
 * Thrown rather than defaulted: a settings read without a scope would read the
 * wrong salon's profile, and "which tenant" is never a question this file asks
 * the request (AGENTS.md rule 1, `docs/saas/TENANCY.md`).
 */
function requireTenantId(): string {
  const scope = currentScope();
  if (scope?.kind !== "tenant") {
    throw new Error(
      "Settings are read inside a tenant scope, and this call ran without one. " +
        "Wrap it in `runAsTenant()`.",
    );
  }
  return scope.tenantId;
}

/** `GET /api/settings/profile` */
export async function getSalonProfile(): Promise<SalonProfile> {
  const tenantId = requireTenantId();

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      lowStockThreshold: true,
      timeZone: true,
      locale: true,
      gstEnabled: true,
      gstRegistrationNumber: true,
      onlineBookingEnabled: true,
      onlineDepositAmount: true,
      onlineNoShowFee: true,
      createdAt: true,

      updatedAt: true,
      owner: { select: { id: true, name: true, email: true } },
    },
  });
  // Unreachable while `users.tenantId` is the foreign key we authenticated
  // through — but a null here would render an empty profile rather than a
  // wrong one, so it says so instead.
  if (!tenant) throw notFound("This salon's record could not be found.", "TENANT_NOT_FOUND");

  return salonProfileSchema.parse({
    ...tenant,
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
  });
}

/**
 * `PATCH /api/settings/profile` — the salon's editable profile fields.
 *
 * `slug` and `status` are not accepted at all (the schema is `.strict()`): the
 * first is the isolation key's public face and the second is the platform
 * console's verdict, so neither is the salon's to write. The route adds
 * `requireRole` and `requireWritableTenant()` on top — this service trusts the
 * boundary, it does not re-implement it.
 */
export async function updateSalonProfile(input: UpdateSalonProfileInput): Promise<SalonProfile> {
  const tenantId = requireTenantId();

  // GST pair guard (TK2610-0009 / P0-01): the stored pair can never be
  // "enabled but unnumbered". The schema already refuses `gstEnabled: true`
  // without a number in the same request; these checks cover the cases the
  // schema cannot see — enabling against an empty stored number, or clearing
  // the number while GST stays enabled.
  const touchesGst = input.gstEnabled !== undefined || input.gstRegistrationNumber !== undefined;
  if (touchesGst) {
    const current = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { gstEnabled: true, gstRegistrationNumber: true },
    });
    if (!current) throw notFound("This salon's record could not be found.", "TENANT_NOT_FOUND");
    const nextEnabled = input.gstEnabled ?? current.gstEnabled;
    const nextNumber =
      input.gstRegistrationNumber !== undefined
        ? input.gstRegistrationNumber
        : current.gstRegistrationNumber;
    if (nextEnabled && (nextNumber === null || nextNumber.trim().length === 0)) {
      throw badRequest("A GST registration number is required when GST is enabled.", [
        { path: "body.gstRegistrationNumber", message: "Required when GST is enabled." },
      ]);
    }
  }

  await prisma.tenant.update({ where: { id: tenantId }, data: { ...input } });
  return getSalonProfile();
}

/**
 * `GET /api/settings/modules` — the catalogue joined to this salon's grants.
 *
 * `Module` is platform data and unscoped on purpose; the grants are read in the
 * tenant scope, so this answers for exactly one salon. The `entitled` rule is
 * `moduleEntitlements()`' own: core passes as soon as the tenant exists, an
 * add-on needs a live `TenantModule` row (present, and not past `expiresAt`).
 */
export async function listModules(): Promise<ModuleSummary[]> {
  requireTenantId();

  const [modules, grants] = await Promise.all([
    prisma.module.findMany({
      select: { code: true, name: true, category: true, isCore: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    }),
    prisma.tenantModule.findMany({
      select: { expiresAt: true, module: { select: { code: true } } },
    }),
  ]);

  const grantByCode = new Map(grants.map((grant) => [grant.module.code, grant.expiresAt] as const));
  const now = new Date();

  return modules.map((module) => {
    const granted = grantByCode.has(module.code);
    const expiry = grantByCode.get(module.code) ?? null;
    // The rule `moduleEntitlements()` runs: core passes on its own, an add-on
    // needs a row that is present and not past its `expiresAt`. `granted` is
    // tracked apart from `expiry` because "no grant" and "open-ended grant"
    // are both a `null` instant but only one of them is entitled.
    const entitled =
      module.isCore || (granted && (expiry === null || expiry.getTime() > now.getTime()));

    return moduleSummarySchema.parse({
      code: module.code,
      name: module.name,
      category: module.category,
      isCore: module.isCore,
      entitled,
      expiresAt: granted && expiry !== null ? expiry.toISOString() : null,
    });
  });
}

/** `GET /api/settings/hours` — the salon's published operating hours. */
export async function getSalonOperatingHours(): Promise<SalonOperatingHours> {
  const tenantId = requireTenantId();

  const hours = await prisma.tenantOperatingHours.findUnique({
    where: { tenantId },
  });

  const allClosed = {
    sunday: null,
    monday: null,
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
    saturday: null,
  };

  return salonOperatingHoursSchema.parse({
    tenantId,
    ...allClosed,
    ...(hours ? {
      sunday: hours.sundayOpen && hours.sundayClose
        ? { open: hours.sundayOpen, close: hours.sundayClose }
        : null,
      monday: hours.mondayOpen && hours.mondayClose
        ? { open: hours.mondayOpen, close: hours.mondayClose }
        : null,
      tuesday: hours.tuesdayOpen && hours.tuesdayClose
        ? { open: hours.tuesdayOpen, close: hours.tuesdayClose }
        : null,
      wednesday: hours.wednesdayOpen && hours.wednesdayClose
        ? { open: hours.wednesdayOpen, close: hours.wednesdayClose }
        : null,
      thursday: hours.thursdayOpen && hours.thursdayClose
        ? { open: hours.thursdayOpen, close: hours.thursdayClose }
        : null,
      friday: hours.fridayOpen && hours.fridayClose
        ? { open: hours.fridayOpen, close: hours.fridayClose }
        : null,
      saturday: hours.saturdayOpen && hours.saturdayClose
        ? { open: hours.saturdayOpen, close: hours.saturdayClose }
        : null,
    } : {}),
  });
}

/**
 * `PATCH /api/settings/hours` — save the salon's operating hours.
 *
 * Only the days sent are changed; omitted days keep their stored values.
 * Creates the row when none exists yet.
 */
export async function updateSalonOperatingHours(
  input: UpdateSalonOperatingHoursInput,
): Promise<SalonOperatingHours> {
  const tenantId = requireTenantId();

  const days = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ] as const;

  const data: Record<string, { set?: string | null }> = {};
  for (const day of days) {
    const value = input[day];
    // Omitted days are left out of `update` entirely so stored values survive.
    if (value === undefined) continue;
    data[`${day}Open`] = { set: value?.open ?? null };
    data[`${day}Close`] = { set: value?.close ?? null };
  }

  await prisma.tenantOperatingHours.upsert({
    where: { tenantId },
    update: data,
    create: {
      tenantId,
      ...Object.fromEntries(
        days.flatMap((day) => [
          [`${day}Open`, input[day]?.open ?? null],
          [`${day}Close`, input[day]?.close ?? null],
        ]),
      ),
    },
  });

  return getSalonOperatingHours();
}
