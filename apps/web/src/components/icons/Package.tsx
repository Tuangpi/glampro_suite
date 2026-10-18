import type { SVGProps } from "react";

/**
 * Package icon — geometry copied verbatim from
 * `design/handoff/icons/package.svg`.
 *
 * Decorative by default: colour comes from the inherited text colour and
 * size from the font size (`text-*` utilities), per PROJECT.md#design-4.
 */
export function Package(props: SVGProps<SVGSVGElement>) {
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
      <path d="M21 8l-9-5-9 5 9 5 9-5z"></path>
      <path d="M3 8v8l9 5 9-5V8"></path>
      <line x1="12" y1="13" x2="12" y2="21"></line>
    </svg>
  );
}
