import { z } from "zod";
import {
  allocatePayrollSplit,
  commissionSharesSchema,
  payrollBaseLineSchema,
} from "@glampro_suite/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { conflict } from "../lib/http-error.js";
import { payrollInputHash } from "./payroll-close-state.js";

const purchaseSchema = z.object({
  version: z.literal(1),
  saleId: z.string().min(1),
  saleLineId: z.string().min(1),
  currency: z.literal("SGD"),
  paidNet: z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/),
  credit: z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/),
  sellers: commissionSharesSchema,
});
const fail = (): never => {
  throw conflict("Authoritative payroll inputs unavailable: VALUE_PURCHASE_EVIDENCE_UNCONFIRMED.");
};
export function verifyPayrollValuePurchase(
  holdings: {
    tenantId: string;
    saleLineId: string | null;
    valuePackageId: string;
    amount: Prisma.Decimal;
    payrollPurchaseSnapshot: unknown;
  }[],
  line: { id: string; saleId: string; itemId: string; quantity: number; attribution: unknown },
  tenantId: string,
  netCents: bigint,
) {
  if (holdings.length !== 1) return fail();
  const holding = holdings[0];
  const parsed = purchaseSchema.safeParse(holding.payrollPurchaseSnapshot);
  const sellers = z.object({ sellers: commissionSharesSchema }).safeParse(line.attribution);
  if (!parsed.success || !sellers.success) return fail();
  const purchase = parsed.data;
  if (
    holding.tenantId !== tenantId ||
    holding.saleLineId !== line.id ||
    holding.valuePackageId !== line.itemId ||
    purchase.saleId !== line.saleId ||
    purchase.saleLineId !== line.id ||
    !new Prisma.Decimal(purchase.paidNet).mul(100).equals(netCents.toString()) ||
    !holding.amount.equals(purchase.credit) ||
    !holding.amount.isPositive() ||
    !Number.isSafeInteger(line.quantity) ||
    line.quantity <= 0 ||
    payrollInputHash(purchase.sellers) !== payrollInputHash(sellers.data.sellers)
  )
    return fail();
  return purchase;
}

/** Commission is on externally collected net cash, not the granted credit face value.
 * Unit activity belongs only to the first collection; later instalments add no units. */
export function verifyPayrollValueCollection(
  evidence: unknown,
  netCents: bigint,
  units: string,
  sellers: z.infer<typeof commissionSharesSchema>,
) {
  const parsed = z.object({ lines: z.array(payrollBaseLineSchema) }).safeParse(evidence);
  if (!parsed.success) return fail();
  const bases = allocatePayrollSplit(
    new Prisma.Decimal(netCents.toString()).div(100).toFixed(4),
    sellers,
  );
  const quantities = allocatePayrollSplit(units, sellers);
  if (
    parsed.data.lines.length !== bases.length ||
    new Set(parsed.data.lines.map((row) => row.staffId)).size !== bases.length ||
    parsed.data.lines.some(
      (row) =>
        row.commissionType !== "VP_SALE" ||
        row.mode !== "FOLLOW_PLAN" ||
        row.fixedCommission !== undefined ||
        (row.productCategory ?? null) !== null ||
        row.baseAmount !== bases.find((part) => part.staffId === row.staffId)?.amount ||
        row.units !== quantities.find((part) => part.staffId === row.staffId)?.amount,
    )
  )
    return fail();
}
