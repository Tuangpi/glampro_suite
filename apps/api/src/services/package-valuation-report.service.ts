import { z } from "zod";
import { packageValuationReportSchema } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope, runAsTenant } from "../lib/tenant-context.js";
import { lockPrepaid } from "../lib/prepaid-lock.js";
import { conflict } from "../lib/http-error.js";
import { packageMoneyToCents, packageRangeValue } from "../lib/package-valuation.js";
import { expirePackageValuations, valuationClock } from "./package-valuation-ledger.js";

const rangesSchema = z.array(z.strictObject({ first: z.number().int(), last: z.number().int() }));
type Balance = { quantity: number; netCents: bigint; taxCents: bigint; grossCents: bigint };
const empty = (): Balance => ({ quantity: 0, netCents: 0n, taxCents: 0n, grossCents: 0n });
function add(target: Balance, value: Balance) {
  target.quantity += value.quantity;
  target.netCents += value.netCents;
  target.taxCents += value.taxCents;
  target.grossCents += value.grossCents;
}
function money(cents: bigint) {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
function mismatch(): never {
  throw conflict(
    "Package valuation evidence does not reconcile. No valuation report was produced.",
    "VALUATION_RECONCILIATION_FAILED",
  );
}

/** POS/transfer/void and report expiry use the same tenant prepaid lock. Drop only
 * outlet scope: purchase ownership and receivables are company-wide. No client as-of.
 * Read committed deliberately samples DB time AFTER a potentially waiting lock.
 */
export async function packageValuationReport() {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw new Error("Package valuation report requires tenant scope.");
  return runAsTenant(
    scope.tenantId,
    () =>
      prisma.$transaction(
        async (tx) => {
          await lockPrepaid(tx, scope.tenantId);
          const asOf = await valuationClock(tx);
          await expirePackageValuations(tx, asOf);
          const activation = await tx.packageValuationActivation.findUnique({
            where: { tenantId: scope.tenantId },
          });
          const purchases = await tx.packagePurchaseSnapshot.findMany({
            include: { state: true, movements: true },
          });
          const holdings = await tx.customerPackageHolding.findMany();
          const holdingMap = new Map(holdings.map((row) => [row.id, row]));
          const known = new Set(purchases.map((row) => row.holdingId));
          const totals = {
            ACTIVE: { ...empty(), holdings: 0 },
            EXPIRED: { ...empty(), holdings: 0 },
          };
          const remainingSaleIds: string[] = [];
          let movementCount = 0;
          for (const purchase of purchases) {
            const state = purchase.state;
            if (
              !state ||
              !activation ||
              purchase.currency !== activation.currency ||
              purchase.policyVersion !== activation.policyVersion
            )
              mismatch();
            const value = packageRangeValue(
              purchase,
              purchase.grantedSessions,
              rangesSchema.parse(state.availableOrdinals),
            );
            const bucket = state.expired ? "EXPIRED" : "ACTIVE";
            if (
              state.expired !==
              Boolean(purchase.originalExpiresAt && purchase.originalExpiresAt <= asOf)
            ) {
              // A voided purchase need not be processed by subsequent expiry runs.
              if (!state.voided) mismatch();
            }
            if (state.voided && value.quantity !== 0) mismatch();
            const balances = new Map<string, Balance>();
            // Signed interval boundaries reconcile actual ordinals too: equal money
            // and quantity cannot detect swapped ordinals on a zero-value purchase.
            const boundaries = new Map<string, Map<number, number>>();
            const mark = (key: string, first: number, last: number, sign: number) => {
              const points = boundaries.get(key) ?? new Map<number, number>();
              points.set(first, (points.get(first) ?? 0) + sign);
              points.set(last + 1, (points.get(last + 1) ?? 0) - sign);
              boundaries.set(key, points);
            };
            for (const movement of purchase.movements) {
              if (!["ACTIVE", "EXPIRED"].includes(movement.bucket)) mismatch();
              const key = JSON.stringify([movement.customerId, movement.bucket]);
              const ordinals = rangesSchema.parse(movement.ordinals);
              const allocated = packageRangeValue(purchase, purchase.grantedSessions, ordinals);
              const sign = movement.quantity < 0 ? -1 : 1;
              if (
                movement.quantity !== sign * allocated.quantity ||
                movement.netCents !== BigInt(sign) * allocated.netCents ||
                movement.taxCents !== BigInt(sign) * allocated.taxCents ||
                movement.grossCents !== BigInt(sign) * allocated.grossCents
              )
                mismatch();
              for (const range of ordinals) mark(key, range.first, range.last, sign);
              const balance = balances.get(key) ?? empty();
              add(balance, movement);
              balances.set(key, balance);
              movementCount++;
            }
            const expectedKey = JSON.stringify([state.customerId, bucket]);
            for (const range of rangesSchema.parse(state.availableOrdinals))
              mark(expectedKey, range.first, range.last, -1);
            for (const points of boundaries.values()) {
              if ([...points.values()].some((delta) => delta !== 0)) mismatch();
            }
            if (!balances.has(expectedKey)) balances.set(expectedKey, empty());
            for (const [key, balance] of balances) {
              const expected = key === expectedKey ? value : empty();
              if (
                balance.quantity !== expected.quantity ||
                balance.netCents !== expected.netCents ||
                balance.taxCents !== expected.taxCents ||
                balance.grossCents !== expected.grossCents
              )
                mismatch();
            }
            const holding = holdingMap.get(purchase.holdingId);
            if (
              !state.voided &&
              (!holding ||
                holding.customerId !== state.customerId ||
                holding.quantityRemaining !== value.quantity ||
                holding.quantity !== purchase.grantedSessions ||
                holding.expiresAt?.getTime() !== purchase.originalExpiresAt?.getTime())
            )
              mismatch();
            if (state.voided && holding) mismatch();
            if (value.quantity > 0) {
              add(totals[bucket], value);
              totals[bucket].holdings++;
              remainingSaleIds.push(purchase.saleId);
            }
          }
          const unvalued = {
            active: { holdings: 0, sessionsRemaining: 0 },
            expired: { holdings: 0, sessionsRemaining: 0 },
          };
          for (const holding of holdings) {
            if (known.has(holding.id) || holding.quantityRemaining <= 0) continue;
            const bucket =
              holding.expiresAt && holding.expiresAt <= asOf ? unvalued.expired : unvalued.active;
            bucket.holdings++;
            bucket.sessionsRemaining += holding.quantityRemaining;
          }
          // Read source-sale balances once. Never multiply receivables by package count,
          // infer cash allocation on mixed sales or use outlet-filtered Sale relations.
          const outstanding = await tx.customerOutstanding.findMany({
            where: { saleId: { in: [...new Set(remainingSaleIds)] }, unpaidAmount: { gt: 0 } },
          });
          const unpaidSales = new Set(outstanding.map((row) => row.saleId));
          const view = (bucket: typeof totals.ACTIVE) => ({
            holdings: bucket.holdings,
            sessionsRemaining: bucket.quantity,
            net: money(bucket.netCents),
            originalTax: money(bucket.taxCents),
            gross: money(bucket.grossCents),
          });
          return packageValuationReportSchema.parse({
            scope: "COMPANY",
            asOf: asOf.toISOString(),
            activation: activation
              ? { ...activation, activatedAt: activation.activatedAt.toISOString() }
              : null,
            active: view(totals.ACTIVE),
            expired: view(totals.EXPIRED),
            unvalued,
            unpaidPurchases: {
              sales: unpaidSales.size,
              holdings: remainingSaleIds.filter((id) => unpaidSales.has(id)).length,
              sourceSaleOutstanding: money(
                outstanding.reduce(
                  (sum, row) => sum + packageMoneyToCents(row.unpaidAmount.toFixed(2)),
                  0n,
                ),
              ),
            },
            reconciliation: {
              status: "RECONCILED",
              purchases: purchases.length,
              movements: movementCount,
            },
          });
        },
        { timeout: 30_000 },
      ),
    scope.actorId,
  );
}
