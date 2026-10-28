/**
 * Create and edit a package — the form half of handoff screen 08's Packages tab.
 *
 * A sibling of `ProductFormDrawer` rather than a mode of it, for the same reason
 * `ServiceFormDrawer` is: the row is a different shape. A bundle has no branch, no
 * stock and no loyalty points; it has a session count, and a set of **services it may
 * be spent on**.
 *
 * **Those services are a real many-to-many, and the form shows it.** `PackageService`
 * exists because legacy `package_services` did, so the picker lists the salon's
 * services and posts their ids; the API refuses an id from another salon with a 422
 * whose `details[].path` is `body.serviceIds`, which lands on the picker rather than
 * in a banner because `fieldError` reads the same key the 422 names.
 *
 * If the salon has more services than one page holds, the picker says so instead of
 * quietly offering a subset — an invisible omission is how a bundle ends up not
 * covering the service someone bought it for.
 */
import { useState } from "react";
import { payrollPackageSettingsSchema, type PayrollPackageSettings } from "@glampro_suite/shared";

import type {
  CatalogStatusValue,
  CreatePackageInput,
  PackageDetail,
  UpdatePackageInput,
} from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import Drawer from "@/components/ui/Drawer";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { showToast } from "@/components/ui/toast-store";
import { useCreatePackage, useUpdatePackage } from "@/hooks/usePackages";
import { useServiceList } from "@/hooks/useServices";
import { getErrorMessage, getValidationDetails } from "@/lib/api";

/** `MAX_PAGE_SIZE` in `@glampro_suite/shared`, so the picker asks for the largest page. */
const SERVICE_PICKER_PAGE_SIZE = 200;

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];

interface FormState {
  validityDays: string;
  name: string;
  sessionCount: string;
  memberPrice: string;
  nonmemberPrice: string;
  status: string;
  description: string;
}

const EMPTY_FORM: FormState = {
  validityDays: "",
  name: "",
  sessionCount: "",
  memberPrice: "",
  nonmemberPrice: "",
  status: "ACTIVE",
  description: "",
};

function toForm(bundle: PackageDetail): FormState {
  return {
    validityDays: bundle.validityDays == null ? "" : String(bundle.validityDays),
    name: bundle.name,
    // A zero-session bundle is a migrated row, and `0` is what it should read — not
    // an empty box, which would claim the number is unknown.
    sessionCount: String(bundle.sessionCount),
    memberPrice: bundle.memberPrice,
    nonmemberPrice: bundle.nonmemberPrice,
    status: bundle.status,
    description: bundle.description ?? "",
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

/** Non-negative money, or a message for the field. */
function moneyError(raw: string, label: string): string | undefined {
  const amount = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(amount) || amount < 0) return label;
  return undefined;
}

export interface PackageFormDrawerProps {
  open: boolean;
  /** `null` creates; a bundle edits. */
  bundle: PackageDetail | null;
  onClose: () => void;
  canConfigureCommission?: boolean;
}

export default function PackageFormDrawer({
  open,
  bundle,
  onClose,
  canConfigureCommission = false,
}: PackageFormDrawerProps) {
  const [saleMode, setSaleMode] = useState(bundle?.commissionSettings?.sale.mode ?? "");
  const [redemptionCommissionMode, setRedemptionCommissionMode] = useState(
    bundle?.commissionSettings?.redemption.mode ?? "",
  );
  const [saleFixed, setSaleFixed] = useState(
    bundle?.commissionSettings?.sale.mode === "FIXED" ? bundle.commissionSettings.sale.amount : "",
  );
  const [redemptionFixed, setRedemptionFixed] = useState(
    bundle?.commissionSettings?.redemption.mode === "FIXED"
      ? bundle.commissionSettings.redemption.amount
      : "",
  );
  const [depositPct, setDepositPct] = useState(bundle?.commissionSettings?.minimumDepositPct ?? "");
  const [commissionReason, setCommissionReason] = useState("");
  const [commissionDirty, setCommissionDirty] = useState(false);
  // Seeded once, at mount: the page gives this component a `key` that changes with
  // the record and the open state, so a cancelled edit cannot leak into the next one.
  const [form, setForm] = useState<FormState>(() => (bundle ? toForm(bundle) : EMPTY_FORM));
  const [serviceIds, setServiceIds] = useState<string[]>(
    () => bundle?.services.map((service) => service.id) ?? [],
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [redemptionMode, setRedemptionMode] = useState<"PER_UNIT" | "SERVICE_SET">(
    bundle?.redemptionMode ?? "PER_UNIT",
  );
  const [required, setRequired] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (bundle?.serviceSet ?? []).map((row) => [row.serviceId, String(row.quantity)]),
    ),
  );
  const [formError, setFormError] = useState<string | null>(null);

  const services = useServiceList({ page: 1, pageSize: SERVICE_PICKER_PAGE_SIZE });
  const createPackage = useCreatePackage();
  const updatePackage = useUpdatePackage();
  const isSaving = createPackage.isPending || updatePackage.isPending;
  const isEditing = bundle !== null;

  const set = (field: keyof FormState) => (value: string) => {
    setForm((previous) => ({ ...previous, [field]: value }));
  };

  /** The API prefixes paths with the request part; a form only knows field names. */
  const fieldError = (field: keyof FormState | "serviceIds"): string | undefined =>
    fieldErrors[field] ?? fieldErrors[`body.${field}`];

  function toggleService(id: string, checked: boolean): void {
    setServiceIds((previous) =>
      checked ? [...previous, id] : previous.filter((serviceId) => serviceId !== id),
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);

    const name = form.name.trim();
    const sessionCount = Number(form.sessionCount);

    // The contract's own rules, caught here so nobody waits for a round trip.
    const localErrors: Record<string, string> = {};
    let commissionSettings: PayrollPackageSettings | undefined;
    if (canConfigureCommission && commissionDirty) {
      const parsed = payrollPackageSettingsSchema.safeParse({
        sale: { mode: saleMode, ...(saleMode === "FIXED" ? { amount: saleFixed } : {}) },
        redemption: {
          mode: redemptionCommissionMode,
          ...(redemptionCommissionMode === "FIXED" ? { amount: redemptionFixed } : {}),
        },
        minimumDepositPct: depositPct,
      });
      if (
        !parsed.success ||
        commissionReason.trim().length < 3 ||
        commissionReason.trim().length > 500
      )
        localErrors.commissionSettings =
          "Choose both modes, enter valid exact amounts and a 0–100% deposit, and provide a reason (3–500 characters).";
      else commissionSettings = parsed.data;
    }
    if (
      redemptionMode === "SERVICE_SET" &&
      (serviceIds.length === 0 ||
        serviceIds.some(
          (id) =>
            !Number.isInteger(Number(required[id] ?? "1")) ||
            Number(required[id] ?? "1") < 1 ||
            Number(required[id] ?? "1") > 100,
        ))
    ) {
      localErrors.serviceIds = "Choose services and enter 1–100 whole units for each complete set.";
    }
    const validityDays = form.validityDays.trim() === "" ? null : Number(form.validityDays);
    if (
      validityDays !== null &&
      (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 36_500)
    ) {
      localErrors["validityDays"] = "Enter 1–36500 whole days, or leave blank for no expiry";
    }
    if (name === "") localErrors["name"] = "Name is required";

    if (form.sessionCount.trim() === "" || !Number.isInteger(sessionCount) || sessionCount < 0) {
      localErrors["sessionCount"] = "Enter how many sessions the bundle includes";
    } else if (!isEditing && sessionCount < 1) {
      localErrors["sessionCount"] = "A package has to include at least one session";
    }

    const memberError = moneyError(form.memberPrice, "Enter the member price");
    if (memberError) localErrors["memberPrice"] = memberError;
    const nonmemberError = moneyError(form.nonmemberPrice, "Enter the non-member price");
    if (nonmemberError) localErrors["nonmemberPrice"] = nonmemberError;

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    const shared = {
      ...(commissionSettings
        ? {
            commissionSettings,
            commissionReason: commissionReason.trim(),
            ...(bundle ? { expectedUpdatedAt: bundle.updatedAt } : {}),
          }
        : {}),
      ...(redemptionMode === "SERVICE_SET" || bundle?.redemptionMode === "SERVICE_SET"
        ? {
            redemptionMode,
            serviceSet:
              redemptionMode === "SERVICE_SET"
                ? serviceIds.map((serviceId) => ({
                    serviceId,
                    quantity: Number(required[serviceId] ?? "1"),
                  }))
                : [],
          }
        : {}),
      validityDays,
      name,
      sessionCount,
      memberPrice: Number(form.memberPrice),
      nonmemberPrice: Number(form.nonmemberPrice),
      status: (form.status || undefined) as CatalogStatusValue | undefined,
      // The form shows every covered service, so it always sends the whole set: an
      // empty array is "covers nothing", which is a real answer.
      serviceIds,
    };

    try {
      if (bundle) {
        const input: UpdatePackageInput = { ...shared, description: clearable(form.description) };
        await updatePackage.mutateAsync({ id: bundle.id, input });
        showToast("success", "Package updated.");
      } else {
        const input: CreatePackageInput = { ...shared, description: optional(form.description) };
        await createPackage.mutateAsync(input);
        showToast("success", "Package added.");
      }

      onClose();
    } catch (error) {
      const details = getValidationDetails(error);
      if (Object.keys(details).length > 0) {
        const commissionErrors = Object.entries(details)
          .filter(([path]) => /commissionSettings|commissionReason|expectedUpdatedAt/.test(path))
          .map(([, message]) => message);
        setFieldErrors({
          ...details,
          ...(commissionErrors.length ? { commissionSettings: commissionErrors.join(" ") } : {}),
        });
        return;
      }
      setFormError(getErrorMessage(error));
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEditing ? "Edit package" : "Add package"}
      description={
        isEditing
          ? "Update the sessions, prices and the services this bundle may be spent on."
          : "A bundle needs a name, both prices and a session count. What it covers can be filled in later."
      }
      widthClassName="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" form="package-form" loading={isSaving}>
            {isEditing ? "Save changes" : "Add package"}
          </Button>
        </>
      }
    >
      <form id="package-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
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
            label="Sessions"
            type="number"
            inputMode="numeric"
            step="1"
            min={isEditing ? "0" : "1"}
            value={form.sessionCount}
            onChange={(event) => set("sessionCount")(event.target.value)}
            error={fieldError("sessionCount")}
            hint="How many sessions the bundle holds."
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
          label="Validity (days)"
          type="number"
          min="1"
          max="36500"
          step="1"
          value={form.validityDays}
          onChange={(event) => set("validityDays")(event.target.value)}
          error={fieldError("validityDays")}
          hint="24-hour days from completed purchase. Blank means no expiry. Existing holdings are unchanged."
        />

        <Input
          label="Description"
          value={form.description}
          onChange={(event) => set("description")(event.target.value)}
          error={fieldError("description")}
          maxLength={2000}
        />

        {canConfigureCommission ? (
          <fieldset
            onChange={() => setCommissionDirty(true)}
            className="flex flex-col gap-3 rounded-card border border-line p-4"
          >
            <legend>Package commission settings</legend>
            <p>
              Explicit settings apply to new purchases only. Saving does not activate earnings or
              enforce deposits yet. Only paid-for sessions may be redeemed; no per-package bypass is
              available.
            </p>
            <Select
              label="Package sale commission"
              value={saleMode}
              onChange={(event) => setSaleMode(event.target.value)}
              options={[
                { value: "", label: "Not configured — choose explicitly" },
                { value: "FOLLOW_PLAN", label: "Follow plan" },
                { value: "EXCLUDE", label: "Exclude" },
                { value: "FIXED", label: "Fixed amount per sale" },
              ]}
            />
            {saleMode === "FIXED" ? (
              <Input
                label="Fixed amount per sale"
                value={saleFixed}
                onChange={(event) => setSaleFixed(event.target.value)}
                inputMode="decimal"
              />
            ) : null}
            <Select
              label="Package redemption commission"
              value={redemptionCommissionMode}
              onChange={(event) => setRedemptionCommissionMode(event.target.value)}
              options={[
                { value: "", label: "Not configured — choose explicitly" },
                { value: "FOLLOW_PLAN", label: "Follow plan" },
                { value: "EXCLUDE", label: "Exclude" },
                { value: "FIXED", label: "Fixed amount per session" },
              ]}
            />
            {redemptionCommissionMode === "FIXED" ? (
              <Input
                label="Fixed amount per session"
                value={redemptionFixed}
                onChange={(event) => setRedemptionFixed(event.target.value)}
                inputMode="decimal"
              />
            ) : null}
            <Input
              label="Minimum deposit %"
              value={depositPct}
              onChange={(event) => setDepositPct(event.target.value)}
              inputMode="decimal"
            />
            <Input
              label="Commission settings reason"
              value={commissionReason}
              onChange={(event) => setCommissionReason(event.target.value)}
              maxLength={500}
            />
            {fieldErrors.commissionSettings ? (
              <p role="alert">{fieldErrors.commissionSettings}</p>
            ) : null}
          </fieldset>
        ) : null}
        <Select
          label="Session redemption"
          value={redemptionMode}
          onChange={(event) => setRedemptionMode(event.target.value as "PER_UNIT" | "SERVICE_SET")}
          options={[
            { value: "PER_UNIT", label: "One session per service unit" },
            { value: "SERVICE_SET", label: "One session per complete service set" },
          ]}
        />
        <p>
          New purchases snapshot these rules. Existing holdings do not change. A service set must be
          complete; extras are paid separately.
        </p>
        <fieldset className="flex flex-col gap-2 rounded-card border border-line p-4">
          <legend className="px-1 text-sm font-bold text-ink">Services this bundle covers</legend>
          <p className="text-xs text-ink-muted">
            A package is spent on the services ticked here. Leave every box clear for a bundle that
            only holds sessions.
          </p>

          {fieldError("serviceIds") ? (
            <p role="alert" className="text-xs text-danger">
              {fieldError("serviceIds")}
            </p>
          ) : null}

          {services.isPending ? (
            <p className="text-sm text-ink-muted">Loading services…</p>
          ) : services.isError ? (
            <p role="alert" className="text-sm text-danger">
              {getErrorMessage(services.error)}
            </p>
          ) : (services.data?.data.length ?? 0) === 0 ? (
            <p className="text-sm text-ink-muted">
              This salon has no services yet. Add one on the Services tab and it appears here.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {(services.data?.data ?? []).map((service) => (
                <div key={service.id}>
                  <Checkbox
                    key={service.id}
                    label={service.name}
                    checked={serviceIds.includes(service.id)}
                    onChange={(event) => toggleService(service.id, event.target.checked)}
                  />
                  {redemptionMode === "SERVICE_SET" && serviceIds.includes(service.id) ? (
                    <Input
                      label={`Units of ${service.name} per set`}
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      value={required[service.id] ?? "1"}
                      onChange={(event) =>
                        setRequired((previous) => ({
                          ...previous,
                          [service.id]: event.target.value,
                        }))
                      }
                    />
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {/* Said out loud rather than silently truncated: a bundle that cannot cover
              a service is a bundle someone bought for the wrong reason. */}
          {(services.data?.pageCount ?? 1) > 1 ? (
            <p className="text-xs text-warning-text">
              Showing the first {SERVICE_PICKER_PAGE_SIZE} services. Use the Services tab to find
              the rest.
            </p>
          ) : null}
        </fieldset>
      </form>
    </Drawer>
  );
}
