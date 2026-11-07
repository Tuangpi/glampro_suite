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
 * - **Editing is a page, not this drawer.** The row offers the verb and this screen
 *   hands over to `/staff/:id`, where the person's five separate save scopes live. What
 *   is left here is the list, its counts and the create form — `StaffProfile.test.tsx`
 *   covers the page.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { PASSWORD_MIN_LENGTH } from "@glampro_suite/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  useStaffList,
  useStaffCount,
  useDepartments,
  useCreateStaff,
  getErrorMessage,
  getValidationDetails,
} = vi.hoisted(() => ({
  useStaffList: vi.fn(),
  useStaffCount: vi.fn(),
  useDepartments: vi.fn(),
  useCreateStaff: vi.fn(),
  getErrorMessage: vi.fn<() => string>(() => "Something went wrong."),
  getValidationDetails: vi.fn<() => Record<string, string>>(() => ({})),
}));

vi.mock("@/lib/api", () => ({ getErrorMessage, getValidationDetails }));

vi.mock("@/hooks/useStaff", () => ({
  useStaffList,
  useStaffCount,
  useCreateStaff,
}));

vi.mock("@/hooks/useDepartments", () => ({ useDepartments }));
vi.mock("@/components/staff/StaffPayrollCreation", () => ({
  default: ({ onChange }: { onChange: (value: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onChange({
          planId: "plan",
          fromDate: "2026-10-27",
          expectedRevision: 3,
          reason: "Initial assignment",
        })
      }
    >
      Choose initial plan
    </button>
  ),
}));

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

/**
 * The signed-in member of the salon. The role and the suspension matter here: they
 * decide which write affordances the list offers.
 */
const auth = vi.hoisted(() => ({
  value: {
    user: { id: "signed-in-owner", globalRole: "SUPER_ADMIN" },
    isReadOnly: false,
  } as {
    user: { id?: string; globalRole: string } | null;
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
    refetch: vi.fn(),
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

/**
 * The list inside a router, with a probe beside it.
 *
 * The screen needs a router because the row action navigates to `/staff/:id` rather than
 * opening an editor, and the probe is how a test reads where it went: the element is
 * rendered directly rather than through `<Routes>`, so a navigation changes the location
 * without unmounting the list the test is still asserting against.
 */
function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function renderStaff() {
  return render(
    <MemoryRouter initialEntries={["/staff"]}>
      <Staff />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.value = {
    user: { id: "signed-in-owner", globalRole: "SUPER_ADMIN" },
    isReadOnly: false,
  };
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
  useDepartments.mockReturnValue({ data: [], isPending: false });
  getErrorMessage.mockReturnValue("Something went wrong.");
  getValidationDetails.mockReturnValue({});
  createMutate.mockReset().mockResolvedValue({});
});

describe("the table", () => {
  it("links the name in-app, so the list is not thrown away to show one record", async () => {
    const user = userEvent.setup();
    useStaffList.mockReturnValue(listOf([staffRow()]));
    renderStaff();

    // Still a real `<a href>`: the middle mouse button and "copy link address" work,
    // which is why a row action would not do.
    const link = screen.getByRole("link", { name: "Amara Okafor" });
    expect(link).toHaveAttribute("href", "/staff/u1");

    await user.click(link);

    // A bare `<a>` would have asked the browser for a whole new document and never
    // touched this probe — that reload was the flash between the list and the page.
    expect(screen.getByTestId("location")).toHaveTextContent("/staff/u1");
  });

  it("creates a reasoned commission classification and initial plan atomically", async () => {
    const user = userEvent.setup();
    renderStaff();
    await user.click(screen.getAllByRole("button", { name: "Add staff member" })[0]!);
    const dialog = within(await screen.findByRole("dialog"));
    expect(screen.getByLabelText("Start date")).toBeRequired();
    const endDate = screen.getByLabelText("Employment end date (optional)");
    expect(endDate).not.toBeRequired();
    expect(endDate).toHaveValue("");
    expect(endDate).toHaveAccessibleDescription(
      "Leave blank if the staff member is still employed. Enter their last employment day only when known; this is not the payroll period end date.",
    );
    await user.type(screen.getByLabelText("Name"), "Amy");
    await user.type(screen.getByLabelText("Email"), "amy@example.test");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.selectOptions(
      screen.getByLabelText("Initial commission classification"),
      "COMMISSION_EARNING",
    );
    expect(screen.getByLabelText("Assign payroll plan during creation")).toBeChecked();
    expect(screen.getByLabelText("Assign payroll plan during creation")).toBeDisabled();
    await user.type(screen.getByLabelText("Classification reason"), "Employment agreement");
    await user.type(screen.getByLabelText("Start date"), "2026-09-01");
    await user.click(dialog.getByRole("button", { name: "Add staff member" }));
    expect(createMutate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Choose initial plan" }));
    await user.click(dialog.getByRole("button", { name: "Add staff member" }));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate.mock.calls[0]?.[0]).toMatchObject({
      payrollClassification: {
        commissionRole: "COMMISSION_EARNING",
        reason: "Employment agreement",
      },
      payrollAssignment: { planId: "plan", expectedRevision: 3 },
      startDate: "2026-09-01",
    });
    expect(createMutate.mock.calls[0]?.[0].endDate).toBeUndefined();
  });
  it("creates identity and an initial plan in one request, requiring a join date", async () => {
    const user = userEvent.setup();
    renderStaff();
    await user.click(screen.getAllByRole("button", { name: "Add staff member" })[0]!);
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(screen.getByLabelText("Name"), "Amy");
    await user.type(screen.getByLabelText("Email"), "amy@example.test");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.click(screen.getByLabelText("Assign payroll plan during creation"));
    await user.click(screen.getByRole("button", { name: "Choose initial plan" }));
    await user.click(dialog.getByRole("button", { name: "Add staff member" }));
    expect(createMutate).not.toHaveBeenCalled();
    expect(screen.getByText("A join date is required with a payroll plan.")).toBeInTheDocument();
    await user.selectOptions(
      screen.getByLabelText("Initial commission classification"),
      "NON_COMMISSION",
    );
    await user.type(screen.getByLabelText("Classification reason"), "Employment agreement");
    await user.type(screen.getByLabelText("Start date"), "2026-09-01");
    await user.click(dialog.getByRole("button", { name: "Add staff member" }));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate.mock.calls[0]?.[0]).toMatchObject({
      startDate: "2026-09-01",
      payrollAssignment: { planId: "plan", expectedRevision: 3 },
    });
  });
  it("creates once, then hands the payroll continuation to the new person's page", async () => {
    const user = userEvent.setup();
    createMutate.mockResolvedValue(staffRow());
    renderStaff();
    await user.click(screen.getAllByRole("button", { name: "Add staff member" })[0]!);
    const submit = within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Add staff member",
    });
    await user.type(screen.getByLabelText("Name"), "Amara Okafor");
    await user.type(screen.getByLabelText("Email"), "amara@salon.test");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.click(screen.getByLabelText("Configure payroll after creation"));
    await completePayrollSetup(user);
    await user.click(submit);

    // The identity is created exactly once and the rest of payroll is not squeezed into
    // the drawer: "continue" is a URL on the person's own page.
    expect(createMutate).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/staff/u1?section=payroll"),
    );
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

    renderStaff();

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

    renderStaff();

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

    renderStaff();

    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete|remove|archive/i }),
    ).not.toBeInTheDocument();
  });
});

describe("the loading state", () => {
  it("draws the table's own columns rather than a stack of loose bars", () => {
    useStaffList.mockReturnValue(queryResult({ isPending: true, data: undefined }));
    renderStaff();

    // The header the rows will land under is already there, so the table does not grow
    // a header when the answer arrives. The body is placeholders, hidden from a reader.
    expect(screen.getByRole("table", { name: "Staff in this salon" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Staff" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Last login" })).toBeInTheDocument();
    expect(screen.getByText("Loading staff…")).toBeInTheDocument();
  });

  it("reserves each tile's number instead of claiming zero", () => {
    useStaffList.mockReturnValue(queryResult({ isPending: true, data: undefined }));
    useStaffCount.mockReturnValue(queryResult({ isPending: true, data: undefined }));
    renderStaff();

    // A tile that has not answered shows "—" for a missing count, which is exactly what
    // a salon with none of something shows. `loading` is what keeps the two apart.
    const overview = screen.getByRole("group", { name: "Team overview" });
    expect(within(overview).queryByText("—")).not.toBeInTheDocument();
    for (const tile of Array.from(overview.children)) {
      expect(tile).toHaveAttribute("aria-busy", "true");
    }
  });
});

describe("the tiles", () => {
  it("counts the whole team, one question per state", () => {
    useStaffList.mockReturnValue(listOf([staffRow()]));

    renderStaff();

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
    renderStaff();

    expect(screen.getByRole("button", { name: "All staff" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Active only" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disabled" })).toBeInTheDocument();
  });

  it("hands the chosen state to the server rather than filtering rows here", async () => {
    const user = userEvent.setup();
    renderStaff();

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
    renderStaff();

    await user.type(screen.getByLabelText("Search staff"), "amara");

    await waitFor(() => {
      expect(useStaffList).toHaveBeenLastCalledWith(expect.objectContaining({ search: "amara" }));
    });
  });
});

describe("who may write", () => {
  it("allows managers to edit but reserves creation for owner-audited setup", () => {
    auth.value = { user: { globalRole: "MANAGER" }, isReadOnly: false };
    useStaffList.mockReturnValue(listOf([staffRow()]));
    renderStaff();
    expect(screen.queryByRole("button", { name: "Add staff member" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });
  it("offers a stylist no write action at all, because the API would refuse it", () => {
    auth.value = { user: { globalRole: "STAFF" }, isReadOnly: false };
    useStaffList.mockReturnValue(listOf([staffRow()]));

    renderStaff();

    expect(screen.queryByRole("button", { name: "Add staff member" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    // Reading the team is not privileged: the rail entry is open to everyone.
    expect(screen.getByText("Amara Okafor")).toBeInTheDocument();
  });

  it("keeps the button but not the ability for a suspended salon", () => {
    auth.value = { user: { globalRole: "SUPER_ADMIN" }, isReadOnly: true };
    useStaffList.mockReturnValue(listOf([staffRow()]));

    renderStaff();

    expect(screen.getByRole("button", { name: "Add staff member" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});

async function completePayrollSetup(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(
    screen.getByLabelText("Initial commission classification"),
    "NON_COMMISSION",
  );
  await user.type(screen.getByLabelText("Classification reason"), "Employment agreement");
  await user.type(screen.getByLabelText("Start date"), "2026-09-01");
}

describe("the add-staff form", () => {
  it("does not submit an identity without explicit payroll classification", async () => {
    const user = userEvent.setup();
    renderStaff();
    await user.click(screen.getAllByRole("button", { name: "Add staff member" })[0]!);
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(screen.getByLabelText("Name"), "Amy");
    await user.type(screen.getByLabelText("Email"), "amy@example.test");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.type(screen.getByLabelText("Start date"), "2026-09-01");
    await user.click(dialog.getByRole("button", { name: "Add staff member" }));
    expect(createMutate).not.toHaveBeenCalled();
    expect(
      screen.getAllByText(
        "An explicit reasoned payroll classification is required for staff creation.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText("Name")).toHaveValue("Amy");
  });
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
    await completePayrollSetup(user);
    return within(dialog).getByRole("button", { name: "Add staff member" });
  }

  it("sends the name, email and password a login needs, and defaults to the least privileged role", async () => {
    const user = userEvent.setup();
    useStaffList.mockReturnValue(listOf([staffRow()]));
    renderStaff();

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

  it("creates a colleague with a login and an optional till PIN, sending their commission rate", async () => {
    const user = userEvent.setup();
    useStaffList.mockReturnValue(listOf([staffRow()]));
    renderStaff();
    const submit = await openCreateForm(user);
    await user.type(screen.getByLabelText("Name"), "Till colleague");
    await user.type(screen.getByLabelText("Email"), "till@salon.test");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.type(screen.getByLabelText("POS PIN"), "123456");
    await user.clear(screen.getByLabelText("Service commission (%)"));
    await user.type(screen.getByLabelText("Service commission (%)"), "12.5");
    await user.click(submit);
    await waitFor(() =>
      expect(createMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Till colleague",
          email: "till@salon.test",
          posPin: "123456",
          commissionRate: 12.5,
        }),
      ),
    );
  });

  it("refuses to submit without a name, an email and a long-enough password", async () => {
    const user = userEvent.setup();
    useStaffList.mockReturnValue(listOf([staffRow()]));
    renderStaff();

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
    renderStaff();

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
    renderStaff();

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
