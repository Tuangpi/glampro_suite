import { z } from "zod";

/**
 * One customer's holding history — purchases, payments, usage and what is left.
 *
 * Two ledgers answer the question and they are never added together: a session
 * package holds sessions, a value package holds money. `kind` names which one a row
 * is, so the client never infers it from two nullable figures.
 *
 * Reporting boundaries, all deliberate:
 *
 * - **Remaining package value is the valuation view, not a catalogue price.** It
 *   comes from the frozen purchase snapshot and the remaining ordinals, exactly as
 *   `/reports/package-valuation` computes it, so the customer view and the company
 *   total cannot disagree.
 * - **Credit is its own bucket.** Unspent value-package credit is a liability that was
 *   never part of package purchase value; folding it in would double-count the same
 *   sale and break reconciliation with the company report.
 * - **Receivables are never allocated.** `receivable.sourceSaleOutstanding` is the
 *   source sale's unpaid balance, published beside the holdings it relates to rather
 *   than divided across them (a mixed sale has no package-line allocation).
 * - **Unvalued is not zero.** A legacy holding with no purchase snapshot keeps its
 *   sessions and money as counts only; it is counted separately and its `value` is
 *   `null`, so an unknown figure can never read as a known zero.
 */

const money = z.string().regex(/^\d+\.\d{2}$/);
const count = z.number().int().nonnegative();
const nonnegativeInteger = z.string().regex(/^(0|[1-9]\d*)$/);

/** One captured collection against the purchase line that created the holding. */
export const customerHoldingPaymentSchema = z.object({
  id: z.string(),
  occurredAt: z.iso.datetime(),
  grossCents: nonnegativeInteger,
  netCents: nonnegativeInteger,
  taxCents: nonnegativeInteger,
});
export type CustomerHoldingPayment = z.infer<typeof customerHoldingPaymentSchema>;

/** One draw against the holding. A reverted draw stays visible so usage is auditable. */
export const customerHoldingUsageSchema = z.object({
  id: z.string(),
  itemType: z.enum(["PACKAGE", "VALUE_PACKAGE"]),
  saleId: z.string(),
  quantity: z.number().int().positive(),
  /** Money drawn, for credit; `null` for a session draw. */
  amount: money.nullable(),
  usedAt: z.iso.datetime(),
  /** Set when the source sale was voided and the draw was put back. */
  revertedAt: z.iso.datetime().nullable(),
});
export type CustomerHoldingUsage = z.infer<typeof customerHoldingUsageSchema>;

const holdingValueSchema = z.object({
  net: money,
  originalTax: money,
  gross: money,
});

export const customerHoldingHistoryRowSchema = z.object({
  holdingId: z.string(),
  kind: z.enum(["SESSIONS", "VALUE"]),
  name: z.string(),
  /**
   * `REFUNDED` outranks the others: a cancelled purchase is the story, whatever its
   * remaining balance happens to say. `EXHAUSTED` outranks `EXPIRED` for the same
   * reason — nothing was lost at expiry that had not already been spent.
   */
  status: z.enum(["ACTIVE", "EXPIRED", "EXHAUSTED", "REFUNDED"]),
  purchasedAt: z.iso.datetime().nullable(),
  saleId: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  sessions: z.object({ granted: count, remaining: count }).nullable(),
  credit: z.object({ granted: money, remaining: money }).nullable(),
  /** Remaining purchase value of unused sessions; `null` when unvalued or cancelled. */
  value: holdingValueSchema.nullable(),
  payments: z.array(customerHoldingPaymentSchema),
  usage: z.array(customerHoldingUsageSchema),
  /** Named gaps that stop this row from being fully reconciled, never repaired here. */
  missingEvidence: z.array(z.string()),
});
export type CustomerHoldingHistoryRow = z.infer<typeof customerHoldingHistoryRowSchema>;

const valueBucketSchema = z.object({
  holdings: count,
  sessionsRemaining: count,
  net: money,
  originalTax: money,
  gross: money,
});

export const customerHoldingHistorySchema = z.object({
  customerId: z.string(),
  /** Server clock of the read; expiry is judged against it and nothing is written. */
  asOf: z.iso.datetime(),
  active: valueBucketSchema,
  /** Unused sessions whose expiry has already passed. */
  expired: valueBucketSchema,
  /** Value-package credit, kept apart from package purchase value. */
  credit: z.object({
    active: z.object({ holdings: count, remaining: money }),
    expired: z.object({ holdings: count, remaining: money }),
  }),
  unvalued: z.object({
    active: z.object({ holdings: count, sessionsRemaining: count }),
    expired: z.object({ holdings: count, sessionsRemaining: count }),
  }),
  receivable: z.object({
    sales: count,
    holdings: count,
    /** Whole source-sale balance; never an allocation to package lines. */
    sourceSaleOutstanding: money,
  }),
  holdings: z.array(customerHoldingHistoryRowSchema),
});
export type CustomerHoldingHistory = z.infer<typeof customerHoldingHistorySchema>;
