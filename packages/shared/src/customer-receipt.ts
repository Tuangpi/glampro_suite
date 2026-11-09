import type { SaleDetail, SalePaymentMethod } from "./schemas/sales.js";

export interface ReceiptCompany {
  name: string;
  logoUrl?: string | null;
  locale: string;
  timeZone: string;
}

const PAYMENT_LABELS: Record<SalePaymentMethod, string> = {
  CASH: "Cash",
  CARD: "Card",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  OTHER: "Other",
  PAYNOW_SGQR: "PayNow / SGQR",
  NETS: "NETS",
  GRABPAY: "GrabPay",
  ATOME: "Atome",
  PACKAGE: "Package",
  PREPAID_CREDIT: "Prepaid credit",
};

/** All interpolated data is escaped; no notes, contacts or payment references are exposed. */
function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cents(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
}

/** One scoped stylesheet for POS, public links and email. No application branding. */
export const CUSTOMER_RECEIPT_CSS = `
.customer-receipt{box-sizing:border-box;width:100%;max-width:720px;margin:0 auto;padding:28px;background:#fff;color:#171717;font:14px/1.5 Arial,Helvetica,sans-serif;overflow-wrap:anywhere}
.customer-receipt *{box-sizing:border-box;min-width:0}
.customer-receipt header{text-align:center;padding-bottom:20px;border-bottom:1px solid #ddd}
.customer-receipt .receipt-logo{display:block;object-fit:contain;max-width:120px;max-height:64px;margin:0 auto 10px}
.customer-receipt .receipt-company{font-size:22px;font-weight:700;margin:0 0 6px}
.customer-receipt h2{font-size:18px;margin:16px 0 4px}
.customer-receipt p{margin:4px 0}
.customer-receipt .receipt-meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;padding:14px 0}
.customer-receipt table{width:100%;border-collapse:collapse;font:inherit;table-layout:fixed}
.customer-receipt th,.customer-receipt td{padding:10px 0;vertical-align:top;text-align:left;border-bottom:1px solid #eee}
.customer-receipt th{font-size:12px;color:#555}
.customer-receipt .receipt-qty{width:12%;text-align:center}
.customer-receipt .receipt-amount{width:30%;text-align:right;font-variant-numeric:tabular-nums;padding-left:8px}
.customer-receipt .receipt-unit{display:block;font-size:12px;color:#555}
.customer-receipt dl{margin:16px 0 0}
.customer-receipt dl>div{display:flex;justify-content:space-between;gap:16px;padding:5px 0}
.customer-receipt dt,.customer-receipt dd{margin:0}
.customer-receipt dd{text-align:right;font-variant-numeric:tabular-nums}
.customer-receipt .receipt-total{border-top:1px solid #333;margin-top:8px;padding-top:12px;font-size:20px;font-weight:700}
.customer-receipt .receipt-evidence{margin:12px 0;padding:10px;border:1px solid #555;text-align:left;break-inside:avoid}
.customer-receipt footer{text-align:center;margin-top:20px;border-top:1px solid #ddd;padding-top:14px}
@media(max-width:480px){.customer-receipt{padding:16px;font-size:13px}}
@media print{.customer-receipt{max-width:none;padding:2mm;color:#000}.customer-receipt tr,.customer-receipt dl>div{break-inside:avoid}}
`;

/** The same customer-safe document is used by the POS, public link and email. */
export function renderCustomerReceipt(sale: SaleDetail, company: ReceiptCompany): string {
  const money = (value: string) =>
    new Intl.NumberFormat(company.locale, { style: "currency", currency: "SGD" })
      .formatToParts(Number(value))
      .map((part) => (part.type === "currency" ? "S$" : part.value))
      .join("");
  const when = (iso: string) =>
    new Intl.DateTimeFormat(company.locale, {
      timeZone: company.timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  const row = (label: string, value: string, className = "") =>
    `<div class="${className}"><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`;
  const outlet = sale.receiptOutlet;
  // Allow only local paths or HTTPS images; never attributes or executable URL schemes.
  const logo =
    company.logoUrl && (/^\/(?!\/)/.test(company.logoUrl) || /^https:\/\//i.test(company.logoUrl))
      ? company.logoUrl
      : null;
  const change = cents(sale.paidAmount) - cents(sale.totalAmount);
  const changeValue = `${change / 100n}.${(change % 100n).toString().padStart(2, "0")}`;
  return `<article class="customer-receipt" aria-label="Customer receipt">
    <header>
      ${logo ? `<img class="receipt-logo" src="${escape(logo)}" alt="${escape(company.name)}">` : ""}
      ${company.name ? `<p class="receipt-company">${escape(company.name)}</p>` : ""}
      ${outlet ? `<p>${escape(outlet.name)}</p>${outlet.address ? `<p>${escape(outlet.address)}</p>` : ""}${outlet.phone ? `<p>Tel: ${escape(outlet.phone)}</p>` : ""}` : ""}
      ${cents(sale.taxAmount) > 0n && sale.gstRegistrationNumber ? `<p>GST registration no.: ${escape(sale.gstRegistrationNumber)}</p>` : ""}
      <h2>${sale.receiptNumber === null ? "Receipt — number pending" : `Receipt #${sale.receiptNumber}`}</h2>
      <p>${escape(when(sale.soldAt))}</p>
      ${sale.status === "VOID" ? `<div class="receipt-evidence" role="status"><strong>Void</strong><p>VOIDED RECEIPT</p>${sale.voidedAt ? `<p>${escape(when(sale.voidedAt))}</p>` : ""}<p>${escape(sale.voidReason ?? "No reason was recorded.")}</p><p>A void does not return money.</p></div>` : ""}
      ${sale.refundedAt ? `<div class="receipt-evidence" role="status"><strong>Refund recorded</strong><p>${escape(money(sale.refundAmount ?? "0.00"))} · ${escape(when(sale.refundedAt))}</p><p>${escape(sale.refundReason ?? "")}</p>${sale.refundPayouts.map((payout) => `<p>${escape(PAYMENT_LABELS[payout.method])} returned: ${escape(money(payout.amount))}</p>`).join("")}</div>` : ""}
    </header>
    <div class="receipt-meta"><span>Customer: ${escape(sale.customerName ?? "Walk-in")}</span><span>${sale.status === "VOID" ? "Voided" : sale.refundedAt ? "Refunded" : cents(sale.outstandingAmount) > 0n ? "Outstanding balance" : sale.paymentStatus === "PAID" ? "Paid" : "Outstanding"}</span></div>
    <section class="receipt-items" aria-label="Items sold"><table><thead><tr><th>Item</th><th class="receipt-qty">Qty</th><th class="receipt-amount">Amount</th></tr></thead><tbody>${sale.lines.map((line) => `<tr><td><span class="receipt-item-name">${escape(line.itemName)}</span><span class="receipt-unit">${escape(money(line.unitPrice))} each</span></td><td class="receipt-qty">${line.quantity}</td><td class="receipt-amount">${escape(money(line.netLineTotal))}</td></tr>`).join("")}</tbody></table></section>
    <section class="receipt-payment" aria-label="Payment summary"><dl>
      ${cents(sale.discountAmount) > 0n ? row("Discount", `−${money(sale.discountAmount)}`) : ""}
      ${cents(sale.voucherDiscountAmount) > 0n ? row(`Voucher${sale.voucherCode ? ` ${sale.voucherCode}` : ""}`, `−${money(sale.voucherDiscountAmount)}`) : ""}
      ${row("Total", money(sale.totalAmount), "receipt-total")}
      ${cents(sale.taxAmount) > 0n ? row(`Includes GST (${Number(sale.taxRate)}%)`, money(sale.taxAmount)) : ""}
      ${row("Tendered", money(sale.paidAmount))}
      ${sale.payments.map((payment) => row(PAYMENT_LABELS[payment.method], money(payment.amount))).join("")}
      ${sale.status !== "VOID" ? (cents(sale.outstandingAmount) > 0n ? row("Outstanding", money(sale.outstandingAmount)) : change >= 0n ? row("Change", money(changeValue)) : "") : ""}
      ${sale.pointsEarned > 0 ? row("Points earned", String(sale.pointsEarned)) : ""}
    </dl></section>
    <footer>Thank you for your visit.</footer>
  </article>`;
}

export function renderCustomerReceiptPage(sale: SaleDetail, company: ReceiptCompany): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${escape(company.name)} — Receipt${sale.receiptNumber === null ? "" : ` #${sale.receiptNumber}`}</title><style>${CUSTOMER_RECEIPT_CSS}body{margin:0;background:#f4f4f5}@media print{body{background:#fff}}</style></head><body>${renderCustomerReceipt(sale, company)}</body></html>`;
}
