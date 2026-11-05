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
const money = "S$100.01 paid · S$5.25 refunded · S$94.76 net paid";
const mix = "3 completed receipts · S$33.34 average · 2 new customers";
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

it.each(["SUPER_ADMIN", "MANAGER"])("shows the facts and entitled checks for %s", (role) => {
  useAuth.mockReturnValue(profile(role));
  mount();
  expect(screen.getByRole("heading", { name: "Owner briefing" })).toBeInTheDocument();
  expect(screen.getByText(money)).toBeInTheDocument();
  expect(screen.getByText(mix)).toBeInTheDocument();
  expect(screen.getByText(/Refunds can relate to sales made earlier/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Review refunds" })).toHaveAttribute("href", "/reports");
  expect(screen.getByRole("link", { name: "Open products" })).toHaveAttribute("href", "/products");
  expect(screen.getByText(/1 product is at or below the stock threshold of 4/)).toBeInTheDocument();
});

it("carries no evidence drawer and no send, approve or activate control", () => {
  mount();
  expect(screen.queryByRole("button", { name: "View briefing evidence" })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /send|approve|activate/i })).not.toBeInTheDocument();
  // The definitions moved to Reports and Business questions; the panel states
  // the one qualification that changes how a paid amount reads.
  expect(screen.getByText(/not cash-only takings or profit/)).toBeVisible();
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

it("drops the figures when the role is revoked on rerender", () => {
  const view = mount();
  expect(screen.getByText(/S\$100\.01/)).toBeInTheDocument();
  useAuth.mockReturnValue(profile("STAFF"));
  view.rerender(
    <MemoryRouter>
      <OwnerBriefing />
    </MemoryRouter>,
  );
  expect(screen.queryByText(/S\$100\.01/)).not.toBeInTheDocument();
  expect(screen.queryByText(/at or below the stock threshold/)).not.toBeInTheDocument();
});

it("hides unentitled links while keeping the figures and their checks", () => {
  useAuth.mockReturnValue(profile("MANAGER", ["dashboard"]));
  mount();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getByText(money)).toBeInTheDocument();
  expect(screen.getByText(/Refunds can relate to sales made earlier/)).toBeInTheDocument();
  expect(screen.getByText(/1 product is at or below the stock threshold of 4/)).toBeInTheDocument();
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
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent("Showing the last successful snapshot");
  expect(screen.getByText(money)).toBeInTheDocument();
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
  expect(screen.queryByText(/S\$94\.76/)).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("shows a genuine empty period without inferred opportunities", () => {
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
  expect(screen.getByText(/^No completed sales in this period/)).toBeInTheDocument();
  expect(screen.getByText("0 completed receipts · S$0.00 average · 0 new customers")).toBeVisible();
  expect(screen.queryByText(/Refunds can relate/)).not.toBeInTheDocument();
  expect(screen.queryByText(/stock threshold/)).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("singularizes a one-product check and a one-receipt day", () => {
  useOwnerBriefing.mockReturnValue({
    ...snapshot(),
    data: { ...facts, salesToday: 1, newCustomersToday: 1, averageTicket: "100.01" },
  });
  mount();
  expect(screen.getByText("1 completed receipt · S$100.01 average · 1 new customer")).toBeVisible();
  expect(screen.getByText(/1 product is at or below the stock threshold of 4/)).toBeInTheDocument();
});

it("puts the exact reporting window on demand and nothing else behind it", () => {
  mount();
  const toggle = screen.getByText("Reporting window");
  const details = toggle.closest("details")!;
  expect(details).not.toHaveAttribute("open");
  fireEvent.click(toggle);
  expect(details).toHaveAttribute("open");
  expect(within(details).getByText(/end excluded/)).toBeVisible();
  // No definitions list: what the interval means lives in Reports, by asking in
  // Business questions, or in the one qualification line above.
  expect(details.querySelectorAll("dt")).toHaveLength(0);
});
