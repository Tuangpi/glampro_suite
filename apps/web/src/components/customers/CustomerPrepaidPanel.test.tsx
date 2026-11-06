import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { PrepaidHoldings, PrepaidTransfers } from "./CustomerPrepaidPanel";

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
vi.mock("./ValuePackagePayrollDetail", () => ({
  default: ({ customerId, holdingId }: { customerId: string; holdingId: string }) => (
    <p role="dialog">
      Value economics {customerId}/{holdingId}
    </p>
  ),
}));
function panel(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <PrepaidHoldings customerId="c1" />
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
    data: path.endsWith("/prepaid")
      ? [
          {
            id: "h1",
            customerId: "c1",
            name: "Wallet",
            amountRemaining: "75.00",
            expiresAt: null,
            updatedAt: "2026-10-23T01:00:00.000Z",
          },
        ]
      : [],
    total: path.endsWith("/prepaid") ? 1 : 0,
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
  expect(screen.getByRole("button", { name: "Confirm prepaid transfer" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Mina · 1234" }));
  await userEvent.type(screen.getByLabelText("Transfer reason"), "Customer request");
  expect(screen.getByRole("button", { name: "Confirm prepaid transfer" })).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "Confirm prepaid transfer" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/customers/c1/prepaid/h1/transfer", {
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
  await userEvent.click(screen.getByRole("button", { name: "Confirm prepaid transfer" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Balance changed");
  expect(screen.getByLabelText("Transfer reason")).toHaveValue("Customer request");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Confirm prepaid transfer" })).toBeDisabled();
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
    expect(screen.getByRole("button", { name: "Share Wallet" })).toBeDisabled();
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
  expect(screen.getByRole("button", { name: "Confirm prepaid transfer" })).toBeDisabled();
});
it("opens original economics from the current owned prepaid holding", async () => {
  setup();
  await userEvent.click(
    await screen.findByRole("button", { name: "Purchase & payments for Wallet" }),
  );
  expect(screen.getByRole("dialog")).toHaveTextContent("Value economics c1/h1");
  expect(mocks.post).not.toHaveBeenCalled();
});
it("names shared and private credit on the row that owns the balance", async () => {
  mocks.list.mockImplementation(async (path: string) => ({
    data: path.endsWith("/prepaid")
      ? [
          {
            id: "h1",
            customerId: "c1",
            name: "Wallet",
            amountRemaining: "75.00",
            expiresAt: null,
            sharedFamilyId: "family1",
            updatedAt: "2026-10-23T01:00:00.000Z",
          },
        ]
      : [],
    total: path.endsWith("/prepaid") ? 1 : 0,
    pageCount: 1,
  }));
  setup();
  expect(await screen.findByText(/75\.00 left/)).toHaveTextContent("Shared");
  expect(screen.getByRole("button", { name: "Make private Wallet" })).toBeEnabled();
});
it("keeps transfer evidence in its own list, apart from the rows it explains", async () => {
  mocks.list.mockImplementation(async (path: string) => ({
    data: path.endsWith("/prepaid-transfers")
      ? [
          {
            id: "event",
            holdingId: "h1",
            fromCustomerId: "c0",
            toCustomerId: "c1",
            actorId: "manager",
            amount: "75.00",
            expiresAt: null,
            reason: "Customer request",
            createdAt: "2026-10-24T01:00:00.000Z",
          },
        ]
      : [],
    total: path.endsWith("/prepaid-transfers") ? 1 : 0,
    pageCount: 1,
  }));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PrepaidTransfers customerId="c1" />
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/75\.00 moved/)).toBeInTheDocument();
  expect(screen.getByText("Reason: Customer request")).toBeInTheDocument();
  expect(screen.getByText(/account c0 to c1/)).toHaveTextContent("by manager");
  expect(mocks.list).toHaveBeenCalledWith("/customers/c1/prepaid-transfers", {
    page: 1,
    pageSize: 10,
  });
});
