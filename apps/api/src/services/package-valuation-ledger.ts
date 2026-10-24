import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import {
  packagePurchaseValue,
  packageRangeValue,
  normalizeSessionRanges,
  takePackageSessions,
  restorePackageSessions,
  type SessionOrdinalRange,
} from "../lib/package-valuation.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const rangesSchema = z.array(z.strictObject({ first: z.number().int(), last: z.number().int() }));
function scope() {
  const value = currentScope();
  if (value?.kind !== "tenant") throw new Error("Package valuation ledger requires tenant scope.");
  return value;
}
function actor() {
  const id = scope().actorId;
  if (!id) throw new Error("Valued package actions require an authenticated actor.");
  return id;
}
export async function valuationClock(tx: Transaction) {
  const [clock] = await tx.$queryRaw<
    { at: Date }[]
  >`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS at`;
  if (!clock) throw new Error("Valuation database clock unavailable.");
  return clock.at;
}

/** All callers must already hold the tenant prepaid lock, before any holding locks. */
async function load(tx: Transaction, holdingId: string) {
  const purchase = await tx.packagePurchaseSnapshot.findUnique({
    where: { tenantId_holdingId: { tenantId: scope().tenantId, holdingId } },
  });
  if (!purchase) return null; // Unverifiable legacy holdings remain unvalued.
  const state = await tx.packageValuationState.findUniqueOrThrow({
    where: { tenantId_purchaseId: { tenantId: scope().tenantId, purchaseId: purchase.id } },
  });
  if (state.voided) throw new Error("Voided package valuation cannot move.");
  const available = normalizeSessionRanges(
    purchase.grantedSessions,
    rangesSchema.parse(state.availableOrdinals),
  );
  return { purchase, state, available };
}
type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;
async function movement(
  tx: Transaction,
  loaded: Loaded,
  kind: string,
  sourceKey: string,
  ordinals: SessionOrdinalRange[],
  sign: 1 | -1,
  at: Date,
  options: { customerId?: string; bucket?: string; system?: boolean } = {},
) {
  const amount = packageRangeValue(loaded.purchase, loaded.purchase.grantedSessions, ordinals);
  await tx.packageValuationMovement.create({
    data: {
      tenantId: scope().tenantId,
      purchaseId: loaded.purchase.id,
      customerId: options.customerId ?? loaded.state.customerId,
      kind,
      sourceKey,
      bucket: options.bucket ?? (loaded.state.expired ? "EXPIRED" : "ACTIVE"),
      ordinals: ordinals.map(({ first, last }) => ({ first, last })),
      quantity: sign * amount.quantity,
      netCents: BigInt(sign) * amount.netCents,
      taxCents: BigInt(sign) * amount.taxCents,
      grossCents: BigInt(sign) * amount.grossCents,
      actorId: options.system ? null : actor(),
      effectiveAt: at,
      recordedAt: await valuationClock(tx),
    },
  });
}
async function expire(tx: Transaction, loaded: Loaded, at: Date) {
  const expiry = loaded.purchase.originalExpiresAt;
  if (!loaded.state.expired && expiry && expiry <= at) {
    await movement(tx, loaded, "EXPIRE_OUT", "expiry:out", loaded.available, -1, expiry, {
      system: true,
      bucket: "ACTIVE",
    });
    await movement(tx, loaded, "EXPIRE_IN", "expiry:in", loaded.available, 1, expiry, {
      system: true,
      bucket: "EXPIRED",
    });
    await tx.packageValuationState.update({
      where: { id: loaded.state.id },
      data: { expired: true },
    });
    loaded.state.expired = true;
  }
}

export async function recordPackagePurchase(tx: Transaction, holdingId: string) {
  const tenantId = scope().tenantId;
  const activation = await tx.packageValuationActivation.findUnique({ where: { tenantId } });
  if (!activation) return;
  const holding = await tx.customerPackageHolding.findUniqueOrThrow({
    where: { id: holdingId },
    include: { saleLine: { include: { sale: true } } },
  });
  const line = holding.saleLine;
  if (
    !line ||
    line.tenantId !== tenantId ||
    line.sale.tenantId !== tenantId ||
    line.sale.status !== "COMPLETED" ||
    line.sale.customerId !== holding.customerId ||
    line.itemType !== "PACKAGE" ||
    holding.quantity !== holding.quantityRemaining
  ) {
    throw new Error("Package purchase source evidence is inconsistent.");
  }
  const at = await valuationClock(tx);
  const purchase = await tx.packagePurchaseSnapshot.create({
    data: {
      tenantId,
      activationId: activation.id,
      policyVersion: activation.policyVersion,
      currency: activation.currency,
      holdingId,
      saleId: line.saleId,
      saleLineId: line.id,
      originalCustomerId: holding.customerId,
      grantedSessions: holding.quantity,
      ...packagePurchaseValue(
        line.lineTotal.toFixed(2),
        line.voucherDiscountAmount.toFixed(2),
        line.taxAmount.toFixed(2),
      ),
      originalExpiresAt: holding.expiresAt,
      purchasedAt: line.sale.soldAt,
      recordedAt: at,
      actorId: actor(),
    },
  });
  const available = [{ first: 1, last: holding.quantity }];
  const state = await tx.packageValuationState.create({
    data: {
      tenantId,
      purchaseId: purchase.id,
      customerId: holding.customerId,
      availableOrdinals: available,
    },
  });
  const loaded = { purchase, state, available };
  await movement(tx, loaded, "GRANT", "grant", available, 1, at);
  await expire(tx, loaded, at);
}

export async function recordPackageRedemption(
  tx: Transaction,
  holdingId: string,
  redemptionId: string,
  quantity: number,
) {
  const loaded = await load(tx, holdingId);
  if (!loaded) return;
  const at = await valuationClock(tx);
  await expire(tx, loaded, at);
  if (loaded.state.expired) throw new Error("Expired package valuation cannot be redeemed.");
  const draw = takePackageSessions(loaded.purchase.grantedSessions, loaded.available, quantity);
  await movement(tx, loaded, "REDEEM", `redeem:${redemptionId}`, draw.allocated, -1, at);
  await tx.packageValuationState.update({
    where: { id: loaded.state.id },
    data: { availableOrdinals: draw.remaining.map(({ first, last }) => ({ first, last })) },
  });
}

export async function restorePackageRedemption(
  tx: Transaction,
  holdingId: string,
  redemptionId: string,
) {
  const loaded = await load(tx, holdingId);
  if (!loaded) return;
  const at = await valuationClock(tx);
  await expire(tx, loaded, at);
  const original = await tx.packageValuationMovement.findUniqueOrThrow({
    where: {
      tenantId_purchaseId_sourceKey: {
        tenantId: scope().tenantId,
        purchaseId: loaded.purchase.id,
        sourceKey: `redeem:${redemptionId}`,
      },
    },
  });
  const ordinals = rangesSchema.parse(original.ordinals);
  const available = restorePackageSessions(
    loaded.purchase.grantedSessions,
    loaded.available,
    ordinals,
  );
  await movement(tx, loaded, "RESTORE", `restore:${redemptionId}`, ordinals, 1, at);
  await tx.packageValuationState.update({
    where: { id: loaded.state.id },
    data: { availableOrdinals: available.map(({ first, last }) => ({ first, last })) },
  });
}

export async function transferPackageValuation(
  tx: Transaction,
  holdingId: string,
  transferId: string,
  targetCustomerId: string,
) {
  const loaded = await load(tx, holdingId);
  if (!loaded) return;
  const at = await valuationClock(tx);
  await expire(tx, loaded, at);
  if (loaded.state.expired) throw new Error("Expired package valuation cannot be transferred.");
  await movement(
    tx,
    loaded,
    "TRANSFER_OUT",
    `transfer:${transferId}:out`,
    loaded.available,
    -1,
    at,
  );
  await movement(tx, loaded, "TRANSFER_IN", `transfer:${transferId}:in`, loaded.available, 1, at, {
    customerId: targetCustomerId,
  });
  await tx.packageValuationState.update({
    where: { id: loaded.state.id },
    data: { customerId: targetCustomerId },
  });
}

export async function voidPackagePurchase(tx: Transaction, holdingId: string, saleId: string) {
  const loaded = await load(tx, holdingId);
  if (!loaded) return;
  const at = await valuationClock(tx);
  await expire(tx, loaded, at);
  const amount = packageRangeValue(
    loaded.purchase,
    loaded.purchase.grantedSessions,
    loaded.available,
  );
  if (amount.quantity !== loaded.purchase.grantedSessions || loaded.purchase.saleId !== saleId)
    throw new Error("Spent package purchase cannot be voided.");
  await movement(tx, loaded, "PURCHASE_VOID", `void:${saleId}`, loaded.available, -1, at);
  await tx.packageValuationState.update({
    where: { id: loaded.state.id },
    data: { availableOrdinals: [], voided: true },
  });
}

/** Deterministic system expiry; caller holds prepaid lock and supplies one report as-of. */
export async function expirePackageValuations(tx: Transaction, at: Date) {
  const purchases = await tx.packagePurchaseSnapshot.findMany({
    where: { originalExpiresAt: { lte: at }, state: { expired: false, voided: false } },
    select: { holdingId: true },
  });
  for (const purchase of purchases) {
    const loaded = await load(tx, purchase.holdingId);
    if (loaded) await expire(tx, loaded, at);
  }
}
