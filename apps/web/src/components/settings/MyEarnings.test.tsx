import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
const auth = vi.hoisted(() => ({ role: "STAFF" }));
vi.mock("@/lib/api", () => ({ ...mocks, getErrorMessage: (e: Error) => e.message }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "staff-a", globalRole: auth.role } }),
}));
vi.mock("@/components/payroll/PayrollProgress", () => ({
  default: ({ selfOnly }: { selfOnly?: boolean }) => (
    <section aria-label="Own progress" data-self-only={String(selfOnly)} />
  ),
}));
import MyEarnings from "./MyEarnings";

/** Two approved months for the signed-in staff member. */
function history(overrides: Record<string, unknown> = {}) {
  return {
    statements: [
      {
        periodKey: "2026-09",
        status: "APPROVED",
        approvedAt: "2026-10-02T02:00:00.000Z",
        paidAt: "2026-10-05T02:00:00.000Z",
        calculation: { version: "cp-005-v2", inputHash: "hash", calculatedAt: "2026-10-01" },
        commission: "200.00",
        incentive: "50.00",
        collection: "3000.0000",
        lines: 2,
        baseAmount: "2150.5000",
        units: "3.0000",
      },
      {
        periodKey: "2026-08",
        status: "APPROVED",
        approvedAt: "2026-09-02T02:00:00.000Z",
        paidAt: null,
        calculation: { version: "cp-005-v2", inputHash: "hash", calculatedAt: "2026-09-01" },
        commission: "120.00",
        incentive: "0.00",
        collection: "1000.0000",
        lines: 1,
        baseAmount: "1000.0000",
        units: "1.0000",
      },
    ],
    limit: 12,
    hasMore: false,
    ...overrides,
  };
}

/** The frozen single-statement projection: commission, incentive and collection only. */
function statement() {
  return {
    staff: { id: "staff-a", name: "Alice Tan", disabled: false },
    result: {
      staffId: "staff-a",
      periodKey: "2026-09",
      planId: "plan",
      versionId: "plan-v1",
      tenureMonth: 3,
      stageKey: "junior",
      components: [
        {
          componentKey: "svc",
          componentName: "Service tier",
          method: "TIER_SLICE",
          rawBase: "4000.0000",
          pooledBase: "4000.0000",
          units: "2.0000",
          bandIndex: 0,
          ratePct: "5",
          amount: "200.00",
          capped: false,
          nextThreshold: "5000.0000",
          gapToNext: "1000.0001",
          carryForwardOut: "0.0000",
          carryUnitsOut: "0.0000",
          working: [],
        },
      ],
      incentives: [],
      commissionTotal: "200.00",
      incentiveTotal: "0.00",
      carryForward: [],
      carryWriteOffs: [],
      fallbackCarryCommission: "0.00",
    },
    payroll: { commission: "200.00", incentive: "0.00", collection: "3000.0000" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "STAFF";
  mocks.get.mockImplementation((url: string) =>
    Promise.resolve(url.endsWith("/statements") ? history() : statement()),
  );
});

function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MyEarnings />
    </QueryClientProvider>,
  );
}

it("shows only the caller's own month-to-date progress", async () => {
  mount();
  const own = await screen.findByLabelText("Own progress");
  expect(own).toHaveAttribute("data-self-only", "true");
  expect(mocks.get).toHaveBeenCalledWith("/payroll-close/statements");
});

it("lists the caller's frozen months without salary columns", async () => {
  mount();
  expect(await screen.findByText("Your frozen payroll statements")).toBeInTheDocument();
  expect(screen.getByText("2026-09")).toBeInTheDocument();
  expect(screen.getByText("2026-08")).toBeInTheDocument();
  expect(screen.getByText("2150.5000")).toBeInTheDocument();
  expect(screen.getByText("pending")).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: /salary/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: /take home/i })).not.toBeInTheDocument();
});

it("opens one frozen statement and shows its components", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole("button", { name: "Open your 2026-09 statement" }));
  await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("/payroll-close/2026-09/statement"));
  expect(await screen.findByText("Service tier")).toBeInTheDocument();
  expect(screen.getByText("TIER_SLICE")).toBeInTheDocument();
  expect(screen.getByText("5%")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Close statement" }));
  expect(screen.queryByText("Service tier")).not.toBeInTheDocument();
});

it("says so when no approved month includes the caller", async () => {
  mocks.get.mockResolvedValue(history({ statements: [], hasMore: false }));
  mount();
  expect(
    await screen.findByText("No approved payroll month includes you yet."),
  ).toBeInTheDocument();
});

it("surfaces a refusal instead of an empty list", async () => {
  mocks.get.mockRejectedValue(new Error("Payroll self-service is not available to this account."));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Payroll self-service is not available to this account.",
  );
});

it("tells a cashier why there is nothing to show and asks the API for nothing", async () => {
  auth.role = "CASHIER";
  mount();
  expect(
    screen.getByText("Commission statements belong to the staff member they were calculated for."),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Own progress")).not.toBeInTheDocument();
  expect(mocks.get).not.toHaveBeenCalled();
});
