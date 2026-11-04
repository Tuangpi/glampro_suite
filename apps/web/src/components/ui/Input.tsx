/**
 * A single-line text field with its label, hint and error already wired.
 *
 * Pass `type` for the native variant; the component only adds presentation.
 * Server-side validation errors land in `error` and surface on the field that
 * caused them.
 *
 * `placeholder` speaks in one of two voices, and is never a rule and never a stand-in
 * for the label:
 *
 * - an **example of a valid value** (`+65 9123 4567`, `e.g. 10`, `0.00`) — the shape of
 *   the data, for a field whose value an operator reads off a record;
 * - an **instruction** (`Please enter your current password`, `Please enter your new
 *   password again`, `Please enter the code from your email`) — what to type, for a
 *   secret or a confirmation. A masked field paints its placeholder as the only
 *   unmasked text it ever shows, so a sample password, PIN or code must never go
 *   there, and a second box has to say which box it is.
 *
 * Anything that must survive the first keystroke — a length, a format, an expiry —
 * belongs in `hint`, which `Field` keeps on screen and wires to `aria-describedby`.
 * This is the convention in `docs/platform-console.md#placeholders-and-hints`; the
 * whole web app follows it, not only the console.
 */
import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";
import Field, { CONTROL_CLASS } from "./Field";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  /** Rendered after the label — e.g. a character count. */
  trailing?: React.ReactNode;
  /** Stretch to the field width. Off for controls that sit inline. */
  fullWidth?: boolean;
}

export default function Input({
  label,
  hint,
  error,
  trailing,
  fullWidth = true,
  className,
  disabled = false,
  ...rest
}: InputProps) {
  return (
    <Field label={label} hint={hint} error={error} trailing={trailing}>
      {({ controlId, describedBy }) => (
        <input
          id={controlId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(CONTROL_CLASS, "h-control px-3", !fullWidth && "w-auto", className)}
          {...rest}
        />
      )}
    </Field>
  );
}
