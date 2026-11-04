/**
 * The brand mark: the purple-gradient "G" that the salon rail, the sign-in
 * screens and `favicon.svg` all draw.
 *
 * It lived inside `pages/Login.tsx` until the platform operator sign-in needed
 * the same tile. It is a component rather than a copy so the two front doors
 * cannot drift apart — a second hand-typed gradient would be the first place
 * they did.
 *
 * Size and text scale come from `className` (`size-12 text-lg` is the framed
 * size both screens use), because the tile appears at more than one size.
 */
import { cn } from "@/lib/utils";

export default function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[var(--sp-purple-grad-a)] to-[var(--sp-purple-grad-b)] font-heavy text-white shadow-purple-btn",
        className,
      )}
    >
      G
    </span>
  );
}
