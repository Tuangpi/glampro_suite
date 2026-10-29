import { z } from "zod";
import { payrollSaleLineBase } from "@glampro_suite/shared";
import { conflict } from "../lib/http-error.js";

const id = z.string().min(1).max(128);
const schema = z.object({
  version: z.literal(1),
  saleId: id,
  saleLineId: id,
  itemId: id,
  itemType: z.literal("SERVICE"),
  soldAt: z.iso.datetime(),
  listUnitPrice: z.string().regex(/^(0|[1-9]\d{0,9})\.\d{2}$/),
  netLineAmount: z.literal("0.00"),
  originalQuantity: z.number().int().safe().positive(),
  coveredPackageQuantity: z.literal(0),
  category: id.nullable(),
});

/** Only wholly complimentary services with independently frozen checkout list
 * price are supported. Never use current catalogue or capture-asserted list price. */
export function resolvePayrollFocEconomics(
  line: {
    id: string;
    saleId: string;
    itemId: string;
    itemType: string;
    quantity: number;
    payrollEconomics: unknown;
  },
  soldAt: Date,
) {
  const parsed = schema.safeParse(line.payrollEconomics);
  if (
    !parsed.success ||
    parsed.data.saleLineId !== line.id ||
    parsed.data.saleId !== line.saleId ||
    parsed.data.itemId !== line.itemId ||
    line.itemType !== "SERVICE" ||
    parsed.data.originalQuantity !== line.quantity ||
    parsed.data.soldAt !== soldAt.toISOString()
  )
    throw conflict(
      "Authoritative payroll inputs unavailable: FOC_OPERATIONAL_LIST_PRICE_NOT_LOADED.",
    );
  const economics = parsed.data;
  const baseAmount = payrollSaleLineBase({
    foc: true,
    listUnitPrice: economics.listUnitPrice,
    quantity: economics.originalQuantity,
    netAmount: "0.0000",
    creditPaid: false,
    externalNetCents: null,
  })!;
  return { economics, baseAmount };
}
