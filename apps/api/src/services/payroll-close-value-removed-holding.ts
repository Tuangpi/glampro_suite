import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";
import { SALE_VOID_PURCHASE_HOLDINGS_ACTION } from "./sale-void-purchase-evidence.js";
import { payrollInputHash } from "./payroll-close-state.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

type HoldingRow = NonNullable<
  Awaited<ReturnType<PayrollCloseTransaction["customerValuePackageHolding"]["findFirst"]>>
>;

const id = z.string().min(1);
const money = z.string().regex(/^(0|[1-9]\d*)(?:\.\d{1,2})?$/);
/** The row as the void writer serialized it: Decimals and Dates arrive as JSON. */
const creditSchema = z
  .object({
    id,
    tenantId: id,
    customerId: id,
    valuePackageId: id,
    saleLineId: id,
    amount: money,
    amountRemaining: money,
    expiresAt: z.iso.datetime().nullable(),
    familyId: z.null(),
    sharedFamilyId: z.null(),
    updatedBy: z.string().nullable(),
    updatedAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    payrollPurchaseSnapshot: z.unknown().refine((value) => value !== undefined && value !== null),
  })
  .passthrough();
type Snapshot = { tenantId?: unknown; saleId?: unknown; credits?: unknown };

const revive = (row: z.infer<typeof creditSchema>): HoldingRow => ({
  id: row.id,
  tenantId: row.tenantId,
  customerId: row.customerId,
  valuePackageId: row.valuePackageId,
  saleLineId: row.saleLineId,
  amount: new Prisma.Decimal(row.amount),
  amountRemaining: new Prisma.Decimal(row.amountRemaining),
  expiresAt: row.expiresAt === null ? null : new Date(row.expiresAt),
  familyId: null,
  sharedFamilyId: null,
  updatedBy: row.updatedBy,
  updatedAt: new Date(row.updatedAt),
  createdAt: new Date(row.createdAt),
  payrollPurchaseSnapshot: row.payrollPurchaseSnapshot as Prisma.JsonValue,
});

/** Rebuilds a purchase's deleted credit holdings from the pre-deletion snapshot the void
 * writer recorded. Only a hash-verified snapshot whose purchase is actually VOID and whose
 * credit rows are all gone qualifies; anything else returns null so the caller keeps its
 * generic refusal. Revived values are the deleted rows' own, never recomputed. */
export async function findValueHoldingRemovedByPurchaseVoid(
  tx: PayrollCloseTransaction,
  tenantId: string,
  holdingId: string,
): Promise<{ holding: HoldingRow; credits: HoldingRow[] } | null> {
  const audits = await tx.auditLog.findMany({
    where: { tenantId, action: SALE_VOID_PURCHASE_HOLDINGS_ACTION, targetType: "Sale" },
    orderBy: { id: "asc" },
  });
  for (const audit of audits) {
    if (!audit.targetId) continue;
    const metadata = audit.metadata as { snapshot?: unknown; hash?: unknown } | null;
    if (!metadata || typeof metadata.hash !== "string") continue;
    const snapshot = metadata.snapshot as Snapshot | null;
    if (!snapshot || snapshot.tenantId !== tenantId || snapshot.saleId !== audit.targetId) continue;
    if (!Array.isArray(snapshot.credits)) continue;
    let hash: string;
    try {
      hash = payrollInputHash(snapshot);
    } catch {
      continue;
    }
    if (hash !== metadata.hash) continue;
    const credits: HoldingRow[] = [];
    let found = false;
    for (const raw of snapshot.credits) {
      const parsed = creditSchema.safeParse(raw);
      if (!parsed.success) break;
      if (parsed.data.tenantId !== tenantId) break;
      if (parsed.data.id === holdingId) found = true;
      credits.push(revive(parsed.data));
    }
    if (!found || credits.length !== snapshot.credits.length) continue;
    const sale = await tx.sale.findFirst({
      where: { tenantId, id: audit.targetId },
      select: { status: true },
    });
    if (sale?.status !== "VOID") continue;
    // A snapshot only speaks for deleted rows; live holdings keep the live path.
    const live = await tx.customerValuePackageHolding.count({
      where: { tenantId, saleLineId: { in: credits.map((row) => row.saleLineId!) } },
    });
    if (live) continue;
    return { holding: credits.find((row) => row.id === holdingId)!, credits };
  }
  return null;
}
