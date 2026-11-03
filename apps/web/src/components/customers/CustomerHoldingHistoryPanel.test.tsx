import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import CustomerHoldingHistoryPanel, { HoldingHistory } from "./CustomerHoldingHistoryPanel";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  entitled: true,
}));
vi.mock("@/hooks/useSettings", () => ({
  useModules: () => ({
    data: [{ code: "packages", entitled: mocks.entitled }],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/contexts/SalonFormattingContext", () => ({
  useSalonFormatting: () => ({
    formatPrice: (value: string | number) => `S$${value}`,
    formatDate: (value: string) => value.slice(0, 10),
  }),
}));
vi.mock("@/lib/api", () => ({
  get: mocks.get,
  getErrorMessage: (error: Error) => error?.message ?? "Request failed",
}));

const REPORT = {
  customerId: "c1",
  asOf: "2026-11-03T04:00:00.000Z",
  active: {
    holdings: 1,
    sessionsRemaining: 2,
    net: "181.50",
    originalTax: "18.50",
    gross: "200.00",
  },
  expired: {
    holdings: 1,
    sessionsRemaining: 2,
    net: "181.50",
    originalTax: "18.50",
    gross: "200.00",
  },
  credit: {
    active: { holdings: 1, remaining: "42.50" },
    expired: { holdings: 0, remaining: "0.00" },
  },
  unvalued: {
    active: { holdings: 1, sessionsRemaining: 3 },
    expired: { holdings: 0, sessionsRemaining: 0 },
  },
  receivable: { sales: 1, holdings: 1, sourceSaleOutstanding: "100.00" },
  holdings: [
    {
      holdingId: "h1",
      kind: "SESSIONS" as const,
      name: "Aloha Bundle",
      status: "ACTIVE" as const,
      purchasedAt: "2026-10-01T02:00:00.000Z",
      saleId: "sale-1",
      expiresAt: null,
      sessions: { granted: 4, remaining: 2 },
      credit: null,
      value: { net: "181.50", originalTax: "18.50", gross: "200.00" },
      payments: [
        {
          id: "p1",
          occurredAt: "2026-10-01T03:00:00.000Z",
          grossCents: "30000",
          netCents: "27225",
          taxCents: "2775",
        },
      ],
      usage: [
        {
          id: "u1",
          itemType: "PACKAGE" as const,
          saleId: "sale-2",
          quantity: 1,
          amount: null,
          usedAt: "2026-10-05T02:00:00.000Z",
          revertedAt: "2026-10-07T02:00:00.000Z",
        },
      ],
      missingEvidence: [],
    },
    {
      holdingId: "h2",
      kind: "SESSIONS" as const,
      name: "Legacy Wallet",
      status: "EXPIRED" as const,
      purchasedAt: null,
      saleId: null,
      expiresAt: "2020-01-01T00:00:00.000Z",
      sessions: { granted: 3, remaining: 3 },
      credit: null,
      value: null,
      payments: [],
      usage: [],
      missingEvidence: ["ORIGINAL_PURCHASE_EVIDENCE"],
    },
  ],
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CustomerHoldingHistoryPanel customerId="c1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.entitled = true;
  mocks.get.mockResolvedValue(REPORT);
});

it("keeps unused value, expired value, credit and receivables apart", async () => {
  setup();
  expect(await screen.findByText("Package and credit history")).toBeInTheDocument();
  expect(await screen.findByText("Unused session value")).toBeInTheDocument();
  expect(screen.getAllByText("S$200.00").length).toBe(2);
  expect(screen.getByText("Expired unused value")).toBeInTheDocument();
  expect(screen.getByText("Unused credit")).toBeInTheDocument();
  expect(screen.getByText("S$42.50")).toBeInTheDocument();
  expect(screen.getByText("Owed on these sales")).toBeInTheDocument();
  expect(screen.getByText("S$100.00")).toBeInTheDocument();
  expect(screen.getByText(/1 holding have no purchase valuation evidence/)).toBeInTheDocument();
  expect(mocks.get).toHaveBeenCalledWith("/customers/c1/holding-history");
});

it("shows payments, usage and a legacy row without invented money", async () => {
  setup();
  expect(await screen.findByText(/S\$272\.25 net/)).toBeInTheDocument();
  expect(screen.getByText(/S\$300\.00 gross/)).toBeInTheDocument();
  expect(screen.getByText(/reversed 2026-10-07/)).toBeInTheDocument();
  expect(
    screen.getByText(/No purchase valuation evidence; sessions counted, value not claimed/),
  ).toBeInTheDocument();
  expect(screen.getByText(/Missing evidence: ORIGINAL_PURCHASE_EVIDENCE/)).toBeInTheDocument();
});

it("surfaces a failed report instead of zeros", async () => {
  mocks.get.mockRejectedValue(new Error("Package valuation evidence does not reconcile."));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HoldingHistory customerId="c1" />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("does not reconcile");
  expect(screen.queryByText("Unused session value")).not.toBeInTheDocument();
});

it("stays out of the way when the packages module is not entitled", () => {
  mocks.entitled = false;
  setup();
  expect(screen.queryByText("Package and credit history")).not.toBeInTheDocument();
  expect(mocks.get).not.toHaveBeenCalled();
});
