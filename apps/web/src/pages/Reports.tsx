/**
 * Reports — handoff screen 10, MVP slice M3.
 *
 * The full catalogue, charts, exports and scheduled reports remain Phase 7 work.
 * Focused tabs separate period sales, payments, current customer snapshots and
 * the independently dated daily close without inventing or combining balances.
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
import Button from "@/components/ui/Button";
import Tabs from "@/components/ui/Tabs";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import Skeleton from "@/components/ui/Skeleton";
import StatTile from "@/components/ui/StatTile";
import Table, { type TableColumn } from "@/components/ui/Table";
import { PAYMENT_METHOD_LABELS } from "@/constants/sale";
import { useReportOverview, useZReport } from "@/hooks/useReports";
import { getErrorMessage } from "@/lib/api";
import { formatDateInputValue } from "@/lib/utils";
import { instantFromSalonDate, toSalonDate } from "@/lib/salon-time";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import PackageValuationPanel from "@/components/reports/PackageValuationPanel";

type DatePreset = "today" | "week" | "month" | "custom";

function presetDates(timeZone: string, preset: DatePreset = "month") {
  const today = toSalonDate(new Date(), timeZone)!;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (preset === "week") start.setDate(start.getDate() - 6);
  if (preset === "month") start.setDate(1);
  return {
    from: formatDateInputValue(start),
    to: formatDateInputValue(today),
  };
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = dateParts(value);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
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
  const { formatDate, formatPrice, formatDateTime, timeZone } = useSalonFormatting();
  const [activeTab, setActiveTab] = useState("overview");
  const [preset, setPreset] = useState<DatePreset>("month");
  const [dates, setDates] = useState(() => presetDates(timeZone));
  const validRange = isValidDate(dates.from) && isValidDate(dates.to) && dates.from <= dates.to;
  const range = useMemo(
    () =>
      validRange ? rangeInstants(dates.from, dates.to, timeZone) : { from: "", to: "", timeZone },
    [dates.from, dates.to, timeZone, validRange],
  );
  const report = useReportOverview(range, validRange);
  const data = validRange && !report.isError ? report.data : undefined;
  const [closeDate, setCloseDate] = useState(() => presetDates(timeZone, "today").to);
  const validCloseDate = isValidDate(closeDate);
  const close = useZReport({ date: closeDate, timeZone }, validCloseDate && activeTab === "close");
  const closeData = !close.isError ? close.data : undefined;

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

  const dailyClose = (
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
      {!validCloseDate ? (
        <p role="alert" className="text-sm text-danger-text">
          Choose a valid close date.
        </p>
      ) : close.isPending ? (
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
            <Figure label="Outstanding created" value={formatPrice(closeData.outstandingCreated)} />
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
  );
  const overview = (
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
    </div>
  );
  const payments = (
    <div className="grid gap-4 xl:grid-cols-2">
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
    </div>
  );
  const customerBalances = (
    <div className="grid gap-4 xl:grid-cols-2">
      <section aria-label="Current customer balances" className="xl:col-span-2">
        <h3 className="text-lg font-bold">Current customer balances</h3>
        <p className="mt-1 text-sm text-ink-muted">
          Company-wide current snapshot, shared across outlets and independent of the selected sales
          range. These are not historical closing balances for that period.
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          Snapshot as of {formatDateTime(data?.liability.asOf)} ({timeZone}).
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card
            title="Prepaid credit and gift-card liabilities"
            description="Unexpired balances customers can still spend; excludes customer debt."
          >
            <dl className="grid grid-cols-2 gap-3">
              <Figure
                label="Prepaid credit"
                value={formatPrice(data?.liability.prepaidCredit.balance ?? "0.00")}
              />
              <Figure
                label="Gift cards"
                value={formatPrice(data?.liability.giftCards.balance ?? "0.00")}
              />
            </dl>
            <p className="mt-3 text-sm text-ink-muted">
              Total monetary liability:{" "}
              <span className="font-heavy text-ink">
                {formatPrice(data?.liability.totalMoney ?? "0.00")}
              </span>
            </p>
          </Card>
          <Card
            title="Customer receivables"
            description="Money customers owe the salon; not prepaid credit and not included in liabilities."
          >
            <dl className="grid grid-cols-2 gap-3">
              <Figure
                label="Amount owed to salon"
                value={formatPrice(data?.liability.outstanding.balance ?? "0.00")}
              />
              <Figure
                label="Customers with debt"
                value={data?.liability.outstanding.customers ?? 0}
              />
            </dl>
          </Card>
          <Card
            title="Remaining package sessions"
            description="Unexpired operational entitlements. Purchase valuation is reported separately below."
            className="lg:col-span-2"
          >
            <dl>
              <Figure
                label="Sessions remaining"
                value={`${data?.liability.packageSessions.sessionsRemaining ?? 0} across ${data?.liability.packageSessions.holdings ?? 0} holdings`}
              />
            </dl>
            <p className="mt-3 text-sm text-ink-muted">
              Session packages are excluded from the monetary total. These operational balances are
              not a complete accounting or deferred-revenue valuation.
            </p>
          </Card>
        </div>
      </section>
    </div>
  );
  const reportContent = (content: React.ReactNode) =>
    !validRange ? (
      <p
        role="alert"
        className="rounded-card border border-line bg-surface p-4 text-sm text-danger-text"
      >
        Choose valid From and To dates. From must be on or before To.
      </p>
    ) : report.isPending ? (
      <div role="status" aria-label="Loading report" className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    ) : report.isError ? (
      <EmptyState
        title="The report could not be loaded"
        description={getErrorMessage(report.error)}
        icon={<BarChart />}
      />
    ) : (
      content
    );

  const balanceContent = (
    <div className="space-y-4">
      {!validRange ? (
        <p role="status" className="text-sm text-ink-muted">
          Choose a valid sales range on Overview to load customer balances. The balances remain a
          current snapshot, not a period total.
        </p>
      ) : report.isPending ? (
        <Skeleton className="h-56" />
      ) : report.isError ? (
        <EmptyState
          title="Customer balances could not be loaded"
          description={getErrorMessage(report.error)}
          icon={<Users />}
        />
      ) : (
        customerBalances
      )}
      <PackageValuationPanel />
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-xl">Reports</h2>
        <p className="mt-1 text-sm text-ink-muted">
          A clear view of sales, payments and customer balances.
        </p>
      </header>

      {activeTab === "overview" || activeTab === "payments" ? (
        <section
          aria-label="Sales period"
          className="space-y-3 rounded-card border border-line bg-surface p-4"
        >
          <div className="flex flex-wrap gap-2" role="group" aria-label="Date presets">
            {(
              [
                ["today", "Today"],
                ["week", "Last 7 days"],
                ["month", "This month"],
                ["custom", "Custom"],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                variant={preset === id ? "secondary" : "ghost"}
                aria-pressed={preset === id}
                onClick={() => {
                  setPreset(id);
                  if (id !== "custom") setDates(presetDates(timeZone, id));
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Input
              label="From"
              type="date"
              value={dates.from}
              max={dates.to}
              fullWidth={false}
              onChange={(event) => {
                setPreset("custom");
                setDates((current) => ({ ...current, from: event.target.value }));
              }}
            />
            <Input
              label="To"
              type="date"
              value={dates.to}
              min={dates.from}
              fullWidth={false}
              onChange={(event) => {
                setPreset("custom");
                setDates((current) => ({ ...current, to: event.target.value }));
              }}
            />
            <p className="pb-3 text-xs text-ink-muted">Sales period · {timeZone}</p>
          </div>
        </section>
      ) : null}

      {activeTab === "overview" && validRange ? (
        <section aria-label="Report totals" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
              display={data ? formatPrice(data.totals.paid) : undefined}
              label="Amount paid"
              tone="neutral"
            />
            <StatTile
              icon={<Calendar />}
              value={data?.totals.sales}
              label="Completed sales"
              tone="neutral"
            />
            <StatTile
              icon={<BarChart />}
              value={undefined}
              display={data ? formatPrice(data.totals.refunds) : undefined}
              label="Refunds"
              tone="neutral"
            />
          </div>
          <dl className="grid grid-cols-2 gap-3 rounded-card border border-line bg-surface p-4 md:grid-cols-4">
            <Figure label="Gross sales" value={data ? formatPrice(data.totals.grossSales) : "—"} />
            <Figure label="Discounts" value={data ? formatPrice(data.totals.discounts) : "—"} />
            <Figure label="GST included" value={data ? formatPrice(data.totals.tax) : "—"} />
            <Figure label="Items sold" value={data?.totals.items ?? "—"} />
          </dl>
        </section>
      ) : null}
      {data?.totals.commissionReconciliation ? (
        <p role="status" className="text-sm text-ink-body">
          {data.totals.commissionReconciliation} paid commission adjustment(s) require
          reconciliation. No recovery has been recorded.
        </p>
      ) : null}
      <Tabs
        label="Report sections"
        activeId={activeTab}
        onChange={setActiveTab}
        items={[
          { id: "overview", label: "Overview", content: reportContent(overview) },
          { id: "payments", label: "Staff & payments", content: reportContent(payments) },
          { id: "balances", label: "Customer balances", content: balanceContent },
          { id: "close", label: "Daily close", content: dailyClose },
        ]}
      />
    </div>
  );
}
