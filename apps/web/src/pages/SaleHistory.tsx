import { useSearchParams, Link } from "react-router";
import type { FormEvent } from "react";
import { saleListQuerySchema } from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Table from "@/components/ui/Table";
import Badge from "@/components/ui/Badge";
import SaleListPagination from "@/components/sale/SaleListPagination";
import { useSaleHistory } from "@/hooks/useSale";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

export default function SaleHistory() {
  const [params, setParams] = useSearchParams();
  const { formatPrice, formatDateTime } = useSalonFormatting();
  const status =
    params.get("status") === "COMPLETED"
      ? "COMPLETED"
      : params.get("status") === "VOID"
        ? "VOID"
        : "HISTORY";
  const rawPage = Number(params.get("page") ?? 1);
  const page = Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 1000000 ? rawPage : 1;
  const search = params.get("search") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const invalidRange = !!from && !!to && from > to;
  const validFilters = saleListQuerySchema.safeParse({
    status,
    page,
    search,
    from: from || undefined,
    to: to || undefined,
  }).success;
  const history = useSaleHistory(status, page, validFilters, {
    search: search || undefined,
    from: from || undefined,
    to: to || undefined,
  });
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const name of ["search", "status", "from", "to"]) {
      const value = String(values.get(name) ?? "").trim();
      if (value && !(name === "status" && value === "HISTORY")) next.set(name, value);
    }
    setParams(next);
  }
  const receiptLink = (id: string) =>
    `/sale/history/${encodeURIComponent(id)}${params.size ? `?${params}` : ""}`;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heavy text-ink">Sale history</h1>
          <p className="text-sm text-ink-muted">
            Browse stored receipts without changing your current cart.
          </p>
        </div>
        <Link
          to="/sale"
          className="inline-flex min-h-control items-center rounded-md border border-line px-4 font-bold text-ink focus-visible:outline-2 focus-visible:outline-purple"
        >
          Back to sale
        </Link>
      </header>
      <form
        key={params.toString()}
        onSubmit={filter}
        className="grid items-end gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_auto]"
      >
        <Input
          name="search"
          label="Search receipts"
          placeholder="Receipt number or customer name"
          defaultValue={search}
          maxLength={100}
        />
        <Select
          name="status"
          label="Sale status"
          defaultValue={status}
          placeholder=""
          options={[
            { value: "HISTORY", label: "All receipts" },
            { value: "COMPLETED", label: "Completed" },
            { value: "VOID", label: "Voided" },
          ]}
        />
        <Input name="from" label="From date" type="date" defaultValue={from} />
        <Input name="to" label="To date" type="date" defaultValue={to} />
        <div className="flex gap-2">
          <Button type="submit">Apply filters</Button>
          <Button variant="ghost" onClick={() => setParams({})}>
            Clear
          </Button>
        </div>
      </form>
      {!validFilters ? (
        <p role="alert" className="text-danger">
          {invalidRange
            ? "End date must be on or after start date."
            : "Check the search and date filters, then apply them again."}
        </p>
      ) : history.isPending ? (
        <p role="status">Reading sale history…</p>
      ) : history.isError ? (
        <div role="alert" className="rounded-card border border-line bg-surface p-4">
          <p>Sale history could not be read.</p>
          <Button variant="secondary" onClick={() => void history.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <div className="hidden md:block">
            <Table
              caption="Sale history results"
              rows={history.data?.items ?? []}
              rowKey={(sale) => sale.id}
              empty={<p className="p-5 text-ink-muted">No sales match these filters.</p>}
              columns={[
                {
                  key: "receipt",
                  header: "Receipt",
                  cell: (sale) => (
                    <Link className="font-bold text-purple underline" to={receiptLink(sale.id)}>
                      {sale.receiptNumber === null ? "Number pending" : `#${sale.receiptNumber}`}
                    </Link>
                  ),
                },
                { key: "date", header: "Date & time", cell: (sale) => formatDateTime(sale.soldAt) },
                {
                  key: "customer",
                  header: "Customer",
                  cell: (sale) => sale.customerName ?? "Walk-in",
                },
                { key: "staff", header: "Staff", cell: (sale) => sale.staffName ?? "—" },
                {
                  key: "status",
                  header: "Status",
                  cell: (sale) => (
                    <Badge variant={sale.status === "VOID" ? "danger" : "success"}>
                      {sale.status === "VOID" ? "Voided" : "Completed"}
                    </Badge>
                  ),
                },
                {
                  key: "total",
                  header: "Total",
                  align: "right",
                  cell: (sale) => (
                    <span className="tabular-nums">{formatPrice(sale.totalAmount)}</span>
                  ),
                },
                {
                  key: "open",
                  header: "Action",
                  cell: (sale) => (
                    <Link
                      className="inline-flex min-h-control items-center font-bold text-purple underline"
                      to={receiptLink(sale.id)}
                    >
                      Open receipt
                    </Link>
                  ),
                },
              ]}
            />
          </div>
          <ul aria-label="Sale history results" className="flex flex-col gap-3 md:hidden">
            {!history.data?.items.length ? (
              <li>No sales match these filters.</li>
            ) : (
              history.data.items.map((sale) => (
                <li key={sale.id} className="rounded-card border border-line bg-surface p-4">
                  <Link
                    className="block min-h-control font-bold text-purple underline"
                    to={receiptLink(sale.id)}
                  >
                    {sale.receiptNumber === null
                      ? "Receipt number pending"
                      : `Receipt #${sale.receiptNumber}`}
                  </Link>
                  <p>
                    {sale.customerName ?? "Walk-in"} · {formatPrice(sale.totalAmount)}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {formatDateTime(sale.soldAt)} · {sale.staffName ?? "—"} ·{" "}
                    {sale.status === "VOID" ? "Voided" : "Completed"}
                  </p>
                </li>
              ))
            )}
          </ul>
          <SaleListPagination
            page={page}
            hasMore={history.data?.hasMore ?? false}
            disabled={history.isFetching}
            onPageChange={(next) => {
              const updated = new URLSearchParams(params);
              updated.set("page", String(next));
              setParams(updated);
            }}
          />
        </>
      )}
    </div>
  );
}
