import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { PayrollCutoverState } from "@glampro_suite/shared";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({ get: mocks.get, getErrorMessage: (error: Error) => error.message }));
import PayrollActivationStatus from "./PayrollActivationStatus";

function state(patch: Partial<PayrollCutoverState> = {}): PayrollCutoverState {
  return {
    status: "NOT_ACTIVATED",
    revision: 0,
    effectivePeriodKey: null,
    inventoryHash: null,
    activatedAt: null,
    activatedBy: null,
    rolledBackAt: null,
    rolledBackBy: null,
    rolledBackReason: null,
    history: [],
    ...patch,
  };
}
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PayrollActivationStatus today="2026-11-08" />
    </QueryClientProvider>,
  );
}
beforeEach(() => vi.resetAllMocks());

it.each([
  [state(), /Not activated — legacy commission/],
  [
    state({ status: "ACTIVE", effectivePeriodKey: "2026-11" }),
    /Active — plan-based payroll applies from 2026-11/,
  ],
  [
    state({ status: "ACTIVE", effectivePeriodKey: "2026-12" }),
    /Scheduled — plan-based payroll starts in 2026-12/,
  ],
  [
    state({ status: "ROLLED_BACK", effectivePeriodKey: "2026-10" }),
    /Rolled back — legacy commission/,
  ],
])("shows the authoritative activation state %#", async (value, text) => {
  mocks.get.mockResolvedValue(value);
  mount();
  expect(await screen.findByText(text)).toBeInTheDocument();
  expect(mocks.get).toHaveBeenCalledWith("/payroll-cutover");
  expect(screen.getByText(/does not activate payroll or send a payment/)).toBeInTheDocument();
});

it("keeps failed status unknown and allows read-only recovery", async () => {
  mocks.get.mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValue(state());
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Do not assume payroll is inactive");
  expect(screen.queryByText(/Not activated —/)).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry activation status" }));
  expect(await screen.findByText(/Not activated —/)).toBeInTheDocument();
});

it("does not interpret a malformed response as an inactive payroll", async () => {
  mocks.get.mockResolvedValue({ earningsActive: false });
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Activation status unavailable");
  expect(screen.queryByText(/Not activated —/)).not.toBeInTheDocument();
});

it("does not announce active payroll without an effective month", async () => {
  mocks.get.mockResolvedValue(state({ status: "ACTIVE" }));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Activation status unavailable");
  expect(screen.getByText(/missing its effective month/)).toBeInTheDocument();
});

it("keeps the compact status concise without hiding the activation result", async () => {
  mocks.get.mockResolvedValue(state({ status: "ACTIVE", effectivePeriodKey: "2026-11" }));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PayrollActivationStatus today="2026-11-08" compact />
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/Active — plan-based payroll applies from 2026-11/)).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Payroll activation" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Saving, publishing or assigning/)).not.toBeInTheDocument();
});
