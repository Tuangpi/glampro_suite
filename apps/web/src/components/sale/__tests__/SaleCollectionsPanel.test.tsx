import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { AxiosError } from "axios";
import type { SaleCollectionState, SaleDetail } from "@glampro_suite/shared";
import SaleCollectionsPanel from "../SaleCollectionsPanel";
import { queryKeys } from "@/constants/queryKeys";

const { get, post, auth } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  auth: { readOnly: false, tenantId: "tenant-a", userId: "actor-a" },
}));
vi.mock("@/lib/api", () => ({ get, post, getErrorMessage: (cause: Error) => cause.message }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    tenant: { id: auth.tenantId },
    user: { id: auth.userId },
    isReadOnly: auth.readOnly,
  }),
}));
const sale = {
  id: "sale-a",
  status: "COMPLETED",
  refundedAt: null,
  outstandingAmount: "999.00",
} as SaleDetail;
const initial: SaleCollectionState = {
  saleId: sale.id,
  currency: "SGD",
  outstandingCents: "5900",
  canCollect: true,
  lines: [
    {
      saleLineId: "line-a",
      itemName: "Package A",
      contractedGrossCents: "10900",
      allocatedGrossCents: "5000",
    },
    {
      saleLineId: "line-b",
      itemName: "Package B",
      contractedGrossCents: "20000",
      allocatedGrossCents: "0",
    },
  ],
  payments: [],
};
const result: SaleCollectionState = {
  ...initial,
  outstandingCents: "3000",
  payments: [
    {
      collectionId: "collection-a",
      paymentId: "payment-a",
      grossCents: "2900",
      occurredAt: "2026-10-27T10:00:00Z",
      reason: "Instalment received",
      allocations: [
        { saleLineId: "line-a", grossCents: "1000" },
        { saleLineId: "line-b", grossCents: "1900" },
      ],
    },
  ],
};
function mount(value = sale) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <SaleCollectionsPanel sale={value} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}
async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Later payment amount (SGD)"), "29.00");
  await user.type(screen.getByLabelText("Allocation to line 1: Package A (SGD)"), "10.00");
  await user.type(screen.getByLabelText("Allocation to line 2: Package B (SGD)"), "19.00");
  await user.type(screen.getByLabelText("Later payment reason"), "Instalment received");
  await user.click(screen.getByLabelText(/I confirm this money/));
}
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  auth.readOnly = false;
  auth.tenantId = "tenant-a";
  auth.userId = "actor-a";
  get.mockResolvedValue(initial);
  post.mockResolvedValue(result);
});

it("requires fresh confirmation when a refetch changes the balance", async () => {
  const user = userEvent.setup();
  const { client } = mount();
  await fill(user);
  expect(screen.getByRole("button", { name: "Record later payment" })).toBeEnabled();
  await act(async () => {
    client.setQueryData(queryKeys.sale.collections("tenant-a", "actor-a", "", sale.id), {
      ...initial,
      outstandingCents: "5800",
    });
  });
  await waitFor(() => expect(screen.getByLabelText(/I confirm this money/)).not.toBeChecked());
  expect(screen.getByRole("button", { name: "Record later payment" })).toBeDisabled();
});

it("rejects a response belonging to another sale", async () => {
  get.mockResolvedValue({ ...initial, saleId: "other-sale" });
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("different sale");
  expect(screen.queryByRole("button", { name: "Record later payment" })).not.toBeInTheDocument();
});

it("uses current debt, requires explicit allocations/confirmation and posts exact cents", async () => {
  const user = userEvent.setup();
  const { client } = mount();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  expect(await screen.findByText("Current outstanding: S$59.00")).toBeVisible();
  expect(screen.queryByText(/999.00/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Allocation to line 1: Package A (SGD)")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Record later payment" })).toBeDisabled();
  await fill(user);
  await user.click(screen.getByRole("button", { name: "Record later payment" }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post).toHaveBeenCalledWith("/sales/sale-a/collections", {
    idempotencyKey: expect.any(String),
    currency: "SGD",
    collected: true,
    grossCents: "2900",
    reason: "Instalment received",
    allocations: [
      { saleLineId: "line-a", grossCents: "1000" },
      { saleLineId: "line-b", grossCents: "1900" },
    ],
  });
  expect(await screen.findByText("Current outstanding: S$30.00")).toBeVisible();
  expect(screen.getByText(/Later payment recorded/)).toBeVisible();
  expect(screen.getByLabelText("Later payment amount (SGD)")).toHaveValue("");
  expect(screen.getByText(/Instalment received/)).toBeVisible();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["customers"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["reports"] });
  expect(sessionStorage.length).toBe(0);
});

it("resets confirmation on amount, reason and allocation edits and rejects fractional cents", async () => {
  const user = userEvent.setup();
  mount();
  await fill(user);
  await user.type(screen.getByLabelText("Later payment reason"), " today");
  expect(screen.getByLabelText(/I confirm this money/)).not.toBeChecked();
  await user.click(screen.getByLabelText(/I confirm this money/));
  await user.type(screen.getByLabelText("Later payment amount (SGD)"), "1");
  expect(screen.getByRole("button", { name: "Record later payment" })).toBeDisabled();
  await user.clear(screen.getByLabelText("Later payment amount (SGD)"));
  await user.type(screen.getByLabelText("Later payment amount (SGD)"), "29.00");
  await user.click(screen.getByLabelText(/I confirm this money/));
  await user.type(screen.getByLabelText("Allocation to line 1: Package A (SGD)"), "1");
  expect(screen.getByLabelText(/I confirm this money/)).not.toBeChecked();
  await user.click(screen.getByLabelText(/I confirm this money/));
  expect(screen.getByRole("button", { name: "Record later payment" })).toBeDisabled();
  expect(post).not.toHaveBeenCalled();
});

it("blocks overcollection and allocations beyond a line cap without rounding", async () => {
  const user = userEvent.setup();
  mount();
  await fill(user);
  const amount = screen.getByLabelText("Later payment amount (SGD)");
  const a = screen.getByLabelText("Allocation to line 1: Package A (SGD)");
  const b = screen.getByLabelText("Allocation to line 2: Package B (SGD)");
  await user.clear(b);
  for (const value of ["60.00", "0", "1e2", "-1", "0.001"]) {
    await user.clear(amount);
    await user.type(amount, value);
    await user.clear(a);
    await user.type(a, value);
    await user.click(screen.getByLabelText(/I confirm this money/));
    expect(screen.getByRole("button", { name: "Record later payment" })).toBeDisabled();
  }
  expect(post).not.toHaveBeenCalled();
});

it("freezes uncertain submissions, survives remount and retries the identical request", async () => {
  post.mockRejectedValueOnce(new Error("Connection lost"));
  const user = userEvent.setup();
  const view = mount();
  await fill(user);
  await user.click(screen.getByRole("button", { name: "Record later payment" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
  const request = post.mock.calls[0]![1];
  expect(screen.queryByLabelText("Later payment amount (SGD)")).not.toBeInTheDocument();
  view.unmount();
  get.mockResolvedValue({ ...initial, canCollect: false, outstandingCents: "0" });
  mount();
  await user.click(await screen.findByRole("button", { name: "Retry recorded payment" }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(post.mock.calls[1]![1]).toEqual(request);
  expect(await screen.findByText(/Later payment recorded/)).toBeVisible();
});

it("freezes controls while sending and prevents repeat activation", async () => {
  let resolve!: (data: SaleCollectionState) => void;
  post.mockImplementation(
    () =>
      new Promise<SaleCollectionState>((done) => {
        resolve = done;
      }),
  );
  const user = userEvent.setup();
  mount();
  await fill(user);
  await user.dblClick(screen.getByRole("button", { name: "Record later payment" }));
  expect(post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Retry recorded payment" })).toBeDisabled();
  expect(screen.queryByLabelText("Later payment amount (SGD)")).not.toBeInTheDocument();
  resolve(result);
  expect(await screen.findByText(/Later payment recorded/)).toBeVisible();
});

it.each([400, 403, 409, 422])(
  "keeps refused drafts editable and refreshes the authoritative balance (%s)",
  async (status) => {
    const error = new AxiosError("Balance changed");
    error.response = { status } as typeof error.response;
    post.mockRejectedValueOnce(error);
    const user = userEvent.setup();
    mount();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Record later payment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Balance changed");
    expect(screen.getByLabelText("Later payment amount (SGD)")).toHaveValue("29.00");
    expect(screen.getByLabelText(/I confirm this money/)).not.toBeChecked();
    expect(get).toHaveBeenCalledTimes(2);
    expect(sessionStorage.length).toBe(0);
  },
);

it("closes capture after the final collection and preserves checkout snapshots", async () => {
  post.mockResolvedValue({ ...result, outstandingCents: "0", canCollect: false });
  const user = userEvent.setup();
  mount();
  await fill(user);
  await user.click(screen.getByRole("button", { name: "Record later payment" }));
  expect(await screen.findByText("Current outstanding: S$0.00")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Record later payment" })).not.toBeInTheDocument();
  expect(sale.outstandingAmount).toBe("999.00");
});

it.each([
  { ...initial, currency: null, canCollect: false },
  { ...initial, outstandingCents: "0", canCollect: false },
])("does not offer recording for unknown or settled evidence", async (data) => {
  get.mockResolvedValue(data);
  mount();
  expect(await screen.findByText(/No new collection is available/)).toBeVisible();
  expect(screen.queryByLabelText("Later payment amount (SGD)")).not.toBeInTheDocument();
});

it("allows read-only history without write controls", async () => {
  auth.readOnly = true;
  get.mockResolvedValue(result);
  mount();
  expect(await screen.findByText(/Instalment received/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Record later payment" })).not.toBeInTheDocument();
});

it.each([
  { ...sale, status: "VOID" as const },
  { ...sale, refundedAt: "2026-10-27T10:00:00Z" },
])("hides writes when the receipt is voided or refunded even with stale state", async (value) => {
  mount(value);
  await screen.findByText(/Current outstanding/);
  expect(screen.queryByRole("button", { name: "Record later payment" })).not.toBeInTheDocument();
});

it("fails closed on a read error and offers an explicit retry", async () => {
  get.mockRejectedValueOnce(new Error("Offline"));
  const user = userEvent.setup();
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load the current collection balance",
  );
  expect(screen.queryByRole("button", { name: "Record later payment" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry collection balance" }));
  expect(await screen.findByLabelText("Later payment amount (SGD)")).toBeVisible();
});

it("does not send when durable retry storage is unavailable", async () => {
  const user = userEvent.setup();
  mount();
  await fill(user);
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  try {
    await user.click(screen.getByRole("button", { name: "Record later payment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Retry protection is unavailable");
    expect(post).not.toHaveBeenCalled();
  } finally {
    storage.mockRestore();
  }
});

it("scopes pending attempts to the account and sale", async () => {
  const user = userEvent.setup();
  post.mockRejectedValue(new Error("Offline"));
  const view = mount();
  await fill(user);
  await user.click(screen.getByRole("button", { name: "Record later payment" }));
  await screen.findByRole("alert");
  view.unmount();
  auth.userId = "other-actor";
  mount();
  expect(await screen.findByLabelText("Later payment amount (SGD)")).toHaveValue("");
  expect(screen.queryByRole("button", { name: "Retry recorded payment" })).not.toBeInTheDocument();
});
