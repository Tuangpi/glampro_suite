/**
 * Customers — handoff screen 07.
 *
 * **Three columns from the handoff are deliberately absent.** The handoff's table
 * reads Customer / Phone / Last visit / Total spend / Tier; `lastVisit` and
 * `totalSpend` are aggregates over sales the POS phase has not built, and `tier`
 * reads a membership table the schema does not have. `PROJECT.md#design-6`
 * item 5 says a screen is a proposal and the screen changes where it disagrees
 * with the real model — a placeholder zero would read to a salon as "this customer
 * has never spent anything", which is a different and wrong statement. Those
 * columns return in the phase that has the data behind them.
 */
import { useEffect, useState } from "react";

import type { CustomerDetail, CustomerSummary } from "@glampro_suite/shared";

import CustomerAvatar from "@/components/customers/CustomerAvatar";
import CustomerFormDrawer from "@/components/customers/CustomerFormDrawer";
import { Search, Users } from "@/components/icons";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Pagination from "@/components/ui/Pagination";
import Skeleton from "@/components/ui/Skeleton";
import Table, { type TableColumn } from "@/components/ui/Table";
import { useAuth } from "@/contexts/AuthContext";
import { useCustomerList } from "@/hooks/useCustomers";
import { get, getErrorMessage } from "@/lib/api";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

const PAGE_SIZE = 20;

export default function Customers() {
  const { formatDate } = useSalonFormatting();
  const { isReadOnly } = useAuth();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editing, setEditing] = useState<CustomerDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Typing should not fire a query per keystroke, but the box must still feel
  // immediate, so the term is debounced rather than submitted.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const { data, isPending, isError, error, isFetching } = useCustomerList({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    includeArchived: includeArchived || undefined,
  });

  const rows = data?.data ?? [];

  function openCreate() {
    setEditing(null);
    setDrawerOpen(true);
  }

  async function openEdit(customer: CustomerSummary) {
    // A list row is a summary and the form needs the whole record, so opening the
    // editor is a second read rather than a re-use of the row.
    setEditing(await get<CustomerDetail>(`/customers/${customer.id}`));
    setDrawerOpen(true);
  }

  const columns: TableColumn<CustomerSummary>[] = [
    {
      key: "customer",
      header: "Customer",
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <CustomerAvatar name={row.name} />
          <div className="min-w-0">
            <a
              href={`/customers/${encodeURIComponent(row.id)}`}
              className="truncate font-bold text-ink underline"
            >
              {row.name}
            </a>
            {row.archivedAt ? <p className="text-xs font-bold">Archived</p> : null}
            <p className="truncate text-xs text-ink-muted">
              {row.code
                ? `Code ${row.code}`
                : `Since ${formatDate(row.createdAt, { month: "short", year: "numeric" })}`}
            </p>
          </div>
        </div>
      ),
    },
    { key: "phone", header: "Phone", cell: (row) => row.phone ?? "—" },
    {
      key: "email",
      header: "Email",
      cell: (row) => <span className="break-all text-ink-body">{row.email ?? "—"}</span>,
    },
    { key: "member", header: "Membership", cell: (row) => row.memberId ?? "—" },
    // A suspended salon may look but not change (TENANCY.md §6), so the shell's
    // banner is not the only place that has to say so.
    ...(isReadOnly
      ? []
      : [
          {
            key: "actions",
            header: "Edit",
            align: "right" as const,
            cell: (row: CustomerSummary) => (
              <Button variant="secondary" size="sm" onClick={() => void openEdit(row)}>
                Edit
              </Button>
            ),
          },
        ]),
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg text-ink">Customers</h2>
          <p className="text-sm text-ink-muted">
            Everyone in your salon&rsquo;s book. Search by name or phone.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="customer-search">
            Search customers
          </label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-muted"
            />
            <input
              id="customer-search"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search name or phone…"
              className="h-control w-64 rounded-md border border-line bg-surface pr-3 pl-9 text-sm text-ink transition-colors placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-purple"
            />
          </div>

          <Button onClick={openCreate} disabled={isReadOnly}>
            Add customer
          </Button>
        </div>
      </header>

      <section
        aria-busy={isPending || isFetching}
        aria-label="Customer list"
        className="rounded-card border border-line bg-surface"
      >
        <label className="flex items-center gap-2 px-5 py-3">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => {
              setIncludeArchived(event.target.checked);
              setPage(1);
            }}
          />
          Include archived customers
        </label>
        <div className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
          <p className="text-sm text-ink-muted">
            {isPending
              ? "Loading customers…"
              : `${data?.total ?? 0} ${data?.total === 1 ? "customer" : "customers"}`}
            {search ? ` matching “${search}”` : ""}
          </p>
        </div>

        {isPending ? (
          <div className="flex flex-col gap-3 p-5">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-9" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            title="The customer list could not be loaded"
            description={getErrorMessage(error)}
            icon={<Users />}
            action={<Button onClick={() => window.location.reload()}>Try again</Button>}
          />
        ) : (
          <>
            <Table
              caption="Customers in this salon"
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              className="rounded-none border-0"
              empty={
                search ? (
                  <EmptyState
                    title="No customers match that search"
                    description={`Nothing matches “${search}”. Try a different name or phone number.`}
                    icon={<Search />}
                    action={
                      <Button variant="secondary" onClick={() => setSearchInput("")}>
                        Clear search
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    title="No customers yet"
                    description="Add your first customer to start building the salon’s book."
                    icon={<Users />}
                    action={
                      <Button onClick={openCreate} disabled={isReadOnly}>
                        Add customer
                      </Button>
                    }
                  />
                )
              }
            />

            <div className="flex items-center justify-between gap-3 border-t border-line-soft px-5 py-3">
              <p className="text-xs text-ink-muted">
                Page {data?.page ?? 1} of {Math.max(data?.pageCount ?? 1, 1)}
              </p>
              <Pagination
                page={data?.page ?? 1}
                pageCount={data?.pageCount ?? 1}
                onPageChange={setPage}
                label="Customer list pages"
              />
            </div>
          </>
        )}
      </section>

      <CustomerFormDrawer
        // Remounting on open and on record change is what clears the form. An
        // effect copying props into state would render twice on every open, and
        // resetting `editing` alone would leave a stale edit behind on reopen.
        key={`${editing?.id ?? "new"}:${drawerOpen}`}
        open={drawerOpen}
        customer={editing}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
