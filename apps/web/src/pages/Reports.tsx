/**
 * Reports — handoff screen 10, MVP slice M3.
 *
 * The full catalogue, charts, exports and scheduled reports remain Phase 7 work.
 * This screen closes the whole-system loop with one explicit date range, real
 * totals, and three tables the current schema can answer without invented data.
 */
import { useMemo, useState } from "react";
import type { ReportItem, ReportSalesByDay, ReportStaff } from "@glampro_suite/shared";

import { BarChart, Calendar, Package, Users } from "@/components/icons";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import Skeleton from "@/components/ui/Skeleton";
import StatTile from "@/components/ui/StatTile";
import Table, { type TableColumn } from "@/components/ui/Table";
import { useReportOverview } from "@/hooks/useReports";
import { getErrorMessage } from "@/lib/api";
import { formatDateInputValue } from "@/lib/utils";
import { instantFromSalonDate } from "@/lib/salon-time";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

function initialDates(): { from: string; to: string } {
  const today = new Date();
  return {
    from: formatDateInputValue(
      new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29),
    ),
    to: formatDateInputValue(today),
  };
}

function dateParts(value: string): [number, number, number] {
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  return [year, month, day];
}

function rangeInstants(
  from: string,
  to: string,
  timeZone: string,
): { from: string; to: string; timeZone: string } {
  const [fromYear, fromMonth, fromDay] = dateParts(from);
  const [toYear, toMonth, toDay] = dateParts(to);
  // The user picks calendar dates in the salon's timezone; turn both edges into
  // the instants that bound that salon-local day, so a Singapore salon's "today"
  // is not America's yesterday.
  const fromInstant = instantFromSalonDate(
    new Date(fromYear, fromMonth - 1, fromDay, 0, 0, 0, 0),
    timeZone,
  );
  const toInstant = instantFromSalonDate(
    new Date(toYear, toMonth - 1, toDay, 23, 59, 59, 999),
    timeZone,
  );
  return { from: fromInstant.toISOString(), to: toInstant.toISOString(), timeZone };
}

const ITEM_LABELS: Record<ReportItem["itemType"], string> = {
  SERVICE: "Service",
  PRODUCT: "Product",
  PACKAGE: "Package",
  VALUE_PACKAGE: "Value package",
  GIFT_CARD: "Gift card",
};

export default function Reports() {
  const { formatDate, formatPrice, timeZone } = useSalonFormatting();
  const [dates, setDates] = useState(initialDates);
  const range = useMemo(
    () => rangeInstants(dates.from, dates.to, timeZone),
    [dates.from, dates.to, timeZone],
  );
  const report = useReportOverview(range);
  const data = report.data;

  const salesColumns: TableColumn<ReportSalesByDay>[] = [
    { key: "date", header: "Date", cell: (row) => formatDate(row.date) },
    { key: "sales", header: "Sales", align: "right", cell: (row) => row.sales },
    { key: "items", header: "Items", align: "right", cell: (row) => row.quantity },
    { key: "revenue", header: "Revenue", align: "right", cell: (row) => formatPrice(row.revenue) },
    { key: "tax", header: "GST", align: "right", cell: (row) => formatPrice(row.tax) },
    { key: "paid", header: "Paid", align: "right", cell: (row) => formatPrice(row.paid) },
  ];

  const itemColumns: TableColumn<ReportItem>[] = [
    {
      key: "item",
      header: "Item",
      cell: (row) => (
        <div>
          <p className="font-bold text-ink">{row.itemName}</p>
          <p className="text-xs text-ink-muted">{ITEM_LABELS[row.itemType]}</p>
        </div>
      ),
    },
    { key: "quantity", header: "Qty", align: "right", cell: (row) => row.quantity },
    { key: "revenue", header: "Revenue", align: "right", cell: (row) => formatPrice(row.revenue) },
  ];

  const staffColumns: TableColumn<ReportStaff>[] = [
    {
      key: "staff",
      header: "Staff",
      cell: (row) => (
        <div>
          <p className="font-bold text-ink">{row.name}</p>
          <p className="text-xs text-ink-muted">{row.position ?? "No position set"}</p>
        </div>
      ),
    },
    { key: "lines", header: "Credited lines", align: "right", cell: (row) => row.creditedLines },
    { key: "revenue", header: "Revenue", align: "right", cell: (row) => formatPrice(row.revenue) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl">Reports</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Sales, top items and staff performance over one reproducible date range.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4">
          <Input
            label="From"
            type="date"
            value={dates.from}
            max={dates.to}
            fullWidth={false}
            onChange={(event) => setDates((current) => ({ ...current, from: event.target.value }))}
          />
          <Input
            label="To"
            type="date"
            value={dates.to}
            min={dates.from}
            fullWidth={false}
            onChange={(event) => setDates((current) => ({ ...current, to: event.target.value }))}
          />
        </div>
      </header>

      <section aria-label="Report totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          icon={<BarChart />}
          value={undefined}
          display={data ? formatPrice(data.totals.revenue) : undefined}
          label="Revenue"
          tone="purple"
        />
        <StatTile
          icon={<BarChart />}
          value={undefined}
          display={data ? formatPrice(data.totals.tax) : undefined}
          label="GST included"
          tone="neutral"
        />
        <StatTile
          icon={<Calendar />}
          value={data?.totals.sales}
          label="Completed sales"
          tone="success"
        />
        <StatTile icon={<Package />} value={data?.totals.items} label="Items sold" tone="warning" />
        <StatTile
          icon={<Users />}
          value={undefined}
          display={data ? formatPrice(data.totals.paid) : undefined}
          label="Amount paid"
          tone="neutral"
        />
      </section>

      {report.isPending ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-56" />
          ))}
        </div>
      ) : report.isError ? (
        <EmptyState
          title="The report could not be loaded"
          description={getErrorMessage(report.error)}
          icon={<BarChart />}
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Sales by day" description="Completed receipts in the selected range." flush>
            <Table
              caption="Sales by day"
              columns={salesColumns}
              rows={data?.salesByDay ?? []}
              rowKey={(row) => row.date}
              className="rounded-none border-0"
              empty={
                <EmptyState
                  title="No completed sales"
                  description="Ring up a sale in this range to fill the table."
                  icon={<Calendar />}
                />
              }
            />
          </Card>
          <Card title="Top items" description="Ranked by revenue, then quantity." flush>
            <Table
              caption="Top-selling items"
              columns={itemColumns}
              rows={data?.topItems ?? []}
              rowKey={(row) => `${row.itemType}:${row.itemId}`}
              className="rounded-none border-0"
              empty={
                <EmptyState
                  title="No items sold"
                  description="Sale lines in this range will appear here."
                  icon={<Package />}
                />
              }
            />
          </Card>
          <Card
            title="Staff performance"
            description="Only sale lines explicitly credited to a staff member."
            flush
            className="xl:col-span-2"
          >
            <Table
              caption="Staff performance"
              columns={staffColumns}
              rows={data?.staffPerformance ?? []}
              rowKey={(row) => row.userId}
              className="rounded-none border-0"
              empty={
                <EmptyState
                  title="No attributed sales"
                  description="Assign staff to service lines at the till to fill this table."
                  icon={<Users />}
                />
              }
            />
          </Card>
        </div>
      )}
    </div>
  );
}
