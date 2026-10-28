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
import { useModules } from "@/hooks/useSettings";
import { getErrorMessage, getPaginated, post } from "@/lib/api";
import CustomerFamilyCreditPanel from "./CustomerFamilyCreditPanel";
import ValuePackagePayrollDetail from "./ValuePackagePayrollDetail";

export default function CustomerPrepaidPanel({ customerId }: { customerId: string }) {
  const modules = useModules();
  if (modules.isPending) return <p role="status">Loading prepaid access…</p>;
  if (modules.isError)
    return (
      <div role="alert">
        Prepaid access could not be loaded.{" "}
        <Button onClick={() => void modules.refetch()}>Retry prepaid access</Button>
      </div>
    );
  return modules.data?.some((row) => row.code === "packages" && row.entitled) ? (
    <>
      <PrepaidPanel key={customerId} customerId={customerId} />
      <CustomerFamilyCreditPanel key={`family:${customerId}`} customerId={customerId} />
    </>
  ) : null;
}

export function PrepaidPanel({ customerId }: { customerId: string }) {
  const { user, isReadOnly } = useAuth();
  const { formatPrice, formatDateTime } = useSalonFormatting();
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [selected, setSelected] = useState<PrepaidHolding | null>(null);
  const [economicsId, setEconomicsId] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());
  const canManage =
    !isReadOnly && (user?.globalRole === "SUPER_ADMIN" || user?.globalRole === "MANAGER");
  if (selected && !canManage) setSelected(null);
  const holdings = useQuery({
    queryKey: [...queryKeys.customers.ownedPrepaid(customerId), page],
    queryFn: () =>
      getPaginated<PrepaidHolding>(`/customers/${customerId}/prepaid`, { page, pageSize: 10 }),
  });
  const history = useQuery({
    queryKey: [...queryKeys.customers.prepaidTransfers(customerId), historyPage],
    queryFn: () =>
      getPaginated<PrepaidTransferEvent>(`/customers/${customerId}/prepaid-transfers`, {
        page: historyPage,
        pageSize: 10,
      }),
  });
  return (
    <section
      aria-label="Prepaid ownership and transfers"
      className="rounded-card border border-line p-5"
    >
      <h3 className="font-bold">Prepaid ownership and transfers</h3>
      <p>
        Transfer an entire remaining prepaid holding to another customer in this salon. Balance,
        expiry and original purchase are preserved. Manage explicit family sharing below.
      </p>
      {holdings.isPending ? (
        <p role="status">Loading owned prepaid credit…</p>
      ) : holdings.isError ? (
        <div role="alert">
          {getErrorMessage(holdings.error)}{" "}
          <Button onClick={() => void holdings.refetch()}>Retry owned credit</Button>
        </div>
      ) : (
        <>
          <ul>
            {holdings.data.data.map((row) => (
              <li key={row.id} className="my-3 rounded-md border border-line p-3">
                <strong>{row.name}</strong> — {formatPrice(row.amountRemaining)} ·{" "}
                {row.expiresAt ? `Expires ${formatDateTime(row.expiresAt)}` : "No expiry"}
                <Button onClick={() => setEconomicsId(row.id)}>
                  View economics for {row.name}
                </Button>
                <Button
                  disabled={
                    !canManage ||
                    holdings.isFetching ||
                    Number(row.amountRemaining) <= 0 ||
                    (!!row.expiresAt && Date.parse(row.expiresAt) <= openedAt)
                  }
                  onClick={() => setSelected(row)}
                >
                  Transfer {row.name}
                </Button>
              </li>
            ))}
          </ul>
          {!holdings.data.total ? <p>No owned prepaid credit.</p> : null}
          <Pagination
            page={page}
            pageCount={holdings.data.pageCount}
            onPageChange={setPage}
            label="Owned prepaid pages"
          />
        </>
      )}
      <h4 className="mt-4 font-bold">Transfer history</h4>
      <p>Transfer evidence only. This is not a complete balance-change ledger.</p>
      {history.isPending ? (
        <p role="status">Loading transfer history…</p>
      ) : history.isError ? (
        <div role="alert">
          {getErrorMessage(history.error)}{" "}
          <Button onClick={() => void history.refetch()}>Retry transfer history</Button>
        </div>
      ) : (
        <>
          <ul>
            {history.data.data.map((event) => (
              <li key={event.id} className="my-3 whitespace-pre-wrap break-words">
                {formatDateTime(event.createdAt)} · {formatPrice(event.amount)} · From account{" "}
                {event.fromCustomerId} to account {event.toCustomerId} · By {event.actorId}
                <p>
                  Holding: {event.holdingId} ·{" "}
                  {event.expiresAt ? `Expires ${formatDateTime(event.expiresAt)}` : "No expiry"}
                </p>
                <p>Reason: {event.reason}</p>
              </li>
            ))}
          </ul>
          {!history.data.total ? (
            <p>No recorded transfers. Earlier activity is not backfilled.</p>
          ) : null}
          <Pagination
            page={historyPage}
            pageCount={history.data.pageCount}
            onPageChange={setHistoryPage}
            label="Prepaid transfer history pages"
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
      {selected && canManage ? (
        <TransferDialog
          key={selected.id}
          holding={selected}
          refreshing={
            holdings.isFetching ||
            holdings.isError ||
            !holdings.data?.data.some(
              (row) => row.id === selected.id && row.updatedAt === selected.updatedAt,
            )
          }
          onClose={() => setSelected(null)}
          onTransferred={() => {
            setSelected(null);
            void client.invalidateQueries({ queryKey: queryKeys.customers.all() });
          }}
        />
      ) : null}
    </section>
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
