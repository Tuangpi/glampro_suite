/**
 * Domain constants shared by the API and the web app.
 *
 * Keep this file free of runtime dependencies so it can be imported from any
 * workspace (Node API, Vite browser bundle, or a future mobile client).
 */

export const APP_NAME = "Glampro Suite";

/** Every API route lives under this prefix (nginx proxies it verbatim). */
export const API_PREFIX = "/api";

/** Mobile clients are served from this prefix and must stay byte-compatible. */
export const MOBILE_API_PREFIX = "/api/mobile";

/**
 * Codes for the switchable features in `Module`. Seeded into the `modules`
 * table; `requireModule(code)` resolves the string at the route boundary, so a
 * typo fails as an unknown module rather than silently passing an unauthenticated
 * entitlement check.
 *
 * The legacy system carried these as 18 boolean columns (`users.*_access` plus
 * seven on `user_infos`); rows in `TenantModule` replace them.
 */
export const MODULE_CODES = [
  "dashboard",
  "appointments",
  "customers",
  "catalogue",
  "staff",
  "packages",
  "giftCards",
  "memberships",
  "inventory",
  "reports",
  "employeeCommission",
  "sales",
  "expenses",
  "stock",
] as const;

export type ModuleCode = (typeof MODULE_CODES)[number];

/**
 * The name a salon sees for a module code — the copy on the Modules panel and in
 * the refusal a missing add-on produces.
 *
 * A code is an internal key (`giftCards`, `employeeCommission`) and a person
 * reading "This feature needs the giftCards add-on" is reading the database, so
 * the two places that name a module to a human — `prisma/seed.ts` writing
 * `Module.name`, and `middleware/requireModule.ts` refusing an unentitled route —
 * take the name from here instead of formatting the code.
 *
 * The names are seeded, not read back, so this map and the `modules` table can
 * only agree if the seed is the one source for both.
 */
export const MODULE_NAMES: Record<ModuleCode, string> = {
  dashboard: "Dashboard",
  appointments: "Appointments",
  customers: "Customers",
  catalogue: "Catalogue",
  staff: "Staff",
  packages: "Packages",
  giftCards: "Gift cards",
  memberships: "Memberships",
  inventory: "Inventory",
  reports: "Reports",
  employeeCommission: "Employee commission",
  sales: "Sales",
  expenses: "Expenses",
  stock: "Stock",
};

/**
 * The display name for a module code, for callers that hold the code as a plain
 * `string` (a route's `requireModule` argument, a `Module.name` row that predates
 * this map).
 *
 * An unrecognised code falls back to itself: the caller is naming a module it
 * could not resolve, and the code is the only thing that identifies it.
 */
export function moduleName(code: string): string {
  return MODULE_NAMES[code as ModuleCode] ?? code;
}

/**
 * Modules every tenant has without buying them, keyed by the same `Module.code`.
 * A core module passes `requireModule` as soon as the tenant exists.
 */
export const CORE_MODULE_CODES = [
  "dashboard",
  "appointments",
  "customers",
  "catalogue",
  "staff",
  "sales",
] as const;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 200;

/**
 * The POS item search returns at most this many rows **per item kind**, not in
 * total.
 *
 * Five kinds are merged into one list, so a single budget would let the first kind
 * crowd the others out — a salon with 400 products would never see its four
 * services. A cashier narrows the list by typing, which is why the ceiling is low
 * rather than a page size.
 */
export const DEFAULT_SALE_ITEM_LIMIT = 20;
export const MAX_SALE_ITEM_LIMIT = 50;

/**
 * Mirrors the `PaymentMethod` database enum — how a customer paid.
 *
 * Codes, not labels: the till names the tender and the API stores it. `CARD`
 * covers a card-present charge and a gateway session alike; `sessionId` on the
 * payment row is what tells the two apart.
 *
 * The enum predates this phase — it was declared for the platform `Payment`
 * model — and `SalePayment` reuses it rather than declaring a second list that
 * could drift from the first.
 */
export const PAYMENT_METHODS = ["CASH", "CARD", "BANK_TRANSFER", "CHEQUE", "OTHER"] as const;

export type PaymentMethodCode = (typeof PAYMENT_METHODS)[number];

/**
 * Mirrors the `SaleStatus` database enum.
 *
 * `VOID` exists because a sale that has been rung up and then found to be wrong
 * needs a recorded state; deleting the row would delete the receipt with it.
 */
export const SALE_STATUSES = ["HELD", "COMPLETED", "VOID"] as const;

export type SaleStatusCode = (typeof SALE_STATUSES)[number];

/** Mirrors the `PaymentStatus` database enum. Legacy `payment_status` `0=unpaid 1=paid`. */
export const PAYMENT_STATUSES = ["UNPAID", "PAID"] as const;

export type PaymentStatusCode = (typeof PAYMENT_STATUSES)[number];

/**
 * Ceilings for one sale.
 *
 * A sale is posted whole — lines, tenders and all — in a single request, so the
 * array bounds are what stop one request from being unbounded work. A hundred
 * lines is far past any real till receipt; ten tenders is past any real split.
 */
export const MAX_SALE_LINES = 100;
export const MAX_SALE_PAYMENTS = 10;

/**
 * How many rows the till's sale list answers with.
 *
 * A hold is a draft somebody walks back for within the hour, so the list is a
 * workbench rather than a report: newest first, with a ceiling and no cursor. A hold
 * that has fallen off this page is a cart nobody came back for, and what happens to
 * those is Phase 9's question rather than the till's
 * ([ADR 0015](../../../PROJECT.md#adr-0015)).
 */
export const MAX_SALE_LIST = 50;

/**
 * The highest receipt number a salon can reach.
 *
 * Legacy wrote `random_int(100000, 999999)` into `sales.sale_id` — a
 * human-readable reference with no uniqueness constraint, so two sales could
 * share one. The rebuild assigns a per-tenant sequence instead
 * ([ADR 0011](../../../PROJECT.md#adr-0011));
 * this is the ceiling that keeps a sequence number inside an `Int` column.
 */
export const MAX_RECEIPT_NUMBER = 999_999_999;

/** Access tokens are short-lived; refresh tokens are rotated on every use. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Email one-time code expires after ten minutes. */
export const TWO_FACTOR_CODE_TTL_SECONDS = 10 * 60;

export const PASSWORD_MIN_LENGTH = 8;

/** Salon-scoped roles. Order is intentional: highest privilege first. */
export const GLOBAL_ROLES = ["SUPER_ADMIN", "MANAGER", "STAFF", "CASHIER"] as const;

/** Client surfaces that authenticate against the API. */
export const AUTH_REALMS = ["web", "pos", "mobile"] as const;

/**
 * The isolation boundary's lifecycle. Mirrors the `TenantStatus` database enum.
 * `SUSPENDED` still lets the owner in, read-only, so the person who can pay is the
 * person who sees the message; the other two refuse sign-in outright.
 */
export const TENANT_STATUSES = ["ACTIVE", "SUSPENDED", "EXPIRED", "CANCELLED"] as const;

/** Realms this phase serves. `pos` and `mobile` arrive with their own surfaces. */
export const WEB_REALM = "web" as const;
