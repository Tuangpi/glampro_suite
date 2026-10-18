/**
 * The products screen — handoff screen 08.
 *
 * What is worth asserting here is the behaviour the API contract made necessary:
 *
 * - The Cost column and the "Inventory value" tile the handoff draws are absent,
 *   because the model has no cost to fill them with, and nothing on the screen
 *   reads as "this item costs nothing to buy".
 * - Every tile number is a **server-side count**, not a count of the rows on
 *   screen: the low-stock tile and the rail badge ask the same question (ADR 0010).
 * - The two tabs the model cannot back — Packages and Gift cards — are absent.
 * - A 422 from the server puts its message on the **control that caused it**.
 * - The Packages and Gift-card tabs exist, and a salon that has not bought the add-on
 *   is told **that**, rather than shown an empty list that reads as "you have none".
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  useProductList,
  useProductCount,
  useServiceList,
  useServiceCount,
  useCreateProduct,
  useUpdateProduct,
  useCreateService,
  useUpdateService,
  usePackageList,
  useGiftCardList,
  useCreatePackage,
  useUpdatePackage,
  useCreateGiftCard,
  useUpdateGiftCard,
  useModules,
  useDepartments,
  getErrorMessage,
  getErrorCode,
  getValidationDetails,
} = vi.hoisted(() => ({
  useProductList: vi.fn(),
  useProductCount: vi.fn(),
  useServiceList: vi.fn(),
  useServiceCount: vi.fn(),
  useCreateProduct: vi.fn(),
  useUpdateProduct: vi.fn(),
  useCreateService: vi.fn(),
  useUpdateService: vi.fn(),
  usePackageList: vi.fn(),
  useGiftCardList: vi.fn(),
  useCreatePackage: vi.fn(),
  useUpdatePackage: vi.fn(),
  useCreateGiftCard: vi.fn(),
  useUpdateGiftCard: vi.fn(),
  useModules: vi.fn(),
  useDepartments: vi.fn(),
  getErrorMessage: vi.fn<() => string>(() => "Something went wrong."),
  getErrorCode: vi.fn<() => string | undefined>(() => undefined),
  getValidationDetails: vi.fn<() => Record<string, string>>(() => ({})),
}));

vi.mock("@/lib/api", () => ({
  get: vi.fn(),
  getErrorMessage,
  getErrorCode,
  getValidationDetails,
}));

vi.mock("@/hooks/useProducts", () => ({
  useProductList,
  useProductCount,
  useCreateProduct,
  useUpdateProduct,
}));

vi.mock("@/hooks/useServices", () => ({
  useServiceList,
  useServiceCount,
  useCreateService,
  useUpdateService,
}));

vi.mock("@/hooks/usePackages", () => ({
  usePackageList,
  useCreatePackage,
  useUpdatePackage,
}));

vi.mock("@/hooks/useGiftCards", () => ({
  useGiftCardList,
  useCreateGiftCard,
  useUpdateGiftCard,
}));

vi.mock("@/hooks/useSettings", () => ({
  useModules,
}));

vi.mock("@/hooks/useDepartments", () => ({ useDepartments }));

const isReadOnly = vi.hoisted(() => ({ value: false }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isReadOnly: isReadOnly.value }) }));

const { default: Products } = await import("@/pages/Products");

/** The query result a list destructures, with the flags defaulted. */
function queryResult(overrides: Record<string, unknown> = {}) {
  return {
    data: { data: [], total: 0, page: 1, pageSize: 20, pageCount: 0 },
    isPending: false,
    isError: false,
    error: null,
    isFetching: false,
    ...overrides,
  };
}

function listOf(rows: unknown[], total = rows.length) {
  return queryResult({ data: { data: rows, total, page: 1, pageSize: 20, pageCount: 1 } });
}

/** A count query: only `total` is ever read. */
function countOf(total: number) {
  return queryResult({ data: { data: [], total, page: 1, pageSize: 1, pageCount: total } });
}

/** A row that satisfies `ProductSummary`, optional fields left null. */
function product(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    name: "Magken Shampoo",
    status: "ACTIVE",
    memberPrice: "78.00",
    nonmemberPrice: "88.00",
    quantity: 42,
    points: 5,
    description: null,
    departmentId: null,
    departmentName: "Hair",
    lowStock: false,
    createdAt: "2021-03-04T00:00:00.000Z",
    updatedAt: "2021-03-04T00:00:00.000Z",
    ...overrides,
  };
}

/** A row that satisfies `ServiceSummary` — no quantity, and a duration. */
function service(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    name: "Argan Oil Treatment",
    status: "ACTIVE",
    memberPrice: "45.00",
    nonmemberPrice: "52.00",
    points: 3,
    description: null,
    departmentId: null,
    departmentName: "Hair",
    durationMinutes: 75,
    createdAt: "2021-03-04T00:00:00.000Z",
    updatedAt: "2021-03-04T00:00:00.000Z",
    ...overrides,
  };
}

const createMutate = vi.fn();
const updateMutate = vi.fn();
const createServiceMutate = vi.fn();
const updateServiceMutate = vi.fn();

beforeEach(() => {
  isReadOnly.value = false;
  useProductList.mockReturnValue(queryResult());
  useServiceList.mockReturnValue(queryResult());
  // The tiles ask three different questions of the products count and one of the
  // services count, so the mock answers by argument rather than by call order —
  // which also proves the filters are the ones the screen means to send.
  useProductCount.mockImplementation((filters: { lowStock?: boolean; threshold?: number } = {}) => {
    if (filters.lowStock && filters.threshold === 0) return countOf(3);
    if (filters.lowStock) return countOf(14);
    return countOf(248);
  });
  useServiceCount.mockReturnValue(countOf(12));
  useCreateProduct.mockReturnValue({ mutateAsync: createMutate, isPending: false });
  useUpdateProduct.mockReturnValue({ mutateAsync: updateMutate, isPending: false });
  useCreateService.mockReturnValue({ mutateAsync: createServiceMutate, isPending: false });
  useUpdateService.mockReturnValue({ mutateAsync: updateServiceMutate, isPending: false });
  // The two add-on tabs answer like any other list by default; the tests that care
  // about the refusal override the packages one with a 403.
  usePackageList.mockReturnValue(queryResult());
  useGiftCardList.mockReturnValue(queryResult());
  useCreatePackage.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  useUpdatePackage.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  useCreateGiftCard.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  useUpdateGiftCard.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  useModules.mockReturnValue({
    data: [
      {
        code: "catalogue",
        name: "Catalogue",
        category: "Core",
        isCore: true,
        entitled: true,
        expiresAt: null,
      },
      {
        code: "packages",
        name: "Packages",
        category: "Add-on",
        isCore: false,
        entitled: true,
        expiresAt: null,
      },
      {
        code: "giftCards",
        name: "Gift cards",
        category: "Add-on",
        isCore: false,
        entitled: true,
        expiresAt: null,
      },
    ],
    isPending: false,
    isError: false,
    error: null,
    isFetching: false,
  });
  useDepartments.mockReturnValue({ data: [], isPending: false });
  getErrorMessage.mockReturnValue("Something went wrong.");
  getErrorCode.mockReturnValue(undefined);
  getValidationDetails.mockReturnValue({});
  createMutate.mockReset().mockResolvedValue({});
  updateMutate.mockReset().mockResolvedValue({});
  createServiceMutate.mockReset().mockResolvedValue({});
  updateServiceMutate.mockReset().mockResolvedValue({});
});

describe("the table", () => {
  it("renders a row per product, with both prices and its stock", () => {
    useProductList.mockReturnValue(
      listOf([
        product(),
        product({
          id: "p2",
          name: "Styling Gel",
          memberPrice: "24.00",
          nonmemberPrice: "28.00",
          quantity: 0,
          lowStock: true,
        }),
      ]),
    );

    render(<Products />);

    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Magken Shampoo")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("S$88.00")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("S$78.00")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("42 units")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("0 units")).toBeInTheDocument();
  });

  it("shows the columns the model can fill, and no Cost column", () => {
    useProductList.mockReturnValue(listOf([product()]));

    render(<Products />);

    expect(screen.getByRole("columnheader", { name: "Price" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Member price" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Stock" })).toBeInTheDocument();
    // The handoff draws a Cost column the schema has no column for: a blank one
    // would read as "this item is free to buy".
    expect(screen.queryByRole("columnheader", { name: "Cost" })).not.toBeInTheDocument();
  });
});

describe("the tiles", () => {
  it("counts the whole catalogue, which is what the server is asked for", () => {
    useProductList.mockReturnValue(listOf([product()]));

    render(<Products />);

    /** The tile's own box: the label's parent also holds the number. */
    const valueFor = (label: string) => {
      const box = screen.getByText(label).parentElement;
      if (!box) throw new Error(`The "${label}" tile has no value box.`);
      return within(box);
    };

    // 248 products + 12 services: the count is the catalogue's, not the page's.
    expect(valueFor("Total items").getByText("260")).toBeInTheDocument();
    expect(valueFor("Low stock").getByText("14")).toBeInTheDocument();
    expect(valueFor("Out of stock").getByText("3")).toBeInTheDocument();

    // The low-stock count is the rail badge's own query, and "out" is the same
    // question with the threshold pinned to zero — decided here, not in the browser.
    expect(useProductCount).toHaveBeenCalledWith({ lowStock: true });
    expect(useProductCount).toHaveBeenCalledWith({ lowStock: true, threshold: 0 });
  });

  it("has no Inventory value tile, because there is no cost to value", () => {
    render(<Products />);

    expect(screen.queryByText(/inventory value/i)).not.toBeInTheDocument();
  });
});

describe("the tabs", () => {
  it("offers all four tabs the handoff draws", () => {
    render(<Products />);

    expect(screen.getByRole("tab", { name: "Products" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Services" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Packages" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Gift cards" })).toBeInTheDocument();
  });

  it("tells a salon the add-on is missing rather than that it has no packages", async () => {
    const user = userEvent.setup();
    // What the API answers for an add-on the salon has not bought: the row set is
    // empty, but the reason is entitlement — and "you have none" would be false.
    getErrorCode.mockReturnValue("MODULE_NOT_ENTITLED");
    usePackageList.mockReturnValue(
      queryResult({ isError: true, error: new Error('This feature needs the "packages" add-on.') }),
    );

    render(<Products />);
    await user.click(screen.getByRole("tab", { name: "Packages" }));

    expect(screen.getByText(/add-on is not enabled/i)).toBeInTheDocument();
    // No retry button: reloading asks the same question and gets the same answer.
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("hides Add for an add-on tab the salon has not bought", async () => {
    const user = userEvent.setup();
    getErrorCode.mockReturnValue("MODULE_NOT_ENTITLED");
    usePackageList.mockReturnValue(
      queryResult({ isError: true, error: new Error('This feature needs the "packages" add-on.') }),
    );
    // The demo salon normally has packages; here it has not bought it.
    useModules.mockReturnValue({
      data: [
        {
          code: "catalogue",
          name: "Catalogue",
          category: "Core",
          isCore: true,
          entitled: true,
          expiresAt: null,
        },
        {
          code: "packages",
          name: "Packages",
          category: "Add-on",
          isCore: false,
          entitled: false,
          expiresAt: null,
        },
        {
          code: "giftCards",
          name: "Gift cards",
          category: "Add-on",
          isCore: false,
          entitled: false,
          expiresAt: null,
        },
      ],
      isPending: false,
      isError: false,
      error: null,
      isFetching: false,
    });

    render(<Products />);
    await user.click(screen.getByRole("tab", { name: "Packages" }));

    expect(screen.getByText(/add-on is not enabled/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add package" })).not.toBeInTheDocument();
  });

  it("shows Add for an add-on tab the salon has bought", async () => {
    const user = userEvent.setup();
    usePackageList.mockReturnValue(
      listOf([
        {
          id: "pk1",
          name: "Ten-session bundle",
          status: "ACTIVE",
          sessionCount: 10,
          memberPrice: "250.00",
          nonmemberPrice: "300.00",
          description: null,
          serviceCount: 2,
          createdAt: "2021-03-04T00:00:00.000Z",
          updatedAt: "2021-03-04T00:00:00.000Z",
        },
      ]),
    );
    useModules.mockReturnValue({
      data: [
        {
          code: "catalogue",
          name: "Catalogue",
          category: "Core",
          isCore: true,
          entitled: true,
          expiresAt: null,
        },
        {
          code: "packages",
          name: "Packages",
          category: "Add-on",
          isCore: false,
          entitled: true,
          expiresAt: null,
        },
        {
          code: "giftCards",
          name: "Gift cards",
          category: "Add-on",
          isCore: false,
          entitled: true,
          expiresAt: null,
        },
      ],
      isPending: false,
      isError: false,
      error: null,
      isFetching: false,
    });

    render(<Products />);
    await user.click(screen.getByRole("tab", { name: "Packages" }));

    expect(screen.queryByText(/add-on is not enabled/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add package" })).toBeInTheDocument();
  });

  it("lists a bundle's sessions and what it covers", async () => {
    const user = userEvent.setup();
    usePackageList.mockReturnValue(
      listOf([
        {
          id: "pk1",
          name: "Ten-session bundle",
          status: "ACTIVE",
          sessionCount: 10,
          memberPrice: "250.00",
          nonmemberPrice: "300.00",
          description: null,
          serviceCount: 2,
          createdAt: "2021-03-04T00:00:00.000Z",
          updatedAt: "2021-03-04T00:00:00.000Z",
        },
      ]),
    );

    render(<Products />);
    await user.click(screen.getByRole("tab", { name: "Packages" }));

    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).getByText("Ten-session bundle")).toBeInTheDocument();
    expect(within(row).getByText("10")).toBeInTheDocument();
    expect(within(row).getByText("2 services")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add package" })).toBeInTheDocument();
  });

  it("draws a row on every tab when the server has one to send", async () => {
    const user = userEvent.setup();
    // One walk over all four tabs, because they go through four different list
    // hooks and a screen that is empty on one of them is the failure this file
    // exists to catch: the empty-state copy is the same either way, so a list that
    // never arrives looks like a salon with nothing rather than a broken query.
    useProductList.mockReturnValue(listOf([product({ name: "Magken Shampoo" })]));
    useServiceList.mockReturnValue(listOf([service({ name: "Argan Treatment" })]));
    usePackageList.mockReturnValue(
      listOf([
        {
          id: "pk1",
          name: "Ten-session bundle",
          status: "ACTIVE",
          sessionCount: 10,
          memberPrice: "250.00",
          nonmemberPrice: "300.00",
          description: null,
          serviceCount: 2,
          createdAt: "2021-03-04T00:00:00.000Z",
          updatedAt: "2021-03-04T00:00:00.000Z",
        },
      ]),
    );
    useGiftCardList.mockReturnValue(
      listOf([
        {
          id: "g1",
          name: "S$100 gift card",
          value: "100.00",
          expiresAt: null,
          remark: null,
          qrPayload: null,
          createdAt: "2021-03-04T00:00:00.000Z",
          updatedAt: "2021-03-04T00:00:00.000Z",
        },
      ]),
    );

    render(<Products />);

    for (const [tab, row] of [
      ["Products", "Magken Shampoo"],
      ["Services", "Argan Treatment"],
      ["Packages", "Ten-session bundle"],
      ["Gift cards", "S$100 gift card"],
    ] as const) {
      await user.click(screen.getByRole("tab", { name: tab }));
      expect(screen.getByText(row)).toBeInTheDocument();
    }
  });

  it("draws no Status column for gift cards, because the model has none", async () => {
    const user = userEvent.setup();
    useGiftCardList.mockReturnValue(
      listOf([
        {
          id: "g1",
          name: "S$100 gift card",
          value: "100.00",
          expiresAt: null,
          remark: null,
          qrPayload: null,
          createdAt: "2021-03-04T00:00:00.000Z",
          updatedAt: "2021-03-04T00:00:00.000Z",
        },
      ]),
    );

    render(<Products />);
    await user.click(screen.getByRole("tab", { name: "Gift cards" }));

    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).getByText("S$100 gift card")).toBeInTheDocument();
    // "Never" rather than a dash: no expiry is a product decision, not missing data.
    expect(within(row).getByText("Never")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
  });

  it("names the gift-card QR field the way a salon reads it, not the schema's way", async () => {
    const user = userEvent.setup();

    render(<Products />);
    await user.click(screen.getByRole("tab", { name: "Gift cards" }));
    await user.click(screen.getAllByRole("button", { name: "Add gift card" })[0]!);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("QR code value")).toBeInTheDocument();
    // "payload" and "renderer" name the column and the code that reads it. A salon
    // opening this drawer is configuring a card, so neither word belongs on it —
    // the field keeps the contract's name and loses the contract's vocabulary.
    expect(within(dialog).queryByText(/payload|renderer/i)).not.toBeInTheDocument();
  });

  it("swaps the row for a service row: a duration, and no stock at all", async () => {
    const user = userEvent.setup();
    useServiceList.mockReturnValue(listOf([service()]));

    render(<Products />);
    await user.click(screen.getByRole("tab", { name: "Services" }));

    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("Argan Oil Treatment")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("1h 15m")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Duration" })).toBeInTheDocument();
    // A service is not stock, so the column is gone and the form says so too.
    expect(screen.queryByRole("columnheader", { name: "Stock" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add service" })).toBeInTheDocument();
  });
});

describe("a suspended salon", () => {
  it("is offered no write action at all", () => {
    isReadOnly.value = true;
    useProductList.mockReturnValue(listOf([product()]));

    render(<Products />);

    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add product" })).toBeDisabled();
  });
});

describe("search", () => {
  it("hands the debounced term to the server rather than filtering rows here", async () => {
    const user = userEvent.setup();
    render(<Products />);

    await user.type(screen.getByLabelText("Search items"), "shampoo");

    await waitFor(() => {
      expect(useProductList).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "shampoo" }),
      );
    });
  });
});

describe("the add-product form", () => {
  /** Opens the drawer and returns its own submit button, ready to fill it in. */
  async function openCreateForm(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getAllByRole("button", { name: "Add product" })[0]!);
    // The page keeps its own "Add product" button behind the open drawer, so the
    // submit is found inside the dialog rather than by position on the page.
    const dialog = await screen.findByRole("dialog");
    return within(dialog).getByRole("button", { name: "Add product" });
  }

  it("sends the name and both prices, which is what the contract asks for", async () => {
    const user = userEvent.setup();
    render(<Products />);

    const submit = await openCreateForm(user);
    await user.type(screen.getByLabelText("Name"), "Magken Shampoo");
    await user.type(screen.getByLabelText("Member price"), "78");
    await user.type(screen.getByLabelText("Non-member price"), "88");
    await user.click(submit);

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Magken Shampoo", memberPrice: 78, nonmemberPrice: 88 }),
      );
    });
  });

  it("refuses to submit without a price rather than round-tripping", async () => {
    const user = userEvent.setup();
    render(<Products />);

    const submit = await openCreateForm(user);
    await user.type(screen.getByLabelText("Name"), "Magken Shampoo");
    await user.click(submit);

    expect(await screen.findByText("Enter the member price")).toBeInTheDocument();
    expect(screen.getByText("Enter the non-member price")).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("puts a server-side message on the field that caused it", async () => {
    const user = userEvent.setup();
    // The API prefixes paths with the request part; the form strips it.
    getValidationDetails.mockReturnValue({ "body.memberPrice": "Enter a valid price" });
    createMutate.mockRejectedValue(new Error("Validation failed"));

    render(<Products />);
    const submit = await openCreateForm(user);
    await user.type(screen.getByLabelText("Name"), "Magken Shampoo");
    await user.type(screen.getByLabelText("Member price"), "78");
    await user.type(screen.getByLabelText("Non-member price"), "88");
    await user.click(submit);

    const price = await screen.findByLabelText("Member price");
    await waitFor(() => {
      expect(price).toHaveAttribute("aria-invalid", "true");
    });
    expect(screen.getByText("Enter a valid price")).toBeInTheDocument();
  });
});
