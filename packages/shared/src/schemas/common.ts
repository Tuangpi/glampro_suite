import { z } from "zod";

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants.js";

/** List endpoints accept `?page=&pageSize=` and coerce them to numbers. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Free-text search used by the POS item grid and every list toolbar. */
export const searchQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
});

export const idParamSchema = z.object({
  id: z.string().min(1).max(64),
});

export const emailSchema = z.email().max(255);

export const moneySchema = z.coerce.number().finite().min(0).max(99_999_999);

/** Loyalty points earned per sale line. Legacy stored these as bare integers. */
export const pointsSchema = z.coerce.number().int().min(0).max(1_000_000);

/** Stock on hand, or sessions in a package. Negative stock is never valid. */
export const quantitySchema = z.coerce.number().int().min(0).max(10_000_000);

/**
 * Booking duration in minutes.
 *
 * `Service.durationMinutes` exists because the legacy `services` table had no
 * duration column even though booking needed one — it lived only on
 * `appointments`. It is optional on the service and required by the appointment
 * flow, which is where it actually decides a slot length.
 */
export const durationMinutesSchema = z.coerce
  .number()
  .int()
  .min(5)
  .max(24 * 60);

/**
 * Longest barcode accepted.
 *
 * EAN-13 is 13 characters, but a scanner can deliver plenty of longer
 * symbologies (ITF-14, Code 128, GS1-128 with an application identifier), so
 * the limit is generous rather than EAN-shaped.
 */
export const MAX_BARCODE_LENGTH = 64;

/**
 * Normalises a barcode to the form the database stores and the scanner
 * matches on: trimmed, upper-cased, and empty means "no barcode".
 *
 * **Why upper-case.** A scanner and a human typing the same code disagree
 * about case often enough to matter ("abc123" vs "ABC123"). Normalising once,
 * here, means the exact-match lookup finds the product either way.
 *
 * **Why `null` and not `""`.** An empty string is a value that has to be
 * compared, indexed and kept unique. `null` is the absence of one, which is
 * what "this product carries no barcode" actually means, and it keeps the
 * unique index free of a special case.
 */
export function normalizeBarcode(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.toUpperCase();
}

/**
 * A barcode as written by a person or produced by a scanner.
 *
 * Accepts an empty string and treats it as "no barcode" — a form field left
 * blank must not be an error, it is the common case. The value is normalised
 * on the way in, so the service layer receives the same string the database
 * will hold.
 */
export const barcodeInputSchema = z
  .string()
  .trim()
  .max(MAX_BARCODE_LENGTH, "Barcode is too long")
  .transform((value) => (value.length === 0 ? null : value.toUpperCase()))
  .nullable()
  .optional();
