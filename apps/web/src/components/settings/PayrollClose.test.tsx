import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({ ...mocks, getErrorMessage: (e: Error) => e.message }));
import PayrollClose from "./PayrollClose";

function state() {
  return {
    periodKey: "2026-09",
    revision: 4,
    status: "CALCULATED",
    adjustments: [],
    approval: null,
    payout: null,
    calculation: {
      statements: [
        {
          staff: { id: "staff", name: "Amy", disabled: true },
          payroll: {
            basicSalary: "2000.00",
            commission: "12.30",
            incentive: "0.00",
            collection: "0.0000",
            takeHome: "2012.30",
          },
        },
      ],
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(state());
  mocks.post.mockResolvedValue({});
});
function mount(isOwner = true, canWrite = true) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PayrollClose isOwner={isOwner} canWrite={canWrite} />
    </QueryClientProvider>,
  );
}
async function load() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Payroll month"), "2026-09");
  await user.click(screen.getByRole("button", { name: "Load month" }));
  await screen.findByText("Amy (departed)");
  return user;
}
it("loads explicit months and calculates using only the latest revision", async () => {
  mount();
  expect(mocks.get).not.toHaveBeenCalled();
  const user = await load();
  expect(mocks.get).toHaveBeenCalledWith("/payroll-close/2026-09");
  await user.click(screen.getByRole("button", { name: "Calculate payroll" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/payroll-close/2026-09/calculate", {
      expectedRevision: 4,
    }),
  );
});
it("requires approval reason and reloads conflicts without hiding the error", async () => {
  mount();
  const user = await load();
  await user.click(screen.getByRole("button", { name: "Approve payroll" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter a reason");
  expect(mocks.post).not.toHaveBeenCalled();
  mocks.post.mockRejectedValueOnce(
    new Error("Payroll inputs changed. Recalculate before approval."),
  );
  await user.type(screen.getByLabelText("Payroll action reason"), "Reviewed payroll");
  await user.click(screen.getByRole("button", { name: "Approve payroll" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Payroll inputs changed");
  await waitFor(() => expect(mocks.get.mock.calls.length).toBeGreaterThan(1));
});
it("managers cannot approve or record payouts; read-only users cannot mutate", async () => {
  mount(false, false);
  await load();
  expect(screen.queryByRole("button", { name: "Approve payroll" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Calculate payroll" })).not.toBeInTheDocument();
});
it("approved months are immutable and payout recording is a separate owner action", async () => {
  mocks.get.mockResolvedValue({
    ...state(),
    status: "APPROVED",
    approval: { at: "2026-10-01", reason: "Reviewed" },
  });
  mount();
  const user = await load();
  expect(screen.queryByRole("button", { name: "Calculate payroll" })).not.toBeInTheDocument();
  expect(screen.getByText("Frozen payroll statements")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Payroll action reason"), "Paid by bank");
  await user.type(screen.getByLabelText("Actual payout reference"), "BANK-123");
  await user.click(screen.getByRole("button", { name: "Record actual payout" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/payroll-close/2026-09/payout", {
      expectedRevision: 4,
      reason: "Paid by bank",
      reference: "BANK-123",
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("No funds were transferred");
});

it("adjustments carry a revision and reason but never a client actor", async () => {
  mount(false);
  const user = await load();
  expect(screen.queryByRole("button", { name: "Approve payroll" })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Adjustment staff"), "staff");
  await user.type(screen.getByLabelText("Adjustment amount"), "12.30");
  await user.type(screen.getByLabelText("Payroll action reason"), "Approved overtime correction");
  await user.click(screen.getByRole("button", { name: "Add adjustment" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/payroll-close/2026-09/adjustments", {
      expectedRevision: 4,
      adjustment: {
        id: expect.any(String),
        staffId: "staff",
        kind: "ADDITION",
        amount: "12.30",
        reason: "Approved overtime correction",
      },
    }),
  );
});

it("a confirmed payout cannot be recorded twice", async () => {
  mocks.get.mockResolvedValue({
    ...state(),
    status: "APPROVED",
    approval: { at: "2026-10-01", reason: "Reviewed" },
    payout: { at: "2026-10-02", reference: "BANK-123" },
  });
  mount();
  await load();
  expect(screen.getByText("Payout recorded: BANK-123")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Record actual payout" })).not.toBeInTheDocument();
});
