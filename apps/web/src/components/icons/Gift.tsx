import type { SVGProps } from "react";

/**
 * Gift icon — geometry copied verbatim from
 * `design/handoff/icons/gift.svg`.
 *
 * Decorative by default: colour comes from the inherited text colour and
 * size from the font size (`text-*` utilities), per PROJECT.md#design-4.
 */
export function Gift(props: SVGProps<SVGSVGElement>) {
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
      <rect x="3" y="8" width="18" height="13" rx="1"></rect>
      <path d="M12 8v13"></path>
      <path d="M3 12h18"></path>
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"></path>
    </svg>
  );
}
