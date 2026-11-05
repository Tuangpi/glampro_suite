import { useState } from "react";
import { archiveCustomerSchema, type CustomerDetail } from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { useArchiveCustomer } from "@/hooks/useCustomers";
import { getErrorMessage } from "@/lib/api";

export default function CustomerArchivePanel({
  customer,
  refreshing = false,
}: {
  customer: CustomerDetail;
  refreshing?: boolean;
}) {
  const { user, isReadOnly } = useAuth();
  const { formatDateTime } = useSalonFormatting();
  const mutation = useArchiveCustomer();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [archived, setArchived] = useState<CustomerDetail | null>(null);
  const row = archived ?? customer;
  const canManage =
    !isReadOnly && (user?.globalRole === "SUPER_ADMIN" || user?.globalRole === "MANAGER");
  // Losing permission invalidates an open confirmation, even if the role returns.
  if (open && !canManage) setOpen(false);
  async function archive() {
    if (!canManage || mutation.isPending || refreshing || row.archivedAt) return;
    const parsed = archiveCustomerSchema.safeParse({ reason });
    if (!parsed.success) {
      setError("Provide an archive reason (up to 2000 characters).");
      return;
    }
    setError(null);
    try {
      setArchived(await mutation.mutateAsync({ id: customer.id, input: parsed.data }));
      setOpen(false);
    } catch (error) {
      setError(getErrorMessage(error));
    }
  }
  return (
    <Card title="Archival" label="Archival">
      <div className="flex flex-col gap-3 py-1">
        <p className="text-sm text-ink-muted">
          Archival hides this customer from default lists and preserves all evidence and history. It
          is not erasure, does not replace retention review, and does not block every booking, POS
          or mobile action.
        </p>
        {row.archivedAt ? (
          <div role="status" className="flex flex-col gap-1 rounded-md bg-surface-2 px-3 py-2">
            <p className="text-sm font-bold text-ink">Archived {formatDateTime(row.archivedAt)}</p>
            <p className="text-sm text-ink-body">Archived by account: {row.archivedById}</p>
            <p className="text-sm whitespace-pre-wrap break-words text-ink-body">
              Archive reason: {row.archiveReason}
            </p>
          </div>
        ) : (
          <Button
            variant="danger"
            className="w-full"
            disabled={!canManage || refreshing}
            onClick={() => {
              setOpen(true);
              setError(null);
            }}
          >
            Archive customer
          </Button>
        )}
        {!canManage && !row.archivedAt ? (
          <p className="text-xs text-ink-muted">
            Only owners and managers in a writable salon can archive customers.
          </p>
        ) : null}
      </div>
      <Modal
        open={open && canManage && !row.archivedAt}
        title="Archive customer?"
        onClose={() => {
          if (!mutation.isPending) setOpen(false);
        }}
      >
        <p>
          Archive {customer.name}? Evidence and balances will not be erased. Find archived records
          using “Include archived customers”. This screen does not offer restoration or disposal.
        </p>
        <Input
          label="Archive reason"
          placeholder="e.g. Duplicate profile merged into CUS-0104"
          value={reason}
          maxLength={2000}
          required
          disabled={mutation.isPending}
          onChange={(event) => setReason(event.target.value)}
        />
        {error ? <p role="alert">{error}</p> : null}
        <Button variant="secondary" disabled={mutation.isPending} onClick={() => setOpen(false)}>
          Cancel archival
        </Button>
        <Button
          disabled={mutation.isPending || refreshing || !reason.trim()}
          onClick={() => void archive()}
        >
          Confirm archive
        </Button>
      </Modal>
    </Card>
  );
}
