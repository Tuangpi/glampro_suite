import type { SVGProps } from "react";

/**
 * Split icon — geometry copied verbatim from
 * `design/handoff/icons/split.svg`.
 *
 * Decorative by default: colour comes from the inherited text colour and
 * size from the font size (`text-*` utilities), per PROJECT.md#design-4.
 */
export function Split(props: SVGProps<SVGSVGElement>) {
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
      <line x1="4" y1="12" x2="9" y2="12"></line>
      <line x1="15" y1="12" x2="20" y2="12"></line>
      <polyline points="8 8 4 12 8 16"></polyline>
      <polyline points="16 8 20 12 16 16"></polyline>
    </svg>
  );
}
