import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import OwnPayrollSessions from "./OwnPayrollSessions";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({ get: mocks.get, getErrorMessage: (error: Error) => error.message }));
beforeEach(() => vi.resetAllMocks());
function mount(compact = false) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <OwnPayrollSessions period="2026-11" compact={compact} />
    </QueryClientProvider>,
  );
}
it("renders only a self-scoped session answer", async () => {
  mocks.get.mockResolvedValue({ scope: "SALON", total: 1, pages: 1, rows: [{ id: "other" }] });
  mount();
  expect(await screen.findByText("Own session evidence unavailable.")).toBeInTheDocument();
  expect(screen.queryByText("other")).not.toBeInTheDocument();
});

it("uses a short empty state without redundant headings or pagination in the dashboard", async () => {
  mocks.get.mockResolvedValue({
    scope: "SELF",
    total: 0,
    pages: 0,
    evidence: "Recorded only",
    rows: [],
  });
  mount(true);
  expect(await screen.findByText("No sessions recorded this month.")).toBeInTheDocument();
  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByText("Recorded only")).not.toBeInTheDocument();
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
