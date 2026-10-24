import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PackageValuationReport, ReportOverview, ZReport } from "@glampro_suite/shared";
import { createSalonFormatters, DEFAULT_SALON_FORMATTING } from "@/lib/utils";

const { formatDateTime } = createSalonFormatters(DEFAULT_SALON_FORMATTING);

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
vi.mock("@/components/reports/PackageValuationActivation", () => ({
  default: () => <p>Activation controls</p>,
}));

const { default: Reports } = await import("@/pages/Reports");

const OVERVIEW: ReportOverview = {
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

const CLOSE: ZReport = {
  date: "2026-10-02",
  timeZone: "Asia/Singapore",
  from: "2026-10-01T16:00:00.000Z",
  to: "2026-10-02T16:00:00.000Z",
  totals: {
    grossSales: "90.00",
    refunds: "0.00",
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
  refundTenders: [],
  outstandingCreated: "10.00",
  asOf: "2026-10-02T23:59:59.999Z",
};

const VALUATION: PackageValuationReport = {
  scope: "COMPANY",
  asOf: "2026-10-24T05:00:00.000Z",
  activation: {
    id: "activation",
    policyVersion: 1,
    currency: "SGD",
    activatedAt: "2026-10-23T00:00:00.000Z",
    actorId: "manager",
    reason: "Confirmed",
  },
  active: {
    holdings: 2,
    sessionsRemaining: 5,
    net: "100.01",
    originalTax: "9.00",
    gross: "109.01",
  },
  expired: { holdings: 1, sessionsRemaining: 2, net: "20.00", originalTax: "1.80", gross: "21.80" },
  unvalued: {
    active: { holdings: 3, sessionsRemaining: 7 },
    expired: { holdings: 1, sessionsRemaining: 4 },
  },
  unpaidPurchases: { sales: 1, holdings: 2, sourceSaleOutstanding: "150.00" },
  reconciliation: { status: "RECONCILED", purchases: 3, movements: 8 },
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
  useZReport.mockReturnValue(result({ data: CLOSE }));
  usePackageValuationReport.mockReturnValue(
    result({ data: VALUATION, isFetching: false, refetch: vi.fn() }),
  );
  getErrorMessage.mockReturnValue("Report service unavailable.");
});

afterEach(() => vi.useRealTimers());

describe("Reports", () => {
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

  it("supports keyboard tabs and fetches the daily close only when selected", async () => {
    const user = userEvent.setup();
    render(<Reports />);
    expect(useZReport.mock.calls.at(-1)?.[1]).toBe(false);
    screen.getByRole("tab", { name: "Overview" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Staff & payments" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Staff & payments");
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Daily close" })).toHaveFocus();
    expect(useZReport.mock.calls.at(-1)?.[1]).toBe(true);
    fireEvent.change(screen.getByLabelText("Close date"), { target: { value: "" } });
    expect(useZReport.mock.calls.at(-1)?.[1]).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a valid close date");
    expect(screen.queryByText("S$90.00")).not.toBeInTheDocument();
  });

  it("keeps package warnings visible while audit details are collapsed", async () => {
    const user = userEvent.setup();
    render(<Reports />);
    await user.click(screen.getByRole("tab", { name: "Customer balances" }));
    const summary = screen.getByText("Valuation policy and audit details");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText(/Unknown purchase value is not zero/)).toBeVisible();
    expect(screen.getByText(/not allocated package cash/)).toBeVisible();
    await user.click(summary);
    expect(summary.closest("details")).toHaveAttribute("open");
    expect(screen.getByText(/Immutable activation confirmation/)).toBeVisible();
  });

  it("does not show cached sales totals on a report error", () => {
    useReportOverview.mockReturnValue(result({ isError: true, error: new Error("down") }));
    render(<Reports />);
    expect(screen.queryByText("S$105.00")).not.toBeInTheDocument();
    expect(screen.getByText("The report could not be loaded")).toBeInTheDocument();
  });

  it("keeps package purchase value separate, company-wide and explicitly incomplete", () => {
    render(<Reports />);
    fireEvent.click(screen.getByRole("tab", { name: "Customer balances" }));
    const panel = within(screen.getByRole("region", { name: "Remaining package purchase value" }));
    expect(
      panel.getByText(/Independent of the selected sales range and outlet/),
    ).toBeInTheDocument();
    expect(panel.getByText(/Other report panels have their own snapshot times/)).toHaveTextContent(
      formatDateTime(VALUATION.asOf),
    );
    expect(
      within(panel.getByRole("region", { name: "Active unused packages" })).getByText("SGD 100.01"),
    ).toBeInTheDocument();
    expect(
      within(panel.getByRole("region", { name: "Expired unused packages" })).getByText("SGD 20.00"),
    ).toBeInTheDocument();
    expect(panel.getByText(/Unknown purchase value is not zero/)).toBeInTheDocument();
    expect(panel.getByText("7 across 3 holdings")).toBeInTheDocument();
    expect(panel.getByText("4 across 1 holdings")).toBeInTheDocument();
    expect(panel.getByText("SGD 150.00")).toBeInTheDocument();
    expect(panel.getByText(/not allocated package cash/)).toBeInTheDocument();
    expect(panel.getByText(/does not imply recognised revenue/)).toBeInTheDocument();
    expect(screen.getByText(/Total monetary liability:/)).toHaveTextContent("S$55.00");
  });

  it("does not imply valuation is active or present zeros before activation", () => {
    usePackageValuationReport.mockReturnValue(
      result({ data: { ...VALUATION, activation: null }, refetch: vi.fn() }),
    );
    render(<Reports />);
    fireEvent.click(screen.getByRole("tab", { name: "Customer balances" }));
    expect(screen.getByText(/Package valuation is not activated/)).toBeInTheDocument();
    expect(screen.queryByText("SGD 100.01")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Unpaid package purchase disclosure" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("7 across 3 holdings")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /activate/i })).not.toBeInTheDocument();
  });

  it("hides cached values after valuation failure without hiding other reports", async () => {
    const refetch = vi.fn();
    usePackageValuationReport.mockReturnValue(
      result({ data: VALUATION, isError: true, error: new Error("reconciliation"), refetch }),
    );
    render(<Reports />);
    fireEvent.click(screen.getByRole("tab", { name: "Customer balances" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Package valuation is unavailable");
    expect(screen.queryByText("SGD 100.01")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh package value" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows loading rather than zero and disables refresh while fetching", () => {
    usePackageValuationReport.mockReturnValue(
      result({ data: undefined, isPending: true, isFetching: true, refetch: vi.fn() }),
    );
    render(<Reports />);
    fireEvent.click(screen.getByRole("tab", { name: "Customer balances" }));
    expect(screen.getByText("Loading package valuation…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh package value" })).toBeDisabled();
    expect(screen.queryByText("SGD 0.00")).not.toBeInTheDocument();
  });

  it("displays a known zero and preserves cents on large aggregate values", () => {
    usePackageValuationReport.mockReturnValue(
      result({
        data: {
          ...VALUATION,
          active: {
            ...VALUATION.active,
            net: "9007199254740993.01",
            originalTax: "0.00",
            gross: "9007199254740993.01",
          },
        },
        refetch: vi.fn(),
      }),
    );
    render(<Reports />);
    fireEvent.click(screen.getByRole("tab", { name: "Customer balances" }));
    expect(screen.getAllByText("SGD 9,007,199,254,740,993.01")).toHaveLength(2);
    expect(screen.getByText("SGD 0.00")).toBeInTheDocument();
  });

  it("renders the focused overview and preserves every server-backed table across tabs", async () => {
    const user = userEvent.setup();
    render(<Reports />);
    expect(screen.getByText("S$105.00")).toBeInTheDocument();
    expect(screen.getByText("S$95.00")).toBeInTheDocument();
    expect(screen.getAllByText("Signature cut")).toHaveLength(2);
    expect(screen.getByText("Hair oil")).toBeInTheDocument();
    expect(screen.queryByText("Stella Stylist")).not.toBeInTheDocument();
    for (const name of ["Sales by day", "Top-selling items", "Sales by service"]) {
      expect(within(screen.getByRole("table", { name })).getAllByRole("row")).toHaveLength(3);
    }
    await user.click(screen.getByRole("tab", { name: "Staff & payments" }));
    expect(screen.getByText("Stella Stylist")).toBeInTheDocument();
    expect(screen.getByText("S$6.25")).toBeInTheDocument();
    expect(
      within(screen.getByRole("table", { name: "Tender totals" })).getAllByRole("row"),
    ).toHaveLength(4);
    expect(
      within(screen.getByRole("table", { name: "Staff performance" })).getAllByRole("row"),
    ).toHaveLength(2);
    await user.click(screen.getByRole("tab", { name: "Daily close" }));
    expect(screen.getByText("S$90.00")).toBeInTheDocument();
    expect(
      within(screen.getByRole("table", { name: "Daily tender totals" })).getAllByRole("row"),
    ).toHaveLength(3);
    await user.click(screen.getByRole("tab", { name: "Customer balances" }));
    expect(screen.getByText("12 across 3 holdings")).toBeInTheDocument();
  });

  it("separates current liabilities, receivables and unvalued sessions", () => {
    render(<Reports />);
    fireEvent.click(screen.getByRole("tab", { name: "Customer balances" }));
    const balances = screen.getByRole("region", { name: "Current customer balances" });
    expect(
      within(balances).getByText(/independent of the selected sales range/),
    ).toBeInTheDocument();
    expect(within(balances).getByText(/not historical closing balances/)).toBeInTheDocument();
    expect(
      within(balances).getByText(
        `Snapshot as of ${formatDateTime(OVERVIEW.liability.asOf)} (Asia/Singapore).`,
      ),
    ).toBeInTheDocument();
    const liability = within(balances).getByText(/Total monetary liability:/);
    expect(liability).toHaveTextContent("S$55.00");
    expect(liability).not.toHaveTextContent("70.00");
    const owed = within(balances).getByText("Amount owed to salon").closest("div")!;
    expect(owed).toHaveTextContent("S$15.00");
    expect(within(balances).getByText(/12 across 3 holdings/)).toBeInTheDocument();
    expect(
      within(balances).getByText(/not a complete accounting or deferred-revenue valuation/),
    ).toBeInTheDocument();
  });

  it("keeps the snapshot timestamp independent when the sales period changes", async () => {
    const user = userEvent.setup();
    render(<Reports />);
    await user.clear(screen.getByLabelText("From"));
    await user.type(screen.getByLabelText("From"), "2000-01-01");
    await user.clear(screen.getByLabelText("To"));
    await user.type(screen.getByLabelText("To"), "2000-01-02");
    await user.click(screen.getByRole("tab", { name: "Customer balances" }));
    expect(
      screen.getByText(
        `Snapshot as of ${formatDateTime(OVERVIEW.liability.asOf)} (Asia/Singapore).`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Total monetary liability:/)).toHaveTextContent("S$55.00");
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
    await user.click(screen.getByRole("tab", { name: "Daily close" }));

    const closeDate = screen.getByLabelText("Close date");
    await user.clear(closeDate);
    await user.type(closeDate, "2026-09-15");

    const latest = useZReport.mock.calls.at(-1)?.[0] as { date: string; timeZone: string };
    expect(latest.date).toBe("2026-09-15");
    expect(latest.timeZone).toBeTruthy();
  });

  it("shows honest empty states when the range has no rows", async () => {
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
            asOf: "2026-10-23T05:00:00.000Z",
          },
        },
      }),
    );

    render(<Reports />);
    expect(screen.getByText("No completed sales")).toBeInTheDocument();
    expect(screen.getByText("No items sold")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("tab", { name: "Staff & payments" }));
    expect(screen.getByText("No attributed sales")).toBeInTheDocument();

    expect(screen.getByText("No payments")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("tab", { name: "Customer balances" }));
    expect(screen.getByText("Current customer balances")).toBeInTheDocument();
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
