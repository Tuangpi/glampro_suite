/**
 * The emailed e-receipt (TK2610-0010).
 *
 * The body is built **from the same `SaleDetail` the till printed**, so the email and
 * the paper cannot disagree: totals, GST and the salon's registration number all come
 * from stored snapshots rather than a fresh pricing pass. The only live lookup is the
 * salon's name and locale, which are presentation, not money.
 *
 * The address is the caller's (the dialog prefills the customer's saved one), so a
 * receipt can go to a partner or a shared inbox. Held carts are refused: there is no
 * receipt to send until the sale is completed.
 */
import {
  type SaleDetail,
  type SalePaymentMethod,
  type SaleReceiptEmailResult,
} from "@glampro_suite/shared";

import { sendMail } from "../lib/email.js";
import { HttpError, conflict } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";
import { getSale } from "./sale.service.js";
import { getSalonProfile } from "./settings.service.js";

/** The tenders as a customer reads them. Mirrors the till's badge labels. */
const PAYMENT_LABELS: Record<SalePaymentMethod, string> = {
  CASH: "Cash",
  CARD: "Card",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  OTHER: "Other",
  // Recorded rails (TK2610-0011): the customer recognises the name they paid with.
  PAYNOW_SGQR: "PayNow / SGQR",
  NETS: "NETS",
  GRABPAY: "GrabPay",
  ATOME: "Atome",
  // Credit spent, not money received — the receipt says so in the tender's own words.
  PACKAGE: "Package",
  PREPAID_CREDIT: "Prepaid credit",
};

/** `S$1,234.50` in the salon's own separators, matching the till's `formatPrice`. */
function money(value: string, locale: string): string {
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency: "SGD" });
  return formatter
    .formatToParts(Number(value))
    .map((part) => (part.type === "currency" ? "S$" : part.value))
    .join("");
}

function dateTime(iso: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

/** Receipt copy is salon data and customer names; escape before it reaches HTML. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

interface ReceiptSalon {
  name: string;
  gstRegistrationNumber: string | null;
  locale: string;
  timeZone: string;
}

interface ReceiptContent {
  subject: string;
  text: string;
  html: string;
}

/**
 * The GST number to print.
 *
 * Sales written before the snapshot column fall back to the salon's current number, but
 * only when the sale actually carried tax — a number beside a zero-tax sale would claim
 * a tax invoice that was never issued.
 */
function gstNumberFor(sale: SaleDetail, salon: ReceiptSalon): string | null {
  if (Number(sale.taxAmount) === 0) return null;
  return sale.gstRegistrationNumber ?? salon.gstRegistrationNumber;
}

function receiptLabel(sale: SaleDetail): string {
  return sale.receiptNumber === null ? "Number pending" : `#${sale.receiptNumber}`;
}

function lineRowsHtml(sale: SaleDetail, salon: ReceiptSalon): string {
  return sale.lines
    .map((line) => {
      const discount =
        Number(line.discountAmount) > 0
          ? `<div style="color:#6b7280;font-size:12px">Less ${Number(line.discountPercent)}%: −${escapeHtml(
              money(line.discountAmount, salon.locale),
            )}</div>`
          : "";
      return `<tr>
        <td style="padding:6px 0;vertical-align:top">${line.quantity} × ${escapeHtml(line.itemName)}${discount}</td>
        <td style="padding:6px 0;text-align:right;vertical-align:top">${escapeHtml(
          money(line.netLineTotal, salon.locale),
        )}</td>
      </tr>`;
    })
    .join("");
}

function totalRow(name: string, value: string, strong = false): string {
  const weight = strong ? "font-weight:700;" : "";
  return `<tr>
    <td style="padding:2px 0;${weight}">${escapeHtml(name)}</td>
    <td style="padding:2px 0;text-align:right;${weight}">${escapeHtml(value)}</td>
  </tr>`;
}

function totalRowsHtml(sale: SaleDetail, salon: ReceiptSalon): string {
  const paymentRows = sale.payments
    .map(
      (payment) =>
        `<tr><td style="padding:2px 0;color:#374151;font-size:12px">${escapeHtml(
          PAYMENT_LABELS[payment.method],
        )}</td><td style="padding:2px 0;text-align:right;color:#374151;font-size:12px">${escapeHtml(
          money(payment.amount, salon.locale),
        )}</td></tr>`,
    )
    .join("");

  return [
    Number(sale.discountAmount) > 0
      ? totalRow("Discounts", `−${money(sale.discountAmount, salon.locale)}`)
      : "",
    Number(sale.voucherDiscountAmount) > 0
      ? totalRow(
          `Voucher ${sale.voucherCode ?? ""}`,
          `−${money(sale.voucherDiscountAmount, salon.locale)}`,
        )
      : "",
    Number(sale.taxAmount) > 0
      ? totalRow(`Includes GST (${Number(sale.taxRate)}%)`, money(sale.taxAmount, salon.locale))
      : "",
    totalRow("Total", money(sale.totalAmount, salon.locale), true),
    totalRow("Paid", money(sale.paidAmount, salon.locale)),
    paymentRows,
    Number(sale.outstandingAmount) > 0
      ? totalRow("Outstanding", money(sale.outstandingAmount, salon.locale), true)
      : "",
  ].join("");
}

function receiptHtml(
  sale: SaleDetail,
  salon: ReceiptSalon,
  gst: string | null,
  label: string,
  when: string,
): string {
  const isVoid = sale.status === "VOID";
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;max-width:480px;margin:0 auto;font-size:14px">
    <h1 style="font-size:18px;margin:0 0 4px">${escapeHtml(salon.name)}</h1>
    ${gst ? `<div style="color:#374151">GST Reg No: ${escapeHtml(gst)}</div>` : ""}
    ${
      isVoid
        ? `<p style="border:2px solid #b91c1c;color:#b91c1c;padding:8px;font-weight:700;text-align:center">VOIDED RECEIPT</p>`
        : ""
    }
    <p style="margin:16px 0 4px"><strong>Receipt ${escapeHtml(label)}</strong></p>
    <div style="color:#374151">${escapeHtml(when)}</div>
    ${sale.customerName ? `<div style="color:#374151">Customer: ${escapeHtml(sale.customerName)}</div>` : ""}
    <div style="color:#374151">Served by: ${escapeHtml(sale.staffName ?? "—")}</div>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;border-top:1px solid #e5e7eb">${lineRowsHtml(
      sale,
      salon,
    )}</table>
    <table style="width:100%;border-collapse:collapse;margin-top:12px;border-top:1px solid #e5e7eb">${totalRowsHtml(
      sale,
      salon,
    )}</table>
    ${sale.pointsEarned > 0 ? `<p style="color:#374151">Points earned: ${sale.pointsEarned}</p>` : ""}
    ${sale.note ? `<p style="color:#374151">Note: ${escapeHtml(sale.note)}</p>` : ""}
    ${isVoid && sale.voidReason ? `<p style="color:#374151">Void reason: ${escapeHtml(sale.voidReason)}</p>` : ""}
    ${sale.refundedAt !== null ? `<p><strong>REFUND RECORDED: ${escapeHtml(money(sale.refundAmount ?? "0.00", salon.locale))}</strong><br>${escapeHtml(dateTime(sale.refundedAt, salon.locale, salon.timeZone))}<br>${escapeHtml(sale.refundReason ?? "")}</p>${sale.refundPayouts.map((payout) => `<p>${escapeHtml(PAYMENT_LABELS[payout.method])} returned: ${escapeHtml(money(payout.amount, salon.locale))}</p>`).join("")}` : ""}
    <p style="color:#6b7280;margin-top:24px">Thank you.</p>
  </div>`;
}

/**
 *
 * Exported so the copy can be asserted without a transport: the email is the one place
 * a customer sees the salon's legal identity, and a typo there is not a test detail.
 */
export function buildReceiptEmail(sale: SaleDetail, salon: ReceiptSalon): ReceiptContent {
  const label = receiptLabel(sale);
  const gst = gstNumberFor(sale, salon);
  const when = dateTime(sale.soldAt, salon.locale, salon.timeZone);
  const isVoid = sale.status === "VOID";
  const subject = `${isVoid ? "Voided receipt" : "Receipt"} ${label} — ${salon.name}`;

  const lineText = sale.lines.map((line) => {
    const discount =
      Number(line.discountAmount) > 0
        ? ` (less ${Number(line.discountPercent)}%: −${money(line.discountAmount, salon.locale)})`
        : "";
    return `${line.quantity} × ${line.itemName} — ${money(line.netLineTotal, salon.locale)}${discount}`;
  });

  const text = [
    salon.name,
    gst ? `GST Reg No: ${gst}` : null,
    isVoid ? "*** VOIDED RECEIPT ***" : null,
    "",
    `Receipt ${label}`,
    `Date: ${when}`,
    sale.customerName ? `Customer: ${sale.customerName}` : null,
    `Served by: ${sale.staffName ?? "—"}`,
    "",
    ...lineText,
    "",
    Number(sale.discountAmount) > 0
      ? `Discounts: −${money(sale.discountAmount, salon.locale)}`
      : null,
    Number(sale.voucherDiscountAmount) > 0
      ? `Voucher ${sale.voucherCode ?? ""}: −${money(sale.voucherDiscountAmount, salon.locale)}`
      : null,
    Number(sale.taxAmount) > 0
      ? `Includes GST (${Number(sale.taxRate)}%): ${money(sale.taxAmount, salon.locale)}`
      : null,
    `Total: ${money(sale.totalAmount, salon.locale)}`,
    `Paid: ${money(sale.paidAmount, salon.locale)}`,
    ...sale.payments.map(
      (payment) => `  ${PAYMENT_LABELS[payment.method]}: ${money(payment.amount, salon.locale)}`,
    ),
    Number(sale.outstandingAmount) > 0
      ? `Outstanding: ${money(sale.outstandingAmount, salon.locale)}`
      : null,
    sale.pointsEarned > 0 ? `Points earned: ${sale.pointsEarned}` : null,
    sale.note ? `Note: ${sale.note}` : null,
    isVoid && sale.voidReason ? `Void reason: ${sale.voidReason}` : null,
    sale.refundedAt !== null
      ? `REFUND RECORDED: ${money(sale.refundAmount ?? "0.00", salon.locale)} on ${dateTime(sale.refundedAt, salon.locale, salon.timeZone)} — ${sale.refundReason ?? ""}`
      : null,
    "",
    "Thank you.",
    ...sale.refundPayouts.map(
      (payout) =>
        `${PAYMENT_LABELS[payout.method]} returned: ${money(payout.amount, salon.locale)}`,
    ),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return { subject, text, html: receiptHtml(sale, salon, gst, label, when) };
}

/**
 * `POST /api/sales/:id/receipt/email` — sends the receipt and answers where it went.
 *
 * A held cart has no receipt, so it is a 409 rather than an empty email. A provider
 * failure becomes `503 EMAIL_SEND_FAILED`: resending is safe and is what the cashier
 * should try, so the response must not read like a permanent refusal.
 */
export async function emailSaleReceipt(
  saleId: string,
  email: string,
): Promise<SaleReceiptEmailResult> {
  const sale = await getSale(saleId);

  if (sale.status === "HELD") {
    throw conflict(
      "A parked cart has no receipt yet. Complete the sale first.",
      "SALE_NOT_COMPLETED",
    );
  }

  const profile = await getSalonProfile();
  const content = buildReceiptEmail(sale, profile);

  try {
    const { messageId } = await sendMail({ to: email, ...content });
    logger.info("Sale receipt emailed", {
      saleId: sale.id,
      receiptNumber: sale.receiptNumber,
      to: email,
      messageId,
    });
    return { sent: true, to: email, messageId };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    logger.warn("Sale receipt email failed", {
      saleId: sale.id,
      receiptNumber: sale.receiptNumber,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new HttpError(503, "The receipt could not be emailed. Check the address and try again.", {
      code: "EMAIL_SEND_FAILED",
      cause: error,
    });
  }
}
