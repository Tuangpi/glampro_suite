/**
 * Development / bootstrap seed.
 *
 * `SEED_MODE=production` creates exactly one administrator from
 * `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` and touches nothing else;
 * `SEED_MODE=development` (default) also creates the demo salon crew. Re-running
 * after a fresh `db:reset` refreshes the demo instead of duplicating it — every
 * catalogue row is looked up by its natural key, and the bookings and sales are
 * written by their fixed ids / idempotency keys.
 */
import "dotenv/config";

import bcrypt from "bcrypt";
import { CORE_MODULE_CODES, MODULE_CODES, MODULE_NAMES } from "@glampro_suite/shared";

import {
  DEMO_APPOINTMENTS,
  DEMO_CUSTOMERS,
  DEMO_DEPARTMENTS,
  DEMO_GIFT_CARDS,
  DEMO_PACKAGES,
  DEMO_PRODUCTS,
  DEMO_SALES,
  DEMO_SERVICES,
  DEMO_SHIFTS,
  DEMO_STAFF,
  DEMO_VALUE_PACKAGES,
  STAFF_DEPARTMENTS,
} from "./seed-data.js";
import {
  FALLBACK_DURATION_MINUTES,
  appointmentWindow,
  assertNoAppointmentClash,
  centsToMoney,
  demoSaleTotalCents,
  saleMoment,
  tenderAmountsCents,
  toCents,
  type ClashWindow,
} from "./seed-logic.js";

import { createSale } from "../src/services/sale.service.js";
import { prisma } from "../src/lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../src/lib/tenant-context.js";

type SeedRole = "SUPER_ADMIN" | "MANAGER" | "STAFF" | "CASHIER";

// The seeded `Module.name` comes from `MODULE_NAMES` in `@glampro_suite/shared`,
// which is also what `requireModule` names an add-on from when it refuses a route.
// One map, so the Modules panel and the refusal cannot disagree — see the comment
// on that constant.

const MODULE_CATEGORIES: Record<(typeof MODULE_CODES)[number], string> = {
  dashboard: "Core",
  appointments: "Core",
  customers: "Core",
  catalogue: "Core",
  staff: "Core",
  packages: "Add-on",
  giftCards: "Add-on",
  memberships: "Add-on",
  inventory: "Add-on",
  reports: "Add-on",
  employeeCommission: "Add-on",
  sales: "Core",
  expenses: "Add-on",
  stock: "Add-on",
};

interface SeedUser {
  email: string;
  name: string;
  password: string;
  globalRole: SeedRole;
}

const SEED_MODE = process.env.SEED_MODE === "production" ? "production" : "development";
const BCRYPT_ROUNDS = 10;

function resolveAdmin(): SeedUser {
  return {
    email: process.env.ADMIN_EMAIL ?? "superadmin@gmail.com",
    name: process.env.ADMIN_NAME ?? "Glampro Administrator",
    password: process.env.ADMIN_PASSWORD ?? "admin12345",
    globalRole: "SUPER_ADMIN",
  };
}

const DEMO_TENANT = {
  slug: "glampro-demo",
  name: "Glampro Demo Salon",
};

async function seedTenant(): Promise<string> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: DEMO_TENANT.slug },
    update: { name: DEMO_TENANT.name },
    create: { name: DEMO_TENANT.name, slug: DEMO_TENANT.slug },
    select: { id: true, slug: true },
  });

  console.log(`  ✔ tenant ${tenant.slug} (${tenant.id})`);
  return tenant.id;
}

function isCore(code: string): boolean {
  return (CORE_MODULE_CODES as readonly string[]).includes(code);
}

/**
 * The module catalogue is platform data, so it is written with an unscoped
 * client in both modes. `isCore` derives from `CORE_MODULE_CODES` — the single
 * source the entitlement list could disagree with.
 */
async function seedModules(): Promise<void> {
  for (const [index, code] of MODULE_CODES.entries()) {
    await prisma.module.upsert({
      where: { code },
      update: {
        name: MODULE_NAMES[code],
        category: MODULE_CATEGORIES[code],
        isCore: isCore(code),
        sortOrder: index,
      },
      create: {
        code,
        name: MODULE_NAMES[code],
        category: MODULE_CATEGORIES[code],
        isCore: isCore(code),
        sortOrder: index,
      },
    });
  }

  console.log(`  ✔ ${MODULE_CODES.length} modules (${MODULE_CODES.filter(isCore).length} core)`);
}

/**
 * Grants the demo salon the add-ons its demonstrable screens need.
 *
 * A `TenantModule` row is how entitlement is recorded, and **nothing creates one
 * yet** — the platform console does that, and it has no phase (see `docs/roadmap.md`
 * → Not scheduled yet). Seeding these keeps a fresh `db:reset` showing the Packages
 * and Gift cards tabs rather than a 403 that reads as "this feature is broken" when
 * truth is "this salon has not bought it". Reports joins them because
 * `/reports` is part of the minimal-complete MVP (`docs/mvp.md` M3).
 */
async function seedEntitlements(tenantId: string): Promise<void> {
  for (const code of ["packages", "giftCards", "reports"] as const) {
    const module = await prisma.module.upsert({
      where: { code },
      update: {},
      create: { code, name: MODULE_NAMES[code], category: "Add-on", isCore: false },
    });

    await prisma.tenantModule.upsert({
      // `TenantModule` alone is unscoped in the platform context the modules
      // are seeded from — only the tenant module grant is looked up by its
      // real unique key.
      where: { tenantId_moduleId: { tenantId, moduleId: module.id } },
      update: { expiresAt: null },
      create: { tenantId, moduleId: module.id },
    });
  }

  console.log("  ✔ entitlements — packages, giftCards, reports (demo salon)");
}

/*
 * The demo catalogue, the customer book, the book and the till — development
 * only. Every function below is **idempotent**: a department is found by its
 * natural key (`@@unique([tenantId, name])`), a service, product, package, gift
 * card or value package by `(tenantId, name)` — none of those models has a unique
 * constraint on the name, so the seed looks one up rather than upserting — and a
 * customer by its per-tenant email (`@@unique([tenantId, email])`, ADR 0003).
 * Appointments are upserted by the fixed ids `seed-data.ts` gives them and sales
 * by Q16's idempotency key. `npm run db:seed` on an existing demo database
 * therefore refreshes the demo rather than duplicating it.
 */

async function seedDepartments(tenantId: string): Promise<{ id: string; name: string }[]> {
  for (const name of DEMO_DEPARTMENTS) {
    await prisma.department.upsert({
      where: { tenantId_name: { tenantId, name } },
      update: {},
      create: { tenantId, name },
    });
  }

  console.log(`  ✔ ${DEMO_DEPARTMENTS.length} departments`);

  return prisma.department.findMany({
    where: { tenantId },
    select: { id: true, name: true },
  });
}

/**
 * Links each seeded performer to their branch(es).
 *
 * The performers are the only users with `STAFF_DEPARTMENTS` entries — the
 * manager, the front desk and the administrator do no services, so they must
 * not appear in the till's per-line staff picker. A re-seed adds missing links
 * and leaves existing ones alone.
 */
async function seedStaffDepartments(tenantId: string): Promise<void> {
  const departments = await prisma.department.findMany({
    where: { tenantId },
    select: { id: true, name: true },
  });
  const departmentByName = new Map(departments.map((row) => [row.name, row.id]));

  let linked = 0;

  for (const [email, names] of Object.entries(STAFF_DEPARTMENTS)) {
    const user = await prisma.user.findFirst({
      where: { tenantId, email },
      select: { id: true },
    });
    if (!user) continue;

    for (const name of names) {
      const departmentId = departmentByName.get(name);
      if (!departmentId) continue;

      const existing = await prisma.staffDepartment.findFirst({
        where: { userId: user.id, departmentId },
        select: { id: true },
      });
      if (existing) continue;

      await prisma.staffDepartment.create({
        data: { tenantId, userId: user.id, departmentId },
      });
      linked += 1;
    }
  }

  console.log(`  ✔ staff departments linked (${linked} new)`);
}

/**
 * Publishes the demo rota — Phase 6e's data, one row per (performer, weekday,
 * interval), upserted by the fixed ids `seed-data.ts` gives them so a re-seed
 * refreshes the hours rather than appending a second rota.
 *
 * Runs inside `runAsTenant`, so the Prisma extension scopes every query the way
 * a request would; the `tenantId` passed here matches what other seed writers do
 * and what the extension would inject.
 */
async function seedShifts(tenantId: string): Promise<void> {
  const users = await prisma.user.findMany({
    where: { tenantId },
    select: { id: true, email: true },
  });
  const userByEmail = new Map(users.map((row) => [row.email, row.id]));

  let written = 0;
  for (const shift of DEMO_SHIFTS) {
    const userId = userByEmail.get(shift.staffEmail);
    // The roster and `DEMO_STAFF` are one dataset, but a production-mode crew
    // has no performers — skipping quietly keeps this function mode-agnostic.
    if (!userId) continue;

    const data = {
      tenantId,
      userId,
      dayOfWeek: shift.dayOfWeek,
      kind: shift.kind,
      startsAtMinute: shift.startsAtMinute,
      endsAtMinute: shift.endsAtMinute,
      note: shift.note,
    };

    await prisma.staffShift.upsert({
      where: { id: shift.id },
      update: data,
      create: { id: shift.id, ...data },
    });
    written += 1;
  }

  console.log(`  ✔ ${written} shift row(s)`);
}

async function seedServices(
  tenantId: string,
  departments: { id: string; name: string }[],
): Promise<{ id: string; name: string }[]> {
  for (const service of DEMO_SERVICES) {
    const department = departments.find((row) => row.name === service.department);
    if (!department) continue;

    // No unique constraint on the name, so look the row up rather than
    // upserting — `findFirst` is tenant-scoped by the extension, which is the
    // lookup `upsert`'s `where` would have needed.
    const existing = await prisma.service.findFirst({
      where: { tenantId, name: service.name },
      select: { id: true },
    });

    if (existing) {
      await prisma.service.update({
        where: { id: existing.id },
        data: {
          memberPrice: service.memberPrice,
          nonmemberPrice: service.nonmemberPrice,
          durationMinutes: service.durationMinutes,
          points: service.points,
          description: service.description,
          departmentId: department.id,
        },
      });
    } else {
      await prisma.service.create({
        data: {
          tenantId,
          name: service.name,
          memberPrice: service.memberPrice,
          nonmemberPrice: service.nonmemberPrice,
          durationMinutes: service.durationMinutes,
          points: service.points,
          description: service.description,
          departmentId: department.id,
        },
      });
    }
  }

  console.log(`  ✔ ${DEMO_SERVICES.length} service(s)`);

  return prisma.service.findMany({ where: { tenantId }, select: { id: true, name: true } });
}

async function seedProducts(
  tenantId: string,
  departments: { id: string; name: string }[],
): Promise<void> {
  for (const product of DEMO_PRODUCTS) {
    const department = departments.find((row) => row.name === product.department);
    if (!department) continue;

    const existing = await prisma.product.findFirst({
      where: { tenantId, name: product.name },
      select: { id: true },
    });

    if (existing) {
      await prisma.product.update({
        where: { id: existing.id },
        data: {
          memberPrice: product.memberPrice,
          nonmemberPrice: product.nonmemberPrice,
          quantity: product.quantity,
          points: product.points,
          description: product.description,
          departmentId: department.id,
        },
      });
    } else {
      await prisma.product.create({
        data: {
          tenantId,
          name: product.name,
          memberPrice: product.memberPrice,
          nonmemberPrice: product.nonmemberPrice,
          quantity: product.quantity,
          points: product.points,
          description: product.description,
          departmentId: department.id,
        },
      });
    }
  }

  console.log(`  ✔ ${DEMO_PRODUCTS.length} product(s)`);
}

async function seedPackages(
  tenantId: string,
  services: { id: string; name: string }[],
): Promise<void> {
  const serviceByName = new Map(services.map((row) => [row.name, row.id]));

  for (const pkg of DEMO_PACKAGES) {
    const serviceIds = pkg.services
      .map((name) => serviceByName.get(name))
      .filter((id): id is string => id !== undefined);

    if (serviceIds.length === 0) continue;

    const existing = await prisma.package.findFirst({
      where: { tenantId, name: pkg.name },
      select: { id: true },
    });

    const packageId =
      existing?.id ??
      (
        await prisma.package.create({
          data: {
            tenantId,
            name: pkg.name,
            sessionCount: pkg.sessionCount,
            memberPrice: pkg.memberPrice,
            nonmemberPrice: pkg.nonmemberPrice,
            description: pkg.description,
          },
          select: { id: true },
        })
      ).id;

    if (existing) {
      await prisma.package.update({
        where: { id: packageId },
        data: {
          sessionCount: pkg.sessionCount,
          memberPrice: pkg.memberPrice,
          nonmemberPrice: pkg.nonmemberPrice,
          description: pkg.description,
        },
      });
    }

    // A package holds `{ tenantId, packageId, serviceId }` rows — one per
    // service it covers. `createMany` with `skipDuplicates` keeps a re-seed
    // from duplicating the join rows.
    await prisma.packageService.createMany({
      data: serviceIds.map((serviceId) => ({ tenantId, packageId, serviceId })),
      skipDuplicates: true,
    });
  }

  console.log(`  ✔ ${DEMO_PACKAGES.length} package(s)`);
}

async function seedValuePackages(
  tenantId: string,
  services: { id: string; name: string }[],
): Promise<void> {
  const serviceByName = new Map(services.map((row) => [row.name, row.id]));

  for (const pkg of DEMO_VALUE_PACKAGES) {
    const serviceIds = pkg.services
      .map((name) => serviceByName.get(name))
      .filter((id): id is string => id !== undefined);

    if (serviceIds.length === 0) continue;

    const existing = await prisma.valuePackage.findFirst({
      where: { tenantId, name: pkg.name },
      select: { id: true },
    });

    const valuePackageId =
      existing?.id ??
      (
        await prisma.valuePackage.create({
          data: {
            tenantId,
            name: pkg.name,
            price: pkg.price,
            credit: pkg.credit,
            description: pkg.description,
          },
          select: { id: true },
        })
      ).id;

    if (existing) {
      await prisma.valuePackage.update({
        where: { id: valuePackageId },
        data: { price: pkg.price, credit: pkg.credit, description: pkg.description },
      });
    }

    await prisma.valuePackageService.createMany({
      data: serviceIds.map((serviceId) => ({ tenantId, valuePackageId, serviceId })),
      skipDuplicates: true,
    });
  }

  console.log(`  ✔ ${DEMO_VALUE_PACKAGES.length} value package(s)`);
}

/**
 * Gift cards carry no catalog prices beyond what the dataset records, and
 * `seedData.ts` gives each one a population so the `Balance` screen can show
 * more than the face value — the same way the welcome email does.
 */
async function seedGiftCards(tenantId: string): Promise<void> {
  for (const card of DEMO_GIFT_CARDS) {
    const existing = await prisma.giftCard.findFirst({
      where: { tenantId, name: card.name },
      select: { id: true },
    });

    if (existing) {
      await prisma.giftCard.update({
        where: { id: existing.id },
        data: { value: card.value, expiresAt: null, remark: card.remark ?? null },
      });
    } else {
      await prisma.giftCard.create({
        data: {
          tenantId,
          name: card.name,
          value: card.value,
          expiresAt: null,
          remark: card.remark ?? null,
        },
      });
    }
  }

  console.log(`  ✔ ${DEMO_GIFT_CARDS.length} gift card(s)`);
}

/**
 * The customer book — a seed-only lookup table the bookings and sales join on.
 *
 * Every row is keyed per tenant by email (`@@unique([tenantId, email])`); a
 * customer without one is simply not in the demo. The `memberId` column is
 * carried through so a sale's member-pricing rule (`customer?.memberId != null`)
 * is exercised exactly as the live flow produces it.
 */
async function seedCustomers(tenantId: string): Promise<void> {
  for (const customer of DEMO_CUSTOMERS) {
    const email = customer.email.trim().toLowerCase();
    await prisma.customer.upsert({
      where: { tenantId_email: { tenantId, email } },
      update: {
        name: customer.name,
        phone: customer.phone,
        gender: customer.gender,
        code: customer.code,
      },
      create: {
        tenantId,
        name: customer.name,
        email,
        phone: customer.phone,
        gender: customer.gender,
        code: customer.code,
        memberId: customer.memberId ?? null,
      },
    });
  }

  console.log(`  ✔ ${DEMO_CUSTOMERS.length} customer(s)`);
}

/**
 * Resolves each demo booking against the rows seeded above and upserts it by its
 * fixed id, rolling every date forward to the current run.
 *
 * Duration comes from the **service row**, not from the dataset: the booking's
 * length is the catalogue's fact, and a dataset that disagreed with the service
 * would place blocks the grid draws at the wrong height. `finishedAt` is stamped
 * for completed history so a re-seed replays "done when it ended" rather than
 * "done at the moment of seeding".
 *
 * `prisma.appointment.upsert` is not covered by the tenant-scope extension
 * (only single-row CRUD is hooked), so `tenantId` is passed explicitly in the
 * create — the same shape `seedCustomers` already uses.
 */
async function seedAppointments(tenantId: string, now: Date): Promise<void> {
  const services = await prisma.service.findMany({
    where: { tenantId },
    select: { id: true, name: true, durationMinutes: true },
  });
  const serviceByName = new Map(services.map((row) => [row.name, row]));

  const emails = [
    ...new Set(DEMO_APPOINTMENTS.flatMap((row) => [row.staffEmail, row.customerEmail])),
  ];
  const [users, customers] = await Promise.all([
    prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } }),
    prisma.customer.findMany({
      where: { email: { in: emails } },
      select: { id: true, email: true },
    }),
  ]);
  const userByEmail = new Map(users.map((row) => [row.email, row.id]));
  const customerByEmail = new Map(customers.map((row) => [row.email, row.id]));

  // The clash rule runs over exactly the windows the upsert is about to store,
  // so a dataset edit that would double-book a stylist fails here rather than
  // rendering two blocks on top of each other on the grid.
  const windows: ClashWindow[] = DEMO_APPOINTMENTS.map((appointment) => {
    const service = serviceByName.get(appointment.service);
    if (!service) {
      throw new Error(`Demo appointment ${appointment.id}: no service "${appointment.service}".`);
    }
    if (!userByEmail.has(appointment.staffEmail)) {
      throw new Error(`Demo appointment ${appointment.id}: no staff ${appointment.staffEmail}.`);
    }
    if (!customerByEmail.has(appointment.customerEmail)) {
      throw new Error(
        `Demo appointment ${appointment.id}: no customer ${appointment.customerEmail}.`,
      );
    }
    const duration = service.durationMinutes ?? FALLBACK_DURATION_MINUTES;
    return {
      id: appointment.id,
      staffEmail: appointment.staffEmail,
      status: appointment.status,
      startsAt: appointmentWindow(appointment, duration, now).startsAt,
      endsAt: appointmentWindow(appointment, duration, now).endsAt,
    };
  });
  assertNoAppointmentClash(windows);

  for (const appointment of DEMO_APPOINTMENTS) {
    const service = serviceByName.get(appointment.service);
    const staffId = userByEmail.get(appointment.staffEmail);
    const customerId = customerByEmail.get(appointment.customerEmail);
    // The checks above already refused a miss; these three guards are for
    // TypeScript, which cannot know that.
    if (!service || !staffId || !customerId) continue;

    const duration = service.durationMinutes ?? FALLBACK_DURATION_MINUTES;
    const { startsAt, endsAt } = appointmentWindow(appointment, duration, now);

    // Every booking is one service line (TK2610-0020 phase B). Writing it here
    // keeps demo data the same shape the API writes, so the drawer opens a
    // seeded booking with the chain it expects rather than falling back to the
    // flat columns. The update replaces the chain, so a re-seed cannot stack a
    // second copy of the same line.
    const line = {
      tenantId,
      serviceId: service.id,
      staffId,
      position: 0,
      startsAt,
      endsAt,
      durationMinutes: duration,
    };

    await prisma.appointment.upsert({
      where: { id: appointment.id },
      create: {
        id: appointment.id,
        tenantId,
        customerId,
        staffId,
        serviceId: service.id,
        startsAt,
        endsAt,
        status: appointment.status,
        durationMinutes: duration,
        comment: appointment.comment ?? null,
        ...(appointment.status === "COMPLETED" ? { finishedAt: endsAt } : {}),
        lines: { create: [line] },
      },
      update: {
        customerId,
        staffId,
        serviceId: service.id,
        startsAt,
        endsAt,
        status: appointment.status,
        durationMinutes: duration,
        comment: appointment.comment ?? null,
        finishedAt: appointment.status === "COMPLETED" ? endsAt : null,
        lines: { deleteMany: {}, create: [line] },
      },
    });
  }

  console.log(`  ✔ ${DEMO_APPOINTMENTS.length} appointment(s)`);
}

/**
 * Rings the demo sales through the real `createSale`, keyed by Q16's idempotency
 * key, then moves each `soldAt` back to the moment the dataset describes.
 *
 * The tenders are assembled from the dataset's own prices (`demoSaleTotalCents`)
 * so the remainder tender has a total to take a remainder of — and a fresh
 * ring-up's reply is then checked against that arithmetic, so the pricing rule
 * and the dataset cannot drift apart in silence. The write itself is untouched:
 * prices, the five ledgers, holdings, points and the receipt number are the
 * service's work, which is the whole reason to seed sales this way rather than
 * inserting rows. A re-seed finds each sale by its key and only moves the date,
 * so the receipt numbers stay the ones the first run printed.
 */
async function seedSales(tenantId: string, now: Date): Promise<void> {
  const staffEmails = [
    ...new Set([
      ...DEMO_SALES.map((sale) => sale.rangUpByEmail),
      ...DEMO_SALES.flatMap((sale) =>
        sale.lines.flatMap((line) => (line.staffEmail ? [line.staffEmail] : [])),
      ),
    ]),
  ];
  const customerEmails = [
    ...new Set(DEMO_SALES.flatMap((sale) => (sale.customerEmail ? [sale.customerEmail] : []))),
  ];

  const [users, customers, services, products, packs, cards] = await Promise.all([
    prisma.user.findMany({
      where: { email: { in: staffEmails } },
      select: { id: true, email: true },
    }),
    prisma.customer.findMany({
      where: { email: { in: customerEmails } },
      select: { id: true, email: true, memberId: true },
    }),
    prisma.service.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    prisma.product.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    prisma.package.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    prisma.giftCard.findMany({ where: { tenantId }, select: { id: true, name: true } }),
  ]);

  const userByEmail = new Map(users.map((row) => [row.email, row.id]));
  const customerByEmail = new Map(customers.map((row) => [row.email, row]));
  // One lookup across the four catalogues a demo line can name, keyed by kind
  // and name — the same two facts the line carries.
  const itemId = new Map<string, string>([
    ...services.map((row) => [`SERVICE:${row.name}`, row.id] as const),
    ...products.map((row) => [`PRODUCT:${row.name}`, row.id] as const),
    ...packs.map((row) => [`PACKAGE:${row.name}`, row.id] as const),
    ...cards.map((row) => [`GIFT_CARD:${row.name}`, row.id] as const),
  ]);

  let replayed = 0;

  for (const sale of DEMO_SALES) {
    const rangUpBy = userByEmail.get(sale.rangUpByEmail);
    if (!rangUpBy) {
      throw new Error(`Demo sale ${sale.key}: no staff ${sale.rangUpByEmail}.`);
    }

    const customer = sale.customerEmail ? customerByEmail.get(sale.customerEmail) : undefined;
    if (sale.customerEmail && !customer) {
      throw new Error(`Demo sale ${sale.key}: no customer ${sale.customerEmail}.`);
    }

    const lines = sale.lines.map((line) => {
      const item = itemId.get(`${line.kind}:${line.name}`);
      if (!item) {
        throw new Error(`Demo sale ${sale.key}: no ${line.kind} "${line.name}".`);
      }
      const staffId = line.staffEmail ? userByEmail.get(line.staffEmail) : undefined;
      if (line.staffEmail && !staffId) {
        throw new Error(`Demo sale ${sale.key}: no staff ${line.staffEmail}.`);
      }
      return {
        itemType: line.kind,
        itemId: item,
        quantity: line.quantity,
        ...(staffId ? { staffId } : {}),
      };
    });

    // What the dataset says the cart costs, under the member rule the write
    // applies too. A member line here must price to the member column there, or
    // the assertion below fails and the dataset is red.
    // The same membership test the write applies (`customer?.memberId !=
    // null` in `createSale`): presence of the reference is the whole rule.
    const member = customer?.memberId != null;
    const expectedTotal = demoSaleTotalCents(sale, member);
    const amounts = tenderAmountsCents(expectedTotal, sale.tenders);

    const existing = await prisma.sale.findFirst({
      where: { idempotencyKey: sale.key },
      select: { id: true, soldAt: true },
    });

    const receipt = await createSale({
      ...(customer ? { customerId: customer.id } : {}),
      staffId: rangUpBy,
      ...(sale.note ? { note: sale.note } : {}),
      lines,
      payments: sale.tenders.map((tender, index) => ({
        method: tender.method,
        amount: Number(centsToMoney(amounts[index] ?? 0)),
      })),
      idempotencyKey: sale.key,
    });

    if (existing) {
      replayed += 1;
    } else {
      // Fresh ring-up: the server's picture of the cart must agree with the
      // dataset's arithmetic, so a slipped-up price rule fails the seed rather
      // than repricing the demo records we never meant to rewrite.
      const paid = amounts.reduce((sum, amount) => sum + amount, 0);
      if (toCents(receipt.totalAmount) !== expectedTotal || toCents(receipt.paidAmount) !== paid) {
        throw new Error(
          `Demo sale ${sale.key}: the server priced the cart ${receipt.totalAmount} ` +
            `(paid ${receipt.paidAmount}) but the dataset says ${centsToMoney(expectedTotal)} ` +
            `(paid ${centsToMoney(paid)}).`,
        );
      }
    }

    // `writeSale` stamps `soldAt` with the moment of the write; the demo's
    // history is dated, so the date is moved back afterwards. And since the
    // demonstration is that the figures roll with the years, the roll is
    // itself idempotent — a re-seed moves it forward again, to the same place.
    await prisma.sale.update({
      where: { id: receipt.id, tenantId },
      data: { soldAt: saleMoment(sale, now) },
    });
  }

  console.log(
    `  ✔ ${DEMO_SALES.length} sale(s) ring through createSale ${replayed === 0 ? "freshly" : "again"} ` +
      `(${replayed} replayed on re-seed)`,
  );
}

/**
 * Puts each product's stock back to the dataset's figure, after the demo sales
 * have decremented it.
 *
 * `SeedProduct.quantity` is documented as "stock on hand **after** a fresh seed"
 * — the shelf the screens should show — so the reconcile is what makes that
 * sentence true once real decrements have run against it.
 */
async function reconcileProductStock(tenantId: string): Promise<void> {
  for (const product of DEMO_PRODUCTS) {
    const row = await prisma.product.findFirst({
      where: { tenantId, name: product.name },
      select: { id: true },
    });
    if (!row) continue;
    await prisma.product.update({ where: { id: row.id }, data: { quantity: product.quantity } });
  }

  console.log(`  ✔ stock reconciled to the dataset for ${DEMO_PRODUCTS.length} product(s)`);
}

/*
 * The demo catalogue, the customer book, the book and the till — development
 * only. Every function below is **idempotent**: a department is found by its
 * natural key (`@@unique([tenantId, name])`), a service, product, package, gift
 * card or value package by `(tenantId, name)` — none of those models has a unique
 * constraint on the name, so the seed looks one up rather than upserting — and a
 * customer by its per-tenant email (`@@unique([tenantId, email])`, ADR 0003).
 * Appointments are upserted by the fixed ids `seed-data.ts` gives them and sales
 * by Q16's idempotency key. `npm run db:seed` on an existing demo database
 * therefore refreshes the demo rather than duplicating it.
 */

async function main(): Promise<void> {
  if (SEED_MODE === "production" && !process.env.ADMIN_PASSWORD) {
    console.warn(
      "  ! ADMIN_PASSWORD was not set — the default development password was used. Change it immediately.",
    );
  }

  const tenantId = await seedTenant();

  // Platform data first, unscoped (see TENANCY.md §7): the module catalogue
  // belongs to no tenant, and the till checks entitlements through
  // `moduleEntitlements` — which reads `isCore` off these rows — before it
  // rings anything up.
  await runAsPlatform(seedModules);

  await runAsTenant(tenantId, async () => {
    // The crew is `DEMO_STAFF` in development (the administrator, the manager,
    // the front desk and the three performers) and the single administrator in
    // production. One list, written once: the update branch deliberately does
    // **not** touch `passwordHash`, so re-seeding refreshes
    // the crew without resetting credentials a developer changed since.
    //
    // `User` is tenant-scoped, so these queries run inside `runAsTenant` —
    // the extension throws outside a scope rather than writing unscoped.
    const crew: SeedUser[] =
      SEED_MODE === "production"
        ? [resolveAdmin()]
        : DEMO_STAFF.map((row) => ({
            email: row.email,
            name: row.name,
            password: row.password,
            globalRole: row.globalRole,
          }));

    console.log(`Seeding ${crew.length} user(s) in ${SEED_MODE} mode…`);

    for (const member of crew) {
      const existing = await prisma.user.findUnique({
        where: { email: member.email },
        select: { id: true },
      });

      if (existing) {
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            name: member.name,
            globalRole: member.globalRole,
            tenantId,
            disabled: false,
            disabledAt: null,
          },
        });
      } else {
        await prisma.user.create({
          data: {
            email: member.email,
            name: member.name,
            passwordHash: await bcrypt.hash(member.password, BCRYPT_ROUNDS),
            globalRole: member.globalRole,
            tenantId,
          },
        });
        console.log(`  ✔ ${member.globalRole.padEnd(11)} ${member.email}`);
      }
    }

    const owner = await prisma.user.findUnique({
      where: { email: crew[0]?.email ?? resolveAdmin().email },
      select: { id: true },
    });
    if (!owner) throw new Error("Seed failed: the owner account was not created.");

    // Claim ownership now that the owner exists. The administrator owns the tenant.
    await prisma.tenant.update({ where: { id: tenantId }, data: { ownerUserId: owner.id } });

    if (SEED_MODE === "development") {
      await seedEntitlements(tenantId);
      const departments = await seedDepartments(tenantId);
      await seedStaffDepartments(tenantId);
      await seedShifts(tenantId);
      const services = await seedServices(tenantId, departments);
      await seedProducts(tenantId, departments);
      await seedPackages(tenantId, services);
      await seedValuePackages(tenantId, services);
      await seedGiftCards(tenantId);
      await seedCustomers(tenantId);

      // The book and the till: both are dated relative to the same instant, so
      // "today" means the same thing on the calendar, the dashboard and the
      // sales reports.
      const now = new Date();
      await seedAppointments(tenantId, now);
      await seedSales(tenantId, now);
      await reconcileProductStock(tenantId);
    }
  });

  console.log("Seed complete.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
