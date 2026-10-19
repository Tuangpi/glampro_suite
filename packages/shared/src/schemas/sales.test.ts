import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_SALE_ITEM_LIMIT, MAX_SALE_ITEM_LIMIT, MAX_SALE_LIST } from "../constants.js";
import {
  SALE_ITEM_KINDS,
  completeSaleSchema,
  createSaleSchema,
  createVoucherSchema,
  refundSaleSchema,
  discountPercentSchema,
  saleDetailSchema,
  saleItemSchema,
  saleItemSearchQuerySchema,
  saleLineInputSchema,
  saleLineSchema,
  saleListQuerySchema,
  saleSummarySchema,
  voidSaleSchema,
} from "./sales.js";

/** The fields every kind carries, so each case below only states what differs. */
const base = { id: "item-1", name: "Aloha", price: "10.00", memberPrice: null };

describe("voucher and refund contracts", () => {
  const body = {
    voucherCode: " save10 ",
    lines: [{ itemType: "SERVICE", itemId: "service-1", quantity: 1 }],
    payments: [{ method: "CASH", amount: 10 }],
  };

  it("normalizes a single code and refuses vouchers on holds or manually discounted sales", () => {
    assert.equal(createSaleSchema.parse(body).voucherCode, "SAVE10");
    assert.equal(createSaleSchema.safeParse({ ...body, hold: true }).success, false);
    const mixed = { ...body, lines: [{ ...body.lines[0], discountPercent: 5 }] };
    assert.equal(createSaleSchema.safeParse(mixed).success, false);
    assert.equal(completeSaleSchema.safeParse(mixed).success, false);
  });

  it("requires an explicit stock choice and never accepts a client refund amount or actor", () => {
    assert.equal(refundSaleSchema.safeParse({ reason: "Returned" }).success, false);
    assert.deepEqual(
      refundSaleSchema.parse({
        reason: " Returned ",
        restock: false,
        payouts: [{ method: "CASH", amount: 10 }],
        amount: 900,
        actorId: "forged",
      }),
      { reason: "Returned", restock: false, payouts: [{ method: "CASH", amount: 10 }] },
    );
  });

  it("validates campaign dates and percentage bounds", () => {
    const campaign = {
      code: "sale10",
      discountType: "PERCENTAGE",
      value: 10,
      startsAt: "2026-10-19T00:00:00Z",
      endsAt: "2026-10-20T00:00:00Z",
    };
    assert.equal(createVoucherSchema.parse(campaign).code, "SALE10");
    assert.equal(createVoucherSchema.safeParse({ ...campaign, value: 101 }).success, false);
    assert.equal(
      createVoucherSchema.safeParse({ ...campaign, endsAt: campaign.startsAt }).success,
      false,
    );
  });

  it("requires positive cent-exact money payouts, never redemptions", () => {
    const input = { reason: "Returned", restock: true };
    for (const payouts of [
      [],
      [{ method: "PACKAGE", amount: 10 }],
      [{ method: "CASH", amount: 0 }],
      [{ method: "CARD", amount: 1.001 }],
    ]) {
      assert.equal(refundSaleSchema.safeParse({ ...input, payouts }).success, false);
    }
    assert.equal(
      refundSaleSchema.safeParse({
        ...input,
        payouts: [
          { method: "CASH", amount: 10.25 },
          { method: "CARD", amount: 2.5 },
        ],
      }).success,
      true,
    );
  });
});

describe("saleItemSearchQuerySchema", () => {
  it("defaults the limit and leaves search and kind absent rather than empty", () => {
    const parsed = saleItemSearchQuerySchema.parse({});

    assert.equal(parsed.limit, DEFAULT_SALE_ITEM_LIMIT);
    // An empty string is a search for nothing, and `kind: ""` would be a category
    // that does not exist — absent is the state that means "no filter".
    assert.equal(parsed.search, undefined);
    assert.equal(parsed.kind, undefined);
  });

  it("coerces a limit that arrived as a query string", () => {
    assert.equal(saleItemSearchQuerySchema.parse({ limit: "5" }).limit, 5);
  });

  it("rejects a limit above the ceiling instead of clamping it silently", () => {
    assert.equal(
      saleItemSearchQuerySchema.safeParse({ limit: String(MAX_SALE_ITEM_LIMIT + 1) }).success,
      false,
    );
  });

  it("rejects a kind that is not one of the five rather than searching everything", () => {
    // A typo in the picker's category must not widen the search to the whole
    // catalogue, which is the same rule `?status=` follows on the catalogue tabs.
    assert.equal(saleItemSearchQuerySchema.safeParse({ kind: "MEMBERSHIP" }).success, false);
    assert.equal(saleItemSearchQuerySchema.safeParse({ kind: "PRODUCT" }).success, true);
  });

  it("accepts each of the five kinds, because the picker has a tab for each", () => {
    for (const kind of SALE_ITEM_KINDS) {
      assert.equal(saleItemSearchQuerySchema.safeParse({ kind }).success, true, kind);
    }
  });
});

describe("saleItemSchema", () => {
  it("carries the columns a kind actually has, and no others", () => {
    const product = saleItemSchema.parse({
      ...base,
      kind: "PRODUCT",
      points: 5,
      quantity: 12,
      lowStock: false,
    });
    assert.equal(product.kind, "PRODUCT");
    assert.equal("durationMinutes" in product, false);

    const service = saleItemSchema.parse({
      ...base,
      kind: "SERVICE",
      points: 5,
      durationMinutes: 60,
    });
    assert.equal("quantity" in service, false);

    const bundle = saleItemSchema.parse({
      ...base,
      kind: "PACKAGE",
      sessionCount: 10,
      serviceCount: 3,
    });
    assert.equal("points" in bundle, false);
  });

  it("keeps a gift card's money in one field, so the two cannot disagree", () => {
    const card = saleItemSchema.parse({ ...base, kind: "GIFT_CARD", expiresAt: null });

    assert.equal(card.price, "10.00");
    assert.equal("value" in card, false, "a template's face value is its price");
    assert.equal("status" in card, false, "GiftCard has no status column to report");
  });

  it("separates what a value package costs from the credit it carries", () => {
    const prepaid = saleItemSchema.parse({
      ...base,
      kind: "VALUE_PACKAGE",
      credit: "120.00",
      serviceCount: 0,
    });

    // Narrowed rather than cast: the union is what tells the two apart, and a test that
    // reached into it with `as` would pass even if the discriminator were wrong.
    if (prepaid.kind !== "VALUE_PACKAGE") throw new Error("expected a value package");

    assert.equal(prepaid.price, "10.00");
    assert.equal(prepaid.credit, "120.00");
  });

  it("refuses a kind the cart could not store, rather than guessing one", () => {
    assert.equal(saleItemSchema.safeParse({ ...base, kind: "MEMBERSHIP" }).success, false);
  });

  it("requires the price of any kind, because a line cannot be rung up without one", () => {
    // Spelled out rather than spread-minus-`price`, so there is no unused binding to
    // keep a linter quiet about.
    const withoutPrice = { id: "item-1", name: "Aloha", memberPrice: null };

    assert.equal(
      saleItemSchema.safeParse({ ...withoutPrice, kind: "GIFT_CARD", expiresAt: null }).success,
      false,
    );
  });
});

/** The smallest accepted cart: one line, and no tender. */
const cart = { lines: [{ itemType: "SERVICE", itemId: "s1", quantity: 1 }] };

describe("createSaleSchema", () => {
  it("defaults the tenders rather than requiring them, and leaves an ordinary sale unflagged", () => {
    const parsed = createSaleSchema.parse(cart);

    assert.deepEqual(parsed.payments, []);
    // `hold` absent is an ordinary sale, which is what every caller before Phase 5g
    // sends — so the flag has to stay optional rather than defaulted to `false` in a
    // way that would make it a required field of `CreateSaleInput`.
    assert.equal(parsed.hold, undefined);
  });

  it("parks a cart when `hold` is set, with no tender to park", () => {
    const parsed = createSaleSchema.parse({ ...cart, hold: true });

    assert.equal(parsed.hold, true);
    assert.deepEqual(parsed.payments, []);
  });

  it("refuses a hold that carries a payment, on the tender field", () => {
    const result = createSaleSchema.safeParse({
      ...cart,
      hold: true,
      payments: [{ method: "CASH", amount: 80 }],
    });

    assert.equal(result.success, false);
    // The path is what puts the message on the payment control rather than in a
    // banner: money changing hands is what completion *is* (ADR 0015).
    assert.deepEqual(
      result.success ? [] : result.error.issues.map((issue) => issue.path.join(".")),
      ["payments"],
    );
  });

  it("still takes a payment on an ordinary sale, so the rule is about the hold", () => {
    const parsed = createSaleSchema.parse({
      ...cart,
      payments: [{ method: "CASH", amount: 80 }],
    });

    assert.equal(parsed.payments.length, 1);
  });
});

describe("completeSaleSchema", () => {
  it("is the cart without a hold flag, because completing is what a hold is for", () => {
    // The flag is not merely ignored — it is not part of the shape at all, so a client
    // cannot hand a completion a mode it does not have. `saleBodySchema` is a plain
    // object, which is what makes `.shape` readable here.
    assert.equal("hold" in completeSaleSchema.shape, false);
    assert.equal("idempotencyKey" in completeSaleSchema.shape, false);
  });

  it("accepts the cart a resume posts: lines, tenders and the customer", () => {
    const parsed = completeSaleSchema.parse({
      customerId: "c1",
      lines: [
        { itemType: "SERVICE", itemId: "s1", quantity: 2, staffId: "u1" },
        { itemType: "PRODUCT", itemId: "p1", quantity: 1 },
      ],
      payments: [
        { method: "CASH", amount: 100 },
        { method: "CARD", amount: 20 },
      ],
    });

    assert.equal(parsed.lines.length, 2);
    assert.equal(parsed.payments.length, 2, "a split is two rows, as on the creating write");
  });
});

describe("saleListQuerySchema", () => {
  it("coerces page numbers and refuses invalid or excessive offsets", () => {
    assert.equal(saleListQuerySchema.parse({ page: "2" }).page, 2);
    for (const page of ["0", "-1", "1.5", "abc", "1000001"]) {
      assert.equal(saleListQuerySchema.safeParse({ page }).success, false, page);
    }
  });
  it("defaults to the parked carts, so asking for nothing is not asking for everything", () => {
    const parsed = saleListQuerySchema.parse({});

    assert.equal(parsed.status, "HELD");
    assert.equal(parsed.limit, MAX_SALE_LIST);
  });

  it("coerces a limit that arrived as a query string and refuses one above the ceiling", () => {
    assert.equal(saleListQuerySchema.parse({ limit: "10" }).limit, 10);
    assert.equal(
      saleListQuerySchema.safeParse({ limit: String(MAX_SALE_LIST + 1) }).success,
      false,
    );
  });

  it("refuses a status it does not know rather than widening to every sale", () => {
    assert.equal(saleListQuerySchema.safeParse({ status: "DELETED" }).success, false);
    for (const status of ["HELD", "COMPLETED", "VOID"]) {
      assert.equal(saleListQuerySchema.safeParse({ status }).success, true, status);
    }
  });
});

describe("saleSummarySchema", () => {
  /** A parked cart, which is the row this shape exists for. */
  const held = {
    id: "sale-1",
    receiptNumber: null,
    status: "HELD",
    soldAt: "2026-03-04T10:15:00.000Z",
    customerId: null,
    customerName: null,
    staffId: "u1",
    staffName: "Ava Owner",
    note: null,
    lineCount: 2,
    totalQuantity: 3,
    totalAmount: "80.00",
  };

  it("carries a held cart with no receipt number, which is the whole point", () => {
    assert.equal(saleSummarySchema.parse(held).receiptNumber, null);
  });

  it("carries the number once the sale is rung up", () => {
    const rung = saleSummarySchema.parse({ ...held, status: "COMPLETED", receiptNumber: 1042 });

    assert.equal(rung.receiptNumber, 1042);
  });

  it("refuses a receipt number below the sequence's first value", () => {
    // `0` is not a number this salon ever prints, so accepting it would be accepting a
    // row no receipt can explain.
    assert.equal(saleSummarySchema.safeParse({ ...held, receiptNumber: 0 }).success, false);
  });
});

/** A receipt as the API serialises one, so the cases below vary only what they test. */
const receipt = {
  id: "sale-1",
  receiptNumber: 1042,
  status: "COMPLETED",
  paymentStatus: "PAID",
  soldAt: "2026-03-04T10:15:00.000Z",
  customerId: null,
  customerName: null,
  staffId: "u1",
  staffName: "Ava Owner",
  note: null,
  voidedAt: null,
  voidReason: null,
  voidedByName: null,
  totalQuantity: 1,
  totalAmount: "80.00",
  paidAmount: "80.00",
  discountAmount: "0.00",
  taxAmount: "6.61",
  taxRate: "9.00",
  gstRegistrationNumber: "GST-123",
  voucherCode: null,
  voucherDiscountAmount: "0.00",
  refundedAt: null,
  refundAmount: null,
  refundReason: null,
  refundedByName: null,
  refundRestocked: null,
  outstandingAmount: "0.00",
  pointsEarned: 5,
  lines: [],
  payments: [],
};

describe("saleDetailSchema", () => {
  it("carries the void's three fields as null while the sale stands", () => {
    const standing = saleDetailSchema.parse(receipt);

    assert.equal(standing.voidedAt, null);
    assert.equal(standing.voidReason, null);
    assert.equal(standing.voidedByName, null);
  });

  it("carries the discount the lines came to", () => {
    const discounted = saleDetailSchema.parse({ ...receipt, discountAmount: "33.34" });

    assert.equal(discounted.discountAmount, "33.34");
    assert.equal(saleDetailSchema.parse(receipt).discountAmount, "0.00");
  });

  it("carries the GST included in the total, backed out of inclusive prices", () => {
    const taxed = saleDetailSchema.parse(receipt);

    assert.equal(taxed.taxAmount, "6.61");
    assert.equal(taxed.taxRate, "9.00");
  });

  it("carries why and by whom once it is voided, and still a receipt", () => {
    const voided = saleDetailSchema.parse({
      ...receipt,
      status: "VOID",
      voidedAt: "2026-03-04T11:00:00.000Z",
      voidReason: "Rung up twice",
      voidedByName: "Ava Owner",
    });

    assert.equal(voided.status, "VOID");
    assert.equal(voided.voidReason, "Rung up twice");
    // The number and the tenders stay: a void is a state change, not a delete.
    assert.equal(voided.receiptNumber, 1042);
  });

  it("requires the void fields rather than letting a receipt leave them undefined", () => {
    const withoutReason: Record<string, unknown> = { ...receipt };
    delete withoutReason["voidReason"];

    assert.equal(saleDetailSchema.safeParse(withoutReason).success, false);
  });
});

describe("voidSaleSchema", () => {
  it("trims the reason, and carries no actor", () => {
    const parsed = voidSaleSchema.parse({ reason: "  Rung up twice  " });

    assert.equal(parsed.reason, "Rung up twice");
    // Who voided it is the token's user, so there is no field for a caller to name
    // somebody else in (ADR 0016).
    assert.equal("voidedById" in voidSaleSchema.shape, false);
    assert.equal("actorId" in voidSaleSchema.shape, false);
  });

  it("refuses a reason too short to be a record, or too long to be one", () => {
    assert.equal(voidSaleSchema.safeParse({ reason: "no" }).success, false);
    // Trimmed before the floor is measured, so whitespace cannot pad a two-letter reason.
    assert.equal(voidSaleSchema.safeParse({ reason: "  no  " }).success, false);
    assert.equal(voidSaleSchema.safeParse({ reason: "x".repeat(501) }).success, false);
    assert.equal(voidSaleSchema.safeParse({ reason: "x".repeat(500) }).success, true);
  });
});

describe("discountPercentSchema", () => {
  it("accepts a rate up to the whole line, and one that arrived as text", () => {
    assert.equal(discountPercentSchema.parse(0), 0);
    assert.equal(discountPercentSchema.parse(100), 100);
    assert.equal(discountPercentSchema.parse("12.5"), 12.5);
  });

  it("refuses a rate above the whole line, and a negative one", () => {
    // A discount above 100% would be a price the client chose in the negative.
    assert.equal(discountPercentSchema.safeParse(100.01).success, false);
    assert.equal(discountPercentSchema.safeParse(-1).success, false);
  });

  it("refuses a rate the money column could not hold", () => {
    // `Decimal(5,2)` rounds this *after* the money was computed from it, so the stored
    // rate would no longer explain the stored amount (ADR 0017).
    assert.equal(discountPercentSchema.safeParse(12.345).success, false);
    assert.equal(discountPercentSchema.safeParse(12.34).success, true);
    assert.equal(discountPercentSchema.safeParse(12.3).success, true);
  });
});

describe("saleLineInputSchema", () => {
  /** The smallest legal line, so each case below states only what it varies. */
  const line = { itemType: "SERVICE", itemId: "s1", quantity: 1 };

  it("takes a rate, and leaves it absent when nobody discounted", () => {
    assert.equal(saleLineInputSchema.parse(line).discountPercent, undefined);
    assert.equal(saleLineInputSchema.parse({ ...line, discountPercent: 10 }).discountPercent, 10);
  });

  it("still carries no price, so a rate is the only price-shaped field it takes", () => {
    // The founding rule: the request says what was sold and how many. A rate can be here
    // precisely because it is not an amount (ADR 0017).
    assert.equal("unitPrice" in saleLineInputSchema.shape, false);
    assert.equal("price" in saleLineInputSchema.shape, false);
    assert.equal("lineTotal" in saleLineInputSchema.shape, false);
  });
});

describe("saleLineSchema", () => {
  /** A receipt line, so each case below states only what it varies. */
  const stored = {
    id: "l1",
    itemType: "SERVICE",
    itemId: "s1",
    itemName: "Root colour",
    quantity: 2,
    unitPrice: "33.33",
    lineTotal: "66.66",
    discountPercent: "33.33",
    discountAmount: "33.34",
    voucherDiscountAmount: "0.00",
    netLineTotal: "66.66",
    taxAmount: "5.50",
    taxRate: "9.00",
    staffId: null,
    staffName: null,
  };

  it("carries the rate and the money that rate took off, both as strings", () => {
    const line = saleLineSchema.parse(stored);

    assert.equal(line.discountPercent, "33.33");
    assert.equal(line.discountAmount, "33.34");
  });

  it("requires them, so a discounted line cannot leave its rate undefined", () => {
    const withoutRate: Record<string, unknown> = { ...stored };
    delete withoutRate["discountPercent"];

    assert.equal(saleLineSchema.safeParse(withoutRate).success, false);
  });
});
