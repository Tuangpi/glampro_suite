import type { GlobalRole, ModuleCode, ModuleEntitlement } from "@glampro_suite/shared";
import type { ComponentType, SVGProps } from "react";

import {
  BarChart,
  Briefcase,
  Calendar,
  Cart,
  Grid,
  Package,
  Settings,
  Users,
} from "@/components/icons";

export interface NavItem {
  label: string;
  path: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Roles allowed to see the entry. Omitted = every signed-in user. */
  roles?: GlobalRole[];
  /** Which live counter to show on the rail badge, if any. */
  badge?: "openCart" | "lowStock";
  /**
   * The `Module.code` this destination needs, omitted = always available.
   *
   * This is the field `saas/TENANCY.md` §5 promised when `GET /api/auth/me`
   * started returning the salon's effective entitlements. Hiding is a
   * convenience only — `requireModule` on the API is the boundary, because
   * hidden is not secured.
   */
  module?: ModuleCode;
}

/**
 * The Salon Pro app rail (see handoff screens 05–11).
 *
 * Icons come from the handoff set ported into `@/components/icons`
 * (see PROJECT.md#design-4).
 *
 * Staff is an unrestricted peer of Customers and Products because the handoff's
 * own rail draws it that way — screens 05–11 all render a Staff entry between
 * Products and Reports. The screen behind it lands in the phase that builds the
 * staff surface; until then the entry matches the other not-yet-built routes.
 *
 * The rail has **eight** entries, and there is deliberately none for Services:
 * the handoff rail draws seven destinations plus Settings in its foot, and
 * services are reached from the Products tab row and from the sale and
 * appointment flows. The count and the absence are both asserted in
 * navigation.test.ts, so do not add a ninth entry without a decision. See ADR
 * 0005 (PROJECT.md#adr-0005) and
 * PROJECT.md#design-5.
 */
export const navItems: NavItem[] = [
  { label: "Dashboard", path: "/", icon: Grid, module: "dashboard" },
  { label: "Sale", path: "/sale", icon: Cart, badge: "openCart", module: "sales" },
  { label: "Appointments", path: "/appointments", icon: Calendar, module: "appointments" },
  { label: "Customers", path: "/customers", icon: Users, module: "customers" },
  { label: "Products", path: "/products", icon: Package, badge: "lowStock", module: "catalogue" },
  { label: "Staff", path: "/staff", icon: Briefcase, module: "staff" },
  {
    label: "Reports",
    path: "/reports",
    icon: BarChart,
    roles: ["SUPER_ADMIN", "MANAGER"],
    module: "reports",
  },
  {
    // No `module`: settings is the salon's own configuration rather than a
    // switchable feature, so it is never hidden for entitlement reasons.
    label: "Settings",
    path: "/settings",
    icon: Settings,
    roles: ["SUPER_ADMIN", "MANAGER"],
  },
];

/**
 * Filters the rail for the signed-in role and the salon's entitlements.
 *
 * `entitlements` is `undefined` until `/auth/me` answers, and **omitting it must
 * not filter**: a half-loaded rail that flickers entries in and out is worse
 * than briefly showing one the salon cannot use, and the API refuses it either
 * way. An explicit empty list *is* a real answer — a salon with nothing
 * entitled — so it filters to entries with no `module`.
 */
export function visibleNavItems(role?: GlobalRole, entitlements?: ModuleEntitlement[]): NavItem[] {
  const entitled = entitlements ? new Set(entitlements.map((entry) => entry.code)) : null;

  return navItems.filter((item) => {
    if (item.roles && !(role !== undefined && item.roles.includes(role))) return false;
    if (entitled && item.module && !entitled.has(item.module)) return false;
    return true;
  });
}

/** Longest-prefix match so nested routes keep their parent highlighted. */
export function activeNavItem(
  pathname: string,
  role?: GlobalRole,
  entitlements?: ModuleEntitlement[],
): NavItem | undefined {
  return visibleNavItems(role, entitlements)
    .filter(
      (item) =>
        item.path === pathname || (item.path !== "/" && pathname.startsWith(`${item.path}/`)),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];
}
