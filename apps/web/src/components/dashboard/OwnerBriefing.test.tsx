import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import OwnerBriefing from "./OwnerBriefing";

const { useAuth, useOwnerBriefing } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useOwnerBriefing: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth }));
vi.mock("@/hooks/useOwnerBriefing", () => ({ useOwnerBriefing }));
const facts = {
  incomeToday: "100.01",
  completedSalePaid: "100.01",
  refundsToday: "5.25",
  netPaid: "94.76",
  salesToday: 3,
  averageTicket: "33.34",
  appointmentsToday: 8,
  newCustomersToday: 2,
  lowStockCount: 1,
  lowStockThreshold: 4,
  timeZone: "Asia/Singapore",
  from: "2026-10-23T16:00:00.000Z",
  to: "2026-10-24T16:00:00.000Z",
  asOf: "2026-10-23T17:00:00.000Z",
};
const profile = (
  role = "SUPER_ADMIN",
  codes = ["dashboard", "reports", "catalogue", "appointments", "customers"],
) => ({
  user: { id: "owner", globalRole: role },
  tenant: { id: "salon" },
  entitlements: codes.map((code) => ({ code })),
});
const snapshot = () => ({
  data: facts,
  isError: false,
  isFetching: false,
  isStale: false,
  error: null,
  refetch: vi.fn(),
});
const mount = () =>
  render(
    <MemoryRouter>
      <OwnerBriefing />
    </MemoryRouter>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue(profile());
  useOwnerBriefing.mockReturnValue(snapshot());
});

it.each(["SUPER_ADMIN", "MANAGER"])("shows factual checks and evidence for %s", (role) => {
  useAuth.mockReturnValue(profile(role));
  mount();
  expect(screen.getByRole("heading", { name: "Owner briefing" })).toBeInTheDocument();
  expect(screen.getByText(/3 completed receipts recorded S\$100.01/)).toHaveTextContent("S$94.76");
  expect(screen.getByRole("link", { name: "Open reports" })).toHaveAttribute("href", "/reports");
  expect(screen.getByRole("link", { name: "Open products" })).toHaveAttribute("href", "/products");
  expect(screen.getByRole("link", { name: "Open appointments" })).toHaveAttribute(
    "href",
    "/appointments",
  );
  fireEvent.click(screen.getByRole("button", { name: "View briefing evidence" }));
  const dialog = screen.getByRole("dialog", { name: "Briefing evidence" });
  expect(within(dialog).getByText(/2026-10-23T16:00:00.000Z/)).toBeInTheDocument();
  expect(within(dialog).getByText(/regardless of the original sale date/)).toBeInTheDocument();
  expect(within(dialog).getByRole("link", { name: "Customers source screen" })).toHaveAttribute(
    "href",
    "/customers",
  );
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it.each(["STAFF", "CASHIER"])("does not mount a query for %s", (role) => {
  useAuth.mockReturnValue(profile(role));
  mount();
  expect(useOwnerBriefing).not.toHaveBeenCalled();
  expect(screen.queryByText("Owner briefing")).not.toBeInTheDocument();
});

it("hides the briefing with missing identity or dashboard entitlement", () => {
  useAuth.mockReturnValue(profile("MANAGER", []));
  const view = mount();
  expect(useOwnerBriefing).not.toHaveBeenCalled();
  useAuth.mockReturnValue({ ...profile(), tenant: null });
  view.rerender(
    <MemoryRouter>
      <OwnerBriefing />
    </MemoryRouter>,
  );
  expect(useOwnerBriefing).not.toHaveBeenCalled();
});

it("removes an open workspace immediately on role loss", () => {
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "View briefing evidence" }));
  useAuth.mockReturnValue(profile("STAFF"));
  view.rerender(
    <MemoryRouter>
      <OwnerBriefing />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText(/S\$100.01/)).not.toBeInTheDocument();
});

it("hides unentitled source links while keeping available metrics", () => {
  useAuth.mockReturnValue(profile("MANAGER", ["dashboard"]));
  mount();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getByText(/No suggested checks/)).toBeInTheDocument();
  expect(screen.getByText(/Net paid after refunds/)).toBeInTheDocument();
});

it("distinguishes loading and errors from zero and offers retry", () => {
  useOwnerBriefing.mockReturnValue({ ...snapshot(), data: undefined });
  const view = mount();
  expect(screen.getByRole("status")).toHaveTextContent("Loading owner briefing");
  expect(screen.queryByText(/S\$/)).not.toBeInTheDocument();
  const retry = vi.fn();
  useOwnerBriefing.mockReturnValue({
    ...snapshot(),
    data: undefined,
    isError: true,
    refetch: retry,
  });
  view.rerender(
    <MemoryRouter>
      <OwnerBriefing />
    </MemoryRouter>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("No figures are available");
  fireEvent.click(screen.getByRole("button", { name: "Retry briefing" }));
  expect(retry).toHaveBeenCalledOnce();
});

it("keeps a labelled last-successful snapshot on refresh failure", () => {
  useOwnerBriefing.mockReturnValue({ ...snapshot(), isError: true, isStale: true });
  mount();
  expect(screen.getByText(/Showing the last successful snapshot/)).toBeInTheDocument();
  expect(screen.getByText(/Refresh before acting/)).toBeInTheDocument();
  expect(screen.getByText(/Net paid after refunds/)).toBeInTheDocument();
});

it("suppresses cached figures after an authorization refusal", () => {
  useOwnerBriefing.mockReturnValue({
    ...snapshot(),
    isError: true,
    error: { response: { status: 403 } },
  });
  mount();
  expect(screen.getByRole("status")).toHaveTextContent(
    "access to this briefing is no longer available",
  );
  expect(screen.queryByText(/Net paid after refunds/)).not.toBeInTheDocument();
});

it("shows a genuine empty period without inferred opportunities or send controls", () => {
  useOwnerBriefing.mockReturnValue({
    ...snapshot(),
    data: {
      ...facts,
      salesToday: 0,
      completedSalePaid: "0.00",
      refundsToday: "0.00",
      netPaid: "0.00",
      averageTicket: "0.00",
      lowStockCount: 0,
      appointmentsToday: 0,
      newCustomersToday: 0,
    },
  });
  mount();
  expect(screen.getByText(/No completed sales/)).toBeInTheDocument();
  expect(screen.getByText(/No suggested checks/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /send|approve|activate/i })).not.toBeInTheDocument();
});

it("keeps qualifications visible and puts the exact reporting window on demand", () => {
  mount();
  expect(screen.getByText(/not cash-only takings or profit/)).toBeVisible();
  const toggle = screen.getByText("Reporting window");
  const details = toggle.closest("details")!;
  expect(details).not.toHaveAttribute("open");
  fireEvent.click(toggle);
  expect(details).toHaveAttribute("open");
  expect(within(details).getByText(/end excluded/)).toBeVisible();
});
