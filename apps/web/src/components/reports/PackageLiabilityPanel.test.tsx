import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import PackageLiabilityPanel from "./PackageLiabilityPanel";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({ ...mocks, getErrorMessage: (error: Error) => error.message }));
beforeEach(() => vi.resetAllMocks());
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PackageLiabilityPanel />
    </QueryClientProvider>,
  );
}
it("renders per-holding values, fixed exposure, and unavailable follow-plan evidence distinctly", async () => {
  mocks.get.mockResolvedValue({
    asOf: "2026-11-07",
    rows: [
      {
        holdingId: "holding",
        customerId: "customer",
        packageId: "package",
        sessionsRemaining: 2,
        expired: false,
        expiresAt: null,
        currency: "SGD",
        remainingNet: "6.6666",
        commissionExposure: "5.00",
      },
      {
        holdingId: "legacy",
        customerId: "customer",
        packageId: "package",
        sessionsRemaining: 1,
        expired: true,
        expiresAt: "2026-01-01",
        remainingNet: null,
        commissionExposure: null,
        reason: "Original evidence missing",
        exposureReason: "Future performer unknown",
      },
    ],
  });
  mount();
  expect(await screen.findByText("SGD 6.6666")).toBeInTheDocument();
  expect(screen.getByText("SGD 5.00")).toBeInTheDocument();
  expect(screen.getByText("Expired unused")).toBeInTheDocument();
  expect(screen.getByText("Unavailable: Future performer unknown")).toBeInTheDocument();
  expect(mocks.get).toHaveBeenCalledWith("/reports/package-liability");
});
it("handles empty holdings", async () => {
  mocks.get.mockResolvedValue({ asOf: "2026-11-07", rows: [] });
  mount();
  expect(await screen.findByText("No outstanding package sessions.")).toBeInTheDocument();
});
it("handles loading and failures without showing zero liability", async () => {
  mocks.get.mockRejectedValue(new Error("Unavailable"));
  mount();
  expect(screen.getByRole("status")).toHaveTextContent("Loading package liability");
  expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
