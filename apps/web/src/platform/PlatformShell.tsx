/**
 * The platform console frame: brand mark, the two sections, and who is signed in.
 *
 * The salon app's `AppShell` draws an 84px navy rail because a cashier moves
 * between nine screens many times an hour. An operator visits two — companies
 * and their own account — so the same weight of chrome would be mostly
 * navigation for an empty half of the building. This is a single top bar with
 * the sections as tabs, sized to the same 76px `--sp-topbar-h`.
 *
 * It replaces `platform/style.css`, which carried a second visual language (its
 * own `#58378b`, `system-ui` instead of Plus Jakarta). Every colour, radius and
 * height here is a token, so the console and the salon cannot drift apart again.
 *
 * `Sign out` is a `Button`, not a nav entry: it is not a place.
 */
import { NavLink } from "react-router";

import BrandMark from "@/components/ui/BrandMark";
import Button from "@/components/ui/Button";
import { getInitials } from "@/lib/utils";

const SECTIONS = [
  { to: "/platform", label: "Companies", end: true },
  { to: "/platform/account", label: "Account & security", end: false },
] as const;

export default function PlatformShell({
  name,
  email,
  busy,
  onSignOut,
  children,
}: {
  name: string;
  email: string;
  busy: boolean;
  onSignOut: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="sticky top-0 z-30 border-b border-line bg-surface">
        <div className="mx-auto flex h-topbar w-full max-w-[1280px] items-center gap-4 px-5 lg:px-7">
          <NavLink
            to="/platform"
            className="flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple"
          >
            <BrandMark className="size-9 text-base" />
            <span className="hidden min-w-0 sm:block">
              <span className="block truncate text-sm leading-tight font-heavy text-ink">
                Glampro Suite
              </span>
              <span className="block truncate text-2xs text-ink-muted">
                Platform administration
              </span>
            </span>
          </NavLink>

          <nav aria-label="Platform sections" className="flex items-center gap-1 overflow-x-auto">
            {SECTIONS.map((section) => (
              <NavLink
                key={section.to}
                to={section.to}
                end={section.end}
                className={({ isActive }) =>
                  `flex h-control items-center rounded-md px-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple sm:px-3 ${
                    isActive ? "bg-purple-soft text-purple" : "text-ink-body hover:bg-surface-2"
                  }`
                }
              >
                {section.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            <div className="hidden text-right md:block">
              <p className="max-w-[220px] truncate text-sm font-medium text-ink">{name}</p>
              <p className="max-w-[220px] truncate text-xs text-ink-muted">{email}</p>
            </div>
            <span
              aria-hidden
              className="hidden size-9 items-center justify-center rounded-pill bg-purple-soft text-xs font-bold text-purple sm:flex"
            >
              {getInitials(name)}
            </span>
            <Button variant="secondary" loading={busy} onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1280px] flex-1 px-5 py-6 lg:px-7">{children}</main>
    </div>
  );
}
