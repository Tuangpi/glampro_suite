import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import CustomerPackagesTab from "./CustomerPackagesTab";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  post: vi.fn(),
  entitled: true,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { globalRole: "MANAGER" }, isReadOnly: false }),
}));
vi.mock("@/hooks/useSettings", () => ({
  useModules: () => ({
    data: [{ code: "packages", entitled: mocks.entitled }],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/api", () => ({
  get: mocks.get,
  getPaginated: mocks.list,
  post: mocks.post,
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
      payments: [],
      usage: [],
      missingEvidence: [],
    },
  ],
};
const SESSIONS = {
  id: "s1",
  customerId: "c1",
  name: "Bridal Sessions",
  quantityRemaining: 2,
  expiresAt: null,
  updatedAt: "2026-10-23T01:00:00.000Z",
};
const CREDIT = {
  id: "h1",
  customerId: "c1",
  name: "Wallet",
  amountRemaining: "75.00",
  expiresAt: null,
  sharedFamilyId: null,
  updatedAt: "2026-10-23T01:00:00.000Z",
};

const listPaths = () => mocks.list.mock.calls.map((call) => call[0] as string);
const getPaths = () => mocks.get.mock.calls.map((call) => call[0] as string);

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CustomerPackagesTab customerId="c1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.entitled = true;
  mocks.get.mockImplementation(async (path: string) => {
    if (path.endsWith("/holding-history")) return REPORT;
    if (path.endsWith("/prepaid-family")) return null;
    throw new Error(`unexpected read ${path}`);
  });
  mocks.list.mockImplementation(async (path: string) => {
    if (path.endsWith("/session-packages")) return { data: [SESSIONS], total: 1, pageCount: 1 };
    if (path.endsWith("/prepaid")) return { data: [CREDIT], total: 1, pageCount: 1 };
    return { data: [], total: 0, pageCount: 1 };
  });
});

it("opens on the balances it must show and nothing from the audit trail", async () => {
  setup();
  expect(await screen.findByText("Unused session value")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "Transfer Wallet" })).toBeEnabled();
  expect(await screen.findByRole("button", { name: "Transfer Bridal Sessions" })).toBeEnabled();
  await waitFor(() => expect(getPaths()).toContain("/customers/c1/prepaid-family"));
  expect(getPaths().sort()).toEqual([
    "/customers/c1/holding-history",
    "/customers/c1/prepaid-family",
  ]);
  expect(new Set(listPaths())).toEqual(
    new Set(["/customers/c1/prepaid", "/customers/c1/session-packages"]),
  );
});

it("reads the audit trail only when its own disclosure is opened", async () => {
  setup();
  await screen.findByText("Unused session value");
  expect(listPaths()).not.toContain("/customers/c1/prepaid-balance-history");
  await userEvent.click(screen.getByText("Credit balance audit"));
  await waitFor(() =>
    expect(mocks.list).toHaveBeenCalledWith("/customers/c1/prepaid-balance-history", {
      page: 1,
      pageSize: 10,
    }),
  );
  expect(await screen.findByText("No balance events recorded.")).toBeInTheDocument();
  expect(listPaths()).not.toContain("/customers/c1/prepaid-family-history");
});

it("fetches both transfer lists behind the one disclosure that names them", async () => {
  setup();
  await screen.findByText("Unused session value");
  expect(listPaths()).not.toContain("/customers/c1/prepaid-transfers");
  await userEvent.click(screen.getByText("Transfers between customers"));
  await waitFor(() =>
    expect(mocks.list).toHaveBeenCalledWith("/customers/c1/prepaid-transfers", {
      page: 1,
      pageSize: 10,
    }),
  );
  await waitFor(() =>
    expect(mocks.list).toHaveBeenCalledWith("/customers/c1/session-package-transfers", {
      page: 1,
      pageSize: 10,
    }),
  );
});

it("shows the per-holding evidence through the report the figures already read", async () => {
  setup();
  await screen.findByText("Unused session value");
  await userEvent.click(screen.getByText("Every holding, bought and used"));
  expect(await screen.findByText("Aloha Bundle")).toBeInTheDocument();
  // One read, shared: opening the evidence costs no second request.
  expect(getPaths().filter((path) => path.endsWith("/holding-history"))).toHaveLength(1);
});

it("names each holding once, on the row that can act on it", async () => {
  setup();
  expect(await screen.findByText(/75\.00 left/)).toHaveTextContent("Private");
  expect(screen.getByText("Prepaid credit")).toBeInTheDocument();
  expect(screen.getByText("Session packages")).toBeInTheDocument();
  expect(screen.getByText(/2 sessions left/)).toBeInTheDocument();
  expect(screen.getAllByText("Wallet")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Share Wallet" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Purchase & payments for Wallet" })).toBeEnabled();
});

it("says the add-on is off instead of drawing empty cards", async () => {
  mocks.entitled = false;
  setup();
  expect(screen.getByText("The packages add-on is not enabled")).toBeInTheDocument();
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.list).not.toHaveBeenCalled();
});
