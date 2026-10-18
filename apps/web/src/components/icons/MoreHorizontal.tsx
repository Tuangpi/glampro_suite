import type { SVGProps } from "react";

/**
 * MoreHorizontal icon — geometry copied verbatim from
 * `design/handoff/icons/more-horizontal.svg`.
 *
 * Decorative by default: colour comes from the inherited text colour and
 * size from the font size (`text-*` utilities), per PROJECT.md#design-4.
 */
export function MoreHorizontal(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable={false}
      aria-hidden
      {...props}
    >
      <circle cx="5" cy="12" r="1.6"></circle>
      <circle cx="12" cy="12" r="1.6"></circle>
      <circle cx="19" cy="12" r="1.6"></circle>
    </svg>
  );
}
