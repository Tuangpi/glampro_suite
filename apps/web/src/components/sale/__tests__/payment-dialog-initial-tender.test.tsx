import { render as renderView, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import PaymentDialog from "../PaymentDialog";
function render(view: React.ReactNode) {
  return renderView(<QueryClientProvider client={new QueryClient()}>{view}</QueryClientProvider>);
}
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "payment-test-staff", globalRole: "CASHIER" } }),
}));

const mocks = vi.hoisted(() => ({ holdings: vi.fn() }));

vi.mock("@/hooks/useCustomers", () => ({ useCustomerHoldings: mocks.holdings }));
vi.mock("@/hooks/useSale", () => ({ useVoucherPreview: () => ({ isPending: false }) }));

/**
 * The till's package panel opens the sheet on a holding it has already chosen
 * (CP-008 f2 · N8). The preselect has to survive the mount, because the sheet is
 * re-created on every open: a cashier who clicked "Redeem 1" must not be asked to
 * pick the same package again, and must not silently tender cash instead.
 */
beforeEach(() => {
  mocks.holdings.mockReturnValue({
    data: {
      holdings: [
        {
          id: "h1",
          kind: "PACKAGE",
          name: "5-session cut",
          serviceIds: ["s1"],
          quantityRemaining: 3,
          amountRemaining: null,
          expiresAt: null,
          paidSessionsRemaining: 3,
        },
      ],
    },
  });
});

function mount(initialTender: { method: "PACKAGE" | "PREPAID_CREDIT"; holdingId: string } | null) {
  const onConfirm = vi.fn();
  render(
    <PaymentDialog
      totalCents={5000}
      lines={[{ itemType: "SERVICE", itemId: "s1", quantity: 1, unitPriceCents: 5000 }]}
      customerId="c1"
      hasCustomer
      needsCustomer={false}
      hasManualDiscount={false}
      initialTender={initialTender}
      isPending={false}
      errorMessage={null}
      onClose={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

it("opens on the holding the package panel chose, not on cash", () => {
  mount({ method: "PACKAGE", holdingId: "h1" });

  expect(screen.getByLabelText("Tender 1")).toHaveValue("PACKAGE");
  expect(screen.getByLabelText("Paid with (tender 1)")).toHaveValue("h1");
  // The covered service is the whole cart, so the row already pays for it.
  expect(screen.getByText("Paid in full.")).toBeInTheDocument();
});

it("posts the preselected redemption with the amount it derived", async () => {
  const user = userEvent.setup();
  const onConfirm = mount({ method: "PACKAGE", holdingId: "h1" });

  await user.click(screen.getByRole("button", { name: "Take payment" }));
  expect(onConfirm).toHaveBeenCalledWith(
    [{ method: "PACKAGE", amount: 50, holdingId: "h1" }],
    expect.any(String),
    null,
  );
});

it("still opens on cash when the till asked for no holding", () => {
  mount(null);

  expect(screen.getByLabelText("Tender 1")).toHaveValue("CASH");
});
