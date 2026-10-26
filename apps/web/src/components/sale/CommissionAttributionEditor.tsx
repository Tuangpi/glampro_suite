import { useState } from "react";
import {
  commissionAttributionSchema,
  type CommissionAttribution,
  type CommissionShares,
} from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
import { CONTROL_CLASS } from "@/components/ui/Field";
import type { StaffOption } from "./CartLine";

interface Props {
  value?: CommissionAttribution;
  sellers?: StaffOption[];
  performers?: StaffOption[];
  disabled: boolean;
  onChange: (value: CommissionAttribution | undefined) => void;
}

export default function CommissionAttributionEditor({
  value,
  sellers,
  performers,
  disabled,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CommissionAttribution>(value ?? {});
  const [error, setError] = useState<string | null>(null);
  function group(kind: "sellers" | "performers", options: StaffOption[]) {
    const rows = draft[kind] ?? [];
    function change(next: CommissionShares) {
      setDraft((current) => ({ ...current, [kind]: next.length ? next : undefined }));
      setError(null);
    }
    return (
      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="text-xs font-bold text-ink">
          {kind === "sellers" ? "Sellers" : "Performing therapists"}
        </legend>
        {rows.map((row, index) => (
          <div key={index} className="flex gap-2">
            <select
              className={CONTROL_CLASS}
              aria-label={`${kind} staff ${index + 1}`}
              value={row.staffId}
              onChange={(event) =>
                change(
                  rows.map((r, i) => (i === index ? { ...r, staffId: event.target.value } : r)),
                )
              }
            >
              <option value="">Select staff</option>
              {!options.some((option) => option.id === row.staffId) && row.staffId ? (
                <option value={row.staffId}>Unavailable staff — select another</option>
              ) : null}
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
            <input
              className={CONTROL_CLASS}
              aria-label={`${kind} percent ${index + 1}`}
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              value={row.share / 100}
              onChange={(event) =>
                change(
                  rows.map((r, i) =>
                    i === index ? { ...r, share: Math.round(Number(event.target.value) * 100) } : r,
                  ),
                )
              }
            />
            <Button variant="ghost" onClick={() => change(rows.filter((_, i) => i !== index))}>
              Remove
            </Button>
          </div>
        ))}
        {rows.length < 4 ? (
          <Button
            variant="ghost"
            onClick={() => change([...rows, { staffId: "", share: rows.length ? 1 : 10000 }])}
          >
            Add {kind === "sellers" ? "seller" : "therapist"}
          </Button>
        ) : null}
      </fieldset>
    );
  }
  return (
    <div className="space-y-2">
      <Button
        variant="ghost"
        disabled={disabled}
        onClick={() => {
          setDraft(value ?? {});
          setError(null);
          setOpen(!open);
        }}
      >
        {open ? "Close commission attribution" : "Commission attribution"}
      </Button>
      {!open && value ? (
        <p className="text-xs text-ink-muted">
          {value.sellers?.length ?? 0} seller(s) · {value.performers?.length ?? 0} therapist(s)
        </p>
      ) : null}
      {open ? (
        <div className="space-y-3 rounded-md border border-line p-3">
          <p className="text-xs text-ink-muted">
            Separate from the cashier. Each group must total 100%, with up to four staff. Captures
            credit only; new commission earnings are not yet enabled.
          </p>
          {sellers ? group("sellers", sellers) : null}
          {performers ? group("performers", performers) : null}
          {error ? (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              disabled={disabled}
              onClick={() => {
                if (!draft.sellers && !draft.performers) {
                  onChange(undefined);
                  setOpen(false);
                  return;
                }
                const result = commissionAttributionSchema.safeParse(draft);
                if (!result.success) {
                  setError(result.error.issues[0]?.message ?? "Check attribution.");
                  return;
                }
                const valid = (rows: CommissionShares | undefined, options: StaffOption[]) =>
                  !rows || rows.every((row) => options.some((option) => option.id === row.staffId));
                if (
                  !valid(result.data.sellers, sellers ?? []) ||
                  !valid(result.data.performers, performers ?? [])
                ) {
                  setError("Select available staff for every share.");
                  return;
                }
                onChange(result.data);
                setOpen(false);
              }}
            >
              Save attribution
            </Button>
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
            >
              Clear attribution
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
