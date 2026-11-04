/**
 * An on/off control for a setting that takes effect immediately — module
 * access, an account's second factor.
 *
 * A switch, not a checkbox: `Checkbox` needs a Save button because a checkbox
 * is part of a form, and these two settings have no form around them. The
 * native control is a `<button role="switch">`, so Space and Enter toggle it
 * and a screen reader announces "on"/"off" from `aria-checked` rather than
 * leaving the state to the colour of a track.
 *
 * `label` is required: an unnamed switch is read as the bare word "switch", and
 * it is also what the row is labelled by, so the 44px target and the accessible
 * name are the same thing.
 *
 * Changing a switch is a request, not a local flip. While `loading` is set the
 * control keeps the position the server last reported and refuses input, so a
 * failed request cannot leave the switch showing a state that was never saved.
 */
import { useId } from "react";

import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** What flipping it actually does. Sits under the label. */
  description?: React.ReactNode;
  /** A `Badge` beside the label — "Core", "Expired". */
  meta?: React.ReactNode;
  disabled?: boolean;
  /** A request is in flight; the control is inert until it answers. */
  loading?: boolean;
}

export default function Switch({
  checked,
  onChange,
  label,
  description,
  meta,
  disabled = false,
  loading = false,
}: SwitchProps) {
  const labelId = useId();
  const descriptionId = useId();

  return (
    <div className="flex min-h-control items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span id={labelId} className="text-sm font-medium text-ink">
            {label}
          </span>
          {meta}
        </div>
        {description ? (
          <p id={descriptionId} className="mt-0.5 text-xs text-ink-muted">
            {description}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        onClick={() => onChange(!checked)}
        className={cn(
          "flex h-control w-14 shrink-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "relative flex h-6 w-11 items-center rounded-pill transition-colors",
            checked ? "bg-purple" : "bg-line",
          )}
        >
          <span
            className={cn(
              "absolute left-0.5 size-5 rounded-pill bg-white shadow-sm transition-transform",
              checked && "translate-x-5",
            )}
          />
        </span>
      </button>
    </div>
  );
}
