/**
 * The till — handoff screens 01–02.
 *
 * What is worth pinning here is the behaviour the contracts make necessary:
 *
 * - **The category tabs are the server's `searchableKinds`**, not a list the
 *   browser keeps. An add-on the salon has not bought gets no tab, and a second
 *   tab fetches only its own bounded catalog page.
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

const { useCartServices, useStaffList } = vi.hoisted(() => ({
  useCartServices: vi.fn(),
  useStaffList: vi.fn(),
}));

vi.mock("@/hooks/useServices", () => ({ useCartServices }));
vi.mock("@/hooks/useStaff", () => ({ useStaffList }));
// This panel's API and retry/return behavior has its own focused tests.
vi.mock("@/components/sale/DirectTipsPanel", () => ({ default: () => null }));

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
const { cartLinesFrom, lineUnitPrice } = await import("@/hooks/useSale");

const SERVICE = {
  kind: "SERVICE" as const,
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
    gstRegistrationNumber: "GST-123",
    voucherCode: null,
    voucherDiscountAmount: "0.00",
    refundedAt: null,
    refundAmount: null,
    refundReason: null,
    refundedByName: null,
    refundRestocked: null,
    refundPayouts: [],
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
        voucherDiscountAmount: "0.00",
        netLineTotal: "80.00",
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

function renderSale(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
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
  useCartServices.mockReturnValue([{ data: { id: "s1", departmentId: null } }]);
  useStaffList.mockReturnValue(listResult([]));
  getErrorMessage.mockReturnValue("Something went wrong.");
  post.mockReset().mockResolvedValue(receipt());
  // The salon has nothing parked unless a test says so; `get` is what reads the hold
  // list, a held cart and its customer.
  get.mockReset().mockResolvedValue({ items: [] });
  del.mockReset().mockResolvedValue({ id: "sale-9" });
});

describe("sale workspace", () => {
  it("records a later payment from the receipt using current debt rather than checkout totals", async () => {
    const state = {
      saleId: "sale-1",
      currency: "SGD",
      canCollect: true,
      outstandingCents: "5900",
      lines: [
        {
          saleLineId: "line-1",
          itemName: "Root colour",
          contractedGrossCents: "8000",
          allocatedGrossCents: "2100",
        },
      ],
      payments: [],
    };
    get.mockImplementation(async (path: string) =>
      path === "/sales/sale-1/collections" ? state : { items: [] },
    );
    post.mockImplementation(async (path: string) =>
      path === "/sales/sale-1/collections" ? { ...state, outstandingCents: "4900" } : receipt(),
    );
    const user = userEvent.setup();
    renderSale();
    await ringUpAReceipt(user);
    expect(await screen.findByText("Current outstanding: S$59.00")).toBeVisible();
    await user.type(screen.getByLabelText("Later payment amount (SGD)"), "10.00");
    await user.type(screen.getByLabelText("Allocation to line 1: Root colour (SGD)"), "10.00");
    await user.type(screen.getByLabelText("Later payment reason"), "Paid at counter");
    await user.click(screen.getByLabelText(/I confirm this money/));
    await user.click(screen.getByRole("button", { name: "Record later payment" }));
    expect(await screen.findByText("Current outstanding: S$49.00")).toBeVisible();
    expect(post).toHaveBeenCalledWith("/sales/sale-1/collections", {
      idempotencyKey: expect.any(String),
      currency: "SGD",
      collected: true,
      grossCents: "1000",
      reason: "Paid at counter",
      allocations: [{ saleLineId: "line-1", grossCents: "1000" }],
    });
  });

  it("keeps the empty cart tall and its content scrollable", () => {
    renderSale();
    expect(cartPanel()).toHaveClass(
      "h-[min(90dvh,46rem)]",
      "min-h-96",
      "lg:h-[max(36rem,calc(100dvh-10rem))]",
      "[&>div]:overflow-y-auto",
      "[&>footer]:shrink-0",
    );
    expect(screen.getByText("The cart is empty").closest(".h-full")).not.toBeNull();
  });

  it("pages the selected category without clearing the cart and resets for search and tabs", async () => {
    const user = userEvent.setup();
    useSaleItems.mockReturnValue({
      ...itemsResult(["SERVICE", "PRODUCT"], [SERVICE, PRODUCT]),
      data: { searchableKinds: ["SERVICE", "PRODUCT"], items: [SERVICE, PRODUCT], hasMore: true },
    });
    renderSale();
    expect(useSaleItems).toHaveBeenLastCalledWith({
      kind: "SERVICE",
      page: 1,
      limit: 24,
      search: undefined,
    });
    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    const pages = screen.getByLabelText("Sale list pages");
    expect(within(pages).getByRole("button", { name: "Previous" })).toBeDisabled();
    await user.click(within(pages).getByRole("button", { name: "Next" }));
    expect(useSaleItems).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(cartPanel()).toHaveTextContent("Root colour");
    await user.type(screen.getByRole("searchbox", { name: "Search the catalogue" }), "root");
    await waitFor(() =>
      expect(useSaleItems).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, search: "root" }),
      ),
    );
    await user.click(within(pages).getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("tab", { name: "Products" }));
    expect(useSaleItems).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "PRODUCT", page: 1 }),
    );
    expect(cartPanel()).toHaveTextContent("Root colour");
  });

  it("does not reset catalogue paging when the initial search debounce elapses", async () => {
    const user = userEvent.setup();
    useSaleItems.mockReturnValue({
      ...itemsResult(["SERVICE"], [SERVICE]),
      data: { searchableKinds: ["SERVICE"], items: [SERVICE], hasMore: true },
    });
    renderSale();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    expect(useSaleItems).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
  });

  it("does not offer unrelated staff while a cart service detail is unavailable", async () => {
    useCartServices.mockReturnValue([{ data: undefined, isError: true }]);
    useStaffList.mockReturnValue(
      listResult([{ id: "nails", name: "Nail staff", departments: [{ id: "nails" }] }]),
    );
    const user = userEvent.setup();
    renderSale();
    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    expect(useCartServices).toHaveBeenLastCalledWith(["s1"]);
    expect(screen.queryByRole("option", { name: /Nail staff/ })).not.toBeInTheDocument();
  });
  it("keeps secondary panels closed and customer selection beside the cart", () => {
    renderSale();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Staff PIN")).not.toBeInTheDocument();
    expect(screen.queryByText("Nothing is parked")).not.toBeInTheDocument();
    const cartWorkspace = document.getElementById("sale-cart")!;
    expect(
      within(cartWorkspace).getByRole("searchbox", { name: "Attach a customer by name or phone" }),
    ).toBeInTheDocument();
    expect(within(cartWorkspace).getByRole("heading", { name: "Cart" })).toBeInTheDocument();
    expect(screen.getByText("Scan barcode").closest("details")).not.toHaveAttribute("open");
  });

  it("opens held carts on demand and returns focus to its toolbar action", async () => {
    const user = userEvent.setup();
    renderSale();
    const trigger = screen.getByRole("button", { name: /^Held carts/ });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Held carts" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("offers a cart shortcut after adding an item and focuses the cart", async () => {
    const user = userEvent.setup();
    renderSale();
    expect(screen.queryByRole("button", { name: "View cart" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    const cartWorkspace = document.getElementById("sale-cart")!;
    const scroll = vi.fn();
    cartWorkspace.scrollIntoView = scroll;
    await user.click(screen.getByRole("button", { name: "View cart" }));
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(cartWorkspace).toHaveFocus();
    expect(screen.getByLabelText("Discount percent for Root colour")).not.toBeVisible();
  });
});

describe("barcode scanning", () => {
  function barcodeResult(quantity = 2) {
    return { searchableKinds: ["PRODUCT"], items: [{ ...PRODUCT, barcode: "001ABC", quantity }] };
  }

  it("adds exact normalised codes and stops repeated scans at available stock", async () => {
    const user = userEvent.setup();
    get.mockImplementation(async (path: string) =>
      path === "/sales/items" ? barcodeResult() : { items: [] },
    );
    renderSale();
    await user.click(screen.getByText("Scan barcode"));
    const input = screen.getByRole("textbox", { name: "Scan a barcode or type the code" });
    await user.type(input, "001abc{Enter}");
    await waitFor(() => expect(cartPanel()).toHaveTextContent("Shampoo"));
    await user.type(input, "001abc{Enter}");
    await waitFor(() =>
      expect(within(cartPanel()).getByRole("spinbutton", { name: /quantity/i })).toHaveValue(2),
    );
    await user.type(input, "001abc{Enter}");
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith("/sales/items", {
        barcode: "001ABC",
        kind: "PRODUCT",
        limit: 1,
      }),
    );
    expect(within(cartPanel()).getByRole("spinbutton", { name: /quantity/i })).toHaveValue(2);
  });

  it("does not add a near-match or out-of-stock product", async () => {
    const user = userEvent.setup();
    get.mockImplementation(async (path: string) =>
      path === "/sales/items" ? barcodeResult(0) : { items: [] },
    );
    renderSale();
    await user.click(screen.getByText("Scan barcode"));
    const input = screen.getByRole("textbox", { name: "Scan a barcode or type the code" });
    await user.type(input, "001ABC{Enter}");
    await waitFor(() => expect(input).toHaveValue(""));
    expect(cartPanel()).not.toHaveTextContent("Shampoo");
    await user.type(input, "001AB{Enter}");
    await waitFor(() => expect(input).toHaveValue(""));
    expect(cartPanel()).not.toHaveTextContent("Shampoo");
  });

  it.each(["checkout", "cart edit", "unmount"])(
    "ignores a delayed response after %s",
    async (action) => {
      const user = userEvent.setup();
      let resolveScan!: (value: ReturnType<typeof barcodeResult>) => void;
      get.mockImplementation((path: string) =>
        path === "/sales/items"
          ? new Promise((resolve) => {
              resolveScan = resolve;
            })
          : Promise.resolve({ items: [] }),
      );
      const view = renderSale();
      await user.click(screen.getByText("Scan barcode"));
      await user.click(
        screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }),
      );
      await user.type(
        screen.getByRole("textbox", { name: "Scan a barcode or type the code" }),
        "001ABC{Enter}",
      );
      // Submitting another code while pending must not start another lookup.
      await user.type(
        screen.getByRole("textbox", { name: "Scan a barcode or type the code" }),
        "001ABC{Enter}",
      );
      expect(get.mock.calls.filter(([path]) => path === "/sales/items")).toHaveLength(1);
      if (action === "checkout") {
        await user.click(screen.getByRole("button", { name: "Take payment" }));
      } else if (action === "cart edit") {
        await user.click(screen.getByRole("button", { name: "One more Root colour" }));
      } else {
        view.unmount();
      }
      resolveScan(barcodeResult());
      if (action !== "unmount") {
        await waitFor(() => expect(screen.getByRole("button", { name: "Add" })).not.toBeEnabled());
        expect(cartPanel()).not.toHaveTextContent("Shampoo");
      }
    },
  );
});

describe("vouchers and recorded refunds", () => {
  const preview = {
    code: "SAVE10",
    description: null,
    discountType: "PERCENTAGE",
    value: "10.00",
    discountAmount: "8.00",
    eligibleTotal: "80.00",
    totalAmount: "72.00",
    minSpend: "0.00",
    endsAt: "2027-01-01T00:00:00.000Z",
  };

  it("applies the server quote, updates the tender and submits only the voucher code", async () => {
    const user = userEvent.setup();
    post.mockImplementation(async (path: string) =>
      path === "/sales/voucher-preview" ? preview : receipt({ totalAmount: "72.00" }),
    );
    renderSale();
    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    await user.click(screen.getByRole("button", { name: "Take payment" }));
    await user.type(screen.getByRole("textbox", { name: "Voucher code" }), "save10");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await screen.findByText(/SAVE10 applied/);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Take payment" }),
    );
    expect(post).toHaveBeenLastCalledWith(
      "/sales",
      expect.objectContaining({
        voucherCode: "SAVE10",
        payments: [{ method: "CASH", amount: 72 }],
      }),
    );
  });

  it("blocks payment during preview and restores the original tender when removed", async () => {
    const user = userEvent.setup();
    let resolvePreview!: (value: typeof preview) => void;
    post.mockImplementation((path: string) =>
      path === "/sales/voucher-preview"
        ? new Promise((resolve) => {
            resolvePreview = resolve;
          })
        : Promise.resolve(receipt()),
    );
    renderSale();
    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    await user.click(screen.getByRole("button", { name: "Take payment" }));
    await user.type(screen.getByRole("textbox", { name: "Voucher code" }), "SAVE10");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Take payment" }),
    ).toBeDisabled();
    resolvePreview(preview);
    await screen.findByText(/SAVE10 applied/);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Take payment" }),
    );
    expect(post).toHaveBeenLastCalledWith(
      "/sales",
      expect.objectContaining({ payments: [{ method: "CASH", amount: 80 }] }),
    );
    expect(post.mock.calls.at(-1)?.[1]).not.toHaveProperty("voucherCode");
  });

  it("requires a restock choice, records the refund and removes reversal actions", async () => {
    const user = userEvent.setup();
    post.mockImplementation(async (path: string) =>
      path.endsWith("/refund")
        ? receipt({
            refundedAt: "2026-10-19T12:00:00.000Z",
            refundAmount: "80.00",
            refundReason: "Customer returned",
            refundRestocked: false,
            refundedByName: "Ava Owner",
            pointsEarned: 0,
          })
        : receipt(),
    );
    renderSale();
    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    await user.click(screen.getByRole("button", { name: "Take payment" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Take payment" }),
    );
    await user.click(await screen.findByRole("button", { name: "Refund sale" }));
    await user.type(
      screen.getByRole("textbox", { name: "Reason for refunding this sale" }),
      "Customer returned",
    );
    expect(screen.getByRole("button", { name: "Record refund S$80.00" })).toBeDisabled();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Restock returned products?" }),
      "false",
    );
    expect(screen.getByRole("button", { name: "Record refund S$80.00" })).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox", { name: "Refund method 1" }), "CASH");
    await user.clear(screen.getByRole("textbox", { name: "Refund amount 1" }));
    await user.type(screen.getByRole("textbox", { name: "Refund amount 1" }), "30");
    expect(screen.getByRole("button", { name: "Record refund S$80.00" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Add refund method" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Refund method 2" }), "CARD");
    await user.click(screen.getByRole("button", { name: "Record refund S$80.00" }));
    await screen.findByText("Customer returned");
    expect(post).toHaveBeenLastCalledWith("/sales/sale-1/refund", {
      reason: "Customer returned",
      restock: false,
      payouts: [
        { method: "CASH", amount: 30 },
        { method: "CARD", amount: 50 },
      ],
    });
    expect(screen.queryByRole("button", { name: "Refund sale" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Void sale" })).not.toBeInTheDocument();
  });
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
    useCartServices.mockReturnValue([{ data: { id: "s1", departmentId: "hair" } }]);
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

    expect(within(cartPanel()).getByText("1 item")).toBeInTheDocument();
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

    expect(within(cartPanel()).getByText("2 items")).toBeInTheDocument();
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

    expect(await screen.findByText("1 item")).toBeInTheDocument();
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
    expect(within(cartPanel()).queryByText("1 item")).not.toBeInTheDocument();
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
    if (url === "/customers/c1/holdings") return Promise.resolve({ items: [] });
    if (url === "/customers/c1") return Promise.resolve(CUSTOMER);
    if (url === "/sales/sale-9/resume")
      return Promise.resolve({ sale: heldCart(), items: [SERVICE] });
    if (url === "/sales") return Promise.resolve({ items: rows });
    return Promise.resolve(undefined);
  });
}

async function openHeldCarts(user: ReturnType<typeof userEvent.setup>) {
  if (!screen.queryByRole("dialog", { name: "Held carts" })) {
    await user.click(screen.getByRole("button", { name: /^Held carts/ }));
  }
}

/** The held-carts card, found by its heading so the cart's own region is excluded. */
function heldPanel(): HTMLElement {
  return screen
    .getByRole("heading", { name: "Held carts", level: 3 })
    .closest("section") as HTMLElement;
}

describe("holding a cart", () => {
  it("uses current regular/member prices and preserves held choices and order", () => {
    const sale = heldCart();
    sale.lines = [
      { ...sale.lines[0]!, quantity: 3, staffId: "stylist", discountPercent: "10.00" },
      { ...sale.lines[0]!, discountPercent: "100.00" },
    ];
    const lines = cartLinesFrom(sale, [
      { ...SERVICE, price: "100.00", memberPrice: "90.00", name: "Renamed" },
    ]);
    expect(lines[0]).toMatchObject({
      name: "Renamed",
      quantity: 3,
      staffId: "stylist",
      discountPercent: 10,
    });
    expect(lineUnitPrice(lines[0]!, false)).toBe("90.00");
    expect(lineUnitPrice(lines[0]!, true)).toBe("81.00");
    expect(lineUnitPrice(lines[1]!, true)).toBe("0.00");
    expect(() => cartLinesFrom(sale, [])).toThrow(/unavailable/);
    expect(() => cartLinesFrom({ ...sale, status: "COMPLETED" }, [SERVICE])).toThrow(
      /no longer held/,
    );
  });

  it("keeps the open draft when replacement is cancelled or pickup fails", async () => {
    withHeldCart();
    const read = get.getMockImplementation()!;
    get.mockImplementation((url: string) =>
      url.endsWith("/resume") ? Promise.reject(new Error("Unavailable")) : read(url),
    );
    const user = userEvent.setup();
    renderSale();
    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    await openHeldCarts(user);
    await user.click(await screen.findByRole("button", { name: "Pick up" }));
    await user.click(screen.getByRole("button", { name: "Keep current cart" }));
    expect(get).not.toHaveBeenCalledWith("/sales/sale-9/resume");
    await openHeldCarts(user);
    await user.click(screen.getByRole("button", { name: "Pick up" }));
    await user.click(screen.getByRole("button", { name: "Replace and pick up" }));
    await openHeldCarts(user);
    await waitFor(() => expect(screen.getByRole("button", { name: "Pick up" })).toBeEnabled());
    await user.click(
      within(screen.getByRole("dialog", { name: "Held carts" })).getByRole("button", {
        name: "Close",
      }),
    );
    expect(within(cartPanel()).getByText("Root colour")).toBeInTheDocument();
    expect(screen.queryByText(/Ringing up the/)).not.toBeInTheDocument();
  });

  it("blocks conflicting actions during pickup and ignores a response after unmount", async () => {
    withHeldCart([HELD_ROW, { ...HELD_ROW, id: "sale-10" }]);
    const read = get.getMockImplementation()!;
    let finish!: (value: unknown) => void;
    get.mockImplementation((url: string) =>
      url.endsWith("/resume")
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : read(url),
    );
    const user = userEvent.setup();
    const view = renderSale();
    await openHeldCarts(user);
    await user.click((await screen.findAllByRole("button", { name: "Pick up" }))[0]!);
    await openHeldCarts(user);
    for (const button of screen.getAllByRole("button", { name: "Pick up" }))
      expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "Browse sale history" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    expect(within(cartPanel()).getByText("The cart is empty")).toBeInTheDocument();
    view.unmount();
    finish({ sale: heldCart(), items: [SERVICE] });
    await waitFor(() => expect(get).toHaveBeenCalledWith("/customers/c1"));
    renderSale();
    expect(within(cartPanel()).getByText("The cart is empty")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("replaces an open draft only after confirmation and keeps both current prices", async () => {
    withHeldCart();
    const read = get.getMockImplementation()!;
    get.mockImplementation((url: string) =>
      url.endsWith("/resume")
        ? Promise.resolve({
            sale: heldCart(),
            items: [{ ...SERVICE, price: "100.00", memberPrice: "90.00" }],
          })
        : read(url),
    );
    const user = userEvent.setup();
    renderSale();
    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    await openHeldCarts(user);
    await user.click(await screen.findByRole("button", { name: "Pick up" }));
    expect(get).not.toHaveBeenCalledWith("/sales/sale-9/resume");
    await user.click(screen.getByRole("button", { name: "Replace and pick up" }));
    await screen.findByText(/Ringing up the/);
    expect(within(cartPanel()).getAllByText("S$90.00")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: /Mrs Loi.*clear the customer/ }));
    expect(within(cartPanel()).getAllByText("S$100.00")).toHaveLength(2);
    expect(post).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("navigates to older held carts and back", async () => {
    get.mockImplementation(async (_url: string, params?: { page?: number }) => ({
      items: [{ ...HELD_ROW, customerName: params?.page === 2 ? "Older hold" : "Newer hold" }],
      page: params?.page ?? 1,
      hasMore: params?.page !== 2,
    }));
    const user = userEvent.setup();
    renderSale();
    await openHeldCarts(user);
    await screen.findByText("Newer hold");
    await user.click(within(heldPanel()).getByRole("button", { name: "Next" }));
    await screen.findByText("Older hold");
    expect(within(heldPanel()).getByRole("button", { name: "Next" })).toBeDisabled();
    await user.click(within(heldPanel()).getByRole("button", { name: "Previous" }));
    await screen.findByText("Newer hold");
  });
  it("parks it instead of ringing it up, and the cart goes with it", async () => {
    const user = userEvent.setup();
    renderSale();

    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    await user.click(screen.getByRole("button", { name: "Hold cart" }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith("/sales", {
        lines: [{ itemType: "SERVICE", itemId: "s1", quantity: 1 }],
        // No tender: the key protects an unchanged retry after a lost response.
        hold: true,
        idempotencyKey: expect.any(String),
      });
    });

    // The cart is a row now, so the till starts from nothing and no tender dialog
    // was ever opened on this path.
    expect(within(cartPanel()).getByText("The cart is empty")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows what the salon has parked, and who parked it", async () => {
    withHeldCart();
    const user = userEvent.setup();
    renderSale();
    await openHeldCarts(user);

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

    await openHeldCarts(user);
    await user.click(
      await screen.findByRole("button", { name: "Discard the cart held by Ava Owner" }),
    );

    await waitFor(() => expect(del).toHaveBeenCalledWith("/sales/sale-9"));
  });
});

describe("picking a parked cart up", () => {
  it("reuses an uncertain hold attempt after reload and rotates the key after success", async () => {
    post.mockRejectedValueOnce(new Error("Response lost")).mockResolvedValue(heldCart());
    const user = userEvent.setup();
    const first = renderSale();
    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    await user.click(screen.getByRole("button", { name: "Hold cart" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const firstKey = post.mock.calls[0]![1].idempotencyKey;
    first.unmount();
    renderSale();
    await user.click(await screen.findByRole("button", { name: "Hold cart" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]![1].idempotencyKey).toBe(firstKey);
    await waitFor(() =>
      expect(within(cartPanel()).getByText("The cart is empty")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    await user.click(screen.getByRole("button", { name: "Hold cart" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(post.mock.calls[2]![1].idempotencyKey).not.toBe(firstKey);
  });

  it("locks cart edits and payment while the hold request is pending", async () => {
    let finish!: (sale: SaleDetail) => void;
    post.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    renderSale();
    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    await user.click(screen.getByRole("button", { name: "Hold cart" }));
    expect(screen.getByRole("button", { name: "Take payment" })).toBeDisabled();
    expect(within(cartPanel()).getByRole("button", { name: "Clear cart" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    expect(screen.getByText("1 item")).toBeInTheDocument();
    finish(heldCart());
    await waitFor(() =>
      expect(within(cartPanel()).getByText("The cart is empty")).toBeInTheDocument(),
    );
  });
  it("applies a held line discount only once, including fully discounted lines", () => {
    for (const [unitPrice, discountAmount, discountPercent] of [
      ["72.00", "24.00", "10.00"],
      ["0.00", "240.00", "100.00"],
    ]) {
      const sale = heldCart();
      sale.lines = sale.lines.map((line) => ({
        ...line,
        quantity: 3,
        unitPrice,
        discountAmount,
        discountPercent,
      }));
      const [line] = cartLinesFrom(sale, [SERVICE]);
      expect(line!.price).toBe("80.00");
      expect(lineUnitPrice(line!, false)).toBe(unitPrice);
    }
  });
  it("keeps the resumed hold identity after reload and does not park a duplicate", async () => {
    withHeldCart();
    const user = userEvent.setup();
    const first = renderSale();
    await openHeldCarts(user);
    await user.click(await screen.findByRole("button", { name: "Pick up" }));
    await screen.findByText(/Ringing up the/);
    first.unmount();
    renderSale();
    expect(await screen.findByText(/Ringing up the/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Hold cart" }));
    expect(post).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Take payment" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Take payment" }),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/sales/sale-9/complete", expect.any(Object)),
    );
  });
  it("fills the till, then completes the hold instead of creating a sale", async () => {
    withHeldCart();
    post.mockResolvedValue(receipt({ id: "sale-9", receiptNumber: 77 }));
    const user = userEvent.setup();
    renderSale();

    await openHeldCarts(user);
    await user.click(await screen.findByRole("button", { name: "Pick up" }));

    // Pickup uses current catalogue prices; completion checks them again.
    expect(await screen.findByText("1 item")).toBeInTheDocument();
    expect(within(cartPanel()).getAllByText("S$70.00")).toHaveLength(2);
    expect(screen.getByText(/Ringing up the/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Take payment" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Take payment" }),
    );

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith("/sales/sale-9/complete", {
        customerId: "c1",
        lines: [{ itemType: "SERVICE", itemId: "s1", quantity: 1 }],
        payments: [{ method: "CASH", amount: 70 }],
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

    await openHeldCarts(user);
    await user.click(await screen.findByRole("button", { name: "Pick up" }));
    await screen.findByText(/Ringing up the/);

    await user.click(screen.getByRole("button", { name: "Leave it held" }));

    expect(within(cartPanel()).getByText("The cart is empty")).toBeInTheDocument();
    // Nothing was written either way: the cart is still on the list.
    expect(post).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});

describe("historical sale browsing", () => {
  function historyData() {
    get.mockImplementation(async (url: string, params?: { status?: string; page?: number }) => {
      if (url === "/sales/history-1") return receipt({ id: "history-1" });
      if (url === "/sales/sale-9/resume") return { sale: heldCart(), items: [SERVICE] };
      if (url === "/customers/c1") return CUSTOMER;
      if (url === "/sales" && params?.status === "HELD") {
        return { items: [HELD_ROW], page: 1, hasMore: false };
      }
      if (url === "/sales")
        return {
          items: [
            {
              ...HELD_ROW,
              id: "history-1",
              receiptNumber: 1042,
              status: params?.status,
              customerName: params?.page === 2 ? "Older sale" : "Historical customer",
            },
          ],
          page: params?.page ?? 1,
          hasMore: params?.page !== 2,
        };
      return { items: [] };
    });
  }

  it("loads history only on request and resets pagination when status changes", async () => {
    historyData();
    const user = userEvent.setup();
    renderSale();
    expect(get).not.toHaveBeenCalledWith(
      "/sales",
      expect.objectContaining({ status: "COMPLETED" }),
    );
    await user.click(screen.getByRole("button", { name: "Browse sale history" }));
    await screen.findByText(/Historical customer/);
    const panel = screen.getByRole("region", { name: "Sale history results" });
    await user.click(within(panel).getByRole("button", { name: "Next" }));
    await screen.findByText(/Older sale/);
    expect(within(panel).getByRole("button", { name: "Next" })).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox", { name: "Sale status" }), "VOID");
    await waitFor(() => expect(get).toHaveBeenCalledWith("/sales", { status: "VOID", page: 1 }));
  });

  it("preserves a resumed hold, its customer and lines when returning from a receipt", async () => {
    historyData();
    const user = userEvent.setup();
    renderSale();
    await openHeldCarts(user);
    await user.click(await screen.findByRole("button", { name: "Pick up" }));
    await screen.findByText(/Ringing up the/);
    await user.click(screen.getByRole("button", { name: "Browse sale history" }));
    await user.click(await screen.findByRole("button", { name: "Open receipt #1042" }));
    await screen.findByRole("button", { name: "Back to cart" });
    expect(screen.getByRole("button", { name: "Void sale" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refund sale" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to cart" }));
    expect(screen.getByText(/Ringing up the/)).toBeInTheDocument();
    expect(screen.getByText("1 item")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Take payment" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Take payment" }),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/sales/sale-9/complete",
        expect.objectContaining({
          customerId: "c1",
          lines: [{ itemType: "SERVICE", itemId: "s1", quantity: 1 }],
        }),
      ),
    );
  });

  it.each(["cashier", "read-only"])(
    "allows %s history reads without reversal actions",
    async (access) => {
      historyData();
      if (access === "cashier") role.value = "STAFF";
      else isReadOnly.value = true;
      const user = userEvent.setup();
      renderSale();
      await user.click(screen.getByRole("button", { name: "Browse sale history" }));
      await user.click(await screen.findByRole("button", { name: "Open receipt #1042" }));
      await screen.findByRole("button", { name: "Back to cart" });
      expect(screen.queryByRole("button", { name: "Void sale" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Refund sale" })).not.toBeInTheDocument();
    },
  );

  it("keeps the cart when a historical receipt cannot be opened", async () => {
    historyData();
    const original = get.getMockImplementation()!;
    get.mockImplementation((url: string, params?: unknown) =>
      url === "/sales/history-1" ? Promise.reject(new Error("Unavailable")) : original(url, params),
    );
    const user = userEvent.setup();
    renderSale();
    await user.click(screen.getByRole("button", { name: "Add Root colour to the cart, S$80.00" }));
    await user.click(screen.getByRole("button", { name: "Browse sale history" }));
    await user.click(await screen.findByRole("button", { name: "Open receipt #1042" }));
    await screen.findByRole("alert");
    expect(screen.getByText("1 item")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
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
    await user.click(screen.getByRole("button", { name: "Add discount" }));
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

    await user.click(screen.getByRole("button", { name: "Add discount" }));
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
  it("does not present a reversed short tender as active outstanding debt", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderSale(client);
    await ringUpAReceipt(user);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["customers"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["reports"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["dashboard", "summary"] });
    invalidate.mockClear();
    post.mockResolvedValueOnce(
      receipt({ status: "VOID", paidAmount: "20.00", outstandingAmount: "0.00" }),
    );
    await user.click(screen.getByRole("button", { name: "Void sale" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason for voiding this sale"), "Wrong sale");
    await user.click(within(dialog).getByRole("button", { name: "Void it" }));
    expect(
      await screen.findByText(/Any money refund must be handled separately/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Outstanding")).not.toBeInTheDocument();
    expect(screen.getByText("S$20.00")).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["customers"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["reports"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["dashboard", "summary"] });
  });
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
