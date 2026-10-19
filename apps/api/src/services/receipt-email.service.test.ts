/**
 * The emailed e-receipt's copy (TK2610-0010).
 *
 * These assertions are about what a customer reads, not about a transport: the email is
 * the one place the salon's legal identity is shown outside the till, so the GST number's
 * provenance is the thing worth pinning down.
 *
 * - A sale that **snapshotted** a number keeps it, even after the salon changes its
 *   settings — the copy must agree with the paper that was handed over.
 * - A sale written **before** the column existed falls back to the salon's current
 *   number, but only when it actually carried tax: a number beside a zero-tax sale would
 *   claim a tax invoice that was never issued.
 *
 * `buildReceiptEmail` is exported for exactly this; no database is queried, but the
 * import chain reaches `env`, so the two required variables are defaulted the way the
 * other suites do.
 */
import "dotenv/config";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SaleDetail } from "@glampro_suite/shared";

process.env.DATABASE_URL ??= "postgresql://glampro:glampro@127.0.0.1:5432/glampro_test";
process.env.JWT_SECRET ??= "receipt-email-test-secret";
process.env.NODE_ENV = "test";

const { buildReceiptEmail } = await import("./receipt-email.service.js");

/** A completed, fully paid sale: one cut at 50.00 with 9% GST inside it. */
function sale(overrides: Partial<SaleDetail> = {}): SaleDetail {
  return {
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
    totalAmount: "50.00",
    paidAmount: "50.00",
    discountAmount: "0.00",
    taxAmount: "4.13",
    taxRate: "9.00",
    gstRegistrationNumber: "GST-200012345",
    outstandingAmount: "0.00",
    pointsEarned: 5,
    lines: [
      {
        id: "l1",
        itemType: "SERVICE",
        itemId: "s1",
        itemName: "Aloha Cut",
        quantity: 1,
        unitPrice: "50.00",
        lineTotal: "50.00",
        discountPercent: "0.00",
        discountAmount: "0.00",
        taxAmount: "4.13",
        taxRate: "9.00",
        staffId: null,
        staffName: null,
      },
    ],
    payments: [{ method: "CASH", amount: "50.00", sessionId: null }],
    ...overrides,
  };
}

const SALON = {
  name: "Aloha Salon",
  gstRegistrationNumber: "GST-NEW-999",
  locale: "en-SG",
  timeZone: "Asia/Singapore",
};

describe("the emailed receipt", () => {
  it("prints the sale's own GST number, not the salon's current one", () => {
    const email = buildReceiptEmail(sale(), SALON);

    assert.match(email.text, /GST Reg No: GST-200012345/);
    assert.doesNotMatch(email.text, /GST-NEW-999/);
    assert.match(email.html, /GST Reg No: GST-200012345/);
    assert.doesNotMatch(email.html, /GST-NEW-999/);
  });

  it("falls back to the salon's number for a pre-snapshot sale that carried tax", () => {
    const email = buildReceiptEmail(sale({ gstRegistrationNumber: null }), SALON);

    assert.match(email.text, /GST Reg No: GST-NEW-999/);
    assert.match(email.html, /GST Reg No: GST-NEW-999/);
  });

  it("prints no number at all when the sale carried no tax", () => {
    const email = buildReceiptEmail(
      sale({ gstRegistrationNumber: null, taxAmount: "0.00", taxRate: "0.00" }),
      SALON,
    );

    assert.doesNotMatch(email.text, /GST Reg No/);
    assert.doesNotMatch(email.html, /GST Reg No/);
    assert.doesNotMatch(email.text, /Includes GST/);
  });

  it("carries the receipt's own figures and says when one was voided", () => {
    const email = buildReceiptEmail(
      sale({
        status: "VOID",
        voidReason: "Rung up twice",
        voidedAt: "2026-03-04T10:30:00.000Z",
        voidedByName: "Ava Owner",
      }),
      SALON,
    );

    assert.match(email.subject, /^Voided receipt #1042/);
    assert.match(email.text, /\*\*\* VOIDED RECEIPT \*\*\*/);
    assert.match(email.text, /Void reason: Rung up twice/);
    assert.match(email.html, /VOIDED RECEIPT/);
    assert.match(email.text, /Total: S\$50\.00/);
    assert.match(email.text, /Includes GST \(9%\): S\$4\.13/);
  });

  it("escapes salon and line copy before it reaches the HTML", () => {
    const email = buildReceiptEmail(
      sale({
        lines: [
          {
            ...sale().lines[0]!,
            itemName: '<b>Cut & blow</b> "deluxe"',
          },
        ],
      }),
      { ...SALON, name: "<script>alert(1)</script>" },
    );

    assert.doesNotMatch(email.html, /<script>/);
    assert.doesNotMatch(email.html, /<b>Cut/);
    assert.match(email.html, /&lt;script&gt;/);
    assert.match(email.html, /&lt;b&gt;Cut &amp; blow&lt;\/b&gt;/);
  });
});
