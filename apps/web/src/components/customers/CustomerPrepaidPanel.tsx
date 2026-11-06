import { useState } from "react";
import { queryKeys } from "@/constants/queryKeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  transferPrepaidSchema,
  type PrepaidHolding,
  type PrepaidTransferEvent,
  type CustomerSummary,
} from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Pagination from "@/components/ui/Pagination";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { useCustomerList } from "@/hooks/useCustomers";
import { getErrorMessage, getPaginated, post } from "@/lib/api";
import ShareHoldingDialog from "./ShareHoldingDialog";
import ValuePackagePayrollDetail from "./ValuePackagePayrollDetail";

/**
 * The prepaid-credit half of a customer's holdings: one row per holding and the three
 * things a manager can do with it — read its purchase, transfer it whole, or share it.
 *
 * Rows take `Private`/`Shared` from `sharedFamilyId` alone, so the family itself is only
 * read when a share is actually attempted. Transfer evidence and the balance audit are
 * not here: a holding is listed once, and the evidence sits behind History.
 */
export function PrepaidHoldings({ customerId }: { customerId: string }) {
  const { user, isReadOnly } = useAuth();
  const { formatPrice, formatDateTime } = useSalonFormatting();
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PrepaidHolding | null>(null);
  const [sharing, setSharing] = useState<PrepaidHolding | null>(null);
  const [economicsId, setEconomicsId] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());
  const canManage =
    !isReadOnly && (user?.globalRole === "SUPER_ADMIN" || user?.globalRole === "MANAGER");
  if (selected && !canManage) setSelected(null);
  if (sharing && !canManage) setSharing(null);
  const holdings = useQuery({
    queryKey: [...queryKeys.customers.ownedPrepaid(customerId), page],
    queryFn: () =>
      getPaginated<PrepaidHolding>(`/customers/${customerId}/prepaid`, { page, pageSize: 10 }),
  });
  /** A row whose snapshot moved under an open dialog must not be written against. */
  const stale = (row: PrepaidHolding) =>
    holdings.isFetching ||
    holdings.isError ||
    !holdings.data?.data.some(
      (current) => current.id === row.id && current.updatedAt === row.updatedAt,
    );
  const expired = (row: PrepaidHolding) => !!row.expiresAt && Date.parse(row.expiresAt) <= openedAt;
  return (
    <div className="mt-4">
      <h4 className="px-2 text-2xs font-heavy tracking-wide text-ink-muted uppercase">
        Prepaid credit
      </h4>
      {holdings.isPending ? (
        <p role="status" className="px-2 py-2 text-sm">
          Loading prepaid credit…
        </p>
      ) : holdings.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 px-2 py-2 text-sm">
          {getErrorMessage(holdings.error)}{" "}
          <Button size="sm" variant="secondary" onClick={() => void holdings.refetch()}>
            Retry owned credit
          </Button>
        </div>
      ) : (
        <>
          {holdings.data.data.length ? (
            <ul className="divide-y divide-line-soft px-2">
              {holdings.data.data.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{row.name}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {formatPrice(row.amountRemaining)} left ·{" "}
                      {row.expiresAt ? `expires ${formatDateTime(row.expiresAt)}` : "no expiry"} ·{" "}
                      {row.sharedFamilyId ? "Shared" : "Private"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEconomicsId(row.id)}>
                      Purchase &amp; payments for {row.name}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={
                        !canManage ||
                        holdings.isFetching ||
                        Number(row.amountRemaining) <= 0 ||
                        expired(row)
                      }
                      onClick={() => setSelected(row)}
                    >
                      Transfer {row.name}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={
                        !canManage ||
                        holdings.isFetching ||
                        (!row.sharedFamilyId && (Number(row.amountRemaining) <= 0 || expired(row)))
                      }
                      onClick={() => setSharing(row)}
                    >
                      {row.sharedFamilyId ? "Make private" : "Share"} {row.name}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-2 text-sm text-ink-muted">
              No prepaid credit. It appears here after a credit purchase at the till.
            </p>
          )}
          <Pagination
            page={page}
            pageCount={holdings.data.pageCount}
            onPageChange={setPage}
            label="Owned prepaid pages"
          />
        </>
      )}
      {economicsId ? (
        <ValuePackagePayrollDetail
          key={`${customerId}:${economicsId}`}
          customerId={customerId}
          holdingId={economicsId}
          onClose={() => setEconomicsId(null)}
        />
      ) : null}
      {sharing && canManage ? (
        <ShareHoldingDialog
          key={`sharing:${sharing.id}`}
          customerId={customerId}
          holding={sharing}
          refreshing={stale(sharing)}
          onClose={() => setSharing(null)}
          onSaved={() => setSharing(null)}
        />
      ) : null}
      {selected && canManage ? (
        <TransferDialog
          key={selected.id}
          holding={selected}
          refreshing={stale(selected)}
          onClose={() => setSelected(null)}
          onTransferred={() => {
            setSelected(null);
            void client.invalidateQueries({ queryKey: queryKeys.customers.all() });
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Where the customer's prepaid credit came from. Evidence of a move, not a ledger: a
 * transfer changes ownership, so the entry proves the move and nothing more.
 */
export function PrepaidTransfers({ customerId }: { customerId: string }) {
  const { formatPrice, formatDateTime } = useSalonFormatting();
  const [page, setPage] = useState(1);
  const history = useQuery({
    queryKey: [...queryKeys.customers.prepaidTransfers(customerId), page],
    queryFn: () =>
      getPaginated<PrepaidTransferEvent>(`/customers/${customerId}/prepaid-transfers`, {
        page,
        pageSize: 10,
      }),
  });
  if (history.isPending) return <p role="status">Loading credit transfers…</p>;
  if (history.isError)
    return (
      <div role="alert">
        {getErrorMessage(history.error)}{" "}
        <Button onClick={() => void history.refetch()}>Retry transfer history</Button>
      </div>
    );
  return (
    <>
      <ul className="divide-y divide-line-soft">
        {history.data.data.map((event) => (
          <li key={event.id} className="py-2.5">
            <p className="text-sm text-ink">
              {formatDateTime(event.createdAt)} · {formatPrice(event.amount)} moved
            </p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Holding {event.holdingId} · account {event.fromCustomerId} to {event.toCustomerId} ·
              by {event.actorId} ·{" "}
              {event.expiresAt ? `expires ${formatDateTime(event.expiresAt)}` : "no expiry"}
            </p>
            <p className="mt-0.5 text-sm text-ink-body">Reason: {event.reason}</p>
          </li>
        ))}
      </ul>
      {history.data.total ? null : (
        <p className="py-1 text-sm text-ink-muted">No recorded transfers.</p>
      )}
      <Pagination
        page={page}
        pageCount={history.data.pageCount}
        onPageChange={setPage}
        label="Prepaid transfer history pages"
      />
    </>
  );
}

function TransferDialog({
  holding,
  refreshing,
  onClose,
  onTransferred,
}: {
  holding: PrepaidHolding;
  refreshing: boolean;
  onClose: () => void;
  onTransferred: () => void;
}) {
  const [search, setSearch] = useState("");
  const [searchPage, setSearchPage] = useState(1);
  const [target, setTarget] = useState<CustomerSummary | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { formatPrice, formatDateTime } = useSalonFormatting();
  const results = useCustomerList({ page: searchPage, pageSize: 10, search });
  const mutation = useMutation({
    mutationFn: () =>
      post<PrepaidTransferEvent>(
        `/customers/${holding.customerId}/prepaid/${holding.id}/transfer`,
        transferPrepaidSchema.parse({
          targetCustomerId: target?.id,
          expectedUpdatedAt: holding.updatedAt,
          reason,
          confirmed,
        }),
      ),
    onSuccess: onTransferred,
    onError: (error) => {
      setError(getErrorMessage(error));
      setConfirmed(false);
    },
  });
  const blocked = mutation.isPending || refreshing;
  return (
    <Modal
      open
      title="Transfer prepaid credit"
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
    >
      <p>
        {holding.name}: {formatPrice(holding.amountRemaining)} ·{" "}
        {holding.expiresAt ? `Expires ${formatDateTime(holding.expiresAt)}` : "No expiry"}
      </p>
      <p>
        The original purchase cannot be voided after a recorded transfer. Expiry does not restart.
      </p>
      <Input
        label="Find receiving customer"
        placeholder="Search by name or phone…"
        value={search}
        disabled={blocked}
        onChange={(event) => {
          setSearch(event.target.value);
          setSearchPage(1);
          setTarget(null);
          setConfirmed(false);
        }}
      />
      {results.isPending ? (
        <p role="status">Searching customers…</p>
      ) : results.isError ? (
        <div role="alert">
          Customer search failed.{" "}
          <Button onClick={() => void results.refetch()}>Retry customer search</Button>
        </div>
      ) : (
        <>
          <ul aria-label="Receiving customers">
            {results.data.data
              .filter((row) => row.id !== holding.customerId)
              .map((row) => (
                <li key={row.id}>
                  <Button
                    disabled={blocked || results.isFetching || results.isPlaceholderData}
                    onClick={() => {
                      setTarget(row);
                      setConfirmed(false);
                    }}
                  >
                    {row.name} · {row.phone ?? row.email ?? row.id}
                  </Button>
                </li>
              ))}
          </ul>
          <Pagination
            page={searchPage}
            pageCount={results.data.pageCount}
            onPageChange={(page) => {
              setSearchPage(page);
              setTarget(null);
              setConfirmed(false);
            }}
            label="Receiving customer pages"
          />
        </>
      )}
      {target ? (
        <p role="status">
          Receiving customer: {target.name} ({target.id})
        </p>
      ) : null}
      <Input
        label="Transfer reason"
        placeholder="e.g. Credit moved to the client's second profile"
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
          disabled={blocked || !target}
          onChange={(event) => setConfirmed(event.target.checked)}
        />{" "}
        I confirm the receiving customer and entire remaining balance.
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <div className="mt-4 flex gap-3">
        <Button
          disabled={blocked || !target || !reason.trim() || !confirmed}
          onClick={() => mutation.mutate()}
        >
          Confirm prepaid transfer
        </Button>
        <Button disabled={mutation.isPending} onClick={onClose}>
          Cancel transfer
        </Button>
      </div>
    </Modal>
  );
}
