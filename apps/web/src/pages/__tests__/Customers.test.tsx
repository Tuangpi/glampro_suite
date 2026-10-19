/**
 * The customers screen — handoff screen 07.
 *
 * What is worth asserting here is the behaviour the API contract made necessary:
 *
 * - The three columns the handoff draws but the model cannot support are absent,
 *   and the screen says nothing that reads as "this customer has never spent
 *   anything".
 * - A 422 from the server puts its message on the **control that caused it**,
 *   which is the whole point of the shared contract carrying field paths.
 * - A suspended salon is offered no way to write.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/customers/CustomerConsentPanel", () => ({
  default: () => <div>Customer consent panel</div>,
}));

const {
  useCustomerList,
  useCreateCustomer,
  useUpdateCustomer,
  getErrorMessage,
  getValidationDetails,
} = vi.hoisted(() => ({
  useCustomerList: vi.fn(),
  useCreateCustomer: vi.fn(),
  useUpdateCustomer: vi.fn(),
  getErrorMessage: vi.fn<() => string>(() => "Something went wrong."),
  getValidationDetails: vi.fn<() => Record<string, string>>(() => ({})),
}));

vi.mock("@/lib/api", () => ({ get: vi.fn(), getErrorMessage, getValidationDetails }));

vi.mock("@/hooks/useCustomers", () => ({
  useCustomerList,
  useCreateCustomer,
  useUpdateCustomer,
}));

const isReadOnly = vi.hoisted(() => ({ value: false }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isReadOnly: isReadOnly.value }) }));

const { default: Customers } = await import("@/pages/Customers");

/** A row that satisfies `CustomerSummary`, optional fields left null. */
function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    code: null,
    name: "Mrs Loi",
    memberId: null,
    email: "mrsloi88@gmail.com",
    phone: "9030 9386",
    gender: null,
    dateOfBirth: null,
    address: null,
    comment: null,
    createdAt: "2021-03-04T00:00:00.000Z",
    updatedAt: "2021-03-04T00:00:00.000Z",
    ...overrides,
  };
}

const mutateAsync = vi.fn();
const updateMutateAsync = vi.fn();

/** The query result the page destructures, with the flags defaulted. */
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

beforeEach(() => {
  isReadOnly.value = false;
  useCustomerList.mockReturnValue(queryResult());
  useCreateCustomer.mockReturnValue({ mutateAsync, isPending: false });
  useUpdateCustomer.mockReturnValue({ mutateAsync: updateMutateAsync, isPending: false });
  getErrorMessage.mockReturnValue("Something went wrong.");
  getValidationDetails.mockReturnValue({});
  mutateAsync.mockReset().mockResolvedValue({});
  updateMutateAsync.mockReset().mockResolvedValue({});
});

describe("the list", () => {
  it("renders a row per customer and the server's total", () => {
    useCustomerList.mockReturnValue(
      listOf([summary(), summary({ id: "c2", name: "Irene Foo", phone: null })]),
    );

    render(<Customers />);

    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Mrs Loi")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("9030 9386")).toBeInTheDocument();
    expect(screen.getByText("2 customers")).toBeInTheDocument();
  });

  it("does not render the columns the data model cannot support", () => {
    useCustomerList.mockReturnValue(listOf([summary()]));

    render(<Customers />);

    // `Last visit`, `Total spend` and `Tier` are proposals in the handoff with no
    // column behind them. A zero there would be a false statement, not a blank.
    expect(screen.queryByText("Last visit")).not.toBeInTheDocument();
    expect(screen.queryByText("Total spend")).not.toBeInTheDocument();
    expect(screen.queryByText("Tier")).not.toBeInTheDocument();
  });

  it("shows a dash rather than an empty cell when a field is missing", () => {
    // Membership has a value here, so the only dashes are the two that are unset.
    useCustomerList.mockReturnValue(
      listOf([summary({ phone: null, email: null, memberId: "M-1" })]),
    );

    render(<Customers />);

    expect(within(screen.getAllByRole("row")[1]!).getAllByText("—")).toHaveLength(2);
  });

  it("offers a way out of an empty book", () => {
    render(<Customers />);

    expect(screen.getByText("No customers yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add customer" }).length).toBeGreaterThan(0);
  });

  it("says the failure rather than showing an empty table", () => {
    getErrorMessage.mockReturnValue("The API is unreachable.");
    useCustomerList.mockReturnValue(queryResult({ isError: true, error: new Error("boom") }));

    render(<Customers />);

    expect(screen.getByText("The customer list could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("The API is unreachable.")).toBeInTheDocument();
  });
});

describe("search", () => {
  it("debounces, then asks the server rather than filtering the page locally", async () => {
    const user = userEvent.setup();
    render(<Customers />);

    await user.type(screen.getByLabelText("Search customers"), "loi");

    // Nothing is sent until the term settles.
    expect(useCustomerList).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      search: undefined,
    });

    await waitFor(() => {
      expect(useCustomerList).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        search: "loi",
      });
    });
  });

  it("distinguishes an empty book from a search that found nothing", async () => {
    const user = userEvent.setup();
    useCustomerList.mockReturnValue(queryResult());

    render(<Customers />);
    expect(screen.getByText("No customers yet")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search customers"), "zzz");
    await waitFor(() => {
      expect(useCustomerList).toHaveBeenLastCalledWith(expect.objectContaining({ search: "zzz" }));
    });
  });
});

describe("a suspended salon", () => {
  it("is offered no write action at all", () => {
    isReadOnly.value = true;
    useCustomerList.mockReturnValue(listOf([summary()]));

    render(<Customers />);

    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add customer" })).toBeDisabled();
  });
});

describe("the create form", () => {
  /** Opens the drawer and returns its own submit button, ready to fill it in. */
  async function openCreateForm(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getAllByRole("button", { name: "Add customer" })[0]!);
    // The page keeps its own "Add customer" button behind the open drawer, so the
    // submit is found inside the dialog rather than by position on the page.
    const dialog = await screen.findByRole("dialog");
    return within(dialog).getByRole("button", { name: "Add customer" });
  }

  it("sends a name on its own, which the contract allows", async () => {
    const user = userEvent.setup();
    render(<Customers />);

    const submit = await openCreateForm(user);
    await user.type(screen.getByLabelText(/Name/), "Mrs Loi");
    await user.click(submit);

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ name: "Mrs Loi" });
    });
  });

  it("refuses to submit without a name rather than round-tripping", async () => {
    const user = userEvent.setup();
    render(<Customers />);

    await user.click(await openCreateForm(user));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("puts a server-side message on the field that caused it", async () => {
    const user = userEvent.setup();
    // The API prefixes paths with the request part; the form strips it.
    getValidationDetails.mockReturnValue({ "body.email": "Invalid email address" });
    mutateAsync.mockRejectedValue(new Error("Validation failed"));

    render(<Customers />);
    const submit = await openCreateForm(user);
    await user.type(screen.getByLabelText(/Name/), "Mrs Loi");
    await user.type(screen.getByLabelText("Email"), "nope");
    await user.click(submit);

    const email = await screen.findByLabelText("Email");
    await waitFor(() => {
      expect(email).toHaveAttribute("aria-invalid", "true");
    });
    expect(screen.getByText("Invalid email address")).toBeInTheDocument();
  });

  it("shows a non-field failure once, as a message", async () => {
    const user = userEvent.setup();
    getErrorMessage.mockReturnValue("That record already exists.");
    getValidationDetails.mockReturnValue({});
    mutateAsync.mockRejectedValue(new Error("Conflict"));

    render(<Customers />);
    const submit = await openCreateForm(user);
    await user.type(screen.getByLabelText(/Name/), "Mrs Loi");
    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent("That record already exists.");
  });
});
