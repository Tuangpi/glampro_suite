import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { PayrollValueHoldingDetail } from "@glampro_suite/shared";
import ValuePackagePayrollDetail from "./ValuePackagePayrollDetail";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), role: "MANAGER", readOnly: false }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { globalRole: mocks.role }, isReadOnly: mocks.readOnly }),
}));
vi.mock("@/lib/api", () => ({
  get: mocks.get,
  post: mocks.post,
  getErrorMessage: (error: Error) => error.message,
}));

function evidence(): PayrollValueHoldingDetail {
  return {
    holdingId: "holding",
    updatedAt: "2026-10-28T00:00:00.000Z",
    creditRemaining: "500.00",
    purchase: {
      version: 1,
      saleId: "sale",
      saleLineId: "line",
      currency: "SGD",
      paidNet: "500.00",
      credit: "600.00",
      sellers: [{ staffId: "seller", share: 10000 }],
    },
    originalTaxCents: "4500",
    collectedNetCents: "50000",
    collectedTaxCents: "4500",
    usedBaseTicks: "833333",
    missingEvidence: [],
    refunded: false,
    refund: null,
  };
}
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ValuePackagePayrollDetail customerId="customer" holdingId="holding" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  return Object.assign(client, {
    rerenderDetail: () =>
      view.rerender(
        <QueryClientProvider client={client}>
          <ValuePackagePayrollDetail customerId="customer" holdingId="holding" onClose={vi.fn()} />
        </QueryClientProvider>,
      ),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.role = "MANAGER";
  mocks.readOnly = false;
  mocks.get.mockResolvedValue(evidence());
  mocks.post.mockResolvedValue({ id: "refund" });
});
const submit = () =>
  screen.getByRole("button", { name: "Record value-package refund or cancellation" });
async function approve() {
  await screen.findByRole("button", { name: "Record value-package refund or cancellation" });
  await userEvent.type(screen.getByLabelText("Refund reason"), "Approved unused credit refund");
  await userEvent.click(screen.getByRole("checkbox"));
}

it("reads customer-bound evidence and submits exact ratio-based refund with actual tender", async () => {
  const client = setup();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await approve();
  expect(mocks.get).toHaveBeenCalledWith("/customers/customer/prepaid/holding/payroll");
  await userEvent.clear(screen.getByLabelText("Approved administration fee (net SGD)"));
  await userEvent.type(screen.getByLabelText("Approved administration fee (net SGD)"), "100.00");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByText(/Refund preview: 345.16 SGD/)).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Actual payout method"), "PAYNOW");
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(submit());
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith(
      "/sales/value-package-holdings/holding/refund",
      expect.objectContaining({
        payoutGrossCents: "34516",
        payoutMethod: "PAYNOW",
        adminFeeNetCents: "10000",
        expectedUpdatedAt: "2026-10-28T00:00:00.000Z",
        reason: "Approved unused credit refund",
      }),
    ),
  );
  expect(invalidate).toHaveBeenCalled();
});

it("requires reason and explicit confirmation", async () => {
  setup();
  await screen.findByRole("button", { name: "Record value-package refund or cancellation" });
  expect(submit()).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Refund reason"), "Approved refund");
  expect(submit()).toBeDisabled();
});

it("records zero payout as NONE, never promotional credit or an inferred cash movement", async () => {
  mocks.get.mockResolvedValue({ ...evidence(), collectedNetCents: "0", collectedTaxCents: "0" });
  setup();
  await approve();
  expect(screen.getByText(/No payout: NONE/)).toBeInTheDocument();
  await userEvent.click(submit());
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ payoutGrossCents: "0", payoutMethod: "NONE" }),
    ),
  );
});

it.each(["STAFF", "CASHIER"])("permits evidence reads without writes for %s", async (role) => {
  mocks.role = role;
  setup();
  await screen.findByText("Original paid net");
  expect(
    screen.queryByRole("button", { name: "Record value-package refund or cancellation" }),
  ).not.toBeInTheDocument();
});

it("read-only tenant cannot refund", async () => {
  mocks.readOnly = true;
  setup();
  await screen.findByText("Original paid net");
  expect(screen.queryByLabelText("Refund reason")).not.toBeInTheDocument();
});

it("missing evidence is unavailable rather than defaulting to a cash amount", async () => {
  mocks.get.mockResolvedValue({
    ...evidence(),
    purchase: null,
    missingEvidence: ["ORIGINAL_PURCHASE_EVIDENCE"],
  });
  setup();
  expect(await screen.findByText(/Refund unavailable/)).toHaveTextContent(
    "ORIGINAL_PURCHASE_EVIDENCE",
  );
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

it.each(["ORIGINAL_COLLECTION_SELLER_SOURCES", "ORIGINAL_OUTSTANDING_BALANCE"])(
  "preserves known economics but blocks refund for %s",
  async (gap) => {
    mocks.get.mockResolvedValue({ ...evidence(), missingEvidence: [gap] });
    setup();
    expect(await screen.findByText(/Refund unavailable/)).toHaveTextContent(gap);
    expect(screen.getByText("Original paid net").nextElementSibling).toHaveTextContent("500.00");
    expect(screen.queryByLabelText("Refund reason")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  },
);

it.each(["-1", "1e2", "1.001", " 1.00", "01.00", "abc"])(
  "rejects malformed fee %s",
  async (fee) => {
    setup();
    await approve();
    fireEvent.change(screen.getByLabelText("Approved administration fee (net SGD)"), {
      target: { value: fee },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("non-negative amount");
    expect(submit()).toBeDisabled();
    expect(mocks.post).not.toHaveBeenCalled();
  },
);

it("preserves refused draft, resets confirmation and reuses unchanged retry evidence", async () => {
  mocks.post.mockRejectedValue(new Error("Holding changed. Reload."));
  setup();
  await approve();
  await userEvent.click(submit());
  expect(await screen.findByRole("alert")).toHaveTextContent("Holding changed");
  expect(screen.getByLabelText("Refund reason")).toHaveValue("Approved unused credit refund");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(submit());
  await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
  expect(mocks.post.mock.calls[0]).toEqual(mocks.post.mock.calls[1]);
});

it("blocks duplicate clicks while recording", async () => {
  mocks.post.mockReturnValue(new Promise(() => {}));
  setup();
  await approve();
  fireEvent.click(submit());
  fireEvent.click(submit());
  expect(mocks.post).toHaveBeenCalledTimes(1);
  expect(submit()).toBeDisabled();
});

it("refreshing holding revision resets approval instead of submitting stale confirmation", async () => {
  const client = setup();
  await approve();
  client.setQueryData(["value-package-payroll-detail", "customer", "holding"], {
    ...evidence(),
    updatedAt: "2026-10-28T01:00:00.000Z",
  });
  await waitFor(() => expect(screen.getByRole("checkbox")).not.toBeChecked());
  expect(screen.getByLabelText("Refund reason")).toHaveValue("");
  expect(submit()).toBeDisabled();
});

it("shows recorded refund rather than recalculating usage from cancelled credit", async () => {
  mocks.get.mockResolvedValue({
    ...evidence(),
    refunded: true,
    creditRemaining: "0.00",
    usedBaseTicks: null,
    refund: {
      occurredAt: "2026-10-28T01:00:00.000Z",
      grossCents: "34516",
      netCents: "31666",
      taxCents: "2850",
      reason: "Approved cancellation",
      payoutMethod: "PAYNOW",
    },
  });
  setup();
  await screen.findByRole("heading", { name: "Recorded refund" });
  expect(screen.getByText(/345.16 SGD/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Refund reason")).not.toBeInTheDocument();
});

it("failed evidence read cannot expose a refund form", async () => {
  mocks.get.mockRejectedValue(new Error("Evidence unavailable"));
  setup();
  expect(await screen.findByRole("alert")).toHaveTextContent("Evidence unavailable");
  expect(screen.queryByLabelText("Refund reason")).not.toBeInTheDocument();
});

it("role loss removes pending approval controls before submission", async () => {
  const client = setup();
  await approve();
  mocks.role = "STAFF";
  client.rerenderDetail();
  await waitFor(() => expect(screen.queryByLabelText("Refund reason")).not.toBeInTheDocument());
  expect(mocks.post).not.toHaveBeenCalled();
});

it("background refresh disables approval while original evidence is being checked", async () => {
  const client = setup();
  await approve();
  mocks.get.mockReturnValue(new Promise(() => {}));
  void client.invalidateQueries({
    queryKey: ["value-package-payroll-detail", "customer", "holding"],
  });
  await waitFor(() => expect(submit()).toBeDisabled());
  expect(screen.getByRole("checkbox")).toBeDisabled();
  expect(mocks.post).not.toHaveBeenCalled();
});
