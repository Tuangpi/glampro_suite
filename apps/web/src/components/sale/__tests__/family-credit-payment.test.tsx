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
