import { conflict } from "../lib/http-error.js";

/** Replay complete append-only ownership history. No current catalogue/customer
 * substitution, inferred transfer, timestamp tie-breaking or purchase revaluation.
 * Caller independently verifies original purchase and complete draw inventory.
 */
export function verifyPayrollPackageOwnership(input: {
  tenantId: string;
  purchase: { originalCustomerId: string; purchasedAt: string; grantedSessions: number };
  holding: { id: string; customerId: string; quantityRemaining: number; expiresAt: Date | null };
  transfers: {
    id: string;
    tenantId: string;
    holdingId: string;
    fromCustomerId: string;
    toCustomerId: string;
    actorId: string;
    quantity: number;
    expiresAt: Date | null;
    reason: string;
    createdAt: Date;
  }[];
  redemptions: {
    id: string;
    tenantId: string;
    holdingId: string | null;
    customerId: string;
    quantity: number;
    usedAt: Date;
    revertedAt: Date | null;
  }[];
}) {
  const fail = (): never => {
    throw conflict("Authoritative payroll inputs unavailable: PACKAGE_OWNERSHIP_UNCONFIRMED.");
  };
  const { holding, purchase, tenantId } = input;
  const purchasedAt = new Date(purchase.purchasedAt).getTime();
  if (
    !Number.isFinite(purchasedAt) ||
    !purchase.originalCustomerId ||
    !Number.isSafeInteger(purchase.grantedSessions) ||
    purchase.grantedSessions <= 0 ||
    new Set(input.transfers.map((row) => row.id)).size !== input.transfers.length ||
    new Set(input.redemptions.map((row) => row.id)).size !== input.redemptions.length ||
    (holding.expiresAt !== null && !Number.isFinite(holding.expiresAt.getTime())) ||
    input.transfers.some(
      (row) => !(row.createdAt instanceof Date) || typeof row.reason !== "string",
    ) ||
    input.redemptions.some((row) => !(row.usedAt instanceof Date))
  )
    return fail();
  let owner = purchase.originalCustomerId;
  let remaining = purchase.grantedSessions;
  let previousAt: number | null = null;
  const timeline = [
    ...input.transfers.map((row) => ({
      kind: "TRANSFER" as const,
      at: row.createdAt.getTime(),
      row,
    })),
    ...input.redemptions.map((row) => ({ kind: "DRAW" as const, at: row.usedAt.getTime(), row })),
  ].sort((a, b) => a.at - b.at);
  for (const entry of timeline) {
    const { row, at } = entry;
    if (
      !Number.isFinite(at) ||
      at < purchasedAt ||
      at === previousAt ||
      !row.id ||
      row.tenantId !== tenantId ||
      row.holdingId !== holding.id ||
      !Number.isSafeInteger(row.quantity) ||
      row.quantity <= 0 ||
      (holding.expiresAt && at >= holding.expiresAt.getTime())
    )
      return fail();
    previousAt = at;
    if (entry.kind === "TRANSFER") {
      const transfer = entry.row;
      if (
        transfer.fromCustomerId !== owner ||
        !transfer.toCustomerId ||
        transfer.toCustomerId === owner ||
        !transfer.actorId ||
        !transfer.reason.trim() ||
        transfer.quantity !== remaining ||
        (transfer.expiresAt?.getTime() ?? null) !== (holding.expiresAt?.getTime() ?? null)
      )
        return fail();
      owner = transfer.toCustomerId;
    } else {
      if (
        entry.row.customerId !== owner ||
        entry.row.revertedAt !== null ||
        row.quantity > remaining
      )
        return fail();
      remaining -= row.quantity;
    }
  }
  if (holding.customerId !== owner || holding.quantityRemaining !== remaining) return fail();
  return { customerId: owner, quantityRemaining: remaining };
}
