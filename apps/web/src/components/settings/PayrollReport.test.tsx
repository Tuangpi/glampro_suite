import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({ ...mocks, getErrorMessage: (e: Error) => e.message }));
import PayrollReport from "./PayrollReport";

function report() {
  return {
    periodKey: "2026-09",
    currency: "SGD",
    timeZone: "Asia/Singapore",
    calculation: { version: "3", inputHash: "abc", calculatedAt: "2026-10-01T00:10:00.000Z" },
    approval: { at: "2026-10-02T02:00:00.000Z", reason: "September payroll approved" },
    totals: {
      staff: 2,
      lines: 3,
      commission: "640.25",
      incentive: "50.00",
      collection: "3000.0000",
      baseAmount: "2400.7500",
      units: "6.0000",
    },
    staff: [
      {
        staff: { id: "staff-a", name: "Alice Tan", disabled: false },
        payroll: { commission: "590.25", incentive: "50.00", collection: "3000.0000" },
        lines: 2,
        baseAmount: "2150.5000",
        units: "3.0000",
        outlets: ["outlet-a", "outlet-b"],
        commissionTypes: ["PRD", "SVC"],
      },
      {
        staff: { id: "staff-b", name: "Bob", disabled: true },
        payroll: { commission: "50.00", incentive: "0.00", collection: "0.0000" },
        lines: 1,
        baseAmount: "250.2500",
        units: "3.0000",
        outlets: ["outlet-a"],
        commissionTypes: ["SVC"],
      },
    ],
  };
}

function linesPage(overrides: Record<string, unknown> = {}) {
  return {
    periodKey: "2026-09",
    staff: { id: "staff-a", name: "Alice Tan", disabled: false },
    lines: [
      {
        line: {
          id: "line-a-1",
          staffId: "staff-a",
          outletId: "outlet-a",
          commissionType: "SVC",
          baseAmount: "2000",
          units: "1",
          businessDate: "2026-09-05",
          status: "EARNED",
          mode: "FOLLOW_PLAN",
        },
        source: {
          sourceType: "SALE_LINE",
          sourceId: "sale-line-1",
          saleId: "sale-1",
          occurredAt: "2026-09-05T04:00:00.000Z",
        },
      },
      {
        line: {
          id: "line-a-2",
          staffId: "staff-a",
          outletId: "outlet-b",
          commissionType: "PRD",
          baseAmount: "150.50",
          units: "2",
          businessDate: "2026-09-28",
          status: "REVERSED",
          mode: "FIXED",
        },
        source: null,
      },
    ],
    total: 2,
    page: 1,
    limit: 25,
    pages: 1,
    matching: { lines: 2, baseAmount: "2150.5000", units: "3.0000" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockImplementation((url: string) =>
    Promise.resolve(url.endsWith("/lines") ? linesPage() : report()),
  );
});

function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PayrollReport period="2026-09" />
    </QueryClientProvider>,
  );
}

it("shows the frozen period totals and per-staff breakdown", async () => {
  mount();
  expect(await screen.findByText("Frozen staff breakdown for 2026-09")).toBeInTheDocument();
  expect(mocks.get).toHaveBeenCalledWith("/payroll-close/2026-09/report");
  expect(screen.getByText("2400.7500")).toBeInTheDocument();
  expect(screen.getByText("6.0000")).toBeInTheDocument();
  expect(screen.getByText("outlet-a, outlet-b")).toBeInTheDocument();
  expect(screen.getByText("Bob (departed)")).toBeInTheDocument();
  expect(screen.getByText(/never recalculated/)).toBeInTheDocument();
});

it("drills into frozen base lines with the captured source record", async () => {
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Base lines for Alice Tan" }));
  await waitFor(() =>
    expect(mocks.get).toHaveBeenCalledWith("/payroll-close/2026-09/statements/staff-a/lines", {
      limit: 25,
      page: 1,
    }),
  );
  expect(await screen.findByText("Frozen base lines for Alice Tan")).toBeInTheDocument();
  expect(screen.getByText("SALE_LINE sale-line-1 (sale sale-1)")).toBeInTheDocument();
  expect(screen.getByText("No source record")).toBeInTheDocument();
  expect(screen.getByText(/2 matching lines/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Close base lines" }));
  expect(screen.queryByText("Frozen base lines for Alice Tan")).not.toBeInTheDocument();
});

it("sends narrowing filters and paging to the server", async () => {
  mocks.get.mockImplementation((url: string) =>
    Promise.resolve(
      url.endsWith("/lines") ? linesPage({ page: 2, total: 60, pages: 3 }) : report(),
    ),
  );
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Base lines for Alice Tan" }));
  await screen.findByText("Frozen base lines for Alice Tan");

  await user.selectOptions(screen.getByLabelText("Outlet filter"), "outlet-b");
  await waitFor(() =>
    expect(mocks.get).toHaveBeenLastCalledWith("/payroll-close/2026-09/statements/staff-a/lines", {
      limit: 25,
      page: 1,
      outletId: "outlet-b",
    }),
  );
  await user.selectOptions(screen.getByLabelText("Commission type filter"), "SVC");
  await waitFor(() =>
    expect(mocks.get).toHaveBeenLastCalledWith("/payroll-close/2026-09/statements/staff-a/lines", {
      limit: 25,
      page: 1,
      outletId: "outlet-b",
      commissionType: "SVC",
    }),
  );
  expect(screen.getByText(/page 2 of 3/)).toBeInTheDocument();
});

it("surfaces a report failure instead of an empty table", async () => {
  mocks.get.mockRejectedValue(new Error("Approve payroll before reporting on frozen statements."));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Approve payroll before reporting on frozen statements.",
  );
  expect(screen.queryByText(/Frozen staff breakdown/)).not.toBeInTheDocument();
});
