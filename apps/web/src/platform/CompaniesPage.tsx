/**
 * The company directory — `/platform`.
 *
 * The first thing an operator sees, so it answers four questions without a
 * click: which companies exist, what state each is in, when each plan lapses,
 * and what I can do to one. The company name is the row's own link into its
 * page; the search field and pagination are server-driven because the API owns
 * paging.
 *
 * The tiles count the whole directory — the API computes them beside the page
 * from one snapshot — so searching narrows the rows under them, never the
 * numbers. The first tile is therefore labelled "All companies" rather than
 * repeating the card title, which does count the search.
 *
 * The notice above the table is how a purge or a failed invitation reports back:
 * both of those happen on another route, so it arrives in router state rather
 * than as a message this page could not have produced itself.
 */
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { CompanyList } from "@glampro_suite/shared";

import { AlertTriangle, CheckCircle, Clock, Grid, Plus } from "@/components/icons";
import Badge, { type BadgeVariant } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import Pagination from "@/components/ui/Pagination";
import Skeleton from "@/components/ui/Skeleton";
import StatTile from "@/components/ui/StatTile";
import Table, { type TableColumn } from "@/components/ui/Table";
import { platformApi } from "./api";

type CompanyRow = CompanyList["items"][number];

/** Company state as a tone, so colour is never the only carrier of meaning. */
const STATUS_TONE: Record<string, BadgeVariant> = {
  ACTIVE: "success",
  SUSPENDED: "warning",
  CANCELLED: "danger",
};

export default function CompaniesPage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [list, setList] = useState<CompanyList | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Whatever the page the operator came back from wanted to say.
  const [notice] = useState(() => (state as { notice?: string } | null)?.notice ?? "");

  useEffect(() => {
    let active = true;
    platformApi
      .companies(search, page)
      .then((value) => {
        if (active) {
          setList(value);
          setError("");
        }
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load companies.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [search, page, revision]);

  function open(company: CompanyRow) {
    navigate(`/platform/companies/${company.id}`);
  }

  const columns: TableColumn<CompanyRow>[] = [
    {
      key: "company",
      header: "Company",
      cell: (row) => (
        <button
          type="button"
          aria-label={row.name}
          onClick={() => open(row)}
          className="flex items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple"
        >
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-purple-soft text-xs font-bold text-purple"
          >
            {row.name.slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink">{row.name}</span>
            <span className="block truncate text-xs text-ink-muted">{row.slug}</span>
          </span>
        </button>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <Badge variant={STATUS_TONE[row.status] ?? "neutral"} dot>
          {row.status}
        </Badge>
      ),
    },
    {
      key: "subscription",
      header: "Subscription ends",
      cell: (row) => (
        // A date, or a muted sentence when no plan is recorded — an em dash in a
        // table reads as missing data, while "no plan" is itself the answer an
        // operator needs before they can sell one.
        <span className={row.subscriptionEndsAt ? undefined : "text-ink-muted"}>
          {row.subscriptionEndsAt
            ? new Date(row.subscriptionEndsAt).toLocaleDateString()
            : "No plan recorded"}
        </span>
      ),
    },
    {
      key: "created",
      header: "Created",
      cell: (row) => new Date(row.createdAt).toLocaleDateString(),
    },
    {
      key: "actions",
      header: "Action",
      align: "right",
      cell: (row) => (
        <Button
          variant="secondary"
          aria-label={`View details for ${row.name}`}
          onClick={() => open(row)}
        >
          View details
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
            Operator workspace
          </p>
          <h1 className="text-2xl">Company management</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Manage companies, owner invitations and access in one place.
          </p>
        </div>
        <Button onClick={() => navigate("/platform/companies/new")}>
          <Plus aria-hidden />
          Create company
        </Button>
      </header>

      {error ? (
        <p role="alert" className="rounded-md bg-danger/5 px-3 py-2.5 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded-md bg-success-soft px-3 py-2.5 text-sm text-success-text"
        >
          {notice}
        </p>
      ) : null}

      {/* Directory totals from the API: whole-business counts that the search
          does not narrow, grouped and named so they read as one thing. */}
      <div
        role="group"
        aria-label="Company directory overview"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatTile icon={<Grid />} value={list?.stats.total} label="All companies" />
        <StatTile icon={<CheckCircle />} value={list?.stats.active} label="Active" tone="success" />
        {/* Amber because suspension is an operator action that needs an answer,
            unlike a disabled staff account, which is just a state. */}
        <StatTile
          icon={<AlertTriangle />}
          value={list?.stats.suspended}
          label="Suspended"
          tone="warning"
        />
        <StatTile
          icon={<Clock />}
          value={list?.stats.expiringSoon}
          label="Ending in 30 days"
          tone="neutral"
        />
      </div>

      <Card
        title={list ? `${list.total} companies` : "Companies"}
        description="Search by name or slug."
        actions={
          <Button
            variant="secondary"
            loading={loading}
            onClick={() => {
              setLoading(true);
              setRevision((value) => value + 1);
            }}
          >
            Refresh companies
          </Button>
        }
        flush
      >
        <div className="border-b border-line-soft px-5 py-3">
          <Input
            label="Search companies"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
              setLoading(true);
            }}
            maxLength={160}
            placeholder="Search by company name or slug…"
            className="max-w-sm"
          />
        </div>

        {loading && !list ? (
          <div aria-busy="true" aria-label="Loading companies" className="flex flex-col gap-3 p-5">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        ) : null}

        {/* A refresh keeps the rows on screen — replacing a table with a skeleton
            on every keystroke loses the operator's place in the list. */}
        {loading && list ? (
          <p role="status" className="px-5 py-2 text-sm text-ink-muted">
            Loading companies…
          </p>
        ) : null}

        {list ? (
          <>
            <Table
              caption="Companies"
              rows={list.items}
              rowKey={(row) => row.id}
              columns={columns}
              empty={
                <EmptyState
                  title="No companies found."
                  description={
                    search
                      ? "Try a different company name or slug."
                      : "Create your first company to invite its owner."
                  }
                  action={
                    search ? null : (
                      <Button onClick={() => navigate("/platform/companies/new")}>
                        Create company
                      </Button>
                    )
                  }
                />
              }
            />
            {list.items.length ? (
              <div className="px-5 py-3">
                <Pagination
                  label="Company directory pages"
                  page={page}
                  pageCount={Math.max(1, Math.ceil(list.total / list.pageSize))}
                  onPageChange={(next) => {
                    setPage(next);
                    setLoading(true);
                  }}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </Card>
    </div>
  );
}
