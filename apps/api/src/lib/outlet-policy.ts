import { currentOutletId } from "./tenant-context.js";

/** Customer identity, credit, family groups, staff and stock remain tenant-wide. */
export function outletPredicate(model: string): Record<string, unknown> | undefined {
  const outletId = currentOutletId();
  if (!outletId) return undefined;
  if (model === "Product" || model === "Package") {
    return { OR: [{ outletId: null }, { outletId }] };
  }
  if (model === "Sale") return { outletId };
  if (
    ["SaleLine", "SalePayment", "SaleRefund", "EmployeePerformance", "EmployeeCommission"].includes(
      model,
    )
  ) {
    return { sale: { outletId } };
  }
  return undefined;
}
