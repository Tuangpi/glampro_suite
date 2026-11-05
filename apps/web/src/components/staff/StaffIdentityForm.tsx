/**
 * The identity half of a staff member's record — the profile form from handoff
 * screen 09, now a section of `/staff/:id` rather than a fold in a drawer.
 *
 * What the contract fixes, and what this form therefore does not do:
 *
 * - **No email and no password.** `updateStaffSchema` has no `email` at all — a login
 *   address is an authentication fact rather than a profile one — and no password
 *   either ([ADR 0007]): a credential only moves through
 *   `POST /api/staff/:id/password`, which belongs to `StaffAccessCard`. The address is
 *   shown as text here so it stays visible without offering a box the API would
 *   silently drop.
 * - **`disabled` is not here.** It is the archive (Q28), it is its own write with its
 *   own consequence (the person loses every session), and it lives on the
 *   account-status card beside this one. One card, one save scope: the button under a
 *   form saves that form and nothing else.
 * - **A join date is compared, not overwritten.** Payroll can move the same
 *   authoritative date from its own section while this page is open, so the PATCH
 *   carries `expectedStartDate` and only when this form changed it.
 */
import { useState } from "react";

import type { GlobalRole, StaffDetail } from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Checkbox from "@/components/ui/Checkbox";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Skeleton from "@/components/ui/Skeleton";
import { showToast } from "@/components/ui/toast-store";
import { ROLE_OPTIONS } from "@/constants/staff";
import { useDepartments } from "@/hooks/useDepartments";
import { useUpdateStaff } from "@/hooks/useStaff";
import { getErrorMessage, getValidationDetails } from "@/lib/api";

interface FormState {
  name: string;
  globalRole: GlobalRole;
  phone: string;
  position: string;
  startDate: string;
  endDate: string;
  departmentIds: string[];
}

function toForm(staff: StaffDetail): FormState {
  return {
    name: staff.name,
    globalRole: staff.globalRole,
    phone: staff.phone ?? "",
    position: staff.position ?? "",
    // `startDate`/`endDate` cross the wire as `YYYY-MM-DD` (the service slices the
    // timestamp), which is exactly what a date input reads and writes.
    startDate: staff.startDate ?? "",
    endDate: staff.endDate ?? "",
    departmentIds: staff.departments.map((department) => department.id),
  };
}

/** An empty box means "clear it" on update — an explicit `null`, not an absent key. */
function clearable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Adds or removes one branch without disturbing the rest of the selection. */
function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

export interface StaffIdentityFormProps {
  staff: StaffDetail;
  /** Owner or manager in an active salon. A stylist reads the page without writing. */
  canEdit: boolean;
}

export default function StaffIdentityForm({ staff, canEdit }: StaffIdentityFormProps) {
  // Seeded once, at mount: the page gives this component a `key` that changes with the
  // record, so switching sections cannot leak one person's draft into another's — and
  // no effect copies props into state on every refetch, which would discard a draft
  // whenever payroll invalidated the record.
  const [form, setForm] = useState<FormState>(() => toForm(staff));
  const [originalStartDate, setOriginalStartDate] = useState(() => form.startDate);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const departments = useDepartments();
  const updateStaff = useUpdateStaff();

  function setField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  /** The API prefixes paths with the request part; a form only knows field names. */
  const fieldError = (field: string): string | undefined =>
    fieldErrors[field] ?? fieldErrors[`body.${field}`];

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);

    const name = form.name.trim();
    // Caught here so the user is not made to wait for a round trip. Nothing below
    // re-declares a contract rule; the shape of a phone number, say, is the server's.
    if (name === "") {
      setFieldErrors({ name: "Name is required" });
      return;
    }

    try {
      await updateStaff.mutateAsync({
        id: staff.id,
        input: {
          name,
          globalRole: form.globalRole,
          phone: clearable(form.phone),
          position: clearable(form.position),
          // Payroll can update this same authoritative date from its own section, so
          // the old value is never written back unless the identity form changed it.
          ...(form.startDate !== originalStartDate
            ? {
                startDate: clearable(form.startDate),
                expectedStartDate: originalStartDate || null,
              }
            : {}),
          endDate: clearable(form.endDate),
          // Sent even when empty: on update the list *replaces* the selection, so an
          // empty array is how every branch is taken off someone.
          departmentIds: form.departmentIds,
        },
      });
      showToast("success", "Staff member updated.");
      // The form stays open on a page, so the baseline moves with the save: a second
      // change compares against what the server now holds, not against what this form
      // first read — otherwise the second save would carry a stale `expectedStartDate`
      // and be refused as a conflict with itself.
      setOriginalStartDate(form.startDate);
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
    <Card
      title="Identity and profile"
      description="The name, role and branches this person is booked and paid under."
      footer={
        canEdit ? (
          <div className="flex justify-end px-2">
            <Button type="submit" form="staff-identity-form" loading={updateStaff.isPending}>
              Save changes
            </Button>
          </div>
        ) : undefined
      }
    >
      <form
        id="staff-identity-form"
        onSubmit={handleSubmit}
        noValidate
        className="flex flex-col gap-4 px-2 pt-3"
      >
        {formError ? (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        ) : null}

        <Input
          label="Name"
          required
          placeholder="e.g. Aina Rahman"
          value={form.name}
          onChange={(event) => setField("name", event.target.value)}
          error={fieldError("name")}
          maxLength={200}
          disabled={!canEdit}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Role"
            value={form.globalRole}
            onChange={(event) => setField("globalRole", event.target.value as GlobalRole)}
            error={fieldError("globalRole")}
            options={ROLE_OPTIONS}
            hint="Decides what they are allowed to change."
            disabled={!canEdit}
          />
          <Input
            label="Position"
            placeholder="e.g. Senior stylist"
            value={form.position}
            onChange={(event) => setField("position", event.target.value)}
            error={fieldError("position")}
            hint="Job title shown when they are booked."
            maxLength={120}
            disabled={!canEdit}
          />
        </div>

        <Input
          label="Phone"
          placeholder="+65 9123 4567"
          value={form.phone}
          onChange={(event) => setField("phone", event.target.value)}
          error={fieldError("phone")}
          maxLength={64}
          disabled={!canEdit}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Start date"
            type="date"
            value={form.startDate}
            onChange={(event) => setField("startDate", event.target.value)}
            error={fieldError("startDate")}
            hint="For staff with payroll settings or plan history, change the join date in the Payroll section with a reason."
            disabled={!canEdit}
          />
          <Input
            label="End date"
            type="date"
            value={form.endDate}
            onChange={(event) => setField("endDate", event.target.value)}
            error={fieldError("endDate")}
            disabled={!canEdit}
          />
        </div>

        {/* A fieldset rather than a stack of loose checkboxes: the group needs a name
            of its own, and `legend` is the only element that gives it one. */}
        <fieldset className="flex flex-col gap-1.5" disabled={!canEdit}>
          <legend className="text-sm font-medium text-ink">Departments</legend>
          {departments.isPending ? (
            // Placeholder rows take a checkbox's height, so the fieldset is the size it
            // will be once the departments arrive.
            <div role="status" aria-busy="true" className="flex flex-col gap-1">
              <span className="sr-only">Loading departments…</span>
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-5 max-w-40" />
              ))}
            </div>
          ) : departments.data && departments.data.length > 0 ? (
            <div className="flex flex-col gap-1">
              {departments.data.map((department) => (
                <Checkbox
                  key={department.id}
                  label={department.name}
                  checked={form.departmentIds.includes(department.id)}
                  onChange={() =>
                    setField("departmentIds", toggle(form.departmentIds, department.id))
                  }
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-muted">
              This salon has no departments yet, so nobody can be assigned to one.
            </p>
          )}
          {fieldError("departmentIds") ? (
            <p role="alert" className="text-xs text-danger">
              {fieldError("departmentIds")}
            </p>
          ) : null}
        </fieldset>
      </form>
    </Card>
  );
}
