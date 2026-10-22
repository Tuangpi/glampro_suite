import { useState } from "react";
import { archiveCustomerSchema, type CustomerDetail } from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
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
    <section className="rounded-card border border-line p-4" aria-label="Customer archival">
      <h3 className="font-bold">Customer archival</h3>
      <p>
        Archival hides this customer from default lists and preserves all evidence and history. It
        is not erasure, does not replace retention review, and does not block every booking, POS or
        mobile action.
      </p>
      {row.archivedAt ? (
        <div role="status">
          <p>Archived {formatDateTime(row.archivedAt)}</p>
          <p>Archived by account: {row.archivedById}</p>
          <p className="whitespace-pre-wrap break-words">Archive reason: {row.archiveReason}</p>
        </div>
      ) : (
        <Button
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
        <p>Only owners and managers in a writable salon can archive customers.</p>
      ) : null}
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
    </section>
  );
}
