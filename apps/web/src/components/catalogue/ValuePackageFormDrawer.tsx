/**
 * Create and edit a value package — the form half of handoff screen 08's fifth tab.
 *
 * A sibling of `PackageFormDrawer` rather than a mode of it, because the row is a
 * different product: a bundle sells **sessions**, this sells **money**. Two prices,
 * then, and the distinction is the whole point — `price` is what the customer pays and
 * `credit` is what they may spend, so the form shows both and never derives one from
 * the other.
 *
 * **Credit may be less than the price.** A salon can sell a worse deal than cash, and
 * refusing it would be inventing a rule the money model does not have; the form warns
 * instead, because it is almost always a typo.
 *
 * **The service picker is descriptive.** Credit is fungible (ADR 0019), so ticking a
 * service here records what the package was designed for — the till prints
 * "· N services" from the same links — and restricts nothing. The panel says so,
 * because a picker that looks like a rule and is not one is worse than no picker.
 *
 * If the salon has more services than one page holds, the picker says so rather than
 * quietly offering a subset.
 */
import { useState } from "react";

import type {
  CatalogStatusValue,
  CreateValuePackageInput,
  UpdateValuePackageInput,
  ValuePackageDetail,
} from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import Drawer from "@/components/ui/Drawer";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { showToast } from "@/components/ui/toast-store";
import { useServiceList } from "@/hooks/useServices";
import { useCreateValuePackage, useUpdateValuePackage } from "@/hooks/useValuePackages";
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
  price: string;
  credit: string;
  status: string;
  description: string;
}

const EMPTY_FORM: FormState = {
  validityDays: "",
  name: "",
  price: "",
  credit: "",
  status: "ACTIVE",
  description: "",
};

function toForm(valuePackage: ValuePackageDetail): FormState {
  return {
    validityDays: valuePackage.validityDays == null ? "" : String(valuePackage.validityDays),
    name: valuePackage.name,
    price: valuePackage.price,
    credit: valuePackage.credit,
    status: valuePackage.status,
    description: valuePackage.description ?? "",
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

export interface ValuePackageFormDrawerProps {
  open: boolean;
  /** `null` creates; a package edits. */
  valuePackage: ValuePackageDetail | null;
  onClose: () => void;
}

export default function ValuePackageFormDrawer({
  open,
  valuePackage,
  onClose,
}: ValuePackageFormDrawerProps) {
  // Seeded once, at mount: the page gives this component a `key` that changes with the
  // record and the open state, so a cancelled edit cannot leak into the next one.
  const [form, setForm] = useState<FormState>(() =>
    valuePackage ? toForm(valuePackage) : EMPTY_FORM,
  );
  const [serviceIds, setServiceIds] = useState<string[]>(
    () => valuePackage?.services.map((service) => service.id) ?? [],
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const services = useServiceList({ page: 1, pageSize: SERVICE_PICKER_PAGE_SIZE });
  const createValuePackage = useCreateValuePackage();
  const updateValuePackage = useUpdateValuePackage();
  const isSaving = createValuePackage.isPending || updateValuePackage.isPending;
  const isEditing = valuePackage !== null;

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
    const credit = Number(form.credit);

    // The contract's own rules, caught here so nobody waits for a round trip.
    const localErrors: Record<string, string> = {};
    if (name === "") localErrors["name"] = "Name is required";

    const priceError = moneyError(form.price, "Enter what the customer pays");
    if (priceError) localErrors["price"] = priceError;

    if (form.credit.trim() === "" || !Number.isFinite(credit) || credit <= 0) {
      localErrors["credit"] = "Enter the credit the customer receives — more than zero";
    }

    const validityDays = form.validityDays.trim() === "" ? null : Number(form.validityDays);
    if (
      validityDays !== null &&
      (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 36_500)
    ) {
      localErrors["validityDays"] = "Enter 1–36500 whole days, or leave blank for no expiry";
    }

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    const shared = {
      validityDays,
      name,
      price: Number(form.price),
      credit,
      status: (form.status || undefined) as CatalogStatusValue | undefined,
      // The form shows every linked service, so it always sends the whole set: an
      // empty array is "designed for nothing in particular", which is a real answer.
      serviceIds,
    };

    try {
      if (valuePackage) {
        const input: UpdateValuePackageInput = {
          ...shared,
          description: clearable(form.description),
        };
        await updateValuePackage.mutateAsync({ id: valuePackage.id, input });
        showToast("success", "Value package updated.");
      } else {
        const input: CreateValuePackageInput = {
          ...shared,
          description: optional(form.description),
        };
        await createValuePackage.mutateAsync(input);
        showToast("success", "Value package added.");
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

  const priceValue = Number(form.price);
  const creditValue = Number(form.credit);
  const creditBelowPrice =
    form.price.trim() !== "" &&
    form.credit.trim() !== "" &&
    Number.isFinite(priceValue) &&
    Number.isFinite(creditValue) &&
    creditValue < priceValue;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEditing ? "Edit value package" : "Add value package"}
      description={
        isEditing
          ? "Change the price, the credit or the expiry. Customers who already bought this keep what they bought."
          : "A price and the credit it buys. The difference between them is the offer."
      }
      widthClassName="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" form="value-package-form" loading={isSaving}>
            {isEditing ? "Save changes" : "Add value package"}
          </Button>
        </>
      }
    >
      <form
        id="value-package-form"
        onSubmit={handleSubmit}
        noValidate
        className="flex flex-col gap-4"
      >
        {formError ? (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        ) : null}

        <Input
          label="Name"
          required
          placeholder="e.g. $600 credit for $545"
          value={form.name}
          onChange={(event) => set("name")(event.target.value)}
          error={fieldError("name")}
          maxLength={200}
          hint="How the package is described on the shelf and in the till's search."
          autoFocus
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Price"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={form.price}
            onChange={(event) => set("price")(event.target.value)}
            error={fieldError("price")}
            hint="What the customer pays today."
          />
          <Input
            label="Credit"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            value={form.credit}
            onChange={(event) => set("credit")(event.target.value)}
            error={fieldError("credit")}
            hint="What they may spend later. More than zero."
          />
        </div>

        {creditBelowPrice ? (
          <p role="status" className="text-xs text-warning-text">
            Credit is less than the price: the customer would pay more than they can spend. Check
            the two boxes are the right way round.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Validity (days)"
            type="number"
            min="1"
            max="36500"
            step="1"
            placeholder="e.g. 365"
            value={form.validityDays}
            onChange={(event) => set("validityDays")(event.target.value)}
            error={fieldError("validityDays")}
            hint="24-hour days from completed purchase. Blank means no expiry."
          />
          <Select
            label="Status"
            value={form.status}
            onChange={(event) => set("status")(event.target.value)}
            error={fieldError("status")}
            options={STATUS_OPTIONS}
            hint="Inactive keeps its history but stops appearing at the till."
          />
        </div>

        <Input
          label="Description"
          placeholder="e.g. Prepay $545 and spend $600 on any service"
          value={form.description}
          onChange={(event) => set("description")(event.target.value)}
          error={fieldError("description")}
          maxLength={2000}
        />

        <fieldset className="flex flex-col gap-2 rounded-card border border-line p-4">
          <legend className="px-1 text-sm font-bold text-ink">Services it is designed for</legend>
          <p className="text-xs text-ink-muted">
            Descriptive only: the credit is spent like cash, on any service. Ticking these records
            what the package is for, and the till shows the count.
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
                <Checkbox
                  key={service.id}
                  label={service.name}
                  checked={serviceIds.includes(service.id)}
                  onChange={(event) => toggleService(service.id, event.target.checked)}
                />
              ))}
            </div>
          )}

          {/* Said out loud rather than silently truncated, like the bundle editor: an
              invisible omission is how a package ends up describing the wrong services. */}
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
