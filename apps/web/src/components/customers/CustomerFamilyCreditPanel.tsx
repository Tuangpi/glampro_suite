import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PrepaidFamily, PrepaidFamilyEvent, PrepaidBalanceEvent } from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Pagination from "@/components/ui/Pagination";
import { queryKeys } from "@/constants/queryKeys";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { get, getPaginated, post, getErrorMessage } from "@/lib/api";

type Draft = {
  kind: "create" | "join" | "leave";
  expectedFamilyId: string | null;
};

/**
 * Who this customer shares credit with, and who is in the family at all.
 *
 * Sharing itself is per holding and lives on the credit rows: this card is the membership
 * side alone, so a holding is never listed twice and "shared or private" is read where the
 * balance is. Nothing on this card moves money — joining, changing and leaving family all
 * only add or withdraw permission.
 */
export function FamilySharingCard({ customerId }: { customerId: string }) {
  const { user, isReadOnly } = useAuth();
  const canManage = !isReadOnly && ["SUPER_ADMIN", "MANAGER"].includes(user?.globalRole ?? "");
  const client = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  if (draft && !canManage) setDraft(null);
  const family = useQuery({
    queryKey: queryKeys.customers.prepaidFamily(customerId),
    queryFn: () => get<PrepaidFamily | null>(`/customers/${customerId}/prepaid-family`),
  });
  const refreshing = family.isFetching;
  const currentFamilyId = family.data?.id ?? null;
  return (
    <Card
      title="Family sharing"
      label="Family sharing"
      description="Only holdings you explicitly share fund family spending. Sharing is switched on each credit row."
    >
      <p className="py-1 text-sm text-ink-body">
        Each holding keeps its own balance and expiry, and the till draws the earliest expiry first.
        Leaving a family withdraws sharing without moving money.
      </p>
      {family.isPending ? (
        <p role="status">Loading prepaid family…</p>
      ) : family.isError ? (
        <div role="alert">
          {getErrorMessage(family.error)}{" "}
          <Button onClick={() => void family.refetch()}>Retry family</Button>
        </div>
      ) : (
        <>
          {family.data ? (
            <>
              <p className="py-1 text-sm">
                Family: <strong>{family.data.name}</strong>
              </p>
              <p className="text-xs text-ink-muted">Family ID: {family.data.id}</p>
              <ul aria-label="Prepaid family members" className="mt-2 flex flex-col gap-1 text-sm">
                {family.data.members.map((row) => (
                  <li key={row.customerId}>
                    {row.name}
                    {row.archived ? " (archived; cannot spend)" : ""}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="py-1 text-sm text-ink-body">
              No prepaid family. Legacy family references do not grant access.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {family.data ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={!canManage || refreshing}
                onClick={() => setDraft({ kind: "leave", expectedFamilyId: currentFamilyId })}
              >
                Leave prepaid family
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={!canManage || refreshing}
                onClick={() => setDraft({ kind: "create", expectedFamilyId: null })}
              >
                Create prepaid family
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={!canManage || refreshing}
              onClick={() => setDraft({ kind: "join", expectedFamilyId: currentFamilyId })}
            >
              Join or change prepaid family
            </Button>
          </div>
        </>
      )}
      {draft && canManage ? (
        <FamilyChangeDialog
          customerId={customerId}
          draft={draft}
          refreshing={refreshing}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            void client.invalidateQueries({ queryKey: queryKeys.customers.all() });
          }}
        />
      ) : null}
    </Card>
  );
}

/**
 * The append-only balance ledger. It proves what happened after activation and does not
 * claim to reconstruct anything before it: an opening snapshot is the balance a holding
 * started with, not a purchase, and expiry makes credit unavailable without writing its
 * stored balance off.
 */
export function HoldingBalanceAudit({ customerId }: { customerId: string }) {
  const { formatPrice, formatDateTime } = useSalonFormatting();
  const [page, setPage] = useState(1);
  const history = useQuery({
    queryKey: [...queryKeys.customers.prepaidBalanceHistory(customerId), page],
    queryFn: () =>
      getPaginated<PrepaidBalanceEvent>(`/customers/${customerId}/prepaid-balance-history`, {
        page,
        pageSize: 10,
      }),
  });
  if (history.isPending) return <p role="status">Loading balance audit…</p>;
  if (history.isError)
    return (
      <div role="alert">
        {getErrorMessage(history.error)}{" "}
        <Button onClick={() => void history.refetch()}>Retry balance audit</Button>
      </div>
    );
  return (
    <>
      <p className="pb-2 text-sm text-ink-muted">
        Append-only evidence from ledger activation. Opening snapshots are not historical purchases.
        Earlier activity is not reconstructed. Expiry makes credit unavailable without writing off
        its stored balance.
      </p>
      <ul className="divide-y divide-line-soft">
        {history.data.data.map((event) => (
          <li key={event.id} className="py-2.5">
            <p className="text-sm text-ink">
              {formatDateTime(event.createdAt)} · {event.kind} · {formatPrice(event.amountBefore)} →{" "}
              {formatPrice(event.amountAfter)} (change {formatPrice(event.delta)})
            </p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Holding {event.holdingId} · owner {event.customerId} · by{" "}
              {event.actorId ?? "Unknown / opening or direct database operation"}
              {event.saleId ? ` · sale ${event.saleId}` : ""}
              {" · "}
              {event.expiresAt ? `expires ${formatDateTime(event.expiresAt)}` : "no expiry"} ·
              sharing {event.previousSharedFamilyId ?? "private"} →{" "}
              {event.sharedFamilyId ?? "private"}
            </p>
            {event.reason ? (
              <p className="mt-0.5 text-sm text-ink-body">Reason: {event.reason}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {history.data.total ? null : (
        <p className="py-1 text-sm text-ink-muted">No balance events recorded.</p>
      )}
      <Pagination
        page={page}
        pageCount={history.data.pageCount}
        onPageChange={setPage}
        label="Balance audit pages"
      />
    </>
  );
}

/** Moves in and out of families, in order. Nothing here moves value. */
export function PrepaidMembershipHistory({ customerId }: { customerId: string }) {
  const { formatDateTime } = useSalonFormatting();
  const [page, setPage] = useState(1);
  const membership = useQuery({
    queryKey: [...queryKeys.customers.prepaidFamilyHistory(customerId), page],
    queryFn: () =>
      getPaginated<PrepaidFamilyEvent>(`/customers/${customerId}/prepaid-family-history`, {
        page,
        pageSize: 10,
      }),
  });
  if (membership.isPending) return <p role="status">Loading family history…</p>;
  if (membership.isError)
    return (
      <div role="alert">
        {getErrorMessage(membership.error)}{" "}
        <Button onClick={() => void membership.refetch()}>Retry family history</Button>
      </div>
    );
  return (
    <>
      <ul className="divide-y divide-line-soft">
        {membership.data.data.map((event) => (
          <li key={event.id} className="py-2.5 text-sm">
            {formatDateTime(event.createdAt)} · {event.fromFamilyId ?? "none"} →{" "}
            {event.toFamilyId ?? "none"}
            <p className="mt-0.5 text-xs text-ink-muted">
              By {event.actorId} · {event.reason}
            </p>
          </li>
        ))}
      </ul>
      {membership.data.total ? null : (
        <p className="py-1 text-sm text-ink-muted">No membership changes recorded.</p>
      )}
      <Pagination
        page={page}
        pageCount={membership.data.pageCount}
        onPageChange={setPage}
        label="Family membership history pages"
      />
    </>
  );
}

function FamilyChangeDialog({
  customerId,
  draft,
  refreshing,
  onClose,
  onSaved,
}: {
  customerId: string;
  draft: Draft;
  refreshing: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const mutation = useMutation({
    mutationFn: async () => {
      const common = { reason: reason.trim(), confirmed: true };
      if (draft.kind === "create")
        return post(`/customers/${customerId}/prepaid-family`, { ...common, name: value.trim() });
      return post(`/customers/${customerId}/prepaid-family-membership`, {
        ...common,
        familyId: draft.kind === "leave" ? null : value.trim(),
        expectedFamilyId: draft.expectedFamilyId,
      });
    },
    onSuccess: onSaved,
    onError: () => setConfirmed(false),
  });
  const needsValue = draft.kind === "create" || draft.kind === "join";
  const blocked = mutation.isPending || refreshing;
  return (
    <Modal
      open
      title="Confirm prepaid family change"
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
    >
      <p>
        Action: {draft.kind}. Sharing gives current family members permission to spend a shared
        holding. Changing or leaving a family makes your shared holdings private; it never transfers
        value or restarts expiry.
      </p>
      {needsValue ? (
        <Input
          label={draft.kind === "create" ? "New prepaid family name" : "Target prepaid family ID"}
          placeholder={draft.kind === "create" ? "e.g. Tan family credit" : undefined}
          hint={
            draft.kind === "create"
              ? undefined
              : "Copy it from the other profile's Family sharing card."
          }
          value={value}
          maxLength={draft.kind === "create" ? 100 : 64}
          disabled={blocked}
          onChange={(event) => {
            setValue(event.target.value);
            setConfirmed(false);
          }}
        />
      ) : null}
      <Input
        label="Family change reason"
        placeholder="e.g. Credit split after the children turned 18"
        value={reason}
        maxLength={2000}
        disabled={blocked}
        onChange={(event) => {
          setReason(event.target.value);
          setConfirmed(false);
        }}
      />
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={blocked}
          onChange={(event) => setConfirmed(event.target.checked)}
        />{" "}
        I confirm this family change.
      </label>
      {mutation.isError ? (
        <p role="alert">
          {getErrorMessage(mutation.error)} Reload current family and balances before retrying a
          stale change.
        </p>
      ) : null}
      <Button
        disabled={blocked || !confirmed || !reason.trim() || (needsValue && !value.trim())}
        onClick={() => mutation.mutate()}
      >
        Confirm family change
      </Button>
      <Button disabled={mutation.isPending} onClick={onClose}>
        Cancel family change
      </Button>
    </Modal>
  );
}
