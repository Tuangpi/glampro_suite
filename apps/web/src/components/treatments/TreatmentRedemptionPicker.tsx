import { useState } from "react";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import { useTreatmentRedemptions } from "@/hooks/useTreatments";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { getErrorMessage } from "@/lib/api";

interface Props {
  customerId: string;
  serviceId: string;
  redemptionId: string;
  fixedService: boolean;
  disabled: boolean;
  error?: string;
  onChange: (redemptionId: string, serviceId: string) => void;
}

export default function TreatmentRedemptionPicker(props: Props) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<{ value: string; label: string } | null>(null);
  const { formatDateTime } = useSalonFormatting();
  const query = useTreatmentRedemptions(
    props.customerId,
    props.fixedService ? props.serviceId || undefined : undefined,
    page,
  );
  const options = (query.data?.data ?? []).flatMap((redemption) =>
    redemption.services.map((service) => ({
      value: `${redemption.id}:${service.id}`,
      label: `${redemption.receiptNumber === null ? "Receipt not assigned" : `Receipt #${redemption.receiptNumber}`} · ${formatDateTime(redemption.usedAt)} · ${redemption.packageName} · ${service.name} · ${redemption.quantity} session(s)`,
    })),
  );
  const value = props.redemptionId ? `${props.redemptionId}:${props.serviceId}` : "";
  if (value && !options.some((option) => option.value === value)) {
    options.unshift(
      selected?.value === value
        ? selected
        : { value, label: "Current POS evidence — kept unchanged (may have been reversed)" },
    );
  }
  return (
    <div className="space-y-2">
      <Select
        label="POS package redemption"
        value={value}
        options={[{ value: "", label: "No POS evidence linked" }, ...options]}
        disabled={props.disabled || !props.customerId || (props.fixedService && !props.serviceId)}
        error={props.error}
        hint="POS owns deductions; linking the whole redemption here never deducts again. One treatment per redemption."
        onChange={(event) => {
          const next = event.target.value;
          setSelected(options.find((option) => option.value === next) ?? null);
          const [id, serviceId] = next.split(":");
          props.onChange(id ?? "", serviceId ?? props.serviceId);
        }}
      />
      {!props.customerId ? <p>Select a customer to find POS evidence.</p> : null}
      {props.fixedService && !props.serviceId ? (
        <p>This historical record has no service. It cannot link POS evidence.</p>
      ) : null}
      {query.isPending && props.customerId ? <p role="status">Loading POS redemptions…</p> : null}
      {query.isError ? (
        <div role="alert">
          {getErrorMessage(query.error)}{" "}
          <Button type="button" variant="secondary" onClick={() => void query.refetch()}>
            Retry redemptions
          </Button>
        </div>
      ) : null}
      {query.data && query.data.data.length === 0 ? (
        <p>
          No eligible POS redemptions on this page. Existing evidence is preserved. Complete a
          package redemption in POS first if needed.
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={props.disabled || page <= 1 || query.isFetching}
          onClick={() => setPage(page - 1)}
        >
          Previous redemptions
        </Button>
        <span>
          Page {page} of {Math.max(1, query.data?.pageCount ?? 1)}
        </span>
        <Button
          type="button"
          variant="secondary"
          disabled={
            props.disabled || !query.data || page >= query.data.pageCount || query.isFetching
          }
          onClick={() => setPage(page + 1)}
        >
          Next redemptions
        </Button>
      </div>
    </div>
  );
}
