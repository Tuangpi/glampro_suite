/**
 * What was actually delivered.
 *
 * The settings tab says what *should* happen; this tab is the record of what
 * did. Three things it deliberately does not do:
 *
 * - it does not re-request anything until the tab is opened (`MessagingCard`
 *   keeps the panel unmounted until first visit), so a salon that never looks
 *   here never pays for the query;
 * - it does not offer Retry on a row the API would refuse — `retryMessage`
 *   accepts only a `FAILED` job with no provider id and no STOP reply, so the
 *   button appears on exactly those rows instead of failing on click;
 * - it does not translate a refusal. A refused retry is shown in the server's
 *   own words, because "the customer replied STOP" is the answer, not a bug.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Pagination from "@/components/ui/Pagination";
import Table, { type TableColumn } from "@/components/ui/Table";
import TableSkeleton from "@/components/ui/TableSkeleton";
import { showToast } from "@/components/ui/toast-store";
import {
  messageChannelLabel,
  messageKindLabel,
  messageReasonLabel,
  messageStatusBadge,
  messageStatusLabel,
} from "@/constants/messaging";
import { queryKeys } from "@/constants/queryKeys";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { get, getErrorMessage, post } from "@/lib/api";

/** One row of `GET /messaging/history` — the API pages 20 at a time. */
interface HistoryRow {
  id: string;
  kind: string;
  channel: string | null;
  status: string;
  attempts: number;
  errorCode: string | null;
  dueAt: string;
  createdAt: string;
}

interface HistoryPage {
  rows: HistoryRow[];
  total: number;
  page: number;
}

const PAGE_SIZE = 20;

export default function MessageHistoryPanel({ canRetry }: { canRetry: boolean }) {
  const { tenant } = useAuth();
  const { formatDateTime } = useSalonFormatting();
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [retryError, setRetryError] = useState("");

  const query = useQuery({
    queryKey: queryKeys.messaging.history(tenant?.id, page),
    queryFn: () => get<HistoryPage>("/messaging/history", { page }),
  });

  const retry = useMutation({
    mutationFn: (id: string) => post(`/messaging/history/${id}/retry`),
    onSuccess: () => {
      setRetryError("");
      showToast("success", "Message queued again.");
      // Every page of the record, not just this one: a retry moves the job's row.
      void client.invalidateQueries({
        queryKey: queryKeys.messaging.history(tenant?.id, page).slice(0, 2),
      });
    },
    onError: (cause) => setRetryError(getErrorMessage(cause)),
  });

  const columns: TableColumn<HistoryRow>[] = [
    {
      key: "when",
      header: "Queued",
      cell: (row) => <span className="whitespace-nowrap">{formatDateTime(row.createdAt)}</span>,
    },
    { key: "message", header: "Message", cell: (row) => messageKindLabel(row.kind) },
    { key: "channel", header: "Channel", cell: (row) => messageChannelLabel(row.channel) },
    {
      key: "status",
      header: "Status",
      cell: (row) => {
        const reason = messageReasonLabel(row.errorCode);
        return (
          <div className="flex flex-col gap-1">
            <Badge variant={messageStatusBadge(row.status)} dot>
              {messageStatusLabel(row.status)}
            </Badge>
            {reason ? <span className="text-xs text-ink-muted">{reason}</span> : null}
          </div>
        );
      },
    },
    { key: "attempts", header: "Tries", align: "right", cell: (row) => row.attempts },
  ];

  if (canRetry)
    columns.push({
      key: "action",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (row) =>
        row.status === "FAILED" && row.errorCode !== "21610" ? (
          <Button
            variant="secondary"
            size="sm"
            loading={retry.isPending && retry.variables === row.id}
            onClick={() => {
              setRetryError("");
              retry.mutate(row.id);
            }}
          >
            Retry
          </Button>
        ) : null,
    });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card
      title="Delivery history"
      description="The most recent messages this salon queued, newest first."
      label="Message delivery history"
      flush
      actions={
        <Button
          variant="secondary"
          size="sm"
          loading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh
        </Button>
      }
      footer={
        pageCount > 1 ? (
          <Pagination
            page={page}
            pageCount={pageCount}
            label="Message history pages"
            onPageChange={(next) => {
              setRetryError("");
              setPage(next);
            }}
          />
        ) : null
      }
    >
      {query.isError ? (
        <div className="flex flex-col items-start gap-3 p-4">
          <p role="alert" className="text-sm text-danger">
            Delivery history could not be loaded.
          </p>
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      ) : query.isPending ? (
        <TableSkeleton
          caption="Message delivery history"
          columns={columns}
          rows={5}
          widths={{
            when: "w-32",
            message: "w-28",
            channel: "w-20",
            status: "w-24",
            attempts: "w-8",
          }}
          className="rounded-none border-0"
        />
      ) : (
        <Table
          caption="Message delivery history"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          className="rounded-none border-0"
          empty={
            <EmptyState
              title="No messages yet"
              description="Confirmations, reminders and receipts appear here once a channel is on and a booking or sale needs one."
            />
          }
        />
      )}

      {retryError ? (
        <p role="alert" className="px-4 pb-4 text-sm text-danger">
          {retryError}
        </p>
      ) : null}
    </Card>
  );
}
