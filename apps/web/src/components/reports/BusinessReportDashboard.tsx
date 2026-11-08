import { useState } from "react";
import type { ReportAnalytics, ReportOverview } from "@glampro_suite/shared";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Table from "@/components/ui/Table";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

const colors = ["#8061c5", "#34a998", "#ecaa48", "#df779a", "#7294cd"];
const sections = ["Appointments", "Sales", "Products", "Services", "Packages"] as const;
type Section = (typeof sections)[number];
type Metric = "revenue" | "services" | "products" | "packages";
const statusLabels = {
  scheduled: "Scheduled",
  inProgress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  noShow: "No-show",
};

function Summary({
  label,
  value,
  description,
}: {
  label: string;
  value: string | number;
  description: string;
}) {
  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-2 text-2xl font-heavy text-ink">{value}</p>
      <p className="mt-2 text-xs text-ink-muted">{description}</p>
    </div>
  );
}

/** All business charts share the same server-counted range; never sum topItems. */
export default function BusinessReportDashboard({ data }: { data: ReportOverview }) {
  const { formatPrice } = useSalonFormatting();
  const [metric, setMetric] = useState<Metric>("revenue");
  const [section, setSection] = useState<Section>("Sales");
  const [ranking, setRanking] = useState<"revenue" | "quantity">("revenue");
  const analytics = data.analytics;
  if (!analytics)
    return (
      <EmptyState
        title="Business analytics are unavailable"
        description="Reload after the reporting API has been updated. Missing analytics are not zero sales."
      />
    );

  const category = (key: string) => analytics.categories.find((row) => row.key === key);
  const amount = (key: string) => formatPrice(category(key)?.revenue ?? "0.00");
  const quantity = (key: string) => category(key)?.quantity ?? 0;
  const timeline = analytics.timeline.map((row) => ({
    ...row,
    revenue: Number(row.revenue),
    services: Number(row.services),
    products: Number(row.products),
    packages: Number(row.packages),
    other: Number(row.other),
  }));
  const mix = analytics.categories
    .filter((row) => Number(row.revenue) > 0)
    .map((row) => ({ name: row.label, value: Number(row.revenue) }));
  const selectedItems = analytics.items.filter((row) =>
    section === "Products"
      ? row.itemType === "PRODUCT"
      : section === "Services"
        ? row.itemType === "SERVICE"
        : section === "Packages"
          ? ["PACKAGE", "VALUE_PACKAGE"].includes(row.itemType)
          : true,
  );
  const bestSellers = [...selectedItems]
    .sort((a, b) =>
      ranking === "quantity" ? b.quantity - a.quantity : Number(b.revenue) - Number(a.revenue),
    )
    .slice(0, 7)
    .map((row) => ({
      name: row.itemName,
      value: ranking === "quantity" ? row.quantity : Number(row.revenue),
    }));
  const moneyTooltip = (value: unknown) => formatPrice(String(value));
  const counts = analytics.appointments;

  return (
    <div className="space-y-5">
      <section aria-label="Business summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Summary
          label="Appointments"
          value={counts.total}
          description={`${counts.completed} completed · ${counts.cancelled} cancelled · ${counts.noShow} no-show`}
        />
        <Summary
          label="Sales"
          value={formatPrice(analytics.salesAmount)}
          description={`${data.totals.sales} completed receipts · before refunds`}
        />
        <Summary
          label="Product sales"
          value={amount("products")}
          description={`${quantity("products")} units sold`}
        />
        <Summary
          label="Services"
          value={amount("services")}
          description={`${quantity("services")} services sold`}
        />
        <Summary
          label="Packages"
          value={amount("packages")}
          description={`${quantity("packages")} sold · ${analytics.sessionsRedeemed} sessions redeemed`}
        />
      </section>
      <dl className="grid gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-3">
        {[
          ["Net sales after refunds", data.totals.revenue],
          ["Net paid after refunds", data.totals.paid],
          ["Refunds", data.totals.refunds],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="mt-1 font-heavy text-ink">{formatPrice(value!)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-ink-muted">
        Sales charts show completed receipts after discounts, before refunds; not recognised
        accounting revenue. Package purchases and sessions redeemed are separate. Paid amounts
        include credit tenders, not just cash collected.
      </p>
      <div className="grid gap-5 xl:grid-cols-3">
        <Card
          title="Sales trend"
          label="Sales trend"
          className="xl:col-span-2"
          description={`${analytics.granularity === "hour" ? "Hourly" : "Daily"} sales in the selected period, including quiet periods.`}
        >
          <div className="flex flex-wrap gap-2 py-3" role="group" aria-label="Sales trend metric">
            {(
              [
                ["revenue", "Total"],
                ["services", "Services"],
                ["products", "Products"],
                ["packages", "Packages"],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={metric === key ? "secondary" : "ghost"}
                aria-pressed={metric === key}
                onClick={() => setMetric(key)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="h-72 min-w-0" role="img" aria-label={`${metric} sales line chart`}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={timeline} margin={{ top: 12, right: 18, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" minTickGap={35} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={65} />
                <Tooltip formatter={moneyTooltip} />
                <Line
                  dataKey={metric}
                  name="Sales"
                  type="monotone"
                  stroke={colors[0]}
                  strokeWidth={3}
                  dot={timeline.length <= 31}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Sales mix" label="Sales mix" description="Share of sales by item category.">
          {mix.length ? (
            <>
              <div className="h-64 min-w-0" role="img" aria-label="Sales mix donut chart">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <PieChart>
                    <Pie
                      data={mix}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="58%"
                      outerRadius="85%"
                      paddingAngle={3}
                      isAnimationActive={false}
                    >
                      {mix.map((row, index) => (
                        <Cell key={row.name} fill={colors[index]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={moneyTooltip} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-2 px-2 text-sm">
                {mix.map((row, index) => (
                  <li key={row.name} className="flex justify-between gap-3">
                    <span>
                      <span
                        aria-hidden="true"
                        className="mr-2 inline-block h-2 w-2 rounded-full"
                        style={{ background: colors[index] }}
                      />
                      {row.name}
                    </span>
                    <span>{formatPrice(String(row.value))}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState
              title="No sales in this period"
              description="Completed sales will populate the category chart."
            />
          )}
        </Card>
        <Card
          title="Appointment activity"
          label="Appointment activity"
          description="Bookings by start time and current status."
          className="xl:col-span-2"
        >
          <div
            className="h-80 min-w-0 pt-4"
            role="img"
            aria-label="Appointments by status bar chart"
          >
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={timeline} margin={{ top: 8, right: 18, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" minTickGap={35} tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                {Object.entries(statusLabels).map(([key, label], index) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    name={label}
                    stackId="status"
                    fill={colors[index]}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card
          title="Best sellers"
          label="Best sellers"
          description={`${section === "Sales" || section === "Appointments" ? "All items" : section} · top seven`}
        >
          <div className="flex gap-2 py-3" role="group" aria-label="Rank best sellers by">
            {(["revenue", "quantity"] as const).map((key) => (
              <Button
                key={key}
                size="sm"
                variant={ranking === key ? "secondary" : "ghost"}
                aria-pressed={ranking === key}
                onClick={() => setRanking(key)}
              >
                {key === "revenue" ? "Sales amount" : "Quantity"}
              </Button>
            ))}
          </div>
          {bestSellers.length ? (
            <div
              className="h-64 min-w-0"
              role="img"
              aria-label="Best-selling items horizontal bar chart"
            >
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={bestSellers} layout="vertical" margin={{ right: 15 }}>
                  <XAxis
                    type="number"
                    allowDecimals={ranking !== "quantity"}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={ranking === "revenue" ? moneyTooltip : undefined} />
                  <Bar
                    dataKey="value"
                    name={ranking === "revenue" ? "Sales" : "Quantity"}
                    fill={colors[1]}
                    radius={[0, 4, 4, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              title="No items sold"
              description="Try a different date range or category."
            />
          )}
        </Card>
      </div>
      <Card title="Report details" description="Inspect the figures behind the charts.">
        <div
          className="flex flex-wrap gap-2 py-3"
          role="group"
          aria-label="Business report details"
        >
          {sections.map((name) => (
            <Button
              key={name}
              variant={section === name ? "secondary" : "ghost"}
              aria-pressed={section === name}
              onClick={() => setSection(name)}
            >
              {name}
            </Button>
          ))}
        </div>
        {section === "Appointments" ? (
          <AppointmentDetails analytics={analytics} />
        ) : section === "Sales" ? (
          <Table
            caption="Sales trend details"
            rows={analytics.timeline}
            rowKey={(row) => row.key}
            columns={[
              { key: "period", header: "Period", cell: (row) => row.label },
              { key: "sales", header: "Receipts", align: "right", cell: (row) => row.sales },
              {
                key: "amount",
                header: "Sales before refunds",
                align: "right",
                cell: (row) => formatPrice(row.revenue),
              },
            ]}
          />
        ) : (
          <Table
            caption={`${section} sales details`}
            rows={selectedItems}
            rowKey={(row) => `${row.itemType}:${row.itemId}`}
            columns={[
              { key: "name", header: "Item", cell: (row) => row.itemName },
              { key: "quantity", header: "Quantity", align: "right", cell: (row) => row.quantity },
              {
                key: "amount",
                header: "Sales before refunds",
                align: "right",
                cell: (row) => formatPrice(row.revenue),
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}

function AppointmentDetails({ analytics }: { analytics: ReportAnalytics }) {
  return (
    <Table
      caption="Appointment status details"
      rows={Object.entries(statusLabels).map(([key, label]) => ({
        key,
        label,
        count: analytics.appointments[key as keyof typeof statusLabels],
      }))}
      rowKey={(row) => row.key}
      columns={[
        { key: "status", header: "Status", cell: (row) => row.label },
        { key: "count", header: "Appointments", align: "right", cell: (row) => row.count },
      ]}
    />
  );
}
