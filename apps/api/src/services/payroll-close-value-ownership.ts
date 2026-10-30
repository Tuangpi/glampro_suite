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
 * Map insertion order retains the independently replayed SPEND/RESTORE sequence.
 * Restorations still require operational-void/payroll verification by the loader.
 * Expiry changes replay independently; no current-owner/membership or legacy fallback. */
export function replayPayrollValueOwnership(input: {
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
  redemptions?: {
    saleId: string;
    customerId: string;
    usedAt: Date;
    amount?: Balance["amountAfter"] | null;
    revertedAt?: Date | null;
  }[];
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
  const expiresAtByBalanceId = new Map<string, Date | null>();
  const usedTransfers = new Set<string>();
  let owner = input.originalCustomerId;
  let remaining = input.amount;
  let at = grant.createdAt.getTime();
  let familyId: string | null = null;
  let consentAt = grant.createdAt;
  let expiresAt = grant.expiresAt;
  for (const row of balances) {
    if (
      row.tenantId !== input.tenantId ||
      row.holdingId !== input.holdingId ||
      (row.expiresAt !== null && !Number.isFinite(row.expiresAt.getTime())) ||
      !row.delta.equals(row.amountAfter.minus(row.amountBefore)) ||
      !Number.isFinite(row.createdAt.getTime()) ||
      row.amountBefore.isNegative() ||
      row.amountAfter.isNegative() ||
      row.amountAfter.greaterThan(input.amount) ||
      !row.amountBefore.mul(100).isInteger() ||
      !row.amountAfter.mul(100).isInteger() ||
      !["GRANT", "SPEND", "RESTORE", "TRANSFER", "SHARING", "EXPIRY_CHANGE"].includes(row.kind)
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
    const earliest = Math.min(...pending.map((row) => row.createdAt.getTime()));
    const candidates = compatible.filter((row) => row.createdAt.getTime() === earliest);
    // A spend and transfer both claiming the same opening state is ambiguous.
    if (
      candidates.length !== 1 ||
      pending.filter((row) => row.createdAt.getTime() === earliest).length !== 1
    )
      return fail();
    const row = candidates[0];
    if (row.createdAt.getTime() < at) return fail();
    if (
      row.kind !== "EXPIRY_CHANGE" &&
      (row.expiresAt?.getTime() ?? null) !== (expiresAt?.getTime() ?? null)
    )
      return fail();
    if (familyId) {
      if (!sharing) return fail();
      sharing.assertConsentInterval(owner, familyId, consentAt, row.createdAt);
    }
    if (row.kind === "EXPIRY_CHANGE") {
      if (
        row.customerId !== owner ||
        row.sharedFamilyId !== familyId ||
        !row.delta.isZero() ||
        row.saleId !== null ||
        !row.actorId ||
        !row.reason?.trim() ||
        (row.expiresAt?.getTime() ?? null) === (expiresAt?.getTime() ?? null)
      )
        return fail();
      expiresAt = row.expiresAt;
    } else if (row.kind === "SHARING") {
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
            (expiresAt !== null && expiresAt <= row.createdAt) ||
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
        (expiresAt !== null && expiresAt <= row.createdAt) ||
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
          (event.expiresAt?.getTime() ?? null) === (expiresAt?.getTime() ?? null) &&
          (expiresAt === null || event.createdAt < expiresAt),
      );
      if (matches.length !== 1) return fail();
      usedTransfers.add(matches[0].id);
      owner = row.customerId;
      at = matches[0].createdAt.getTime();
    } else if (row.kind === "RESTORE") {
      const matches = input.redemptions?.filter(
        (event) =>
          event.saleId === row.saleId &&
          event.amount?.equals(row.delta) &&
          event.revertedAt &&
          event.usedAt <= row.createdAt &&
          row.createdAt <= event.revertedAt,
      );
      if (
        row.customerId !== owner ||
        row.sharedFamilyId !== familyId ||
        !row.saleId ||
        !row.actorId ||
        !row.reason?.trim() ||
        !row.delta.isPositive() ||
        row.amountAfter.greaterThan(input.amount) ||
        matches?.length !== 1
      )
        return fail();
      owners.set(row.id, owner);
      remaining = row.amountAfter;
      // No later ledger operation may cross the operational restoration append.
      at = matches[0].revertedAt!.getTime();
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
      const spends = input.redemptions?.filter((event) => event.saleId === row.saleId);
      if (input.redemptions) {
        if (
          spends?.length !== 1 ||
          !Number.isFinite(spends[0].usedAt.getTime()) ||
          spends[0].usedAt < row.createdAt ||
          (expiresAt !== null && spends[0].usedAt >= expiresAt)
        )
          return fail();
        // Transaction-start ledger time must not let an expiry edit cross the
        // independently recorded operational spend timestamp.
        at = spends[0].usedAt.getTime();
      }
      if (expiresAt !== null && row.createdAt >= expiresAt) return fail();
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
    expiresAtByBalanceId.set(row.id, expiresAt === null ? null : new Date(expiresAt));
    at = Math.max(at, row.createdAt.getTime());
    pending.splice(pending.indexOf(row), 1);
  }
  if (
    owner !== input.customerId ||
    familyId !== (input.sharedFamilyId ?? null) ||
    !remaining.equals(input.amountRemaining) ||
    (expiresAt?.getTime() ?? null) !== (input.expiresAt?.getTime() ?? null) ||
    usedTransfers.size !== transfers.length
  )
    return fail();
  if (familyId) {
    if (!sharing) return fail();
    sharing.assertConsentInterval(owner, familyId, consentAt);
  }
  return { owners, expiresAtByBalanceId };
}

/** Compatibility seam for callers that only need historical spend ownership. */
export function resolvePayrollValueOwnership(
  input: Parameters<typeof replayPayrollValueOwnership>[0],
) {
  return replayPayrollValueOwnership(input).owners;
}
