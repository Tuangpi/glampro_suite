import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SaleDetail } from "./schemas/sales.js";
import { renderCustomerReceipt, renderCustomerReceiptPage } from "./customer-receipt.js";
const sale: SaleDetail = {
  id: "sale-1",
  receiptNumber: 1042,
  status: "COMPLETED",
  paymentStatus: "PAID",
  soldAt: "2026-10-24T04:00:00.000Z",
  customerId: null,
  customerName: null,
  staffId: "owner",
  staffName: "Owner",
  note: "Customer note",
  voidedAt: null,
  voidReason: null,
  voidedByName: null,
  totalQuantity: 1,
  totalAmount: "80.00",
  paidAmount: "80.00",
  discountAmount: "10.00",
  taxAmount: "6.61",
  taxRate: "9.00",
  gstRegistrationNumber: "GST-SNAPSHOT-123",
  voucherCode: "WELCOME",
  voucherDiscountAmount: "5.00",
  refundedAt: null,
  refundAmount: null,
  refundReason: null,
  refundedByName: null,
  refundRestocked: null,
  refundPayouts: [],
  outstandingAmount: "0.00",
  pointsEarned: 5,
  lines: [
    {
      id: "line-1",
      itemType: "SERVICE",
      itemId: "service-1",
      itemName:
        "A very long treatment description that must wrap rather than disappear from the receipt",
      quantity: 1,
      unitPrice: "95.00",
      lineTotal: "85.00",
      discountPercent: "0.00",
      discountAmount: "10.00",
      voucherDiscountAmount: "5.00",
      netLineTotal: "80.00",
      taxAmount: "6.61",
      taxRate: "9.00",
      staffId: null,
      staffName: null,
    },
  ],
  payments: [
    { method: "CASH", amount: "30.00", sessionId: null },
    { method: "NETS", amount: "50.00", sessionId: null },
  ],
};

const company = { name: "Aloha Company", locale: "en-SG", timeZone: "Asia/Singapore" };
describe("common customer receipt", () => {
  it("omits the logo and initials when no logo is uploaded", () => {
    for (const logoUrl of [undefined, null, "", "javascript:alert(1)"]) {
      const body = renderCustomerReceipt(sale, { ...company, logoUrl });
      assert.doesNotMatch(body, /<img|receipt-initials/);
      assert.match(body, /class="receipt-company">Aloha Company/);
    }
  });
  it("still displays an uploaded company logo", () => {
    const body = renderCustomerReceipt(sale, {
      ...company,
      logoUrl: "/api/public/tenants/aloha/logo",
    });
    assert.match(body, /<img class="receipt-logo" src="\/api\/public\/tenants\/aloha\/logo"/);
  });
  it("embeds the identical receipt body in the public page", () => {
    const body = renderCustomerReceipt(sale, company);
    assert.ok(renderCustomerReceiptPage(sale, company).includes(body));
    assert.doesNotMatch(body, /Glampro|Customer note|Owner/);
    assert.ok(body.indexOf('class="receipt-items"') < body.indexOf('class="receipt-payment"'));
  });
  it("uses only the sale outlet public contacts and escapes company data", () => {
    const body = renderCustomerReceipt(
      {
        ...sale,
        receiptOutlet: { name: "Original outlet", address: "10 <Main> Street", phone: "12345678" },
      },
      { ...company, name: "Aloha <Company>", logoUrl: "javascript:alert(1)" },
    );
    assert.match(body, /Original outlet/);
    assert.match(body, /10 &lt;Main&gt; Street/);
    assert.match(body, /Tel: 12345678/);
    assert.match(body, /Aloha &lt;Company&gt;/);
    assert.doesNotMatch(body, /javascript:|<Company>/);
  });
  it("keeps stored GST, split tenders and refund payouts", () => {
    const body = renderCustomerReceipt(
      {
        ...sale,
        refundedAt: sale.soldAt,
        refundAmount: "80.00",
        refundReason: "Returned <goods>",
        refundPayouts: [{ method: "CASH", amount: "80.00" }],
      },
      company,
    );
    assert.match(body, /GST-SNAPSHOT-123/);
    assert.match(body, /Cash/);
    assert.match(body, /NETS/);
    assert.match(body, /Cash returned: S\$80.00/);
    assert.match(body, /Returned &lt;goods&gt;/);
    assert.doesNotMatch(body, /Customer note/);
  });
  it("does not invent outlet details or GST for legacy receipts", () => {
    const body = renderCustomerReceipt(
      { ...sale, receiptOutlet: null, gstRegistrationNumber: null },
      company,
    );
    assert.doesNotMatch(body, /Tel:|GST registration no\./);
  });
});
