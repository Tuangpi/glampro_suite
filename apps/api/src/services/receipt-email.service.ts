/**
 * The emailed e-receipt (TK2610-0010).
 *
 * The body is built **from the same `SaleDetail` the till printed**, so the email and
 * the paper cannot disagree: totals, GST and the salon's registration number all come
 * from stored snapshots rather than a fresh pricing pass. Company branding and the
 * sale outlet's public contact details are current presentation data, not money.
 *
 * The address is the caller's (the dialog prefills the customer's saved one), so a
 * receipt can go to a partner or a shared inbox. Held carts are refused: there is no
 * receipt to send until the sale is completed.
 */
import {
  renderCustomerReceipt,
  CUSTOMER_RECEIPT_CSS,
  type SaleDetail,
  type SalePaymentMethod,
  type SaleReceiptEmailResult,
} from "@glampro_suite/shared";

import { sendMail } from "../lib/email.js";
import { HttpError, conflict } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";
import { publicOrigin } from "../lib/messaging-provider.js";
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

interface ReceiptSalon {
  name: string;
  gstRegistrationNumber: string | null;
  locale: string;
  timeZone: string;
  /**
   * Absolute URL of the salon's logo, or `null` when the salon has none or the
   * deployment has no public origin. Optional so `buildReceiptEmail` stays callable
   * from a test (and from any future caller) without inventing one.
   */
  logoUrl?: string | null;
}

interface ReceiptContent {
  subject: string;
  text: string;
  html: string;
}

/**
 * The GST number to print.
 *
 * Match print and public links: never substitute today's registration for missing history.
 */
function gstNumberFor(sale: SaleDetail): string | null {
  return Number(sale.taxAmount) > 0 ? sale.gstRegistrationNumber : null;
}

export function buildReceiptEmail(sale: SaleDetail, salon: ReceiptSalon): ReceiptContent {
  const label = sale.receiptNumber === null ? "(number pending)" : `#${sale.receiptNumber}`;
  const gst = gstNumberFor(sale);
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
    sale.receiptOutlet?.name ?? null,
    sale.receiptOutlet?.address ?? null,
    sale.receiptOutlet?.phone ? `Tel: ${sale.receiptOutlet.phone}` : null,
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

  return {
    subject,
    text,
    html: `<style>${CUSTOMER_RECEIPT_CSS}</style>${renderCustomerReceipt(sale, salon)}`,
  };
}

/**
 * The salon logo as an absolute URL, or `null`.
 *
 * `getSalonProfile()` hands back a relative path, which a mail client cannot resolve
 * against anything. Absent rather than fatal in two cases: the salon has no logo, or
 * the deployment has no `MESSAGING_PUBLIC_ORIGIN` — `publicOrigin()` throws 503 for
 * that, and a missing image must never be the reason a customer does not get their
 * receipt.
 */
function absoluteLogoUrl(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  try {
    return new URL(logoUrl, `${publicOrigin()}/`).toString();
  } catch {
    return null;
  }
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
  const content = buildReceiptEmail(sale, {
    ...profile,
    logoUrl: absoluteLogoUrl(profile.logoUrl),
  });

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
