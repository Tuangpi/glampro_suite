import { z } from "zod";
import { MONEY_PAYMENT_METHODS, REDEMPTION_PAYMENT_METHODS } from "@glampro_suite/shared";
import { conflict, forbidden } from "../lib/http-error.js";
import { currentScope } from "../lib/tenant-context.js";
import { payrollInputHash } from "./payroll-close-state.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

const action = "sale.void.cash-disposition";
const cents = z.string().regex(/^(0|[1-9]\d*)$/);
/** Money tenders only: a giving-back pays out money, never credit. Mirrors
 * `voidSaleSchema`, so the request and the attestation share one vocabulary. */
const METHOD = z.enum(MONEY_PAYMENT_METHODS);
const purchaseTypes = ["PACKAGE", "VALUE_PACKAGE"];
const payoutSchema = z.object({
  id: z.string().trim().min(1).max(128),
  method: METHOD,
  grossCents: cents,
});
/** Facts every cash disposition binds: one voider, one operator-verified evidence hash
 * and one recorded instant. Shared, so a returned attestation cannot drop them. */
const attested = {
  actorId: z.string().min(1),
  actorRole: z.enum(["SUPER_ADMIN", "MANAGER"]),
  reason: z.string().trim().min(3).max(500),
  voidedAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
  operationalHash: z.string().regex(/^[a-f0-9]{64}$/),
  purchaseHoldingHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
};
const noMovementSchema = z.object({
  version: z.literal(1),
  cashDisposition: z.literal("NO_MOVEMENT"),
  ...attested,
});
/** Version 2 adds the money that actually went back. The payouts are the record of the
 * return; the entry that loaded them is a manager's, not a provider's. */
const returnedSchema = z.object({
  version: z.literal(2),
  cashDisposition: z.literal("RETURNED"),
  ...attested,
  returned: z.object({
    reference: z.string().trim().min(3).max(100),
    grossCents: cents,
    payouts: z.array(payoutSchema).min(1).max(5),
  }),
});
const confirmationSchema = z.discriminatedUnion("version", [noMovementSchema, returnedSchema]);
/** The stored attestation, old no-movement rows and current returned ones alike. */
export type SaleVoidCashConfirmation = z.infer<typeof confirmationSchema>;
/** What the manager says the void gave back, before it is bound to the sale's tenders. */
export interface SaleVoidReturnedCash {
  reference: string;
  payouts: { method: z.infer<typeof METHOD>; amount: number }[];
}
const unconfirmed = () =>
  conflict("Authoritative payroll inputs unavailable: SALE_VOID_CASH_UNCONFIRMED.");
const centsOf = (amount: number): string | null => {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const value = Math.round(amount * 100);
  if (Math.abs(amount * 100 - value) > 1e-6) return null;
  return String(value);
};
const tenderedCents = (
  payments: { amount: { mul(value: number): { toFixed(dp: number): string } } }[],
) => payments.reduce((sum, row) => sum + BigInt(row.amount.mul(100).toFixed(0)), 0n);
const moneyTendered = (payments: { method: string }[]) =>
  payments.length > 0 &&
  payments.every((row) => !(REDEMPTION_PAYMENT_METHODS as readonly string[]).includes(row.method));

/** Bind the attestation to independent post-void operational records, not payroll
 * bases. Stable ID order and JSON normalization preserve dates/decimals/bigints. */
async function operationalEvidence(tx: PayrollCloseTransaction, tenantId: string, saleId: string) {
  const [sale, payments, redemptions, collections, outstanding, refunds] = await Promise.all([
    tx.sale.findFirst({
      where: { tenantId, id: saleId },
      include: { lines: { orderBy: { id: "asc" } } },
    }),
    tx.salePayment.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
    tx.customerRedemption.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
    tx.commissionCollection.findMany({
      where: { tenantId, saleId },
      include: { allocations: { orderBy: { id: "asc" } } },
      orderBy: { id: "asc" },
    }),
    tx.customerOutstandingPayment.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
    tx.saleRefund.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
  ]);
  if (
    !sale ||
    sale.tenantId !== tenantId ||
    sale.status !== "VOID" ||
    !sale.voidedAt ||
    !sale.voidedById ||
    !sale.voidReason ||
    outstanding.length ||
    refunds.length
  )
    throw unconfirmed();
  // Concurrent retry serialization may touch updatedAt on an already-VOID row.
  // That bookkeeping timestamp is not a change to the attested money operation.
  const { updatedAt: _updatedAt, ...saleEvidence } = sale;
  const evidence = JSON.parse(
    JSON.stringify(
      { sale: saleEvidence, payments, redemptions, collections, outstanding, refunds },
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    ),
  );
  return { sale, payments, evidence, hash: payrollInputHash(evidence) };
}

/** Binds the manager's returned-cash claim to the money the sale actually took.
 *
 * Only a purchase-only sale whose tenders are all external money can be represented:
 * the returned allocations the close loads are those same tenders' collection
 * allocations, one per receipt. A credit-funded or mixed sale returns part of its
 * consideration in another form, which this attestation cannot state. */
function returnedPayouts(
  saleId: string,
  operational: Awaited<ReturnType<typeof operationalEvidence>>,
  returned: SaleVoidReturnedCash,
) {
  const { sale, payments } = operational;
  if (
    !sale.lines.length ||
    sale.lines.some((line) => !purchaseTypes.includes(line.itemType)) ||
    !moneyTendered(payments)
  )
    throw conflict(
      "Only a package or credit purchase paid entirely in money records a returned void here; return this sale's money through a refund instead.",
      "VOID_RETURN_UNSUPPORTED_SALE",
    );
  const payouts = returned.payouts.map((payout, index) => {
    const grossCents = centsOf(payout.amount);
    if (grossCents === null)
      throw conflict(
        "Enter a positive returned amount with at most two decimal places.",
        "VOID_RETURN_AMOUNT_INVALID",
      );
    return { id: `void-return:${saleId}:${index + 1}`, method: payout.method, grossCents };
  });
  const given = payouts.reduce((sum, payout) => sum + BigInt(payout.grossCents), 0n);
  const collected = tenderedCents(payments);
  if (given !== collected)
    throw conflict(
      "Returned money must equal what this sale collected; payroll cannot reconcile a partial return of a voided sale.",
      "VOID_RETURN_AMOUNT_MISMATCH",
    );
  return { reference: returned.reference, grossCents: collected.toString(), payouts };
}

/** Called only within the successful void transaction. Retries never add or amend
 * historical attestations; missing legacy cash disposition is not backfilled. */
export async function recordSaleVoidCashConfirmation(
  tx: PayrollCloseTransaction,
  tenantId: string,
  saleId: string,
  actorId: string,
  purchaseHoldingHash?: string,
  returnedCash?: SaleVoidReturnedCash,
) {
  const scope = currentScope();
  if (scope?.kind !== "tenant" || scope.tenantId !== tenantId || scope.actorId !== actorId)
    throw forbidden("Sale void cash confirmation requires the authenticated actor.");
  const actor = await tx.user.findFirst({ where: { tenantId, id: actorId, disabled: false } });
  if (
    !actor ||
    !["MANAGER", "SUPER_ADMIN"].includes(actor.globalRole) ||
    (actor.globalRole === "SUPER_ADMIN" && !actor.twoFactorEnabled)
  )
    throw forbidden("Sale void cash confirmation requires an authorized manager.");
  const operational = await operationalEvidence(tx, tenantId, saleId);
  if (operational.sale.voidedById !== actorId)
    throw conflict("Sale void cash confirmation actor does not match.");
  const facts = {
    actorId,
    actorRole: actor.globalRole,
    reason: operational.sale.voidReason,
    voidedAt: operational.sale.voidedAt!.toISOString(),
    recordedAt: new Date().toISOString(),
    operationalHash: operational.hash,
    ...(purchaseHoldingHash ? { purchaseHoldingHash } : {}),
  };
  const metadata = confirmationSchema.parse(
    returnedCash
      ? {
          version: 2,
          cashDisposition: "RETURNED",
          ...facts,
          returned: returnedPayouts(saleId, operational, returnedCash),
        }
      : { version: 1, cashDisposition: "NO_MOVEMENT", ...facts },
  );
  await tx.auditLog.create({
    data: { tenantId, action, targetType: "Sale", targetId: saleId, metadata },
  });
}

export async function loadSaleVoidCashConfirmation(
  tx: PayrollCloseTransaction,
  tenantId: string,
  saleId: string,
) {
  const [operational, audits] = await Promise.all([
    operationalEvidence(tx, tenantId, saleId),
    tx.auditLog.findMany({
      where: { tenantId, action, targetType: "Sale", targetId: saleId },
      orderBy: { id: "asc" },
    }),
  ]);
  const parsed = confirmationSchema.safeParse(audits[0]?.metadata);
  if (
    audits.length !== 1 ||
    !parsed.success ||
    audits[0].tenantId !== tenantId ||
    audits[0].action !== action ||
    audits[0].targetType !== "Sale" ||
    audits[0].targetId !== saleId ||
    parsed.data.operationalHash !== operational.hash ||
    parsed.data.actorId !== operational.sale.voidedById ||
    parsed.data.reason !== operational.sale.voidReason ||
    parsed.data.voidedAt !== operational.sale.voidedAt!.toISOString() ||
    parsed.data.recordedAt < parsed.data.voidedAt
  )
    throw unconfirmed();
  if (parsed.data.cashDisposition === "RETURNED") {
    // Re-derive the returned total from the surviving tenders, so an attestation that
    // was written or edited outside the void writer cannot overstate or understate it.
    const { sale, payments } = operational;
    const attestedCents = parsed.data.returned.payouts.reduce(
      (sum, payout) => sum + BigInt(payout.grossCents),
      0n,
    );
    if (
      !sale.lines.length ||
      sale.lines.some((line) => !purchaseTypes.includes(line.itemType)) ||
      !moneyTendered(payments) ||
      attestedCents !== tenderedCents(payments) ||
      BigInt(parsed.data.returned.grossCents) !== attestedCents
    )
      throw unconfirmed();
  }
  return {
    audit: { ...audits[0], createdAt: audits[0].createdAt.toISOString() },
    confirmation: parsed.data,
    operational: operational.evidence,
  };
}
