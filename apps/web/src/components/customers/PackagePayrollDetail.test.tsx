import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { PayrollHoldingDetail } from "@glampro_suite/shared";
import PackagePayrollDetail from "./PackagePayrollDetail";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), role: "MANAGER", readOnly: false }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { globalRole: mocks.role }, isReadOnly: mocks.readOnly }),
}));
vi.mock("@/hooks/useStaff", () => ({
  useStaffList: () => ({ data: { data: [{ id: "therapist", name: "Therapist" }] } }),
}));
vi.mock("@/lib/api", () => ({
  get: mocks.get,
  post: mocks.post,
  getErrorMessage: (error: Error) => error.message,
}));
vi.mock("@/components/sale/SaleCollectionsPanel", () => ({
  default: () => <p>Collection history</p>,
}));

function evidence(): PayrollHoldingDetail {
  return {
    holdingId: "holding",
    updatedAt: "2026-10-28T00:00:00.000Z",
    purchaseSaleId: "sale",
    currency: "SGD",
    netCents: "500000",
    balanceDueCents: "0",
    collectedNetCents: "500000",
    collectedTaxCents: "45000",
    usedBaseTicks: "20000000",
    sessionValue: "1000.0000",
    grantedSessions: 5,
    remainingSessions: 3,
    paidSessionsRemaining: 3,
    sellers: [{ staffId: "seller", share: 10000 }],
    settings: {
      sale: { mode: "FOLLOW_PLAN" },
      redemption: { mode: "FOLLOW_PLAN" },
      minimumDepositPct: "0",
    },
    missingEvidence: [],
    refunded: false,
    payments: [],
    sessions: [],
  };
}
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PackagePayrollDetail customerId="customer" holdingId="holding" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.role = "MANAGER";
  mocks.readOnly = false;
  mocks.get.mockResolvedValue(evidence());
  mocks.post.mockResolvedValue({ id: "refund" });
});
it.each([
  ["0.00", "0", "NONE"],
  ["3161.00", "316100", "CASH"],
])(
  "records explicit %s payout with the correct tender and stale token",
  async (payout, cents, method) => {
    const client = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const button = await screen.findByRole("button", {
      name: "Record approved refund or cancellation",
    });
    expect(button).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText("Session action / refund reason"),
      "Approved cancellation",
    );
    await userEvent.type(
      screen.getByLabelText("Cash refund paid (gross SGD; 0.00 for no payout)"),
      payout,
    );
    await userEvent.click(button);
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        "/sales/package-holdings/holding/refund",
        expect.objectContaining({
          payoutGrossCents: cents,
          payoutMethod: method,
          expectedUpdatedAt: "2026-10-28T00:00:00.000Z",
          reason: "Approved cancellation",
        }),
      ),
    );
    expect(invalidate).toHaveBeenCalled();
  },
);
it.each(["STAFF", "CASHIER"])("does not expose refund writes to %s", async (role) => {
  mocks.role = role;
  setup();
  await screen.findByRole("heading", { name: "Sessions" });
  expect(
    screen.queryByRole("button", { name: "Record approved refund or cancellation" }),
  ).not.toBeInTheDocument();
});
it("hides refund writes for read-only tenants", async () => {
  mocks.readOnly = true;
  setup();
  await screen.findByRole("heading", { name: "Sessions" });
  expect(
    screen.queryByRole("button", { name: "Record approved refund or cancellation" }),
  ).not.toBeInTheDocument();
});
it.each([{ missingEvidence: ["ORIGINAL_PURCHASE_EVIDENCE"] }, { refunded: true }])(
  "hides unsafe refunds for %j",
  async (patch) => {
    mocks.get.mockResolvedValue({ ...evidence(), ...patch });
    setup();
    await screen.findByRole("heading", { name: "Sessions" });
    expect(
      screen.queryByRole("button", { name: "Record approved refund or cancellation" }),
    ).not.toBeInTheDocument();
  },
);
it("retains a refused draft and shows the server error", async () => {
  mocks.post.mockRejectedValue(new Error("Holding changed. Reload before refunding."));
  setup();
  const button = await screen.findByRole("button", {
    name: "Record approved refund or cancellation",
  });
  await userEvent.type(
    screen.getByLabelText("Session action / refund reason"),
    "Approved cancellation",
  );
  await userEvent.type(
    screen.getByLabelText("Cash refund paid (gross SGD; 0.00 for no payout)"),
    "0.00",
  );
  await userEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("Holding changed");
  expect(screen.getByLabelText("Session action / refund reason")).toHaveValue(
    "Approved cancellation",
  );
});

function withSession(patch: Partial<PayrollHoldingDetail["sessions"][number]> = {}) {
  return {
    ...evidence(),
    sessions: [
      {
        id: "session",
        saleId: "usage-sale",
        quantity: 1,
        usedAt: "2026-10-28T01:00:00.000Z",
        revertedAt: null,
        revision: 2,
        performers: [{ staffId: "original", share: 10000 }],
        baseAmount: "1000.0000",
        signature: null,
        ...patch,
      },
    ],
  };
}
async function reason() {
  await userEvent.type(
    screen.getByLabelText("Session action / refund reason"),
    "Approved correction",
  );
}
async function selectTherapist() {
  await userEvent.click(screen.getByRole("button", { name: "Commission attribution" }));
  await userEvent.click(screen.getByRole("button", { name: "Add therapist" }));
  await userEvent.selectOptions(screen.getByLabelText("performers staff 1"), "therapist");
  await userEvent.click(screen.getByRole("button", { name: "Save attribution" }));
}
it.each(["garbage", "1e2", "-1", "0.001", " ", "01.00"])(
  "refuses malformed approved payout %j instead of converting it to zero",
  async (value) => {
    setup();
    const button = await screen.findByRole("button", {
      name: "Record approved refund or cancellation",
    });
    await reason();
    await userEvent.type(
      screen.getByLabelText("Cash refund paid (gross SGD; 0.00 for no payout)"),
      value,
    );
    await userEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("at most two decimal places");
    expect(mocks.post).not.toHaveBeenCalled();
  },
);
it("refuses an invalid fee without silently waiving it", async () => {
  setup();
  const button = await screen.findByRole("button", {
    name: "Record approved refund or cancellation",
  });
  await reason();
  const fee = screen.getByLabelText("Approved administration fee (net SGD)");
  await userEvent.clear(fee);
  await userEvent.type(fee, "invalid");
  await userEvent.type(
    screen.getByLabelText("Cash refund paid (gross SGD; 0.00 for no payout)"),
    "0.00",
  );
  await userEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("at most two decimal places");
  expect(mocks.post).not.toHaveBeenCalled();
});
it("voids the selected revision with a reason and refreshes detail", async () => {
  mocks.get.mockResolvedValue(withSession());
  const client = setup();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const button = await screen.findByRole("button", { name: "Void session" });
  expect(button).toBeDisabled();
  await reason();
  await userEvent.click(button);
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith(
      "/sales/usage-sale/redemptions/session/void",
      expect.objectContaining({
        expectedRevision: 2,
        reason: "Approved correction",
        idempotencyKey: expect.stringContaining(":void:session:2"),
      }),
    ),
  );
  expect(invalidate).toHaveBeenCalled();
});
it("corrects staff using the real split editor and captured revision", async () => {
  mocks.get.mockResolvedValue(withSession());
  setup();
  const button = await screen.findByRole("button", { name: "Correct session staff" });
  await reason();
  expect(button).toBeDisabled();
  await selectTherapist();
  await userEvent.click(button);
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith(
      "/sales/usage-sale/redemptions/session/attribution-corrections",
      expect.objectContaining({
        expectedRevision: 2,
        performers: [{ staffId: "therapist", share: 10000 }],
        reason: "Approved correction",
      }),
    ),
  );
});
it("invalidates a staff correction draft when the server session revision changes", async () => {
  mocks.get.mockResolvedValue(withSession());
  const client = setup();
  await screen.findByRole("button", { name: "Correct session staff" });
  await reason();
  await selectTherapist();
  expect(screen.getByRole("button", { name: "Correct session staff" })).toBeEnabled();
  client.setQueryData(
    ["package-payroll-detail", "customer", "holding"],
    withSession({ revision: 3 }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Correct session staff" })).toBeDisabled(),
  );
  expect(mocks.post).not.toHaveBeenCalled();
});
it("retries an unchanged refused void with the same key and revision", async () => {
  mocks.get.mockResolvedValue(withSession());
  mocks.post.mockRejectedValueOnce(new Error("Connection interrupted"));
  setup();
  const button = await screen.findByRole("button", { name: "Void session" });
  await reason();
  await userEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
  await userEvent.click(button);
  await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
  expect(mocks.post.mock.calls[0]).toEqual(mocks.post.mock.calls[1]);
});
it("prevents duplicate and competing session actions while a write is pending", async () => {
  mocks.get.mockResolvedValue(withSession());
  let finish!: (value: unknown) => void;
  mocks.post.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  setup();
  const button = await screen.findByRole("button", { name: "Void session" });
  await reason();
  await userEvent.dblClick(button);
  expect(mocks.post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Correct session staff" })).toBeDisabled();
  finish({ id: "void" });
  await waitFor(() => expect(button).toBeEnabled());
});
it.each([{ revertedAt: "2026-10-28T02:00:00.000Z" }, { revision: null }])(
  "hides session actions without an active verifiable revision: %j",
  async (patch) => {
    mocks.get.mockResolvedValue(withSession(patch));
    setup();
    await screen.findByRole("heading", { name: "Sessions" });
    expect(screen.queryByRole("button", { name: "Void session" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Correct session staff" })).not.toBeInTheDocument();
  },
);
it.each(["STAFF", "CASHIER"])("hides session actions for %s", async (role) => {
  mocks.role = role;
  mocks.get.mockResolvedValue(withSession());
  setup();
  await screen.findByRole("heading", { name: "Sessions" });
  expect(screen.queryByRole("button", { name: "Void session" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Correct session staff" })).not.toBeInTheDocument();
});
it("hides session actions in read-only mode", async () => {
  mocks.readOnly = true;
  mocks.get.mockResolvedValue(withSession());
  setup();
  await screen.findByRole("heading", { name: "Sessions" });
  expect(screen.queryByRole("button", { name: "Void session" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Correct session staff" })).not.toBeInTheDocument();
});
it("prevents restoring refunded sessions while retaining earned staff correction controls", async () => {
  mocks.get.mockResolvedValue({ ...withSession(), refunded: true });
  setup();
  const button = await screen.findByRole("button", { name: "Void session" });
  await reason();
  expect(button).toBeDisabled();
  expect(screen.getByRole("button", { name: "Commission attribution" })).toBeEnabled();
  expect(mocks.post).not.toHaveBeenCalled();
});
it("shows a failed detail read without exposing cached action controls", async () => {
  mocks.get.mockRejectedValue(new Error("Evidence unavailable"));
  setup();
  expect(await screen.findByRole("alert")).toHaveTextContent("Evidence unavailable");
  expect(screen.queryByRole("button", { name: "Void session" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Record approved refund or cancellation" }),
  ).not.toBeInTheDocument();
});
