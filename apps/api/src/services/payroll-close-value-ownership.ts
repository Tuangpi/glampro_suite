import { conflict } from "../lib/http-error.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";
import {
  verifyPayrollValueSharing,
  type PayrollValueSharing,
} from "./payroll-close-value-sharing.js";

type Balance = Awaited<
  ReturnType<PayrollCloseTransaction["prepaidBalanceEvent"]["findMany"]>
>[number];
type Transfer = Awaited<
  ReturnType<PayrollCloseTransaction["prepaidTransferEvent"]["findMany"]>
>[number];
const fail = (): never => {
  throw conflict("Authoritative payroll inputs unavailable: VALUE_OWNERSHIP_HISTORY_UNCONFIRMED.");
};

/** Replay ownership and explicit consent from independent operational journals.
 * No current-owner/membership fallback, restoration, expiry edits or legacy opening. */
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
  sharedFamilyId?: string | null;
  sharing?: PayrollValueSharing;
  redemptions?: { saleId: string; customerId: string; usedAt: Date }[];
}) {
  const { balances, transfers } = input;
  const sharing = input.sharing && verifyPayrollValueSharing(input.tenantId, input.sharing);
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
    grant.sharedFamilyId !== null ||
    grant.previousSharedFamilyId !== null ||
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
  let familyId: string | null = null;
  let consentAt = grant.createdAt;
  for (const row of balances) {
    if (
      row.tenantId !== input.tenantId ||
      row.holdingId !== input.holdingId ||
      (row.expiresAt?.getTime() ?? null) !== (input.expiresAt?.getTime() ?? null) ||
      !row.delta.equals(row.amountAfter.minus(row.amountBefore)) ||
      !["GRANT", "SPEND", "TRANSFER", "SHARING"].includes(row.kind)
    )
      return fail();
  }
  while (pending.length) {
    const compatible = pending.filter(
      (row) =>
        row.previousCustomerId === owner &&
        row.previousSharedFamilyId === familyId &&
        row.amountBefore.equals(remaining),
    );
    const earliest = Math.min(...compatible.map((row) => row.createdAt.getTime()));
    const candidates = compatible.filter((row) => row.createdAt.getTime() === earliest);
    // A spend and transfer both claiming the same opening state is ambiguous.
    if (candidates.length !== 1) return fail();
    const row = candidates[0];
    if (row.createdAt.getTime() < at) return fail();
    if (familyId) {
      if (!sharing) return fail();
      sharing.assertConsentInterval(owner, familyId, consentAt, row.createdAt);
    }
    if (row.kind === "SHARING") {
      if (
        !sharing ||
        row.customerId !== owner ||
        row.sharedFamilyId === familyId ||
        !row.delta.isZero() ||
        row.saleId !== null ||
        !row.actorId ||
        !row.reason?.trim() ||
        (row.sharedFamilyId !== null &&
          (!remaining.isPositive() ||
            (input.expiresAt !== null && input.expiresAt <= row.createdAt) ||
            sharing.familyAt(owner, row.createdAt) !== row.sharedFamilyId))
      )
        return fail();
      familyId = row.sharedFamilyId;
      consentAt = row.createdAt;
    } else if (row.kind === "TRANSFER") {
      if (
        familyId !== null ||
        row.sharedFamilyId !== null ||
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
        row.sharedFamilyId !== familyId ||
        !row.delta.isNegative() ||
        row.amountAfter.isNegative() ||
        !row.saleId
      )
        return fail();
      let spender = owner;
      if (familyId) {
        const redemptions = input.redemptions?.filter((event) => event.saleId === row.saleId);
        if (!sharing || redemptions?.length !== 1) return fail();
        const redemption = redemptions[0];
        if (
          redemption.usedAt < row.createdAt ||
          sharing.familyAt(owner, row.createdAt) !== familyId ||
          sharing.familyAt(redemption.customerId, row.createdAt) !== familyId ||
          sharing.familyAt(owner, redemption.usedAt) !== familyId ||
          sharing.familyAt(redemption.customerId, redemption.usedAt) !== familyId
        )
          return fail();
        sharing.assertConsentInterval(owner, familyId, consentAt, redemption.usedAt);
        sharing.assertConsentInterval(
          redemption.customerId,
          familyId,
          row.createdAt,
          redemption.usedAt,
        );
        spender = redemption.customerId;
      }
      owners.set(row.id, spender);
      remaining = row.amountAfter;
    }
    at = Math.max(at, row.createdAt.getTime());
    pending.splice(pending.indexOf(row), 1);
  }
  if (
    owner !== input.customerId ||
    familyId !== (input.sharedFamilyId ?? null) ||
    !remaining.equals(input.amountRemaining) ||
    usedTransfers.size !== transfers.length
  )
    return fail();
  if (familyId) {
    if (!sharing) return fail();
    sharing.assertConsentInterval(owner, familyId, consentAt);
  }
  return owners;
}
