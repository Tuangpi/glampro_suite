import { prisma } from "../lib/prisma.js";
import { runAsTenant } from "../lib/tenant-context.js";
import { conflict, notFound } from "../lib/http-error.js";
import { resolveTenantStatus } from "../lib/tenant-status.js";
import { salonDayBounds, wallClockAt } from "../lib/wall-clock.js";
import {
  publicAvailabilitySchema,
  publicBookingSchema,
  type PublicAvailabilityQuery,
  type PublicBookingInput,
} from "../schemas/public-booking.js";
import {
  createAppointmentInTransaction,
  isAppointmentSlotAvailable,
  lockBookingCalendar,
} from "./appointment.service.js";
import { type Tx } from "./messaging.service.js";

export type { PublicBookingInput } from "../schemas/public-booking.js";

async function resolveTenant(slug: string, db: Tx) {
  const tenant = await db.tenant.findUnique({
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
      subscriptions: { orderBy: { endDate: "desc" }, take: 1, select: { endDate: true } },
    },
  });
  if (
    !tenant ||
    !tenant.onlineBookingEnabled ||
    resolveTenantStatus(tenant.status, tenant.subscriptions[0]?.endDate ?? null) !== "ACTIVE"
  ) {
    throw notFound("Online booking is not available for this salon.", "ONLINE_BOOKING_DISABLED");
  }
  return tenant;
}

async function currentNotice(db: Tx) {
  return db.privacyNotice.findFirst({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, version: true, dataConsentText: true },
  });
}

export async function getPublicBookingConfig(slug: string) {
  const tenant = await resolveTenant(slug, prisma);
  return runAsTenant(tenant.id, async () => {
    const [services, hours, privacyNotice] = await Promise.all([
      prisma.service.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, name: true, durationMinutes: true, nonmemberPrice: true },
        orderBy: { name: "asc" },
      }),
      prisma.tenantOperatingHours.findUnique({ where: { tenantId: tenant.id } }),
      currentNotice(prisma),
    ]);
    return {
      tenant: {
        name: tenant.name,
        slug: tenant.slug,
        timeZone: tenant.timeZone,
        locale: tenant.locale,
      },
      onlineBookingEnabled: true,
      depositAmount: tenant.onlineDepositAmount,
      noShowFee: tenant.onlineNoShowFee,
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        durationMinutes:
          service.durationMinutes && service.durationMinutes > 0 ? service.durationMinutes : 60,
        price: service.nonmemberPrice,
      })),
      hours,
      privacyNotice,
    };
  });
}

function localDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join("-");
}

async function slotContext(db: Tx, tenantId: string, serviceId: string) {
  const service = await db.service.findFirst({ where: { id: serviceId, status: "ACTIVE" } });
  if (!service) throw notFound("Service not found.", "SERVICE_NOT_FOUND");
  const [hours, candidates] = await Promise.all([
    db.tenantOperatingHours.findUnique({ where: { tenantId } }),
    db.user.findMany({
      where: {
        disabled: false,
        ...(service.departmentId
          ? { departments: { some: { departmentId: service.departmentId } } }
          : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
    }),
  ]);
  return {
    service,
    hours,
    candidates,
    duration: service.durationMinutes && service.durationMinutes > 0 ? service.durationMinutes : 60,
  };
}

function withinHours(
  context: Awaited<ReturnType<typeof slotContext>>,
  start: Date,
  timeZone: string,
) {
  const end = new Date(start.getTime() + context.duration * 60_000);
  if (
    start <= new Date() ||
    start.getUTCSeconds() !== 0 ||
    start.getUTCMilliseconds() !== 0 ||
    localDate(start, timeZone) !== localDate(new Date(end.getTime() - 1), timeZone)
  )
    return false;
  const clock = wallClockAt(start, timeZone);
  const day = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][
    clock.dayOfWeek
  ]!;
  const hours = context.hours as Record<string, unknown> | null;
  const open = hours?.[`${day}Open`];
  const close = hours?.[`${day}Close`];
  if (typeof open !== "string" || typeof close !== "string") return false;
  const minutes = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    return h! * 60 + m!;
  };
  const finish = wallClockAt(new Date(end.getTime() - 1), timeZone).minutes + 1;
  return (
    clock.minutes >= minutes(open) &&
    finish <= minutes(close) &&
    (clock.minutes - minutes(open)) % 30 === 0
  );
}

async function availableStaff(
  db: Tx,
  context: Awaited<ReturnType<typeof slotContext>>,
  start: Date,
) {
  for (const staff of context.candidates) {
    if (await isAppointmentSlotAvailable(db, context.service.id, staff.id, start)) return staff.id;
  }
  return null;
}

export async function getPublicAvailability(slug: string, input: PublicAvailabilityQuery) {
  const query = publicAvailabilitySchema.parse(input);
  const tenant = await resolveTenant(slug, prisma);
  return runAsTenant(tenant.id, async () => {
    if (!(await currentNotice(prisma))) return { slots: [] as string[] };
    const context = await slotContext(prisma, tenant.id, query.serviceId);
    const bounds = salonDayBounds(query.date, tenant.timeZone);
    const slots: string[] = [];
    // Walk real instants: skipped/repeated DST hours retain their correct offsets.
    for (let cursor = bounds.from.getTime(); cursor < bounds.to.getTime(); cursor += 60_000) {
      const start = new Date(cursor);
      if (
        withinHours(context, start, tenant.timeZone) &&
        (await availableStaff(prisma, context, start))
      ) {
        slots.push(start.toISOString());
      }
    }
    return { slots };
  });
}

export async function createPublicBooking(slug: string, rawInput: PublicBookingInput) {
  const input = publicBookingSchema.parse(rawInput);
  const tenant = await resolveTenant(slug, prisma);
  return runAsTenant(tenant.id, () =>
    prisma.$transaction(
      async (tx) => {
        await lockBookingCalendar(tx);
        const currentTenant = await resolveTenant(slug, tx);
        const notice = await currentNotice(tx);
        if (!notice || notice.id !== input.noticeId) {
          throw conflict(
            "Review the current privacy notice before booking.",
            "PRIVACY_NOTICE_REQUIRED",
          );
        }
        const context = await slotContext(tx, tenant.id, input.serviceId);
        const start = new Date(input.startsAt);
        const staffId = withinHours(context, start, currentTenant.timeZone)
          ? await availableStaff(tx, context, start)
          : null;
        if (!staffId) {
          throw conflict(
            "That time is no longer available. Choose another slot.",
            "BOOKING_SLOT_UNAVAILABLE",
          );
        }

        // Unverified public contact details must not grant access to an existing record.
        if (
          input.customerEmail &&
          (await tx.customer.findFirst({ where: { email: input.customerEmail } }))
        ) {
          throw conflict(
            "Please contact the salon to book with this email address.",
            "BOOKING_CONTACT_REQUIRED",
          );
        }
        const customer = await tx.customer.create({
          data: {
            tenantId: "",
            name: input.customerName,
            phone: input.customerPhone,
            email: input.customerEmail,
            pdpaConsent: true,
            consentRevision: 1,
          },
        });
        await tx.customerConsentEvent.create({
          data: {
            tenantId: "",
            customerId: customer.id,
            revision: 1,
            pdpaConsent: true,
            marketingOptIn: false,
            noticeId: notice.id,
            recordedById: "public-booking:self-reported",
          },
        });
        const created = await createAppointmentInTransaction(tx, {
          customerId: customer.id,
          serviceId: input.serviceId,
          staffId,
          startsAt: input.startsAt,
        });
        await tx.appointment.update({
          where: { id: created.id },
          data: {
            source: "ONLINE",
            depositAmount:
              currentTenant.onlineDepositAmount > 0 ? currentTenant.onlineDepositAmount : null,
            noShowFee: currentTenant.onlineNoShowFee > 0 ? currentTenant.onlineNoShowFee : null,
          },
        });
        return {
          appointmentId: created.id,
          depositAmount: currentTenant.onlineDepositAmount,
          noShowFee: currentTenant.onlineNoShowFee,
          message:
            currentTenant.onlineDepositAmount > 0
              ? "Booking created. Contact the salon to arrange the deposit; no payment was collected online."
              : "Booking created. No payment was collected online.",
        };
      },
      { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 30_000 },
    ),
  );
}
