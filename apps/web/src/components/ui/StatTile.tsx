/**
 * A stat tile — a count the server made, in a box with an icon.
 *
 * Presentational: a tile shows a number and never filters, which is how handoff
 * screens 08 and 09 both draw them. It was lifted out of `pages/Products.tsx` when the
 * staff screen drew the same tile; the *missing* tiles (the catalogue's Inventory
 * value, a staff member's shifts) are absent because there is no number to put in
 * them, which is a decision about the model rather than about this component.
 *
 * `undefined` renders as an em dash rather than `0`, so a tile that has not answered
 * yet cannot be read as "none".
 */
import { cn } from "@/lib/utils";
import Skeleton from "@/components/ui/Skeleton";

/**
 * The tone tints, taken from `Badge`'s own palette so a warning tile is the same
 * amber the warning badge is.
 */
const TILE_TONES = {
  purple: "bg-purple-soft text-purple",
  success: "bg-success-soft text-success-text",
  neutral: "bg-surface-2 text-ink-body",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger/10 text-danger",
} as const;

export interface StatTileProps {
  icon: React.ReactNode;
  value: number | undefined;
  /**
   * A pre-formatted stand-in for `value` — money, mostly.
   *
   * The income tile is `"1234.50"` as a **string** (a `Decimal(12,2)` that a
   * JSON float would have already lost a cent of), and rendering `1234` would
   * drop the decimals the receipt shows. `display` wins over `value` when
   * present; `value` still drives nothing else, so a tile passing only
   * `display` shows "—" only when `display` is absent too.
   */
  display?: string;
  label: string;
  tone?: keyof typeof TILE_TONES;
  /**
   * The number is still coming.
   *
   * Without this a loading tile renders "—", which is the same glyph a tile with
   * nothing to count shows (`undefined` is deliberately not `0`), so the page could
   * not tell "not yet" from "none". A bar in the number's place says which one this
   * is, and `aria-busy` says it out loud — the label underneath stays readable
   * throughout, so the reader still knows what is being counted.
   */
  loading?: boolean;
}

export default function StatTile({
  icon,
  value,
  display,
  label,
  tone = "purple",
  loading = false,
}: StatTileProps) {
  return (
    <div
      aria-busy={loading || undefined}
      className="flex items-center gap-3 rounded-card border border-line bg-surface px-4.5 py-3.5"
    >
      <span
        aria-hidden
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md",
          TILE_TONES[tone],
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        {loading ? (
          // `text-lg leading-tight` is a 20px line; the bar is the same height, and the
          // width is a `max-w-*` cap because `cn` cannot beat `Skeleton`'s own `w-full`.
          <Skeleton className="h-5 max-w-12" />
        ) : (
          <p className="text-lg font-heavy leading-tight text-ink">{display ?? value ?? "—"}</p>
        )}
        <p className="text-xs text-ink-muted">{label}</p>
      </div>
    </div>
  );
}
