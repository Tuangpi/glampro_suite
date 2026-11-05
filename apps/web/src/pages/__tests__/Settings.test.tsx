import { MemoryRouter } from "react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/settings/PrivacyNoticeCard", () => ({
  default: () => <div>Privacy notice settings</div>,
}));
vi.mock("@/pages/Outlets", () => ({
  default: () => <input aria-label="Outlet draft" />,
}));
vi.mock("@/components/settings/MessagingCard", () => ({
  default: () => <div>WhatsApp and SMS settings</div>,
}));
vi.mock("@/hooks/useServices", () => ({
  useServiceList: () => ({ data: { data: [], total: 0 }, isPending: false }),
}));

const {
  useModules,
  useSalonProfile,
  useUpdateSalonProfile,
  useUpdateSalonSecurityPolicy,
  useSalonOperatingHours,
  useUpdateSalonOperatingHours,
  useStaffList,
  mutateAsync,
  getValidationDetails,
} = vi.hoisted(() => ({
  useModules: vi.fn(),
  useSalonProfile: vi.fn(),
  useUpdateSalonProfile: vi.fn(),
  useUpdateSalonSecurityPolicy: vi.fn(),
  useSalonOperatingHours: vi.fn(),
  useUpdateSalonOperatingHours: vi.fn(),
  useStaffList: vi.fn(),
  mutateAsync: vi.fn(),
  getValidationDetails: vi.fn(() => ({})),
}));
const auth = vi.hoisted(() => ({ role: "SUPER_ADMIN", readOnly: false }));

vi.mock("@/hooks/useSettings", () => ({
  useModules,
  useSalonProfile,
  useUpdateSalonProfile,
  useUpdateSalonSecurityPolicy,
  useSalonOperatingHours,
  useUpdateSalonOperatingHours,
}));
vi.mock("@/hooks/useStaff", () => ({ useStaffList }));
vi.mock("@/components/settings/CommissionRules", () => ({
  default: () => <section aria-label="Company commission defaults" />,
}));
vi.mock("@/components/settings/PayrollPlans", () => ({
  default: ({ canEdit }: { canEdit: boolean }) => (
    <section aria-label="Versioned commission plans" data-editable={canEdit} />
  ),
}));
vi.mock("@/components/settings/PayrollWorkspace", () => ({
  default: () => <section aria-label="Monthly payroll workspace" />,
}));
vi.mock("@/components/settings/MyEarnings", () => ({
  default: () => <section aria-label="My earnings" />,
}));
vi.mock("@/components/payroll/PayrollProgress", () => ({
  default: () => <section aria-label="Month-to-date commission progress" />,
}));
vi.mock("@/components/settings/CommissionMatrix", () => ({
  default: ({ canEdit }: { canEdit: boolean }) => (
    <section aria-label="Commission matrix" data-editable={canEdit} />
  ),
}));
vi.mock("@/components/settings/CommissionAttributionPolicy", () => ({
  default: ({ canEdit }: { canEdit: boolean }) => (
    <section aria-label="Commission attribution policy" data-editable={canEdit} />
  ),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isReadOnly: auth.readOnly,
    user: { globalRole: auth.role },
  }),
}));
vi.mock("@/lib/api", () => ({
  getErrorMessage: vi.fn(() => "Save failed."),
  getValidationDetails,
}));

const { default: Settings } = await import("@/pages/Settings");

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "SUPER_ADMIN";
  auth.readOnly = false;
  mutateAsync.mockReset().mockResolvedValue({});
  getValidationDetails.mockReturnValue({});
  useSalonProfile.mockReturnValue({
    data: {
      id: "tenant-1",
      name: "Ava Salon",
      slug: "ava-salon",
      status: "ACTIVE",
      lowStockThreshold: 5,
      timeZone: "Asia/Singapore",
      locale: "en-SG",
      gstEnabled: false,
      gstRegistrationNumber: null,
      // Still on the API payload: the screen no longer edits them, and a profile
      // save must leave the stored values alone.
      onlineBookingEnabled: false,
      onlineDepositAmount: 0,
      onlineNoShowFee: 0,
      requireStaffTwoFactor: false,
      owner: { id: "owner-1", name: "Ava Owner", email: "ava@example.com" },

      // The API still returns the salon's stored localisation preferences; the
      // screen simply no longer offers them for editing.
      subscriptionEndsAt: "2027-03-31T00:00:00.000Z",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-10-09T00:00:00.000Z",
    },
    isPending: false,
    isError: false,
  });
  useModules.mockReturnValue({
    data: [
      {
        code: "dashboard",
        name: "Dashboard",
        category: "Core",
        isCore: true,
        entitled: true,
        expiresAt: null,
      },
      {
        code: "reports",
        name: "Reports",
        category: "Add-on",
        isCore: false,
        entitled: true,
        expiresAt: null,
      },
    ],
    isPending: false,
    isError: false,
  });
  useStaffList.mockReturnValue({
    data: {
      data: [
        {
          id: "staff-1",
          name: "Stella Stylist",
          email: "stella@example.com",
          globalRole: "STAFF",
          position: "Senior stylist",
          phone: null,
          avatar: null,
          disabled: false,
          departmentIds: [],
          departmentNames: [],
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      pageCount: 1,
    },
    isPending: false,
    isError: false,
  });
  useUpdateSalonProfile.mockReturnValue({ mutateAsync, isPending: false });
  useUpdateSalonSecurityPolicy.mockReturnValue({ mutateAsync, isPending: false });
  useSalonOperatingHours.mockReturnValue({
    data: {
      tenantId: "tenant-1",
      sunday: null,
      monday: null,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
    },
    isPending: false,
    isError: false,
  });
  useUpdateSalonOperatingHours.mockReturnValue({ mutateAsync, isPending: false });
});

function renderSettings(category = "salon") {
  const result = render(
    <MemoryRouter initialEntries={["/settings"]}>
      <Settings />
    </MemoryRouter>,
  );
  if (category !== "salon") {
    fireEvent.change(screen.getByLabelText("Settings category"), { target: { value: category } });
  }
  return result;
}

describe("Settings", () => {
  it.each(["SUPER_ADMIN", "MANAGER"])("shows attribution policy for %s", (role) => {
    auth.role = role;
    renderSettings("team");
    expect(screen.getByRole("region", { name: "Commission attribution policy" })).toHaveAttribute(
      "data-editable",
      "true",
    );
    expect(screen.getByRole("region", { name: "Commission matrix" })).toHaveAttribute(
      "data-editable",
      "true",
    );
  });
  it("hides attribution policy from staff", () => {
    auth.role = "STAFF";
    renderSettings("team");
    expect(
      screen.queryByRole("region", { name: "Commission attribution policy" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Commission matrix" })).not.toBeInTheDocument();
  });
  it("passes suspended read-only state to attribution policy", () => {
    auth.readOnly = true;
    renderSettings("team");
    expect(screen.getByRole("region", { name: "Commission attribution policy" })).toHaveAttribute(
      "data-editable",
      "false",
    );
    expect(screen.getByRole("region", { name: "Commission matrix" })).toHaveAttribute(
      "data-editable",
      "false",
    );
  });
  it("opens outlets from a direct link without loading salon settings", () => {
    render(
      <MemoryRouter initialEntries={["/settings?section=outlets"]}>
        <Settings />
      </MemoryRouter>,
    );
    expect(screen.getByRole("region", { name: "Outlets" })).toBeVisible();
    expect(screen.getByLabelText("Settings category")).toHaveValue("outlets");
    expect(useSalonProfile).not.toHaveBeenCalled();
  });

  it("loads outlets on demand and preserves outlet drafts across categories", async () => {
    renderSettings();
    expect(screen.queryByLabelText("Outlet draft")).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Settings category"), "outlets");
    await userEvent.type(screen.getByLabelText("Outlet draft"), "East branch");
    await userEvent.selectOptions(screen.getByLabelText("Settings category"), "salon");
    await userEvent.selectOptions(screen.getByLabelText("Settings category"), "outlets");
    expect(screen.getByLabelText("Outlet draft")).toHaveValue("East branch");
  });

  it("falls back to salon details for an unknown section", () => {
    render(
      <MemoryRouter initialEntries={["/settings?section=unknown"]}>
        <Settings />
      </MemoryRouter>,
    );
    expect(screen.getByRole("region", { name: "Salon details" })).toBeVisible();
  });

  it("switches categories using the desktop menu and marks the current category", async () => {
    renderSettings();
    const nav = screen.getByRole("navigation", { name: "Settings categories" });
    await userEvent.click(within(nav).getByRole("button", { name: "Team & commissions" }));
    expect(within(nav).getByRole("button", { name: "Team & commissions" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("Stella Stylist")).toBeVisible();
    expect(screen.getByRole("region", { name: "Company commission defaults" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Manage staff" })).toHaveAttribute("href", "/staff");
  });

  it("starts with only salon details and loads other categories on demand", async () => {
    renderSettings();
    expect(screen.getByRole("region", { name: "Salon details" })).toBeVisible();
    expect(screen.queryByText("Business hours")).not.toBeInTheDocument();
    expect(useModules).not.toHaveBeenCalled();
    expect(useStaffList).not.toHaveBeenCalled();

    await userEvent.selectOptions(screen.getByLabelText("Settings category"), "booking");
    const booking = screen.getByRole("region", { name: "Booking & hours" });
    expect(within(booking).getByText("Business hours")).toBeVisible();
    expect(screen.queryByRole("region", { name: "Salon details" })).not.toBeInTheDocument();
  });

  it("preserves unsaved salon and business-hours drafts when switching categories", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.clear(screen.getByLabelText("Salon name"));
    await user.type(screen.getByLabelText("Salon name"), "Unsaved salon");
    await user.selectOptions(screen.getByLabelText("Settings category"), "booking");
    // Every day is closed on the server, so ticking Tuesday opens it with the
    // card's default window — the draft the round trip below has to keep.
    await user.click(screen.getByLabelText("Tuesday"));
    const opens = screen.getAllByLabelText("Opens");
    expect(opens).toHaveLength(1);
    await user.clear(opens[0]);
    await user.type(opens[0], "10:30");
    await user.selectOptions(screen.getByLabelText("Settings category"), "salon");
    expect(screen.getByLabelText("Salon name")).toHaveValue("Unsaved salon");
    await user.selectOptions(screen.getByLabelText("Settings category"), "booking");
    expect(screen.getByLabelText("Tuesday")).toBeChecked();
    expect(screen.getAllByLabelText("Opens")[0]).toHaveValue("10:30");
    await user.click(screen.getByRole("button", { name: "Save hours" }));
    expect(mutateAsync).toHaveBeenCalledWith({
      tuesday: { open: "10:30", close: "20:00" },
    });
  });

  it("no longer offers the online-booking or rooms settings in the booking category", () => {
    renderSettings("booking");
    // Hiding is deliberate. The business hours stay, and the rooms a booking may
    // occupy stay on the server — `assignResources` still gives every occupying
    // line a free room — but nothing on this screen edits the toggle, the fees or
    // the room list. The profile write never sends those keys, so nothing here
    // can change them.
    expect(screen.getByText("Business hours")).toBeVisible();
    expect(screen.queryByText("Rooms and equipment")).not.toBeInTheDocument();
    expect(screen.queryByText("Online booking")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Enable online booking")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Deposit amount (SGD)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("No-show fee (SGD)")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save booking settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add room or equipment" })).not.toBeInTheDocument();
  });

  it("keeps personal security separate from salon privacy notices", async () => {
    renderSettings();
    await userEvent.selectOptions(screen.getByLabelText("Settings category"), "privacy");
    expect(screen.getByText("Account security")).toBeVisible();
    // The salon-wide policy is the owner's, and is a different question from the
    // member's own switch — so it is its own card on the same screen.
    expect(screen.getByText("Staff sign-in policy")).toBeVisible();
    expect(screen.getByText("Privacy notice settings")).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText("Settings category"), "messages");
    expect(screen.getByText("WhatsApp and SMS settings")).toBeVisible();
  });

  it("offers the salon-wide staff policy to the owner only", async () => {
    auth.role = "MANAGER";
    renderSettings();
    await userEvent.selectOptions(screen.getByLabelText("Settings category"), "privacy");
    // A manager can still manage their own second factor…
    expect(screen.getByText("Account security")).toBeVisible();
    // …but not bind their colleagues' sign-in.
    expect(screen.queryByText("Staff sign-in policy")).not.toBeInTheDocument();
  });

  it("uses salon-facing guidance without architecture or release-planning copy", async () => {
    renderSettings();

    expect(screen.getByText("Salon identifier")).toBeInTheDocument();
    expect(
      screen.getByText("Products with stock at or below this quantity are marked as low stock."),
    ).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Settings category"), "features");
    expect(
      screen.getByText(
        "View the features available to your salon. Contact support to change your subscription.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/ADR 0010|when those features ship|entitlements|platform operator/i),
    ).not.toBeInTheDocument();
  });

  it("renders the profile, purchased modules and the real team summary in their categories", async () => {
    renderSettings();
    expect(screen.getByDisplayValue("Ava Salon")).toBeInTheDocument();
    expect(screen.getByText("ava-salon")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Settings category"), "features");
    expect(screen.getByText("Reports")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Settings category"), "team");
    expect(screen.getByText("Stella Stylist")).toBeInTheDocument();
    expect(screen.getByText("Senior stylist")).toBeInTheDocument();
  });

  it("lists modules by access, with no renewal date for the salon to read", async () => {
    renderSettings();
    await userEvent.selectOptions(screen.getByLabelText("Settings category"), "features");

    const table = screen.getByRole("table", { name: "Modules this salon has access to" });
    // Access is the only question this panel answers: `expiresAt` is a grant
    // lapse date the platform console owns, and nothing here renews.
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Module", "Type", "Access"]);
    expect(within(table).queryByText("Renews")).not.toBeInTheDocument();
    // One header row and the two catalogue rows the fixture returns.
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText("Active")).toBeInTheDocument();
  });

  it("saves salon-editable fields without touching the platform-owned preferences", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.clear(screen.getByLabelText("Salon name"));
    await user.type(screen.getByLabelText("Salon name"), "New Salon Name");
    await user.clear(screen.getByLabelText("Low-stock threshold"));
    await user.type(screen.getByLabelText("Low-stock threshold"), "8");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    // No `timeZone`/`locale`: omitted keys are left alone by the service, so a
    // profile save can never reset the salon's formatting preferences.
    expect(mutateAsync).toHaveBeenCalledWith({
      name: "New Salon Name",
      lowStockThreshold: 8,
      gstEnabled: false,
      gstRegistrationNumber: null,
    });
  });

  it("hides the timezone and formatting locale fields", () => {
    auth.role = "MANAGER";
    renderSettings();
    expect(screen.queryByLabelText("Salon timezone")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Formatting locale")).not.toBeInTheDocument();
    // The rest of the profile form is still there.
    expect(screen.getByLabelText("Salon name")).toBeEnabled();
  });

  it("lets a manager switch GST on and save the registration number", async () => {
    auth.role = "MANAGER";
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByLabelText("Charge GST (9% inclusive)"));
    await user.type(screen.getByLabelText("GST registration number"), "M90312345X");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(mutateAsync).toHaveBeenCalledWith({
      name: "Ava Salon",
      lowStockThreshold: 5,
      gstEnabled: true,
      gstRegistrationNumber: "M90312345X",
    });
  });

  it("shows the server's error when GST is enabled without a registration number", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("Validation failed"));
    getValidationDetails.mockReturnValueOnce({
      "body.gstRegistrationNumber": "A GST registration number is required when GST is enabled.",
    });
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByLabelText("Charge GST (9% inclusive)"));
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(
      screen.getByText("A GST registration number is required when GST is enabled."),
    ).toBeInTheDocument();
  });

  it("disables the GST controls for a read-only salon", () => {
    auth.readOnly = true;
    renderSettings();

    expect(screen.getByLabelText("Charge GST (9% inclusive)")).toBeDisabled();
    expect(screen.queryByLabelText("GST registration number")).not.toBeInTheDocument();
  });

  it("displays server validation errors without losing the draft", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("Name is required"));
    getValidationDetails.mockReturnValueOnce({ "body.name": "Name is required" });
    const user = userEvent.setup();
    renderSettings();
    await user.clear(screen.getByLabelText("Salon name"));
    await user.type(screen.getByLabelText("Salon name"), "Draft Salon");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(screen.getByLabelText("Salon name")).toHaveValue("Draft Salon");
  });

  it("shows the subscription expiry in the account details", () => {
    renderSettings();
    // Read-only fact, formatted by the salon's own formatter (en-SG, 2-digit).
    const label = screen.getByText("Subscription ends");
    expect(label.parentElement).toHaveTextContent("31/03/2027");
  });

  it("says so when no plan is recorded", () => {
    const profile = useSalonProfile();
    useSalonProfile.mockReturnValue({
      ...profile,
      data: { ...profile.data, subscriptionEndsAt: null },
    });
    renderSettings();
    const label = screen.getByText("Subscription ends");
    expect(label.parentElement).toHaveTextContent("—");
  });

  it("disables the profile form for a read-only salon", () => {
    auth.readOnly = true;
    renderSettings();
    expect(screen.getByLabelText("Salon name")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save profile" })).not.toBeInTheDocument();
    // Localisation is platform-owned now, so it is absent for everyone.
    expect(screen.queryByLabelText("Salon timezone")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Formatting locale")).not.toBeInTheDocument();
  });

  it("renders the business hours card", () => {
    useSalonOperatingHours.mockReturnValue({
      data: {
        tenantId: "tenant-1",
        sunday: null,
        monday: null,
        tuesday: null,
        wednesday: null,
        thursday: null,
        friday: null,
        saturday: null,
      },
      isPending: false,
      isError: false,
    });
    renderSettings("booking");
    expect(screen.getByText("Business hours")).toBeInTheDocument();
    expect(screen.getByText("Used to generate available appointment slots.")).toBeInTheDocument();
    for (const day of [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]) {
      expect(screen.getByText(day)).toBeInTheDocument();
    }
  });

  it("allows a manager to toggle business hours days", async () => {
    auth.role = "MANAGER";
    const user = userEvent.setup();
    useUpdateSalonOperatingHours.mockReturnValue({ mutateAsync, isPending: false });
    useSalonOperatingHours.mockReturnValue({
      data: {
        tenantId: "tenant-1",
        sunday: null,
        monday: { open: "09:00", close: "20:00" },
        tuesday: { open: "09:00", close: "20:00" },
        wednesday: null,
        thursday: null,
        friday: null,
        saturday: null,
      },
      isPending: false,
      isError: false,
    });
    renderSettings("booking");
    // Tuesday is open: click the checkbox to close it.
    await user.click(screen.getByLabelText("Tuesday"));
    // Monday opens at 09:00 and closes at 20:00.
    expect(screen.getAllByDisplayValue("09:00")[0]).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("20:00")[0]).toBeInTheDocument();
    // Submit the form to trigger the save.
    await user.click(screen.getByRole("button", { name: "Save hours" }));
    expect(mutateAsync).toHaveBeenCalledWith({
      tuesday: null,
    });
  });

  it("allows a manager to change a business-hours window", async () => {
    auth.role = "MANAGER";
    const user = userEvent.setup();
    useUpdateSalonOperatingHours.mockReturnValue({ mutateAsync, isPending: false });
    useSalonOperatingHours.mockReturnValue({
      data: {
        tenantId: "tenant-1",
        sunday: null,
        monday: null,
        tuesday: null,
        wednesday: null,
        thursday: null,
        friday: null,
        saturday: null,
      },
      isPending: false,
      isError: false,
    });
    renderSettings("booking");
    // Open the Monday checkbox (closed -> open with defaults).
    await user.click(screen.getByLabelText("Monday"));
    // The Opens and Closes inputs for the panels: Monday is the first.
    const opens = screen.getAllByLabelText("Opens");
    const closes = screen.getAllByLabelText("Closes");
    await user.clear(opens[0]);
    await user.type(opens[0], "10:00");
    await user.clear(closes[0]);
    await user.type(closes[0], "18:00");
    await user.click(screen.getByRole("button", { name: "Save hours" }));
    expect(mutateAsync).toHaveBeenCalledWith({
      monday: { open: "10:00", close: "18:00" },
    });
  });

  it("hides the save action for a staff member", () => {
    auth.role = "STAFF";
    useSalonOperatingHours.mockReturnValue({
      data: {
        tenantId: "tenant-1",
        sunday: null,
        monday: null,
        tuesday: null,
        wednesday: null,
        thursday: null,
        friday: null,
        saturday: null,
      },
      isPending: false,
      isError: false,
    });
    renderSettings("booking");
    expect(screen.queryByRole("button", { name: "Save hours" })).not.toBeInTheDocument();
  });

  it("removes the save action for a staff member", () => {
    auth.role = "STAFF";
    renderSettings();
    expect(screen.queryByRole("button", { name: "Save profile" })).not.toBeInTheDocument();
    expect(
      screen.getByText("Only a manager or the owner can change the salon profile."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Salon name")).toBeDisabled();
  });
});
