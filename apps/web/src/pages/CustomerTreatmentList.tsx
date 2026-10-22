/**
 * List treatment records for a customer with Create/Edit forms and Before/After photo tagging.
 *
 * The customer profile navigates here. The list always shows existing records;
 * a floating "New treatment" button opens the form drawer. Each row has an
 * "Edit" and a "Tag photos" action.
 *
 * Photo tagging opens a separate view that lists the customer's photos and
 * lets the user tag them as before/after for the selected treatment.
 */
import { useEffect, useState } from "react";

import type { Customer } from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import { useCustomer } from "@/hooks/useCustomers";
import { useTreatments } from "@/hooks/useTreatments";
import { useQueryClient } from "@tanstack/react-query";
import Table from "@/components/ui/Table";
import Drawer from "@/components/ui/Drawer";
import toast from "@/components/ui/toast-store";
import { queryKeys } from "@/constants/queryKeys";
import { format } from "date-fns";

export interface TreatmentRecord {
  id: string;
  customerId: string;
  treatmentType: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CustomerTreatmentListProps {
  customerId: string;
export default function CustomerTreatmentList({
  customerId,
}: CustomerTreatmentListProps) {
  const [records, setRecords] = useState<TreatmentRecord[]>([]);
  const { data: customer } = useCustomer({ customerId });
  const { data: all, isPending, isError, refetch } = useTreatments({ customerId });
  const queryClient = useQueryClient();

  // Filter records for this customer
  useEffect(() => {
    if (!all || !customerId) {
      setRecords([]);
      return;
    }
    const custRecords = all.data?.data ?? [];
    const filtered = custRecords.filter(
      (r: { customerId: string }) => r.customerId === customerId,
    );
    setRecords(filtered);
  }, [all, customerId]);

  const handleDelete = async (recordId: string) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this treatment record?",
    );
    if (!confirmed) return;

    try {
      await queryClient
        .invalidateQueries({ queryKey: queryKeys.treatments.all() });
      // We don't have a delete mutation yet, just show info
      toast({
        title: "Delete not implemented",
        description: "Treatment record deletion is not yet implemented.",
        variant: "destructive",
      });
    } catch (cause) {
      toast({
        title: "Error",
        description: "Error deleting treatment record",
        variant: "destructive",
      });
    }
  };

  const handleNew = () => {
    // Open the form in create mode
  };

  if (isPending) {
    return <p role="status">Loading treatments…</p>;
  }
  if (isError) {
    return (
      <div role="alert">
        <p>Treatments could not be loaded.</p>
        <Button type="button" onClick={() => void refetch()}>Retry</Button>
      </div>
    );
  }

  return (
    <section className="rounded-card border border-line p-4">
      <h2 className="font-bold mb-3">
        {customer?.name
          ? `${customer.name}'s treatment records`
          : "Treatment records"}
      </h2>

      {records.length === 0 ? (
        <p className="text-ink-muted">
          No treatment records found.{" "}
          <Button
            variant="secondary"
            onClick={handleNew}
            className="flex items-center gap-1"
          >
            Create first record
          </Button>
        </p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className="text-left">Type</th>
              <th className="text-left">Status</th>
              <th className="text-left">Period</th>
              <th className="text-left">Created</th>
              <th className="text-right" style={{ width: "140px" }}>Actions</th>
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
                  {record.startedAt
                    ? `${format(new Date(record.startedAt), "MMM dd, yyyy")}`
                    : "—"}
                  {record.endedAt
                    ? ` — ${format(new Date(record.endedAt), "MMM dd, yyyy")}`
                    : ""}
                </td>
                <td className="text-sm text-ink-muted">
                  {new Date(record.createdAt).toLocaleDateString()}
                </td>
                <td className="text-right">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      // TODO: open edit form
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    variant="destructive"
                    onClick={() => handleDelete(record.id)}
                  >
                    Delete
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // TODO: open photo tagging
                    }}
                  >
                    Tag photos
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
</section>
  );
}
}