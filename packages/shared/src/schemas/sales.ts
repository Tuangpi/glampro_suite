/**
 * Sale contracts — handoff screens 01–02, `/api/sales`.
 *
 * The sale flow has three steps and this file holds two of them: the item search a
 * cashier types into **before** anything is in the cart (Phase 5b.1), and the
 * write that turns the cart into a receipt (Phase 5b.2). The third — printing the
 * receipt — is the same `saleDetailSchema` read back, so it needs no third shape.
 *
 * The five kinds below are the `SaleLineItemType` database enum, on purpose. The
 * cart stores one `SaleLine` per kind with that discriminator, so a search result
 * and the line it becomes speak one vocabulary and nothing has to guess which
 * catalogue an id came from.
 *
 * **The search and the write are deliberately asymmetric.** A search result carries
 * both prices, because which one applies depends on the customer attached to the
 * sale and that can change after the search. A write carries **no price at all**:
 * the server prices the cart from the catalogue, so a browser cannot name its own
 * price.
 */
import { z } from "zod";

import {
  DEFAULT_SALE_ITEM_LIMIT,
  MAX_SALE_LIST,
  MAX_RECEIPT_NUMBER,
  MAX_SALE_ITEM_LIMIT,
  MAX_SALE_LINES,
  MAX_SALE_PAYMENTS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  SALE_STATUSES,
  isRedemptionPaymentMethod,
} from "../constants.js";
import { emailSchema, moneySchema } from "./common.js";

/**
 * Mirrors the `SaleLineItemType` enum. The order is the order the picker draws its
 * tabs in, and `sale.service.test.ts` asserts the two lists stay equal.
 */
export const SALE_ITEM_KINDS = [
  "SERVICE",
  "PRODUCT",
  "PACKAGE",
  "VALUE_PACKAGE",
  "GIFT_CARD",
] as const;

export const saleItemKindSchema = z.enum(SALE_ITEM_KINDS);

/**
 * A voucher code as the till accepts it.
 *
 * Trimmed and upper-cased before it is compared, because a customer reading
 * "save10" off a flyer and a manager typing "SAVE10" mean the same campaign. The
 * character set excludes spaces and punctuation so a code can be printed, typed and
 * put in a URL without escaping.
 */
export const voucherCodeSchema = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, hyphens or underscores.")
  .transform((code) => code.toUpperCase());

export type SaleItemKind = z.infer<typeof saleItemKindSchema>;

/**
 * `?search=&kind=&limit=`
 *
 * `kind` is the category the cashier has selected — one tab of the picker — and an
 * unknown one is **rejected rather than ignored**, the same rule `?status=` follows
 * on the catalogue tabs: a typo in a category must not quietly widen the search to
 * everything.
 *
 * `limit` counts rows **per kind** (see `DEFAULT_SALE_ITEM_LIMIT`).
 */
export const saleItemSearchQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  kind: saleItemKindSchema.optional(),
  /**
   * An exact barcode, as a scanner or a typed code delivers it.
   *
   * Normalised the same way the stored barcodes are (trimmed, upper-cased), so
   * a scan finds the product whether the code was written in lower case or
   * with stray spaces. An empty value means "no barcode" and is ignored.
   */
  barcode: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_SALE_ITEM_LIMIT).default(DEFAULT_SALE_ITEM_LIMIT),
});

export type SaleItemSearchQuery = z.infer<typeof saleItemSearchQuerySchema>;

/**
 * What every sellable kind has.
 *
 * The per-kind payloads below add only the columns that kind actually has, so the
 * picker draws a stock badge for a product and a session count for a package rather
 * than a row of columns that are `null` for everything else.
 */
const saleItemBase = {
  /** The id the cart will store as `SaleLine.itemId`, with `kind` naming its table. */
  id: z.string(),
  name: z.string(),
  /**
   * What one unit costs before any line discount: the non-member price where the
   * catalogue holds a member/non-member pair, and the only price there is for a
   * value package or a gift card (whose model has a single column, the card's face
   * value).
   *
   * A **string on the wire**, like every other price: the column is `Decimal(12,2)`
   * and a JSON float has already lost the cent.
   */
  price: z.string(),
  /**
   * The member price, or `null` for the kinds that have only one price.
   *
   * Both prices come back together because whether the member one applies depends on
   * the customer attached to the sale, which can change *after* the search — the cart
   * has to be able to re-price a line without searching again.
   */
  memberPrice: z.string().nullable(),
};

/** A service. Legacy `services`. */
const serviceSaleItemSchema = z.object({
  ...saleItemBase,
  kind: z.literal("SERVICE"),
  /** Loyalty points the line earns. Legacy `point`. */
  points: z.number().int(),
  /** Booking length, `null` when the salon has not set one. */
  durationMinutes: z.number().int().nullable(),
});

/** A stock item. Legacy `products`. */
const productSaleItemSchema = z.object({
  ...saleItemBase,
  kind: z.literal("PRODUCT"),
  points: z.number().int(),
  /** Stock on hand. */
  quantity: z.number().int(),
  /**
   * At or below the tenant's threshold, computed on the server — the picker holds
   * one `limit`-sized page, so it cannot judge stock for itself (ADR 0010).
   */
  lowStock: z.boolean(),
  /**
   * The scannable barcode, normalised, or `null` when the product carries none.
   *
   * Carried on the wire so the till can show the code under the product and so a
   * client that knows a barcode can match it against what it holds.
   */
  barcode: z.string().nullable(),
});

/** A bundle of sessions. Legacy `packages`. */
const packageSaleItemSchema = z.object({
  ...saleItemBase,
  kind: z.literal("PACKAGE"),
  /** Sessions the bundle grants. Legacy `no_of_time`. */
  sessionCount: z.number().int(),
  /** How many services it may be spent on — the count, not the list. */
  serviceCount: z.number().int(),
});

/** Prepaid credit: the customer pays `price` and receives `credit`. Legacy `valuepackages`. */
const valuePackageSaleItemSchema = z.object({
  ...saleItemBase,
  kind: z.literal("VALUE_PACKAGE"),
  /** The credit the customer receives. `price` is what they pay. */
  credit: z.string(),
  serviceCount: z.number().int(),
});

/**
 * A prepaid card, as the **template** the salon sells. Legacy `giftcards`.
 *
 * No `value` field: `GiftCard` has one money column, so the card's face value is the
 * `price` a customer pays for it. A second field carrying the same number would only
 * give the two a chance to disagree.
 */
const giftCardSaleItemSchema = z.object({
  ...saleItemBase,
  kind: z.literal("GIFT_CARD"),
  /** The expiry an issued card inherits; `null` means it never expires. */
  expiresAt: z.string().nullable(),
});

/**
 * One row of the POS item search, discriminated on `kind`.
 *
 * A union rather than one object with five nullable halves: a package has no stock, a
 * gift card has no points, and a client that switches on `kind` gets a type that says
 * so instead of a field that is always `null` for the kind it is holding.
 */
export const saleItemSchema = z.discriminatedUnion("kind", [
  serviceSaleItemSchema,
  productSaleItemSchema,
  packageSaleItemSchema,
  valuePackageSaleItemSchema,
  giftCardSaleItemSchema,
]);

export type SaleItem = z.infer<typeof saleItemSchema>;

/** The item search's answer. */
export const saleItemSearchResultSchema = z.object({
  /**
   * The kinds this salon may sell — the tabs the picker can fill.
   *
   * An add-on the salon has not bought leaves its kinds **out of this list** rather
   * than failing the request. The picker belongs to a core feature, and a cashier at
   * a salon with no Packages add-on still has to ring up a shampoo; an empty tab,
   * though, would read as "there are none". This list is independent of `?kind=`,
   * which only narrows `items`.
   */
  searchableKinds: z.array(saleItemKindSchema),
  items: z.array(saleItemSchema),
});

export type SaleItemSearchResult = z.infer<typeof saleItemSearchResultSchema>;

/**
 * How the money was handed over. Mirrors the `PaymentMethod` database enum.
 *
 * The same enum the platform `Payment` model already used, reused rather than
 * redeclared: a second list of tender codes would be a second thing to keep in
 * step with the database.
 */
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

export type SalePaymentMethod = z.infer<typeof paymentMethodSchema>;

/** Mirrors `SaleStatus`. A sale is completed when it is rung up; `HELD` is not drawn yet. */
export const saleStatusSchema = z.enum(SALE_STATUSES);

export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);

/**
 * A line discount, as a rate.
 *
 * Bounded to 0–100 and to **two decimal places**, because the column is
 * `Decimal(5,2)`: a rate of `12.345` would be rounded by the database *after* the money
 * had been computed from it, and the stored rate would no longer explain the stored
 * amount. Two decimals is what the column can hold, so it is what the contract accepts
 * ([ADR 0017](../../../../PROJECT.md#adr-0017)).
 */
export const discountPercentSchema = z.coerce
  .number()
  .min(0)
  .max(100)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, {
    message: "A discount rate has at most two decimal places.",
  });

/**
 * One cart line, as the till posts it.
 *
 * **No price.** The request says *what* was sold and *how many*; the server reads
 * the catalogue and decides what it costs. Legacy did the opposite — the browser
 * posted `newPrice` per line and the API stored it unexamined
 * (`SaleController::insert*`), so the price a salon charged was the price a
 * browser chose. `SaleLine.unitPrice` is therefore not a field a client can set.
 *
 * `discountPercent` is the one exception, and it is a **rate rather than an amount**:
 * the client may ask for a reduction of a price the server chose, and cannot name a
 * price of its own (ADR 0017).
 *
 * `staffId` is the redesign's addition: legacy could attribute at most four
 * stylists to a whole sale (`sold_by_one..four`), while a cart attributes each
 * line.
 */
export const saleLineInputSchema = z.object({
  itemType: saleItemKindSchema,
  itemId: z.string().min(1).max(64),
  /** A line of zero is not a line; the till removes it instead of posting it. */
  quantity: z.coerce.number().int().min(1).max(10_000),
  staffId: z.string().min(1).max(64).optional(),
  /** Absent is a line nobody discounted. */
  discountPercent: discountPercentSchema.optional(),
});

export type SaleLineInput = z.infer<typeof saleLineInputSchema>;

/**
 * One tender.
 *
 * `payments[]` is what collapses legacy's three endpoints — `pay-by-cash`,
 * `pay-by-card` and `split-pay` — into one write, so a split is not a special
 * case but two rows. Legacy had no place to put a split: `splitPay()` charged the
 * card half through Stripe and then stored the whole thing as the free text
 * `"cash_50_card_25"` in `sales.payment_type`, which no report can sum.
 *
 * `sessionId` is a gateway session for a card tender that settles later; it moves
 * off the sale row (where legacy kept one `sales.session_id`) onto the tender it
 * belongs to.
 *
 * `holdingId` names the package or value package a **redemption** tender spends
 * (TK2610-0011). Two rules keep the pair honest, and both are checked here rather
 * than left to the service: a redemption must name a holding and be worth
 * something, and a money tender must not name one at all. The amount is still
 * checked against the holding by the service — the contract can say the field is
 * required, only the database can say how much is left on it.
 */
export const salePaymentInputSchema = z
  .object({
    method: paymentMethodSchema,
    /** An **input**, so coerced by `moneySchema`; it comes back out as a string. */
    amount: moneySchema,
    sessionId: z.string().trim().max(255).optional(),
    holdingId: z.string().min(1).max(64).optional(),
  })
  .superRefine((tender, ctx) => {
    if (isRedemptionPaymentMethod(tender.method)) {
      if (tender.holdingId === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "A package or credit tender has to name the holding it spends.",
          path: ["holdingId"],
        });
      }
      if (tender.amount <= 0) {
        ctx.addIssue({
          code: "custom",
          message: "A package or credit tender has to pay for something.",
          path: ["amount"],
        });
      }
      return;
    }

    if (tender.holdingId !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Only a package or credit tender spends a holding.",
        path: ["holdingId"],
      });
    }
  });

export type SalePaymentInput = z.infer<typeof salePaymentInputSchema>;

/**
 * The cart a till posts — what was sold, to whom, and what was handed over.
 *
 * One object behind the two writes that carry a whole cart, because they differ in
 * *when* they write, not in what they say: ringing a cart up, and completing a cart
 * that was parked first (ADR 0015). A second, near-identical shape would be a
 * second place for a line to be described.
 *
 * `customerId` is optional because the till draws a **Walk-in** chip: a walk-in
 * sale has no customer row, and the legacy schema's non-null `customer_id` is how
 * that system ended up needing an invented "cash customer" per salon. The lines
 * that **grant** something (a package, a value package, a gift card) do need an
 * owner, and the service refuses those without one rather than silently issuing
 * credit to nobody.
 */
const saleBodySchema = z.object({
  customerId: z.string().min(1).max(64).optional(),
  staffId: z.string().min(1).max(64).optional(),
  note: z.string().trim().max(1000).optional(),
  lines: z.array(saleLineInputSchema).min(1).max(MAX_SALE_LINES),
  payments: z.array(salePaymentInputSchema).max(MAX_SALE_PAYMENTS).default([]),
  /**
   * A management voucher to apply (V1/D1). Optional, one per sale, and only on a
   * completed sale: a parked cart has no customer price yet, so the code is not
   * consumed while it sits in the hold. The service validates dates, spend and the
   * redemption limit and computes the money; the browser never sends an amount.
   */
  voucherCode: voucherCodeSchema.optional(),
});

/** D1: a voucher and a manual line discount never share a sale. */
function refuseMixedDiscounts(
  input: { voucherCode?: string; lines: readonly { discountPercent?: number }[] },
  ctx: z.RefinementCtx,
): void {
  if (input.voucherCode === undefined) return;
  if (input.lines.some((line) => (line.discountPercent ?? 0) > 0)) {
    ctx.addIssue({
      code: "custom",
      message:
        "Remove the manual line discounts before applying a voucher; they cannot be combined.",
      path: ["voucherCode"],
    });
  }
}

/**
 * `POST /api/sales` — the whole sale in one request.
 *
 * `idempotencyKey` is **Q16**. Legacy's `pay-by-cash` posts a payment with no key
 * anywhere, so a double-tap charges twice; the key is stored on the sale and a
 * replay returns the sale that already exists instead of writing a second one.
 *
 * `hold` parks the cart instead of ringing it up: the sale is written with
 * `status: HELD`, no receipt number, no tenders and no ledger rows, and the till can
 * pick it up later at any till in the salon (ADR 0015). It takes **no payment** —
 * money changing hands is what completion *is*, so a hold carrying tenders is
 * refused here rather than written into a half-state.
 */
export const createSaleSchema = saleBodySchema
  .extend({
    hold: z.boolean().optional(),
    idempotencyKey: z.string().trim().min(8).max(128).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.hold === true && input.payments.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "A held sale takes no payment; resume it and complete it to take money.",
        path: ["payments"],
      });
    }
    if (input.hold === true && input.voucherCode !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "A voucher is consumed when the sale is completed, not while it is held.",
        path: ["voucherCode"],
      });
    }
    refuseMixedDiscounts(input, ctx);
  });

export type CreateSaleInput = z.infer<typeof createSaleSchema>;

/**
 * `POST /api/sales/:id/complete` — ring up a cart that was parked.
 *
 * The same cart as the create, minus `hold` and `idempotencyKey`. No key: a hold is
 * already one row with one id, so the replay case is answered by the sale's own
 * status — a second completion of a `COMPLETED` sale returns the receipt it already
 * has rather than writing a second one, which is stronger than a key and needs no
 * client cooperation.
 *
 * The lines are re-sent rather than read back off the hold, and that is the point:
 * the cart may have been edited after the resume, and the server prices whatever it
 * is handed from the catalogue. The hold's own line rows are rewritten in the same
 * transaction, because a draft nobody has printed is not history (ADR 0015).
 */
export const completeSaleSchema = saleBodySchema.superRefine(refuseMixedDiscounts);

export type CompleteSaleInput = z.infer<typeof completeSaleSchema>;

/**
 * `GET /api/sales?status=&limit=&page=` — the till's sale list.
 *
 * `status` **defaults to `HELD`** to preserve existing parked-cart callers.
 * History explicitly requests COMPLETED or VOID. The default is stated here rather than left to the
 * route so the contract says what "no filter" means. An unknown value is **refused
 * rather than ignored**, the same rule `?kind=` follows on the item search: a typo
 * in a filter must not quietly widen a query to everything.
 *
 * The whole `SaleStatus` enum is accepted rather than a `?held=true` boolean, so the
 * voided-sales list Phase 5h adds is `?status=VOID` on this route instead of a
 * second one. Pages use a stable soldAt/id ordering; concurrent writes may move rows
 * between pages, so this is live browsing rather than a frozen export.
 */
export const saleListQuerySchema = z.object({
  status: saleStatusSchema.default("HELD"),
  limit: z.coerce.number().int().min(1).max(MAX_SALE_LIST).default(MAX_SALE_LIST),
  page: z.coerce.number().int().min(1).max(1000000).optional(),
});

export type SaleListQuery = z.infer<typeof saleListQuerySchema>;

/**
 * One row of the sale list — enough to recognise a sale and decide whether to open
 * it, and no more.
 *
 * **No lines.** The list is what a cashier scans to find the cart they parked; the
 * lines arrive when they open one (`GET /api/sales/:id`), so a salon with fifty
 * holds does not answer one request with fifty carts' worth of rows.
 */
export const saleSummarySchema = z.object({
  id: z.string(),
  /** `null` until the sale is completed; a held cart has not printed anything yet. */
  receiptNumber: z.number().int().min(1).max(MAX_RECEIPT_NUMBER).nullable(),
  status: saleStatusSchema,
  /** When it was parked, or when it was rung up. The list draws "20 minutes ago". */
  soldAt: z.string(),
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
  staffId: z.string().nullable(),
  /** Who parked it, so a colleague knows whose cart this is. */
  staffName: z.string().nullable(),
  note: z.string().nullable(),
  /** Distinct lines, which is the number of rows the resumed cart draws. */
  lineCount: z.number().int(),
  /** Units across those lines — what tells two one-line holds apart. */
  totalQuantity: z.number().int(),
  totalAmount: z.string(),
});

export type SaleSummary = z.infer<typeof saleSummarySchema>;

export const saleListSchema = z.object({
  items: z.array(saleSummarySchema),
  page: z.number().int().positive(),
  hasMore: z.boolean(),
});

export type SaleList = z.infer<typeof saleListSchema>;

/**
 * A line of a stored sale — the receipt's row.
 *
 * Money is a **string** here and a number in `saleLineInputSchema`, which is the
 * convention every contract in this package keeps: `Decimal(12,2)` goes in
 * coerced and comes out formatted, because a JSON float has already lost the cent
 * it is carrying.
 */
export const saleLineSchema = z.object({
  id: z.string(),
  itemType: saleItemKindSchema,
  /** The catalogue row's id, which the receipt does not need and history does. */
  itemId: z.string(),
  /** The name **snapshotted at sale time**, so archiving a service keeps the receipt. */
  itemName: z.string(),
  quantity: z.number().int(),
  /** What one unit sold for **after** the discount, which is what the column holds. */
  unitPrice: z.string(),
  lineTotal: z.string(),
  /** The rate the till applied; `"0.00"` for a line nobody discounted (ADR 0017). */
  discountPercent: z.string(),
  /** What that rate took off the whole line, as money. The `Discount` row's parts. */
  discountAmount: z.string(),
  /**
   * The voucher's share of this line (ADR 0020), or `"0.00"`. `lineTotal` stays the
   * pre-voucher figure, so `netLineTotal` is what this line actually contributed to
   * the sale and what GST was backed out of.
   */
  voucherDiscountAmount: z.string(),
  /** `lineTotal - voucherDiscountAmount`. */
  netLineTotal: z.string(),
  /**
   * GST included in this line, as money (TK2610-0009 / P0-01).
   *
   * Prices are GST-inclusive, so this is the back-calculated component —
   * `lineTotal × rate / (100 + rate)` — rounded to the cent on the line.
   * The receipt's `taxAmount` is the sum of these, not a recomputation.
   */
  taxAmount: z.string(),
  /** The GST rate the till applied, as stored; `"0.00"` when GST is disabled. */
  taxRate: z.string(),
  /** Who this line is credited to; `null` is uncredited, which is the product case. */
  staffId: z.string().nullable(),
  staffName: z.string().nullable(),
});

export type SaleLine = z.infer<typeof saleLineSchema>;

/** A stored tender. */
export const salePaymentSchema = z.object({
  method: paymentMethodSchema,
  amount: z.string(),
  sessionId: z.string().nullable(),
});

export type SalePayment = z.infer<typeof salePaymentSchema>;

/**
 * The receipt — what `POST /api/sales` returns and `GET /api/sales/:id` re-reads.
 *
 * One shape for both, because the confirmation screen *is* the receipt
 * (`docs/roadmap.md` → Phase 5d): a second representation for the just-created
 * case is a second thing that can disagree with the stored one.
 *
 * `outstandingAmount` comes back rather than being left for the client to
 * subtract: whether a balance is owed is the server's judgement (`paidAmount <
 * totalAmount`), and a client that subtracts two strings gets a float.
 */
export const saleDetailSchema = z.object({
  id: z.string(),
  /**
   * The receipt number, unique per salon. Nullable because a row that predates the
   * column — a migrated sale, or one written while the importer is still running —
   * has no number yet, and inventing one on read would be worse than saying "not
   * assigned".
   */
  receiptNumber: z.number().int().min(1).max(MAX_RECEIPT_NUMBER).nullable(),
  status: saleStatusSchema,
  paymentStatus: paymentStatusSchema,
  /** ISO 8601. Legacy's `sale_date` + `sale_time`, which were two columns. */
  soldAt: z.string(),
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
  /** Who rang it up. Per-line credit is on each line's `staffId`. */
  staffId: z.string().nullable(),
  staffName: z.string().nullable(),
  note: z.string().nullable(),
  /**
   * When it was voided, or `null` while it stands (ADR 0016). Carried on the receipt so
   * a reprinted one cannot be mistaken for a live sale, and so the screen can say why.
   */
  voidedAt: z.string().nullable(),
  /** Why, in whoever voided it's own words. `null` unless `status` is `VOID`. */
  voidReason: z.string().nullable(),
  /**
   * Who answered for it, by name. `null` when the account that voided it has since been
   * deleted — the `SetNull` link the schema keeps on purpose, so losing a manager does
   * not lose the sale.
   */
  voidedByName: z.string().nullable(),
  totalQuantity: z.number().int(),
  totalAmount: z.string(),
  paidAmount: z.string(),
  /**
   * What the discounts on this sale's lines came to, summed by the **server**. The
   * handoff's cart draws one `Discount` row, so the confirmation prints the same figure
   * rather than a client adding up rates and money for itself (ADR 0017).
   */
  discountAmount: z.string(),
  /**
   * GST included in this sale, as money (TK2610-0009 / P0-01).
   *
   * Summed by the **server** from the lines it wrote, like `discountAmount`:
   * rounding means the total is not reversible from a rate, and the money is
   * what was charged. `"0.00"` when GST is disabled for the salon.
   */
  taxAmount: z.string(),
  /** The GST rate applied to this sale, as stored; `"0.00"` when disabled. */
  taxRate: z.string(),
  /**
   * The salon's GST registration number, **snapshotted at completion**
   * (TK2610-0010). A reprint or an emailed copy therefore shows the number that
   * applied when the sale was rung up, even if the salon later changes it.
   *
   * `null` when the sale was written before the column existed and no number was
   * recorded, or when GST was disabled. The receipt falls back to the salon's
   * current number for those historical rows.
   */
  gstRegistrationNumber: z.string().nullable(),
  /** The voucher code applied, or `null` (ADR 0020). */
  voucherCode: z.string().nullable(),
  /** What that voucher took off the sale, as money. `"0.00"` when none. */
  voucherDiscountAmount: z.string(),
  /** When a full-sale refund was recorded, or `null` while none has been (ADR 0020). */
  refundedAt: z.string().nullable(),
  /** What was refunded: always the sale's total, snapshotted on the refund row. */
  refundAmount: z.string().nullable(),
  /** The manager's reason. `null` unless a refund exists. */
  refundReason: z.string().nullable(),
  /** Who recorded it, by name; `null` if that account has since been deleted. */
  refundedByName: z.string().nullable(),
  /** Whether the manager chose to put product lines back on the shelf. */
  refundRestocked: z.boolean().nullable(),
  refundPayouts: z
    .array(z.object({ method: z.enum(PAYMENT_METHODS), amount: z.string() }))
    .default([]),
  /** `totalAmount - paidAmount`, never negative. Non-zero means a `CustomerOutstanding`. */
  outstandingAmount: z.string(),
  /** The points this sale earned its customer; `0` for a walk-in. */
  pointsEarned: z.number().int(),
  lines: z.array(saleLineSchema),
  payments: z.array(salePaymentSchema),
});

export type SaleDetail = z.infer<typeof saleDetailSchema>;

/**
 * `POST /api/sales/:id/void` — takes a rung-up sale off the books (ADR 0016).
 *
 * The **reason is required** and the actor is deliberately **not** in the body: it comes
 * from the verified JWT, because a caller who could name the person who voided something
 * could name somebody else, and the point of recording an actor is that it cannot be
 * chosen.
 *
 * Three characters is the floor that keeps `"x"` from being an audit record; five
 * hundred is the ceiling that keeps a reason a sentence rather than a transcript.
 */
export const voidSaleSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export type VoidSaleInput = z.infer<typeof voidSaleSchema>;

/**
 * `POST /api/sales/:id/receipt/email` — where the e-receipt should go.
 *
 * The address is **in the body rather than read from the customer row**: the cashier
 * may be sending to a partner or a shared inbox, and the dialog prefills the customer's
 * saved address so the common case is one tap. `emailSchema` is the same contract login
 * and staff creation use, so the till cannot accept an address the rest of the app
 * would refuse.
 */
export const emailSaleReceiptSchema = z.object({
  email: emailSchema,
});

export type EmailSaleReceiptInput = z.infer<typeof emailSaleReceiptSchema>;

/**
 * What the send answers.
 *
 * Only the destination and the provider's message id — never the body it carried, and
 * never the SMTP response. `messageId` is `null` when the transport (the development
 * JSON transport, for instance) does not issue one.
 */
export const saleReceiptEmailResultSchema = z.object({
  sent: z.literal(true),
  to: emailSchema,
  messageId: z.string().nullable(),
});

export type SaleReceiptEmailResult = z.infer<typeof saleReceiptEmailResultSchema>;

/**
 * Voucher management contracts (ADR 0020).
 *
 * A voucher is a **published promotion**, so creating and changing one is a manager's
 * job. The till only ever reads a preview or posts a code; it never names the money
 * the code is worth.
 */
export const voucherDiscountTypeSchema = z.enum(["PERCENTAGE", "FIXED"]);

export type VoucherDiscountType = z.infer<typeof voucherDiscountTypeSchema>;

/** A stored voucher, as the management list and editor read it. */
export const voucherSchema = z.object({
  id: z.string(),
  code: z.string(),
  description: z.string().nullable(),
  discountType: voucherDiscountTypeSchema,
  /** A percentage or a money amount, formatted like every other `Decimal` on the wire. */
  value: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  minSpend: z.string(),
  /** `null` is unlimited. */
  maxRedemptions: z.number().int().nullable(),
  redeemedCount: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

export type Voucher = z.infer<typeof voucherSchema>;

export const voucherListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  /** `true` asks for switched-off campaigns too; the default is the usable list. */
  includeInactive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => value === true || value === "true")
    .default(false),
});

export type VoucherListQuery = z.infer<typeof voucherListQuerySchema>;

export const voucherListSchema = z.object({
  items: z.array(voucherSchema),
});

export type VoucherList = z.infer<typeof voucherListSchema>;

const voucherFields = {
  description: z.string().trim().max(200).optional(),
  discountType: voucherDiscountTypeSchema,
  /** Percentage 0.01–100, or a positive money amount. Checked against the type below. */
  value: moneySchema,
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  minSpend: moneySchema.default(0),
  /** `null` or omitted is unlimited. */
  maxRedemptions: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
  isActive: z.boolean().default(true),
};

function checkVoucherValue(
  input: { discountType: VoucherDiscountType; value: number; startsAt: string; endsAt: string },
  ctx: z.RefinementCtx,
): void {
  if (input.discountType === "PERCENTAGE" && (input.value <= 0 || input.value > 100)) {
    ctx.addIssue({
      code: "custom",
      message: "A percentage voucher must be greater than 0 and at most 100.",
      path: ["value"],
    });
  }
  if (input.discountType === "FIXED" && input.value <= 0) {
    ctx.addIssue({
      code: "custom",
      message: "A fixed voucher must be worth something.",
      path: ["value"],
    });
  }
  if (Date.parse(input.endsAt) <= Date.parse(input.startsAt)) {
    ctx.addIssue({
      code: "custom",
      message: "The voucher has to end after it starts.",
      path: ["endsAt"],
    });
  }
}

/** `POST /api/vouchers` — a manager publishes a campaign. The code is normalised. */
export const createVoucherSchema = z
  .object({
    code: voucherCodeSchema,
    ...voucherFields,
  })
  .superRefine(checkVoucherValue);

export type CreateVoucherInput = z.infer<typeof createVoucherSchema>;

/**
 * `PATCH /api/vouchers/:id` — every field optional.
 *
 * The cross-field checks run against the **stored row after the merge**, in the
 * service, because `{ endsAt }` alone cannot be judged without the row's `startsAt`.
 * This contract still refuses a malformed instant or a switched-off code with no
 * identity change.
 */
export const updateVoucherSchema = z
  .object({
    description: voucherFields.description,
    discountType: voucherDiscountTypeSchema.optional(),
    value: moneySchema.optional(),
    startsAt: z.iso.datetime({ offset: true }).optional(),
    endsAt: z.iso.datetime({ offset: true }).optional(),
    minSpend: moneySchema.optional(),
    maxRedemptions: voucherFields.maxRedemptions,
    isActive: z.boolean().optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: "Change at least one field.",
  });

export type UpdateVoucherInput = z.infer<typeof updateVoucherSchema>;

/**
 * `POST /api/sales/voucher-preview` — what a code is worth on **this** cart.
 *
 * The till needs the answer before it takes money, so it sends the same cart it
 * would post and gets back the server's own arithmetic. The response carries no
 * customer or line detail, only the figures the payment sheet draws.
 */
export const voucherPreviewInputSchema = z.object({
  voucherCode: voucherCodeSchema,
  customerId: z.string().min(1).max(64).optional(),
  lines: z.array(saleLineInputSchema).min(1).max(MAX_SALE_LINES),
});

export type VoucherPreviewInput = z.infer<typeof voucherPreviewInputSchema>;

export const voucherPreviewSchema = z.object({
  code: z.string(),
  description: z.string().nullable(),
  discountType: voucherDiscountTypeSchema,
  value: z.string(),
  /** What the voucher would take off this cart, computed by the server. */
  discountAmount: z.string(),
  /** The SERVICE + PRODUCT subtotal it was computed from. */
  eligibleTotal: z.string(),
  /** What the cart would total after the voucher. */
  totalAmount: z.string(),
  minSpend: z.string(),
  endsAt: z.string(),
});

export type VoucherPreview = z.infer<typeof voucherPreviewSchema>;

/**
 * `POST /api/sales/:id/refund` — record a full-sale refund (ADR 0020 / R1).
 *
 * The amount is deliberately **not** in the body. A caller that could name it could
 * refund more than the sale; the server uses the sale's total. `restock` is required
 * because "we put the shampoo back" and "the customer kept it" are different facts
 * and a default would silently choose one. The actor comes from the JWT, like a void.
 */
export const refundSaleSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  restock: z.boolean(),
  payouts: z
    .array(
      z.object({
        method: z
          .enum(PAYMENT_METHODS)
          .refine((method) => !isRedemptionPaymentMethod(method), "Refunds require money tenders."),
        amount: moneySchema.refine(
          (amount) => amount > 0 && Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001,
          "Enter a positive payout amount with at most two decimal places.",
        ),
      }),
    )
    .min(1)
    .max(MAX_SALE_PAYMENTS),
});

export type RefundSaleInput = z.infer<typeof refundSaleSchema>;

/** Read-only pickup quote. Historical receipt prices remain unchanged. */
export const resumeSaleSchema = z.object({
  sale: saleDetailSchema,
  items: z
    .array(
      z.object({
        kind: saleItemKindSchema,
        id: z.string(),
        name: z.string(),
        price: z.string(),
        memberPrice: z.string().nullable(),
      }),
    )
    .max(MAX_SALE_LINES),
});

export type ResumeSale = z.infer<typeof resumeSaleSchema>;
