/**
 * Sale vocabulary — the words for the till's category tabs and tenders.
 *
 * One place for both, for the same reason `constants/staff.ts` holds the role
 * labels: the item grid, the cart and the receipt must not each invent their own
 * label for `VALUE_PACKAGE`. The lists are derived from the contract's own
 * constants (`SALE_ITEM_KINDS`, `PAYMENT_METHODS`) rather than re-typed, so a
 * code added to the contract is a TypeScript error here instead of a tab nobody
 * can name.
 */
import type { BadgeVariant } from "@/components/ui/Badge";
import {
  PAYMENT_METHODS,
  SALE_ITEM_KINDS,
  type SaleItemKind,
  type SalePaymentMethod,
} from "@glampro_suite/shared";

export const SALE_KIND_LABELS: Record<SaleItemKind, string> = {
  SERVICE: "Services",
  PRODUCT: "Products",
  PACKAGE: "Packages",
  VALUE_PACKAGE: "Value packages",
  GIFT_CARD: "Gift cards",
};

/** The tab row's order, which is the contract's own order (SALE_ITEM_KINDS). */
export const SALE_KIND_TABS = SALE_ITEM_KINDS.map((kind) => ({
  value: kind,
  label: SALE_KIND_LABELS[kind],
}));

export const PAYMENT_METHOD_LABELS: Record<SalePaymentMethod, string> = {
  CASH: "Cash",
  CARD: "Card",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  OTHER: "Other",
  // Local rails (TK2610-0011 / ADR 0019). Recorded by the cashier, not acquired: the
  // dialog says so, so nobody expects a QR to appear.
  PAYNOW_SGQR: "PayNow / SGQR",
  NETS: "NETS",
  GRABPAY: "GrabPay",
  ATOME: "Atome",
  // Credit the customer already holds, not money handed over now.
  PACKAGE: "Package",
  PREPAID_CREDIT: "Prepaid credit",
};

/** For the tender `<Select>`; every tender in the contract's own order. */
export const PAYMENT_METHOD_OPTIONS = PAYMENT_METHODS.map((method) => ({
  value: method,
  label: PAYMENT_METHOD_LABELS[method],
}));

/**
 * Tender-to-tone for the receipt. The common pair reads purple, the rare recorded
 * rails read neutral, and the two redemption tenders read `success` — the receipt
 * should show at a glance that part of the bill was settled with credit rather than
 * cash. The colour repeats what the label already says rather than carrying the
 * meaning, which is why every badge also renders its own text.
 */
export const PAYMENT_METHOD_BADGE: Record<SalePaymentMethod, BadgeVariant> = {
  CASH: "purple",
  CARD: "purple",
  BANK_TRANSFER: "neutral",
  CHEQUE: "neutral",
  OTHER: "neutral",
  PAYNOW_SGQR: "neutral",
  NETS: "neutral",
  GRABPAY: "neutral",
  ATOME: "neutral",
  PACKAGE: "success",
  PREPAID_CREDIT: "success",
};

/**
 * The roles that may void a sale.
 *
 * A mirror of the API's `requireRole("SUPER_ADMIN", "MANAGER")`, and only ever used to
 * *hide* an action: the server is what enforces it. A cashier offered a button that
 * always 403s is worse than one offered nothing (ADR 0016).
 */
export const VOID_SALE_ROLES: readonly string[] = ["SUPER_ADMIN", "MANAGER"];
