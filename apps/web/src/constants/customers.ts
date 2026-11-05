import type { GenderValue } from "@glampro_suite/shared";

/**
 * The four gender words the customer form offers.
 *
 * The profile page reads a stored `gender` back with the same words it was
 * entered with, so the option list lives here rather than in the drawer that
 * happens to render it — one list, two readers.
 */
export const GENDER_OPTIONS: { value: GenderValue; label: string }[] = [
  { value: "FEMALE", label: "Female" },
  { value: "MALE", label: "Male" },
  { value: "OTHER", label: "Other" },
  { value: "UNDISCLOSED", label: "Prefer not to say" },
];

/** The label for a stored `gender`, or `null` when it was never recorded. */
export function genderLabel(value: GenderValue | null | undefined): string | null {
  return GENDER_OPTIONS.find((option) => option.value === value)?.label ?? null;
}
