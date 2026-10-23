import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import CustomerFamilyCreditPanel from "./CustomerFamilyCreditPanel";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  post: vi.fn(),
  role: "MANAGER",
  readOnly: false,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { globalRole: mocks.role }, isReadOnly: mocks.readOnly }),
}));
vi.mock("@/lib/api", () => ({
  get: mocks.get,
  getPaginated: mocks.list,
  post: mocks.post,
  getErrorMessage: (error: Error) => error?.message ?? "Request failed",
}));
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => (
    <QueryClientProvider client={client}>
      <CustomerFamilyCreditPanel customerId="c1" />
    </QueryClientProvider>
  );
  return { client, view, ...render(view()) };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.role = "MANAGER";
  mocks.readOnly = false;
  mocks.get.mockResolvedValue({
    id: "family1",
    name: "Family",
    members: [{ customerId: "c1", name: "Mina", archived: false }],
  });
  mocks.list.mockImplementation(async (path: string) => ({
    data: path.endsWith("/prepaid")
      ? [
          {
            id: "h1",
            customerId: "c1",
            name: "Wallet",
            amountRemaining: "75.00",
            expiresAt: null,
            sharedFamilyId: null,
            updatedAt: "2026-10-23T01:00:00.000Z",
          },
        ]
      : [],
    total: path.endsWith("/prepaid") ? 1 : 0,
    pageCount: 1,
  }));
  mocks.post.mockResolvedValue(null);
});
it("explicitly shares one holding with reason, confirmation and stale snapshot", async () => {
  const { client } = setup();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await userEvent.click(await screen.findByRole("button", { name: "Share Wallet" }));
  expect(screen.getByRole("button", { name: "Confirm family change" })).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Family change reason"), "Customer request");
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "Confirm family change" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/customers/c1/prepaid/h1/sharing", {
      familyId: "family1",
      expectedUpdatedAt: "2026-10-23T01:00:00.000Z",
      reason: "Customer request",
      confirmed: true,
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["customers"] });
});
it("requires a fresh confirmation after refusal and preserves the reason", async () => {
  mocks.post.mockRejectedValue(new Error("Holding changed"));
  setup();
  await userEvent.click(await screen.findByRole("button", { name: "Share Wallet" }));
  await userEvent.type(screen.getByLabelText("Family change reason"), "Share");
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "Confirm family change" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Holding changed");
  expect(screen.getByLabelText("Family change reason")).toHaveValue("Share");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
});
it("creates membership without automatically sharing and can join by family ID", async () => {
  mocks.get.mockResolvedValue(null);
  setup();
  await userEvent.click(await screen.findByRole("button", { name: "Create prepaid family" }));
  await userEvent.type(screen.getByLabelText("New prepaid family name"), "Mina family");
  await userEvent.type(screen.getByLabelText("Family change reason"), "Request");
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "Confirm family change" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/customers/c1/prepaid-family", {
      name: "Mina family",
      reason: "Request",
      confirmed: true,
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Share Wallet" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Join or change prepaid family" }));
  await userEvent.type(screen.getByLabelText("Target prepaid family ID"), "family2");
  await userEvent.type(screen.getByLabelText("Family change reason"), "Join");
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "Confirm family change" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/customers/c1/prepaid-family-membership", {
      familyId: "family2",
      expectedFamilyId: null,
      reason: "Join",
      confirmed: true,
    }),
  );
});
it("leaves using the current membership snapshot and explains sharing withdrawal", async () => {
  setup();
  await userEvent.click(await screen.findByRole("button", { name: "Leave prepaid family" }));
  expect(screen.getByText(/Changing or leaving a family makes/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Family change reason"), "Leave");
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "Confirm family change" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/customers/c1/prepaid-family-membership", {
      familyId: null,
      expectedFamilyId: "family1",
      reason: "Leave",
      confirmed: true,
    }),
  );
});
it.each(["STAFF", "CASHIER"])(
  "keeps family and audit readable but disables changes for %s",
  async (role) => {
    mocks.role = role;
    setup();
    expect(await screen.findByRole("button", { name: "Share Wallet" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Leave prepaid family" })).toBeDisabled();
    expect(screen.getByText(/Opening snapshots are not historical purchases/)).toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  },
);
it("closes a confirmation on role loss and blocks read-only changes", async () => {
  const { rerender, view } = setup();
  await userEvent.click(await screen.findByRole("button", { name: "Share Wallet" }));
  mocks.role = "STAFF";
  rerender(view());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  mocks.role = "MANAGER";
  mocks.readOnly = true;
  rerender(view());
  expect(screen.getByRole("button", { name: "Share Wallet" })).toBeDisabled();
});
it("does not offer sharing when family access failed", async () => {
  mocks.get.mockRejectedValue(new Error("Family unavailable"));
  setup();
  expect(await screen.findByRole("alert")).toHaveTextContent("Family unavailable");
  expect(await screen.findByRole("button", { name: "Share Wallet" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Retry family" })).toBeEnabled();
});

it("withdraws sharing without a transfer and resets confirmation when the reason changes", async () => {
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
  await userEvent.click(await screen.findByRole("button", { name: "Make private Wallet" }));
  await userEvent.type(screen.getByLabelText("Family change reason"), "Withdraw");
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.type(screen.getByLabelText("Family change reason"), " sharing");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "Confirm family change" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/customers/c1/prepaid/h1/sharing", {
      familyId: null,
      expectedUpdatedAt: "2026-10-23T01:00:00.000Z",
      reason: "Withdraw sharing",
      confirmed: true,
    }),
  );
});

it("renders opening and balance evidence without presenting it as reconstructed history", async () => {
  mocks.list.mockImplementation(async (path: string) => ({
    data: path.endsWith("/prepaid-balance-history")
      ? [
          {
            id: "e1",
            kind: "OPENING",
            holdingId: "h1",
            customerId: "c1",
            actorId: null,
            saleId: null,
            amountBefore: "75.00",
            amountAfter: "75.00",
            delta: "0.00",
            sharedFamilyId: null,
            previousSharedFamilyId: null,
            expiresAt: null,
            reason: "Opening snapshot",
            createdAt: "2026-10-23T01:00:00.000Z",
          },
        ]
      : [],
    total: path.endsWith("/prepaid-balance-history") ? 1 : 0,
    pageCount: 1,
  }));
  setup();
  expect(await screen.findByText(/· OPENING ·/)).toBeInTheDocument();
  expect(screen.getByText(/Unknown \/ opening or direct database operation/)).toBeInTheDocument();
  expect(screen.getByText(/Earlier activity is not reconstructed/)).toBeInTheDocument();
});
