import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import CartPanel, { type CartPanelProps } from "./CartPanel";

function props(overrides: Partial<CartPanelProps> = {}): CartPanelProps {
  return {
    lines: [
      {
        itemType: "SERVICE",
        itemId: "s1",
        name: "Root colour",
        quantity: 2,
        price: "80.00",
        memberPrice: "70.00",
        discountPercent: 25,
      },
    ],
    isMember: false,
    staffForService: () => [{ id: "stylist", name: "Alex" }],
    needsCustomer: false,
    disabled: false,
    onQuantity: vi.fn(),
    onStaff: vi.fn(),
    onDiscount: vi.fn(),
    onRemove: vi.fn(),
    onClear: vi.fn(),
    onCheckout: vi.fn(),
    onHold: vi.fn(),
    holdPending: false,
    ...overrides,
  };
}

describe("CartPanel", () => {
  it.each([1, 3, 6])(
    "keeps all %i rows in a naturally growing body, separate from checkout",
    (count) => {
      const values = props();
      render(
        <CartPanel
          {...values}
          lines={Array.from({ length: count }, (_, index) => ({
            ...values.lines[0]!,
            itemId: `service-${index}`,
            name: `Service ${index + 1}`,
          }))}
        />,
      );
      const cart = screen.getByRole("region", { name: "Sale cart" });
      const list = within(cart).getByRole("list", { name: "Cart items" });
      expect(within(list).getAllByRole("button", { name: /^Edit Service/ })).toHaveLength(count);
      expect(cart).toHaveClass("overflow-visible");
      expect(cart).not.toHaveClass("[&>div]:overflow-y-auto", "lg:flex-1");
      expect(
        screen.getByRole("button", { name: "Take payment" }).closest("footer"),
      ).not.toContainElement(list);
    },
  );

  it("edits one line at a time without changing staff or discounts on open/close", async () => {
    const user = userEvent.setup();
    const values = props();
    render(
      <CartPanel
        {...values}
        lines={[values.lines[0]!, { ...values.lines[0]!, itemId: "s2", name: "Facial" }]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Edit Root colour" }));
    expect(screen.getByRole("combobox", { name: "Who performed Root colour" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Edit Facial" }));
    expect(
      screen.queryByRole("combobox", { name: "Who performed Root colour" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Who performed Facial" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(values.onStaff).not.toHaveBeenCalled();
    expect(values.onDiscount).not.toHaveBeenCalled();
  });

  it("keeps unavailable staff visible when a row is closed and in its editor", async () => {
    const user = userEvent.setup();
    const values = props();
    render(<CartPanel {...values} lines={[{ ...values.lines[0]!, staffId: "former-staff" }]} />);
    expect(screen.getByText("Therapist: Unavailable staff")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Edit Root colour" }));
    expect(screen.getByRole("combobox", { name: "Who performed Root colour" })).toHaveDisplayValue(
      "Unavailable staff — select another",
    );
  });

  it("summarizes units and staff without exposing an editing form", () => {
    render(<CartPanel {...props()} />);
    expect(screen.getByRole("heading", { name: "Cart" })).toBeInTheDocument();
    expect(screen.getByText("2 items")).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("Therapist: Unassigned")).toBeVisible();
    expect(screen.getByText("25% off", { exact: false })).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("counts quantities across rows and omits staff selection for products", () => {
    const values = props();
    render(
      <CartPanel
        {...values}
        lines={[
          { ...values.lines[0]!, quantity: 1 },
          {
            itemType: "PRODUCT",
            itemId: "p1",
            name: "Shampoo",
            quantity: 3,
            price: "20.00",
            memberPrice: null,
          },
        ]}
      />,
    );
    expect(screen.getByText("4 items")).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Who performed Shampoo")).not.toBeInTheDocument();
  });

  it("shows exact subtotal, discount and total with separate checkout actions", async () => {
    const user = userEvent.setup();
    const callbacks = props();
    render(<CartPanel {...callbacks} />);
    const footer = screen.getByText("Total").parentElement!.parentElement!;
    expect(within(footer).getByText("S$160.00")).toBeInTheDocument();
    expect(within(footer).getByText("−S$40.00")).toBeInTheDocument();
    expect(within(footer).getByText("S$120.00")).toBeInTheDocument();
    const payment = screen.getByRole("button", { name: "Take payment" });
    const hold = screen.getByRole("button", { name: "Hold cart" });
    expect(payment.parentElement).toBe(hold.parentElement);
    expect(payment.parentElement).toHaveClass("flex", "gap-2");
    expect(payment.parentElement).not.toHaveClass("flex-col");
    expect(payment.parentElement!.firstElementChild).toBe(hold);
    expect(payment).toHaveClass("h-control");
    expect(hold).toHaveClass("h-control");
    await user.click(payment);
    await user.click(hold);
    expect(callbacks.onCheckout).toHaveBeenCalledOnce();
    expect(callbacks.onHold).toHaveBeenCalledOnce();
  });

  it("requires confirmation to clear, and allows keeping the cart", async () => {
    const user = userEvent.setup();
    const callbacks = props();
    render(<CartPanel {...callbacks} />);
    await user.click(screen.getByRole("button", { name: "Clear cart" }));
    expect(callbacks.onClear).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep cart" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(callbacks.onClear).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Clear cart" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Clear cart" }),
    );
    expect(callbacks.onClear).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("groups quantity controls and keeps discount editing collapsible", async () => {
    const user = userEvent.setup();
    const callbacks = props();
    render(<CartPanel {...callbacks} />);
    const group = screen.getByRole("group", { name: "Quantity controls for Root colour" });
    await user.click(within(group).getByRole("button", { name: "One more Root colour" }));
    expect(callbacks.onQuantity).toHaveBeenLastCalledWith("SERVICE:s1:", 3);
    await user.click(screen.getByRole("button", { name: "Edit Root colour" }));
    const edit = screen.getByRole("button", { name: "Edit discount" });
    expect(edit).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Discount percent for Root colour")).not.toBeVisible();
    await user.click(edit);
    const input = screen.getByLabelText("Discount percent for Root colour");
    await user.clear(input);
    await user.type(input, "10");
    await user.tab();
    expect(callbacks.onDiscount).toHaveBeenLastCalledWith("SERVICE:s1:", 10);
    await user.click(screen.getByRole("button", { name: "Close discount" }));
    expect(input).not.toBeVisible();
    await user.selectOptions(screen.getByLabelText("Who performed Root colour"), "stylist");
    expect(callbacks.onStaff).toHaveBeenLastCalledWith("SERVICE:s1:", "stylist");
    await user.click(screen.getByRole("button", { name: "Remove Root colour from the cart" }));
    expect(callbacks.onRemove).toHaveBeenCalledWith("SERVICE:s1:");
  });

  it.each([{ disabled: true }, { holdPending: true }])(
    "locks all cart controls while unavailable: %j",
    (state) => {
      render(<CartPanel {...props(state)} />);
      for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
      expect(screen.getByLabelText("Quantity of Root colour")).toBeDisabled();
      expect(screen.getByLabelText("Who performed Root colour")).toBeDisabled();
    },
  );

  it("blocks incrementing beyond the existing quantity limit", () => {
    const values = props();
    render(<CartPanel {...values} lines={[{ ...values.lines[0]!, quantity: 10_000 }]} />);
    expect(screen.getByRole("button", { name: "One more Root colour" })).toBeDisabled();
  });

  it("shows customer guidance only when requested", () => {
    const { rerender } = render(<CartPanel {...props({ needsCustomer: true })} />);
    expect(screen.getByRole("status")).toHaveTextContent("pick a customer");
    rerender(<CartPanel {...props()} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the empty state without checkout or clear actions", () => {
    render(<CartPanel {...props({ lines: [] })} />);
    expect(screen.getByText("0 items")).toBeVisible();
    expect(screen.getByText("The cart is empty")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
