import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReportOverview } from "@glampro_suite/shared";

const { useReportOverview, getErrorMessage } = vi.hoisted(() => ({
  useReportOverview: vi.fn(),
  getErrorMessage: vi.fn(() => "Report service unavailable."),
}));

vi.mock("@/hooks/useReports", () => ({ useReportOverview }));
vi.mock("@/lib/api", () => ({ getErrorMessage }));

const { default: Reports } = await import("@/pages/Reports");

const OVERVIEW: ReportOverview = {
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-10-03T23:59:59.999Z",
  totals: { revenue: "105.00", paid: "95.00", tax: "8.67", sales: 2, items: 4 },
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
      revenue: "85.00",
    },
    { itemType: "PRODUCT", itemId: "oil", itemName: "Hair oil", quantity: 1, revenue: "20.00" },
  ],
  staffPerformance: [
    {
      userId: "staff-1",
      name: "Stella Stylist",
      position: "Senior stylist",
      creditedLines: 2,
      revenue: "85.00",
    },
  ],
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
  useReportOverview.mockReturnValue(result());
  getErrorMessage.mockReturnValue("Report service unavailable.");
});

describe("Reports", () => {
  it("renders totals and all three server-backed tables", () => {
    render(<Reports />);

    expect(screen.getByText("S$105.00")).toBeInTheDocument();
    expect(screen.getByText("S$95.00")).toBeInTheDocument();
    expect(screen.getByText("Signature cut")).toBeInTheDocument();
    expect(screen.getByText("Hair oil")).toBeInTheDocument();
    expect(screen.getByText("Stella Stylist")).toBeInTheDocument();

    expect(
      within(screen.getByRole("table", { name: "Sales by day" })).getAllByRole("row"),
    ).toHaveLength(3);
    expect(
      within(screen.getByRole("table", { name: "Top-selling items" })).getAllByRole("row"),
    ).toHaveLength(3);
    expect(
      within(screen.getByRole("table", { name: "Staff performance" })).getAllByRole("row"),
    ).toHaveLength(2);
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

  it("shows honest empty states when the range has no rows", () => {
    useReportOverview.mockReturnValue(
      result({
        data: {
          ...OVERVIEW,
          totals: { revenue: "0.00", paid: "0.00", tax: "0.00", sales: 0, items: 0 },
          salesByDay: [],
          topItems: [],
          staffPerformance: [],
        },
      }),
    );

    render(<Reports />);
    expect(screen.getByText("No completed sales")).toBeInTheDocument();
    expect(screen.getByText("No items sold")).toBeInTheDocument();
    expect(screen.getByText("No attributed sales")).toBeInTheDocument();
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
