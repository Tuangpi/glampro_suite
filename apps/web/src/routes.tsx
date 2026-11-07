import { lazy } from "react";
import type { RouteObject } from "react-router";
import { Navigate } from "react-router";

import AppShell from "@/components/layouts/AppShell";
import { ProtectedRoute, PublicOnlyRoute } from "@/components/layouts/RouteGuards";
import { lazyRoute } from "@/components/layouts/RouteWrapper";

// ── Lazy-loaded pages ──────────────────────────────────────────────
const Login = lazy(() => import("@/pages/Login"));
const AcceptInvitation = lazy(() => import("@/pages/AcceptInvitation"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Sale = lazy(() => import("@/pages/Sale"));
const Appointments = lazy(() => import("@/pages/Appointments"));
const Customers = lazy(() => import("@/pages/Customers"));
const CustomerProfile = lazy(() => import("@/pages/CustomerProfile"));
const Products = lazy(() => import("@/pages/Products"));
const Staff = lazy(() => import("@/pages/Staff"));
const Departments = lazy(() => import("@/pages/Departments"));
const StaffProfile = lazy(() => import("@/pages/StaffProfile"));
const Reports = lazy(() => import("@/pages/Reports"));
const Settings = lazy(() => import("@/pages/Settings"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const PublicBooking = lazy(() => import("@/pages/PublicBooking"));

// ── Route tree ─────────────────────────────────────────────────────
// Every rail destination is here. There is no /services route: services are a tab on the
// products screen and a step in the sale and appointment flows (ADR 0005).
const routes: RouteObject[] = [
  { path: "/accept-invitation", element: lazyRoute(<AcceptInvitation />) },
  {
    path: "/book/:slug",
    element: lazyRoute(<PublicBooking />),
  },
  {
    path: "/login",
    element: <PublicOnlyRoute>{lazyRoute(<Login />)}</PublicOnlyRoute>,
  },

  {
    path: "/",
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: lazyRoute(<Dashboard />) },
      // Screens 01–02 (M1). No role guard: a cashier rings sales up, and the rail
      // already hides what a role may not use — hidden is not secured, so the
      // boundary is the API's `requireModule("sales")` either way.
      { path: "sale", element: lazyRoute(<Sale />) },
      { path: "appointments", element: lazyRoute(<Appointments />) },
      { path: "customers", element: lazyRoute(<Customers />) },
      { path: "customers/:id", element: lazyRoute(<CustomerProfile />) },
      { path: "products", element: lazyRoute(<Products />) },
      { path: "staff", element: lazyRoute(<Staff />) },
      { path: "departments", element: lazyRoute(<Departments />) },
      // Screen 09's editor. Creation stays a drawer on the list — it is one short form —
      // while a record's five separate save scopes get a page with a rail, because a
      // single drawer column made payroll look like it was saved by the profile button.
      { path: "staff/:id", element: lazyRoute(<StaffProfile />) },
      { path: "reports", element: lazyRoute(<Reports />) },
      // Screen 11. The API refuses the profile write for anyone else
      // (`requireRole("SUPER_ADMIN", "MANAGER")`), which is the actual boundary.
      { path: "settings", element: lazyRoute(<Settings />) },
      // Outlet management is parked (`constants/outlets.ts`), so the old URL lands
      // on Settings itself rather than on a section that no longer renders.
      { path: "outlets", element: <Navigate to="/settings" replace /> },
      { path: "*", element: lazyRoute(<NotFound />) },
    ],
  },
];

export default routes;
