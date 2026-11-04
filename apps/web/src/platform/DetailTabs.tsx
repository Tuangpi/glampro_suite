/**
 * The company detail's section tabs.
 *
 * Deliberately not `components/ui/Tabs`: that one unmounts the panel you are not
 * looking at, and two of these panels hold typed drafts — a change reason, a
 * subscription period, a deletion confirmation. Switching to Activity and back
 * would silently wipe them. Here every panel stays mounted and `hidden`, as the
 * `role="tabpanel"` / `aria-controls` wiring already promised.
 *
 * Styling is the handoff's tab row: a pill on `--sp-purple-bg` for the current
 * section, `--sp-border` underneath, and the 30px `sm` height because four tabs
 * across a phone would otherwise wrap.
 */
import { useRef } from "react";

import { cn } from "@/lib/utils";

const detailTabs = [
  ["overview", "Overview"],
  ["subscription", "Subscription"],
  ["modules", "Module access"],
  ["activity", "Activity"],
] as const;

export type DetailTab = (typeof detailTabs)[number][0];

export default function DetailTabs({
  value,
  onChange,
  disabled,
}: {
  value: DetailTab;
  onChange: (value: DetailTab) => void;
  disabled: boolean;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div
      className="flex gap-1 overflow-x-auto border-b border-line pb-2 scrollbar-hide"
      role="tablist"
      aria-label="Company sections"
    >
      {detailTabs.map(([id, label], index) => (
        <button
          key={id}
          ref={(node) => {
            buttons.current[index] = node;
          }}
          type="button"
          role="tab"
          id={`company-tab-${id}`}
          aria-controls={`company-panel-${id}`}
          aria-selected={value === id}
          tabIndex={value === id ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(id)}
          onKeyDown={(event) => {
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? detailTabs.length - 1
                  : event.key === "ArrowRight"
                    ? (index + 1) % detailTabs.length
                    : event.key === "ArrowLeft"
                      ? (index + detailTabs.length - 1) % detailTabs.length
                      : null;
            if (next === null) return;
            event.preventDefault();
            onChange(detailTabs[next][0]);
            buttons.current[next]?.focus();
          }}
          className={cn(
            "flex h-control-sm items-center rounded-pill px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple disabled:cursor-not-allowed disabled:opacity-60",
            value === id
              ? "bg-purple-soft text-purple"
              : "text-ink-body hover:bg-surface-2 hover:text-ink",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
