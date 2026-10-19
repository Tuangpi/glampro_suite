import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CustomerProfile from "@/pages/CustomerProfile";

const mocks = vi.hoisted(() => ({
  customer: vi.fn(),
  holdings: vi.fn(),
  getPaginated: vi.fn(),
  post: vi.fn(),
  readOnly: false,
}));
vi.mock("@/hooks/useCustomers", () => ({
  useCustomer: mocks.customer,
  useCustomerHoldings: mocks.holdings,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isReadOnly: mocks.readOnly }) }));
vi.mock("@/components/customers/CustomerFormDrawer", () => ({
  default: () => <div>Profile editor with consent</div>,
}));
vi.mock("@/lib/api", () => ({
  default: { get: vi.fn() },
  getPaginated: mocks.getPaginated,
  post: mocks.post,
  del: vi.fn(),
  getErrorMessage: () => "Request failed",
}));

function renderProfile() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={["/customers/c1"]}>
        <Routes>
          <Route path="/customers/:id" element={<CustomerProfile />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.readOnly = false;
  mocks.customer.mockReturnValue({
    data: {
      id: "c1",
      name: "Mina",
      phone: null,
      email: null,
      createdAt: "2020-01-01",
      departments: [],
      comment: "Sensitive skin",
    },
    isPending: false,
  });
  mocks.holdings.mockReturnValue({
    data: {
      holdings: [
        { id: "p1", name: "Facial", kind: "PACKAGE", quantityRemaining: 3, expiresAt: null },
        {
          id: "v1",
          name: "Wallet",
          kind: "PREPAID_CREDIT",
          amountRemaining: "42.50",
          expiresAt: null,
        },
      ],
    },
  });
  mocks.getPaginated.mockImplementation(async (path: string) => ({
    data: path.endsWith("visits")
      ? [{ id: "a1", startsAt: "2020-01-01", status: "COMPLETED", service: "Facial", staff: "Ada" }]
      : path.endsWith("purchases")
        ? [{ id: "s1", soldAt: "2020-01-01", status: "VOID", receiptNumber: 12, total: "42.50" }]
        : [],
    pageCount: 2,
  }));
});
describe("customer profile", () => {
  it("shows notes, visits, void labels and correctly scaled balances", async () => {
    renderProfile();
    expect(screen.getByText("Sensitive skin")).toBeInTheDocument();
    const balances = screen.getByRole("region", { name: "Package and credit balances" });
    expect(within(balances).getByText(/3 sessions/)).toBeInTheDocument();
    expect(within(balances).getByText(/S\$42.50/)).toBeInTheDocument();
    expect(await screen.findByText("VOID")).toBeInTheDocument();
    expect(screen.getByText(/Receipt #12/)).toHaveTextContent("S$42.50");
    expect(screen.getByRole("link", { name: "Back to customers" })).toHaveAttribute(
      "href",
      "/customers",
    );
  });
  it("pages history on the server and opens the existing editor", async () => {
    const user = userEvent.setup();
    renderProfile();
    const pages = await screen.findByRole("navigation", { name: "Visit history pages" });
    await user.click(within(pages).getByRole("button", { name: /next/i }));
    await waitFor(() =>
      expect(mocks.getPaginated).toHaveBeenCalledWith("/customers/c1/visits", {
        page: 2,
        pageSize: 10,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Edit profile and consent" }));
    expect(screen.getByText("Profile editor with consent")).toBeInTheDocument();
  });
  it("disables editing and hides photo writes for read-only tenants", async () => {
    mocks.readOnly = true;
    renderProfile();
    expect(screen.getByRole("button", { name: "Edit profile and consent" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Upload photo" })).not.toBeInTheDocument();
    expect(await screen.findByText("No photos yet.")).toBeInTheDocument();
  });
  it("shows load errors instead of inventing an empty customer", () => {
    mocks.customer.mockReturnValue({ isError: true, error: new Error("no"), refetch: vi.fn() });
    renderProfile();
    expect(screen.getByRole("alert")).toHaveTextContent("Customer could not be loaded");
  });
  it("uploads a photo and reports server consent refusal", async () => {
    mocks.post.mockRejectedValue(new Error("consent"));
    const user = userEvent.setup();
    renderProfile();
    await user.upload(
      screen.getByLabelText("Photo"),
      new File(["photo"], "photo.png", { type: "image/png" }),
    );
    await user.type(screen.getByLabelText("Photo caption"), "Treatment");
    await user.click(screen.getByRole("button", { name: "Upload photo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Request failed");
    expect(mocks.post).toHaveBeenCalledWith("/customers/c1/photos", expect.any(FormData));
  });
});
