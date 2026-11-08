import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import CartLine, { type CartLineProps } from "./CartLine";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "cashier", globalRole: "CASHIER" } }),
}));

function mount() {
  const props: CartLineProps = {
    line: {
      itemType: "SERVICE",
      itemId: "facial",
      name: "Facial treatment",
      quantity: 1,
      price: "120.00",
      memberPrice: null,
      staffId: "sarah",
      attribution: {
        sellers: [{ staffId: "sarah", share: 10000 }],
        performers: [{ staffId: "sarah", share: 10000 }],
      },
    },
    unitPrice: "120.00",
    listPrice: "120.00",
    attribution: "service",
    staffOptions: [{ id: "sarah", name: "Sarah" }],
    sellerOptions: [{ id: "sarah", name: "Sarah" }],
    disabled: false,
    onQuantity: vi.fn(),
    onStaff: vi.fn(),
    onDiscount: vi.fn(),
    onRemove: vi.fn(),
    onAttribution: vi.fn(),
    editing: false,
    onEdit: vi.fn(),
  };
  function EditableLine() {
    const [editing, setEditing] = useState(false);
    return <CartLine {...props} editing={editing} onEdit={() => setEditing(!editing)} />;
  }
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ul>
        <EditableLine />
      </ul>
    </QueryClientProvider>,
  );
  return props;
}

it("puts the item before allocation controls and keeps saved staff summaries visible", () => {
  mount();
  const item = screen.getByText("Facial treatment");
  const editor = screen.getByRole("button", { name: "Edit details" });
  expect(item.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(
    within(screen.getByRole("group", { name: "Sold by" })).getByText("Sold by: Sarah · 100%"),
  ).toBeVisible();
  expect(
    within(screen.getByRole("group", { name: "Performed by" })).getByText(
      "Performed by: Sarah · 100%",
    ),
  ).toBeVisible();
  expect(editor).toHaveAttribute("aria-expanded", "false");
});

it("mounts commission estimates only on expansion without changing attribution", async () => {
  const user = userEvent.setup();
  const props = mount();
  await user.click(screen.getByRole("button", { name: "Edit Facial treatment" }));
  expect(
    screen.getByRole("combobox", { name: "Who performed Facial treatment" }),
  ).toHaveDisplayValue("Sarah");
  const details = screen.getByText("Commission estimate").closest("details")!;
  expect(details).not.toHaveAttribute("open");
  expect(
    screen.queryByRole("region", { name: "Estimated line commission" }),
  ).not.toBeInTheDocument();
  // Explicit toggle events also exercise the native details contract in jsdom.
  details.open = true;
  fireEvent(details, new Event("toggle"));
  expect(await screen.findByRole("region", { name: "Estimated line commission" })).toBeVisible();
  expect(props.onAttribution).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Commission attribution" }));
  expect(screen.getByRole("button", { name: "Close commission attribution" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(screen.getByRole("button", { name: "Save attribution" })).toBeVisible();
});
