/**
 * Create and edit a product — the form half of handoff screen 08's Products tab.
 *
 * The list stays behind the drawer on purpose: a salon setting a price still wants
 * to see the rest of the shelf, which is what `Drawer` is for.
 *
 * **Server-side validation errors land on the field that caused them.** The API
 * answers a 422 with `details: [{ path: "body.memberPrice", message }]`, so
 * `fieldError` strips the `body.` prefix and hands the message to that control's
 * `error` prop. The contract lives in `packages/shared`; nothing here re-declares a
 * rule — the local checks below only catch what is worth not round-tripping.
 *
 * **No cost field**, deliberately: the handoff draws a Cost column but the model has
 * no such column and the legacy database never held one (`PROJECT.md#design-6`
 * checklist). A box here would be a form field with nowhere to save.
 */
import { useState } from "react";

import type { CatalogStatusValue, ProductDetail } from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import Drawer from "@/components/ui/Drawer";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { showToast } from "@/components/ui/toast-store";
import { useDepartments } from "@/hooks/useDepartments";
import { useCreateProduct, useUpdateProduct } from "@/hooks/useProducts";
import { getErrorMessage, getValidationDetails } from "@/lib/api";

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];

interface FormState {
  name: string;
  memberPrice: string;
  nonmemberPrice: string;
  quantity: string;
  points: string;
  departmentId: string;
  status: string;
  description: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  memberPrice: "",
  nonmemberPrice: "",
  quantity: "",
  points: "",
  departmentId: "",
  status: "ACTIVE",
  description: "",
};

function toForm(product: ProductDetail): FormState {
  return {
    name: product.name,
    // Straight through, not re-rounded: the API already sent two decimals, and
    // rewriting `12.5` as `12.50` under the user's cursor would fight their edit.
    memberPrice: product.memberPrice,
    nonmemberPrice: product.nonmemberPrice,
    quantity: String(product.quantity),
    points: String(product.points),
    departmentId: product.departmentId ?? "",
    status: product.status,
    description: product.description ?? "",
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

/** Non-negative money, or a message for the field. */
function moneyError(raw: string, label: string): string | undefined {
  const amount = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(amount) || amount < 0) return label;
  return undefined;
}

export interface ProductFormDrawerProps {
  open: boolean;
  /** `null` creates; a product edits. */
  product: ProductDetail | null;
  onClose: () => void;
}

export default function ProductFormDrawer({ open, product, onClose }: ProductFormDrawerProps) {
  // Seeded once, at mount. The page gives this component a `key` that changes when
  // the record or the open state changes, so a cancelled edit cannot leak its
  // unsaved text into the next one — without an effect copying props into state,
  // which renders twice on every open.
  const [form, setForm] = useState<FormState>(() => (product ? toForm(product) : EMPTY_FORM));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const departments = useDepartments();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const isSaving = createProduct.isPending || updateProduct.isPending;
  const isEditing = product !== null;

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
    const quantity = toCount(form.quantity);
    const points = toCount(form.points);

    // Caught here so the user is not made to wait for a round trip, with the
    // contract's own wording where it has one.
    const localErrors: Record<string, string> = {};
    if (trimmedName === "") localErrors["name"] = "Name is required";

    const memberError = moneyError(form.memberPrice, "Enter the member price");
    if (memberError) localErrors["memberPrice"] = memberError;
    const nonmemberError = moneyError(form.nonmemberPrice, "Enter the non-member price");
    if (nonmemberError) localErrors["nonmemberPrice"] = nonmemberError;

    if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 0)) {
      localErrors["quantity"] = "Stock must be a whole number";
    }
    if (points !== undefined && (!Number.isInteger(points) || points < 0)) {
      localErrors["points"] = "Points must be a whole number";
    }

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    try {
      if (product) {
        await updateProduct.mutateAsync({
          id: product.id,
          input: {
            name: trimmedName,
            memberPrice,
            nonmemberPrice,
            // `quantity` is deliberately not nullable in the contract — stock is
            // corrected by an adjustment, not erased — so a blank box leaves the
            // existing count alone rather than clearing it.
            ...(quantity !== undefined ? { quantity } : {}),
            ...(points !== undefined ? { points } : {}),
            description: clearable(form.description),
            departmentId: clearable(form.departmentId),
            status: (form.status || undefined) as CatalogStatusValue | undefined,
          },
        });
        showToast("success", "Product updated.");
      } else {
        await createProduct.mutateAsync({
          name: trimmedName,
          memberPrice,
          nonmemberPrice,
          ...(quantity !== undefined ? { quantity } : {}),
          ...(points !== undefined ? { points } : {}),
          description: optional(form.description),
          departmentId: optional(form.departmentId),
          status: (form.status || undefined) as CatalogStatusValue | undefined,
        });
        showToast("success", "Product added.");
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
      title={isEditing ? "Edit product" : "Add product"}
      description={
        isEditing
          ? "Update this product's prices and stock. Leave a field blank to clear it."
          : "A name and both prices are all the contract asks for — stock can be corrected later."
      }
      widthClassName="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" form="product-form" loading={isSaving}>
            {isEditing ? "Save changes" : "Add product"}
          </Button>
        </>
      }
    >
      <form id="product-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
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
            label="Stock on hand"
            type="number"
            inputMode="numeric"
            step="1"
            min="0"
            value={form.quantity}
            onChange={(event) => set("quantity")(event.target.value)}
            error={fieldError("quantity")}
            hint={isEditing ? "Leave blank to leave the count alone." : "Defaults to none."}
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
