/**
 * Add a staff member — the create half of handoff screen 09.
 *
 * **Creation is a drawer; editing is a page** (`/staff/:id`, `StaffProfile`). They are
 * different shapes of task: a new colleague is one form with one save, which belongs
 * beside the list it appends to, while an existing record carries five independent save
 * scopes whose buttons must never look like they save each other. What is left here is
 * exactly the create form, and the `staff` prop that used to switch this component into
 * edit mode is gone with it.
 *
 * Staff remain User rows, and **every colleague gets an email and a password** — an
 * account without one could never sign in, so there is no second creation path. A
 * duplicate supplied address is a 409 — `users.email` is globally unique — and it lands
 * on the Email control rather than in a banner because the API answers it as
 * `details: [{ path: "body.email", message }]` like any other field error.
 *
 * The **POS PIN is optional and is not a login.** It is the six digits the till takes to
 * attribute a sale to this person on a shared terminal and, for a manager or owner, to
 * approve an unpaid package-session override.
 *
 * **A password is set here and only here.** Afterwards it moves through the dedicated
 * `POST /api/staff/:id/password` control on the profile page, which bumps `tokenVersion`
 * and ends every session the person holds ([ADR 0007]) — the promise a profile PATCH
 * cannot make, which is why no email or password box exists on that form.
 *
 * **`disabled` is not offered here.** It is the archive, not a delete (Q28): a disabled
 * user keeps their appointments and their commission history, and a *new* account that
 * is already disabled is a mistake rather than a state anyone wants. It is a control on
 * the profile page's account-status card.
 *
 * As in the catalogue's drawer, the local checks below only catch what is worth not
 * round-tripping; nothing here re-declares a contract rule, and `PASSWORD_MIN_LENGTH`
 * is the contract's own constant rather than a second copy of 8.
 */
import { useState } from "react";
import { useNavigate } from "react-router";

import {
  PASSWORD_MIN_LENGTH,
  createStaffSchema,
  type CreateStaffInput,
  type GlobalRole,
} from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import Drawer from "@/components/ui/Drawer";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import StaffPayrollCreation from "./StaffPayrollCreation";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/components/ui/toast-store";
import { ROLE_OPTIONS } from "@/constants/staff";
import { useDepartments } from "@/hooks/useDepartments";
import { useCreateStaff } from "@/hooks/useStaff";
import { getErrorMessage, getValidationDetails } from "@/lib/api";

interface FormState {
  name: string;
  email: string;
  password: string;
  posPin: string;
  globalRole: GlobalRole;
  phone: string;
  position: string;
  commissionRate: string;
  startDate: string;
  endDate: string;
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
  globalRole: "STAFF",
  phone: "",
  position: "",
  commissionRate: "0",
  startDate: "",
  endDate: "",
  departmentIds: [],
};

/** An empty box means "not supplied" on create. */
function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Adds or removes one branch without disturbing the rest of the selection. */
function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

export interface StaffFormDrawerProps {
  open: boolean;
  onClose: () => void;
}

export default function StaffFormDrawer({ open, onClose }: StaffFormDrawerProps) {
  const [configurePayroll, setConfigurePayroll] = useState(false);
  const [initialPayroll, setInitialPayroll] = useState(false);
  const [commissionRole, setCommissionRole] = useState<
    "" | "COMMISSION_EARNING" | "NON_COMMISSION"
  >("");
  const [classificationReason, setClassificationReason] = useState("");
  const [payrollAssignment, setPayrollAssignment] = useState<
    CreateStaffInput["payrollAssignment"] | null
  >(null);
  const { user, isReadOnly } = useAuth();
  const navigate = useNavigate();
  const canConfigureCommission =
    user?.globalRole === "SUPER_ADMIN" || user?.globalRole === "MANAGER";
  // Seeded once, at mount. The page gives this component a `key` that changes with the
  // open state, so a cancelled form cannot leak its unsaved text into the next one —
  // without an effect copying props into state, which renders twice on every open.
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const departments = useDepartments();
  const createStaff = useCreateStaff();
  const isSaving = createStaff.isPending;

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
    if (user?.globalRole !== "SUPER_ADMIN") {
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

    if (email === "") localErrors["email"] = "Email is required";
    if (form.password.length < PASSWORD_MIN_LENGTH) {
      localErrors["password"] = `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
    }
    if (form.posPin !== "" && !/^\d{6}$/.test(form.posPin))
      localErrors["posPin"] = "Use a six-digit PIN.";
    if (initialPayroll || commissionRole === "COMMISSION_EARNING") {
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
      const input = {
        name,
        email,
        password: form.password,
        ...(form.posPin !== "" ? { posPin: form.posPin } : {}),
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
      // The tick was "continue to payroll settings", so it continues to them for real
      // now: the page's payroll section is a URL, not a second half of this drawer.
      if (configurePayroll && canConfigureCommission) {
        onClose();
        navigate(`/staff/${created.id}?section=payroll`);
        return;
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
      title="Add staff member"
      description="Create the login and audited payroll setup together. A join date, explicit classification and reason are required."
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
            disabled={user?.globalRole !== "SUPER_ADMIN"}
          >
            Add staff member
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
          placeholder="e.g. Aina Rahman"
          value={form.name}
          onChange={(event) => setField("name", event.target.value)}
          error={fieldError("name")}
          maxLength={200}
          autoFocus
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Email"
            type="email"
            required
            placeholder="name@example.com"
            value={form.email}
            onChange={(event) => setField("email", event.target.value)}
            error={fieldError("email")}
            hint="The address they sign in with."
            maxLength={200}
          />
          <Input
            label="Password"
            placeholder="Please set this staff member's password"
            type="password"
            required
            value={form.password}
            onChange={(event) => setField("password", event.target.value)}
            error={fieldError("password")}
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
            maxLength={200}
          />
        </div>

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
            placeholder="e.g. Senior stylist"
            value={form.position}
            onChange={(event) => setField("position", event.target.value)}
            error={fieldError("position")}
            hint="Job title shown when they are booked."
            maxLength={120}
          />
        </div>

        <Input
          label="Phone"
          placeholder="+65 9123 4567"
          value={form.phone}
          onChange={(event) => setField("phone", event.target.value)}
          error={fieldError("phone")}
          maxLength={64}
        />

        <Input
          label="POS PIN"
          placeholder="Please enter a POS PIN"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={6}
          value={form.posPin}
          onChange={(event) => setField("posPin", event.target.value)}
          error={fieldError("posPin")}
          hint="Optional, six digits. Attributes this person's sales at a shared till, and lets a manager approve unpaid package-session overrides."
        />

        <Input
          label="Service commission (%)"
          type="number"
          min="0"
          max="100"
          step="0.01"
          placeholder="e.g. 10"
          value={form.commissionRate}
          onChange={(event) => setField("commissionRate", event.target.value)}
          error={fieldError("commissionRate")}
          hint="Service revenue after discounts, excluding tax. Includes redeemed services; excludes package purchases and direct tips."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Start date"
            type="date"
            value={form.startDate}
            onChange={(event) => setField("startDate", event.target.value)}
            error={fieldError("startDate")}
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

        {user?.globalRole === "SUPER_ADMIN" && !isReadOnly && (
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
                placeholder="e.g. Joins as a commission-earning senior stylist"
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
        {canConfigureCommission && (
          <Checkbox
            label="Configure payroll after creation"
            checked={configurePayroll}
            onChange={(event) => setConfigurePayroll(event.target.checked)}
            hint="After saving the required classification, join date and any initial plan together, continue to this person's payroll section."
          />
        )}
      </form>
    </Drawer>
  );
}
