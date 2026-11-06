/**
 * A tab set following the WAI-ARIA tabs pattern.
 *
 * Geometry follows the handoff's `.tab-opt` (screen 07): `12.5px`/`700`, which
 * is `text-sm font-bold` exactly — no snapping needed, see [ADR 0006]. The
 * handoff's own heights land at ~43px, so `h-control` is within a pixel *and*
 * clears the 44px tap target the roadmap requires; it is kept for that reason.
 * The handoff draws the row border as `#EEF0F7`, so this is `border-line-soft`.
 *
 * Two deliberate departures from `.tab-opt`, both recorded rather than imitated.
 * The handoff lays its tabs out `flex: 1` and centred; this is a horizontally
 * scrollable strip, which stays legible when a tab set does not fit the frame
 * and costs a screen no extra CSS. The active tab is an `inset 0 -2px 0` shadow
 * in the handoff and a `border-b-2` here — the same 2px purple underline, drawn
 * as a border so it cannot drift from the text colour.
 *
 * Arrow keys move between tabs, Home and End jump to the ends, and only the
 * active tab is in the tab order (roving tabindex) so Tab moves past the strip
 * to the panel instead of walking every tab. Disabled tabs are skipped when
 * cycling and are not reachable.
 *
 * Controlled: `activeId` plus `onChange`. The panel is rendered for the active
 * tab only, so a tab that switches views should keep its own state above.
 *
 * `keepMounted` is the one exception: it renders every panel and hides the
 * inactive ones with `hidden`, for tab sets whose panels hold unsaved drafts
 * (the Settings commission tabs). A hidden panel is not focusable and is not in
 * the accessibility tree, so only the active panel is reachable — the same
 * reading order as the default behaviour, with the draft still alive.
 */
import { useId, useRef } from "react";

import { cn } from "@/lib/utils";

export interface TabItem {
  id: string;
  label: React.ReactNode;
  /** Count or status next to the label — decorative, the label carries meaning. */
  badge?: React.ReactNode;
  disabled?: boolean;
  content: React.ReactNode;
}

export interface TabsProps {
  /** Names the tab set for assistive technology. */
  label: string;
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  /**
   * Render every panel and hide the inactive ones with `hidden`, instead of
   * mounting the active panel alone. Opt in when a panel owns an unsaved draft
   * that must survive a look at another tab.
   */
  keepMounted?: boolean;
  className?: string;
}

export default function Tabs({
  label,
  items,
  activeId,
  onChange,
  keepMounted = false,
  className,
}: TabsProps) {
  const baseId = useId();
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});

  const enabled = items.filter((item) => !item.disabled);

  const move = (direction: 1 | -1) => {
    if (enabled.length === 0) return;
    const current = enabled.findIndex((item) => item.id === activeId);
    const from = current === -1 ? 0 : current;
    const next = enabled[(from + direction + enabled.length) % enabled.length];
    onChange(next.id);
    tabs.current[next.id]?.focus();
  };

  const jump = (edge: "first" | "last") => {
    const target = edge === "first" ? enabled[0] : enabled[enabled.length - 1];
    if (!target) return;
    onChange(target.id);
    tabs.current[target.id]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        move(1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        jump("first");
        break;
      case "End":
        event.preventDefault();
        jump("last");
        break;
      default:
        break;
    }
  };

  const active = items.find((item) => item.id === activeId);
  // The active panel alone by default; every panel when drafts must survive.
  const panels = keepMounted ? items : active ? [active] : [];

  return (
    <div className={cn("flex flex-col", className)}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="scrollbar-hide flex gap-1 overflow-x-auto border-b border-line-soft"
      >
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <button
              key={item.id}
              ref={(node) => {
                tabs.current[item.id] = node;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-controls={`${baseId}-panel-${item.id}`}
              aria-selected={isActive}
              disabled={item.disabled}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(item.id)}
              className={cn(
                "inline-flex h-control shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-purple",
                isActive
                  ? "border-purple text-purple"
                  : "border-transparent text-ink-muted hover:text-ink",
                item.disabled && "cursor-not-allowed text-ink-disabled hover:text-ink-disabled",
              )}
            >
              {item.label}
              {item.badge ? (
                <span
                  className={cn(
                    "rounded-pill px-1.5 py-0.5 text-2xs font-medium",
                    isActive ? "bg-purple-soft text-purple" : "bg-surface-2 text-ink-muted",
                  )}
                >
                  {item.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {panels.map((item) => {
        const isActive = item.id === activeId;
        return (
          <div
            key={item.id}
            role="tabpanel"
            id={`${baseId}-panel-${item.id}`}
            aria-labelledby={`${baseId}-tab-${item.id}`}
            hidden={keepMounted ? !isActive : undefined}
            tabIndex={isActive ? 0 : -1}
            className="pt-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple"
          >
            {item.content}
          </div>
        );
      })}
    </div>
  );
}
