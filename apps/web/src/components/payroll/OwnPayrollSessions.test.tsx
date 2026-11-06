import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import OwnPayrollSessions from "./OwnPayrollSessions";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({ get: mocks.get, getErrorMessage: (error: Error) => error.message }));
beforeEach(() => vi.resetAllMocks());
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <OwnPayrollSessions period="2026-11" />
    </QueryClientProvider>,
  );
}
it("renders only a self-scoped session answer", async () => {
  mocks.get.mockResolvedValue({ scope: "SALON", total: 1, pages: 1, rows: [{ id: "other" }] });
  mount();
  expect(await screen.findByText("Own session evidence unavailable.")).toBeInTheDocument();
  expect(screen.queryByText("other")).not.toBeInTheDocument();
});
it("shows void state and the caller's share without salary or customer identity", async () => {
  mocks.get.mockResolvedValue({
    scope: "SELF",
    total: 1,
    pages: 1,
    evidence: "Recorded only",
    rows: [
      {
        id: "session",
        usedAt: "2026-11-06",
        packageId: "package",
        quantity: 2,
        share: 5000,
        status: "VOIDED",
      },
    ],
  });
  mount();
  expect(await screen.findByText(/your share 50% · VOIDED/)).toBeInTheDocument();
  expect(mocks.get).toHaveBeenCalledWith("/payroll-close/my-sessions", {
    period: "2026-11",
    page: 1,
  });
});
