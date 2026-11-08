import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({ ...mocks, getErrorMessage: (e: Error) => e.message }));
vi.mock("./OwnPayrollSessions", () => ({ default: () => <p>Own recorded sessions</p> }));
import PayrollProgress from "./PayrollProgress";

/** A calculated, unapproved month: real figures, but an estimate. */
function estimated() {
  return {
    periodKey: "2026-09",
    status: "CALCULATED",
    estimated: true,
    basis: "ESTIMATED",
    scope: "SALON",
    calculation: {
      version: "cp-005-v2",
      inputHash: "abcdef1234567890",
      calculatedAt: "2026-10-01T00:10:00.000Z",
    },
    approval: null,
    currency: "SGD",
    timeZone: "Asia/Singapore",
    startsAt: "2026-08-31T16:00:00.000Z",
    endsAt: "2026-09-30T16:00:00.000Z",
    rows: [
      {
        staff: { id: "staff-a", name: "Alice Tan", disabled: false },
        planId: "plan",
        planName: "Service plan",
        stageKey: "junior",
        stageName: "Junior stylist",
        tenureMonth: 3,
        mainComponent: "Service tier",
        mainBase: "4000.0000",
        currentRate: "5",
        nextThreshold: "5000.0000",
        gapToNext: "1000.0001",
        commission: "200.00",
        incentive: "0.00",
        estimate: "200.00",
        lines: 1,
        baseAmount: "4000.0000",
        units: "2.0000",
        components: [],
      },
    ],
    totals: {
      staff: 1,
      lines: 1,
      baseAmount: "4000.0000",
      units: "2.0000",
      commission: "200.00",
      incentive: "0.00",
      estimate: "200.00",
    },
  };
}

function frozen() {
  return {
    ...estimated(),
    status: "APPROVED",
    estimated: false,
    basis: "APPROVED",
    approval: { at: "2026-10-02T02:00:00.000Z" },
  };
}

it("shows own base activity by type without pretending pooled commission is per-type money", async () => {
  mocks.get.mockResolvedValue({
    ...estimated(),
    scope: "SELF",
    rows: [
      {
        ...estimated().rows[0],
        activity: [{ commissionType: "PKG_RED", baseAmount: "100.0000", units: "2.0000" }],
      },
    ],
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <PayrollProgress selfOnly />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    await screen.findByRole("table", { name: "Your activity by commission type" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "PKG_RED" })).toBeInTheDocument();
  expect(screen.getByText(/not live session attendance/)).toBeInTheDocument();
});

function uncalculated() {
  return {
    ...estimated(),
    status: "OPEN",
    basis: "NOT_CALCULATED",
    calculation: null,
    currency: null,
    timeZone: null,
    startsAt: null,
    endsAt: null,
    rows: [],
    totals: {
      staff: 0,
      lines: 0,
      baseAmount: "0.0000",
      units: "0.0000",
      commission: "0.00",
      incentive: "0.00",
      estimate: "0.00",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(estimated());
});

function mount(element: React.ReactElement = <PayrollProgress period="2026-09" />) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
}

it("labels a calculated but unapproved month as an estimate and names the snapshot", async () => {
  mount();
  expect(await screen.findByText("Alice Tan")).toBeInTheDocument();
  expect(screen.getByText("Estimated")).toBeInTheDocument();
  expect(mocks.get).toHaveBeenCalledWith("/payroll-close/progress", { period: "2026-09" });
  expect(screen.getByText(/calculation taken 2026-10-01T00:10:00.000Z/)).toBeInTheDocument();
  expect(screen.getByText("Month-to-date commission progress for 2026-09")).toBeInTheDocument();
  expect(screen.getByText("Service plan")).toBeInTheDocument();
  expect(screen.getByText("Junior stylist · month 3")).toBeInTheDocument();
  // The base appears once for the row and once in the totals footer, unchanged in both.
  expect(screen.getAllByText("4000.0000")).toHaveLength(2);
  expect(screen.getByText("5%")).toBeInTheDocument();
  expect(screen.getByText("1000.0001")).toBeInTheDocument();
  expect(screen.queryByText("Frozen")).not.toBeInTheDocument();
  expect(screen.getByText(/not recalculated here/)).toBeInTheDocument();
});

it("labels an approved month frozen and points at the report and exports", async () => {
  mocks.get.mockResolvedValue(frozen());
  mount();
  expect(await screen.findByText("Frozen")).toBeInTheDocument();
  expect(screen.getByText(/match the frozen period report and exports/)).toBeInTheDocument();
  expect(screen.queryByText("Estimated")).not.toBeInTheDocument();
});

it("shows no invented figure for a month nobody has calculated", async () => {
  mocks.get.mockResolvedValue(uncalculated());
  mount();
  expect(
    await screen.findByText(/No payroll has been calculated for 2026-09 yet/),
  ).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByText("Not calculated")).toBeInTheDocument();
  expect(screen.queryByText("Estimated")).not.toBeInTheDocument();
  expect(screen.queryByText(/No staff statement is part/)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Payroll close for 2026-09" })).toHaveAttribute(
    "href",
    "/settings?section=payroll&payroll=close&period=2026-09",
  );
});

it("does not offer management navigation on a self-service progress card", async () => {
  mocks.get.mockResolvedValue({ ...uncalculated(), scope: "SELF" });
  mount(<PayrollProgress selfOnly />);
  await screen.findByText("Not calculated");
  expect(screen.queryByRole("link", { name: /Open Payroll close/ })).not.toBeInTheDocument();
});

it("refreshes the saved projection without calculating payroll", async () => {
  mount();
  await screen.findByText("Alice Tan");
  mocks.get.mockResolvedValue(frozen());
  await userEvent.click(screen.getByRole("button", { name: "Refresh saved results" }));
  await screen.findByText("Frozen");
  await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
  expect(mocks.get.mock.calls.every(([url]) => url === "/payroll-close/progress")).toBe(true);
});

it("renders one staff member's own line as a compact panel", async () => {
  mocks.get.mockResolvedValue({ ...estimated(), scope: "SELF" });
  mount(<PayrollProgress selfOnly compact title="Your commission progress" />);
  expect(await screen.findByText("Base month to date (Service tier)")).toBeInTheDocument();
  expect(screen.getByText("Your commission progress")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByText("To next band")).toBeInTheDocument();
  expect(screen.getByText("Estimated commission")).toBeInTheDocument();
  expect(screen.getByText("1000.0001")).toBeInTheDocument();
  expect(screen.queryByText("Own recorded sessions")).not.toBeInTheDocument();
});

it("allows My earnings to show sessions in compact mode without accepting a salon response", async () => {
  mocks.get.mockResolvedValue({ ...estimated(), scope: "SELF" });
  mount(<PayrollProgress selfOnly compact showSessions />);
  expect(await screen.findByText("Own recorded sessions")).toBeInTheDocument();
});

it("does not mount self-service sessions for a salon-scoped progress response", async () => {
  mocks.get.mockResolvedValue(estimated());
  mount(<PayrollProgress selfOnly compact showSessions />);
  await screen.findByText("September 2026 · SGD");
  expect(screen.queryByText("Own recorded sessions")).not.toBeInTheDocument();
});

it("keeps the earnings dashboard empty state short without inventing zero earnings", async () => {
  mocks.get.mockResolvedValue({ ...uncalculated(), scope: "SELF" });
  mount(<PayrollProgress selfOnly compact showSessions title="This month" />);
  expect(await screen.findByText("Not calculated")).toBeInTheDocument();
  expect(screen.getByText("September 2026 · SGD")).toBeInTheDocument();
  expect(screen.getByText(/Commission appears after your manager/)).toBeInTheDocument();
  expect(screen.queryByText(/No payroll statement/)).not.toBeInTheDocument();
  expect(screen.queryByText("0.00")).not.toBeInTheDocument();
  expect(screen.queryByText("Estimated")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
  expect(mocks.get.mock.calls.every(([url]) => url === "/payroll-close/progress")).toBe(true);
});

it("highlights approved earnings without calling them an estimate", async () => {
  mocks.get.mockResolvedValue({ ...frozen(), scope: "SELF" });
  mount(<PayrollProgress selfOnly compact showSessions />);
  expect(await screen.findByText("Approved")).toBeInTheDocument();
  expect(screen.getByText("Approved commission")).toBeInTheDocument();
  expect(screen.getByText("200.00")).toBeInTheDocument();
  expect(screen.queryByText("Estimated commission")).not.toBeInTheDocument();
  const summary = screen.getByText("Calculation details");
  expect(summary.closest("details")).not.toHaveAttribute("open");
  await userEvent.click(summary);
  expect(screen.getByText(/Approved 2026-10-02/)).toBeVisible();
});

it("says so when the caller has no statement in the month", async () => {
  mocks.get.mockResolvedValue({ ...estimated(), scope: "SELF", rows: [] });
  mount(<PayrollProgress selfOnly compact />);
  expect(await screen.findByText("No payroll statement for you in 2026-09.")).toBeInTheDocument();
});

it("asks the server to narrow a self-service read instead of trusting the prop", async () => {
  mocks.get.mockResolvedValue({ ...estimated(), scope: "SELF" });
  mount(<PayrollProgress selfOnly compact period="2026-09" />);
  expect(await screen.findByText("Base month to date (Service tier)")).toBeInTheDocument();
  // The scope is the server's decision, so the request has to say so: the query key alone
  // never left the browser, which is how a colleague's figures could appear as "yours".
  expect(mocks.get).toHaveBeenCalledWith("/payroll-close/progress", {
    period: "2026-09",
    scope: "SELF",
  });
});

it("shows nothing when a self read comes back with the salon table", async () => {
  // A salon-scoped body under a "Your …" heading is the bug this card exists to avoid.
  mocks.get.mockResolvedValue(estimated());
  mount(<PayrollProgress selfOnly compact />);
  expect(await screen.findByText("No payroll statement for you in 2026-09.")).toBeInTheDocument();
  expect(screen.queryByText("Alice Tan")).not.toBeInTheDocument();
  expect(screen.queryByText("Base month to date (Service tier)")).not.toBeInTheDocument();
});

it("reads the current month when no period is given", async () => {
  mount(<PayrollProgress />);
  await screen.findByText("Estimated");
  expect(mocks.get).toHaveBeenCalledWith("/payroll-close/progress", undefined);
});

it("surfaces a refusal instead of an empty table", async () => {
  mocks.get.mockRejectedValue(new Error("Payroll progress is not available to this account."));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Payroll progress is not available to this account.",
  );
});
