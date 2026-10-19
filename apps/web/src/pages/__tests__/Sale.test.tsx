/**
 * The till — handoff screens 01–02.
 *
 * What is worth pinning here is the behaviour the contracts make necessary:
 *
 * - **The category tabs are the server's `searchableKinds`**, not a list the
 *   browser keeps. An add-on the salon has not bought gets no tab, and a second
 *   tab does not fetch: one search answered every kind.
 * - **The cart re-prices a line from the customer** (`isMember`), because the
 *   search returns both prices for exactly that reason.
 * - **A granting line forces a customer** before payment, and the tender posts
 *   the whole cart with an idempotency key.
 * - **A suspended salon cannot ring anything up** — the shell says so and the
 *   API refuses, so the grid must not quietly fill a cart.
 *
 * `useSale` is mocked through `importActual`, so the cart reducers under test are
 * the real ones: `useSaleCart` is client state in the query cache and needs no
 * server. Only the two searches are replaced — `useCreateSale` stays real and its
 * network call (`post`) is the mock, so a successful write clears the cart exactly
 * as it does in the browser, and the idempotency key is the one that will ship.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SaleDetail, SaleItemKind, SaleSummary } from "@glampro_suite/shared";

const { useSaleItems, useSaleCustomers } = vi.hoisted(() => ({
  useSaleItems: vi.fn(),
  useSaleCustomers: vi.fn(),
}));

const { get, del, post, getErrorMessage } = vi.hoisted(() => ({
  get: vi.fn(),
  del: vi.fn(),
  post: vi.fn(),
  getErrorMessage: vi.fn<() => string>(() => "Something went wrong."),
}));

vi.mock("@/lib/api", () => ({
  get,
  getPaginated: vi.fn(),
  post,
  patch: vi.fn(),
  del,
  getErrorMessage,
}));

vi.mock("@/hooks/useSale", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useSale")>("@/hooks/useSale");
  return { ...actual, useSaleItems, useSaleCustomers };
});

const { useServiceList, useStaffList } = vi.hoisted(() => ({
  useServiceList: vi.fn(),
  useStaffList: vi.fn(),
}));

vi.mock("@/hooks/useServices", () => ({ useServiceList }));
vi.mock("@/hooks/useStaff", () => ({ useStaffList }));

const isReadOnly = vi.hoisted(() => ({ value: false }));
/** The signed-in role, writable per test so the void action can be asserted absent. */
const role = vi.hoisted(() => ({ value: "SUPER_ADMIN" }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isReadOnly: isReadOnly.value,
    tenant: { id: "tenant-1" },
    user: { id: "user-1", globalRole: role.value },
  }),
}));

const { default: Sale } = await import("@/pages/Sale");

const SERVICE = {
  kind: "SERVICE",
  id: "s1",
  name: "Root colour",
  price: "80.00",
  memberPrice: "70.00",
  points: 5,
  durationMinutes: 90,
};

const PRODUCT = {
  kind: "PRODUCT",
  id: "p1",
  name: "Shampoo",
  price: "12.50",
  memberPrice: null,
  points: 1,
  quantity: 7,
  lowStock: false,
};

const PACKAGE = {
  kind: "PACKAGE",
  id: "k1",
  name: "Five-cut bundle",
  price: "250.00",
  memberPrice: "225.00",
  sessionCount: 5,
  serviceCount: 2,
};

const CUSTOMER = {
  id: "c1",
  code: null,
  name: "Mrs Loi",
  memberId: "M-88",
  email: "mrsloi88@gmail.com",
  phone: "9030 9386",
  gender: null,
  dateOfBirth: null,
  address: null,
  comment: null,
  createdAt: "2021-03-04T00:00:00.000Z",
  updatedAt: "2021-03-04T00:00:00.000Z",
};

/** The search result the page destructures, with the flags defaulted. */
function itemsResult(searchableKinds: SaleItemKind[], items: unknown[]) {
  return {
    data: { searchableKinds, items },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  };
}

function listResult(rows: unknown[]) {
  return {
    data: { data: rows, total: rows.length, page: 1, pageSize: 200, pageCount: 1 },
    isPending: false,
    isError: false,
  };
}

/** A receipt shaped like `saleDetailSchema`, for the write's success path. */
function receipt(overrides: Partial<SaleDetail> = {}): SaleDetail {
  return {
    id: "sale-1",
    receiptNumber: 1042,
    status: "COMPLETED",
    paymentStatus: "PAID",
    soldAt: "2026-03-04T10:15:00.000Z",
    customerId: null,
    customerName: null,
    staffId: "u1",
    staffName: "Ava Owner",
    note: null,
    voidedAt: null,
    voidReason: null,
    voidedByName: null,
    totalQuantity: 1,
    totalAmount: "80.00",
    paidAmount: "80.00",
    discountAmount: "0.00",
    taxAmount: "6.61",
    taxRate: "9.00",
    outstandingAmount: "0.00",
    pointsEarned: 5,
    lines: [
      {
        id: "l1",
        itemType: "SERVICE",
        itemId: "s1",
        itemName: "Root colour",
        quantity: 1,
        unitPrice: "80.00",
        lineTotal: "80.00",
        discountPercent: "0.00",
        discountAmount: "0.00",
        taxAmount: "6.61",
        taxRate: "9.00",
        staffId: null,
        staffName: null,
      },
    ],
    payments: [{ method: "CASH", amount: "80.00", sessionId: null }],
    ...overrides,
  };
}

function renderSale() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <Sale />
    </QueryClientProvider>,
  );
}

/** The cart panel's own region, found by its heading so grid prices are excluded. */
function cartPanel(): HTMLElement {
  return screen.getByRole("heading", { name: "Cart" }).closest("section") as HTMLElement;
}

beforeEach(() => {
  isReadOnly.value = false;
  role.value = "SUPER_ADMIN";
  useSaleItems.mockReturnValue(itemsResult(["SERVICE", "PRODUCT"], [SERVICE, PRODUCT]));
  useSaleCustomers.mockReturnValue(listResult([CUSTOMER]));
  useServiceList.mockReturnValue(listResult([]));
  useStaffList.mockReturnValue(listResult([]));
  getErrorMessage.mockReturnValue("Something went wrong.");
  post.mockReset().mockResolvedValue(receipt());
  // The salon has nothing parked unless a test says so; `get` is what reads the hold
  // list, a held cart and its customer.
  get.mockReset().mockResolvedValue({ items: [] });
  del.mockReset().mockResolvedValue({ id: "sale-9" });
});

describe("performer identities", () => {
  it("deduplicates account options, distinguishes equal names and posts the selected ID", async () => {
    const user = userEvent.setup();
    const sam = {
      id: "sam-a",
      name: "Sam Lee",
      email: "sam.a@example.test",
      departments: [{ id: "hair" }],
    };
    useServiceList.mockReturnValue(listResult([{ id: "s1", departmentId: "hair" }]));
    useStaffList.mockReturnValue(
      listResult([
        sam,
        sam,
        { ...sam, id: "sam-b", email: "sam.b@example.test" },
        { ...sam, id: "nails", email: "nails@example.test", departments: [{ id: "nails" }] },
      ]),
    );
    renderSale();
    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    const picker = screen.getByRole("combobox", { name: "Who performed Root colour" });
    expect(
      within(picker).getAllByRole("option", { name: "Sam Lee (sam.a@example.test)" }),
    ).toHaveLength(1);
    expect(
      within(picker).getByRole("option", { name: "Sam Lee (sam.b@example.test)" }),
    ).toHaveValue("sam-b");
    expect(within(picker).queryByRole("option", { name: /nails@example/ })).not.toBeInTheDocument();
    await user.selectOptions(picker, "sam-b");
    await user.click(screen.getByRole("button", { name: "Take payment" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Take payment" }),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/sales",
        expect.objectContaining({
          lines: [{ itemType: "SERVICE", itemId: "s1", quantity: 1, staffId: "sam-b" }],
        }),
      ),
    );
  });
});

describe("the category tabs", () => {
  it("draws one per kind the server named, and no other", () => {
    renderSale();

    expect(screen.getByRole("tab", { name: "Services" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Products" })).toBeInTheDocument();
    // The salon has not bought Packages, so `/sales/items` left the kind out.
    expect(screen.queryByRole("tab", { name: "Packages" })).not.toBeInTheDocument();
  });

  it("shows the active tab's rows only", async () => {
    const user = userEvent.setup();
    renderSale();

    expect(screen.getByText("Root colour")).toBeInTheDocument();
    expect(screen.queryByText("Shampoo")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Products" }));

    expect(screen.getByText("Shampoo")).toBeInTheDocument();
  });
});

describe("the cart", () => {
  it("explains checkout without server implementation details", () => {
    renderSale();

    expect(
      screen.getByText("Add services and products to the cart, then take payment."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/the server charges/i)).not.toBeInTheDocument();
  });

  it("adds a line and totals it in cents", async () => {
    const user = userEvent.setup();
    renderSale();

    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));

    expect(within(cartPanel()).getByText("1 line · 1 item")).toBeInTheDocument();
    // Twice: the line's own total and the cart's total — one item at one price.
    expect(within(cartPanel()).getAllByText("S$80.00")).toHaveLength(2);
    expect(screen.getByLabelText("Quantity of Root colour")).toHaveValue(1);
  });

  it("grows a line rather than adding a second one", async () => {
    const user = userEvent.setup();
    renderSale();

    // A product lives on the Products tab, and only the active panel is drawn.
    await user.click(screen.getByRole("tab", { name: "Products" }));

    const add = screen.getByRole("button", { name: "Add Shampoo to the cart, S$12.50" });
    await user.click(add);
    await user.click(add);

    expect(within(cartPanel()).getByText("1 line · 2 items")).toBeInTheDocument();
    expect(within(cartPanel()).getAllByText("S$25.00")).toHaveLength(2);
  });

  it("re-prices every line for the customer's membership", async () => {
    const user = userEvent.setup();
    renderSale();

    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    expect(within(cartPanel()).getAllByText("S$80.00")).toHaveLength(2);

    // The member price is applied by the cart, not at add time — the search returns
    // both prices for exactly this reason.
    await user.type(screen.getByLabelText("Attach a customer by name or phone"), "Mrs");
    await user.click(await screen.findByRole("button", { name: "Attach Mrs Loi, member" }));

    await waitFor(() => {
      expect(within(cartPanel()).getAllByText("S$70.00")).toHaveLength(2);
    });
  });

  it("restores the unfinished cart and customer after a browser reload", async () => {
    const user = userEvent.setup();
    const first = renderSale();

    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    await user.type(screen.getByLabelText("Attach a customer by name or phone"), "Mrs");
    await user.click(await screen.findByRole("button", { name: "Attach Mrs Loi, member" }));
    await waitFor(() => expect(within(cartPanel()).getAllByText("S$70.00")).toHaveLength(2));

    first.unmount();
    renderSale();

    expect(await screen.findByText("1 line · 1 item")).toBeInTheDocument();
    expect(screen.getByText("Mrs Loi")).toBeInTheDocument();
    expect(within(cartPanel()).getAllByText("S$70.00")).toHaveLength(2);
  });
});

describe("taking payment", () => {
  it("posts the whole cart with one idempotency key and draws the receipt", async () => {
    const user = userEvent.setup();
    renderSale();

    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    await user.click(screen.getByRole("button", { name: "Take payment" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Take payment" }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith("/sales", {
        lines: [{ itemType: "SERVICE", itemId: "s1", quantity: 1 }],
        payments: [{ method: "CASH", amount: 80 }],
        // Q16: minted per attempt, so a double-tap replays rather than re-charges.
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{32,36}$/),
      });
    });

    // The receipt replaces the till: the grid is gone and one action is offered.
    expect(await screen.findByText("Receipt #1042")).toBeInTheDocument();
    expect(screen.getByText("Sale rung up as receipt #1042.")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Services" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New sale" }));

    // The cart was cleared by the write itself (`useCreateSale`), so the next sale
    // starts from nothing rather than from the last customer's shopping.
    expect(screen.getByRole("tab", { name: "Services" })).toBeInTheDocument();
    expect(within(cartPanel()).getByText("The cart is empty")).toBeInTheDocument();
    expect(within(cartPanel()).queryByText("1 line · 1 item")).not.toBeInTheDocument();
  });

  it("shows the GST included in the total, without changing what was paid", async () => {
    const user = userEvent.setup();
    renderSale();

    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    await user.click(screen.getByRole("button", { name: "Take payment" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Take payment" }),
    );

    await screen.findByText("Receipt #1042");

    // Inclusive GST: the line is still S$80.00 and the tax is explained inside it.
    expect(screen.getByText("Includes GST (9%)")).toBeInTheDocument();
    expect(screen.getByText("S$6.61")).toBeInTheDocument();
    // The line, the total and the tender all still read S$80.00.
    expect(screen.getAllByText("S$80.00").length).toBeGreaterThan(0);
  });

  it("mints a fresh key per attempt, so a second attempt is a second sale", async () => {
    const user = userEvent.setup();
    renderSale();

    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));

    await user.click(screen.getByRole("button", { name: "Take payment" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Take payment" }),
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

    // Dismiss the receipt, which is what closes the first attempt's dialog.
    await user.click(await screen.findByRole("button", { name: "New sale" }));

    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    await user.click(screen.getByRole("button", { name: "Take payment" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Take payment" }),
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));

    const [first, second] = post.mock.calls;
    expect(first?.[1].idempotencyKey).not.toBe(second?.[1].idempotencyKey);
  });

  it("will not post a granting cart until a customer is attached", async () => {
    const user = userEvent.setup();
    useSaleItems.mockReturnValue(
      itemsResult(["SERVICE", "PRODUCT", "PACKAGE"], [SERVICE, PACKAGE]),
    );
    renderSale();

    // The bundle is on its own tab, which exists only because the server named it.
    await user.click(screen.getByRole("tab", { name: "Packages" }));
    await user.click(
      screen.getByRole("button", { name: "Add Five-cut bundle to the cart, S$250.00" }),
    );
    await user.click(screen.getByRole("button", { name: "Take payment" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Pick a customer first/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Take payment" })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with the server's own reason", async () => {
    const user = userEvent.setup();
    getErrorMessage.mockReturnValue("That customer does not exist.");
    post.mockRejectedValue(new Error("Not found"));

    renderSale();
    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    await user.click(screen.getByRole("button", { name: "Take payment" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Take payment" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "That customer does not exist.",
    );
    // Still open, so the cashier can fix it and retry the same attempt.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("printing the receipt", () => {
  it("hands the drawn receipt to the browser's print dialog", async () => {
    // jsdom prints "Not implemented" to the console instead of opening a dialog,
    // so the call is observed rather than performed.
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const user = userEvent.setup();
    renderSale();

    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    await user.click(screen.getByRole("button", { name: "Take payment" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Take payment" }),
    );

    await screen.findByText("Receipt #1042");
    await user.click(screen.getByRole("button", { name: "Print" }));

    // The whole receipt is already on screen with the server's numbers, so print
    // is the browser's own dialog over it — no PDF round-trip, and "Save as PDF"
    // comes with it. It is excluded from its own output with `print:hidden`.
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Print" })).toHaveClass("print:hidden");
  });
});

describe("a suspended salon", () => {
  it("cannot fill a cart at all", async () => {
    isReadOnly.value = true;
    const user = userEvent.setup();
    renderSale();

    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));

    expect(within(cartPanel()).getByText("The cart is empty")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Take payment" })).not.toBeInTheDocument();
  });
});

/**
 * One row of the hold list, typed as the contract's own `SaleSummary` so a field
 * renamed on the server is a compile error here rather than a blank row.
 */
const HELD_ROW: SaleSummary = {
  id: "sale-9",
  receiptNumber: null,
  status: "HELD",
  soldAt: "2026-03-04T10:15:00.000Z",
  customerId: "c1",
  customerName: "Mrs Loi",
  staffId: "u1",
  staffName: "Ava Owner",
  note: null,
  lineCount: 1,
  totalQuantity: 1,
  totalAmount: "80.00",
};

/** That hold as `GET /api/sales/sale-9` answers: the receipt-shaped cart, unpaid. */
function heldCart(): SaleDetail {
  return receipt({
    id: "sale-9",
    receiptNumber: null,
    status: "HELD",
    paymentStatus: "UNPAID",
    // The cart is for a named customer, which is what a resumed till re-attaches so
    // the lines are priced for them.
    customerId: "c1",
    customerName: "Mrs Loi",
    paidAmount: "0.00",
    outstandingAmount: "80.00",
    pointsEarned: 0,
    payments: [],
  });
}

/** Points `get` at the hold list, the parked cart and its customer. */
function withHeldCart(rows: SaleSummary[] = [HELD_ROW]) {
  get.mockImplementation((url: string) => {
    if (url === "/customers/c1") return Promise.resolve(CUSTOMER);
    if (url === "/sales/sale-9") return Promise.resolve(heldCart());
    if (url === "/sales") return Promise.resolve({ items: rows });
    return Promise.resolve(undefined);
  });
}

/** The held-carts card, found by its heading so the cart's own region is excluded. */
function heldPanel(): HTMLElement {
  return screen.getByRole("heading", { name: "Held carts" }).closest("section") as HTMLElement;
}

describe("holding a cart", () => {
  it("parks it instead of ringing it up, and the cart goes with it", async () => {
    const user = userEvent.setup();
    renderSale();

    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    await user.click(screen.getByRole("button", { name: "Hold" }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith("/sales", {
        lines: [{ itemType: "SERVICE", itemId: "s1", quantity: 1 }],
        // No tender and no key: a held sale takes no payment (ADR 0015).
        hold: true,
      });
    });

    // The cart is a row now, so the till starts from nothing and no tender dialog
    // was ever opened on this path.
    expect(within(cartPanel()).getByText("The cart is empty")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows what the salon has parked, and who parked it", async () => {
    withHeldCart();
    renderSale();

    expect(await screen.findByText("Held by Ava Owner")).toBeInTheDocument();
    expect(screen.getByText("1 cart waiting.")).toBeInTheDocument();
    expect(within(heldPanel()).getByText("Mrs Loi")).toBeInTheDocument();
    // The row is a summary, not the cart: the lines arrive when it is opened.
    expect(within(heldPanel()).getByText(/1 item/)).toBeInTheDocument();
  });

  it("abandons one when the cashier discards it", async () => {
    withHeldCart();
    const user = userEvent.setup();
    renderSale();

    await user.click(
      await screen.findByRole("button", { name: "Discard the cart held by Ava Owner" }),
    );

    await waitFor(() => expect(del).toHaveBeenCalledWith("/sales/sale-9"));
  });
});

describe("picking a parked cart up", () => {
  it("fills the till, then completes the hold instead of creating a sale", async () => {
    withHeldCart();
    post.mockResolvedValue(receipt({ id: "sale-9", receiptNumber: 77 }));
    const user = userEvent.setup();
    renderSale();

    await user.click(await screen.findByRole("button", { name: "Pick up" }));

    // The lines come back at the price they were parked with: a stored line carries one
    // figure rather than the catalogue's member/non-member pair, and the server re-prices
    // everything at completion.
    expect(await screen.findByText("1 line · 1 item")).toBeInTheDocument();
    expect(within(cartPanel()).getAllByText("S$80.00")).toHaveLength(2);
    expect(screen.getByText(/Ringing up the/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Take payment" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Take payment" }),
    );

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith("/sales/sale-9/complete", {
        customerId: "c1",
        lines: [{ itemType: "SERVICE", itemId: "s1", quantity: 1 }],
        payments: [{ method: "CASH", amount: 80 }],
      });
    });

    // The hold took the money rather than a second sale being written: the receipt is the
    // row the cart was parked as, which is what the id in the URL says.
    expect(await screen.findByText("Receipt #77")).toBeInTheDocument();
  });

  it("leaves the hold parked when the cashier puts the cart back", async () => {
    withHeldCart();
    const user = userEvent.setup();
    renderSale();

    await user.click(await screen.findByRole("button", { name: "Pick up" }));
    await screen.findByText(/Ringing up the/);

    await user.click(screen.getByRole("button", { name: "Leave it held" }));

    expect(within(cartPanel()).getByText("The cart is empty")).toBeInTheDocument();
    // Nothing was written either way: the cart is still on the list.
    expect(post).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});

/** Rings a sale up through the UI, so the receipt is on screen for the void tests. */
async function ringUpAReceipt(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
  await user.click(screen.getByRole("button", { name: "Take payment" }));
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", { name: "Take payment" }),
  );
  await screen.findByText("Receipt #1042");
}

describe("discounting a line", () => {
  it("prices the line, shows a Discount row, and posts the rate rather than a price", async () => {
    const user = userEvent.setup();
    renderSale();

    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));

    // The rate is committed on blur, the same way the quantity is, so typing "1" of "10"
    // never briefly sets one percent.
    const discount = screen.getByLabelText("Discount percent for Root colour");
    await user.type(discount, "25");
    await user.tab();

    // 80.00 less a quarter is 60.00 — the cart re-prices the line from the rate, in cents.
    await waitFor(() => {
      expect(within(cartPanel()).getAllByText("S$60.00").length).toBeGreaterThan(0);
    });
    expect(within(cartPanel()).getByText("Discount")).toBeInTheDocument();
    expect(within(cartPanel()).getByText("−S$20.00")).toBeInTheDocument();
    expect(within(cartPanel()).getByText(/25% off S\$80\.00/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Take payment" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Take payment" }),
    );

    // The body carries the **rate**: the server turns it into money against the
    // catalogue's own price, which is the thing the till must not be able to name.
    await waitFor(() => {
      expect(post).toHaveBeenCalledWith("/sales", {
        lines: [{ itemType: "SERVICE", itemId: "s1", quantity: 1, discountPercent: 25 }],
        payments: [{ method: "CASH", amount: 60 }],
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{32,36}$/),
      });
    });
  });

  it("clears the discount when the box is emptied, so no rate is posted", async () => {
    const user = userEvent.setup();
    renderSale();

    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));

    const discount = screen.getByLabelText("Discount percent for Root colour");
    await user.type(discount, "10");
    await user.tab();
    await waitFor(() => expect(within(cartPanel()).getByText("Discount")).toBeInTheDocument());

    await user.clear(discount);
    await user.tab();

    // A line nobody discounted sends no rate at all, so the receipt says nothing about a
    // discount that was taken off again.
    await waitFor(() =>
      expect(within(cartPanel()).queryByText("Discount")).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Take payment" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Take payment" }),
    );

    await waitFor(() => {
      const [call] = post.mock.calls;
      expect(call?.[1].lines[0]).toEqual({ itemType: "SERVICE", itemId: "s1", quantity: 1 });
    });
  });
});

describe("voiding a rung-up sale", () => {
  it("asks for a reason, posts it, and draws the voided receipt the server sent back", async () => {
    const user = userEvent.setup();
    renderSale();
    await ringUpAReceipt(user);

    await user.click(screen.getByRole("button", { name: "Void sale" }));

    const dialog = await screen.findByRole("dialog");
    // The reason is required by the contract, so the button waits for one that would pass.
    expect(within(dialog).getByRole("button", { name: "Void it" })).toBeDisabled();

    post.mockResolvedValueOnce(
      receipt({
        status: "VOID",
        voidedAt: "2026-03-04T11:00:00.000Z",
        voidReason: "Rung up twice",
        voidedByName: "Ava Owner",
      }),
    );

    await user.type(within(dialog).getByLabelText("Reason for voiding this sale"), "Rung up twice");
    await user.click(within(dialog).getByRole("button", { name: "Void it" }));

    // The actor is not in the body: the API takes it from the token (ADR 0016).
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/sales/sale-1/void", { reason: "Rung up twice" }),
    );

    // The banner and the badge come from the server's own row, not from the browser
    // guessing at the new state.
    expect(await screen.findByText(/^Voided on/)).toBeInTheDocument();
    expect(screen.getByText("Rung up twice")).toBeInTheDocument();
    expect(screen.getByText("Void")).toBeInTheDocument();
    // And the action is gone: a voided sale has nothing left to take off the books.
    expect(screen.queryByRole("button", { name: "Void sale" })).not.toBeInTheDocument();
  });

  it("keeps the dialog open with the server's refusal", async () => {
    const user = userEvent.setup();
    getErrorMessage.mockReturnValue("Credit this sale granted has already been used.");
    renderSale();
    await ringUpAReceipt(user);

    post.mockRejectedValueOnce(new Error("Conflict"));

    await user.click(screen.getByRole("button", { name: "Void sale" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason for voiding this sale"), "Wrong bundle");
    await user.click(within(dialog).getByRole("button", { name: "Void it" }));

    // A refusal is usually something the manager can act on, so it is shown in place
    // rather than thrown away with the dialog.
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Credit this sale granted has already been used.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("offers no void action to a cashier", async () => {
    role.value = "STAFF";
    const user = userEvent.setup();
    renderSale();
    await ringUpAReceipt(user);

    // The server would 403 anyway; a button that always fails is worse than none.
    expect(screen.queryByRole("button", { name: "Void sale" })).not.toBeInTheDocument();
  });
});
