/**
 * Create or edit a treatment record — the form half of the treatments screen.
 *
 * The list stays behind the drawer: a salon adding a record still wants to see
 * the rest of the book. `customer` is required because a treatment belongs to a
 * customer; there is no walk-in shortcut here — the customer is picked first.
 *
 * Server-side validation errors land on the field that caused them (the shared
 * contract carries dotted field paths). Nothing here re-declares a rule.
 */
import { useState } from "react";

import type { CreateTreatmentRecordInput, TreatmentStatusValue } from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import Drawer from "@/components/ui/Drawer";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { useCreateTreatment, useUpdateTreatment } from "@/hooks/useTreatments";
import { getErrorMessage, getValidationDetails } from "@/lib/api";
import { formatDateInputValue } from "@/lib/utils";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { instantFromSalonDate, toSalonDate } from "@/lib/salon-time";

const STATUS_OPTIONS: { value: TreatmentStatusValue; label: string }[] = [
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

interface FormState {
  packageRedemptionId: string;
  customerId: string;
  customerName: string;
  appointmentId: string;
  staffId: string;
  serviceId: string;
  treatmentType: string;
  status: string;
  notes: string;
  startedAt: string;
  endedAt: string;
  quantityConsumed: string;
}

const EMPTY_FORM: FormState = {
  packageRedemptionId: "",
  customerId: "",
  customerName: "",
  appointmentId: "",
  staffId: "",
  serviceId: "",
  treatmentType: "",
  status: "SCHEDULED",
  notes: "",
  startedAt: "",
  endedAt: "",
  quantityConsumed: "",
};

interface TreatmentRecordFormProps {
  open: boolean;
  record: CreateTreatmentRecordInput | null;
  recordId: string | null;
  lockCustomer?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function TreatmentRecordForm({
  open,
  record,
  recordId,
  lockCustomer = false,
  onClose,
  onSaved,
}: TreatmentRecordFormProps) {
  const isEditing = recordId !== null;
  const { timeZone } = useSalonFormatting();
  const [form, setForm] = useState<FormState>(() =>
    record ? toForm(record, timeZone) : EMPTY_FORM,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const create = useCreateTreatment();
  const update = useUpdateTreatment();

  const set =
    (field: keyof FormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setFormError(null);
      setFieldErrors({});
      setForm((prev) => ({ ...prev, [field]: event.target.value }));
    };

  const fieldError = (path: string): string | undefined => fieldErrors[path];

  async function save() {
    setFormError(null);
    setFieldErrors({});

    const input: CreateTreatmentRecordInput = {
      quantityConsumed: 0,
      packageRedemptionId: form.packageRedemptionId.trim() || null,
      customerId: form.customerId,
      treatmentType: form.treatmentType.trim(),
      status: (form.status as TreatmentStatusValue) || "SCHEDULED",
      notes: form.notes.trim() || null,
      startedAt: form.startedAt
        ? instantFromSalonDate(new Date(form.startedAt), timeZone).toISOString()
        : null,
      endedAt: form.endedAt
        ? instantFromSalonDate(new Date(form.endedAt), timeZone).toISOString()
        : null,
      appointmentId: form.appointmentId.trim() || undefined,
      staffId: form.staffId.trim() || undefined,
      serviceId: form.serviceId.trim() || undefined,
    };

    try {
      if (isEditing && recordId) {
        // Historical unlinked quantities are preserved unless the user links or clears evidence.
        await update.mutateAsync({
          id: recordId,
          input: {
            treatmentType: input.treatmentType,
            status: input.status,
            notes: input.notes,
            ...(form.startedAt !== toDateTimeInput(record?.startedAt, timeZone)
              ? { startedAt: input.startedAt }
              : {}),
            ...(form.endedAt !== toDateTimeInput(record?.endedAt, timeZone)
              ? { endedAt: input.endedAt }
              : {}),
            ...(input.packageRedemptionId !== (record?.packageRedemptionId ?? null)
              ? { packageRedemptionId: input.packageRedemptionId }
              : {}),
          },
        });
      } else {
        await create.mutateAsync(input);
      }
      onSaved();
      onClose();
    } catch (cause) {
      const details = getValidationDetails(cause);
      if (Object.keys(details).length > 0) {
        setFieldErrors(details);
      } else {
        setFormError(getErrorMessage(cause));
      }
    }
  }

  const disabled =
    create.isPending || update.isPending || !form.customerId || !form.treatmentType.trim();

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEditing ? "Edit treatment record" : "New treatment record"}
      widthClassName="max-w-lg"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {formError ? (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        ) : null}

        <div className="space-y-4">
          <Input
            label="Customer reference"
            required
            value={form.customerId}
            onChange={set("customerId")}
            disabled={isEditing || lockCustomer}
            error={fieldError("customerId")}
            hint="Existing customer ID. The customer cannot change after creation."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Treatment type"
              required
              value={form.treatmentType}
              onChange={set("treatmentType")}
              error={fieldError("treatmentType")}
              hint="e.g. Facial, Laser, Chemical peel"
              maxLength={100}
            />
            <Select
              label="Status"
              value={form.status}
              onChange={(event) => set("status")(event)}
              error={fieldError("status")}
              options={STATUS_OPTIONS}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Started at"
              type="datetime-local"
              value={form.startedAt}
              onChange={set("startedAt")}
              error={fieldError("startedAt")}
              hint="Optional"
            />
            <Input
              label="Ended at"
              type="datetime-local"
              value={form.endedAt}
              onChange={set("endedAt")}
              error={fieldError("endedAt")}
              hint="Optional"
            />
          </div>

          <Input
            label="Staff reference"
            disabled={isEditing}
            value={form.staffId}
            onChange={set("staffId")}
            error={fieldError("staffId")}
            hint="Optional staff id"
            maxLength={64}
          />

          <Input
            label="Service reference"
            disabled={isEditing}
            value={form.serviceId}
            onChange={set("serviceId")}
            error={fieldError("serviceId")}
            hint="Optional service id"
            maxLength={64}
          />

          <Input
            label="Appointment reference"
            disabled={isEditing}
            value={form.appointmentId}
            onChange={set("appointmentId")}
            error={fieldError("appointmentId")}
            hint="Optional appointment id"
            maxLength={64}
          />

          <Input
            label="POS package redemption reference"
            value={form.packageRedemptionId}
            onChange={set("packageRedemptionId")}
            error={fieldError("packageRedemptionId")}
            hint="Optional POS redemption ID. POS owns deductions; linking the whole redemption here never deducts again. One treatment per redemption."
            maxLength={64}
          />

          <Input
            label="Notes"
            value={form.notes}
            onChange={set("notes")}
            error={fieldError("notes")}
            hint="Optional clinical notes"
            maxLength={2000}
          />
        </div>

        <div className="flex items-center justify-end gap-3 mt-6">
          <Button type="button" variant="secondary" onClick={onClose} disabled={disabled}>
            Cancel
          </Button>
          <Button type="submit" disabled={disabled}>
            {isEditing ? "Save changes" : "Create record"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function toDateTimeInput(value: string | null | undefined, timeZone: string): string {
  if (!value) return "";
  const local = toSalonDate(value, timeZone);
  if (!local) return "";
  return `${formatDateInputValue(local)}T${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`;
}

function toForm(input: CreateTreatmentRecordInput, timeZone: string): FormState {
  return {
    packageRedemptionId: input.packageRedemptionId ?? "",
    customerId: input.customerId,
    customerName: "",
    appointmentId: input.appointmentId ?? "",
    staffId: input.staffId ?? "",
    serviceId: input.serviceId ?? "",
    treatmentType: input.treatmentType,
    status: input.status,
    notes: input.notes ?? "",
    startedAt: toDateTimeInput(input.startedAt, timeZone),
    endedAt: toDateTimeInput(input.endedAt, timeZone),
    quantityConsumed: input.quantityConsumed?.toString() ?? "",
  };
}
