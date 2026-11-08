import type { ReportAnalytics, ReportItem } from "@glampro_suite/shared";

type Category = ReportAnalytics["categories"][number]["key"];
type Status = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
const statuses = {
  SCHEDULED: "scheduled",
  IN_PROGRESS: "inProgress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  NO_SHOW: "noShow",
} as const;
const categoryFor = (type: ReportItem["itemType"]): Category =>
  type === "SERVICE"
    ? "services"
    : type === "PRODUCT"
      ? "products"
      : type === "GIFT_CARD"
        ? "other"
        : "packages";

function cents(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole = "0", fraction = "00"] = value.replace("-", "").split(".");
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return negative ? -amount : amount;
}
function money(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

/** Pure aggregation: exact cents for totals; floats are only used by the chart renderer. */
export function buildReportAnalytics(input: {
  from: Date;
  to: Date;
  timeZone: string;
  sales: { soldAt: Date; totalAmount: string }[];
  lines: (ReportItem & { soldAt: Date })[];
  appointments: { startsAt: Date; status: Status }[];
  sessionsRedeemed: number;
}): ReportAnalytics {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: input.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayKey = (date: Date) => {
    const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const hourly = dayKey(input.from) === dayKey(input.to);
  const hourLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: input.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  });
  const keyFor = (date: Date) =>
    hourly ? String(Math.floor((date.getTime() - input.from.getTime()) / 3_600_000)) : dayKey(date);
  const emptyStatus = () => ({
    scheduled: 0,
    inProgress: 0,
    completed: 0,
    cancelled: 0,
    noShow: 0,
  });
  const rows = new Map<
    string,
    {
      key: string;
      label: string;
      sales: number;
      revenue: bigint;
      services: bigint;
      products: bigint;
      packages: bigint;
      other: bigint;
      scheduled: number;
      inProgress: number;
      completed: number;
      cancelled: number;
      noShow: number;
    }
  >();
  const addBucket = (key: string, label: string) =>
    rows.set(key, {
      key,
      label,
      sales: 0,
      revenue: 0n,
      services: 0n,
      products: 0n,
      packages: 0n,
      other: 0n,
      ...emptyStatus(),
    });
  if (hourly) {
    for (let instant = input.from.getTime(); instant <= input.to.getTime(); instant += 3_600_000) {
      const date = new Date(instant);
      addBucket(keyFor(date), hourLabel.format(date));
    }
  } else {
    // Calendar iteration, not 24-hour instant stepping: handles DST boundaries.
    const end = dayKey(input.to);
    for (
      const date = new Date(`${dayKey(input.from)}T00:00:00Z`);
      date.toISOString().slice(0, 10) <= end;
      date.setUTCDate(date.getUTCDate() + 1)
    ) {
      const key = date.toISOString().slice(0, 10);
      addBucket(key, key);
    }
  }
  for (const sale of input.sales) {
    const row = rows.get(keyFor(sale.soldAt));
    if (row) {
      row.sales++;
      row.revenue += cents(sale.totalAmount);
    }
  }
  const categories = new Map<
    Category,
    { key: Category; label: string; quantity: number; revenue: bigint }
  >(
    (
      [
        ["services", "Services"],
        ["products", "Products"],
        ["packages", "Packages"],
        ["other", "Gift cards"],
      ] as const
    ).map(([key, label]) => [key, { key, label, quantity: 0, revenue: 0n }]),
  );
  const items = new Map<string, Omit<ReportItem, "revenue"> & { revenue: bigint }>();
  for (const line of input.lines) {
    const category = categoryFor(line.itemType);
    const amount = cents(line.revenue);
    const total = categories.get(category)!;
    total.quantity += line.quantity;
    total.revenue += amount;
    const row = rows.get(keyFor(line.soldAt));
    if (row) row[category] += amount;
    const key = `${line.itemType}:${line.itemId}`;
    const item = items.get(key) ?? {
      itemType: line.itemType,
      itemId: line.itemId,
      itemName: line.itemName,
      quantity: 0,
      revenue: 0n,
    };
    item.quantity += line.quantity;
    item.revenue += amount;
    items.set(key, item);
  }
  const appointments = { total: input.appointments.length, ...emptyStatus() };
  for (const booking of input.appointments) {
    const status = statuses[booking.status];
    appointments[status]++;
    const row = rows.get(keyFor(booking.startsAt));
    if (row) row[status]++;
  }
  return {
    salesAmount: money(input.sales.reduce((sum, sale) => sum + cents(sale.totalAmount), 0n)),
    granularity: hourly ? "hour" : "day",
    appointments,
    sessionsRedeemed: input.sessionsRedeemed,
    categories: [...categories.values()].map((row) => ({ ...row, revenue: money(row.revenue) })),
    items: [...items.values()]
      .sort((a, b) =>
        a.revenue === b.revenue ? b.quantity - a.quantity : a.revenue > b.revenue ? -1 : 1,
      )
      .map((row) => ({ ...row, revenue: money(row.revenue) })),
    timeline: [...rows.values()].map((row) => ({
      ...row,
      revenue: money(row.revenue),
      services: money(row.services),
      products: money(row.products),
      packages: money(row.packages),
      other: money(row.other),
    })),
  };
}
