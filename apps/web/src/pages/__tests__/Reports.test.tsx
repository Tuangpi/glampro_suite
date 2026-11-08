import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReportOverview } from "@glampro_suite/shared";

const { useReportOverview, useZReport, usePackageValuationReport, getErrorMessage } = vi.hoisted(
  () => ({
    useReportOverview: vi.fn(),
    useZReport: vi.fn(),
    usePackageValuationReport: vi.fn(),
    getErrorMessage: vi.fn(() => "Report service unavailable."),
  }),
);

vi.mock("@/hooks/useReports", () => ({ useReportOverview, useZReport, usePackageValuationReport }));
vi.mock("@/lib/api", () => ({ getErrorMessage }));
const { default: Reports } = await import("@/pages/Reports");

const OVERVIEW: ReportOverview = {
  analytics: {
    salesAmount: "105.00",
    granularity: "day",
    sessionsRedeemed: 2,
    appointments: { total: 8, scheduled: 3, inProgress: 1, completed: 2, cancelled: 1, noShow: 1 },
    categories: [
      { key: "services", label: "Services", quantity: 3, revenue: "80.00" },
      { key: "products", label: "Products", quantity: 1, revenue: "25.00" },
      { key: "packages", label: "Packages", quantity: 0, revenue: "0.00" },
      { key: "other", label: "Gift cards", quantity: 0, revenue: "0.00" },
    ],
    items: [
      {
        itemType: "SERVICE",
        itemId: "cut",
        itemName: "Signature cut",
        quantity: 3,
        revenue: "80.00",
      },
      { itemType: "PRODUCT", itemId: "oil", itemName: "Hair oil", quantity: 1, revenue: "25.00" },
    ],
    timeline: [
      {
        key: "2026-10-01",
        label: "2026-10-01",
        sales: 1,
        revenue: "80.00",
        services: "80.00",
        products: "0.00",
        packages: "0.00",
        other: "0.00",
        scheduled: 3,
        inProgress: 1,
        completed: 2,
        cancelled: 1,
        noShow: 1,
      },
      {
        key: "2026-10-02",
        label: "2026-10-02",
        sales: 1,
        revenue: "25.00",
        services: "0.00",
        products: "25.00",
        packages: "0.00",
        other: "0.00",
        scheduled: 0,
        inProgress: 0,
        completed: 0,
        cancelled: 0,
        noShow: 0,
      },
    ],
  },
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-10-03T23:59:59.999Z",
  totals: {
    grossSales: "110.00",
    refunds: "0.00",
    commissionReconciliation: 0,
    revenue: "105.00",
    paid: "95.00",
    tax: "8.67",
    discounts: "5.00",
    sales: 2,
    items: 4,
  },
  salesByDay: [
    { date: "2026-10-01", sales: 1, quantity: 3, revenue: "80.00", paid: "70.00", tax: "6.61" },
    { date: "2026-10-02", sales: 1, quantity: 1, revenue: "25.00", paid: "25.00", tax: "2.06" },
  ],
  topItems: [
    {
      itemType: "SERVICE",
      itemId: "cut",
      itemName: "Signature cut",
      quantity: 3,
      revenue: "80.00",
    },
    { itemType: "PRODUCT", itemId: "oil", itemName: "Hair oil", quantity: 1, revenue: "25.00" },
  ],
  staffPerformance: [
    {
      userId: "staff-1",
      name: "Stella Stylist",
      position: "Senior stylist",
      creditedLines: 2,
      revenue: "80.00",
      commission: "6.25",
    },
  ],
  serviceSales: [
    { serviceId: "cut", name: "Signature cut", quantity: 3, revenue: "80.00" },
    { serviceId: "colour", name: "Colour refresh", quantity: 1, revenue: "25.00" },
  ],
  tenders: [
    { method: "CASH", amount: "25.00", redemption: false },
    { method: "CARD", amount: "70.00", redemption: false },
    { method: "PREPAID_CREDIT", amount: "10.00", redemption: true },
  ],
  liability: {
    packageSessions: { holdings: 3, sessionsRemaining: 12 },
    prepaidCredit: { holdings: 2, balance: "40.00" },
    giftCards: { holdings: 1, balance: "15.00" },
    outstanding: { customers: 2, balance: "15.00" },
    totalMoney: "55.00",
    asOf: "2026-10-23T05:00:00.000Z",
  },
  refundTenders: [],
  asOf: "2026-10-03T23:59:59.999Z",
};

function result(overrides: Record<string, unknown> = {}) {
  return {
    data: OVERVIEW,
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useReportOverview.mockReturnValue(result());
  getErrorMessage.mockReturnValue("Report service unavailable.");
});

afterEach(() => vi.useRealTimers());

describe("Reports", () => {
  it("shows one focused dashboard without operational tabs or extra report requests", () => {
    render(<Reports />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    for (const label of [
      "Detailed sales",
      "Staff & payments",
      "Customer balances",
      "Daily close",
    ]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(useZReport).not.toHaveBeenCalled();
    expect(usePackageValuationReport).not.toHaveBeenCalled();
    for (const name of [
      "Business summary",
      "Sales trend",
      "Sales mix",
      "Appointment activity",
      "Best sellers",
    ]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
    const controls = within(screen.getByRole("group", { name: "Business report details" }));
    for (const name of ["Appointments", "Sales", "Products", "Services", "Packages"]) {
      expect(controls.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("table", { name: "Sales trend details" })).toBeInTheDocument();
  });

  it("shows loading without cached charts or invented zero totals", () => {
    useReportOverview.mockReturnValue(result({ isPending: true }));
    render(<Reports />);
    expect(screen.getByRole("status", { name: "Loading report" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Business summary" })).not.toBeInTheDocument();
  });

  it("supports keyboard selection of detail sections without hiding the date filters", async () => {
    const user = userEvent.setup();
    render(<Reports />);
    const controls = within(screen.getByRole("group", { name: "Business report details" }));
    controls.getByRole("button", { name: "Services" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("table", { name: "Services sales details" })).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toBeVisible();
    expect(screen.getByLabelText("To")).toBeVisible();
    await user.tab();
    expect(controls.getByRole("button", { name: "Packages" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("table", { name: "Packages sales details" })).toBeInTheDocument();
  });

  it("uses salon-local presets even when the browser is on the previous day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T18:00:00.000Z"));
    render(<Reports />);
    expect(screen.getByLabelText("From")).toHaveValue("2026-10-01");
    expect(screen.getByLabelText("To")).toHaveValue("2026-10-25");
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByLabelText("From")).toHaveValue("2026-10-25");
    expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    expect(screen.getByLabelText("From")).toHaveValue("2026-10-19");
    expect(screen.getByLabelText("To")).toHaveValue("2026-10-25");
    fireEvent.click(screen.getByRole("button", { name: "This month" }));
    expect(screen.getByLabelText("From")).toHaveValue("2026-10-01");
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByLabelText("From")).toHaveValue("2026-10-01");
  });

  it("disables incomplete and reversed ranges without showing stale totals", () => {
    render(<Reports />);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Choose valid From and To dates");
    expect(useReportOverview.mock.calls.at(-1)?.[1]).toBe(false);
    expect(screen.queryByText("S$105.00")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-02" } });
    expect(useReportOverview.mock.calls.at(-1)?.[1]).toBe(false);
    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-03" } });
    expect(useReportOverview.mock.calls.at(-1)?.[1]).toBe(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not show cached sales totals on a report error", () => {
    useReportOverview.mockReturnValue(result({ isError: true, error: new Error("down") }));
    render(<Reports />);
    expect(screen.queryByText("S$105.00")).not.toBeInTheDocument();
    expect(screen.getByText("The report could not be loaded")).toBeInTheDocument();
  });

  it("filters business details, changes chart metrics and keeps redemption counts separate", () => {
    render(<Reports />);
    const summary = within(screen.getByRole("region", { name: "Business summary" }));
    expect(summary.getByText("8")).toBeInTheDocument();
    expect(summary.getByText("0 sold · 2 sessions redeemed")).toBeInTheDocument();
    const controls = within(screen.getByRole("group", { name: "Business report details" }));
    fireEvent.click(controls.getByRole("button", { name: "Products" }));
    const products = within(screen.getByRole("table", { name: "Products sales details" }));
    expect(products.getByText("Hair oil")).toBeInTheDocument();
    expect(products.queryByText("Signature cut")).not.toBeInTheDocument();
    fireEvent.click(controls.getByRole("button", { name: "Appointments" }));
    expect(screen.getByRole("table", { name: "Appointment status details" })).toBeInTheDocument();
    const metric = within(screen.getByRole("group", { name: "Sales trend metric" })).getByRole(
      "button",
      { name: "Products" },
    );
    fireEvent.click(metric);
    expect(metric).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "products sales line chart" })).toBeInTheDocument();
  });

  it("does not fabricate category totals when the API has not supplied analytics", () => {
    useReportOverview.mockReturnValue(result({ data: { ...OVERVIEW, analytics: undefined } }));
    render(<Reports />);
    expect(screen.getByText("Business analytics are unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Business summary" })).not.toBeInTheDocument();
  });

  it("turns selected local dates into one range query", async () => {
    const user = userEvent.setup();
    render(<Reports />);

    const from = screen.getByLabelText("From");
    const to = screen.getByLabelText("To");
    await user.clear(from);
    await user.type(from, "2026-09-01");
    await user.clear(to);
    await user.type(to, "2026-09-30");

    const latest = useReportOverview.mock.calls.at(-1)?.[0] as {
      from: string;
      to: string;
      timeZone: string;
    };
    // User picks local dates in the salon's timezone (Asia/Singapore): "2026-09-01" means
    // 00:00 SGT = 16:00 UTC the previous day; "2026-09-30 23:59:59.999" means 15:59:59.999 UTC.
    expect(latest.from).toBe("2026-08-31T16:00:00.000Z");
    expect(latest.to).toBe("2026-09-30T15:59:59.999Z");
    expect(latest.timeZone).toBeTruthy();
  });

  it("shows honest empty states when the range has no rows", async () => {
    useReportOverview.mockReturnValue(
      result({
        data: {
          ...OVERVIEW,
          analytics: {
            ...OVERVIEW.analytics!,
            salesAmount: "0.00",
            items: [],
            categories: OVERVIEW.analytics!.categories.map((row) => ({
              ...row,
              quantity: 0,
              revenue: "0.00",
            })),
            appointments: {
              total: 0,
              scheduled: 0,
              inProgress: 0,
              completed: 0,
              cancelled: 0,
              noShow: 0,
            },
            sessionsRedeemed: 0,
            timeline: [],
          },
          totals: {
            revenue: "0.00",
            paid: "0.00",
            tax: "0.00",
            discounts: "0.00",
            sales: 0,
            items: 0,
          },
          salesByDay: [],
          topItems: [],
          staffPerformance: [],
          serviceSales: [],
          tenders: [],
          liability: {
            packageSessions: { holdings: 0, sessionsRemaining: 0 },
            prepaidCredit: { holdings: 0, balance: "0.00" },
            giftCards: { holdings: 0, balance: "0.00" },
            outstanding: { customers: 0, balance: "0.00" },
            totalMoney: "0.00",
            asOf: "2026-10-23T05:00:00.000Z",
          },
        },
      }),
    );

    render(<Reports />);
    expect(screen.getByText("No sales in this period")).toBeInTheDocument();
    expect(screen.getByText("No items sold")).toBeInTheDocument();
  });

  it("distinguishes a failed report from a zero report", () => {
    useReportOverview.mockReturnValue(
      result({ data: undefined, isError: true, error: new Error("down") }),
    );

    render(<Reports />);
    expect(screen.getByText("The report could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("Report service unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("No completed sales")).not.toBeInTheDocument();
  });
});
