import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { CustomerHolding } from "@glampro_suite/shared";
import PaymentDialog from "../PaymentDialog";
import type { PaymentLine } from "@/lib/package-coverage";

const { holdings, post } = vi.hoisted(() => ({ holdings: vi.fn(), post: vi.fn() }));
vi.mock("@/hooks/useCustomers", () => ({ useCustomerHoldings: holdings }));
vi.mock("@/hooks/useSale", () => ({ useVoucherPreview: () => ({ isPending: false }) }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "cashier", globalRole: "CASHIER" } }),
}));
vi.mock("@/lib/api", () => ({ post, getErrorMessage: () => "Payment refused" }));
const people = [
  { id: "a", name: "Therapist A" },
  { id: "b", name: "Therapist B" },
  { id: "cashier", name: "Cashier" },
];
const holding = {
  id: "h1",
  kind: "PACKAGE",
  name: "Sessions",
  serviceIds: ["cut"],
  quantityRemaining: 3,
  paidSessionsRemaining: 3,
  expiresAt: null,
} as CustomerHolding;
const line: PaymentLine = {
  itemType: "SERVICE",
  itemId: "cut",
  quantity: 1,
  unitPriceCents: 5000,
  staffId: "a",
  attribution: {
    sellers: [{ staffId: "cashier", share: 10000 }],
    performers: [{ staffId: "a", share: 10000 }],
  },
};
beforeEach(() => {
  holdings.mockReturnValue({ data: { holdings: [holding] } });
  post.mockReset();
});
function mount(lines = [line], initial = true) {
  const onConfirm = vi.fn();
  const props = {
    totalCents: lines.reduce((sum, row) => sum + row.quantity * row.unitPriceCents, 0),
    lines,
    staff: people,
    customerId: "customer",
    hasCustomer: true,
    needsCustomer: false,
    hasManualDiscount: false,
    initialTender: initial ? { method: "PACKAGE" as const, holdingId: "h1" } : null,
    isPending: false,
    errorMessage: null,
    onClose: vi.fn(),
    onConfirm,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <PaymentDialog {...props} />
    </QueryClientProvider>,
  );
  return {
    onConfirm,
    props,
    ...view,
    rerenderPayment: (errorMessage: string) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <PaymentDialog {...props} errorMessage={errorMessage} />
        </QueryClientProvider>,
      ),
  };
}
it.each([true, false])(
  "defaults covered therapists for package panel/manual tender (initial=%s)",
  async (initial) => {
    const user = userEvent.setup();
    const { onConfirm } = mount([line], initial);
    if (!initial) await user.selectOptions(screen.getByLabelText("Tender 1"), "PACKAGE");
    expect(
      within(screen.getByRole("group", { name: "Performed by" })).getByText("Therapist A · 100%"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Take payment" }));
    expect(onConfirm).toHaveBeenCalledWith(
      [
        {
          method: "PACKAGE",
          amount: 50,
          holdingId: "h1",
          performers: [{ staffId: "a", share: 10000 }],
        },
      ],
      expect.any(String),
      null,
    );
    expect(post).not.toHaveBeenCalled(); // Cashiers cannot request commission amounts.
  },
);
it("retains an explicitly edited session split after a refused payment", async () => {
  const user = userEvent.setup();
  const { onConfirm, rerenderPayment } = mount();
  await user.click(screen.getByRole("button", { name: "Commission attribution" }));
  await user.selectOptions(screen.getByLabelText("performers staff 1"), "b");
  await user.click(screen.getByRole("button", { name: "Save attribution" }));
  await user.click(screen.getByRole("button", { name: "Take payment" }));
  rerenderPayment("Payment refused");
  expect(screen.getByText("Payment refused")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Take payment" }));
  expect(onConfirm.mock.calls[1]).toEqual(onConfirm.mock.calls[0]);
  expect(onConfirm.mock.calls[1]?.[0][0].performers).toEqual([{ staffId: "b", share: 10000 }]);
});
it("does not restore a cleared tender default during a rerender", async () => {
  const user = userEvent.setup();
  const { onConfirm, rerenderPayment } = mount();
  await user.click(screen.getByRole("button", { name: "Commission attribution" }));
  await user.click(screen.getByRole("button", { name: "Clear attribution" }));
  rerenderPayment("Review attribution");
  expect(screen.queryByRole("group", { name: "Performed by" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Take payment" }));
  expect(onConfirm.mock.calls[0]?.[0][0]).not.toHaveProperty("performers");
});
it("leaves mixed service-set therapists unavailable instead of inventing a price-weighted split", async () => {
  holdings.mockReturnValue({
    data: {
      holdings: [
        {
          ...holding,
          redemptionMode: "SERVICE_SET",
          serviceSet: [
            { serviceId: "cut", quantity: 1 },
            { serviceId: "nails", quantity: 1 },
          ],
        },
      ],
    },
  });
  const { onConfirm } = mount([
    line,
    {
      ...line,
      itemId: "nails",
      staffId: "b",
      attribution: { performers: [{ staffId: "b", share: 10000 }] },
    },
  ]);
  expect(screen.queryByRole("group", { name: "Performed by" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Take payment" }));
  expect(onConfirm.mock.calls[0]?.[0][0]).not.toHaveProperty("performers");
});
it("preserves identical splits across a complete service set and quantity", async () => {
  holdings.mockReturnValue({
    data: {
      holdings: [
        {
          ...holding,
          redemptionMode: "SERVICE_SET",
          serviceSet: [
            { serviceId: "cut", quantity: 1 },
            { serviceId: "nails", quantity: 1 },
          ],
        },
      ],
    },
  });
  const split = [
    { staffId: "a", share: 2500 },
    { staffId: "b", share: 7500 },
  ];
  const { onConfirm } = mount([
    { ...line, quantity: 2, attribution: { performers: split } },
    { ...line, itemId: "nails", quantity: 2, attribution: { performers: [...split].reverse() } },
  ]);
  await userEvent.click(screen.getByRole("button", { name: "Take payment" }));
  expect(onConfirm.mock.calls[0]?.[0][0]).toMatchObject({ amount: 200, performers: split });
});
it("allocates repeated holding tenders to separate covered-line performers", async () => {
  holdings.mockReturnValue({ data: { holdings: [{ ...holding, quantityRemaining: 1 }] } });
  const { onConfirm } = mount([
    line,
    { ...line, staffId: "b", attribution: { performers: [{ staffId: "b", share: 10000 }] } },
  ]);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add another tender" }));
  await user.selectOptions(screen.getByLabelText("Tender 2"), "PACKAGE");
  await user.click(screen.getByRole("button", { name: "Take payment" }));
  expect(
    onConfirm.mock.calls[0]?.[0].map((row: { performers: unknown }) => row.performers),
  ).toEqual([[{ staffId: "a", share: 10000 }], [{ staffId: "b", share: 10000 }]]);
  // Funding/holding limits remain authoritative server checks, not reservations.
  expect(screen.getAllByText(/Select a funded package/).length).toBeGreaterThan(0);
});
it("does not derive performers from a seller or offer session awards for prepaid credit", async () => {
  holdings.mockReturnValue({
    data: {
      holdings: [{ ...holding, id: "credit", kind: "PREPAID_CREDIT", amountRemaining: "50.00" }],
    },
  });
  const { onConfirm } = mount(
    [
      {
        ...line,
        staffId: undefined,
        attribution: { sellers: [{ staffId: "cashier", share: 10000 }] },
      },
    ],
    false,
  );
  await userEvent.selectOptions(screen.getByLabelText("Tender 1"), "PREPAID_CREDIT");
  expect(screen.queryByText("Estimated session commission")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Take payment" }));
  expect(onConfirm.mock.calls[0]?.[0][0]).toEqual({
    method: "PREPAID_CREDIT",
    holdingId: "credit",
    amount: 50,
  });
});
