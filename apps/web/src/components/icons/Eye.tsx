import type { SVGProps } from "react";

/**
 * Eye icon — geometry copied verbatim from
 * `design/handoff/icons/eye.svg`.
 *
 * Decorative by default: colour comes from the inherited text colour and
 * size from the font size (`text-*` utilities), per PROJECT.md#design-4.
 */
export function Eye(props: SVGProps<SVGSVGElement>) {
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
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"></path>
    </svg>
  );
}
