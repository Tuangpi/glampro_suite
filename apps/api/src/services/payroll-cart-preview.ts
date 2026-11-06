import { z } from "zod";
import {
  commissionSharesSchema,
  payrollPackageSettingsSchema,
  payrollSaleLineBase,
  payrollFixedSaleAward,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { currentScope } from "../lib/tenant-context.js";
import { forbidden, notFound } from "../lib/http-error.js";
import { verifiedPayrollCloseSnapshot } from "./payroll-close-store.js";
import { salonPeriodKey } from "./payroll-progress.js";
import { payrollBusinessDate } from "./payroll-source-event.js";
import { resolveCommission } from "./commission-rules.js";
import { previewTillCommission } from "./payroll-till-preview.js";

export const cartPreviewSchema = z.strictObject({
  itemType: z.enum(["SERVICE", "PRODUCT", "PACKAGE", "VALUE_PACKAGE"]),
  itemId: z.string().trim().min(1).max(128),
  customerId: z.string().trim().min(1).max(128).optional(),
  quantity: z.number().int().min(1).max(10000),
  discountPercent: z.number().min(0).max(100).optional(),
  shares: commissionSharesSchema,
});

/** Conditional cash-only estimate. No checkout/source/earnings writer is invoked.
 * Catalogue, membership, tax, category, outlet and fallback rates are server-owned.
 * Tender-specific session and credit amounts are not guessed before checkout. */
export async function previewPayrollCart(raw: unknown) {
  const input = cartPreviewSchema.parse(raw);
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId) throw forbidden();
  return prisma.$transaction(
    async (tx) => {
      const actor = await tx.user.findFirst({ where: { id: scope.actorId, disabled: false } });
      if (!actor || !["SUPER_ADMIN", "MANAGER", "STAFF"].includes(actor.globalRole))
        throw forbidden();
      const selfOnly = actor.globalRole === "STAFF";
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: scope.tenantId },
        select: { timeZone: true, gstEnabled: true },
      });
      const now = new Date();
      const period = salonPeriodKey(tenant.timeZone, now);
      const verified = await verifiedPayrollCloseSnapshot(tx, period);
      const customer = input.customerId
        ? await tx.customer.findFirst({
            where: { id: input.customerId },
            select: { memberId: true },
          })
        : null;
      if (input.customerId && !customer) throw notFound("Customer not found.");
      const item =
        input.itemType === "SERVICE"
          ? await tx.service.findFirst({ where: { id: input.itemId } })
          : input.itemType === "PRODUCT"
            ? await tx.product.findFirst({ where: { id: input.itemId } })
            : input.itemType === "PACKAGE"
              ? await tx.package.findFirst({ where: { id: input.itemId } })
              : await tx.valuePackage.findFirst({ where: { id: input.itemId } });
      if (!item || item.status !== "ACTIVE") throw notFound("Active catalogue item not found.");
      const people = await tx.user.findMany({
        where: { id: { in: input.shares.map((row) => row.staffId) }, disabled: false },
      });
      if (people.length !== input.shares.length)
        throw forbidden("Attribution staff are unavailable.");
      const outlet = scope.outletId
        ? await tx.outlet.findFirst({ where: { id: scope.outletId } })
        : null;
      if (scope.outletId && !outlet) throw forbidden();
      const category = "departmentId" in item ? item.departmentId : null;
      const price =
        "nonmemberPrice" in item
          ? customer?.memberId
            ? item.memberPrice
            : item.nonmemberPrice
          : item.price;
      const unit = price.minus(
        price
          .mul(input.discountPercent ?? 0)
          .div(100)
          .toDecimalPlaces(2),
      );
      const gross = unit.mul(input.quantity);
      const tax = tenant.gstEnabled
        ? gross.mul(9).div(109).toDecimalPlaces(2)
        : new Prisma.Decimal(0);
      const net = gross.minus(tax);
      const foc = input.itemType === "SERVICE" && gross.isZero();
      const commissionType = foc
        ? "FOC"
        : input.itemType === "SERVICE"
          ? "SVC"
          : input.itemType === "PRODUCT"
            ? "PRD"
            : input.itemType === "PACKAGE"
              ? "PKG_SALE"
              : "VP_SALE";
      const kind = foc
        ? "FOC"
        : input.itemType === "SERVICE"
          ? "SERVICE"
          : input.itemType === "PRODUCT"
            ? "PRODUCT"
            : input.itemType === "PACKAGE"
              ? "PACKAGE_SALE"
              : "STORED_CREDIT_SALE";
      const rules = await tx.commissionRule.findMany({ where: { effectiveAt: { lte: now } } });
      const rates = new Map(
        people.map((person) => [
          person.id,
          resolveCommission(
            rules,
            {
              staffId: person.id,
              itemKind: kind,
              itemId: item.id,
              departmentId: category,
              legacyServiceRate: person.commissionRate.toString(),
            },
            now,
          ).rate,
        ]),
      );
      const policy =
        input.itemType === "PACKAGE" && "commissionSettings" in item
          ? payrollPackageSettingsSchema.safeParse(item.commissionSettings)
          : null;
      const award = policy?.success ? policy.data.sale : null;
      const base = payrollSaleLineBase({
        foc,
        listUnitPrice: "nonmemberPrice" in item ? item.nonmemberPrice.toFixed(2) : null,
        quantity: input.quantity,
        netAmount: net.toFixed(4),
        creditPaid: false,
        externalNetCents: null,
      });
      const unavailable = !verified?.state.calculation || (input.itemType === "PACKAGE" && !award);
      const rows = unavailable
        ? input.shares.map((row) => ({ staffId: row.staffId, amount: null as string | null }))
        : previewTillCommission(
            verified.state,
            {
              commissionType,
              baseAmount: base ?? "0",
              quantity: input.quantity,
              shares: input.shares,
            },
            {
              outletId: scope.outletId ?? null,
              category,
              businessDate: payrollBusinessDate(now, tenant.timeZone),
              mode: award?.mode ?? "FOLLOW_PLAN",
              ...(award?.mode === "FIXED"
                ? { fixedCommission: payrollFixedSaleAward(award.amount, 0) }
                : {}),
              fallbackRates: rates,
            },
          ).rows;
      return {
        period,
        calculatedAt: verified?.state.calculation?.calculatedAt ?? null,
        scope: selfOnly ? "SELF" : "SALON",
        commissionType,
        baseAmount: base,
        rows: selfOnly ? rows.filter((row) => row.staffId === actor.id) : rows,
        basis: "HYPOTHETICAL_FULL_CASH",
        tenderEvidence:
          "Session redemption and credit-funded estimates are unavailable until checkout evidence exists. Excludes incentives and other cart lines; nothing is posted.",
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
