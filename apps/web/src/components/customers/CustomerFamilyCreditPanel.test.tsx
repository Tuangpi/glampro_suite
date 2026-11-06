import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { PrepaidHolding } from "@glampro_suite/shared";
import {
  FamilySharingCard,
  HoldingBalanceAudit,
  PrepaidMembershipHistory,
} from "./CustomerFamilyCreditPanel";
import ShareHoldingDialog from "./ShareHoldingDialog";

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

const HOLDING: PrepaidHolding = {
  id: "h1",
  customerId: "c1",
  name: "Wallet",
  amountRemaining: "75.00",
  expiresAt: null,
  sharedFamilyId: null,
  updatedAt: "2026-10-23T01:00:00.000Z",
};
const FAMILY = {
  id: "family1",
  name: "Family",
  members: [{ customerId: "c1", name: "Mina", archived: false }],
};

function store() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function renderWith(node: ReactNode) {
  const client = store();
  return { client, ...render(<QueryClientProvider client={client}>{node}</QueryClientProvider>) };
}
function membership() {
  const client = store();
  const view = () => (
    <QueryClientProvider client={client}>
      <FamilySharingCard customerId="c1" />
    </QueryClientProvider>
  );
  return { client, view, ...render(view()) };
}
function sharing(holding: Partial<PrepaidHolding> = {}, refreshing = false) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const client = store();
  render(
    <QueryClientProvider client={client}>
      <ShareHoldingDialog
        customerId="c1"
        holding={{ ...HOLDING, ...holding }}
        refreshing={refreshing}
        onClose={onClose}
        onSaved={onSaved}
      />
    </QueryClientProvider>,
  );
  return { client, onSaved, onClose };
}
async function confirmSharing(reason = "Customer request") {
  // The dialog holds every field until the family it would write against has been read.
  await waitFor(() => expect(screen.getByLabelText("Family change reason")).toBeEnabled());
  await userEvent.type(screen.getByLabelText("Family change reason"), reason);
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "Confirm family change" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.role = "MANAGER";
  mocks.readOnly = false;
  mocks.get.mockResolvedValue(FAMILY);
  mocks.list.mockImplementation(async () => ({ data: [], total: 0, pageCount: 1 }));
  mocks.post.mockResolvedValue(null);
});

it("shares the holding the dialog was opened from, with reason, confirmation and its snapshot", async () => {
  const { client, onSaved } = sharing();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  expect(await screen.findByText(/Shared with/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm family change" })).toBeDisabled();
  await confirmSharing();
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/customers/c1/prepaid/h1/sharing", {
      familyId: "family1",
      expectedUpdatedAt: "2026-10-23T01:00:00.000Z",
      reason: "Customer request",
      confirmed: true,
    }),
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["customers"] });
});

it("makes a shared holding private without moving its balance", async () => {
  sharing({ sharedFamilyId: "family1" });
  expect(await screen.findByText(/Make private/)).toBeInTheDocument();
  await confirmSharing("Withdraw sharing");
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/customers/c1/prepaid/h1/sharing", {
      familyId: null,
      expectedUpdatedAt: "2026-10-23T01:00:00.000Z",
      reason: "Withdraw sharing",
      confirmed: true,
    }),
  );
});

it("will not share before a family exists and points at the card that creates one", async () => {
  mocks.get.mockResolvedValue(null);
  sharing();
  expect(await screen.findByText(/no prepaid family yet/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm family change" })).toBeDisabled();
  expect(screen.getByRole("checkbox")).toBeDisabled();
});

it("does not offer sharing when the family could not be read", async () => {
  mocks.get.mockRejectedValue(new Error("Family unavailable"));
  sharing();
  expect(await screen.findByRole("alert")).toHaveTextContent("Family unavailable");
  expect(screen.getByRole("button", { name: "Retry family" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Confirm family change" })).toBeDisabled();
});

it("keeps the reason and drops the tick after a refusal", async () => {
  mocks.post.mockRejectedValue(new Error("Holding changed"));
  sharing();
  await confirmSharing("Share");
  expect(await screen.findByRole("alert")).toHaveTextContent("Holding changed");
  expect(screen.getByLabelText("Family change reason")).toHaveValue("Share");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
});

it("blocks confirmation while the owned rows are refreshing", async () => {
  sharing({}, true);
  await screen.findByText(/Shared with/);
  expect(screen.getByRole("button", { name: "Confirm family change" })).toBeDisabled();
  expect(screen.getByLabelText("Family change reason")).toBeDisabled();
});

it("resets the confirmation when the reason changes", async () => {
  sharing();
  await screen.findByText(/Shared with/);
  await userEvent.type(screen.getByLabelText("Family change reason"), "Share");
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.type(screen.getByLabelText("Family change reason"), " more");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
});

it("creates a family without touching a single holding", async () => {
  mocks.get.mockResolvedValue(null);
  membership();
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
  // The card only grants permission: sharing stays a per-holding choice on the credit rows.
  expect(mocks.list).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /Share Wallet/ })).not.toBeInTheDocument();
});

it("joins by family ID using the current membership snapshot", async () => {
  mocks.get.mockResolvedValue(null);
  membership();
  await userEvent.click(
    await screen.findByRole("button", { name: "Join or change prepaid family" }),
  );
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

it("leaves using the current membership snapshot and says sharing is withdrawn", async () => {
  membership();
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
  "shows the family to %s without offering a change or reading a holding",
  async (role) => {
    mocks.role = role;
    membership();
    expect(await screen.findByRole("button", { name: "Leave prepaid family" })).toBeDisabled();
    expect(screen.getByText("Family")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join or change prepaid family" })).toBeDisabled();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  },
);

it("closes an open family change on role loss and blocks read-only changes", async () => {
  const { rerender, view } = membership();
  await userEvent.click(await screen.findByRole("button", { name: "Leave prepaid family" }));
  mocks.role = "STAFF";
  rerender(view());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  mocks.role = "MANAGER";
  mocks.readOnly = true;
  rerender(view());
  expect(screen.getByRole("button", { name: "Leave prepaid family" })).toBeDisabled();
});

it("renders opening and balance evidence without presenting it as reconstructed history", async () => {
  mocks.list.mockImplementation(async () => ({
    data: [
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
    ],
    total: 1,
    pageCount: 1,
  }));
  renderWith(<HoldingBalanceAudit customerId="c1" />);
  expect(await screen.findByText(/· OPENING ·/)).toBeInTheDocument();
  expect(screen.getByText(/Unknown \/ opening or direct database operation/)).toBeInTheDocument();
  expect(screen.getByText(/Earlier activity is not reconstructed/)).toBeInTheDocument();
  expect(screen.getByText("Reason: Opening snapshot")).toBeInTheDocument();
  expect(mocks.list).toHaveBeenCalledWith("/customers/c1/prepaid-balance-history", {
    page: 1,
    pageSize: 10,
  });
});

it("lists membership moves in their own list, apart from balances", async () => {
  mocks.list.mockImplementation(async () => ({
    data: [
      {
        id: "m1",
        customerId: "c1",
        actorId: "manager",
        fromFamilyId: "family1",
        toFamilyId: null,
        reason: "Credit split",
        createdAt: "2026-10-24T01:00:00.000Z",
      },
    ],
    total: 1,
    pageCount: 1,
  }));
  renderWith(<PrepaidMembershipHistory customerId="c1" />);
  expect(await screen.findByText(/family1 → none/)).toBeInTheDocument();
  expect(screen.getByText("By manager · Credit split")).toBeInTheDocument();
  expect(mocks.list).toHaveBeenCalledWith("/customers/c1/prepaid-family-history", {
    page: 1,
    pageSize: 10,
  });
});
