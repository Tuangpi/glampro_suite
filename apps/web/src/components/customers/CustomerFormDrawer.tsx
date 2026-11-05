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
 *
 * **Consent on create is a second request, and it is not atomic.** A consent
 * event needs a customer id, so the choices shown in the Add drawer are held in
 * local state and sent to `POST /customers/:id/consent` once creation returns
 * one — the same audited endpoint the edit drawer's panel uses, so the notice
 * and revision guards are not re-implemented here. If that second call fails the
 * customer still exists: the drawer says so, keeps the created record open (via
 * `onCreated`) so the consent panel is one click away, and never claims the
 * choice was saved.
 */
import { useState } from "react";
import ChannelConsentPanel from "@/components/customers/ChannelConsentPanel";
import CustomerConsentCapture, {
  type ConsentCaptureValue,
} from "@/components/customers/CustomerConsentCapture";
import CustomerConsentPanel from "@/components/customers/CustomerConsentPanel";

import type { CustomerDetail, GenderValue } from "@glampro_suite/shared";

import CustomerAvatar from "@/components/customers/CustomerAvatar";
import Button from "@/components/ui/Button";
import Drawer from "@/components/ui/Drawer";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { showToast } from "@/components/ui/toast-store";
import { GENDER_OPTIONS } from "@/constants/customers";
import { usePrivacyNotice, useRecordConsentForNewCustomer } from "@/hooks/useConsent";
import { useCreateCustomer, useUpdateCustomer } from "@/hooks/useCustomers";
import { getErrorMessage, getValidationDetails } from "@/lib/api";

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

const EMPTY_CONSENT: ConsentCaptureValue = {
  pdpaConsent: false,
  marketingOptIn: false,
  reviewed: false,
};

/** Shown when a grant is ticked but there is no notice to record it against. */
const NO_NOTICE_MESSAGE =
  "Consent capture is disabled until a manager publishes a privacy notice in Settings.";

const UNREVIEWED_MESSAGE = "Confirm you presented the privacy notice before recording consent.";

export interface CustomerFormDrawerProps {
  open: boolean;
  /** `null` creates; a customer edits. */
  customer: CustomerDetail | null;
  onClose: () => void;
  /**
   * Called with the new record when creation succeeded but consent did not, so
   * the page can reopen this drawer on that record and let staff finish there.
   */
  onCreated?: (customer: CustomerDetail) => void;
}

export default function CustomerFormDrawer({
  open,
  customer,
  onClose,
  onCreated,
}: CustomerFormDrawerProps) {
  // Seeded once, at mount. The page gives this component a `key` that changes when
  // the record or the open state changes, so a cancelled edit cannot leak its
  // unsaved text into the next one — without an effect copying props into state,
  // which renders twice on every open.
  const [form, setForm] = useState<FormState>(() => (customer ? toForm(customer) : EMPTY_FORM));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [consent, setConsent] = useState<ConsentCaptureValue>(EMPTY_CONSENT);

  const isEditing = customer !== null;
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const recordConsent = useRecordConsentForNewCustomer();
  // Only the create path needs the notice; an existing record's panel reads it
  // itself, so this query stays off there instead of duplicating the request.
  const noticeQuery = usePrivacyNotice(!isEditing);
  const notice = noticeQuery.data ?? null;
  const wantsConsent = !isEditing && (consent.pdpaConsent || consent.marketingOptIn);
  const isSaving = createCustomer.isPending || updateCustomer.isPending || recordConsent.isPending;

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
        // Checked before the request: a grant with no notice behind it would be
        // refused by the API after the customer already exists, which is the
        // half-saved state this drawer exists to avoid.
        if (wantsConsent && !notice) {
          setFormError(NO_NOTICE_MESSAGE);
          return;
        }
        if (wantsConsent && !consent.reviewed) {
          setFormError(UNREVIEWED_MESSAGE);
          return;
        }

        const created = await createCustomer.mutateAsync({
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

        if (wantsConsent && notice) {
          try {
            // Revision 0 is the record that was just created — no other staff
            // member can have written to it between the two calls.
            await recordConsent.mutateAsync({
              id: created.id,
              input: {
                pdpaConsent: consent.pdpaConsent,
                marketingOptIn: consent.marketingOptIn,
                expectedRevision: 0,
                noticeId: notice.id,
              },
            });
          } catch (cause) {
            // The customer exists and the consent does not. Closing as if it
            // worked would leave "no consent on record" looking like "the
            // customer declined", so the drawer stays on the new record.
            showToast(
              "error",
              `Customer added, but consent was not saved: ${getErrorMessage(cause)}`,
            );
            onCreated?.(created);
            return;
          }
          showToast("success", "Customer added and consent recorded.");
        } else {
          showToast("success", "Customer added.");
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
          placeholder="e.g. Aina Rahman"
          value={form.name}
          onChange={(event) => set("name")(event.target.value)}
          error={fieldError("name")}
          maxLength={200}
          autoFocus
        />

        <div className="grid gap-4 sm:grid-cols-2">
          {/* A stored phone is free text, so only an example can show the shape
              — local number or country code — that the salon is expected to type. */}
          <Input
            label="Phone"
            type="tel"
            placeholder="+65 9123 4567"
            value={form.phone}
            onChange={(event) => set("phone")(event.target.value)}
            error={fieldError("phone")}
            maxLength={64}
          />
          <Input
            label="Email"
            type="email"
            placeholder="name@example.com"
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
            placeholder="e.g. VIP-014"
            value={form.code}
            onChange={(event) => set("code")(event.target.value)}
            error={fieldError("code")}
            hint="Optional label shown instead of the name."
            maxLength={64}
          />
          <Input
            label="Membership reference"
            placeholder="e.g. 8881234567890"
            value={form.memberId}
            onChange={(event) => set("memberId")(event.target.value)}
            error={fieldError("memberId")}
            maxLength={64}
          />
        </div>

        <Input
          label="Address"
          placeholder="e.g. 12 Orchard Road, #03-01"
          value={form.address}
          onChange={(event) => set("address")(event.target.value)}
          error={fieldError("address")}
          maxLength={500}
        />

        <Input
          label="Comment"
          placeholder="e.g. Prefers afternoon slots"
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
          <CustomerConsentCapture
            notice={notice}
            value={consent}
            onChange={setConsent}
            isLoading={noticeQuery.isPending}
            disabled={isSaving}
          />
        )}
      </form>
    </Drawer>
  );
}
