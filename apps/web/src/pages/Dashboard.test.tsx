import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import Dashboard from "./Dashboard";

const { useAuth, useDashboardSummary, refetch } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useDashboardSummary: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth }));
vi.mock("@/hooks/useDashboard", () => ({ useDashboardSummary }));
vi.mock("@/components/dashboard/OwnerBriefing", () => ({ default: () => <p>Owner snapshot</p> }));
vi.mock("@/components/dashboard/AssistantQuestions", () => ({
  default: () => <p>Question workspace</p>,
}));
vi.mock("@/components/dashboard/RebookingRecommendations", () => ({
  default: () => <p>Rebooking workspace</p>,
}));
vi.mock("@/components/dashboard/QuietDayOpportunities", () => ({
  default: () => <p>Opening workspace</p>,
}));

const profile = (
  role = "MANAGER",
  codes = ["dashboard", "sales", "appointments", "customers", "catalogue"],
) => ({
  user: { id: "owner", name: "Alex Lee", globalRole: role },
  tenant: { id: "salon" },
  entitlements: codes.map((code) => ({ code })),
  isReadOnly: false,
});
const summary = () => ({
  data: {
    incomeToday: "123.45",
    salesToday: 1,
    appointmentsToday: 2,
    newCustomersToday: 0,
    lowStock: 3,
  },
  isError: false,
  isPending: false,
  isFetching: false,
  refetch,
});
const mount = () =>
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue(profile());
  useDashboardSummary.mockReturnValue(summary());
});

it("shows a compact greeting, salon-local date and entitled shortcuts", () => {
  const now = new Date("2026-10-24T18:00:00Z");
  vi.useFakeTimers();
  vi.setSystemTime(now);
  try {
    mount();
    expect(screen.getByRole("heading", { name: "Welcome back, Alex" })).toBeInTheDocument();
    expect(screen.getByText(/Sunday, 25 October 2026|Sunday, October 25, 2026/)).toHaveTextContent(
      "Asia/Singapore",
    );
    expect(screen.getByRole("link", { name: "New sale" })).toHaveAttribute("href", "/sale");
    expect(screen.getByRole("link", { name: "Appointments" })).toHaveAttribute(
      "href",
      "/appointments",
    );
    const metrics = screen.getByRole("region", { name: "Today at a glance" });
    expect(within(metrics).getByText("S$123.45")).toBeInTheDocument();
    expect(within(metrics).getByText("0")).toBeInTheDocument();
    expect(within(metrics).getByText(/1 sale$/)).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it("mounts only the selected assistant and supports keyboard navigation", () => {
  mount();
  expect(screen.getByText("Question workspace")).toBeInTheDocument();
  expect(screen.queryByText("Rebooking workspace")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Rebooking" }));
  expect(screen.getByRole("tabpanel", { name: "Rebooking" })).toHaveTextContent(
    "Rebooking workspace",
  );
  expect(screen.queryByText("Question workspace")).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("tab", { name: "Rebooking" }), { key: "End" });
  expect(screen.getByRole("tab", { name: "Quiet-day openings" })).toHaveFocus();
  expect(screen.getByText("Opening workspace")).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("tab", { name: "Quiet-day openings" }), { key: "Home" });
  expect(screen.getByRole("tab", { name: "Business questions" })).toHaveFocus();
});

it.each(["STAFF", "CASHIER"])("does not expose owner tools for %s", (role) => {
  useAuth.mockReturnValue(profile(role));
  mount();
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  expect(screen.queryByText("Question workspace")).not.toBeInTheDocument();
});

it("filters shortcuts and assistant tools by entitlements", () => {
  useAuth.mockReturnValue(profile("MANAGER", ["dashboard"]));
  mount();
  expect(screen.queryByRole("navigation", { name: "Dashboard shortcuts" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("tab")).toHaveLength(1);
});

it("hides the sale shortcut in a read-only salon", () => {
  useAuth.mockReturnValue({ ...profile(), isReadOnly: true });
  mount();
  expect(screen.queryByRole("link", { name: "New sale" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Appointments" })).toBeInTheDocument();
});

it("removes active tools immediately when permissions change", () => {
  const view = mount();
  fireEvent.click(screen.getByRole("tab", { name: "Rebooking" }));
  useAuth.mockReturnValue(profile("MANAGER", ["dashboard"]));
  view.rerender(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
  expect(screen.queryByText("Rebooking workspace")).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Business questions" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

it("distinguishes loading from zero", () => {
  useDashboardSummary.mockReturnValue({
    ...summary(),
    data: undefined,
    isPending: true,
    isFetching: true,
  });
  mount();
  expect(screen.getByRole("status")).toHaveTextContent("Loading today’s figures");
  expect(screen.getAllByText("—")).toHaveLength(4);
});

it("hides cached metrics on failure and offers a retry", () => {
  useDashboardSummary.mockReturnValue({ ...summary(), isError: true });
  mount();
  expect(screen.getAllByText("—")).toHaveLength(4);
  expect(screen.queryByText("S$123.45")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry figures" }));
  expect(refetch).toHaveBeenCalledOnce();
});
