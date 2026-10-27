/**
 * The staff screen — handoff screen 09.
 *
 * What is worth asserting here is the behaviour the API contract made necessary:
 *
 * - The Shifts and Rating columns the handoff draws are absent, because there is no
 *   rota and no reviews table to fill them from, and nothing on the screen reads as
 *   "nobody is rostered" or "unrated".
 * - There is **no delete** on the screen at all: `disabled` is the archive (Q28), so
 *   the removal verb is the drawer's checkbox rather than a row action.
 * - Every tile number is a **server-side count**, one question per state (ADR 0010).
 * - A stylist is offered no write affordance, because `requireRole` would refuse it.
 * - A 422 **or a 409** from the server puts its message on the control that caused it.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PASSWORD_MIN_LENGTH } from "@glampro_suite/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  useStaffList,
  useStaffCount,
  useDepartments,
  useCreateStaff,
  useUpdateStaff,
  get,
  getErrorMessage,
  getValidationDetails,
} = vi.hoisted(() => ({
  useStaffList: vi.fn(),
  useStaffCount: vi.fn(),
  useDepartments: vi.fn(),
  useCreateStaff: vi.fn(),
  useUpdateStaff: vi.fn(),
  get: vi.fn(),
  getErrorMessage: vi.fn<() => string>(() => "Something went wrong."),
  getValidationDetails: vi.fn<() => Record<string, string>>(() => ({})),
}));

vi.mock("@/lib/api", () => ({ get, getErrorMessage, getValidationDetails }));

vi.mock("@/hooks/useStaff", () => ({
  useStaffList,
  useStaffCount,
  useCreateStaff,
  useUpdateStaff,
}));

vi.mock("@/hooks/useDepartments", () => ({ useDepartments }));
vi.mock("@/components/staff/StaffRoster", () => ({
  default: () => <section aria-label="Working hours" />,
}));
vi.mock("@/components/settings/CommissionRules", () => ({
  default: () => <section aria-label="Advanced commissions" />,
}));
vi.mock("@/components/settings/PayrollPlans", () => ({
  default: ({ staffId, canEdit }: { staffId: string; canEdit: boolean }) => (
    <section aria-label="Staff payroll" data-staff-id={staffId} data-can-edit={String(canEdit)} />
  ),
}));

/** The signed-in member of the salon. Only the role and the suspension matter here. */
const auth = vi.hoisted(() => ({
  value: { user: { globalRole: "SUPER_ADMIN" }, isReadOnly: false } as {
    user: { globalRole: string } | null;
    isReadOnly: boolean;
  },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.value }));

const { default: Staff } = await import("@/pages/Staff");

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

/** A row that satisfies `StaffSummary`, optional fields left null. */
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

const createMutate = vi.fn();
const updateMutate = vi.fn();

beforeEach(() => {
  auth.value = { user: { globalRole: "SUPER_ADMIN" }, isReadOnly: false };
  useStaffList.mockReturnValue(queryResult());
  // The tiles ask three different questions of the same endpoint, so the mock answers
  // by argument rather than by call order — which also proves the filters are the ones
  // the screen means to send.
  useStaffCount.mockImplementation((filters: { status?: string } = {}) => {
    if (filters.status === "active") return countOf(9);
    if (filters.status === "disabled") return countOf(2);
    return countOf(11);
  });
  useCreateStaff.mockReturnValue({ mutateAsync: createMutate, isPending: false });
  useUpdateStaff.mockReturnValue({ mutateAsync: updateMutate, isPending: false });
  useDepartments.mockReturnValue({ data: [], isPending: false });
  get.mockReset().mockResolvedValue(staffRow());
  getErrorMessage.mockReturnValue("Something went wrong.");
  getValidationDetails.mockReturnValue({});
  createMutate.mockReset().mockResolvedValue({});
  updateMutate.mockReset().mockResolvedValue({});
});

describe("the table", () => {
  it("creates once then continues payroll setup on the persisted identity", async () => {
    const user = userEvent.setup();
    createMutate.mockResolvedValue(staffRow());
    render(<Staff />);
    await user.click(screen.getAllByRole("button", { name: "Add staff member" })[0]!);
    const submit = within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Add staff member",
    });
    await user.type(screen.getByLabelText("Name"), "Amara Okafor");
    await user.type(screen.getByLabelText("Email"), "amara@salon.test");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.click(screen.getByLabelText("Configure payroll after creation"));
    await user.click(submit);
    const payroll = await screen.findByRole("region", { name: "Staff payroll" });
    expect(payroll).toHaveAttribute("data-staff-id", "u1");
    expect(payroll).toHaveAttribute("data-can-edit", "true");
    expect(createMutate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateMutate).toHaveBeenCalled());
    expect(updateMutate.mock.calls[0]?.[0].input).not.toHaveProperty("startDate");
    expect(createMutate).toHaveBeenCalledTimes(1);
  });
  it("renders a row per person, with their role, their branches and their state", () => {
    useStaffList.mockReturnValue(
      listOf([
        staffRow({
          id: "u2",
          name: "Ben Ito",
          email: "ben@salon.test",
          globalRole: "MANAGER",
          departments: [],
        }),
        staffRow({ id: "u3", name: "Cleo Marsh", disabled: true }),
      ]),
    );

    render(<Staff />);

    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(rows).toHaveLength(2);

    expect(within(rows[0]!).getByText("Ben Ito")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("ben@salon.test")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Manager")).toBeInTheDocument();
    // Nobody assigned to a branch says so rather than leaving the cell blank.
    expect(within(rows[0]!).getByText("Unassigned")).toBeInTheDocument();

    expect(within(rows[1]!).getByText("Cleo Marsh")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Hair")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Disabled")).toBeInTheDocument();
  });

  it("shows the columns the model can fill, and no Shifts or Rating column", () => {
    useStaffList.mockReturnValue(listOf([staffRow()]));

    render(<Staff />);

    expect(screen.getByRole("columnheader", { name: "Role" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Position" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Departments" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Last login" })).toBeInTheDocument();

    // The handoff draws both. There is no rota table and no reviews table, so a column
    // here would be a fabricated number rather than a missing one.
    expect(screen.queryByRole("columnheader", { name: /shifts/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /rating/i })).not.toBeInTheDocument();
  });

  it("offers no delete or archive action, because disabling is the archive", () => {
    useStaffList.mockReturnValue(listOf([staffRow()]));

    render(<Staff />);

    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete|remove|archive/i }),
    ).not.toBeInTheDocument();
  });
});

describe("the tiles", () => {
  it("counts the whole team, one question per state", () => {
    useStaffList.mockReturnValue(listOf([staffRow()]));

    render(<Staff />);

    /** The tile's own box: the label's parent also holds the number. */
    const tiles = within(screen.getByRole("group", { name: "Team overview" }));
    const valueFor = (label: string) => {
      const box = tiles.getByText(label).parentElement;
      if (!box) throw new Error(`The "${label}" tile has no value box.`);
      return within(box);
    };

    expect(valueFor("Team members").getByText("11")).toBeInTheDocument();
    expect(valueFor("Active").getByText("9")).toBeInTheDocument();
    expect(valueFor("Disabled").getByText("2")).toBeInTheDocument();

    // Each tile is the server's own count with the filter it means, not a count over
    // the one page of rows the browser happens to hold (ADR 0010).
    expect(useStaffCount).toHaveBeenCalledWith();
    expect(useStaffCount).toHaveBeenCalledWith({ status: "active" });
    expect(useStaffCount).toHaveBeenCalledWith({ status: "disabled" });
  });
});

describe("the status filter", () => {
  it("offers the three states the API's `status` accepts", () => {
    render(<Staff />);

    expect(screen.getByRole("button", { name: "All staff" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Active only" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disabled" })).toBeInTheDocument();
  });

  it("hands the chosen state to the server rather than filtering rows here", async () => {
    const user = userEvent.setup();
    render(<Staff />);

    await user.click(screen.getByRole("button", { name: "Disabled" }));

    await waitFor(() => {
      expect(useStaffList).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "disabled" }),
      );
    });

    await user.click(screen.getByRole("button", { name: "All staff" }));

    // The screen says "all" and the hook is what leaves it off the query string, so
    // that `?status=` has one spelling per meaning (`staffListQuerySchema` defaults it).
    await waitFor(() => {
      expect(useStaffList).toHaveBeenLastCalledWith(expect.objectContaining({ status: "all" }));
    });
  });
});

describe("search", () => {
  it("hands the debounced term to the server rather than filtering rows here", async () => {
    const user = userEvent.setup();
    render(<Staff />);

    await user.type(screen.getByLabelText("Search staff"), "amara");

    await waitFor(() => {
      expect(useStaffList).toHaveBeenLastCalledWith(expect.objectContaining({ search: "amara" }));
    });
  });
});

describe("who may write", () => {
  it("offers a stylist no write action at all, because the API would refuse it", () => {
    auth.value = { user: { globalRole: "STAFF" }, isReadOnly: false };
    useStaffList.mockReturnValue(listOf([staffRow()]));

    render(<Staff />);

    expect(screen.queryByRole("button", { name: "Add staff member" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    // Reading the team is not privileged: the rail entry is open to everyone.
    expect(screen.getByText("Amara Okafor")).toBeInTheDocument();
  });

  it("keeps the button but not the ability for a suspended salon", () => {
    auth.value = { user: { globalRole: "SUPER_ADMIN" }, isReadOnly: true };
    useStaffList.mockReturnValue(listOf([staffRow()]));

    render(<Staff />);

    expect(screen.getByRole("button", { name: "Add staff member" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});

describe("the add-staff form", () => {
  /**
   * Opens the drawer and returns its own submit button, ready to fill in.
   *
   * The page keeps its own "Add staff member" button behind the open drawer (and the
   * empty state draws another), so the submit is found inside the dialog rather than
   * by position on the page.
   */
  async function openCreateForm(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getAllByRole("button", { name: "Add staff member" })[0]!);
    const dialog = await screen.findByRole("dialog");
    return within(dialog).getByRole("button", { name: "Add staff member" });
  }

  it("sends the name, email and password a login needs, and defaults to the least privileged role", async () => {
    const user = userEvent.setup();
    useStaffList.mockReturnValue(listOf([staffRow()]));
    render(<Staff />);

    const submit = await openCreateForm(user);
    await user.type(screen.getByLabelText("Name"), "Amara Okafor");
    await user.type(screen.getByLabelText("Email"), "amara@salon.test");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.click(submit);

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Amara Okafor",
          email: "amara@salon.test",
          password: "correct-horse",
          globalRole: "STAFF",
        }),
      );
    });
  });

  it("creates a PIN-only colleague without email or password and sends their commission rate", async () => {
    const user = userEvent.setup();
    useStaffList.mockReturnValue(listOf([staffRow()]));
    render(<Staff />);
    const submit = await openCreateForm(user);
    await user.type(screen.getByLabelText("Name"), "PIN colleague");
    await user.click(screen.getByLabelText("POS PIN only (no email login)"));
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("POS PIN"), "123456");
    await user.clear(screen.getByLabelText("Service commission (%)"));
    await user.type(screen.getByLabelText("Service commission (%)"), "12.5");
    await user.click(submit);
    await waitFor(() =>
      expect(createMutate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "PIN colleague", posPin: "123456", commissionRate: 12.5 }),
      ),
    );
    expect(createMutate.mock.calls[0]?.[0]).not.toHaveProperty("email");
    expect(createMutate.mock.calls[0]?.[0]).not.toHaveProperty("password");
  });

  it("refuses to submit without a name, an email and a long-enough password", async () => {
    const user = userEvent.setup();
    useStaffList.mockReturnValue(listOf([staffRow()]));
    render(<Staff />);

    const submit = await openCreateForm(user);
    await user.click(submit);

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(screen.getByText("Email is required")).toBeInTheDocument();
    expect(
      screen.getByText(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`),
    ).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("offers the salon's departments and sends the ones ticked", async () => {
    const user = userEvent.setup();
    useStaffList.mockReturnValue(listOf([staffRow()]));
    useDepartments.mockReturnValue({
      data: [
        { id: "d1", name: "Hair" },
        { id: "d2", name: "Nails" },
      ],
      isPending: false,
    });
    render(<Staff />);

    const submit = await openCreateForm(user);
    await user.type(screen.getByLabelText("Name"), "Amara Okafor");
    await user.type(screen.getByLabelText("Email"), "amara@salon.test");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.click(screen.getByLabelText("Nails"));
    await user.click(submit);

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({ departmentIds: ["d2"] }));
    });
  });

  it("puts a duplicate address on the Email control, which is where the 409 points", async () => {
    const user = userEvent.setup();
    // A taken email — this salon's or another salon's, since `users.email` is globally
    // unique — comes back as a 409 whose `details` name `body.email`, so it lands on
    // the field exactly as a 422 does rather than as a banner.
    getValidationDetails.mockReturnValue({ "body.email": "That email address is already in use." });
    createMutate.mockRejectedValue(new Error("Conflict"));
    useStaffList.mockReturnValue(listOf([staffRow()]));
    render(<Staff />);

    const submit = await openCreateForm(user);
    await user.type(screen.getByLabelText("Name"), "Amara Okafor");
    await user.type(screen.getByLabelText("Email"), "amara@salon.test");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.click(submit);

    const email = await screen.findByLabelText("Email");
    await waitFor(() => {
      expect(email).toHaveAttribute("aria-invalid", "true");
    });
    expect(screen.getByText("That email address is already in use.")).toBeInTheDocument();
  });
});

describe("the edit form", () => {
  it("has no password box and no editable email, and disables the account instead of deleting it", async () => {
    const user = userEvent.setup();
    useStaffList.mockReturnValue(listOf([staffRow()]));
    render(<Staff />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    within(dialog).getByText("amara@salon.test"); // shown, so the login is still visible

    // Changing a password is POST /api/auth/change-password, which ends every session
    // (ADR 0007), and `updateStaffSchema` has no `email` field at all.
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Disabled"));
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateMutate).toHaveBeenCalledWith({
        id: "u1",
        input: expect.objectContaining({ disabled: true }),
      });
    });
  });
});
