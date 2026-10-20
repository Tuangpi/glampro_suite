/**
 * Create and edit a customer — the form half of handoff screen 07.
 *
 * The list stays behind the drawer on purpose: a salon editing a customer's phone
 * number still wants to see the rest of the book, which is what `Drawer` is for.
 *
 * **Server-side validation errors land on the field that caused them.** The API
 * answers a 422 with `details: [{ path: "body.email", message }]`, so `fieldError`
 * strips the `body.` prefix and hands the message to that control's `error` prop.
 * The contract lives in `packages/shared`; nothing here re-declares a rule.
 */
import { useState } from "react";
import CustomerConsentPanel from "@/components/customers/CustomerConsentPanel";
import ChannelConsentPanel from "@/components/customers/ChannelConsentPanel";

import type { CustomerDetail, GenderValue } from "@glampro_suite/shared";

import CustomerAvatar from "@/components/customers/CustomerAvatar";
import Button from "@/components/ui/Button";
import Drawer from "@/components/ui/Drawer";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { showToast } from "@/components/ui/toast-store";
import { useCreateCustomer, useUpdateCustomer } from "@/hooks/useCustomers";
import { getErrorMessage, getValidationDetails } from "@/lib/api";

const GENDER_OPTIONS = [
  { value: "FEMALE", label: "Female" },
  { value: "MALE", label: "Male" },
  { value: "OTHER", label: "Other" },
  { value: "UNDISCLOSED", label: "Prefer not to say" },
];

interface FormState {
  name: string;
  code: string;
  phone: string;
  email: string;
  gender: string;
  dateOfBirth: string;
  memberId: string;
  address: string;
  comment: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  code: "",
  phone: "",
  email: "",
  gender: "",
  dateOfBirth: "",
  memberId: "",
  address: "",
  comment: "",
};

function toForm(customer: CustomerDetail): FormState {
  return {
    name: customer.name,
    code: customer.code ?? "",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    gender: customer.gender ?? "",
    dateOfBirth: customer.dateOfBirth ?? "",
    memberId: customer.memberId ?? "",
    address: customer.address ?? "",
    comment: customer.comment ?? "",
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

export interface CustomerFormDrawerProps {
  open: boolean;
  /** `null` creates; a customer edits. */
  customer: CustomerDetail | null;
  onClose: () => void;
}

export default function CustomerFormDrawer({ open, customer, onClose }: CustomerFormDrawerProps) {
  // Seeded once, at mount. The page gives this component a `key` that changes when
  // the record or the open state changes, so a cancelled edit cannot leak its
  // unsaved text into the next one — without an effect copying props into state,
  // which renders twice on every open.
  const [form, setForm] = useState<FormState>(() => (customer ? toForm(customer) : EMPTY_FORM));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const isSaving = createCustomer.isPending || updateCustomer.isPending;
  const isEditing = customer !== null;

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

    // Caught here so the user is not made to wait for a round trip, with the
    // contract's own wording so the two can never disagree.
    if (trimmedName === "") {
      setFieldErrors({ name: "Name is required" });
      return;
    }

    try {
      if (customer) {
        await updateCustomer.mutateAsync({
          id: customer.id,
          input: {
            name: trimmedName,
            code: clearable(form.code),
            phone: clearable(form.phone),
            email: clearable(form.email),
            gender: (form.gender || null) as GenderValue | null,
            dateOfBirth: clearable(form.dateOfBirth),
            memberId: clearable(form.memberId),
            address: clearable(form.address),
            comment: clearable(form.comment),
          },
        });
        showToast("success", "Customer updated.");
      } else {
        await createCustomer.mutateAsync({
          name: trimmedName,
          code: optional(form.code),
          phone: optional(form.phone),
          email: optional(form.email),
          gender: (form.gender || undefined) as GenderValue | undefined,
          dateOfBirth: optional(form.dateOfBirth),
          memberId: optional(form.memberId),
          address: optional(form.address),
          comment: optional(form.comment),
        });
        showToast("success", "Customer added.");
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
      title={isEditing ? "Edit customer" : "Add customer"}
      description={
        isEditing
          ? "Update this customer's details. Leave a field blank to clear it."
          : "A name is all you need — you can fill the rest in later."
      }
      widthClassName="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" form="customer-form" loading={isSaving}>
            {isEditing ? "Save changes" : "Add customer"}
          </Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {isEditing ? (
          <div className="flex items-center gap-3 rounded-card bg-surface-muted p-3">
            <CustomerAvatar name={form.name || "?"} size="hero" />
            <p className="text-sm text-ink-muted">Editing an existing customer record.</p>
          </div>
        ) : null}

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
            label="Phone"
            type="tel"
            value={form.phone}
            onChange={(event) => set("phone")(event.target.value)}
            error={fieldError("phone")}
            maxLength={64}
          />
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(event) => set("email")(event.target.value)}
            error={fieldError("email")}
            maxLength={255}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Gender"
            value={form.gender}
            onChange={(event) => set("gender")(event.target.value)}
            error={fieldError("gender")}
            placeholder="Not specified"
            options={GENDER_OPTIONS}
          />
          <Input
            label="Date of birth"
            type="date"
            value={form.dateOfBirth}
            onChange={(event) => set("dateOfBirth")(event.target.value)}
            error={fieldError("dateOfBirth")}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Customer code"
            value={form.code}
            onChange={(event) => set("code")(event.target.value)}
            error={fieldError("code")}
            hint="Optional label shown instead of the name."
            maxLength={64}
          />
          <Input
            label="Membership reference"
            value={form.memberId}
            onChange={(event) => set("memberId")(event.target.value)}
            error={fieldError("memberId")}
            maxLength={64}
          />
        </div>

        <Input
          label="Address"
          value={form.address}
          onChange={(event) => set("address")(event.target.value)}
          error={fieldError("address")}
          maxLength={500}
        />

        <Input
          label="Comment"
          value={form.comment}
          onChange={(event) => set("comment")(event.target.value)}
          error={fieldError("comment")}
          maxLength={2000}
        />
        {customer ? (
          <>
            <CustomerConsentPanel customerId={customer.id} />
            <ChannelConsentPanel customerId={customer.id} />
          </>
        ) : (
          <p className="text-sm text-ink-muted">
            Save the customer first, then edit their record to capture privacy and marketing
            choices. No consent is assumed.
          </p>
        )}
      </form>
    </Drawer>
  );
}
