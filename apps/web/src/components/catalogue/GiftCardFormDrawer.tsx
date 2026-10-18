/**
 * Create and edit a gift card — the form half of handoff screen 08's Gift cards tab.
 *
 * **There is no Status control, because the model has no status column.** The tab's
 * other two tables draw one; `GiftCard` has none, so this form does not offer a
 * state the API cannot store — the same rule that keeps screen 09's Shifts and
 * Rating columns out (`PROJECT.md#design-6`).
 *
 * The expiry date is the one field with a value the form must be able to *remove*:
 * a card that never expires is a real product, so an empty date box means `null` on
 * update and "no expiry" on create. Legacy stored `expired_date` as text precisely
 * because it was allowed to be empty (Q6) — a defaulted date would expire every
 * migrated card.
 */
import { useState } from "react";

import type {
  CreateGiftCardInput,
  GiftCardDetail,
  UpdateGiftCardInput,
} from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import Drawer from "@/components/ui/Drawer";
import Input from "@/components/ui/Input";
import { showToast } from "@/components/ui/toast-store";
import { useCreateGiftCard, useUpdateGiftCard } from "@/hooks/useGiftCards";
import { getErrorMessage, getValidationDetails } from "@/lib/api";

interface FormState {
  name: string;
  value: string;
  expiresAt: string;
  remark: string;
  qrPayload: string;
}

const EMPTY_FORM: FormState = { name: "", value: "", expiresAt: "", remark: "", qrPayload: "" };

function toForm(card: GiftCardDetail): FormState {
  return {
    name: card.name,
    value: card.value,
    // The API sends the stored instant; `<input type="date">` wants the day, and the
    // day is what was entered.
    expiresAt: card.expiresAt === null ? "" : card.expiresAt.slice(0, 10),
    remark: card.remark ?? "",
    qrPayload: card.qrPayload ?? "",
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

export interface GiftCardFormDrawerProps {
  open: boolean;
  /** `null` creates; a card edits. */
  card: GiftCardDetail | null;
  onClose: () => void;
}

export default function GiftCardFormDrawer({ open, card, onClose }: GiftCardFormDrawerProps) {
  // Seeded once, at mount: the page's `key` changes with the record and the open
  // state, so a cancelled edit cannot leak into the next one.
  const [form, setForm] = useState<FormState>(() => (card ? toForm(card) : EMPTY_FORM));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const createGiftCard = useCreateGiftCard();
  const updateGiftCard = useUpdateGiftCard();
  const isSaving = createGiftCard.isPending || updateGiftCard.isPending;
  const isEditing = card !== null;

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

    const name = form.name.trim();

    const localErrors: Record<string, string> = {};
    if (name === "") localErrors["name"] = "Name is required";

    const valueError = moneyError(form.value, "Enter the value on the card");
    if (valueError) localErrors["value"] = valueError;

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    const expiry = form.expiresAt.trim();

    try {
      if (card) {
        const input: UpdateGiftCardInput = {
          name,
          value: Number(form.value),
          // `null` clears the date; `"2027-01-31"` sets it. Either way the key is
          // present, because this form owns the field.
          expiresAt: expiry === "" ? null : expiry,
          remark: clearable(form.remark),
          qrPayload: clearable(form.qrPayload),
        };
        await updateGiftCard.mutateAsync({ id: card.id, input });
        showToast("success", "Gift card updated.");
      } else {
        const input: CreateGiftCardInput = {
          name,
          value: Number(form.value),
          ...(expiry === "" ? {} : { expiresAt: expiry }),
          remark: optional(form.remark),
          qrPayload: optional(form.qrPayload),
        };
        await createGiftCard.mutateAsync(input);
        showToast("success", "Gift card added.");
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
      title={isEditing ? "Edit gift card" : "Add gift card"}
      description={
        isEditing
          ? "Update this card's value and expiry. Emptying the date means it never expires."
          : "A name and a value are all the contract asks for. Leave the date empty for a card that never expires."
      }
      widthClassName="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" form="gift-card-form" loading={isSaving}>
            {isEditing ? "Save changes" : "Add gift card"}
          </Button>
        </>
      }
    >
      <form id="gift-card-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
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
          hint="How the card is described on the shelf, e.g. “$100 gift card”."
          autoFocus
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Value"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={form.value}
            onChange={(event) => set("value")(event.target.value)}
            error={fieldError("value")}
            hint="What the card is worth when it is spent."
          />
          <Input
            label="Expires"
            type="date"
            value={form.expiresAt}
            onChange={(event) => set("expiresAt")(event.target.value)}
            error={fieldError("expiresAt")}
            hint="Leave empty for a card that never expires."
          />
        </div>

        <Input
          label="Remark"
          value={form.remark}
          onChange={(event) => set("remark")(event.target.value)}
          error={fieldError("remark")}
          maxLength={2000}
          hint="Optional note, e.g. which promotion the card belongs to."
        />

        <Input
          label="QR code value"
          value={form.qrPayload}
          onChange={(event) => set("qrPayload")(event.target.value)}
          error={fieldError("qrPayload")}
          maxLength={2000}
          hint="Optional. The text to put in the card's QR code, for example a code from your card supplier."
        />
      </form>
    </Drawer>
  );
}
