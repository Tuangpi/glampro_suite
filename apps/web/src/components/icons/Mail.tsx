import type { SVGProps } from "react";

/**
 * Mail icon — geometry copied verbatim from
 * `design/handoff/icons/mail.svg`.
 *
 * Decorative by default: colour comes from the inherited text colour and
 * size from the font size (`text-*` utilities), per PROJECT.md#design-4.
 */
export function Mail(props: SVGProps<SVGSVGElement>) {
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
      <rect x="2" y="4" width="20" height="16" rx="2"></rect>
      <polyline points="2 7 12 13 22 7"></polyline>
    </svg>
  );
}
