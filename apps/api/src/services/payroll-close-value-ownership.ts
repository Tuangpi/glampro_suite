import { conflict } from "../lib/http-error.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

type Balance = Awaited<
  ReturnType<PayrollCloseTransaction["prepaidBalanceEvent"]["findMany"]>
>[number];
type Transfer = Awaited<
  ReturnType<PayrollCloseTransaction["prepaidTransferEvent"]["findMany"]>
>[number];
const fail = (): never => {
  throw conflict("Authoritative payroll inputs unavailable: VALUE_OWNERSHIP_HISTORY_UNCONFIRMED.");
};

/** Replay private ownership from independent balance and transfer journals.
 * No current-owner fallback, sharing, restoration, expiry edits or legacy opening. */
export function resolvePayrollValueOwnership(input: {
  tenantId: string;
  holdingId: string;
  originalCustomerId: string;
  customerId: string;
  amount: Balance["amountAfter"];
  amountRemaining: Balance["amountAfter"];
  expiresAt: Date | null;
  balances: Balance[];
  transfers: Transfer[];
}) {
  const { balances, transfers } = input;
  if (
    new Set(balances.map((row) => row.id)).size !== balances.length ||
    new Set(transfers.map((row) => row.id)).size !== transfers.length
  )
    return fail();
  const grants = balances.filter((row) => row.kind === "GRANT");
  if (grants.length !== 1) return fail();
  const grant = grants[0];
  if (
    grant.customerId !== input.originalCustomerId ||
    grant.previousCustomerId !== null ||
    !grant.amountBefore.isZero() ||
    !grant.amountAfter.equals(input.amount)
  )
    return fail();
  const pending = balances.filter((row) => row.id !== grant.id);
  const owners = new Map<string, string>();
  const usedTransfers = new Set<string>();
  let owner = input.originalCustomerId;
  let remaining = input.amount;
  let at = grant.createdAt.getTime();
  for (const row of balances) {
    if (
      row.tenantId !== input.tenantId ||
      row.holdingId !== input.holdingId ||
      row.sharedFamilyId !== null ||
      row.previousSharedFamilyId !== null ||
      (row.expiresAt?.getTime() ?? null) !== (input.expiresAt?.getTime() ?? null) ||
      !row.delta.equals(row.amountAfter.minus(row.amountBefore)) ||
      !["GRANT", "SPEND", "TRANSFER"].includes(row.kind)
    )
      return fail();
  }
  while (pending.length) {
    const compatible = pending.filter(
      (row) => row.previousCustomerId === owner && row.amountBefore.equals(remaining),
    );
    const earliest = Math.min(...compatible.map((row) => row.createdAt.getTime()));
    const candidates = compatible.filter((row) => row.createdAt.getTime() === earliest);
    // A spend and transfer both claiming the same opening state is ambiguous.
    if (candidates.length !== 1) return fail();
    const row = candidates[0];
    if (row.createdAt.getTime() < at) return fail();
    if (row.kind === "TRANSFER") {
      if (
        row.customerId === owner ||
        !row.delta.isZero() ||
        !remaining.isPositive() ||
        row.saleId !== null ||
        !row.actorId ||
        !row.reason?.trim()
      )
        return fail();
      const matches = transfers.filter(
        (event) =>
          !usedTransfers.has(event.id) &&
          event.tenantId === input.tenantId &&
          event.holdingId === input.holdingId &&
          event.fromCustomerId === owner &&
          event.toCustomerId === row.customerId &&
          event.amount.equals(remaining) &&
          event.actorId === row.actorId &&
          event.reason === row.reason &&
          event.createdAt.getTime() >= row.createdAt.getTime() &&
          (event.expiresAt?.getTime() ?? null) === (input.expiresAt?.getTime() ?? null),
      );
      if (matches.length !== 1) return fail();
      usedTransfers.add(matches[0].id);
      owner = row.customerId;
      at = matches[0].createdAt.getTime();
    } else {
      if (
        row.customerId !== owner ||
        !row.delta.isNegative() ||
        row.amountAfter.isNegative() ||
        !row.saleId
      )
        return fail();
      owners.set(row.id, owner);
      remaining = row.amountAfter;
    }
    at = Math.max(at, row.createdAt.getTime());
    pending.splice(pending.indexOf(row), 1);
  }
  if (
    owner !== input.customerId ||
    !remaining.equals(input.amountRemaining) ||
    usedTransfers.size !== transfers.length
  )
    return fail();
  return owners;
}
