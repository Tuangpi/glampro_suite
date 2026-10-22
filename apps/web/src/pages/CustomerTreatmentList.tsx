/**
 * Customer-profile treatment history with create/edit drawers and confirmed deletion.
 * POS owns all package deductions and reversals; these actions only document care.
 */
import { useState } from "react";
import type { TreatmentRecord } from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import { useCustomer } from "@/hooks/useCustomers";
import { useDeleteTreatment, useTreatmentList } from "@/hooks/useTreatments";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import TreatmentRecordForm from "@/components/treatments/TreatmentRecordForm";
import Pagination from "@/components/ui/Pagination";
import Modal from "@/components/ui/Modal";
import { getErrorMessage } from "@/lib/api";

interface CustomerTreatmentListProps {
  customerId: string;
}
export default function CustomerTreatmentList({ customerId }: CustomerTreatmentListProps) {
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<TreatmentRecord | "new" | null>(null);
  const [deleting, setDeleting] = useState<TreatmentRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { isReadOnly } = useAuth();
  const { formatDate } = useSalonFormatting();
  const remove = useDeleteTreatment();
  const { data: customer } = useCustomer(customerId);
  const {
    data: all,
    isPending,
    isError,
    refetch,
  } = useTreatmentList({
    customerId,
    page,
    pageSize: 20,
  });
  const records: TreatmentRecord[] = all?.data ?? [];

  async function handleDelete() {
    if (!deleting || isReadOnly) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync(deleting.id);
      setDeleting(null);
      if (records.length === 1 && page > 1) setPage(page - 1);
    } catch (error) {
      setDeleteError(getErrorMessage(error));
    }
  }

  if (isPending) {
    return <p role="status">Loading treatments…</p>;
  }
  if (isError) {
    return (
      <div role="alert">
        <p>Treatments could not be loaded.</p>
        <Button type="button" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <section className="rounded-card border border-line p-4" aria-label="Treatment records">
      <h2 className="font-bold mb-3">
        {customer?.name ? `${customer.name}'s treatment records` : "Treatment records"}
      </h2>
      <Button disabled={isReadOnly} onClick={() => setEditor("new")}>
        New treatment
      </Button>

      {records.length === 0 ? (
        <p className="text-ink-muted">No treatment records found.</p>
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">Customer treatment records</caption>
          <thead>
            <tr>
              <th className="text-left">Type</th>
              <th className="text-left">Status</th>
              <th className="text-left">Package sessions</th>
              <th className="text-left">Period</th>
              <th className="text-left">Created</th>
              <th className="text-right" style={{ width: "140px" }}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                <td className="font-medium">{record.treatmentType}</td>
                <td>
                  <span
                    className={[
                      "px-2",
                      "py-0.5",
                      "text-xs",
                      record.status === "COMPLETED"
                        ? "bg-success/10 text-success"
                        : record.status === "CANCELLED"
                          ? "bg-danger/10 text-danger"
                          : record.status === "IN_PROGRESS"
                            ? "bg-warning/10 text-warning"
                            : "",
                    ].join(" ")}
                  >
                    {record.status}
                  </span>
                </td>
                <td>
                  {record.packageRedemptionId
                    ? `${record.quantityConsumed} — ${record.packageRedemptionRevertedAt ? "POS reversed" : "POS linked"}`
                    : record.quantityConsumed > 0
                      ? `${record.quantityConsumed} — historical, unverified`
                      : "—"}
                </td>
                <td>
                  {formatDate(record.startedAt)}
                  {record.endedAt ? ` — ${formatDate(record.endedAt)}` : ""}
                </td>
                <td className="text-sm text-ink-muted">{formatDate(record.createdAt)}</td>
                <td className="text-right">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isReadOnly}
                    onClick={() => setEditor(record)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={isReadOnly}
                    onClick={() => {
                      setDeleteError(null);
                      setDeleting(record);
                    }}
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination
        page={page}
        pageCount={all?.pageCount ?? 0}
        onPageChange={setPage}
        label="Treatment pages"
      />
      {editor !== null && !isReadOnly ? (
        <TreatmentRecordForm
          key={editor === "new" ? "new" : editor.id}
          open
          record={
            editor === "new"
              ? { customerId, treatmentType: "", status: "SCHEDULED", quantityConsumed: 0 }
              : {
                  ...editor,
                  appointmentId: editor.appointmentId ?? undefined,
                  staffId: editor.staffId ?? undefined,
                  serviceId: editor.serviceId ?? undefined,
                }
          }
          recordId={editor === "new" ? null : editor.id}
          lockCustomer
          onClose={() => setEditor(null)}
          onSaved={() => {
            setPage(1);
          }}
        />
      ) : null}
      <Modal
        open={deleting !== null && !isReadOnly}
        onClose={() => {
          if (!remove.isPending) setDeleting(null);
        }}
        title="Delete treatment record?"
      >
        <p>
          Delete {deleting?.treatmentType}? This removes clinical documentation, not the POS
          redemption. Package balances will not change.
        </p>
        {deleteError ? <p role="alert">{deleteError}</p> : null}
        <Button disabled={remove.isPending} variant="secondary" onClick={() => setDeleting(null)}>
          Cancel
        </Button>
        <Button
          disabled={remove.isPending || isReadOnly}
          variant="danger"
          onClick={() => void handleDelete()}
        >
          Confirm delete
        </Button>
      </Modal>
    </section>
  );
}
