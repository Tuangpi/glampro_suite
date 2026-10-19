import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReportOverview, ZReport } from "@glampro_suite/shared";

const { useReportOverview, useZReport, getErrorMessage } = vi.hoisted(() => ({
  useReportOverview: vi.fn(),
  useZReport: vi.fn(),
  getErrorMessage: vi.fn(() => "Report service unavailable."),
}));

vi.mock("@/hooks/useReports", () => ({ useReportOverview, useZReport }));
vi.mock("@/lib/api", () => ({ getErrorMessage }));

const { default: Reports } = await import("@/pages/Reports");

const OVERVIEW: ReportOverview = {
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-10-03T23:59:59.999Z",
  totals: {
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
    totalMoney: "70.00",
  },
  asOf: "2026-10-03T23:59:59.999Z",
};

const CLOSE: ZReport = {
  date: "2026-10-02",
  timeZone: "Asia/Singapore",
  from: "2026-10-01T16:00:00.000Z",
  to: "2026-10-02T16:00:00.000Z",
  totals: {
    grossSales: "90.00",
    discounts: "5.00",
    netSales: "85.00",
    tax: "7.00",
    paid: "75.00",
    collected: "75.00",
    redeemed: "10.00",
    sales: 2,
    items: 4,
  },
  tenders: [
    { method: "CASH", amount: "25.00", redemption: false },
    { method: "CARD", amount: "70.00", redemption: false },
  ],
  voids: { count: 1, amount: "20.00" },
  outstandingCreated: "10.00",
  asOf: "2026-10-02T23:59:59.999Z",
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
  useReportOverview.mockReturnValue(result());
  useZReport.mockReturnValue(result({ data: CLOSE }));
  getErrorMessage.mockReturnValue("Report service unavailable.");
});

describe("Reports", () => {
  it("renders totals, the daily close and every server-backed table", () => {
    render(<Reports />);

    expect(screen.getByText("S$105.00")).toBeInTheDocument();
    expect(screen.getByText("S$95.00")).toBeInTheDocument();
    expect(screen.getAllByText("S$5.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Signature cut")).toHaveLength(2);
    expect(screen.getByText("Hair oil")).toBeInTheDocument();
    expect(screen.getByText("Stella Stylist")).toBeInTheDocument();
    expect(screen.getByText("S$6.25")).toBeInTheDocument();
    expect(screen.getByText("S$90.00")).toBeInTheDocument();
    expect(screen.getByText("12 across 3 holdings")).toBeInTheDocument();

    expect(
      within(screen.getByRole("table", { name: "Sales by day" })).getAllByRole("row"),
    ).toHaveLength(3);
    expect(
      within(screen.getByRole("table", { name: "Top-selling items" })).getAllByRole("row"),
    ).toHaveLength(3);
    expect(
      within(screen.getByRole("table", { name: "Sales by service" })).getAllByRole("row"),
    ).toHaveLength(3);
    expect(
      within(screen.getByRole("table", { name: "Tender totals" })).getAllByRole("row"),
    ).toHaveLength(4);
    expect(
      within(screen.getByRole("table", { name: "Staff performance" })).getAllByRole("row"),
    ).toHaveLength(2);
    expect(
      within(screen.getByRole("table", { name: "Daily tender totals" })).getAllByRole("row"),
    ).toHaveLength(3);
    expect(screen.getAllByText("Credit redeemed").length).toBeGreaterThan(0);
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

  it("asks for the daily close by salon-local date", async () => {
    const user = userEvent.setup();
    render(<Reports />);

    const closeDate = screen.getByLabelText("Close date");
    await user.clear(closeDate);
    await user.type(closeDate, "2026-09-15");

    const latest = useZReport.mock.calls.at(-1)?.[0] as { date: string; timeZone: string };
    expect(latest.date).toBe("2026-09-15");
    expect(latest.timeZone).toBeTruthy();
  });

  it("shows honest empty states when the range has no rows", () => {
    useReportOverview.mockReturnValue(
      result({
        data: {
          ...OVERVIEW,
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
          },
        },
      }),
    );

    render(<Reports />);
    expect(screen.getByText("No completed sales")).toBeInTheDocument();
    expect(screen.getByText("No items sold")).toBeInTheDocument();
    expect(screen.getByText("No attributed sales")).toBeInTheDocument();
    expect(screen.getByText("No services sold")).toBeInTheDocument();
    expect(screen.getByText("No payments")).toBeInTheDocument();
    expect(screen.getByText("Customer liability")).toBeInTheDocument();
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
