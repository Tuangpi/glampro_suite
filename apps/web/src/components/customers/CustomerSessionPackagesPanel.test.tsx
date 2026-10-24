import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { SessionPackagesPanel } from "./CustomerSessionPackagesPanel";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  list: vi.fn(),
  role: "MANAGER",
  readOnly: false,
  customerError: false,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { globalRole: mocks.role }, isReadOnly: mocks.readOnly }),
}));
vi.mock("@/hooks/useSettings", () => ({
  useModules: () => ({ data: [{ code: "packages", entitled: true }] }),
}));
vi.mock("@/hooks/useCustomers", () => ({
  useCustomerList: () => ({
    data: { data: [{ id: "c2", name: "Mina", phone: "1234" }], pageCount: 1 },
    isError: mocks.customerError,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/api", () => ({
  getPaginated: mocks.list,
  post: mocks.post,
  getErrorMessage: (error: Error) => error?.message ?? "Request failed",
}));
function panel(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <SessionPackagesPanel customerId="c1" />
    </QueryClientProvider>
  );
}
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(panel(client)) };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.role = "MANAGER";
  mocks.readOnly = false;
  mocks.customerError = false;
  mocks.list.mockImplementation(async (path: string) => ({
    data: path.endsWith("/session-packages")
      ? [
          {
            id: "h1",
            customerId: "c1",
            name: "Wallet",
            quantityRemaining: 5,
            expiresAt: null,
            updatedAt: "2026-10-23T01:00:00.000Z",
          },
        ]
      : [],
    total: path.endsWith("/session-packages") ? 1 : 0,
    pageCount: 1,
  }));
  mocks.post.mockResolvedValue({ id: "event1" });
});
async function fill() {
  await userEvent.click(await screen.findByRole("button", { name: "Transfer Wallet" }));
  await userEvent.click(screen.getByRole("button", { name: "Mina · 1234" }));
  await userEvent.type(screen.getByLabelText("Transfer reason"), "Customer request");
  await userEvent.click(screen.getByRole("checkbox"));
}
it("requires recipient, reason and confirmation, posts the snapshot and refreshes balances", async () => {
  const { client } = setup();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await userEvent.click(await screen.findByRole("button", { name: "Transfer Wallet" }));
  expect(screen.getByText(/original purchase cannot be voided/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm session-package transfer" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Mina · 1234" }));
  await userEvent.type(screen.getByLabelText("Transfer reason"), "Customer request");
  expect(screen.getByRole("button", { name: "Confirm session-package transfer" })).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "Confirm session-package transfer" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/customers/c1/session-packages/h1/transfer", {
      targetCustomerId: "c2",
      expectedUpdatedAt: "2026-10-23T01:00:00.000Z",
      reason: "Customer request",
      confirmed: true,
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["customers"] });
});
it("preserves refused drafts and resets confirmation before retry", async () => {
  mocks.post.mockRejectedValueOnce(new Error("Balance changed. Reload."));
  setup();
  await fill();
  await userEvent.click(screen.getByRole("button", { name: "Confirm session-package transfer" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Balance changed");
  expect(screen.getByLabelText("Transfer reason")).toHaveValue("Customer request");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Confirm session-package transfer" })).toBeDisabled();
});
it("resets confirmation on changed details and cancels without writing", async () => {
  setup();
  await fill();
  await userEvent.type(screen.getByLabelText("Transfer reason"), " updated");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Cancel transfer" }));
  expect(mocks.post).not.toHaveBeenCalled();
});
it.each(["STAFF", "CASHIER"])(
  "shows balances and transfer evidence without writes for %s",
  async (role) => {
    mocks.role = role;
    setup();
    expect(await screen.findByRole("button", { name: "Transfer Wallet" })).toBeDisabled();
    expect(screen.getByText(/not a complete session-change ledger/)).toBeInTheDocument();
  },
);
it("closes confirmation on role loss and prevents read-only writes", async () => {
  const { client, rerender } = setup();
  await fill();
  mocks.role = "STAFF";
  rerender(panel(client));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  mocks.role = "SUPER_ADMIN";
  mocks.readOnly = true;
  rerender(panel(client));
  expect(screen.getByRole("button", { name: "Transfer Wallet" })).toBeDisabled();
  expect(mocks.post).not.toHaveBeenCalled();
});
it("does not allow choosing a recipient after a search failure", async () => {
  mocks.customerError = true;
  setup();
  await userEvent.click(await screen.findByRole("button", { name: "Transfer Wallet" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Customer search failed");
  expect(screen.queryByRole("button", { name: "Mina · 1234" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm session-package transfer" })).toBeDisabled();
});

it("disables empty and expired holdings while showing remaining sessions", async () => {
  mocks.list.mockImplementation(async (path: string) => ({
    data: path.endsWith("/session-packages")
      ? [
          {
            id: "empty",
            customerId: "c1",
            name: "Empty",
            quantityRemaining: 0,
            expiresAt: null,
            updatedAt: "2026-10-23T01:00:00.000Z",
          },
          {
            id: "expired",
            customerId: "c1",
            name: "Expired",
            quantityRemaining: 2,
            expiresAt: "2000-01-01T00:00:00.000Z",
            updatedAt: "2026-10-23T01:00:00.000Z",
          },
        ]
      : [],
    total: 2,
    pageCount: 1,
  }));
  setup();
  expect(await screen.findByRole("button", { name: "Transfer Empty" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Transfer Expired" })).toBeDisabled();
  expect(screen.getByText(/2 sessions/)).toBeInTheDocument();
});

it("blocks confirmation when the holding snapshot changes during an open dialog", async () => {
  const { client } = setup();
  await fill();
  mocks.list.mockImplementation(async (path: string) => ({
    data: path.endsWith("/session-packages")
      ? [
          {
            id: "h1",
            customerId: "c1",
            name: "Wallet",
            quantityRemaining: 4,
            expiresAt: null,
            updatedAt: "2026-10-24T01:00:00.000Z",
          },
        ]
      : [],
    total: 1,
    pageCount: 1,
  }));
  await client.invalidateQueries({ queryKey: ["customers"] });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Confirm session-package transfer" })).toBeDisabled(),
  );
  expect(mocks.post).not.toHaveBeenCalled();
});

it("shows incoming transfer evidence with sessions, actor, expiry and reason", async () => {
  mocks.list.mockImplementation(async (path: string) => ({
    data: path.endsWith("/session-package-transfers")
      ? [
          {
            id: "event",
            holdingId: "h1",
            fromCustomerId: "c0",
            toCustomerId: "c1",
            actorId: "manager",
            quantity: 3,
            expiresAt: null,
            reason: "Customer request",
            createdAt: "2026-10-24T01:00:00.000Z",
          },
        ]
      : [],
    total: 1,
    pageCount: 1,
  }));
  setup();
  expect(await screen.findByText(/3 sessions.*From account/)).toHaveTextContent("By manager");
  expect(screen.getByText("Reason: Customer request")).toBeInTheDocument();
  expect(screen.getByText(/Holding: h1/)).toHaveTextContent("No expiry");
});
