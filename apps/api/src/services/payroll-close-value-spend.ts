import { z } from "zod";
import {
  allocatePayrollSplit,
  commissionAttributionSchema,
  commissionSharesSchema,
  payrollBaseLineSchema,
  payrollValuePackageSpend,
} from "@glampro_suite/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { conflict } from "../lib/http-error.js";
import { payrollInputHash } from "./payroll-close-state.js";
import { resolvePayrollCloseSources } from "./payroll-close-sources.js";
import { verifyOrdinaryPayrollRateProvenance } from "./payroll-close-rate-provenance.js";

const money = z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/);
const sourceSchema = z.object({
  lines: z.array(payrollBaseLineSchema),
  sourceSnapshot: z.object({
    version: z.literal(1),
    purchase: z.unknown(),
    baseAmount: z.string(),
    spentBefore: money,
    spentNow: money,
    performers: commissionSharesSchema,
    sourceSaleId: z.string().min(1),
    postingStatus: z.literal("PENDING_RELEASE"),
  }),
});
const fail = (): never => {
  throw conflict("Authoritative payroll inputs unavailable: VALUE_SPEND_EVIDENCE_UNCONFIRMED.");
};

/** Supplied-record verification only. Inventory/ownership/balance provenance must
 * be independently established by the locked holding-history loader. */
export function verifyPayrollValueSpend(input: {
  tenantId: string;
  timeZone: string;
  purchase: { paidNet: string; credit: string };
  spentBefore: string;
  holding: { id: string; valuePackageId: string; customerId: string; expiresAt: Date | null };
  redemption: {
    id: string;
    tenantId: string;
    customerId: string;
    saleId: string;
    itemType: string;
    itemId: string;
    holdingId: string | null;
    quantity: number;
    amount: Prisma.Decimal | null;
    usedAt: Date;
    revertedAt: Date | null;
  };
  sale: {
    id: string;
    tenantId: string;
    customerId: string | null;
    status: string;
    outletId: string | null;
    collectionCurrency: string | null;
    soldAt: Date;
    lines: {
      id: string;
      tenantId: string;
      saleId: string;
      itemType: string;
      attribution: unknown;
    }[];
  };
  event: Parameters<typeof resolvePayrollCloseSources>[0]["events"][number];
  rules: Parameters<typeof verifyOrdinaryPayrollRateProvenance>[4];
}) {
  const { redemption, sale, event, holding } = input;
  const parsed = sourceSchema.safeParse(event.evidence);
  if (!parsed.success) return fail();
  const { sourceSnapshot: source, lines } = parsed.data;
  if (
    redemption.tenantId !== input.tenantId ||
    sale.tenantId !== input.tenantId ||
    event.tenantId !== input.tenantId ||
    redemption.itemType !== "VALUE_PACKAGE" ||
    redemption.itemId !== holding.valuePackageId ||
    redemption.holdingId !== holding.id ||
    redemption.customerId !== holding.customerId ||
    sale.customerId !== holding.customerId ||
    redemption.quantity !== 1 ||
    !redemption.amount?.isPositive() ||
    !redemption.amount.mul(100).isInteger() ||
    redemption.revertedAt !== null ||
    sale.id !== redemption.saleId ||
    sale.status !== "COMPLETED" ||
    !sale.outletId ||
    sale.collectionCurrency !== "SGD" ||
    sale.soldAt > redemption.usedAt ||
    (holding.expiresAt !== null && holding.expiresAt <= redemption.usedAt) ||
    event.sourceType !== "VALUE_SPEND" ||
    event.sourceKey !== `value-spend:${redemption.id}` ||
    event.sourceId !== redemption.id ||
    event.saleId !== sale.id ||
    event.outletId !== sale.outletId ||
    event.occurredAt.getTime() !== redemption.usedAt.getTime() ||
    source.sourceSaleId !== sale.id ||
    source.spentBefore !== input.spentBefore ||
    source.spentNow !== redemption.amount.toFixed(2) ||
    payrollInputHash(source.purchase) !== payrollInputHash(input.purchase) ||
    new Set(sale.lines.map((row) => row.id)).size !== sale.lines.length ||
    sale.lines.some((row) => row.tenantId !== input.tenantId || row.saleId !== sale.id)
  )
    return fail();
  const services = sale.lines.filter((row) => row.itemType === "SERVICE");
  if (!services.length) return fail();
  for (const service of services) {
    const attribution = commissionAttributionSchema.safeParse(service.attribution);
    if (
      !attribution.success ||
      !attribution.data.performers ||
      payrollInputHash(attribution.data.performers) !== payrollInputHash(source.performers)
    )
      return fail();
  }
  const baseAmount = payrollValuePackageSpend(
    input.purchase.paidNet,
    input.purchase.credit,
    input.spentBefore,
    source.spentNow,
  );
  const bases = allocatePayrollSplit(baseAmount, source.performers);
  const units = allocatePayrollSplit("1.0000", source.performers);
  if (
    source.baseAmount !== baseAmount ||
    lines.length !== bases.length ||
    new Set(lines.map((row) => row.staffId)).size !== lines.length ||
    lines.some(
      (row) =>
        row.commissionType !== "VP_SPEND" ||
        row.mode !== "FOLLOW_PLAN" ||
        row.fixedCommission !== undefined ||
        (row.productCategory ?? null) !== null ||
        row.baseAmount !== bases.find((part) => part.staffId === row.staffId)?.amount ||
        row.units !== units.find((part) => part.staffId === row.staffId)?.amount,
    )
  )
    return fail();
  const provenance = verifyOrdinaryPayrollRateProvenance(
    event.evidence,
    { itemId: holding.valuePackageId, itemType: "VALUE_SPEND" },
    event.occurredAt,
    event.createdAt,
    input.rules,
    input.tenantId,
  );
  if (provenance.category !== null) return fail();
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: input.timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(event.occurredAt);
  const periodKey = ["year", "month"]
    .map((type) => parts.find((row) => row.type === type)!.value)
    .join("-");
  if (
    !resolvePayrollCloseSources({
      tenantId: input.tenantId,
      timeZone: input.timeZone,
      periodKey,
      events: [event],
      lineageEvents: [],
    }).sources
  )
    return fail();
  return structuredClone({
    redemptionId: redemption.id,
    eventId: event.id,
    baseAmount,
    spentBefore: source.spentBefore,
    spentNow: source.spentNow,
    performers: source.performers,
  });
}
