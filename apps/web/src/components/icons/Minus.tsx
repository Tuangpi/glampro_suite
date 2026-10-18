import type { SVGProps } from "react";

/**
 * Minus icon — geometry copied verbatim from
 * `design/handoff/icons/minus.svg`.
 *
 * Decorative by default: colour comes from the inherited text colour and
 * size from the font size (`text-*` utilities), per PROJECT.md#design-4.
 */
export function Minus(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable={false}
      aria-hidden
      {...props}
    >
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
  );
}
