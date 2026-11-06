import { useState } from "react";
import { queryKeys } from "@/constants/queryKeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  transferSessionPackageSchema,
  type SessionPackageHolding,
  type SessionPackageTransferEvent,
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
import PackagePayrollDetail from "./PackagePayrollDetail";

/**
 * The session-package half of a customer's holdings: what is left on each package and
 * the two actions a manager has on one — read its purchase, or transfer it whole.
 *
 * Sessions are whole-service units, so a transfer moves the entire remaining balance and
 * there is no partial option to offer. Redemptions and voids are evidence, and they sit
 * behind History with the rest of the audit trail.
 */
export function SessionPackageHoldings({ customerId }: { customerId: string }) {
  const { user, isReadOnly } = useAuth();
  const { formatDateTime } = useSalonFormatting();
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<SessionPackageHolding | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());
  const canManage =
    !isReadOnly && (user?.globalRole === "SUPER_ADMIN" || user?.globalRole === "MANAGER");
  if (selected && !canManage) setSelected(null);
  const holdings = useQuery({
    queryKey: [...queryKeys.customers.ownedSessionPackages(customerId), page],
    queryFn: () =>
      getPaginated<SessionPackageHolding>(`/customers/${customerId}/session-packages`, {
        page,
        pageSize: 10,
      }),
  });
  /** A row whose snapshot moved under an open dialog must not be written against. */
  const refreshing =
    holdings.isFetching ||
    holdings.isError ||
    !selected ||
    !holdings.data?.data.some(
      (current) => current.id === selected.id && current.updatedAt === selected.updatedAt,
    );
  const expired = (row: SessionPackageHolding) =>
    !!row.expiresAt && Date.parse(row.expiresAt) <= openedAt;
  return (
    <div className="mt-4">
      <h4 className="px-2 text-2xs font-heavy tracking-wide text-ink-muted uppercase">
        Session packages
      </h4>
      {holdings.isPending ? (
        <p role="status" className="px-2 py-2 text-sm">
          Loading session packages…
        </p>
      ) : holdings.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 px-2 py-2 text-sm">
          {getErrorMessage(holdings.error)}{" "}
          <Button size="sm" variant="secondary" onClick={() => void holdings.refetch()}>
            Retry owned sessions
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
                      {row.quantityRemaining} sessions left ·{" "}
                      {row.expiresAt ? `expires ${formatDateTime(row.expiresAt)}` : "no expiry"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setDetailId(row.id)}>
                      Purchase &amp; payments for {row.name}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={
                        !canManage ||
                        holdings.isFetching ||
                        row.quantityRemaining <= 0 ||
                        expired(row)
                      }
                      onClick={() => setSelected(row)}
                    >
                      Transfer {row.name}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-2 text-sm text-ink-muted">
              No session packages. They appear here after a package purchase at the till.
            </p>
          )}
          <Pagination
            page={page}
            pageCount={holdings.data.pageCount}
            onPageChange={setPage}
            label="Owned session-package pages"
          />
        </>
      )}
      {detailId ? (
        <PackagePayrollDetail
          customerId={customerId}
          holdingId={detailId}
          onClose={() => setDetailId(null)}
        />
      ) : null}
      {selected && canManage ? (
        <TransferDialog
          key={selected.id}
          holding={selected}
          refreshing={refreshing}
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
 * Where the customer's sessions went: one row per recorded transfer, whole-balance only.
 */
export function SessionPackageTransfers({ customerId }: { customerId: string }) {
  const { formatDateTime } = useSalonFormatting();
  const [page, setPage] = useState(1);
  const history = useQuery({
    queryKey: [...queryKeys.customers.sessionPackageTransfers(customerId), page],
    queryFn: () =>
      getPaginated<SessionPackageTransferEvent>(
        `/customers/${customerId}/session-package-transfers`,
        { page, pageSize: 10 },
      ),
  });
  if (history.isPending) return <p role="status">Loading session transfers…</p>;
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
              {formatDateTime(event.createdAt)} · {event.quantity} sessions moved
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
        label="Session-package transfer history pages"
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
  holding: SessionPackageHolding;
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
  const { formatDateTime } = useSalonFormatting();
  const results = useCustomerList({ page: searchPage, pageSize: 10, search });
  const mutation = useMutation({
    mutationFn: () =>
      post<SessionPackageTransferEvent>(
        `/customers/${holding.customerId}/session-packages/${holding.id}/transfer`,
        transferSessionPackageSchema.parse({
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
      title="Transfer session-package sessions"
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
    >
      <p>
        {holding.name}: {`${holding.quantityRemaining} sessions`} ·{" "}
        {holding.expiresAt ? `Expires ${formatDateTime(holding.expiresAt)}` : "No expiry"}
      </p>
      <p>
        The original purchase cannot be voided after a recorded transfer. Expiry does not restart.
        Past sales and treatment records stay with their original customer, and package purchases
        cannot be refunded.
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
        placeholder="e.g. Package moved to the client's second profile"
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
        I confirm the receiving customer and entire remaining sessions.
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <div className="mt-4 flex gap-3">
        <Button
          disabled={blocked || !target || !reason.trim() || !confirmed}
          onClick={() => mutation.mutate()}
        >
          Confirm session-package transfer
        </Button>
        <Button disabled={mutation.isPending} onClick={onClose}>
          Cancel transfer
        </Button>
      </div>
    </Modal>
  );
}
