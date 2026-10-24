import { useRef } from "react";

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
    <div className="detail-tabs" role="tablist" aria-label="Company sections">
      {detailTabs.map(([id, label], index) => (
        <button
          key={id}
          ref={(node) => {
            buttons.current[index] = node;
          }}
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
        >
          {label}
        </button>
      ))}
    </div>
  );
}
