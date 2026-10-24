import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";

import { Bell, LogOut, Plus, Search } from "@/components/icons";
import { activeNavItem, visibleNavItems } from "@/constants/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { useSaleCart } from "@/hooks/useSale";
import { useLowStockCount } from "@/hooks/useProducts";
import { cn, getInitials } from "@/lib/utils";
import OutletPicker from "./OutletPicker";

/**
 * The Salon Pro application frame (handoff screens 05–11):
 * an 84px navy icon rail on the left and a 76px white top bar above the page.
 *
 * Rail geometry was checked against the rendered handoff in Phase 1's screen
 * pass and matches it: 50px-tall, 14px-radius items, a 6px gap between them and
 * a 4px icon-to-label gap, an 8.5px/700 label, and the active item painted
 * `--sp-purple` with the purple button shadow. The item width is the one
 * deliberate deviation — see `--app-rail-item-w` in styles/app-chrome.css.
 *
 * One known gap remains, owned by the sale phase: the open-cart badge that
 * `navItems` declares is not drawn because the counter is live data.
 */
export default function AppShell() {
  const { formatDate } = useSalonFormatting();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, tenant, entitlements, isReadOnly, signOut } = useAuth();
  const items = visibleNavItems(user?.globalRole, entitlements);
  const current = activeNavItem(location.pathname, user?.globalRole, entitlements);
  const [search, setSearch] = useState("");

  // The rail's live counters. Each is asked for only when its entry is on the
  // rail — role first, then entitlement — because a hidden entry must not cost
  // a request. The counts are server-side: the badge counts the whole catalogue
  // while the browser only ever holds one page of it (ADR 0010).
  const lowStock = useLowStockCount(items.some((item) => item.badge === "lowStock"));
  const lowStockTotal = lowStock.data?.total ?? 0;

  // The open cart is the one badge the browser owns: the cart *is* client state
  // kept in the query cache (`useSaleCart`), so this reads no server — and it
  // must not, because an unsold cart exists nowhere else. Counted in lines, as
  // `docs/mvp.md` → M1 says, not in units: "3 in the cart" is 3 things the
  // cashier picked up, not the six shampoos among them.
  const cart = useSaleCart();
  const cartLines = cart.lines.length;
  const showSaleBadge = items.some((item) => item.badge === "openCart");

  return (
    <div className="flex min-h-screen bg-bg">
      <aside className="fixed inset-y-0 left-0 z-40 flex w-rail flex-col items-center bg-navy pt-5 pb-4 print:hidden">
        <div className="mb-[var(--sp-space-10)] flex h-10 w-10 items-center justify-center rounded-md bg-gradient-to-br from-[var(--sp-purple-grad-a)] to-[var(--sp-purple-grad-b)] text-base font-extrabold text-white">
          G
        </div>

        <nav className="flex flex-1 flex-col items-center gap-1.5 overflow-y-auto scrollbar-hide">
          {items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              className={({ isActive }) =>
                cn(
                  "group relative flex h-[var(--app-rail-item-h)] w-[var(--app-rail-item-w)] flex-col items-center justify-center gap-1 rounded-[var(--app-rail-item-radius)] transition",
                  isActive
                    ? "bg-purple text-white shadow-purple-btn"
                    : "text-ink-on-dark hover:bg-[var(--sp-navy-tint-10)] hover:text-white",
                )
              }
            >
              <item.icon className="text-[length:var(--app-rail-icon)]" aria-hidden />
              <span className="text-[length:var(--app-rail-label)] font-bold tracking-[var(--app-rail-tracking)]">
                {item.label}
              </span>

              {/* The handoff's `.nav-badge`: a 16px disc in `--sp-danger` with a
                  2px ring in the rail's own navy, so it reads as a separate token
                  on a coloured item. The number is capped because a salon with
                  hundreds of low items must not stretch the pill. */}
              {item.badge === "lowStock" && lowStockTotal > 0 ? (
                <>
                  <span
                    aria-hidden
                    className="absolute top-0.5 right-2.5 flex h-4 min-w-4 items-center justify-center rounded-pill border-2 border-navy bg-danger px-1 text-2xs font-heavy text-white"
                  >
                    {lowStockTotal > 99 ? "99+" : lowStockTotal}
                  </span>
                  <span className="sr-only">, {lowStockTotal} low on stock</span>
                </>
              ) : item.badge === "openCart" && showSaleBadge && cartLines > 0 ? (
                <>
                  <span
                    aria-hidden
                    className="absolute top-0.5 right-2.5 flex h-4 min-w-4 items-center justify-center rounded-pill border-2 border-navy bg-danger px-1 text-2xs font-heavy text-white"
                  >
                    {cartLines > 99 ? "99+" : cartLines}
                  </span>
                  <span className="sr-only">, {cartLines} lines waiting in the cart</span>
                </>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-1.5 flex h-[var(--app-rail-item-h)] w-[var(--app-rail-item-w)] flex-col items-center justify-center gap-1 rounded-[var(--app-rail-item-radius)] text-ink-on-dark transition hover:bg-[var(--sp-navy-tint-10)] hover:text-white"
        >
          <LogOut className="text-[length:var(--app-rail-icon)]" aria-hidden />
          <span className="text-[length:var(--app-rail-label)] font-bold tracking-[var(--app-rail-tracking)]">
            Log out
          </span>
        </button>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col pl-rail print:pl-0">
        <header className="sticky top-0 z-30 flex h-topbar items-center gap-5 border-b border-line bg-surface px-7 print:hidden">
          <div className="min-w-0">
            <h1 className="truncate text-lg leading-tight">{current?.label ?? "Glampro"}</h1>
            <p className="text-xs text-ink-muted">
              {tenant?.name ?? "Glampro Suite"} — {formatDate(new Date())}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <label className="hidden h-control w-[var(--app-search-w)] items-center gap-2 rounded-md bg-surface-2 px-3.5 lg:flex">
              <Search className="shrink-0 text-ink-muted" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search customers, items…"
                aria-label="Global search"
                className="h-full flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </label>

            <OutletPicker />
            <button
              type="button"
              className="flex h-control w-control items-center justify-center rounded-md bg-surface-2 text-ink-body transition hover:bg-line-soft"
              aria-label="Notifications"
            >
              <Bell />
            </button>

            <button
              type="button"
              onClick={() => navigate("/sale")}
              className="flex h-control items-center gap-2 rounded-md bg-purple px-4 text-sm font-semibold text-white shadow-purple-btn transition hover:bg-purple-dark"
            >
              <Plus aria-hidden />
              New sale
              {cartLines > 0 ? (
                <span className="rounded-pill bg-white/20 px-1.5 text-2xs font-heavy">
                  {cartLines}
                </span>
              ) : null}
            </button>

            <div className="flex items-center gap-2.5 pl-1">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-soft text-xs font-bold text-purple"
                title={user ? `${user.name} — ${user.globalRole.replace("_", " ")}` : undefined}
              >
                {getInitials(user?.name ?? "Glampro Admin")}
              </div>
            </div>
          </div>
        </header>

        {/* A suspended salon can sign in but not write (TENANCY.md §6), so the
            shell says so once rather than leaving every save button to fail. */}
        {isReadOnly ? (
          <p role="status" className="bg-purple-soft px-7 py-2 text-sm text-purple print:hidden">
            This salon&rsquo;s subscription is suspended. You can look at everything, but changes
            are disabled until it is renewed.
          </p>
        ) : null}

        <main className="flex-1 px-7 py-6 print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
