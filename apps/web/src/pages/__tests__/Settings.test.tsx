import { MemoryRouter } from "react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/settings/PrivacyNoticeCard", () => ({
  default: () => <div>Privacy notice settings</div>,
}));
vi.mock("@/components/settings/MessagingCard", () => ({
  default: () => <div>WhatsApp and SMS settings</div>,
}));
// The rooms card reads two lists of its own (phase D). Mocked at the hook level so
// this suite keeps testing the page's own wiring rather than the card's queries.
vi.mock("@/hooks/useResources", () => ({
  useResourceList: () => ({ data: [], isPending: false, isError: false }),
  useResourceServices: () => ({ data: { data: [] }, isPending: false, isError: false }),
  useCreateResource: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateResource: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useServices", () => ({
  useServiceList: () => ({ data: { data: [], total: 0 }, isPending: false }),
}));

const {
  useModules,
  useSalonProfile,
  useUpdateSalonProfile,
  useSalonOperatingHours,
  useUpdateSalonOperatingHours,
  useStaffList,
  mutateAsync,
  getValidationDetails,
} = vi.hoisted(() => ({
  useModules: vi.fn(),
  useSalonProfile: vi.fn(),
  useUpdateSalonProfile: vi.fn(),
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
  useSalonOperatingHours,
  useUpdateSalonOperatingHours,
}));
vi.mock("@/hooks/useStaff", () => ({ useStaffList }));
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
      onlineBookingEnabled: false,
      onlineDepositAmount: 0,
      onlineNoShowFee: 0,
      owner: { id: "owner-1", name: "Ava Owner", email: "ava@example.com" },

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

function renderSettings() {
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  );
}

describe("Settings", () => {
  it("uses salon-facing guidance without architecture or release-planning copy", () => {
    renderSettings();

    expect(screen.getByText("Salon identifier")).toBeInTheDocument();
    expect(
      screen.getByText("Products with stock at or below this quantity are marked as low stock."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "View the features available to your salon. Contact support to change your subscription.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/ADR 0010|when those features ship|entitlements|platform operator/i),
    ).not.toBeInTheDocument();
  });

  it("renders the profile, purchased modules and the real team summary", () => {
    renderSettings();
    expect(screen.getByDisplayValue("Ava Salon")).toBeInTheDocument();
    expect(screen.getByText("ava-salon")).toBeInTheDocument();
    expect(screen.getByText("Reports")).toBeInTheDocument();
    expect(screen.getByText("Stella Stylist")).toBeInTheDocument();
    expect(screen.getByText("Senior stylist")).toBeInTheDocument();
  });

  it("saves salon-editable fields including persisted localisation preferences", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.clear(screen.getByLabelText("Salon name"));
    await user.type(screen.getByLabelText("Salon name"), "New Salon Name");
    await user.clear(screen.getByLabelText("Low-stock threshold"));
    await user.type(screen.getByLabelText("Low-stock threshold"), "8");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(mutateAsync).toHaveBeenCalledWith({
      name: "New Salon Name",
      lowStockThreshold: 8,
      timeZone: "Asia/Singapore",
      locale: "en-SG",
      gstEnabled: false,
      gstRegistrationNumber: null,
      onlineBookingEnabled: false,
      onlineDepositAmount: 0,
      onlineNoShowFee: 0,
    });
  });

  it("allows a manager to change the saved timezone and formatting locale", async () => {
    auth.role = "MANAGER";
    const user = userEvent.setup();
    renderSettings();
    await user.clear(screen.getByLabelText("Salon timezone"));
    await user.type(screen.getByLabelText("Salon timezone"), "Europe/London");
    await user.clear(screen.getByLabelText("Formatting locale"));
    await user.type(screen.getByLabelText("Formatting locale"), "en-GB");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(mutateAsync).toHaveBeenCalledWith({
      name: "Ava Salon",
      lowStockThreshold: 5,
      timeZone: "Europe/London",
      locale: "en-GB",
      gstEnabled: false,
      gstRegistrationNumber: null,
      onlineBookingEnabled: false,
      onlineDepositAmount: 0,
      onlineNoShowFee: 0,
    });
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
      timeZone: "Asia/Singapore",
      locale: "en-SG",
      gstEnabled: true,
      gstRegistrationNumber: "M90312345X",
      onlineBookingEnabled: false,
      onlineDepositAmount: 0,
      onlineNoShowFee: 0,
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
    expect(screen.getByLabelText("GST registration number")).toBeDisabled();
  });

  it("displays server validation errors without losing the draft preferences", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("Invalid timezone"));
    getValidationDetails.mockReturnValueOnce({ "body.timeZone": "Choose a valid timezone" });
    const user = userEvent.setup();
    renderSettings();
    await user.clear(screen.getByLabelText("Salon timezone"));
    await user.type(screen.getByLabelText("Salon timezone"), "Mars/Olympus");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(screen.getByText("Choose a valid timezone")).toBeInTheDocument();
    expect(screen.getByLabelText("Salon timezone")).toHaveValue("Mars/Olympus");
  });

  it("disables localisation changes for a read-only salon", () => {
    auth.readOnly = true;
    renderSettings();
    expect(screen.getByLabelText("Salon timezone")).toBeDisabled();
    expect(screen.getByLabelText("Formatting locale")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save profile" })).not.toBeInTheDocument();
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
    renderSettings();
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
    renderSettings();
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
    renderSettings();
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
    renderSettings();
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
    expect(screen.getByLabelText("Salon timezone")).toBeDisabled();
    expect(screen.getByLabelText("Formatting locale")).toBeDisabled();
  });
});
