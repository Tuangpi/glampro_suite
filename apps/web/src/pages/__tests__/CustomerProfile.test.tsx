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
  modules: vi.fn(),
}));
vi.mock("@/hooks/useSettings", () => ({ useModules: mocks.modules }));
vi.mock("@/pages/CustomerTreatmentList", () => ({
  default: ({ customerId }: { customerId: string }) => <div>Treatments for {customerId}</div>,
}));
vi.mock("@/hooks/useCustomers", () => ({
  useCustomer: mocks.customer,
  useCustomerHoldings: mocks.holdings,
  useHoldingHistory: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isReadOnly: mocks.readOnly }) }));
vi.mock("@/components/customers/CustomerFormDrawer", () => ({
  default: () => <div>Profile editor with consent</div>,
}));
vi.mock("@/components/customers/CustomerArchivePanel", () => ({
  default: ({ customer }: { customer: { id: string } }) => <div>Archival for {customer.id}</div>,
}));
vi.mock("@/lib/api", () => ({
  default: { get: vi.fn() },
  getPaginated: mocks.getPaginated,
  post: mocks.post,
  del: vi.fn(),
  getErrorMessage: () => "Request failed",
}));

function renderProfile(entry = "/customers/c1") {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[entry]}>
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
  mocks.modules.mockReturnValue({ data: [], isPending: false });
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
  it("mounts treatments only with the treatment entitlement", async () => {
    mocks.modules.mockReturnValue({
      data: [{ code: "treatments", entitled: true }],
      isPending: false,
    });
    const user = userEvent.setup();
    renderProfile();
    await user.click(screen.getByRole("tab", { name: "Treatments" }));
    expect(screen.getByText("Treatments for c1")).toBeInTheDocument();
  });
  it("does not mount treatments for unentitled salons", async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(screen.getByRole("tab", { name: "Treatments" }));
    expect(screen.queryByText("Treatments for c1")).not.toBeInTheDocument();
    expect(screen.getByText("The treatments add-on is not enabled")).toBeInTheDocument();
  });
  it("shows notes and balances on the overview and the void sale on history", async () => {
    const user = userEvent.setup();
    renderProfile();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Sensitive skin")).toBeInTheDocument();
    expect(screen.getByText("Archival for c1")).toBeInTheDocument();
    const balances = screen.getByRole("region", { name: "Balances" });
    expect(within(balances).getByText(/3 sessions/)).toBeInTheDocument();
    expect(within(balances).getByText(/S\$42.50/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to customers" })).toHaveAttribute(
      "href",
      "/customers",
    );
    // Sales moved behind their own tab, so nothing is claimed about them on the first screen.
    expect(screen.queryByText("VOID")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(await screen.findByText("VOID")).toBeInTheDocument();
    expect(screen.getByText(/Receipt #12/)).toHaveTextContent("S$42.50");
  });
  it("pages history on the server and opens the existing editor", async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(screen.getByRole("tab", { name: "History" }));
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
    const user = userEvent.setup();
    renderProfile();
    expect(screen.getByRole("button", { name: "Edit profile and consent" })).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "Photos" }));
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
    await user.click(screen.getByRole("tab", { name: "Photos" }));
    await user.upload(
      screen.getByLabelText("Photo"),
      new File(["photo"], "photo.png", { type: "image/png" }),
    );
    await user.type(screen.getByLabelText("Photo caption"), "Treatment");
    await user.click(screen.getByRole("button", { name: "Upload photo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Request failed");
    expect(mocks.post).toHaveBeenCalledWith("/customers/c1/photos", expect.any(FormData));
  });
  it("explains what a photo is for before it asks for one", async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(screen.getByRole("tab", { name: "Photos" }));
    expect(
      screen.getByText(/what the hair or nails looked like before and after a service/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Upload requires recorded data consent/)).toBeInTheDocument();
    expect(screen.getByText(/tagged Before or After there/)).toBeInTheDocument();
    expect(screen.getByText("JPEG or PNG, up to 5 MB.")).toBeInTheDocument();
    // Tagging happens on the treatment record, so the guidance sends the reader there.
    await user.click(screen.getByRole("button", { name: "Tag before/after on a treatment" }));
    expect(screen.getByRole("tab", { name: "Treatments" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
  it("fetches a section's data only once that section is opened", async () => {
    const user = userEvent.setup();
    renderProfile();
    expect(mocks.getPaginated).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Photo")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(mocks.getPaginated.mock.calls.some(([path]) => String(path).endsWith("/visits"))).toBe(
      true,
    );
  });
  it("opens the section named in the URL", async () => {
    renderProfile("/customers/c1?tab=history");
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText(/Receipt #12/)).toBeInTheDocument();
  });
  it("dials and mails the customer from the header", () => {
    mocks.customer.mockReturnValue({
      data: {
        id: "c1",
        name: "Mina",
        phone: "91234567",
        email: "mina@example.test",
        createdAt: "2020-01-01",
        departments: [{ id: "d1", name: "Orchard" }],
        comment: null,
      },
      isPending: false,
    });
    renderProfile();
    expect(screen.getByRole("link", { name: "91234567" })).toHaveAttribute("href", "tel:91234567");
    expect(screen.getByRole("link", { name: "mina@example.test" })).toHaveAttribute(
      "href",
      "mailto:mina@example.test",
    );
  });
  it("marks an archived customer in the header", () => {
    mocks.customer.mockReturnValue({
      data: {
        id: "c1",
        name: "Mina",
        phone: null,
        email: null,
        createdAt: "2020-01-01",
        departments: [],
        comment: null,
        archivedAt: "2021-05-05T10:00:00.000Z",
      },
      isPending: false,
    });
    renderProfile();
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });
  it("reads stored profile fields back in the form's own words", () => {
    mocks.customer.mockReturnValue({
      data: {
        id: "c1",
        name: "Mina",
        phone: null,
        email: null,
        createdAt: "2020-01-01",
        departments: [],
        comment: null,
        gender: "UNDISCLOSED",
        cardNumber: "C-0007",
        hairCardNumber: null,
        maniCardNumber: "M-0031",
      },
      isPending: false,
    });
    renderProfile();
    // The words the form offers, not the stored enum: nobody enters "UNDISCLOSED".
    expect(screen.getByText("Prefer not to say")).toBeInTheDocument();
    expect(screen.getByText("C-0007")).toBeInTheDocument();
    expect(screen.getByText("M-0031")).toBeInTheDocument();
  });
  it("names the add-on when the packages tab has nothing to show", async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(screen.getByRole("tab", { name: "Packages & credit" }));
    expect(screen.getByText("The packages add-on is not enabled")).toBeInTheDocument();
    // Not one card mounts behind an unentitled tab: no balance, family or evidence read.
    expect(mocks.getPaginated).not.toHaveBeenCalled();
  });
  it("says what an empty balance rail means", () => {
    mocks.holdings.mockReturnValue({ data: { holdings: [] }, isPending: false });
    renderProfile();
    const balances = screen.getByRole("region", { name: "Balances" });
    expect(within(balances).getByText("No active balances")).toBeInTheDocument();
  });
});
