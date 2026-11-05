/**
 * What `/staff/:id` draws while the record is still arriving.
 *
 * The page used to render a single line of text — "Loading staff member…" — where a
 * two-column layout was about to appear. The back link, the avatar, the header, the
 * 220px rail and the section card all vanished for the length of the request and then
 * snapped in, which is the jump people noticed when they clicked a name in the list.
 *
 * This draws the page instead of a sentence about the page: the same `gap-6` shell,
 * the same `gap-4` header block, the same `lg:grid-cols-[220px_minmax(0,1fr)]` grid,
 * and one card where the active section goes. The heights come from the real
 * elements — `size-14` for the avatar disc, `h-11` for a rail button, `h-control` for
 * the phone-sized section picker — so the swap moves nothing.
 *
 * The sentence is still there, visually hidden: a screen reader is told what is
 * happening, which a row of `aria-hidden` boxes would never do.
 */
import Skeleton from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

/** The rail's five entries, in the order `STAFF_SECTIONS` lists them. */
const RAIL_ROWS = 5;

/**
 * A bar of an exact size.
 *
 * `Skeleton` ships `h-4 w-full rounded-sm` and `cn` only joins strings, so nothing a
 * caller adds can be relied on to win a fight with those three: in the emitted
 * stylesheet `w-full` comes after `w-24`, and `rounded-sm` after `rounded-full`, so the
 * avatar disc and the badge pills would silently render as full-width squares. The size
 * and the radius therefore live on a wrapper that clips the bar, which is settled by
 * CSS rather than by class order.
 */
function Bar({ className }: { className?: string }) {
  return (
    <div className={cn("overflow-hidden", className)}>
      <Skeleton className="h-full w-full" />
    </div>
  );
}

export default function StaffProfileSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        Loading staff member…
      </p>

      <div className="flex flex-col gap-4">
        {/* The way back, so the page never traps a reader who arrived by mistake. */}
        <Bar className="h-4 w-28" />

        <div className="flex flex-wrap items-center gap-4">
          <Bar className="size-14 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Bar className="h-6 w-48 max-w-full" />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Bar className="h-5 w-24 rounded-pill" />
              <Bar className="h-5 w-20 rounded-pill" />
            </div>
            <Bar className="mt-2 h-4 w-72 max-w-full" />
          </div>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-6">
          {/* The phone picker, which is the rail's stand-in below `lg` (`h-control`). */}
          <Bar className="h-11 w-full rounded-md lg:hidden" />
          <div className="hidden flex-col gap-1 lg:flex">
            {Array.from({ length: RAIL_ROWS }, (_, index) => (
              <Bar key={index} className="h-11 w-full rounded-lg" />
            ))}
          </div>
          <Bar className="mt-4 h-8 w-full" />
        </aside>

        {/* One card, because every section of this page is a card with a saved form in
            it: a heading, a line about what it saves, fields and a footer button. */}
        <div className="flex min-w-0 flex-col gap-5">
          <div>
            <Bar className="h-6 w-40 max-w-full" />
            <Bar className="mt-2 h-4 w-80 max-w-full" />
          </div>
          <div className="rounded-card border border-line bg-surface">
            <div className="border-b border-line-soft px-5 py-4">
              <Bar className="h-4 w-32 max-w-full" />
            </div>
            <div className="flex flex-col gap-4 px-5 py-4">
              <Bar className="h-11 w-full rounded-md" />
              <Bar className="h-11 w-full rounded-md" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Bar className="h-11 w-full rounded-md" />
                <Bar className="h-11 w-full rounded-md" />
              </div>
            </div>
            <div className="flex justify-end border-t border-line-soft bg-surface-muted px-3 py-3">
              <Bar className="h-11 w-32 rounded-md" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
