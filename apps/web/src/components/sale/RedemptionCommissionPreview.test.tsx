import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import RedemptionCommissionPreview from "./RedemptionCommissionPreview";
const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/api", () => mocks);
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "amy", globalRole: "STAFF" } }),
}));
beforeEach(() => vi.resetAllMocks());
function mount(explicit = true) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RedemptionCommissionPreview
        holdingId="holding"
        customerId="buyer"
        quantity={2}
        shares={explicit ? [{ staffId: "amy", share: 10000 }] : undefined}
        staff={[{ id: "amy", name: "Amy" }]}
      />
    </QueryClientProvider>,
  );
}
it("shows original session economics and the conditional server award", async () => {
  mocks.post.mockResolvedValue({
    baseAmount: "66.6667",
    reason: null,
    rows: [{ staffId: "amy", amount: "8.50" }],
  });
  mount();
  expect(await screen.findByText("Amy: SGD 8.50")).toBeInTheDocument();
  expect(screen.getByText(/Original session base/)).toHaveTextContent("66.6667");
  expect(screen.getByText(/not reserved/)).toBeInTheDocument();
  expect(mocks.post).toHaveBeenCalledWith("/payroll-close/redemption-preview", {
    holdingId: "holding",
    customerId: "buyer",
    quantity: 2,
    shares: [{ staffId: "amy", share: 10000 }],
  });
});
it("never invents a performer when the tender has no explicit split", () => {
  mount(false);
  expect(screen.getByText(/explicit performers/)).toBeInTheDocument();
  expect(mocks.post).not.toHaveBeenCalled();
});
it("keeps unavailable evidence distinct from a zero award", async () => {
  mocks.post.mockResolvedValue({
    baseAmount: null,
    reason: "Funding unavailable",
    rows: [{ staffId: "amy", amount: null }],
  });
  mount();
  expect(await screen.findByText(/Amy: Unavailable/)).toBeInTheDocument();
  expect(screen.getByText("Funding unavailable")).toBeInTheDocument();
});
