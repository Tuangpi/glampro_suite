import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useDashboardSummary, useSystemStatus } = vi.hoisted(() => ({
  useDashboardSummary: vi.fn(),
  useSystemStatus: vi.fn(),
}));

vi.mock("@/hooks/useDashboard", () => ({ useDashboardSummary }));
vi.mock("@/hooks/useSystemStatus", () => ({ useSystemStatus }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { name: "Ava Owner" },
    tenant: null,
    entitlements: [],
    isReadOnly: false,
  }),
}));

const { default: Dashboard } = await import("@/pages/Dashboard");

beforeEach(() => {
  useSystemStatus.mockReset();
  useDashboardSummary.mockReturnValue({
    data: {
      incomeToday: "125.50",
      salesToday: 3,
      appointmentsToday: 4,
      newCustomersToday: 2,
      lowStock: 5,
      asOf: "2026-10-09T10:00:00.000Z",
    },
    isError: false,
  });
});

describe("Dashboard", () => {
  it("renders the business summary without developer diagnostics", () => {
    render(<Dashboard />);

    expect(screen.getByText("Welcome back, Ava")).toBeInTheDocument();
    expect(screen.getByText("S$125.50")).toBeInTheDocument();
    expect(screen.getByText("Today’s income · 3 sales")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Here is your salon at a glance.")).toBeInTheDocument();
    expect(screen.queryByText(/system status|Salon Pro|design system/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /re-check status/i })).not.toBeInTheDocument();
    expect(useSystemStatus).not.toHaveBeenCalled();
  });

  it("shows dashes while the summary is loading without inventing zeroes", () => {
    useDashboardSummary.mockReturnValue({ data: undefined, isError: false, isPending: true });
    render(<Dashboard />);
    expect(screen.getAllByText("—")).toHaveLength(4);
    expect(screen.getByRole("status")).toHaveTextContent("Loading today’s figures");
    expect(useSystemStatus).not.toHaveBeenCalled();
  });

  it("shows dashes and an explanation when the summary fails", () => {
    useDashboardSummary.mockReturnValue({ data: undefined, isError: true });
    render(<Dashboard />);
    expect(screen.getByText(/figures could not be loaded/i)).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(4);
    expect(screen.getByRole("status")).toHaveTextContent("No current figures are available.");
    expect(screen.getByRole("button", { name: "Retry figures" })).toBeInTheDocument();
    expect(screen.queryByText(/until the server|make up-d|API/i)).not.toBeInTheDocument();
    expect(useSystemStatus).not.toHaveBeenCalled();
  });
});
