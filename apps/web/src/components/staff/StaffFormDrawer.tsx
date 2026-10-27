/**
 * Create and edit a staff member — the form half of handoff screen 09.
 *
 * Staff remain User rows. Creation supports either an email/password login or
 * a POS-only PIN identity without an email. A duplicate supplied address is a 409 —
 * `users.email` is globally unique — and why it lands on the Email control rather than
 * in a banner: the API answers it as `details: [{ path: "body.email", message }]` like
 * any other field error.
 *
 * **No password box on edit.** Changing a password is
 * `POST /api/auth/change-password`, which bumps `tokenVersion` and ends every session
 * ([ADR 0007]); a box here would be a way round the one flow that does it correctly.
 * Email is read-only on edit for the same reason — `updateStaffSchema` has no `email`
 * field at all, so the address is shown as text rather than as an editor for a value
 * the API would silently drop.
 *
 * **`disabled` is the archive, not a delete.** The checkbox appears on edit only: a
 * disabled user keeps their appointments and their commission history, and a new
 * account that is already disabled is a mistake rather than a state anyone wants.
 *
 * As in the catalogue's drawer, the local checks below only catch what is worth not
 * round-tripping; nothing here re-declares a contract rule, and `PASSWORD_MIN_LENGTH`
 * is the contract's own constant rather than a second copy of 8.
 */
import { useState } from "react";

import {
  PASSWORD_MIN_LENGTH,
  createStaffSchema,
  type CreateStaffInput,
  type GlobalRole,
  type StaffDetail,
} from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import Drawer from "@/components/ui/Drawer";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import StaffRoster from "@/components/staff/StaffRoster";
import CommissionRules from "@/components/settings/CommissionRules";
import PayrollPlans from "@/components/settings/PayrollPlans";
import StaffPayrollCreation from "./StaffPayrollCreation";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/components/ui/toast-store";
import { ROLE_OPTIONS } from "@/constants/staff";
import { useDepartments } from "@/hooks/useDepartments";
import { useCreateStaff, useUpdateStaff } from "@/hooks/useStaff";
import { getErrorMessage, getValidationDetails } from "@/lib/api";

interface FormState {
  name: string;
  email: string;
  password: string;
  posPin: string;
  pinOnly: boolean;
  removePin: boolean;
  globalRole: GlobalRole;
  phone: string;
  position: string;
  commissionRate: string;
  startDate: string;
  endDate: string;
  disabled: boolean;
  departmentIds: string[];
}

/**
 * `globalRole` starts at `STAFF`, the least privileged role — the same default the
 * contract applies server-side, so a form that is submitted untouched cannot mint
 * something more powerful than the person filling it in meant to.
 */
const EMPTY_FORM: FormState = {
  name: "",
  email: "",
  password: "",
  posPin: "",
  pinOnly: false,
  removePin: false,
  globalRole: "STAFF",
  phone: "",
  position: "",
  commissionRate: "0",
  startDate: "",
  endDate: "",
  disabled: false,
  departmentIds: [],
};

function toForm(staff: StaffDetail): FormState {
  return {
    name: staff.name,
    email: staff.email ?? "",
    pinOnly: staff.email === null,
    removePin: false,
    posPin: "",
    // Never seeded from the record: the list response carries no password material,
    // and a filled-in box would imply the existing password could be read back.
    password: "",
    globalRole: staff.globalRole,
    phone: staff.phone ?? "",
    position: staff.position ?? "",
    commissionRate: staff.commissionRate ?? "0",
    // `startDate`/`endDate` cross the wire as `YYYY-MM-DD` (the service slices the
    // timestamp), which is exactly what a date input reads and writes.
    startDate: staff.startDate ?? "",
    endDate: staff.endDate ?? "",
    disabled: staff.disabled,
    departmentIds: staff.departments.map((department) => department.id),
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

/** Adds or removes one branch without disturbing the rest of the selection. */
function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

export interface StaffFormDrawerProps {
  open: boolean;
  /** `null` creates; a person edits. */
  staff: StaffDetail | null;
  onClose: () => void;
}

export default function StaffFormDrawer({
  open,
  staff: initialStaff,
  onClose,
}: StaffFormDrawerProps) {
  const [createdStaff, setCreatedStaff] = useState<StaffDetail | null>(null);
  const [configurePayroll, setConfigurePayroll] = useState(false);
  const [initialPayroll, setInitialPayroll] = useState(false);
  const [commissionRole, setCommissionRole] = useState<
    "" | "COMMISSION_EARNING" | "NON_COMMISSION"
  >("");
  const [classificationReason, setClassificationReason] = useState("");
  const [payrollAssignment, setPayrollAssignment] = useState<
    CreateStaffInput["payrollAssignment"] | null
  >(null);
  const staff = createdStaff ?? initialStaff;
  const { user, isReadOnly } = useAuth();
  const canConfigureCommission =
    user?.globalRole === "SUPER_ADMIN" || user?.globalRole === "MANAGER";
  // Seeded once, at mount. The page gives this component a `key` that changes when
  // the record or the open state changes, so a cancelled edit cannot leak its
  // unsaved text into the next one — without an effect copying props into state,
  // which renders twice on every open.
  const [form, setForm] = useState<FormState>(() => (staff ? toForm(staff) : EMPTY_FORM));
  const [originalStartDate, setOriginalStartDate] = useState(() => form.startDate);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const departments = useDepartments();
  const createStaff = useCreateStaff();
  const updateStaff = useUpdateStaff();
  const isSaving = createStaff.isPending || updateStaff.isPending;
  const isEditing = staff !== null;

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
    if (!isEditing && user?.globalRole !== "SUPER_ADMIN") {
      setFormError(
        "Ask the owner to create staff with audited payroll classification and a join date.",
      );
      return;
    }

    const name = form.name.trim();
    const email = form.email.trim();

    // Caught here so the user is not made to wait for a round trip, with the
    // contract's own wording where it has one. The *shape* of the email is left to
    // `emailSchema` on the server rather than being re-declared as a regex here.
    const localErrors: Record<string, string> = {};
    if (name === "") localErrors["name"] = "Name is required";
    const commissionRate = Number(form.commissionRate);
    if (
      form.commissionRate.trim() === "" ||
      !Number.isFinite(commissionRate) ||
      commissionRate < 0 ||
      commissionRate > 100 ||
      Math.abs(commissionRate * 100 - Math.round(commissionRate * 100)) > 1e-8
    ) {
      localErrors["commissionRate"] =
        "Enter a percentage from 0 to 100 with at most two decimal places.";
    }

    if (!isEditing && !form.pinOnly) {
      if (email === "") localErrors["email"] = "Email is required";
      if (form.password.length < PASSWORD_MIN_LENGTH) {
        localErrors["password"] = `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
      }
    }

    if (((!isEditing && form.pinOnly) || form.posPin !== "") && !/^\d{6}$/.test(form.posPin))
      localErrors["posPin"] = "Use a six-digit PIN.";
    if (form.pinOnly && ["SUPER_ADMIN", "MANAGER"].includes(form.globalRole))
      localErrors["globalRole"] = "PIN-only staff cannot have a management role.";
    if (!isEditing && (initialPayroll || commissionRole === "COMMISSION_EARNING")) {
      if (!form.startDate)
        localErrors["startDate"] = "A join date is required with a payroll plan.";
      if (!payrollAssignment) {
        setFormError("Choose an initial payroll plan before creating staff.");
        return;
      }
    }
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    try {
      if (staff) {
        await updateStaff.mutateAsync({
          id: staff.id,
          input: {
            name,
            globalRole: form.globalRole,
            phone: clearable(form.phone),
            position: clearable(form.position),
            ...(form.removePin ? { posPin: null } : form.posPin ? { posPin: form.posPin } : {}),
            // Payroll can update this same authoritative date while this drawer is open.
            // Do not write the drawer's old value back unless the identity form changed it.
            ...(form.startDate !== originalStartDate
              ? {
                  startDate: clearable(form.startDate),
                  expectedStartDate: originalStartDate || null,
                }
              : {}),
            endDate: clearable(form.endDate),
            disabled: form.disabled,
            // Sent even when empty: on update the list *replaces* the selection, so
            // an empty array is how every branch is taken off someone.
            departmentIds: form.departmentIds,
          },
        });
        showToast("success", "Staff member updated.");
      } else {
        const input = {
          name,
          ...(form.pinOnly
            ? { posPin: form.posPin }
            : { email, password: form.password, ...(form.posPin ? { posPin: form.posPin } : {}) }),
          globalRole: form.globalRole,
          phone: optional(form.phone),
          position: optional(form.position),
          commissionRate,
          startDate: optional(form.startDate),
          endDate: optional(form.endDate),
          departmentIds: form.departmentIds,
          ...((initialPayroll || commissionRole === "COMMISSION_EARNING") && payrollAssignment
            ? { payrollAssignment }
            : {}),
          ...(commissionRole
            ? { payrollClassification: { commissionRole, reason: classificationReason } }
            : {}),
        };
        const parsed = createStaffSchema.safeParse(input);
        if (!parsed.success) {
          setFieldErrors(
            Object.fromEntries(
              parsed.error.issues.map((issue) => [issue.path.join("."), issue.message]),
            ),
          );
          setFormError(parsed.error.issues.map((issue) => issue.message).join(" "));
          return;
        }
        const created = await createStaff.mutateAsync(parsed.data);
        showToast("success", "Staff member added.");
        if (configurePayroll && canConfigureCommission) {
          setCreatedStaff(created);
          setForm(toForm(created));
          setOriginalStartDate(toForm(created).startDate);
          return;
        }
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
      title={isEditing ? "Edit staff member" : "Add staff member"}
      description={
        isEditing
          ? "Update this person’s role, profile and branches. Their login email is not changed here."
          : "Create the login and audited payroll setup together. A join date, explicit classification and reason are required."
      }
      widthClassName="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="staff-form"
            loading={isSaving}
            disabled={!isEditing && user?.globalRole !== "SUPER_ADMIN"}
          >
            {isEditing ? "Save changes" : "Add staff member"}
          </Button>
        </>
      }
    >
      <form id="staff-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {formError ? (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        ) : null}

        <Input
          label="Name"
          required
          value={form.name}
          onChange={(event) => setField("name", event.target.value)}
          error={fieldError("name")}
          maxLength={200}
          autoFocus
        />

        {!isEditing && (
          <Checkbox
            label="POS PIN only (no email login)"
            checked={form.pinOnly}
            onChange={(event) => setField("pinOnly", event.target.checked)}
          />
        )}
        {isEditing ? (
          // Text, not a disabled input: the contract has no `email` on update, so a
          // greyed-out box would suggest a field that is merely locked when in fact
          // nothing about it would ever be sent.
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-ink">Email</p>
            <p className="text-sm text-ink-body">{staff.email ?? "POS PIN only"}</p>
            <p className="text-xs text-ink-muted">
              The address they sign in with, so it is not changed from this form.
            </p>
          </div>
        ) : !form.pinOnly ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Email"
              type="email"
              required
              value={form.email}
              onChange={(event) => setField("email", event.target.value)}
              error={fieldError("email")}
              hint="The address they sign in with."
              maxLength={200}
            />
            <Input
              label="Password"
              type="password"
              required
              value={form.password}
              onChange={(event) => setField("password", event.target.value)}
              error={fieldError("password")}
              hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
              maxLength={200}
            />
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Role"
            value={form.globalRole}
            onChange={(event) => setField("globalRole", event.target.value as GlobalRole)}
            error={fieldError("globalRole")}
            options={ROLE_OPTIONS}
            hint="Decides what they are allowed to change."
          />
          <Input
            label="Position"
            value={form.position}
            onChange={(event) => setField("position", event.target.value)}
            error={fieldError("position")}
            hint="Job title shown when they are booked."
            maxLength={120}
          />
        </div>

        <Input
          label="Phone"
          value={form.phone}
          onChange={(event) => setField("phone", event.target.value)}
          error={fieldError("phone")}
          maxLength={64}
        />

        <Input
          label={isEditing ? "New POS PIN (leave blank to keep)" : "POS PIN"}
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={6}
          value={form.posPin}
          onChange={(event) => setField("posPin", event.target.value)}
          error={fieldError("posPin")}
          hint="Six digits. POS identity only; no web access or management permissions."
        />

        {isEditing && (
          <Checkbox
            label="Revoke POS PIN"
            checked={form.removePin}
            onChange={(event) => setField("removePin", event.target.checked)}
            hint="Immediately ends existing PIN verifications. A new PIN can be set later."
          />
        )}
        {!isEditing && (
          <Input
            label="Service commission (%)"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={form.commissionRate}
            onChange={(event) => setField("commissionRate", event.target.value)}
            error={fieldError("commissionRate")}
            hint="Service revenue after discounts, excluding tax. Includes redeemed services; excludes package purchases and direct tips."
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Start date"
            type="date"
            value={form.startDate}
            onChange={(event) => setField("startDate", event.target.value)}
            error={fieldError("startDate")}
            hint={
              isEditing
                ? "For staff with payroll settings or plan history, change the join date in payroll settings below with a reason."
                : undefined
            }
          />
          <Input
            label="End date"
            type="date"
            value={form.endDate}
            onChange={(event) => setField("endDate", event.target.value)}
            error={fieldError("endDate")}
          />
        </div>

        {/* A fieldset rather than a stack of loose checkboxes: the group needs a name
            of its own, and `legend` is the only element that gives it one. */}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium text-ink">Departments</legend>
          {departments.isPending ? (
            <p className="text-xs text-ink-muted">Loading departments…</p>
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

        {isEditing ? (
          <Checkbox
            label="Disabled"
            checked={form.disabled}
            onChange={(event) => setField("disabled", event.target.checked)}
            hint="A disabled account cannot sign in. Their appointments and their history stay."
          />
        ) : null}
        {staff && open ? <StaffRoster staffId={staff.id} /> : null}
        {!staff && user?.globalRole === "SUPER_ADMIN" && !isReadOnly && (
          <>
            <Select
              label="Initial commission classification"
              value={commissionRole}
              options={[
                { value: "", label: "Choose a classification — required" },
                { value: "COMMISSION_EARNING", label: "Commission earning — plan required" },
                { value: "NON_COMMISSION", label: "Non-commission" },
              ]}
              onChange={(event) => setCommissionRole(event.target.value as typeof commissionRole)}
              required
              error={fieldError("payrollClassification")}
            />
            {commissionRole && (
              <Input
                label="Classification reason"
                value={classificationReason}
                onChange={(event) => setClassificationReason(event.target.value)}
                required
              />
            )}
            <Checkbox
              label="Assign payroll plan during creation"
              checked={initialPayroll || commissionRole === "COMMISSION_EARNING"}
              disabled={commissionRole === "COMMISSION_EARNING"}
              onChange={(event) => {
                setInitialPayroll(event.target.checked);
                setPayrollAssignment(null);
              }}
            />
            {(initialPayroll || commissionRole === "COMMISSION_EARNING") && (
              <StaffPayrollCreation
                value={payrollAssignment ?? null}
                onChange={setPayrollAssignment}
              />
            )}
          </>
        )}
        {!staff && canConfigureCommission && (
          <Checkbox
            label="Configure payroll after creation"
            checked={configurePayroll}
            onChange={(event) => setConfigurePayroll(event.target.checked)}
            hint="After saving the required classification, join date and any initial plan together, continue to additional payroll settings."
          />
        )}
      </form>
      {staff && open && canConfigureCommission ? (
        <PayrollPlans
          staffId={staff.id}
          canEdit={user?.globalRole === "SUPER_ADMIN" && !isReadOnly}
        />
      ) : null}
      {staff && open && canConfigureCommission ? (
        <CommissionRules staffId={staff.id} canEdit={!isReadOnly} />
      ) : null}
    </Drawer>
  );
}
