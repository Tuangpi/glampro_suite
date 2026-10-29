import { z } from "zod";
import {
  allocatePayrollSplit,
  capturePayrollPackagePurchase,
  commissionSharesSchema,
  payrollBaseLineSchema,
  payrollFixedSaleAward,
  payrollPackageSettingsSchema,
} from "@glampro_suite/shared";
import { conflict } from "../lib/http-error.js";
import { packagePurchaseValue } from "../lib/package-valuation.js";
import { payrollInputHash } from "./payroll-close-state.js";

const purchaseSchema = z.object({
  saleId: z.string(),
  saleLineId: z.string(),
  packageId: z.string(),
  originalCustomerId: z.string(),
  outletId: z.string().nullable(),
  purchasedAt: z.string(),
  currency: z.literal("SGD"),
  grantedSessions: z.number(),
  grossCents: z.string(),
  netCents: z.string(),
  taxCents: z.string(),
  sellers: commissionSharesSchema,
  commissionSettings: payrollPackageSettingsSchema,
});
const fail = (): never => {
  throw conflict(
    "Authoritative payroll inputs unavailable: PACKAGE_PURCHASE_EVIDENCE_UNCONFIRMED.",
  );
};

/** Original grant and policy only; current catalogue, owner, balance and expiry
 * cannot reconstruct the purchase. */
export function verifyPayrollPackagePurchase(
  holdings: {
    tenantId: string;
    saleLineId: string | null;
    packageId: string;
    quantity: number;
    payrollPurchaseSnapshot: unknown;
  }[],
  line: {
    id: string;
    saleId: string;
    itemId: string;
    quantity: number;
    attribution: unknown;
    lineTotal: { toFixed(n: number): string };
    voucherDiscountAmount: { toFixed(n: number): string };
    taxAmount: { toFixed(n: number): string };
  },
  sale: { id: string; customerId: string | null; outletId: string | null; soldAt: Date },
  tenantId: string,
) {
  if (holdings.length !== 1) return fail();
  const holding = holdings[0];
  const parsed = purchaseSchema.safeParse(holding.payrollPurchaseSnapshot);
  const attribution = z.object({ sellers: commissionSharesSchema }).safeParse(line.attribution);
  if (!parsed.success || !attribution.success) return fail();
  const input = parsed.data;
  let purchase;
  try {
    purchase = capturePayrollPackagePurchase(input);
  } catch {
    return fail();
  }
  const economics = packagePurchaseValue(
    line.lineTotal.toFixed(2),
    line.voucherDiscountAmount.toFixed(2),
    line.taxAmount.toFixed(2),
  );
  if (
    payrollInputHash(purchase) !== payrollInputHash(holding.payrollPurchaseSnapshot) ||
    holding.tenantId !== tenantId ||
    holding.saleLineId !== line.id ||
    holding.packageId !== line.itemId ||
    input.saleId !== sale.id ||
    line.saleId !== sale.id ||
    input.saleLineId !== line.id ||
    input.packageId !== line.itemId ||
    input.originalCustomerId !== sale.customerId ||
    input.outletId !== sale.outletId ||
    input.purchasedAt !== sale.soldAt.toISOString() ||
    holding.quantity !== input.grantedSessions ||
    !Number.isSafeInteger(line.quantity) ||
    line.quantity <= 0 ||
    input.grossCents !== economics.grossCents.toString() ||
    input.netCents !== economics.netCents.toString() ||
    input.taxCents !== economics.taxCents.toString() ||
    payrollInputHash(purchase.sellers) !==
      payrollInputHash(
        [...attribution.data.sellers].sort((a, b) => a.staffId.localeCompare(b.staffId)),
      )
  )
    return fail();
  return { ...purchase, sellers: input.sellers, commissionSettings: input.commissionSettings };
}

export function verifyPayrollPackageCollection(
  evidence: unknown,
  purchase: ReturnType<typeof verifyPayrollPackagePurchase>,
  quantity: number,
  netCents: bigint,
  priorCollections: number,
) {
  const parsed = z.object({ lines: z.array(payrollBaseLineSchema) }).safeParse(evidence);
  if (!parsed.success) return fail();
  const decimal = (cents: string) =>
    `${BigInt(cents) / 100n}.${(BigInt(cents) % 100n).toString().padStart(2, "0")}00`;
  const bases = allocatePayrollSplit(decimal(netCents.toString()), purchase.sellers);
  const units = allocatePayrollSplit(
    priorCollections === 0 ? `${quantity}.0000` : "0.0000",
    purchase.sellers,
  );
  const policy = purchase.commissionSettings.sale;
  const awards =
    policy.mode === "FIXED"
      ? allocatePayrollSplit(
          payrollFixedSaleAward(policy.amount, priorCollections),
          purchase.sellers,
        )
      : [];
  if (
    parsed.data.lines.length !== bases.length ||
    new Set(parsed.data.lines.map((row) => row.staffId)).size !== bases.length ||
    parsed.data.lines.some(
      (row) =>
        row.commissionType !== "PKG_SALE" ||
        row.mode !== policy.mode ||
        row.fixedCommission !== awards.find((part) => part.staffId === row.staffId)?.amount ||
        (row.productCategory ?? null) !== null ||
        row.baseAmount !== bases.find((part) => part.staffId === row.staffId)?.amount ||
        row.units !== units.find((part) => part.staffId === row.staffId)?.amount,
    )
  )
    return fail();
}
