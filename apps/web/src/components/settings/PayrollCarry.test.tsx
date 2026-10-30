import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({ ...mocks, getErrorMessage: (error: Error) => error.message }));
import PayrollCarry from "./PayrollCarry";

const balance = {
  staffId: "departed",
  carryForward: [{ componentKey: "old", base: "-10.0000", units: "-1.0000" }],
  fallbackCarryCommission: "-12.1234567890",
};
const view = () => ({
  periodKey: "2026-12",
  availability: "READY",
  openingEligible: true,
  openingRevision: 2,
  opening: { staff: [balance] },
  staffInventory: [{ id: "departed", name: "Amy", disabled: true }],
  balances: [{ ...balance, balanceHash: "a".repeat(64) }],
  settlements: [{ staffId: "departed", revision: 3, stale: true }],
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(view());
  mocks.post.mockResolvedValue({});
});
function mount(disabled = false) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PayrollCarry period="2026-12" disabled={disabled} />
    </QueryClientProvider>,
  );
}
async function load() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Load carry evidence" }));
  await screen.findByText("Amy (departed) — departed");
  return user;
}
async function review(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Carry authorization reason"), "Reviewed exact debt");
  await user.type(screen.getByLabelText("Carry evidence reference"), "CUTOVER-123");
  await user.click(screen.getByRole("checkbox", { name: /I reviewed/ }));
}
it("loads only on demand and never infers zero opening balances", async () => {
  mocks.get.mockResolvedValue({
    ...view(),
    availability: "UNAVAILABLE",
    balances: [],
    settlements: [],
    opening: null,
    openingRevision: 0,
  });
  mount();
  expect(mocks.get).not.toHaveBeenCalled();
  await load();
  expect(screen.getByText(/Calculation remains blocked/)).toBeInTheDocument();
  expect(screen.getByLabelText("Reviewed opening inventory (JSON)")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Authorize opening inventory" })).toBeDisabled();
});
it("submits explicit opening inventory with its authorization revision, not the close revision", async () => {
  mount();
  const user = await load();
  await user.click(screen.getByLabelText("Reviewed opening inventory (JSON)"));
  await user.paste(JSON.stringify([balance]));
  await review(user);
  await user.click(screen.getByRole("button", { name: "Authorize opening inventory" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/payroll-close/2026-12/opening", {
      expectedRevision: 2,
      staff: [balance],
      evidence: { reference: "CUTOVER-123" },
      reason: "Reviewed exact debt",
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("Recalculate payroll");
});
it("repairs stale settlements against the exact server balance hash and revision", async () => {
  mount();
  const user = await load();
  await user.selectOptions(screen.getByLabelText("Carry settlement staff"), "departed");
  expect(await screen.findByRole("alert")).toHaveTextContent("Existing settlement is stale");
  await user.selectOptions(screen.getByLabelText("Source carry component"), "old");
  await user.type(screen.getByLabelText("Destination component key"), "new");
  await user.click(screen.getByRole("checkbox", { name: /Write off exact fallback/ }));
  await review(user);
  await user.click(screen.getByRole("button", { name: "Authorize debt settlement" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/payroll-close/2026-12/settlements", {
      expectedRevision: 3,
      staffId: "departed",
      balanceHash: "a".repeat(64),
      components: [{ fromKey: "old", toKey: "new", reason: "Reviewed exact debt" }],
      fallbackWriteOff: { amount: "-12.1234567890" },
      evidence: { reference: "CUTOVER-123" },
      reason: "Reviewed exact debt",
    }),
  );
});
it("reloads conflicts, keeps the failure visible and clears confirmation on edits", async () => {
  mount();
  const user = await load();
  await user.selectOptions(screen.getByLabelText("Carry settlement staff"), "departed");
  await user.click(screen.getByRole("checkbox", { name: /Write off exact fallback/ }));
  await review(user);
  await user.type(screen.getByLabelText("Carry evidence reference"), "-changed");
  expect(screen.getByRole("checkbox", { name: /I reviewed/ })).not.toBeChecked();
  await user.click(screen.getByRole("checkbox", { name: /I reviewed/ }));
  mocks.post.mockRejectedValueOnce(new Error("Carry authorization changed. Reload before saving."));
  await user.click(screen.getByRole("button", { name: "Authorize debt settlement" }));
  expect(
    await screen.findByText("Carry authorization changed. Reload before saving."),
  ).toBeInTheDocument();
  await waitFor(() => expect(mocks.get.mock.calls.length).toBeGreaterThan(1));
});
it("cannot load or authorize while the parent close is busy", () => {
  mount(true);
  expect(screen.getByRole("button", { name: "Load carry evidence" })).toBeDisabled();
  expect(mocks.get).not.toHaveBeenCalled();
});
