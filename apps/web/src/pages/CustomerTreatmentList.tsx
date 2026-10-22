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
import type { TreatmentRecord } from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import { useCustomer } from "@/hooks/useCustomers";
import { useTreatmentList } from "@/hooks/useTreatments";
import { showToast } from "@/components/ui/toast-store";

interface CustomerTreatmentListProps {
  customerId: string;
}
export default function CustomerTreatmentList({ customerId }: CustomerTreatmentListProps) {
  const { data: customer } = useCustomer(customerId);
  const {
    data: all,
    isPending,
    isError,
    refetch,
  } = useTreatmentList({
    customerId,
    page: 1,
    pageSize: 20,
  });
  const records: TreatmentRecord[] = all?.data ?? [];

  const handleDelete = () => {
    const confirmed = window.confirm("Are you sure you want to delete this treatment record?");
    if (!confirmed) return;

    showToast("info", "Treatment record deletion is not yet implemented.");
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
        <Button type="button" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <section className="rounded-card border border-line p-4">
      <h2 className="font-bold mb-3">
        {customer?.name ? `${customer.name}'s treatment records` : "Treatment records"}
      </h2>

      {records.length === 0 ? (
        <p className="text-ink-muted">
          No treatment records found.{" "}
          <Button variant="secondary" onClick={handleNew} className="flex items-center gap-1">
            Create first record
          </Button>
        </p>
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
                  {record.startedAt ? new Date(record.startedAt).toLocaleDateString() : "—"}
                  {record.endedAt ? ` — ${new Date(record.endedAt).toLocaleDateString()}` : ""}
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
                  <Button variant="danger" size="sm" onClick={handleDelete}>
                    Delete
                  </Button>
                  <Button
                    variant="secondary"
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
        </table>
      )}
    </section>
  );
}
