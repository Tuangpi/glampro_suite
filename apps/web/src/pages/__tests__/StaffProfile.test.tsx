/**
 * One staff member's page — handoff screen 09's editor.
 *
 * What is worth asserting here is the separation the page exists for: a staff record
 * carries several independent writes, and each button saves only its own. A page that
 * let "Save changes" carry a payroll edit or a password would be the drawer again, with
 * more scrolling.
 *
 * The rest is the contract the drawer already had, moved rather than rewritten:
 * `updateStaffSchema` has no `email` and no `password`, so the profile form offers
 * neither and the reset posts to `POST /api/staff/:id/password` on its own — a manager
 * may recover a `STAFF`/`CASHIER` login and never a peer manager's or an owner's, and a
 * row written before the email rule has no password at all.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  useStaff,
  useUpdateStaff,
  useResetStaffPassword,
  useDepartments,
  updateMutate,
  resetMutate,
  getErrorMessage,
  getValidationDetails,
} = vi.hoisted(() => ({
  useStaff: vi.fn(),
  useUpdateStaff: vi.fn(),
  useResetStaffPassword: vi.fn(),
  useDepartments: vi.fn(),
  updateMutate: vi.fn(),
  resetMutate: vi.fn(),
  getErrorMessage: vi.fn<() => string>(() => "Something went wrong."),
  getValidationDetails: vi.fn<() => Record<string, string>>(() => ({})),
}));

vi.mock("@/lib/api", () => ({ getErrorMessage, getValidationDetails }));

vi.mock("@/hooks/useStaff", () => ({ useStaff, useUpdateStaff, useResetStaffPassword }));
vi.mock("@/hooks/useDepartments", () => ({ useDepartments }));

// The three heavy employment sections are other people's tests; what matters here is
// that the page mounts the right one for the right viewer.
// The three heavy employment sections are other people's tests; what matters here is
// that the page mounts the right one for the right viewer. The rota's name is not
// "Working hours" here because the page's own section already carries that label.
vi.mock("@/components/staff/StaffRoster", () => ({
  default: ({ staffId, canEdit }: { staffId: string; canEdit: boolean }) => (
    <section aria-label="Roster editor" data-staff-id={staffId} data-can-edit={String(canEdit)} />
  ),
}));
vi.mock("@/components/settings/PayrollPlans", () => ({
  default: ({ staffId, canEdit }: { staffId: string; canEdit: boolean }) => (
    <section aria-label="Staff payroll" data-staff-id={staffId} data-can-edit={String(canEdit)} />
  ),
}));
vi.mock("@/components/staff/StaffCommissionRates", () => ({
  default: ({ staffId, canEdit }: { staffId: string; canEdit: boolean }) => (
    <section aria-label="Default rates" data-staff-id={staffId} data-can-edit={String(canEdit)} />
  ),
}));
vi.mock("@/components/settings/CommissionRules", () => ({
  default: () => <section aria-label="Advanced commissions" />,
}));

/** The signed-in member of the salon: the role decides the rail, the id decides "self". */
const auth = vi.hoisted(() => ({
  value: {
    user: { id: "signed-in-owner", globalRole: "SUPER_ADMIN" },
    isReadOnly: false,
    signOut: vi.fn<() => Promise<void>>(async () => {}),
  } as {
    user: { id?: string; globalRole: string } | null;
    isReadOnly: boolean;
    signOut?: () => Promise<void>;
  },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.value }));

const { default: StaffProfile } = await import("@/pages/StaffProfile");

/** A row that satisfies `StaffDetail`, optional fields left null. */
function staffRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    name: "Amara Okafor",
    email: "amara@salon.test",
    globalRole: "STAFF",
    phone: "555-0100",
    position: "Senior stylist",
    color: "#8B5CF6",
    avatar: null,
    commissionRate: "10.00",
    startDate: "2021-03-04",
    endDate: null,
    disabled: false,
    lastLoginAt: "2026-04-02T09:15:00.000Z",
    departments: [{ id: "d1", name: "Hair" }],
    createdAt: "2021-03-04T00:00:00.000Z",
    updatedAt: "2021-03-04T00:00:00.000Z",
    ...overrides,
  };
}

/** `?section=` is how the rail and the post-create continuation address a section. */
function renderProfile(section?: string) {
  return render(
    <MemoryRouter initialEntries={[section ? `/staff/u1?section=${section}` : "/staff/u1"]}>
      <Routes>
        <Route path="/staff/:id" element={<StaffProfile />} />
        <Route path="/staff" element={<p>Staff list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.value = {
    user: { id: "signed-in-owner", globalRole: "SUPER_ADMIN" },
    isReadOnly: false,
    signOut: vi.fn<() => Promise<void>>(async () => {}),
  };
  useStaff.mockReturnValue({
    data: staffRow(),
    isPending: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  });
  useUpdateStaff.mockReturnValue({ mutateAsync: updateMutate, isPending: false });
  useResetStaffPassword.mockReturnValue({ mutateAsync: resetMutate, isPending: false });
  useDepartments.mockReturnValue({ data: [], isPending: false });
  getErrorMessage.mockReturnValue("Something went wrong.");
  getValidationDetails.mockReturnValue({});
  updateMutate.mockReset().mockResolvedValue({});
  resetMutate.mockReset().mockResolvedValue({ success: true });
});

describe("the loading state", () => {
  it("draws the page's own shape rather than a sentence about the page", () => {
    useStaff.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      error: null,
      isFetching: true,
      refetch: vi.fn(),
    });

    const { container } = renderProfile();

    // The rail, the avatar disc and the section card are all reserved, so the layout is
    // not built from nothing the moment the record lands.
    expect(screen.getByRole("status")).toHaveTextContent("Loading staff member…");
    expect(container.querySelectorAll("[aria-hidden='true']").length).toBeGreaterThan(5);
    // Nothing about the record is invented while it is missing.
    expect(screen.queryByText("Amara Okafor")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Identity" })).not.toBeInTheDocument();
  });
});

describe("the identity section", () => {
  it("allows clearing a known employment end date without changing the start date", async () => {
    const user = userEvent.setup();
    useStaff.mockReturnValue({ data: staffRow({ endDate: "2027-02-15" }), isPending: false });
    renderProfile();

    const endDate = screen.getByLabelText("Employment end date (optional)");
    expect(endDate).not.toBeRequired();
    expect(endDate).toHaveValue("2027-02-15");
    await user.clear(endDate);
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate.mock.calls[0]?.[0].input.endDate).toBeNull();
    expect(updateMutate.mock.calls[0]?.[0].input).not.toHaveProperty("startDate");
  });

  it("compares an edited start date against the date originally loaded", async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.clear(screen.getByLabelText("Start date"));
    await user.type(screen.getByLabelText("Start date"), "2026-09-01");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateMutate).toHaveBeenCalledWith({
        id: "u1",
        input: expect.objectContaining({
          startDate: "2026-09-01",
          expectedStartDate: "2021-03-04",
        }),
      }),
    );
  });

  it("moves the compared baseline forward after a save, so the next one is not a conflict", async () => {
    const user = userEvent.setup();
    renderProfile();

    // The form stays open on a page (the drawer used to close), so the second change has
    // to be measured against what the server now holds rather than what this form first
    // read — otherwise it would carry a stale `expectedStartDate` and refuse itself.
    await user.clear(screen.getByLabelText("Start date"));
    await user.type(screen.getByLabelText("Start date"), "2026-09-01");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));

    await user.clear(screen.getByLabelText("Start date"));
    await user.type(screen.getByLabelText("Start date"), "2026-10-01");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateMutate).toHaveBeenLastCalledWith({
        id: "u1",
        input: expect.objectContaining({
          startDate: "2026-10-01",
          expectedStartDate: "2026-09-01",
        }),
      }),
    );
  });

  it("carries no password and no email, because the contract has neither", () => {
    renderProfile();

    // The email is a login fact: it is shown on the login section as text, never as a box
    // a PATCH would silently drop (ADR 0007).
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });
});

describe("the login and security section", () => {
  it("shows the login address and the reset beside it, in their own save scope", async () => {
    const user = userEvent.setup();
    renderProfile();

    // Reachable from the rail, which is what makes the section a destination rather than
    // a fold: the profile form stays mounted, so switching is not a page load.
    await user.click(screen.getByRole("button", { name: "Login & security" }));

    expect(await screen.findByText("amara@salon.test")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    // The address is text, not a field (there is no `email` on `updateStaffSchema`).
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("posts a reset to its own endpoint, never with the profile save", async () => {
    const user = userEvent.setup();
    renderProfile("access");

    await user.type(screen.getByLabelText("New password"), "brand-new-secret");
    await user.type(screen.getByLabelText("Confirm new password"), "brand-new-secret");
    await user.click(screen.getByRole("button", { name: "Set password" }));

    await waitFor(() =>
      expect(resetMutate).toHaveBeenCalledWith({ id: "u1", password: "brand-new-secret" }),
    );
    expect(updateMutate).not.toHaveBeenCalled();
    // The fields clear, because the password is no longer this page's to hold.
    await waitFor(() => expect(screen.getByLabelText("New password")).toHaveValue(""));
  });

  it("refuses a mistyped confirmation without calling the API", async () => {
    const user = userEvent.setup();
    renderProfile("access");

    await user.type(screen.getByLabelText("New password"), "brand-new-secret");
    await user.type(screen.getByLabelText("Confirm new password"), "brand-new-secrets");
    await user.click(screen.getByRole("button", { name: "Set password" }));

    expect(await screen.findByText("The two passwords do not match.")).toBeInTheDocument();
    expect(resetMutate).not.toHaveBeenCalled();
  });
});

describe("the login block's role rule", () => {
  it("offers nothing to reset for a row written without an email login", () => {
    useStaff.mockReturnValue({
      data: staffRow({ email: null, globalRole: "STAFF" }),
      isPending: false,
      isError: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderProfile("access");

    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(
      screen.getByText("This account has no email login, so there is no password to reset."),
    ).toBeInTheDocument();
  });

  it("hides the block from a manager whose target is another manager", () => {
    auth.value = {
      user: { id: "signed-in-manager", globalRole: "MANAGER" },
      isReadOnly: false,
      signOut: vi.fn<() => Promise<void>>(async () => {}),
    };
    useStaff.mockReturnValue({
      data: staffRow({ id: "u2", name: "Mia Manager", globalRole: "MANAGER" }),
      isPending: false,
      isError: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderProfile("access");

    // The API answers 403 here, so the page does not offer the button at all (a
    // credential write is a takeover primitive, not an edit).
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(
      screen.getByText("Only an owner can reset a manager's or an owner's password."),
    ).toBeInTheDocument();
  });
});

describe("the account status card", () => {
  it("saves the archive flag on its own, without the profile form", async () => {
    const user = userEvent.setup();
    // Only the login section is mounted at this URL, which is the point: `disabled` is a
    // write with its own consequence, and its button must not be the profile's button.
    renderProfile("access");
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Disabled"));
    await user.click(screen.getByRole("button", { name: "Save account status" }));

    await waitFor(() =>
      expect(updateMutate).toHaveBeenCalledWith({ id: "u1", input: { disabled: true } }),
    );
    expect(resetMutate).not.toHaveBeenCalled();
  });

  it("revokes the POS PIN as an explicit null, through the same split PATCH", async () => {
    const user = userEvent.setup();
    renderProfile("access");

    await user.click(screen.getByLabelText("Revoke POS PIN"));
    await user.click(screen.getByRole("button", { name: "Update POS PIN" }));

    await waitFor(() =>
      expect(updateMutate).toHaveBeenCalledWith({ id: "u1", input: { posPin: null } }),
    );
  });

  it("refuses a PIN that is not six digits without calling the API", async () => {
    const user = userEvent.setup();
    renderProfile("access");

    await user.type(screen.getByLabelText("New POS PIN"), "123");
    await user.click(screen.getByRole("button", { name: "Update POS PIN" }));

    expect(
      await screen.findByText("Use a six-digit PIN, or tick revoke to remove it."),
    ).toBeInTheDocument();
    expect(updateMutate).not.toHaveBeenCalled();
  });
});

describe("who may write", () => {
  it.each(["SUPER_ADMIN", "MANAGER"])("opens individual commissions for %s", (role) => {
    auth.value = { user: { id: "manager", globalRole: role }, isReadOnly: false };
    renderProfile("commission");
    expect(screen.getByRole("heading", { name: "Commissions" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Default rates" })).toHaveAttribute(
      "data-staff-id",
      "u1",
    );
    expect(screen.getByRole("region", { name: "Default rates" })).toHaveAttribute(
      "data-can-edit",
      "true",
    );
    expect(screen.getByText("Exceptions & history")).toBeVisible();
  });

  it("keeps individual commission defaults read-only for a suspended salon", () => {
    auth.value = { user: { id: "owner", globalRole: "SUPER_ADMIN" }, isReadOnly: true };
    renderProfile("commission");
    expect(screen.getByRole("region", { name: "Default rates" })).toHaveAttribute(
      "data-can-edit",
      "false",
    );
  });

  it("offers a stylist a reading page, because the API would refuse the rest", () => {
    auth.value = { user: { id: "u9", globalRole: "STAFF" }, isReadOnly: false };
    renderProfile();

    // Employment sections are not even in the rail for someone who may not configure them.
    expect(screen.queryByRole("button", { name: "Payroll" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Identity & profile" })).toBeInTheDocument();
    // …and the profile is shown without a save to press.
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeDisabled();
  });

  it("keeps payroll readable for a manager but not writable", async () => {
    auth.value = { user: { id: "m1", globalRole: "MANAGER" }, isReadOnly: false };
    const user = userEvent.setup();
    renderProfile();

    await user.click(screen.getByRole("button", { name: "Payroll" }));

    // Minting a plan is an owner's work; reading one is not.
    expect(screen.getByRole("region", { name: "Staff payroll" })).toHaveAttribute(
      "data-can-edit",
      "false",
    );
  });

  it("keeps the rota readable for a stylist but not writable", async () => {
    auth.value = { user: { id: "u9", globalRole: "STAFF" }, isReadOnly: false };
    const user = userEvent.setup();
    renderProfile();

    await user.click(screen.getByRole("button", { name: "Working hours" }));

    // A stylist may read their own week; adding an interval is the manager's, and the
    // API's `requireRole` is what actually enforces it.
    expect(screen.getByRole("region", { name: "Roster editor" })).toHaveAttribute(
      "data-can-edit",
      "false",
    );
  });

  it("stops a suspended salon from writing while still showing the record", () => {
    auth.value = { user: { id: "signed-in-owner", globalRole: "SUPER_ADMIN" }, isReadOnly: true };
    renderProfile();

    expect(screen.getByText("Amara Okafor")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeDisabled();
  });
});
