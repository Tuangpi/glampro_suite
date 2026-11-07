import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import PackageCommissionRules from "./PackageCommissionRules";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({ ...mocks, getErrorMessage: (error: Error) => error.message }));

function mount(packageId: string | null = "package") {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PackageCommissionRules packageId={packageId} />
    </QueryClientProvider>,
  );
}
beforeEach(() => vi.resetAllMocks());
it("shows current and scheduled package rates with effective dates and reasons, never unrelated history", async () => {
  const rule = {
    id: "current",
    scope: "PACKAGE",
    targetId: "package",
    itemKind: "PACKAGE_SALE",
    rate: "5",
    effectiveAt: "2026-11-01T00:00:00Z",
    reason: "Reviewed package margin",
  };
  mocks.get.mockResolvedValue({
    current: [rule, { ...rule, id: "other", targetId: "other", reason: "Unrelated package" }],
    scheduled: [
      {
        ...rule,
        id: "future",
        rate: null,
        effectiveAt: "2026-12-01T00:00:00Z",
        reason: "Restore inheritance",
      },
    ],
    history: [{ ...rule, reason: "Old superseded rate" }],
  });
  mount();
  expect(await screen.findByText(/Current · Package sales · 5%/)).toHaveTextContent(
    "Reviewed package margin",
  );
  expect(screen.getByText(/Scheduled/)).toHaveTextContent("Inherit");
  expect(screen.queryByText(/Unrelated package|Old superseded rate/)).not.toBeInTheDocument();
  expect(screen.getByRole("link")).toHaveAttribute("href", "/settings?section=team&team=rules");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(mocks.get).toHaveBeenCalledWith("/commissions", { page: 1 });
});
it("does not request rules for an unsaved package", () => {
  mount(null);
  expect(screen.getByText(/Save this package/)).toBeInTheDocument();
  expect(mocks.get).not.toHaveBeenCalled();
});
it("distinguishes missing overrides from an unavailable configuration", async () => {
  mocks.get.mockResolvedValue({ current: [], scheduled: [] });
  mount();
  expect(await screen.findByText(/No company percentage override/)).toBeInTheDocument();
});
it("fails closed instead of claiming no override when the configuration request fails", async () => {
  mocks.get.mockRejectedValue(new Error("Permission changed"));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Permission changed");
  expect(screen.queryByText(/No company percentage override/)).not.toBeInTheDocument();
});
