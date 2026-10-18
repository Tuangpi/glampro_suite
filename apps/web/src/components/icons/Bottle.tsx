import type { SVGProps } from "react";

/**
 * Bottle icon — geometry copied verbatim from
 * `design/handoff/icons/bottle.svg`.
 *
 * Decorative by default: colour comes from the inherited text colour and
 * size from the font size (`text-*` utilities), per PROJECT.md#design-4.
 */
export function Bottle(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable={false}
      aria-hidden
      {...props}
    >
      <path d="M8 2h8"></path>
      <path d="M9 2v5.2c0 .5-.2 1-.6 1.4L6 11.8A4 4 0 0 0 5 14.6V20a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.4a4 4 0 0 0-1-2.8l-2.4-3.2A2 2 0 0 1 15 7.2V2"></path>
    </svg>
  );
}
