/**
 * Create and edit a service — the form half of handoff screen 08's Services tab.
 *
 * A sibling of `ProductFormDrawer` rather than a mode of it: the two rows are
 * different shapes on purpose. A service has no stock to count — `ServiceSummary`
 * carries no `quantity` and no `lowStock` — and it has a `durationMinutes` a
 * product has no use for. One component with two sets of conditional fields would
 * be a form that lies about which contract it is filling in.
 *
 * **Server-side validation errors land on the field that caused them.** The API
 * answers a 422 with `details: [{ path: "body.memberPrice", message }]`, so
 * `fieldError` strips the `body.` prefix and hands the message to that control's
 * `error` prop. The contract lives in `packages/shared`; nothing here re-declares a
 * rule — the local checks below only catch what is worth not round-tripping.
 *
 * `durationMinutes` is optional even though booking needs it: a migrated salon has
 * services with no duration until someone fills it in, and the appointment flow is
 * where a missing duration becomes a blocking question — not this form.
 */
import { useState } from "react";

import type { CatalogStatusValue, ServiceDetail } from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import Drawer from "@/components/ui/Drawer";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { showToast } from "@/components/ui/toast-store";
import { useDepartments } from "@/hooks/useDepartments";
import { useCreateService, useUpdateService } from "@/hooks/useServices";
import { getErrorMessage, getValidationDetails } from "@/lib/api";

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];

interface FormState {
  name: string;
  memberPrice: string;
  nonmemberPrice: string;
  points: string;
  durationMinutes: string;
  interval: string;
  departmentId: string;
  status: string;
  description: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  memberPrice: "",
  nonmemberPrice: "",
  points: "",
  durationMinutes: "",
  interval: "",
  departmentId: "",
  status: "ACTIVE",
  description: "",
};

function toForm(service: ServiceDetail): FormState {
  return {
    name: service.name,
    // Straight through, not re-rounded: the API already sent two decimals, and
    // rewriting `12.5` as `12.50` under the user's cursor would fight their edit.
    memberPrice: service.memberPrice,
    nonmemberPrice: service.nonmemberPrice,
    points: String(service.points),
    // A service with no duration has none to show, so the box is left empty rather
    // than reading "0 minutes", which would be a claim about the booking length.
    durationMinutes: service.durationMinutes === null ? "" : String(service.durationMinutes),
    interval: service.interval == null ? "" : String(service.interval),
    departmentId: service.departmentId ?? "",
    status: service.status,
    description: service.description ?? "",
  };
}

/** An empty box means "not supplied" on create. */
function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** An empty box means "clear it" on update — an explicit `null`, not an absent key. */
function clearable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** `""` → `undefined`, a number otherwise, `NaN` when the box holds nonsense. */
function toCount(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : Number(trimmed);
}

/** `""` → `null` on update: an emptied duration box clears the duration. */
function toNullableCount(value: string): number | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : Number(trimmed);
}

/** Non-negative money, or a message for the field. */
function moneyError(raw: string, label: string): string | undefined {
  const amount = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(amount) || amount < 0) return label;
  return undefined;
}

export interface ServiceFormDrawerProps {
  open: boolean;
  /** `null` creates; a service edits. */
  service: ServiceDetail | null;
  onClose: () => void;
}

export default function ServiceFormDrawer({ open, service, onClose }: ServiceFormDrawerProps) {
  // Seeded once, at mount. The page gives this component a `key` that changes when
  // the record or the open state changes, so a cancelled edit cannot leak its
  // unsaved text into the next one — without an effect copying props into state,
  // which renders twice on every open.
  const [form, setForm] = useState<FormState>(() => (service ? toForm(service) : EMPTY_FORM));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const departments = useDepartments();
  const createService = useCreateService();
  const updateService = useUpdateService();
  const isSaving = createService.isPending || updateService.isPending;
  const isEditing = service !== null;

  const set = (field: keyof FormState) => (value: string) => {
    setForm((previous) => ({ ...previous, [field]: value }));
  };

  /** The API prefixes paths with the request part; a form only knows field names. */
  const fieldError = (field: keyof FormState): string | undefined =>
    fieldErrors[field] ?? fieldErrors[`body.${field}`];

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);

    const trimmedName = form.name.trim();
    const memberPrice = Number(form.memberPrice);
    const nonmemberPrice = Number(form.nonmemberPrice);
    const points = toCount(form.points);
    const durationMinutes = toCount(form.durationMinutes);
    const interval = toCount(form.interval);

    // Caught here so the user is not made to wait for a round trip, with the
    // contract's own wording where it has one.
    const localErrors: Record<string, string> = {};
    if (interval !== undefined && (!Number.isInteger(interval) || interval < 1 || interval > 365)) {
      localErrors["interval"] = "Enter a whole number from 1 to 365, or leave blank to inherit";
    }
    if (trimmedName === "") localErrors["name"] = "Name is required";

    const memberError = moneyError(form.memberPrice, "Enter the member price");
    if (memberError) localErrors["memberPrice"] = memberError;
    const nonmemberError = moneyError(form.nonmemberPrice, "Enter the non-member price");
    if (nonmemberError) localErrors["nonmemberPrice"] = nonmemberError;

    if (points !== undefined && (!Number.isInteger(points) || points < 0)) {
      localErrors["points"] = "Points must be a whole number";
    }
    // The contract's own floor: under five minutes is not a bookable slot, so it is
    // refused here rather than round-tripped into a 422.
    if (
      durationMinutes !== undefined &&
      (!Number.isInteger(durationMinutes) || durationMinutes < 5)
    ) {
      localErrors["durationMinutes"] = "Duration must be a whole number of minutes, at least 5";
    }

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    try {
      if (service) {
        await updateService.mutateAsync({
          id: service.id,
          input: {
            name: trimmedName,
            memberPrice,
            nonmemberPrice,
            ...(points !== undefined ? { points } : {}),
            // `null` clears it: an emptied duration box means "no duration yet",
            // not "leave the old one alone".
            durationMinutes: toNullableCount(form.durationMinutes),
            interval: interval ?? null,
            description: clearable(form.description),
            departmentId: clearable(form.departmentId),
            status: (form.status || undefined) as CatalogStatusValue | undefined,
          },
        });
        showToast("success", "Service updated.");
      } else {
        await createService.mutateAsync({
          name: trimmedName,
          memberPrice,
          nonmemberPrice,
          ...(points !== undefined ? { points } : {}),
          ...(durationMinutes !== undefined ? { durationMinutes } : {}),
          ...(interval !== undefined ? { interval } : {}),
          description: optional(form.description),
          departmentId: optional(form.departmentId),
          status: (form.status || undefined) as CatalogStatusValue | undefined,
        });
        showToast("success", "Service added.");
      }

      onClose();
    } catch (error) {
      const details = getValidationDetails(error);
      if (Object.keys(details).length > 0) {
        setFieldErrors(details);
        return;
      }
      setFormError(getErrorMessage(error));
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEditing ? "Edit service" : "Add service"}
      description={
        isEditing
          ? "Update this service's prices and duration. Leave a field blank to clear it."
          : "A name and both prices are all the contract asks for — a duration can be filled in later."
      }
      widthClassName="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" form="service-form" loading={isSaving}>
            {isEditing ? "Save changes" : "Add service"}
          </Button>
        </>
      }
    >
      <form id="service-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {formError ? (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        ) : null}

        <Input
          label="Name"
          required
          value={form.name}
          onChange={(event) => set("name")(event.target.value)}
          error={fieldError("name")}
          maxLength={200}
          autoFocus
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Member price"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={form.memberPrice}
            onChange={(event) => set("memberPrice")(event.target.value)}
            error={fieldError("memberPrice")}
            hint="What a member pays."
          />
          <Input
            label="Non-member price"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={form.nonmemberPrice}
            onChange={(event) => set("nonmemberPrice")(event.target.value)}
            error={fieldError("nonmemberPrice")}
            hint="What everyone else pays."
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Duration (minutes)"
            type="number"
            inputMode="numeric"
            step="1"
            min="5"
            value={form.durationMinutes}
            onChange={(event) => set("durationMinutes")(event.target.value)}
            error={fieldError("durationMinutes")}
            hint="How long the booking takes. Blank means it is not set yet."
          />
          <Input
            label="Loyalty points"
            type="number"
            inputMode="numeric"
            step="1"
            min="0"
            value={form.points}
            onChange={(event) => set("points")(event.target.value)}
            error={fieldError("points")}
            hint="Awarded when this is sold."
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Department"
            value={form.departmentId}
            onChange={(event) => set("departmentId")(event.target.value)}
            error={fieldError("departmentId")}
            placeholder="Unassigned"
            disabled={departments.isPending}
            options={(departments.data ?? []).map((department) => ({
              value: department.id,
              label: department.name,
            }))}
          />
          <Select
            label="Status"
            value={form.status}
            onChange={(event) => set("status")(event.target.value)}
            error={fieldError("status")}
            options={STATUS_OPTIONS}
          />
        </div>

        <Input
          label="Rebooking interval (days)"
          type="number"
          min="1"
          max="365"
          step="1"
          value={form.interval}
          onChange={(event) => set("interval")(event.target.value)}
          error={fieldError("interval")}
          hint="Blank inherits the company rebooking days in Messaging settings (28 if unset)."
        />
        <Input
          label="Description"
          value={form.description}
          onChange={(event) => set("description")(event.target.value)}
          error={fieldError("description")}
          maxLength={2000}
        />
      </form>
    </Drawer>
  );
}
