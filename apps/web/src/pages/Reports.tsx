/**
 * Reports — handoff screen 10, MVP slice M3.
 *
 * The full catalogue, charts, exports and scheduled reports remain Phase 7 work.
 * This screen closes the whole-system loop with one explicit date range, real
 * totals, and three tables the current schema can answer without invented data.
 */
import { useMemo, useState } from "react";
import type {
  ReportItem,
  ReportSalesByDay,
  ReportServiceSales,
  ReportStaff,
  ReportTender,
} from "@glampro_suite/shared";

import { BarChart, Calendar, Package, Users } from "@/components/icons";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import Skeleton from "@/components/ui/Skeleton";
import StatTile from "@/components/ui/StatTile";
import Table, { type TableColumn } from "@/components/ui/Table";
import { PAYMENT_METHOD_LABELS } from "@/constants/sale";
import { useReportOverview, useZReport } from "@/hooks/useReports";
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

/** One labelled figure in the close or the liability panel. */
function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-surface-muted px-3 py-2">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-base font-heavy text-ink">{value}</dd>
    </div>
  );
}

export default function Reports() {
  const { formatDate, formatPrice, timeZone } = useSalonFormatting();
  const [dates, setDates] = useState(initialDates);
  const range = useMemo(
    () => rangeInstants(dates.from, dates.to, timeZone),
    [dates.from, dates.to, timeZone],
  );
  const report = useReportOverview(range);
  const data = report.data;
  const [closeDate, setCloseDate] = useState(() => initialDates().to);
  const close = useZReport({ date: closeDate, timeZone });
  const closeData = close.data;

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
    {
      key: "commission",
      header: "Commission",
      align: "right",
      cell: (row) => formatPrice(row.commission),
    },
  ];

  const serviceColumns: TableColumn<ReportServiceSales>[] = [
    { key: "service", header: "Service", cell: (row) => row.name },
    { key: "quantity", header: "Qty", align: "right", cell: (row) => row.quantity },
    { key: "revenue", header: "Revenue", align: "right", cell: (row) => formatPrice(row.revenue) },
  ];

  const tenderColumns: TableColumn<ReportTender>[] = [
    {
      key: "method",
      header: "Tender",
      cell: (row) => (
        <div>
          <p className="font-bold text-ink">{PAYMENT_METHOD_LABELS[row.method]}</p>
          {row.redemption ? <p className="text-xs text-success-text">Credit redeemed</p> : null}
        </div>
      ),
    },
    { key: "amount", header: "Amount", align: "right", cell: (row) => formatPrice(row.amount) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl">Reports</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Sales, the daily close, tenders and what customers can still spend.
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

      <section aria-label="Report totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatTile
          icon={<BarChart />}
          value={undefined}
          display={data ? formatPrice(data.totals.grossSales) : undefined}
          label="Gross sales"
          tone="neutral"
        />
        <StatTile
          icon={<BarChart />}
          value={undefined}
          display={data ? formatPrice(data.totals.refunds) : undefined}
          label="Refunds"
          tone="warning"
        />
        <StatTile
          icon={<BarChart />}
          value={undefined}
          display={data ? formatPrice(data.totals.revenue) : undefined}
          label="Net revenue"
          tone="purple"
        />
        <StatTile
          icon={<BarChart />}
          value={undefined}
          display={data ? formatPrice(data.totals.discounts) : undefined}
          label="Discounts"
          tone="neutral"
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
      {data?.totals.commissionReconciliation ? (
        <p role="status" className="text-sm text-ink-body">
          {data.totals.commissionReconciliation} paid commission adjustment(s) require
          reconciliation. No recovery has been recorded.
        </p>
      ) : null}

      <Card
        title="Daily close"
        description="One salon-local day, counted by when the sale was completed."
        actions={
          <Input
            label="Close date"
            type="date"
            value={closeDate}
            fullWidth={false}
            onChange={(event) => setCloseDate(event.target.value)}
          />
        }
      >
        {close.isPending ? (
          <Skeleton className="h-36" />
        ) : close.isError ? (
          <p role="alert" className="text-sm text-danger-text">
            The daily close could not be loaded: {getErrorMessage(close.error)}
          </p>
        ) : closeData ? (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              <Figure label="Gross sales" value={formatPrice(closeData.totals.grossSales)} />
              <Figure label="Refunds" value={formatPrice(closeData.totals.refunds)} />
              <Figure label="Discounts" value={formatPrice(closeData.totals.discounts)} />
              <Figure label="Net sales" value={formatPrice(closeData.totals.netSales)} />
              <Figure label="GST included" value={formatPrice(closeData.totals.tax)} />
              <Figure label="Paid" value={formatPrice(closeData.totals.paid)} />
              <Figure label="Collected" value={formatPrice(closeData.totals.collected)} />
              <Figure label="Credit redeemed" value={formatPrice(closeData.totals.redeemed)} />
              <Figure label="Sales" value={closeData.totals.sales} />
              <Figure label="Items" value={closeData.totals.items} />
              <Figure
                label="Voids"
                value={`${closeData.voids.count} · ${formatPrice(closeData.voids.amount)}`}
              />
              <Figure
                label="Outstanding created"
                value={formatPrice(closeData.outstandingCreated)}
              />
            </dl>
            <div>
              <h3 className="mb-2 text-sm font-heavy text-ink">Tenders</h3>
              <Table
                caption="Daily tender totals"
                columns={tenderColumns}
                rows={closeData.tenders}
                rowKey={(row) => row.method}
                empty={
                  <EmptyState
                    title="No payments"
                    description="Payments taken on this day will appear here."
                    icon={<Calendar />}
                  />
                }
              />
              {(closeData.refundTenders ?? []).length > 0 ? (
                <Table
                  caption="Daily refund payouts"
                  columns={tenderColumns}
                  rows={closeData.refundTenders}
                  rowKey={(row) => row.method}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>

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
          <Card title="Services sold" description="Service lines ranked by revenue." flush>
            <Table
              caption="Sales by service"
              columns={serviceColumns}
              rows={data?.serviceSales ?? []}
              rowKey={(row) => row.serviceId}
              className="rounded-none border-0"
              empty={
                <EmptyState
                  title="No services sold"
                  description="Service lines in this range will appear here."
                  icon={<Package />}
                />
              }
            />
          </Card>
          <Card title="Tenders" description="Every tender used by a completed sale." flush>
            <Table
              caption="Tender totals"
              columns={tenderColumns}
              rows={data?.tenders ?? []}
              rowKey={(row) => row.method}
              className="rounded-none border-0"
              empty={
                <EmptyState
                  title="No payments"
                  description="Payments in this range will appear here."
                  icon={<Calendar />}
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
          <Card
            title="Refund payouts"
            description="Actual money returned in this range; historical refunds may have no tender evidence."
            flush
          >
            <Table
              caption="Refund payout totals"
              columns={tenderColumns}
              rows={data?.refundTenders ?? []}
              rowKey={(row) => row.method}
              className="rounded-none border-0"
            />
          </Card>
          <Card
            title="Customer liability"
            description="What customers can still spend, excluding expired credit."
            className="xl:col-span-2"
          >
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Figure
                label="Package sessions"
                value={`${data?.liability.packageSessions.sessionsRemaining ?? 0} across ${
                  data?.liability.packageSessions.holdings ?? 0
                } holdings`}
              />
              <Figure
                label="Prepaid credit"
                value={formatPrice(data?.liability.prepaidCredit.balance ?? "0.00")}
              />
              <Figure
                label="Gift cards"
                value={formatPrice(data?.liability.giftCards.balance ?? "0.00")}
              />
              <Figure
                label="Outstanding"
                value={formatPrice(data?.liability.outstanding.balance ?? "0.00")}
              />
            </dl>
            <p className="mt-3 text-sm text-ink-muted">
              Monetary liability:{" "}
              <span className="font-heavy text-ink">
                {formatPrice(data?.liability.totalMoney ?? "0.00")}
              </span>{" "}
              · Package sessions are counted, not valued, because the catalogue has member and
              non-member prices.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
