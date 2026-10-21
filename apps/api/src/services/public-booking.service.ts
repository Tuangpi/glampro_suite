import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { notFound, badRequest } from "../lib/http-error.js";
import { assertStaffAvailable } from "./staff-availability.service.js";
import { createAppointment } from "./appointment.service.js";
import { createCustomer } from "./customer.service.js";


type TenantPublic = {
  id: string;
  name: string;
  slug: string;
  timeZone: string;
  locale: string;
  onlineBookingEnabled: boolean;
  onlineDepositAmount: number;
  onlineNoShowFee: number;
};

async function resolveTenant(slug: string): Promise<TenantPublic> {
  const tenant = await runAsPlatform(() =>
    prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        timeZone: true,
        locale: true,
        onlineBookingEnabled: true,
        onlineDepositAmount: true,
        onlineNoShowFee: true,
        status: true,
      },
    }),
  );
  if (!tenant || !tenant.onlineBookingEnabled) {
    throw notFound("Online booking is not available for this salon.", "ONLINE_BOOKING_DISABLED");
  }
  return tenant as TenantPublic;
}

function parseTimeToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function getOffsetMinutes(timeZone: string, date: Date): number {
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = date.toLocaleString("en-US", { timeZone });
  const utc = new Date(utcStr);
  const tz = new Date(tzStr);
  return (tz.getTime() - utc.getTime()) / 60_000;
}

function wallClockToUtc(timeZone: string, date: string, time: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  const offset = getOffsetMinutes(timeZone, guess);
  return new Date(guess.getTime() - offset * 60_000);
}

export async function getPublicBookingConfig(slug: string) {
  const tenant = await resolveTenant(slug);
  const services = await runAsTenant(tenant.id, () =>
    prisma.service.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, durationMinutes: true, memberPrice: true, departmentId: true },

      orderBy: { name: "asc" },
    }),
  );
  const hours = await runAsTenant(tenant.id, () =>
    prisma.tenantOperatingHours.findUnique({ where: { tenantId: tenant.id } }),
  );
  return {
    tenant: { name: tenant.name, slug: tenant.slug, timeZone: tenant.timeZone, locale: tenant.locale },
    onlineBookingEnabled: tenant.onlineBookingEnabled,
    depositAmount: tenant.onlineDepositAmount,
    noShowFee: tenant.onlineNoShowFee,
    services: services.map((s) => ({

      id: s.id,
      name: s.name,
      durationMinutes: s.durationMinutes,
      price: s.memberPrice,

    })),
    hours,
  };
}

export interface PublicAvailabilityQuery {
  serviceId: string;
  date: string;
}

export async function getPublicAvailability(slug: string, query: PublicAvailabilityQuery) {
  const tenant = await resolveTenant(slug);
  const service = await runAsTenant(tenant.id, () =>
    prisma.service.findFirst({ where: { id: query.serviceId, status: "ACTIVE" } }),

  );
  if (!service) throw notFound("Service not found.", "SERVICE_NOT_FOUND");

  const hours = await runAsTenant(tenant.id, () =>
    prisma.tenantOperatingHours.findUnique({ where: { tenantId: tenant.id } }),
  );

  const jsDate = new Date(`${query.date}T00:00:00Z`);
  const dayName = jsDate.toLocaleDateString("en-US", { timeZone: tenant.timeZone, weekday: "long" }).toLowerCase();
  const open = (hours as Record<string, string | null> | null)?.[`${dayName}Open`] ?? null;
  const close = (hours as Record<string, string | null> | null)?.[`${dayName}Close`] ?? null;

  if (!open || !close) return { slots: [] as string[] };

  const openMin = parseTimeToMinutes(open);
  const closeMin = parseTimeToMinutes(close);
  const duration = service.durationMinutes ?? 30;
  const step = 30;

  const candidates = await runAsTenant(tenant.id, () =>
    prisma.user.findMany({
      where: {
        disabled: false,
        ...(service.departmentId ? { departments: { some: { departmentId: service.departmentId } } } : {}),
      },
      select: { id: true },
    }),
  );

  const slots: string[] = [];
  for (let cursor = openMin; cursor + duration <= closeMin; cursor += step) {
    const time = minutesToTime(cursor);
    const instant = wallClockToUtc(tenant.timeZone, query.date, time);
    const end = new Date(instant.getTime() + duration * 60_000);
    if (instant.getTime() <= Date.now()) continue;

    let available = false;
    if (candidates.length === 0) {
      available = true;
    } else {
      for (const c of candidates) {
        try {
          await assertStaffAvailable(c.id, instant, end);
          const clash = await runAsTenant(tenant.id, () =>
            prisma.appointment.count({
              where: {
                staffId: c.id,
                status: { not: "CANCELLED" },
                startsAt: { lt: end },
                endsAt: { gt: instant },
              },
            }),
          );
          if (clash === 0) {
            available = true;
            break;
          }
        } catch {
          // unavailable
        }
      }
    }
    if (available) slots.push(instant.toISOString());
  }
  return { slots };
}

export interface PublicBookingInput {
  serviceId: string;
  startsAt: string;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  consentGiven?: boolean;
}

export async function createPublicBooking(slug: string, input: PublicBookingInput) {
  if (!input.consentGiven) {
    throw badRequest("PDPA consent is required.", "CONSENT_REQUIRED");
  }
  const tenant = await resolveTenant(slug);

  const service = await runAsTenant(tenant.id, () =>
    prisma.service.findFirst({ where: { id: input.serviceId, status: "ACTIVE" } }),

  );
  if (!service) throw notFound("Service not found.", "SERVICE_NOT_FOUND");

  let customerId: string | undefined;
  await runAsTenant(tenant.id, async () => {
    if (input.customerPhone) {
      const existing = await prisma.customer.findFirst({ where: { phone: input.customerPhone } });
      if (existing) customerId = existing.id;
    }
    if (!customerId) {
      const created = await createCustomer({
        name: input.customerName,
        phone: input.customerPhone ?? undefined,
        email: input.customerEmail ?? undefined,

      });
      customerId = created.id;
    }
  });

  const candidates = await runAsTenant(tenant.id, () =>
    prisma.user.findMany({
      where: {
        disabled: false,
        ...(service.departmentId ? { departments: { some: { departmentId: service.departmentId } } } : {}),
      },
      select: { id: true },
    }),
  );
  const start = new Date(input.startsAt);
  const duration = service.durationMinutes ?? 30;
  const end = new Date(start.getTime() + duration * 60_000);
  let staffId: string | undefined;
  for (const c of candidates) {
    try {
      await assertStaffAvailable(c.id, start, end);
      const clash = await runAsTenant(tenant.id, () =>
        prisma.appointment.count({
          where: {
            staffId: c.id,
            status: { not: "CANCELLED" },
            startsAt: { lt: end },
            endsAt: { gt: start },
          },
        }),
      );
      if (clash === 0) {
        staffId = c.id;
        break;
      }
    } catch {
      // unavailable
    }
  }

  const created = await runAsTenant(tenant.id, () =>
    createAppointment({
      customerId: customerId ?? undefined,
      serviceId: input.serviceId,
      staffId,
      startsAt: input.startsAt,
    }),
  );

  await runAsTenant(tenant.id, () =>
    prisma.appointment.update({
      where: { id: created.appointment.id },
      data: {
        source: "ONLINE",
        depositAmount: tenant.onlineDepositAmount > 0 ? tenant.onlineDepositAmount : null,
        noShowFee: tenant.onlineNoShowFee > 0 ? tenant.onlineNoShowFee : null,
      },
    }),
  );

  return {
    appointmentId: created.appointment.id,
    depositAmount: tenant.onlineDepositAmount,
    noShowFee: tenant.onlineNoShowFee,
    message:
      tenant.onlineDepositAmount > 0
        ? "Booking created. A deposit is required."
        : "Booking created.",
  };
}

