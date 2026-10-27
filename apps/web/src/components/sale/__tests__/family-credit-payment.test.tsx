import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import PaymentDialog from "../PaymentDialog";

const mocks = vi.hoisted(() => ({ holdings: vi.fn() }));
vi.mock("@/hooks/useCustomers", () => ({ useCustomerHoldings: mocks.holdings }));
vi.mock("@/hooks/useSale", () => ({ useVoucherPreview: () => ({ isPending: false }) }));
beforeEach(() => {
  mocks.holdings.mockReturnValue({
    data: {
      holdings: [
        {
          id: "family:f1",
          kind: "PREPAID_CREDIT",
          name: "Shared family credit (earliest expiry first)",
          amountRemaining: "40.03",
          quantityRemaining: 0,
          serviceIds: [],
          expiresAt: null,
        },
      ],
    },
  });
});
it("requires explicit allocations and confirmation before posting collection evidence", async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  render(
    <PaymentDialog
      totalCents={1000}
      lines={[{ itemType: "SERVICE", itemId: "service", quantity: 1, unitPriceCents: 1000 }]}
      customerId="c1"
      hasCustomer
      needsCustomer={false}
      hasManualDiscount={false}
      isPending={false}
      errorMessage={null}
      onClose={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
  await user.click(screen.getByLabelText("Record collection allocations"));
  expect(screen.getByRole("button", { name: "Take payment" })).toBeDisabled();
  await user.type(screen.getByLabelText("Tender 1 allocation to line 1"), "10.00");
  expect(screen.getByRole("button", { name: "Take payment" })).toBeDisabled();
  await user.click(screen.getByLabelText(/I confirm these payments/));
  await user.click(screen.getByRole("button", { name: "Take payment" }));
  expect(onConfirm).toHaveBeenCalledWith(
    [{ method: "CASH", amount: 10 }],
    expect.any(String),
    null,
    { currency: "SGD", allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "1000" }] },
  );
  await user.clear(screen.getByLabelText("Tender 1 allocation to line 1"));
  expect(screen.getByLabelText(/I confirm these payments/)).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Take payment" })).toBeDisabled();
});
it("offers one family pool and posts its identifier with the derived cent-exact amount", async () => {
  const onConfirm = vi.fn();
  render(
    <PaymentDialog
      totalCents={2500}
      lines={[]}
      customerId="c1"
      hasCustomer
      needsCustomer={false}
      hasManualDiscount={false}
      isPending={false}
      errorMessage={null}
      onClose={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
  expect(screen.getByText(/server draws earliest expiry first/)).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Tender 1"), "PREPAID_CREDIT");
  await userEvent.selectOptions(screen.getByLabelText("Paid with (tender 1)"), "family:f1");
  await userEvent.click(screen.getByRole("button", { name: "Take payment" }));
  expect(onConfirm).toHaveBeenCalledWith(
    [{ method: "PREPAID_CREDIT", amount: 25, holdingId: "family:f1" }],
    expect.any(String),
    null,
  );
});
it("keeps the draft and displays a refused family payment rather than claiming success", async () => {
  render(
    <PaymentDialog
      totalCents={2500}
      lines={[]}
      customerId="c1"
      hasCustomer
      needsCustomer={false}
      hasManualDiscount={false}
      isPending={false}
      errorMessage="Family membership changed"
      onClose={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByText("Family membership changed")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("posts explicit whole-session performers without a seller or client rate", async () => {
  mocks.holdings.mockReturnValue({
    data: {
      holdings: [
        {
          id: "package-holding",
          kind: "PACKAGE",
          name: "Session package",
          quantityRemaining: 2,
          serviceIds: ["service"],
          expiresAt: null,
        },
      ],
    },
  });
  const onConfirm = vi.fn();
  render(
    <PaymentDialog
      totalCents={1000}
      lines={[{ itemType: "SERVICE", itemId: "service", quantity: 1, unitPriceCents: 1000 }]}
      staff={[{ id: "therapist", name: "Therapist" }]}
      customerId="c1"
      hasCustomer
      needsCustomer={false}
      hasManualDiscount={false}
      isPending={false}
      errorMessage={null}
      onClose={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
  await userEvent.selectOptions(screen.getByLabelText("Tender 1"), "PACKAGE");
  await userEvent.click(screen.getByRole("button", { name: "Commission attribution" }));
  expect(screen.queryByRole("button", { name: "Add seller" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add therapist" }));
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: /performers staff/i }),
    "therapist",
  );
  await userEvent.click(screen.getByRole("button", { name: "Save attribution" }));
  await userEvent.click(screen.getByRole("button", { name: "Take payment" }));
  expect(onConfirm).toHaveBeenCalledWith(
    [
      {
        method: "PACKAGE",
        amount: 10,
        holdingId: "package-holding",
        performers: [{ staffId: "therapist", share: 10000 }],
      },
    ],
    expect.any(String),
    null,
  );
});
