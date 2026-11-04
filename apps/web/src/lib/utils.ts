/**
 * Shared display helpers.
 *
 * Every formatter returns "—" for missing input so tables never render
 * "Invalid Date", "null" or an empty cell.
 */

const EMPTY = "—";

export interface SalonFormattingPreferences {
  timeZone: string;
  locale: string;
}

export const DEFAULT_SALON_FORMATTING: Readonly<SalonFormattingPreferences> = Object.freeze({
  timeZone: "Asia/Singapore",
  locale: "en-SG",
});

/** Explicitly bound per provider; never store a tenant's preferences in module state. */
export function createSalonFormatters(preferences: SalonFormattingPreferences) {
  const dateOptions = { year: "numeric", month: "2-digit", day: "2-digit" } as const;
  const date = (
    value: string | Date | null | undefined,
    options = dateOptions as Intl.DateTimeFormatOptions,
  ) => {
    // Birthdays, expiries and report buckets are calendar dates, not UTC instants.
    const dateOnly = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const parsed = toDate(dateOnly ? `${value}T00:00:00.000Z` : value);
    if (!parsed) return EMPTY;
    if (dateOnly && parsed.toISOString().slice(0, 10) !== value) return EMPTY;
    return new Intl.DateTimeFormat(preferences.locale, {
      ...options,
      timeZone: dateOnly ? "UTC" : preferences.timeZone,
    }).format(parsed);
  };
  return {
    formatDate: date,
    formatDateTime: (value: string | Date | null | undefined) =>
      date(value, {
        ...dateOptions,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
    formatTime: (value: string | Date | null | undefined) =>
      date(value, {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
    formatMoney: (value: number | null | undefined) =>
      formatMoney(value, "SGD", preferences.locale),
    formatPrice: (value: string | number | null | undefined) =>
      formatPrice(value, "SGD", preferences.locale),
  };
}

function currencyFormat(amount: number, currency: string, locale: string): string {
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
  // en-SG otherwise abbreviates SGD as an ambiguous "$". Keep the requested S$
  // label explicit even when another formatting locale is selected.
  return formatter
    .formatToParts(amount)
    .map((part) => (part.type === "currency" && currency === "SGD" ? "S$" : part.value))
    .join("");
}

export function formatDate(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" },
): string {
  const date = toDate(value);
  return date ? date.toLocaleDateString("en-GB", options) : EMPTY;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : EMPTY;
}

/** `YYYY-MM-DD` in local time — safe for `<input type="date">`. */
export function formatDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * `YYYY-MM-DD` from `<input type="date">` → that day's midnight **in the browser's
 * own timezone**, written with an explicit offset (`2026-10-23T00:00:00+08:00`).
 *
 * It exists because a date picker knows a day while the API stores an instant: a
 * bare `2026-10-23` is a different moment in every timezone, so
 * `recordSubscriptionSchema` refuses one. The offset comes from the machine the
 * operator is sitting at — the wall clock they read the period against — so the
 * day never shifts to the one before it.
 *
 * Returns `null` for anything that is not a real calendar day (`2026-02-30`,
 * `23/10/2026`, an empty picker) so the caller can name the field that is wrong
 * instead of forwarding a parse error.
 */
export function dayToLocalInstant(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [year, month, date] = day.split("-").map((part) => Number.parseInt(part, 10));
  const local = new Date(year, month - 1, date);
  // A day the month does not have rolls forward into the next one; refuse it
  // rather than quietly recording a different day.
  if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== date)
    return null;
  // `getTimezoneOffset` counts minutes *behind* UTC, so +08:00 reports -480.
  const offset = -local.getTimezoneOffset();
  const total = Math.abs(offset);
  const hours = String(Math.floor(total / 60)).padStart(2, "0");
  const minutes = String(total % 60).padStart(2, "0");
  return `${day}T00:00:00${offset < 0 ? "-" : "+"}${hours}:${minutes}`;
}

/** Formats a minor-unit amount (cents) as a currency string. */
export function formatMoney(
  minorUnits: number | null | undefined,
  currency = "SGD",
  locale = "en-SG",
): string {
  if (minorUnits === null || minorUnits === undefined || !Number.isFinite(minorUnits)) return EMPTY;
  return currencyFormat(minorUnits / 100, currency, locale);
}

/**
 * Formats a price **as the API sends it** — a `Decimal` serialised in major units
 * (`"12.50"`), which is a different number from what `formatMoney` takes.
 *
 * They are two functions rather than one with a flag because the difference is a
 * factor of a hundred and nothing downstream could tell: handing `"12.50"` to
 * `formatMoney` renders `$0.13`, silently and plausibly. Prices cross the wire as
 * strings so no cent is lost to a float (`productSummarySchema`), and this is the
 * one place that turns one back into a display string.
 */
export function formatPrice(
  value: string | number | null | undefined,
  currency = "SGD",
  locale = "en-SG",
): string {
  // `Number("")` is 0, which would print a price for a blank field, so empty is
  // checked before the coercion rather than after it.
  if (value === null || value === undefined || value === "") return EMPTY;
  const amount = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(amount)) return EMPTY;
  return currencyFormat(amount, currency, locale);
}

/** "1h 15m" / "45m" from a duration in minutes. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return EMPTY;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${remainder}m` : `${remainder}m`;
}

/** Up to two uppercase initials, for avatar fallbacks. */
export function getInitials(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

/** `IN_PROGRESS` → `in progress`. */
export function formatStatus(status: string | null | undefined): string {
  if (!status) return EMPTY;
  return status.replace(/_/g, " ").toLowerCase();
}

/** Joins conditional class names. */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
