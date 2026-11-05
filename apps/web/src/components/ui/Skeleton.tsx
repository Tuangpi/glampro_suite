/**
 * A loading placeholder shaped like the content it stands in for.
 *
 * It is decorative and always `aria-hidden`, so a screen reader is not read a
 * row of empty boxes. The loading state belongs on the container: give it
 * `aria-busy="true"` and a label, e.g.
 *
 * ```tsx
 * <div aria-busy="true" aria-label="Loading customers">
 *   <Skeleton />
 * </div>
 * ```
 *
 * Size comes from `className` rather than width/height props so a caller never
 * has to invent a pixel value; the default is a single text line.
 *
 * Heights are safe to override from `className` (`h-11` wins over the default
 * `h-4`), but a **width** is not: `cn` only joins strings, so a `w-24` beside the
 * built-in `w-full` is settled by stylesheet order rather than by the caller. Narrow
 * a bar with `max-w-*`, which always beats a width, or size a wrapper and let the
 * bar fill it with `h-full w-full`.
 *
 * The pulse is `motion-safe`, so a reader who has asked their system to reduce
 * motion gets a still block instead of a shimmering one.
 */
import { cn } from "@/lib/utils";

export interface SkeletonProps {
  className?: string;
}

export default function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn("h-4 w-full rounded-sm bg-surface-2 motion-safe:animate-pulse", className)}
    />
  );
}
