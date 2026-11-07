import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import CartCommissionPreview from "./CartCommissionPreview";
import type { CartLine } from "@/hooks/useSale";

const mocks = vi.hoisted(() => ({ post: vi.fn(), role: "MANAGER", gstEnabled: false }));
vi.mock("@/lib/api", () => ({ post: mocks.post }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { globalRole: mocks.role } }),
}));
vi.mock("@/contexts/SalonFormattingContext", () => ({
  useSalonFormatting: () => ({ gstEnabled: mocks.gstEnabled }),
}));
const line: CartLine = {
  itemType: "SERVICE",
  itemId: "service",
  name: "Facial",
  price: "100",
  memberPrice: null,
  quantity: 1,
  attribution: { performers: [{ staffId: "amy", share: 10000 }] },
};
function mount(value = line) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CartCommissionPreview line={value} unitPrice="100.00" staff={[{ id: "amy", name: "Amy" }]} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.role = "MANAGER";
  mocks.gstEnabled = false;
});
it("shows the server's hypothetical plan delta, not a browser-computed rule award", async () => {
  mocks.post.mockResolvedValue({
    calculatedAt: "2026-11-01T00:00:00Z",
    rows: [{ staffId: "amy", amount: "7.25" }],
  });
  mount();
  expect(await screen.findByText("Amy: SGD 7.25")).toBeInTheDocument();
  expect(screen.getByText(/Nothing is posted/)).toBeInTheDocument();
  expect(mocks.post).toHaveBeenCalledWith(
    "/payroll-close/cart-preview",
    expect.objectContaining({
      itemType: "SERVICE",
      itemId: "service",
      shares: line.attribution?.performers,
    }),
  );
});
it("lets the server resolve GST rather than submitting a client-owned base", async () => {
  mocks.gstEnabled = true;
  mocks.post.mockResolvedValue({ calculatedAt: null, rows: [] });
  mount();
  await screen.findByText(/Nothing is posted/);
  expect(mocks.post).toHaveBeenCalledWith(
    "/payroll-close/cart-preview",
    expect.not.objectContaining({ baseAmount: expect.anything() }),
  );
});
it("requests only the server-narrowed estimate as staff", async () => {
  mocks.role = "STAFF";
  mocks.post.mockResolvedValue({ calculatedAt: null, rows: [{ staffId: "amy", amount: "1.25" }] });
  mount();
  expect(await screen.findByText("Amy: SGD 1.25")).toBeInTheDocument();
});
it("keeps attribution usable when the estimate fails", async () => {
  mocks.post.mockRejectedValue(new Error("Unavailable"));
  mount();
  expect(
    await screen.findByText("Estimate unavailable. Attribution is still saved."),
  ).toBeInTheDocument();
});
it("does not estimate a package purchase before a customer is attached", () => {
  mount({
    ...line,
    itemType: "PACKAGE",
    attribution: { sellers: [{ staffId: "amy", share: 10000 }] },
  });
  expect(screen.getByText(/Unavailable for this line/)).toBeInTheDocument();
  expect(mocks.post).not.toHaveBeenCalled();
});
