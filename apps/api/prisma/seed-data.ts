/**
 * The development demo dataset — pure data, no I/O.
 *
 * `seed.ts` owns every database call; this file owns only what the demo salon
 * contains. Keeping the two apart means the dataset can be read (and edited)
 * without stepping through seed mechanics, and every money value is a **string**
 * exactly as the contracts send it (`Decimal(12,2)` on the wire).
 *
 * Everything here is development-only: `SEED_MODE=production` never reads a
 * constant from this file, so a production seed cannot grow demo rows by
 * accident. Re-running the seed is idempotent — catalogue rows are found by
 * their natural key (name, email), appointments by their fixed ids, and sales
 * by their idempotency keys — so `npm run db:seed` on an existing database
 * refreshes the demo rather than duplicating it.
 */

/**
 * The demo salon's branches. `Department.name` is unique per tenant
 * (`@@unique([tenantId, name])`), so this list is the natural key the seed
 * upserts on — and the same three names the services and
 * `STAFF_DEPARTMENTS` below refer to, kept in one place so a rename here is
 * a compile-time change rather than three lists that quietly disagree.
 */
export const DEMO_DEPARTMENTS: readonly string[] = ["Hair", "Nails", "Beauty"];

/**
 * Which departments each seeded user belongs to, keyed by email.
 *
 * The M1/M2 rule: the till's per-line staff picker and the booking flow both
 * offer the staff whose `User.departments` intersect the service's department.
 * The owner and the front desk deliberately belong to none — they do not
 * perform services, so they must not appear as performers.
 */
export const STAFF_DEPARTMENTS: Record<string, readonly string[]> = {
  "admin@gmail.com": ["Hair", "Nails", "Beauty"],
  "stylist@glampro.test": ["Hair"],
  "nailtech@glampro.test": ["Nails"],
  "therapist@glampro.test": ["Beauty"],
};

export interface SeedStaffUser {
  email: string;
  /** Display name as it appears on the staff list, the sale ticket and the tile. */
  name: string;
  globalRole: "SUPER_ADMIN" | "MANAGER" | "STAFF" | "CASHIER";
  /**
   * The demo sign-in password, used **only when the row is first created**.
   *
   * A staff member *is* a `User` row, and `users.passwordHash` is required —
   * there is no such thing as a login-less account. The four crew members who
   * also appear in `seed.ts`'s `DEMO_USERS` are overwritten by that loop's own
   * password moments later, so these values only ever decide what the two
   * performers (nail tech, therapist) sign in with on a fresh `db:reset`.
   * Re-seeding never resets an existing account's password.
   */
  password: string;
}

/** The demo salon's staffing roster. `User` rows are created inside the demo
 * tenant by `seed.ts`'s `upsertUser`, so every one of these maps straight onto a
 * `users` row with the same email, and `StaffDepartment` links pick the branches
 * from `STAFF_DEPARTMENTS`.
 *
 * Seeding staff rows is what makes the dashboard's team tiles, the staff list
 * and the sale's per-line picker draw real people instead of `[]`. A fresh
 * `db:reset` (or a `db:seed` on an existing demo DB) replaces the whole crew
 * idempotently.
 */

export const DEMO_PLATFORM_ADMIN = {
  email: "superadmin@gmail.com",
  name: "Glampro Platform Administrator",
  password: "superadmin12345",
} as const;

export const DEMO_STAFF: SeedStaffUser[] = [
  {
    email: "admin@gmail.com",
    name: "Glampro Demo Administrator",
    globalRole: "SUPER_ADMIN",
    password: "admin12345",
  },
  {
    email: "stylist@glampro.test",
    name: "Rita Stylist",
    globalRole: "STAFF",
    password: "Staff123!",
  },
  {
    email: "cashier@glampro.test",
    name: "Nora Cashier",
    globalRole: "CASHIER",
    password: "Cashier123!",
  },
  {
    email: "nailtech@glampro.test",
    name: "Dina Nailtech",
    globalRole: "STAFF",
    password: "Staff123!",
  },
  {
    email: "therapist@glampro.test",
    name: "Toby Therapist",
    globalRole: "STAFF",
    password: "Staff123!",
  },
];

/**
 * One performer's weekly template — the compact form the seed expands.
 *
 * A rota is **weekly and wall-clock**: "Rita works 08:00–17:00 every day, with
 * lunch at noon" is true every week the salon is open, which is exactly what a
 * `dayOfWeek` + minutes row stores. `days` uses the same numbering the column
 * stores (0 = Sunday), so expansion is arithmetic rather than a translation.
 */
export interface SeedShiftTemplate {
  staffEmail: string;
  /** Days of week the template applies to, 0 = Sunday (same as `StaffShift.dayOfWeek`). */
  days: readonly number[];
  work: { startsAtMinute: number; endsAtMinute: number };
  breaks: readonly { startsAtMinute: number; endsAtMinute: number }[];
}

/** One expanded rota row — maps straight onto a `StaffShift` insert. */
export interface SeedShiftRow {
  /** Fixed id, so re-seeding upserts instead of duplicating (same rule as bookings). */
  id: string;
  staffEmail: string;
  dayOfWeek: number;
  kind: "WORK" | "BREAK";
  startsAtMinute: number;
  endsAtMinute: number;
  note: string | null;
}

/**
 * The demo salon's rota.
 *
 * Every performer is on every day of the week on purpose: `dayOffset` in
 * `DEMO_APPOINTMENTS` is relative to whenever the seed runs, so a roster with a
 * day off would put some seeded booking outside its performer's shift — a
 * contradiction the availability gate (Phase 6e-iii) would refuse to re-check
 * into a PATCH. Wide hours are a **deliberate demo choice**, not the model's
 * limit: the rota editor exists precisely to narrow them.
 *
 * Breaks are placed away from the seeded appointment times of that performer
 * (stylist 09:30/10:00/13:00, nail tech 14:00/15:00, therapist 11:00/11:30/16:30)
 * so that when the gate lands, every demo booking still fits inside a work
 * interval and outside its break.
 */
const DEMO_SHIFT_TEMPLATES: readonly SeedShiftTemplate[] = [
  {
    staffEmail: "stylist@glampro.test",
    days: [0, 1, 2, 3, 4, 5, 6],
    work: { startsAtMinute: 8 * 60, endsAtMinute: 17 * 60 },
    breaks: [{ startsAtMinute: 12 * 60, endsAtMinute: 12 * 60 + 45 }],
  },
  {
    staffEmail: "nailtech@glampro.test",
    days: [0, 1, 2, 3, 4, 5, 6],
    work: { startsAtMinute: 10 * 60, endsAtMinute: 19 * 60 },
    breaks: [{ startsAtMinute: 12 * 60 + 30, endsAtMinute: 13 * 60 + 30 }],
  },
  {
    staffEmail: "therapist@glampro.test",
    days: [0, 1, 2, 3, 4, 5, 6],
    work: { startsAtMinute: 11 * 60, endsAtMinute: 20 * 60 },
    breaks: [{ startsAtMinute: 15 * 60 + 30, endsAtMinute: 16 * 60 + 15 }],
  },
];

function expandDemoShifts(): SeedShiftRow[] {
  const rows: SeedShiftRow[] = [];
  for (const template of DEMO_SHIFT_TEMPLATES) {
    const who = template.staffEmail.split("@")[0] ?? template.staffEmail;
    for (const dayOfWeek of template.days) {
      rows.push({
        id: `seed-shift-${who}-${dayOfWeek}-work`,
        staffEmail: template.staffEmail,
        dayOfWeek,
        kind: "WORK",
        startsAtMinute: template.work.startsAtMinute,
        endsAtMinute: template.work.endsAtMinute,
        note: "Standing hours",
      });
      for (const [index, breaks] of template.breaks.entries()) {
        rows.push({
          id: `seed-shift-${who}-${dayOfWeek}-break${index > 0 ? index : ""}`,
          staffEmail: template.staffEmail,
          dayOfWeek,
          kind: "BREAK",
          startsAtMinute: breaks.startsAtMinute,
          endsAtMinute: breaks.endsAtMinute,
          note: index === 0 ? "Lunch" : null,
        });
      }
    }
  }
  return rows;
}

/** The rota, expanded to one row per (performer, weekday, interval). */
export const DEMO_SHIFTS: readonly SeedShiftRow[] = expandDemoShifts();

/** One bookable service. `department` is a name — resolved to an id by the seed. */
export interface SeedService {
  name: string;
  /** Department name — resolved to an id by the seed. */
  department: string;
  durationMinutes: number;
  nonmemberPrice: string;
  memberPrice: string;
  /** Loyalty points per unit. Services earn; this is what `Service.points` means. */
  points: number;
  description: string;
}

export const DEMO_SERVICES: readonly SeedService[] = [
  {
    name: "Women's Haircut",
    department: "Hair",
    durationMinutes: 45,
    nonmemberPrice: "60.00",
    memberPrice: "54.00",
    points: 6,
    description: "Consult, cut, wash and blow-dry finish.",
  },
  {
    name: "Men's Haircut",
    department: "Hair",
    durationMinutes: 30,
    nonmemberPrice: "40.00",
    memberPrice: "36.00",
    points: 4,
    description: "Clipper or scissor cut with a hot-towel finish.",
  },
  {
    name: "Blow Dry",
    department: "Hair",
    durationMinutes: 30,
    nonmemberPrice: "45.00",
    memberPrice: "40.50",
    points: 4,
    description: "Wash and blow-dry styling.",
  },
  {
    name: "Colour & Highlights",
    department: "Hair",
    durationMinutes: 120,
    nonmemberPrice: "150.00",
    memberPrice: "135.00",
    points: 15,
    description: "Full colour with foils and toner.",
  },
  {
    name: "Keratin Treatment",
    department: "Hair",
    durationMinutes: 150,
    nonmemberPrice: "220.00",
    memberPrice: "198.00",
    points: 22,
    description: "Smoothing treatment for frizz control.",
  },
  {
    name: "Classic Manicure",
    department: "Nails",
    durationMinutes: 45,
    nonmemberPrice: "40.00",
    memberPrice: "36.00",
    points: 4,
    description: "File, cuticle care and polish.",
  },
  {
    name: "Gel Manicure",
    department: "Nails",
    durationMinutes: 60,
    nonmemberPrice: "60.00",
    memberPrice: "54.00",
    points: 6,
    description: "Gel polish manicure with UV cure.",
  },
  {
    name: "Classic Pedicure",
    department: "Nails",
    durationMinutes: 60,
    nonmemberPrice: "55.00",
    memberPrice: "50.00",
    points: 5,
    description: "Soak, scrub, file and polish.",
  },
  {
    name: "Acrylic Full Set",
    department: "Nails",
    durationMinutes: 90,
    nonmemberPrice: "90.00",
    memberPrice: "81.00",
    points: 9,
    description: "Acrylic extensions, full set.",
  },
  {
    name: "Signature Facial",
    department: "Beauty",
    durationMinutes: 60,
    nonmemberPrice: "80.00",
    memberPrice: "72.00",
    points: 8,
    description: "Deep-cleanse facial with massage.",
  },
  {
    name: "Full Body Massage",
    department: "Beauty",
    durationMinutes: 75,
    nonmemberPrice: "110.00",
    memberPrice: "99.00",
    points: 11,
    description: "Aromatherapy full-body massage.",
  },
  {
    name: "Eyebrow Threading",
    department: "Beauty",
    durationMinutes: 20,
    nonmemberPrice: "25.00",
    memberPrice: "23.00",
    points: 2,
    description: "Shaping by threading.",
  },
];

export interface SeedProduct {
  name: string;
  department: string;
  nonmemberPrice: string;
  memberPrice: string;
  /** Stock on hand after a fresh seed — the seed reconciles this after its sales. */
  quantity: number;
  points: number;
  description: string;
}

export const DEMO_PRODUCTS: readonly SeedProduct[] = [
  {
    name: "Repair Shampoo 300ml",
    department: "Hair",
    nonmemberPrice: "24.00",
    memberPrice: "22.00",
    quantity: 40,
    points: 2,
    description: "Daily shampoo for damaged hair.",
  },
  {
    name: "Repair Conditioner 300ml",
    department: "Hair",
    nonmemberPrice: "24.00",
    memberPrice: "22.00",
    quantity: 4,
    points: 2,
    description: "Conditioner to pair with the repair shampoo.",
  },
  {
    name: "Hair Mask 250ml",
    department: "Hair",
    nonmemberPrice: "32.00",
    memberPrice: "29.00",
    quantity: 22,
    points: 3,
    description: "Weekly deep-conditioning mask.",
  },
  {
    name: "Heat Protect Spray",
    department: "Hair",
    nonmemberPrice: "18.00",
    memberPrice: "16.00",
    quantity: 0,
    points: 2,
    description: "Spray-in protection before styling.",
  },
  {
    name: "Styling Wax 100ml",
    department: "Hair",
    nonmemberPrice: "26.00",
    memberPrice: "24.00",
    quantity: 16,
    points: 2,
    description: "Matte-finish modelling wax.",
  },
  {
    name: "Cuticle Oil 15ml",
    department: "Nails",
    nonmemberPrice: "12.00",
    memberPrice: "11.00",
    quantity: 30,
    points: 1,
    description: "Nourishing cuticle oil.",
  },
  {
    name: "Nail File Set (10 pcs)",
    department: "Nails",
    nonmemberPrice: "8.00",
    memberPrice: "7.00",
    quantity: 3,
    points: 1,
    description: "Disposable file set.",
  },
  {
    name: "Acrylic Powder 100g",
    department: "Nails",
    nonmemberPrice: "22.00",
    memberPrice: "20.00",
    quantity: 14,
    points: 2,
    description: "Builder powder for acrylic sets.",
  },
  {
    name: "Facial Cleanser 200ml",
    department: "Beauty",
    nonmemberPrice: "28.00",
    memberPrice: "25.00",
    quantity: 18,
    points: 2,
    description: "Gentle daily cleanser.",
  },
  {
    name: "Massage Oil 200ml",
    department: "Beauty",
    nonmemberPrice: "20.00",
    memberPrice: "18.00",
    quantity: 6,
    points: 2,
    description: "Neutral carrier oil for treatments.",
  },
  {
    name: "Sunscreen SPF50",
    department: "Beauty",
    nonmemberPrice: "30.00",
    memberPrice: "27.00",
    quantity: 0,
    points: 2,
    description: "Aftercare sunscreen.",
  },
  {
    name: "Herbal Tea Bags (20 pcs)",
    department: "Beauty",
    nonmemberPrice: "10.00",
    memberPrice: "9.00",
    quantity: 2,
    points: 1,
    description: "Served with treatments.",
  },
];

export interface SeedPackage {
  name: string;
  sessionCount: number;
  nonmemberPrice: string;
  memberPrice: string;
  /** Service names the package covers — resolved to ids by the seed. */
  services: readonly string[];
  description: string;
}

export const DEMO_PACKAGES: readonly SeedPackage[] = [
  {
    name: "Hair Care Package",
    sessionCount: 10,
    nonmemberPrice: "480.00",
    memberPrice: "430.00",
    services: ["Women's Haircut", "Men's Haircut", "Blow Dry"],
    description: "Ten cuts and styling sessions across the hair team.",
  },
  {
    name: "Nail Care Package",
    sessionCount: 8,
    nonmemberPrice: "320.00",
    memberPrice: "290.00",
    services: ["Classic Manicure", "Classic Pedicure"],
    description: "Eight classic mani-pedi sessions.",
  },
];

export interface SeedValuePackage {
  name: string;
  /** What the customer pays. */
  price: string;
  /** What they receive to spend — the difference is the discount. */
  credit: string;
  services: readonly string[];
  description: string;
}

export const DEMO_VALUE_PACKAGES: readonly SeedValuePackage[] = [
  {
    name: "Salon Credit Top-Up",
    price: "135.00",
    credit: "150.00",
    services: ["Signature Facial", "Full Body Massage", "Eyebrow Threading"],
    description: "Pay 135.00, receive 150.00 to spend on beauty services.",
  },
];

export interface SeedGiftCard {
  name: string;
  /** Face value — also the price the till charges (one money column). */
  value: string;
  remark: string;
}

export const DEMO_GIFT_CARDS: readonly SeedGiftCard[] = [
  { name: "Gift Card $50", value: "50.00", remark: "Any service or product." },
  { name: "Gift Card $100", value: "100.00", remark: "Any service or product." },
];

export interface SeedCustomer {
  name: string;
  email: string;
  phone: string;
  /** Membership reference — free text, exactly as legacy modeled it (no tier table). */
  memberId?: string;
  gender: "MALE" | "FEMALE" | "OTHER" | "UNDISCLOSED";
  code: string;
  /** `createdAt` is backdated so the reports window has a spread of new customers. */
  createdDaysAgo: number;
}

export const DEMO_CUSTOMERS: readonly SeedCustomer[] = [
  {
    name: "Amelia Tan",
    email: "amelia.tan@example.test",
    phone: "+65 9123 4567",
    memberId: "GOLD-001",
    gender: "FEMALE",
    code: "C-001",
    createdDaysAgo: 12,
  },
  {
    name: "Priya Menon",
    email: "priya.menon@example.test",
    phone: "+65 9234 5678",
    memberId: "GOLD-002",
    gender: "FEMALE",
    code: "C-002",
    createdDaysAgo: 9,
  },
  {
    name: "Jordan Lee",
    email: "jordan.lee@example.test",
    phone: "+65 9345 6789",
    gender: "MALE",
    code: "C-003",
    createdDaysAgo: 7,
  },
  {
    name: "Mei Chen",
    email: "mei.chen@example.test",
    phone: "+65 9456 7890",
    memberId: "SILVER-003",
    gender: "FEMALE",
    code: "C-004",
    createdDaysAgo: 5,
  },
  {
    name: "Hannah Kim",
    email: "hannah.kim@example.test",
    phone: "+65 9567 8901",
    gender: "FEMALE",
    code: "C-005",
    createdDaysAgo: 4,
  },
  {
    name: "Lucas Meyer",
    email: "lucas.meyer@example.test",
    phone: "+65 9678 9012",
    gender: "MALE",
    code: "C-006",
    createdDaysAgo: 3,
  },
  {
    name: "Aisha Rahman",
    email: "aisha.rahman@example.test",
    phone: "+65 9789 0123",
    memberId: "GOLD-004",
    gender: "FEMALE",
    code: "C-007",
    createdDaysAgo: 2,
  },
  {
    name: "Tom Baker",
    email: "tom.baker@example.test",
    phone: "+65 9890 1234",
    gender: "MALE",
    code: "C-008",
    createdDaysAgo: 1,
  },
  {
    name: "Grace Wu",
    email: "grace.wu@example.test",
    phone: "+65 9901 2345",
    gender: "FEMALE",
    code: "C-009",
    createdDaysAgo: 0,
  },
  {
    name: "Diego Alvarez",
    email: "diego.alvarez@example.test",
    phone: "+65 9012 3456",
    gender: "MALE",
    code: "C-010",
    createdDaysAgo: 0,
  },
];

export type SeedAppointmentStatus =
  "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

export interface SeedAppointment {
  /** Fixed id, so re-seeding upserts instead of duplicating and dates roll forward. */
  id: string;
  service: string;
  staffEmail: string;
  customerEmail: string;
  status: SeedAppointmentStatus;
  /** Days from today: −1 is yesterday, 1 is tomorrow. Combined with `time`. */
  dayOffset: number;
  /** Local wall-clock time, `HH:MM`. Ignored when `offsetHours` is set. */
  time?: string;
  /**
   * Offset from the moment of seeding, in hours. Today's rows use this so they
   * read correctly whenever the seed runs — an appointment completed four hours
   * ago is completed at 08:00 and at 20:00 alike.
   */
  offsetHours?: number;
  comment?: string;
}

export const DEMO_APPOINTMENTS: readonly SeedAppointment[] = [
  // Yesterday — the completed / missed / cancelled history a day view shows.
  {
    id: "seed-appt-01",
    service: "Women's Haircut",
    staffEmail: "stylist@glampro.test",
    customerEmail: "amelia.tan@example.test",
    status: "COMPLETED",
    dayOffset: -1,
    time: "09:30",
  },
  {
    id: "seed-appt-02",
    service: "Signature Facial",
    staffEmail: "therapist@glampro.test",
    customerEmail: "grace.wu@example.test",
    status: "COMPLETED",
    dayOffset: -1,
    time: "11:00",
  },
  {
    id: "seed-appt-03",
    service: "Gel Manicure",
    staffEmail: "nailtech@glampro.test",
    customerEmail: "mei.chen@example.test",
    status: "NO_SHOW",
    dayOffset: -1,
    time: "14:00",
  },
  {
    id: "seed-appt-04",
    service: "Eyebrow Threading",
    staffEmail: "therapist@glampro.test",
    customerEmail: "priya.menon@example.test",
    status: "CANCELLED",
    dayOffset: -1,
    time: "16:30",
    comment: "Client cancelled — travelling.",
  },
  // Today — relative offsets, so the statuses stay true whenever the seed runs.
  {
    id: "seed-appt-05",
    service: "Men's Haircut",
    staffEmail: "stylist@glampro.test",
    customerEmail: "jordan.lee@example.test",
    status: "COMPLETED",
    dayOffset: 0,
    offsetHours: -4,
  },
  {
    id: "seed-appt-06",
    service: "Classic Manicure",
    staffEmail: "nailtech@glampro.test",
    customerEmail: "lucas.meyer@example.test",
    status: "COMPLETED",
    dayOffset: 0,
    offsetHours: -1.5,
  },
  {
    id: "seed-appt-07",
    service: "Full Body Massage",
    staffEmail: "therapist@glampro.test",
    customerEmail: "aisha.rahman@example.test",
    status: "IN_PROGRESS",
    dayOffset: 0,
    offsetHours: -0.25,
    comment: "Second visit — prefers medium pressure.",
  },
  {
    id: "seed-appt-08",
    service: "Colour & Highlights",
    staffEmail: "stylist@glampro.test",
    customerEmail: "amelia.tan@example.test",
    status: "SCHEDULED",
    dayOffset: 0,
    offsetHours: 2,
  },
  {
    id: "seed-appt-09",
    service: "Gel Manicure",
    staffEmail: "nailtech@glampro.test",
    customerEmail: "hannah.kim@example.test",
    status: "SCHEDULED",
    dayOffset: 0,
    offsetHours: 4,
  },
  // Tomorrow and beyond — the forward book.
  {
    id: "seed-appt-10",
    service: "Men's Haircut",
    staffEmail: "stylist@glampro.test",
    customerEmail: "diego.alvarez@example.test",
    status: "SCHEDULED",
    dayOffset: 1,
    time: "10:00",
  },
  {
    id: "seed-appt-11",
    service: "Signature Facial",
    staffEmail: "therapist@glampro.test",
    customerEmail: "grace.wu@example.test",
    status: "SCHEDULED",
    dayOffset: 1,
    time: "11:30",
  },
  {
    id: "seed-appt-12",
    service: "Classic Pedicure",
    staffEmail: "nailtech@glampro.test",
    customerEmail: "tom.baker@example.test",
    status: "SCHEDULED",
    dayOffset: 1,
    time: "15:00",
  },
  {
    id: "seed-appt-13",
    service: "Keratin Treatment",
    staffEmail: "stylist@glampro.test",
    customerEmail: "priya.menon@example.test",
    status: "SCHEDULED",
    dayOffset: 2,
    time: "13:00",
    comment: "Patch test done at last visit.",
  },
];

export interface SeedSaleLine {
  kind: "SERVICE" | "PRODUCT" | "PACKAGE" | "GIFT_CARD";
  /** Catalogue name — resolved to an id by the seed. */
  name: string;
  quantity: number;
  /** Who gets performance credit. Product lines take none (the MVP rule). */
  staffEmail?: string;
}

export interface SeedTender {
  method: "CASH" | "CARD" | "BANK_TRANSFER";
  /**
   * Cents taken by this tender. Omitted on the **last** tender, which takes the
   * remainder — so a split is written as `[{ CASH, cents: 5000 }, { CARD }]`.
   */
  cents?: number;
}

export interface SeedSale {
  /** The `idempotencyKey` — replay returns the existing sale instead of a duplicate. */
  key: string;
  dayOffset: number;
  /** Local wall-clock time for past days, `HH:MM`. Ignored when `offsetMinutes` is set. */
  time?: string;
  /** Minutes before the moment of seeding, for today's sales (see `offsetHours`). */
  offsetMinutes?: number;
  /** Absent = walk-in, paid in full. */
  customerEmail?: string;
  /** Who rang the sale up (`Sale.staffId`). */
  rangUpByEmail: string;
  lines: readonly SeedSaleLine[];
  tenders: readonly SeedTender[];
  note?: string;
}

/**
 * Chronological — `createSale` allocates receipt numbers in call order, so the
 * numbers ascend with the dates (receipt 1 is the oldest sale).
 *
 * Every sale is paid **exactly**: a walk-in with a balance is refused by
 * `createSale`, and an overpaid receipt would read as a mistake on screen 02.
 * Sale 7 is the deliberate exception — a part payment, which needs a customer
 * and exercises the outstanding ledger.
 */
export const DEMO_SALES: readonly SeedSale[] = [
  {
    key: "glampro-seed-sale-01",
    dayOffset: -5,
    time: "11:20",
    rangUpByEmail: "cashier@glampro.test",
    lines: [
      { kind: "SERVICE", name: "Women's Haircut", quantity: 1, staffEmail: "stylist@glampro.test" },
      { kind: "PRODUCT", name: "Repair Shampoo 300ml", quantity: 1 },
    ],
    tenders: [{ method: "CASH" }],
  },
  {
    key: "glampro-seed-sale-02",
    dayOffset: -4,
    time: "14:05",
    customerEmail: "amelia.tan@example.test",
    rangUpByEmail: "cashier@glampro.test",
    lines: [
      {
        kind: "SERVICE",
        name: "Colour & Highlights",
        quantity: 1,
        staffEmail: "stylist@glampro.test",
      },
      { kind: "PRODUCT", name: "Hair Mask 250ml", quantity: 1 },
    ],
    tenders: [{ method: "CARD" }],
  },
  {
    key: "glampro-seed-sale-03",
    dayOffset: -3,
    time: "10:45",
    customerEmail: "jordan.lee@example.test",
    rangUpByEmail: "cashier@glampro.test",
    lines: [
      { kind: "SERVICE", name: "Gel Manicure", quantity: 1, staffEmail: "nailtech@glampro.test" },
      {
        kind: "SERVICE",
        name: "Classic Manicure",
        quantity: 1,
        staffEmail: "nailtech@glampro.test",
      },
      { kind: "PRODUCT", name: "Nail File Set (10 pcs)", quantity: 1 },
    ],
    // The split: 50.00 cash, the rest on card — two `SalePayment` rows.
    tenders: [{ method: "CASH", cents: 5000 }, { method: "CARD" }],
  },

  {
    key: "glampro-seed-sale-04",
    dayOffset: -2,
    time: "11:30",
    customerEmail: "hannah.kim@example.test",
    rangUpByEmail: "admin@gmail.com",
    lines: [{ kind: "PACKAGE", name: "Hair Care Package", quantity: 1 }],
    tenders: [{ method: "CARD" }],
  },
  {
    key: "glampro-seed-sale-05",
    dayOffset: -2,
    time: "16:10",
    customerEmail: "mei.chen@example.test",
    rangUpByEmail: "cashier@glampro.test",
    lines: [
      {
        kind: "SERVICE",
        name: "Full Body Massage",
        quantity: 1,
        staffEmail: "therapist@glampro.test",
      },
      {
        kind: "SERVICE",
        name: "Signature Facial",
        quantity: 1,
        staffEmail: "therapist@glampro.test",
      },
    ],
    tenders: [{ method: "CARD" }],
  },
  {
    key: "glampro-seed-sale-06",
    dayOffset: -1,
    time: "12:15",
    rangUpByEmail: "cashier@glampro.test",
    lines: [
      { kind: "SERVICE", name: "Men's Haircut", quantity: 1, staffEmail: "stylist@glampro.test" },
      { kind: "PRODUCT", name: "Herbal Tea Bags (20 pcs)", quantity: 1 },
    ],
    tenders: [{ method: "CASH" }],
  },
  {
    key: "glampro-seed-sale-07",
    dayOffset: -1,
    time: "17:40",
    customerEmail: "diego.alvarez@example.test",
    rangUpByEmail: "cashier@glampro.test",
    lines: [
      { kind: "SERVICE", name: "Men's Haircut", quantity: 1, staffEmail: "stylist@glampro.test" },
    ],
    // 20.00 of a 40.00 sale: UNPAID, which writes the outstanding ledger.
    tenders: [{ method: "CASH", cents: 2000 }],
    note: "Part payment — balance agreed to follow.",
  },
  {
    key: "glampro-seed-sale-08",
    dayOffset: 0,
    offsetMinutes: -45,
    customerEmail: "priya.menon@example.test",
    rangUpByEmail: "admin@gmail.com",
    lines: [
      { kind: "SERVICE", name: "Women's Haircut", quantity: 1, staffEmail: "stylist@glampro.test" },
      {
        kind: "SERVICE",
        name: "Keratin Treatment",
        quantity: 1,
        staffEmail: "stylist@glampro.test",
      },
      { kind: "PRODUCT", name: "Facial Cleanser 200ml", quantity: 1 },
    ],
    tenders: [{ method: "CARD" }],
  },
  {
    key: "glampro-seed-sale-09",
    dayOffset: 0,
    offsetMinutes: -30,
    rangUpByEmail: "cashier@glampro.test",
    lines: [
      {
        kind: "SERVICE",
        name: "Classic Pedicure",
        quantity: 1,
        staffEmail: "nailtech@glampro.test",
      },
      { kind: "PRODUCT", name: "Cuticle Oil 15ml", quantity: 1 },
    ],
    tenders: [{ method: "CASH" }],
  },
  {
    key: "glampro-seed-sale-10",
    dayOffset: 0,
    offsetMinutes: -10,
    customerEmail: "tom.baker@example.test",
    rangUpByEmail: "cashier@glampro.test",
    lines: [{ kind: "GIFT_CARD", name: "Gift Card $50", quantity: 1 }],
    tenders: [{ method: "CASH" }],
  },
];
