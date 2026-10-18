import type { SVGProps } from "react";

/**
 * CheckCircle icon — geometry copied verbatim from
 * `design/handoff/icons/check-circle.svg`.
 *
 * Decorative by default: colour comes from the inherited text colour and
 * size from the font size (`text-*` utilities), per PROJECT.md#design-4.
 */
export function CheckCircle(props: SVGProps<SVGSVGElement>) {
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
      <circle cx="12" cy="12" r="10"></circle>
      <polyline points="8 12 11 15 16 9"></polyline>
    </svg>
  );
}
