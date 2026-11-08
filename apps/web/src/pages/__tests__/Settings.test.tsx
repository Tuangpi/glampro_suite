import { MemoryRouter, useLocation } from "react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/settings/PrivacyNoticeCard", () => ({
  default: () => <div>Privacy notice settings</div>,
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
  useUploadSalonLogo,
  useDeleteSalonLogo,
  mutateAsync,
  getValidationDetails,
} = vi.hoisted(() => ({
  useModules: vi.fn(),
  useSalonProfile: vi.fn(),
  useUpdateSalonProfile: vi.fn(),
  useUpdateSalonSecurityPolicy: vi.fn(),
  useSalonOperatingHours: vi.fn(),
  useUpdateSalonOperatingHours: vi.fn(),
  useUploadSalonLogo: vi.fn(),
  useDeleteSalonLogo: vi.fn(),
  mutateAsync: vi.fn(),
  getValidationDetails: vi.fn(() => ({})),
}));
const auth = vi.hoisted(() => ({ role: "SUPER_ADMIN", readOnly: false, twoFactorEnabled: false }));

vi.mock("@/hooks/useSettings", () => ({
  useModules,
  useSalonProfile,
  useUpdateSalonProfile,
  useUpdateSalonSecurityPolicy,
  useSalonOperatingHours,
  useUpdateSalonOperatingHours,
  useUploadSalonLogo,
  useDeleteSalonLogo,
}));
vi.mock("@/components/settings/CommissionRules", () => ({
  default: () => <section aria-label="Company commission defaults" />,
}));
vi.mock("@/components/settings/PayrollPlans", () => ({
  default: ({ canEdit }: { canEdit: boolean }) => (
    <section aria-label="Versioned commission plans" data-editable={canEdit} />
  ),
}));
vi.mock("@/components/settings/PayrollWorkspace", () => ({
  default: ({ period }: { period?: string }) => (
    <section aria-label="Monthly payroll workspace" data-period={period} />
  ),
}));
vi.mock("@/components/settings/MyEarnings", () => ({
  default: () => <section aria-label="My earnings" />,
}));
vi.mock("@/components/payroll/PayrollProgress", () => ({
  default: ({ period }: { period?: string }) => (
    <section aria-label="Month-to-date commission progress" data-period={period} />
  ),
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
    user: { globalRole: auth.role, twoFactorEnabled: auth.twoFactorEnabled },
  }),
}));
vi.mock("@/lib/api", () => ({
  getErrorMessage: vi.fn(() => "Save failed."),
  getValidationDetails,
}));

const { default: Settings } = await import("@/pages/Settings");

function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>;
}

it("redirects old team progress bookmarks while retaining the month and other parameters", () => {
  render(
    <MemoryRouter
      initialEntries={["/settings?section=team&team=progress&period=2026-09&returnTo=pay-plans"]}
    >
      <Settings />
      <LocationProbe />
    </MemoryRouter>,
  );
  const params = new URLSearchParams(screen.getByTestId("location").textContent ?? "");
  expect(params.get("section")).toBe("payroll");
  expect(params.get("payroll")).toBe("progress");
  expect(params.get("period")).toBe("2026-09");
  expect(params.get("returnTo")).toBe("pay-plans");
  expect(params.has("team")).toBe(false);
});

it("keeps earning configuration in Team without a duplicate progress tab", () => {
  render(
    <MemoryRouter initialEntries={["/settings?section=team"]}>
      <Settings />
    </MemoryRouter>,
  );
  expect(screen.getByRole("tab", { name: "Company rules" })).toBeVisible();
  expect(screen.queryByRole("tab", { name: "Commission progress" })).not.toBeInTheDocument();
});

it.each([
  ["/settings?section=payroll&team=progress&period=2026-09", "Monthly payroll workspace"],
  ["/settings?section=team&team=progress&period=2026-09", "Monthly payroll workspace"],
])("passes the linked payroll month through %s", (entry, label) => {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Settings />
    </MemoryRouter>,
  );
  expect(screen.getByLabelText(label)).toHaveAttribute("data-period", "2026-09");
  expect(screen.getByRole("region", { name: "Payroll" })).toBeVisible();
});

it("returns verified owners from security setup to the Pay plans tab", async () => {
  auth.twoFactorEnabled = true;
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/settings?section=privacy&returnTo=pay-plans"]}>
      <Settings />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("button", { name: "Back to Pay plans" }));
  expect(screen.getByRole("tab", { name: "Pay plans" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByLabelText("Versioned commission plans")).toBeVisible();
});

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "SUPER_ADMIN";
  auth.readOnly = false;
  auth.twoFactorEnabled = false;
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
      // No logo uploaded, so the receipt prints the initials monogram.
      logoUrl: null,
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
  useUpdateSalonProfile.mockReturnValue({ mutateAsync, isPending: false });
  useUpdateSalonSecurityPolicy.mockReturnValue({ mutateAsync, isPending: false });
  useUploadSalonLogo.mockReturnValue({ mutateAsync, isPending: false });
  useDeleteSalonLogo.mockReturnValue({ mutateAsync, isPending: false });
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
  it.each(["SUPER_ADMIN", "MANAGER"])(
    "opens team & commissions on company rules and reaches attribution for %s",
    async (role) => {
      auth.role = role;
      renderSettings("team");
      // Shared defaults open first; individual editing lives on the staff profile.
      expect(screen.getByRole("region", { name: "Company commission defaults" })).toBeVisible();
      await userEvent.click(screen.getByRole("tab", { name: "Rate overview" }));
      expect(screen.getByRole("region", { name: "Commission matrix" })).toHaveAttribute(
        "data-editable",
        "true",
      );
      await userEvent.click(screen.getByRole("tab", { name: "Attribution" }));
      expect(screen.getByRole("region", { name: "Commission attribution policy" })).toHaveAttribute(
        "data-editable",
        "true",
      );
    },
  );
  it("hides attribution policy from staff", () => {
    auth.role = "STAFF";
    renderSettings("team");
    expect(
      screen.queryByRole("region", { name: "Commission attribution policy" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Commission matrix" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tablist", { name: "Team and commissions sections" }),
    ).not.toBeInTheDocument();
  });
  it("passes suspended read-only state to attribution policy", async () => {
    auth.readOnly = true;
    renderSettings("team");
    await userEvent.click(screen.getByRole("tab", { name: "Rate overview" }));
    expect(screen.getByRole("region", { name: "Commission matrix" })).toHaveAttribute(
      "data-editable",
      "false",
    );
    await userEvent.click(screen.getByRole("tab", { name: "Attribution" }));
    expect(screen.getByRole("region", { name: "Commission attribution policy" })).toHaveAttribute(
      "data-editable",
      "false",
    );
  });
  it("opens the team tab named in the URL", () => {
    render(
      <MemoryRouter initialEntries={["/settings?section=team&team=plans"]}>
        <Settings />
      </MemoryRouter>,
    );
    expect(screen.getByRole("tab", { name: "Pay plans" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Versioned commission plans" })).toHaveAttribute(
      "data-editable",
      "true",
    );
  });
  it("mounts a team panel on first visit and keeps it when the tab changes", async () => {
    const { container } = renderSettings("team");
    await userEvent.click(screen.getByRole("tab", { name: "Rate overview" }));
    expect(screen.getByRole("region", { name: "Commission matrix" })).toBeVisible();
    expect(container.querySelector('[aria-label="Versioned commission plans"]')).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "Pay plans" }));

    expect(screen.getByRole("region", { name: "Versioned commission plans" })).toBeVisible();
    // The visited matrix panel stays mounted so an unsaved rate draft is not
    // thrown away by a look at another tab — but it leaves the accessibility
    // tree, so `region` queries only ever see the open tab.
    expect(container.querySelector('[aria-label="Commission matrix"]')).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Commission matrix" })).not.toBeInTheDocument();
  });
  // Outlet management is parked (`constants/outlets.ts`). The category must not be
  // offered at all — a disabled control would still promise a screen — and a link
  // saved from before the hide has to land somewhere real rather than on a
  // category that draws nothing.
  it("keeps the parked outlets category off the settings screen", () => {
    renderSettings();
    expect(
      within(screen.getByLabelText("Settings category")).queryByRole("option", { name: "Outlets" }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("navigation", { name: "Settings categories" })).queryByRole(
        "button",
        { name: "Outlets" },
      ),
    ).not.toBeInTheDocument();
  });

  it("falls back to salon details for a parked outlets link", () => {
    render(
      <MemoryRouter initialEntries={["/settings?section=outlets"]}>
        <Settings />
      </MemoryRouter>,
    );
    expect(screen.getByRole("region", { name: "Salon details" })).toBeVisible();
    expect(screen.getByLabelText("Settings category")).toHaveValue("salon");
    expect(useSalonProfile).toHaveBeenCalled();
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
    await userEvent.click(screen.getByRole("tab", { name: "Company rules" }));
    expect(screen.getByRole("region", { name: "Company commission defaults" })).toBeVisible();
    // The roster belongs to the Staff screen. This category configures
    // commission defaults and must not render a second copy of that table.
    expect(screen.queryByRole("link", { name: "Manage staff" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("table", { name: "Active staff and their roles" }),
    ).not.toBeInTheDocument();
  });

  it("starts with only salon details and loads other categories on demand", async () => {
    renderSettings();
    expect(screen.getByRole("region", { name: "Salon details" })).toBeVisible();
    expect(screen.queryByText("Business hours")).not.toBeInTheDocument();
    expect(useModules).not.toHaveBeenCalled();

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

  it("renders the profile and purchased modules in their categories", async () => {
    renderSettings();
    expect(screen.getByDisplayValue("Ava Salon")).toBeInTheDocument();
    expect(screen.getByText("ava-salon")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Settings category"), "features");
    expect(screen.getByText("Reports")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Settings category"), "team");
    // The team category is commission configuration only — the staff list is
    // the Staff screen's job.
    expect(
      screen.queryByRole("table", { name: "Active staff and their roles" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Company rules" }));
    expect(screen.getByRole("region", { name: "Company commission defaults" })).toBeVisible();
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
