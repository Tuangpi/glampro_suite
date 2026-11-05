/**
 * Staff — handoff screen 09.
 *
 * **This screen lists and creates; it does not edit.** A staff record carries five
 * independent save scopes — profile, POS PIN and password, roster, payroll and commission
 * rules — and they were being served by one drawer column with a single pinned "Save
 * changes" button, which made payroll settings below the fold look as if that button
 * saved them. Editing is therefore its own page, `/staff/:id`, with a section rail
 * (`StaffProfile`). Creation stays a drawer: it is one short form, it belongs beside the
 * list it appends to, and it has a single save.
 *
 * Working hours are managed on that page rather than as a summary column. Ratings remain
 * absent because the application has no reviews model.
 *
 * **Every tile is a server-side count, not a count of the rows on screen** (ADR 0010).
 * The three tiles ask `?status=` with `pageSize=1` rather than counting what happens to
 * be loaded, so "Disabled" answers for the whole team even on page 3 of 5.
 *
 * **Writes belong to owners and managers.** `POST`/`PATCH` sit behind `requireRole`, so
 * the screen asks `useAuth` for the signed-in role and offers the write affordances only
 * to the two roles the API accepts. Hiding is a convenience and not a boundary — the API
 * refuses a stylist either way — but a button that always answered 403 would be a lie,
 * and a stylist still needs to read the team.
 *
 * **There is no delete.** `disabled` is the archive: a disabled user keeps their
 * appointments and their commission history, which is why the Phase 4 criterion's third
 * verb lives on that page and not on customers (Q28).
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import type { StaffSummary } from "@glampro_suite/shared";

import { Briefcase, CheckCircle, Search, Users } from "@/components/icons";
import StaffCard from "@/components/staff/StaffCard";
import StaffFormDrawer from "@/components/staff/StaffFormDrawer";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import EmptyState from "@/components/ui/EmptyState";
import Pagination from "@/components/ui/Pagination";
import StatTile from "@/components/ui/StatTile";
import Table, { type TableColumn } from "@/components/ui/Table";
import TableSkeleton from "@/components/ui/TableSkeleton";
import { ROLE_BADGE, ROLE_LABELS, STATUS_FILTERS, type StaffStatusFilter } from "@/constants/staff";
import { useAuth } from "@/contexts/AuthContext";
import { useStaffCount, useStaffList } from "@/hooks/useStaff";
import { getErrorMessage } from "@/lib/api";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

const PAGE_SIZE = 20;

export default function Staff() {
  const { formatDateTime } = useSalonFormatting();
  const { user, isReadOnly } = useAuth();
  const navigate = useNavigate();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StaffStatusFilter>("all");
  const [page, setPage] = useState(1);
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

  const staff = useStaffList({ page, pageSize: PAGE_SIZE, search: search || undefined, status });

  // Tiles. Each number is a server-side count over the whole team (ADR 0010), which is
  // what lets the three of them agree with each other and with the list's own total.
  const teamTotal = useStaffCount();
  const activeCount = useStaffCount({ status: "active" });
  const disabledCount = useStaffCount({ status: "disabled" });

  const rows = staff.data?.data ?? [];
  /** Only the two roles the API's `requireRole` accepts may write at all. */
  const canManage = user?.globalRole === "SUPER_ADMIN" || user?.globalRole === "MANAGER";
  const canCreate = user?.globalRole === "SUPER_ADMIN";
  /** …and a suspended salon may only look, whatever the role (TENANCY.md §6). */
  const canWrite = canManage && !isReadOnly;
  /** The word for the filter that is on, for the count line and the empty state. */
  const statusLabel = STATUS_FILTERS.find((filter) => filter.value === status)?.label ?? "";

  function openCreate() {
    setDrawerOpen(true);
  }

  /**
   * Editing is a page, not a drawer (`StaffProfile`).
   *
   * The list row is a summary, so the page does its own second read; navigating rather
   * than fetching here also means a stop at payroll is a real URL — it can be linked,
   * refreshed and bookmarked, which a drawer could not be.
   */
  function openEdit(person: StaffSummary) {
    navigate(`/staff/${person.id}`);
  }

  const columns: TableColumn<StaffSummary>[] = [
    {
      key: "person",
      header: "Staff",
      cell: (row) => (
        <StaffCard
          name={row.name}
          email={row.email}
          href={`/staff/${encodeURIComponent(row.id)}`}
        />
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (row) => (
        <Badge variant={ROLE_BADGE[row.globalRole]}>{ROLE_LABELS[row.globalRole]}</Badge>
      ),
    },
    { key: "position", header: "Position", cell: (row) => row.position ?? "—" },
    {
      key: "departments",
      header: "Departments",
      // A person can work across branches, so this renders the join rows rather than
      // one name: the cell lists them all and says so when there are none.
      cell: (row) =>
        row.departments.length > 0
          ? row.departments.map((department) => department.name).join(", ")
          : "Unassigned",
    },
    {
      key: "lastLogin",
      header: "Last login",
      // Someone who has never signed in reads as an em dash rather than "Never":
      // `formatDateTime` returns one for null, and the status badge says the rest.
      cell: (row) => formatDateTime(row.lastLoginAt),
    },
    { key: "status", header: "Status", cell: (row) => <StatusCell disabled={row.disabled} /> },
    // A suspended salon may look but not change (TENANCY.md §6), and a stylist may not
    // change anything at all, so the shell's banner is not the only place that says so.
    ...(canWrite
      ? [
          {
            key: "actions",
            header: "Edit",
            align: "right" as const,
            cell: (row: StaffSummary) => (
              <Button variant="secondary" size="sm" onClick={() => openEdit(row)}>
                Edit
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg text-ink">Staff</h2>
          <p className="text-sm text-ink-muted">
            Everyone who works in this salon. Search by name or email address.
          </p>
          {user?.globalRole === "MANAGER" && (
            <p className="text-sm text-ink-muted">
              Ask the owner to add staff with audited payroll classification and a join date.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="staff-search">
            Search staff
          </label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-muted"
            />
            <input
              id="staff-search"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search staff…"
              className="h-control w-64 rounded-md border border-line bg-surface pr-3 pl-9 text-sm text-ink transition-colors placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-purple"
            />
          </div>

          {/* A stylist gets no write control at all: `requireRole` would refuse it. A
              suspended salon keeps the button but not the ability (TENANCY.md §6). */}
          {canCreate ? (
            <Button onClick={openCreate} disabled={isReadOnly}>
              Add staff member
            </Button>
          ) : null}
        </div>
      </header>

      {/* Above the filter row, as the catalogue's tiles sit above its tabs: these are
          facts about the team rather than about the table, so the filter does not
          change them. Grouped and named so the three numbers are one thing to a screen
          reader — and so "Active" is unambiguous beside the row badges below. */}
      <div role="group" aria-label="Team overview" className="grid gap-4 sm:grid-cols-3">
        <StatTile
          icon={<Briefcase />}
          value={teamTotal.data?.total}
          label="Team members"
          loading={teamTotal.isPending}
        />
        <StatTile
          icon={<CheckCircle />}
          value={activeCount.data?.total}
          label="Active"
          tone="success"
          loading={activeCount.isPending}
        />
        {/* Neutral rather than amber: a disabled account is a state, not a fault. */}
        <StatTile
          icon={<Users />}
          value={disabledCount.data?.total}
          label="Disabled"
          tone="neutral"
          loading={disabledCount.isPending}
        />
      </div>

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filter staff by status"
      >
        {STATUS_FILTERS.map((filter) => (
          <Chip
            key={filter.value}
            selected={status === filter.value}
            onSelect={() => {
              setStatus(filter.value);
              // A page number only means something for the list it belongs to.
              setPage(1);
            }}
          >
            {filter.label}
          </Chip>
        ))}
      </div>

      <section
        aria-busy={staff.isPending || staff.isFetching}
        aria-label="Staff list"
        className="rounded-card border border-line bg-surface"
      >
        <div className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
          <p className="text-sm text-ink-muted">
            {staff.isPending
              ? "Loading staff…"
              : `${staff.data?.total ?? 0} ${staff.data?.total === 1 ? "person" : "people"}`}
            {search ? ` matching “${search}”` : ""}
            {status === "all" ? "" : ` — ${statusLabel.toLowerCase()}`}
          </p>
        </div>

        {staff.isPending ? (
          <TableSkeleton
            caption="Staff in this salon"
            // The loaded table's own columns, so the header words are the same in both
            // states and the body reserves the height those rows will take.
            columns={columns}
            widths={{
              person: "w-40",
              role: "w-16",
              position: "w-24",
              departments: "w-32",
              lastLogin: "w-24",
              status: "w-20",
              actions: "w-12",
            }}
            // A person's cell carries a 34px avatar, so a real row is taller than a bar.
            rowHeight="h-8"
          />
        ) : staff.isError ? (
          <EmptyState
            title="The staff list could not be loaded"
            description={getErrorMessage(staff.error)}
            icon={<Users />}
            // Retry the query, not the document: reloading threw away the whole
            // application — its session, its cached records and the reader's place — to
            // re-ask one question.
            action={
              <Button onClick={() => void staff.refetch()} loading={staff.isFetching}>
                Try again
              </Button>
            }
          />
        ) : (
          <>
            <Table
              caption="Staff in this salon"
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              className="rounded-none border-0"
              empty={
                search ? (
                  <EmptyState
                    title="No staff match that search"
                    description={`Nothing matches “${search}”. Try a different name or email address.`}
                    icon={<Search />}
                    action={
                      <Button variant="secondary" onClick={() => setSearchInput("")}>
                        Clear search
                      </Button>
                    }
                  />
                ) : status !== "all" ? (
                  <EmptyState
                    title={
                      status === "disabled" ? "No disabled accounts" : "Nobody is active right now"
                    }
                    description={
                      status === "disabled"
                        ? "Everyone in this salon can still sign in."
                        : "Every account in this salon is disabled."
                    }
                    icon={<Users />}
                    action={
                      <Button variant="secondary" onClick={() => setStatus("all")}>
                        Show all staff
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    title="No staff yet"
                    description="Add the first person so they can sign in, be booked and be paid."
                    icon={<Users />}
                    action={
                      canCreate ? (
                        <Button onClick={openCreate} disabled={isReadOnly}>
                          Add staff member
                        </Button>
                      ) : undefined
                    }
                  />
                )
              }
            />

            <div className="flex items-center justify-between gap-3 border-t border-line-soft px-5 py-3">
              <p className="text-xs text-ink-muted">
                Page {staff.data?.page ?? page} of {Math.max(staff.data?.pageCount ?? 1, 1)}
              </p>
              <Pagination
                page={staff.data?.page ?? page}
                pageCount={staff.data?.pageCount ?? 1}
                onPageChange={setPage}
                label="Staff list pages"
              />
            </div>
          </>
        )}
      </section>

      <StaffFormDrawer
        // Remounting on open is what clears the form. An effect copying props into state
        // would render twice on every open, and there is no record to carry across any
        // more: editing left this screen for `/staff/:id`.
        key={String(drawerOpen)}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}

/**
 * The handoff draws a toggle switch in this column. A switch is a write, and this table
 * is read-only for a stylist and for a suspended salon (`TENANCY.md` §6), so the state
 * is shown as a badge and changed where every other field is — in the drawer.
 */
function StatusCell({ disabled }: { disabled: boolean }) {
  return (
    <Badge variant={disabled ? "neutral" : "success"} dot>
      {disabled ? "Disabled" : "Active"}
    </Badge>
  );
}
