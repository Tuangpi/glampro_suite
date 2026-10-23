import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PrepaidFamily,
  PrepaidFamilyEvent,
  PrepaidHolding,
  PrepaidBalanceEvent,
} from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Pagination from "@/components/ui/Pagination";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { get, getPaginated, post, getErrorMessage } from "@/lib/api";

type Draft = {
  kind: "create" | "join" | "leave" | "share" | "private";
  holding?: PrepaidHolding;
  expectedFamilyId: string | null;
};

export default function CustomerFamilyCreditPanel({ customerId }: { customerId: string }) {
  const { user, isReadOnly } = useAuth();
  const canManage = !isReadOnly && ["SUPER_ADMIN", "MANAGER"].includes(user?.globalRole ?? "");
  const client = useQueryClient();
  const { formatPrice, formatDateTime } = useSalonFormatting();
  const [page, setPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [membershipPage, setMembershipPage] = useState(1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openedAt] = useState(() => Date.now());
  if (draft && !canManage) setDraft(null);
  const family = useQuery({
    queryKey: ["customers", customerId, "prepaid-family"],
    queryFn: () => get<PrepaidFamily | null>(`/customers/${customerId}/prepaid-family`),
  });
  const holdings = useQuery({
    queryKey: ["customers", customerId, "sharing-holdings", page],
    queryFn: () =>
      getPaginated<PrepaidHolding>(`/customers/${customerId}/prepaid`, { page, pageSize: 10 }),
  });
  const history = useQuery({
    queryKey: ["customers", customerId, "balance-history", historyPage],
    queryFn: () =>
      getPaginated<PrepaidBalanceEvent>(`/customers/${customerId}/prepaid-balance-history`, {
        page: historyPage,
        pageSize: 10,
      }),
  });
  const membership = useQuery({
    queryKey: ["customers", customerId, "family-history", membershipPage],
    queryFn: () =>
      getPaginated<PrepaidFamilyEvent>(`/customers/${customerId}/prepaid-family-history`, {
        page: membershipPage,
        pageSize: 10,
      }),
  });
  const refreshing = family.isFetching || holdings.isFetching;
  const currentFamilyId = family.data?.id ?? null;
  return (
    <section
      aria-label="Family sharing and prepaid balance audit"
      className="rounded-card border border-line p-5"
    >
      <h3 className="font-bold">Family sharing and prepaid balance audit</h3>
      <Button
        disabled={refreshing}
        onClick={() => {
          setDraft(null);
          void client.invalidateQueries({ queryKey: ["customers"] });
        }}
      >
        Reload family and balances
      </Button>
      <p>
        Only explicitly shared holdings fund family spending. Each holding keeps its balance and
        expiry. POS draws earliest expiry first; no-expiry credit is last. Leaving a family
        withdraws your sharing without moving money. Disable sharing before transferring a holding.
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
              <p>
                Family: <strong>{family.data.name}</strong> · Family ID:{" "}
                <code>{family.data.id}</code>
              </p>
              <ul aria-label="Prepaid family members">
                {family.data.members.map((row) => (
                  <li key={row.customerId}>
                    {row.name}
                    {row.archived ? " (archived; cannot spend)" : ""}
                  </li>
                ))}
              </ul>
              <Button
                disabled={!canManage || refreshing}
                onClick={() => setDraft({ kind: "leave", expectedFamilyId: currentFamilyId })}
              >
                Leave prepaid family
              </Button>
            </>
          ) : (
            <>
              <p>No prepaid family. Legacy family references do not grant access.</p>
              <Button
                disabled={!canManage || refreshing}
                onClick={() => setDraft({ kind: "create", expectedFamilyId: null })}
              >
                Create prepaid family
              </Button>
            </>
          )}
          <Button
            disabled={!canManage || refreshing}
            onClick={() => setDraft({ kind: "join", expectedFamilyId: currentFamilyId })}
          >
            Join or change prepaid family
          </Button>
        </>
      )}
      <h4 className="mt-4 font-bold">Choose which owned holdings are shared</h4>
      {holdings.isPending ? (
        <p role="status">Loading sharing controls…</p>
      ) : holdings.isError ? (
        <div role="alert">
          {getErrorMessage(holdings.error)}{" "}
          <Button onClick={() => void holdings.refetch()}>Retry sharing holdings</Button>
        </div>
      ) : (
        <>
          <ul>
            {holdings.data.data.map((row) => (
              <li key={row.id} className="my-3">
                {row.name} · {formatPrice(row.amountRemaining)} ·{" "}
                {row.expiresAt ? `Expires ${formatDateTime(row.expiresAt)}` : "No expiry"} ·{" "}
                {row.sharedFamilyId ? "Shared" : "Private"}
                <Button
                  disabled={
                    !canManage ||
                    refreshing ||
                    family.isError ||
                    family.isPending ||
                    (!row.sharedFamilyId &&
                      (!family.data ||
                        Number(row.amountRemaining) <= 0 ||
                        (!!row.expiresAt && Date.parse(row.expiresAt) <= openedAt)))
                  }
                  onClick={() =>
                    setDraft({
                      kind: row.sharedFamilyId ? "private" : "share",
                      holding: row,
                      expectedFamilyId: currentFamilyId,
                    })
                  }
                >
                  {row.sharedFamilyId ? "Make private" : "Share"} {row.name}
                </Button>
              </li>
            ))}
          </ul>
          {!holdings.data.total ? <p>No owned holdings to share.</p> : null}
          <Pagination
            page={page}
            pageCount={holdings.data.pageCount}
            onPageChange={setPage}
            label="Sharing holding pages"
          />
        </>
      )}
      <h4 className="mt-4 font-bold">Balance audit</h4>
      <p>
        Append-only evidence from ledger activation. Opening snapshots are not historical purchases.
        Earlier activity is not reconstructed. Expiry makes credit unavailable without writing off
        its stored balance.
      </p>
      {history.isPending ? (
        <p role="status">Loading balance audit…</p>
      ) : history.isError ? (
        <div role="alert">
          {getErrorMessage(history.error)}{" "}
          <Button onClick={() => void history.refetch()}>Retry balance audit</Button>
        </div>
      ) : (
        <>
          <ul>
            {history.data.data.map((event) => (
              <li key={event.id} className="my-3 break-words">
                {formatDateTime(event.createdAt)} · {event.kind} · {formatPrice(event.amountBefore)}{" "}
                → {formatPrice(event.amountAfter)} (change {formatPrice(event.delta)})
                <p>
                  Holding {event.holdingId} · Owner {event.customerId} · By{" "}
                  {event.actorId ?? "Unknown / opening or direct database operation"}
                  {event.saleId ? ` · Sale ${event.saleId}` : ""}
                </p>
                <p>
                  {event.expiresAt ? `Expires ${formatDateTime(event.expiresAt)}` : "No expiry"} ·
                  Sharing {event.previousSharedFamilyId ?? "private"} →{" "}
                  {event.sharedFamilyId ?? "private"}
                </p>
                {event.reason ? <p>Reason: {event.reason}</p> : null}
              </li>
            ))}
          </ul>
          {!history.data.total ? <p>No balance events recorded.</p> : null}
          <Pagination
            page={historyPage}
            pageCount={history.data.pageCount}
            onPageChange={setHistoryPage}
            label="Balance audit pages"
          />
        </>
      )}
      <h4 className="mt-4 font-bold">Family membership history</h4>
      {membership.isPending ? (
        <p role="status">Loading family history…</p>
      ) : membership.isError ? (
        <div role="alert">
          {getErrorMessage(membership.error)}{" "}
          <Button onClick={() => void membership.refetch()}>Retry family history</Button>
        </div>
      ) : (
        <>
          <ul>
            {membership.data.data.map((event) => (
              <li key={event.id}>
                {formatDateTime(event.createdAt)} · {event.fromFamilyId ?? "none"} →{" "}
                {event.toFamilyId ?? "none"} · By {event.actorId} · {event.reason}
              </li>
            ))}
          </ul>
          {!membership.data.total ? <p>No membership changes recorded.</p> : null}
          <Pagination
            page={membershipPage}
            pageCount={membership.data.pageCount}
            onPageChange={setMembershipPage}
            label="Family membership history pages"
          />
        </>
      )}
      {draft && canManage ? (
        <FamilyDialog
          customerId={customerId}
          draft={draft}
          refreshing={refreshing}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            void client.invalidateQueries({ queryKey: ["customers"] });
          }}
        />
      ) : null}
    </section>
  );
}

function FamilyDialog({
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
      if (draft.kind === "join" || draft.kind === "leave")
        return post(`/customers/${customerId}/prepaid-family-membership`, {
          ...common,
          familyId: draft.kind === "leave" ? null : value.trim(),
          expectedFamilyId: draft.expectedFamilyId,
        });
      return post(`/customers/${customerId}/prepaid/${draft.holding!.id}/sharing`, {
        ...common,
        familyId: draft.kind === "private" ? null : draft.expectedFamilyId,
        expectedUpdatedAt: draft.holding!.updatedAt,
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
        Action: {draft.kind}
        {draft.holding ? ` ${draft.holding.name}` : ""}. Sharing gives current family members
        permission to spend this holding. Changing or leaving a family makes your shared holdings
        private; it never transfers value or restarts expiry.
      </p>
      {needsValue ? (
        <Input
          label={draft.kind === "create" ? "New prepaid family name" : "Target prepaid family ID"}
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
        I confirm this family or sharing change.
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
