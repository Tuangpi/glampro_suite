import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { hairPayrollExample, PAYROLL_DEFAULT_SETTINGS } from "@glampro_suite/shared";
vi.mock("./PayrollActivationStatus", () => ({
  default: () => (
    <section aria-label="Payroll activation status">Activation checked separately</section>
  ),
}));
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), twoFactorEnabled: false }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { globalRole: "SUPER_ADMIN", twoFactorEnabled: mocks.twoFactorEnabled },
  }),
}));
vi.mock("@/lib/api", () => ({
  get: mocks.get,
  post: mocks.post,
  getErrorMessage: (e: Error) => e.message,
  getErrorCode: (e: { code?: string }) => e?.code,
}));
import PayrollPlans, { type PayrollConfiguration } from "./PayrollPlans";

function configuration(): PayrollConfiguration {
  return {
    today: "2026-10-27",
    outletId: null,
    earningsActive: false,
    plans: [
      {
        id: "hair",
        name: "Hair",
        description: "Sample",
        positions: [],
        outletIds: [],
        archived: false,
        revision: 1,
        staffCount: 0,
        versions: [
          {
            id: "v1",
            versionNo: 1,
            effectiveFrom: "2026-10-27",
            status: "DRAFT",
            definition: hairPayrollExample(),
            actorId: "owner",
            reason: "Initial sample",
            publishedAt: null,
          },
        ],
      },
    ],
    settings: { revision: 0, ...PAYROLL_DEFAULT_SETTINGS },
    assignments: { revision: 0, rows: [] },
    staff: [
      {
        id: "amy",
        name: "Amy",
        disabled: false,
        settings: { revision: 0, joinDate: "2026-09-01", stageEndOverride: null },
        profile: {
          revision: 0,
          basicSalary: "1000",
          fixedOvertime: "0",
          levy: "0",
          salesAlertPct: "40",
        },
      },
    ],
    history: [],
    historyLimit: 100,
    historyPage: 1,
    historyTotal: 0,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(configuration());
  mocks.post.mockResolvedValue({});
  mocks.twoFactorEnabled = false;
});
function mount(canEdit = true, staffId?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PayrollPlans canEdit={canEdit} staffId={staffId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
/** These integration tests assert submitted values, not per-keystroke behaviour.
 * One change avoids recalculating the exact curve for every character under load. */
function enter(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function openEditor(step = "rules", editable = true) {
  await userEvent.click(
    await screen.findByRole("button", { name: editable ? "Edit Hair" : "View Hair" }),
  );
  await userEvent.click(
    screen.getByRole("tab", {
      name:
        step === "details" ? "1. Details" : step === "review" ? "3. Review" : "2. Earning rules",
    }),
  );
}
async function confirm(reason = "Annual review") {
  const dialog = await screen.findByRole("dialog", {
    name: "Confirm payroll configuration change",
  });
  fireEvent.change(within(dialog).getByLabelText("Change reason"), { target: { value: reason } });
  await userEvent.click(within(dialog).getByRole("button", { name: "Confirm change" }));
}
async function review() {
  await userEvent.click(screen.getByRole("tab", { name: "3. Review" }));
}

it("opens a compact plan list without duplicate payroll forms or disconnected fields", async () => {
  mount();
  expect(await screen.findByRole("region", { name: "Pay-plan list" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Edit Hair" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Staff payroll profiles" })).toHaveAttribute(
    "href",
    "/staff",
  );
  expect(screen.getByLabelText("Component name")).not.toBeVisible();
  for (const label of [
    "Basic monthly salary",
    "Staff join date",
    "Minimum package deposit percentage",
    "Refund administration fee",
    "Plan positions (comma-separated, blank = all)",
    "Plan outlet IDs (comma-separated, blank = company-wide)",
  ])
    expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
  expect(mocks.post).not.toHaveBeenCalled();
});

it("keeps rule drafts while moving between steps and the list", async () => {
  mount();
  await openEditor();
  enter("Component name", "New service rules");
  await review();
  expect(screen.getAllByText("New service rules").some((node) => node.tagName === "STRONG")).toBe(
    true,
  );
  await userEvent.click(screen.getByRole("button", { name: "All plans" }));
  await openEditor();
  expect(screen.getByLabelText("Component name")).toHaveValue("New service rules");
});

it("requires an action-local reason and publishes only the saved revision", async () => {
  mount();
  await openEditor("review");
  await userEvent.click(screen.getByRole("button", { name: "Publish saved version" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("button", { name: "Confirm change" })).toBeDisabled();
  expect(mocks.post).not.toHaveBeenCalled();
  await confirm("Approved sample");
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/payroll-configuration/plans/hair/publish", {
      expectedRevision: 1,
      reason: "Approved sample",
    }),
  );
});

it("cancels a publication without sending a request", async () => {
  mount();
  await openEditor("review");
  await userEvent.click(screen.getByRole("button", { name: "Publish saved version" }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
  expect(mocks.post).not.toHaveBeenCalled();
});

it("saves edited rules with their original revision and blocks publishing unsaved work", async () => {
  mount();
  await openEditor();
  enter("Component name", "New cash name");
  await review();
  expect(screen.getByRole("button", { name: "Publish saved version" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Save plan draft" }));
  await confirm();
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith(
      "/payroll-configuration/plans/hair/draft",
      expect.objectContaining({
        expectedRevision: 1,
        definition: expect.objectContaining({
          components: expect.arrayContaining([expect.objectContaining({ name: "New cash name" })]),
        }),
      }),
    ),
  );
});

it("retains a failed save and its reason for retry", async () => {
  mocks.post.mockRejectedValueOnce(new Error("Revision conflict"));
  mount();
  await openEditor();
  enter("Component name", "Retained draft");
  await review();
  await userEvent.click(screen.getByRole("button", { name: "Save plan draft" }));
  await confirm("Keep this reason");
  expect(await screen.findByRole("alert")).toHaveTextContent("Revision conflict");
  expect(screen.getByLabelText("Change reason")).toHaveValue("Keep this reason");
  expect(screen.getByLabelText("Component name")).toHaveValue("Retained draft");
});

it("does not silently rebase a stale rule draft", async () => {
  const client = mount();
  await openEditor();
  enter("Component name", "Changed locally");
  const next = configuration();
  next.plans[0]!.revision = 2;
  mocks.get.mockResolvedValue(next);
  await client.invalidateQueries({ queryKey: ["payroll-configuration"] });
  expect(await screen.findByText(/This draft is stale/)).toBeVisible();
  await review();
  expect(screen.getByRole("button", { name: "Save plan draft" })).toBeDisabled();
});

it("requires explicit discard before switching plans with unsaved rules", async () => {
  const data = configuration();
  data.plans.push({ ...data.plans[0]!, id: "second", name: "Second" });
  mocks.get.mockResolvedValue(data);
  mount();
  await openEditor();
  enter("Component name", "Unsaved rules");
  await userEvent.click(screen.getByRole("button", { name: "All plans" }));
  await userEvent.click(screen.getByRole("button", { name: "Edit Second" }));
  expect(screen.getByRole("dialog", { name: "Discard unsaved plan rules?" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await userEvent.click(screen.getByRole("button", { name: "Edit Second" }));
  await userEvent.click(screen.getByRole("button", { name: "Discard and continue" }));
  expect(screen.getByLabelText("Component name")).not.toHaveValue("Unsaved rules");
});

it("preserves hidden metadata when saving details and protects unsaved metadata on switching plans", async () => {
  const data = configuration();
  data.plans[0]!.positions = ["Senior"];
  data.plans[0]!.outletIds = ["branch-a"];
  data.plans.push({ ...data.plans[0]!, id: "second", name: "Second" });
  mocks.get.mockResolvedValue(data);
  mount();
  await openEditor("details");
  enter("Plan description", "Revised description");
  await userEvent.click(screen.getByRole("button", { name: "All plans" }));
  await userEvent.click(screen.getByRole("button", { name: "Edit Second" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await openEditor("details");
  await userEvent.click(screen.getByRole("button", { name: "Save plan metadata" }));
  await confirm();
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith(
      "/payroll-configuration/plans/hair/metadata",
      expect.objectContaining({
        positions: ["Senior"],
        outletIds: ["branch-a"],
        description: "Revised description",
        expectedRevision: 1,
      }),
    ),
  );
});

it("keeps template creation out of the list and creates an audited sample draft", async () => {
  mount();
  await screen.findByRole("button", { name: "Create plan" });
  expect(screen.getByLabelText("New or duplicate plan name")).not.toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Create plan" }));
  enter("New or duplicate plan name", "New stylist plan");
  await userEvent.click(screen.getByRole("button", { name: "Create hair stylist sample draft" }));
  await confirm();
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith(
      "/payroll-configuration/plans",
      expect.objectContaining({
        name: "New stylist plan",
        positions: [],
        definition: hairPayrollExample(),
      }),
    ),
  );
});

it("bulk assigns published plans without showing salary forms", async () => {
  const data = configuration();
  data.plans[0]!.versions[0]!.status = "PUBLISHED";
  mocks.get.mockResolvedValue(data);
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "Assign staff to Hair" }));
  await userEvent.click(screen.getByLabelText("Amy"));
  expect(screen.queryByLabelText("Basic monthly salary")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Assignment plan")).toHaveValue("hair");
  await userEvent.click(screen.getByRole("button", { name: "Assign selected staff" }));
  await confirm("New assignment");
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/payroll-configuration/assignments", {
      expectedRevision: 0,
      staffIds: ["amy"],
      planId: "hair",
      fromDate: data.today,
      reason: "New assignment",
    }),
  );
});

it("does not offer unpublished plans for assignment", async () => {
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "Assign staff to Hair" }));
  expect(screen.queryByRole("option", { name: "Hair — all outlets" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("Amy"));
  expect(screen.getByRole("button", { name: "Assign selected staff" })).toBeDisabled();
});

it("keeps advanced filters, staged rates and incentives in saved rule definitions", async () => {
  const data = configuration();
  const original = data.plans[0]!.versions[0]!.definition;
  original.components[0]!.categoryInclude = ["hair"];
  original.components[0]!.categoryExclude = ["retail"];
  original.components[0]!.monthlyCap = "1500";
  mocks.get.mockResolvedValue(data);
  mount();
  await openEditor();
  expect(screen.getByText(/Advanced earning rules/)).toHaveTextContent("category filters apply");
  enter("Component name", "Preserve advanced rules");
  await review();
  expect(screen.getByText("Category filters apply.")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Save plan draft" }));
  await confirm();
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith(
      "/payroll-configuration/plans/hair/draft",
      expect.objectContaining({
        definition: {
          ...original,
          components: original.components.map((component, index) =>
            index === 0 ? { ...component, name: "Preserve advanced rules" } : component,
          ),
        },
      }),
    ),
  );
});

it("validates tenure rules before offering a draft save", async () => {
  mount();
  await openEditor();
  await userEvent.click(screen.getByText(/Tenure stages, incentives and ordering/));
  enter("Stage 1 from month", "5");
  await review();
  expect(screen.getByRole("button", { name: "Save plan draft" })).toBeDisabled();
  expect(mocks.post).not.toHaveBeenCalled();
});

it("updates category filters and component order through advanced controls", async () => {
  mount();
  await openEditor();
  await userEvent.click(screen.getByText(/Advanced earning rules/));
  const included = screen.getByLabelText("Included category keys (comma-separated, blank = all)");
  fireEvent.change(included, { target: { value: "hair, skin, hair" } });
  fireEvent.blur(included);
  await userEvent.click(screen.getByText(/Tenure stages, incentives and ordering/));
  await userEvent.click(screen.getByRole("button", { name: "Move Product up" }));
  await review();
  await userEvent.click(screen.getByRole("button", { name: "Save plan draft" }));
  await confirm();
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith(
      "/payroll-configuration/plans/hair/draft",
      expect.objectContaining({
        definition: expect.objectContaining({
          components: expect.arrayContaining([
            expect.objectContaining({
              key: "cash_pkg",
              categoryInclude: ["hair", "skin"],
              sort: 2,
            }),
            expect.objectContaining({ key: "product", sort: 1 }),
          ]),
        }),
      }),
    ),
  );
});

it("preserves a rules draft while company policy is saved", async () => {
  mount();
  await openEditor();
  enter("Component name", "Rules stay here");
  await userEvent.click(screen.getByRole("button", { name: "Payroll policies" }));
  await userEvent.selectOptions(
    screen.getByLabelText("Negative commission base policy"),
    "WRITE_OFF",
  );
  await userEvent.click(screen.getByRole("button", { name: "Save salon commission settings" }));
  await confirm();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "All plans" }));
  await openEditor();
  expect(screen.getByLabelText("Component name")).toHaveValue("Rules stay here");
});

it("opens version history separately from the rule editor", async () => {
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "History for Hair" }));
  expect(screen.getByText("Version history and comparison")).toBeVisible();
  expect(screen.getByLabelText("Component name")).not.toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Back to editor" }));
  expect(screen.getByRole("tab", { name: "1. Details" })).toBeVisible();
});

it("keeps historical monetary preview and comparison connected across views", async () => {
  mocks.get.mockImplementation(async (url: string) =>
    url.endsWith("/historical-preview")
      ? {
          status: "AVAILABLE",
          earningsActive: false,
          inputSource: "FROZEN_CLOSE",
          planId: "hair",
          planRevision: 1,
          periodKey: "2026-09",
          timeZone: "Asia/Singapore",
          startsAt: "2026-08-31T16:00:00.000Z",
          endsAt: "2026-09-30T16:00:00.000Z",
          blockers: [],
          configuration: { assignmentRevision: 0, settingsRevision: 0, blockers: [], staff: [] },
          evidenceInventory: { collectionCount: 0, legacyEarningsCount: 0 },
          impact: {
            currency: "SGD",
            calculationVersion: "cp-005-v2",
            inputHash: "hash",
            afterVersion: { id: "v1", versionNo: 1, status: "DRAFT", effectiveFrom: "2026-10-27" },
            rows: [
              {
                staffId: "amy",
                staffName: "Amy",
                disabled: false,
                assignedVersion: { id: "v1", versionNo: 1 },
                beforeTotal: "120.00",
                afterTotal: "130.50",
                change: "10.50",
              },
            ],
            staffWithoutActivity: [],
            totals: { before: "120.00", after: "130.50", change: "10.50" },
          },
        }
      : configuration(),
  );
  mount();
  await openEditor();
  await userEvent.click(screen.getByRole("button", { name: "Review historical impact" }));
  await userEvent.click(screen.getByRole("button", { name: "Check historical inputs" }));
  await screen.findByText(/Historical commission impact/);
  await userEvent.click(screen.getByRole("button", { name: "Back to editor" }));
  await userEvent.click(screen.getByRole("button", { name: "Version history" }));
  const money = screen.getByRole("region", { name: "Posted money under the selected version" });
  expect(money).toHaveTextContent("Posted 2026-09 commission: S$120.00");
  expect(money).toHaveTextContent("change +S$10.50");
});

it("keeps staff-specific payroll profiles and scoped assignment saves functional", async () => {
  const data = configuration();
  data.plans[0]!.versions[0]!.status = "PUBLISHED";
  data.plans[0]!.outletIds = ["branch-a"];
  mocks.get.mockResolvedValue(data);
  mount(true, "amy");
  await screen.findByLabelText("Basic monthly salary");
  enter("Basic monthly salary", "1234.56");
  enter("Payroll change reason", "Salary review");
  await userEvent.click(screen.getByRole("button", { name: "Save salary profile" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith(
      "/payroll-configuration/staff/amy/profile",
      expect.objectContaining({
        basicSalary: "1234.56",
        expectedRevision: 0,
        reason: "Salary review",
      }),
    ),
  );
  await userEvent.selectOptions(screen.getByLabelText("Assignment plan"), "hair");
  enter("Payroll change reason", "Branch coverage");
  await userEvent.click(screen.getByRole("button", { name: "Assign selected staff" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/payroll-configuration/assignments", {
      expectedRevision: 0,
      staffIds: ["amy"],
      planId: "hair",
      fromDate: data.today,
      reason: "Branch coverage",
    }),
  );
});

it("requires staff-profile reasons and retains salary edits on failure", async () => {
  mount(true, "amy");
  await screen.findByLabelText("Basic monthly salary");
  enter("Basic monthly salary", "2400");
  await userEvent.click(screen.getByRole("button", { name: "Save salary profile" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter a change reason");
  mocks.post.mockRejectedValueOnce(new Error("Salary conflict"));
  enter("Payroll change reason", "Salary review");
  await userEvent.click(screen.getByRole("button", { name: "Save salary profile" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Salary conflict");
  expect(screen.getByLabelText("Basic monthly salary")).toHaveValue("2400");
});

it("retains staff employment revision checks", async () => {
  mount(true, "amy");
  await screen.findByLabelText("Staff join date");
  enter("Staff join date", "2026-08-01");
  enter("Payroll change reason", "Correct join date");
  await userEvent.click(screen.getByRole("button", { name: "Save staff payroll settings" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith(
      "/payroll-configuration/staff/amy/settings",
      expect.objectContaining({
        expectedRevision: 0,
        expectedJoinDate: "2026-09-01",
        joinDate: "2026-08-01",
      }),
    ),
  );
});

it("edits only connected policies and preserves hidden company values in the save", async () => {
  const data = configuration();
  data.settings.minimumDepositPct = "42";
  data.settings.refundAdminFee = "87.50";
  mocks.get.mockResolvedValue(data);
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "Payroll policies" }));
  expect(screen.queryByLabelText("Minimum package deposit percentage")).not.toBeInTheDocument();
  await userEvent.selectOptions(
    screen.getByLabelText("Negative commission base policy"),
    "WRITE_OFF",
  );
  await userEvent.click(screen.getByRole("button", { name: "Save salon commission settings" }));
  await confirm();
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith(
      "/payroll-configuration/settings",
      expect.objectContaining({
        negativeBase: "WRITE_OFF",
        minimumDepositPct: "42",
        refundAdminFee: "87.50",
        expectedRevision: 0,
      }),
    ),
  );
});

it("isolates the calculator and optional method comparison in Review", async () => {
  mount();
  await openEditor("review");
  expect(screen.getByText("Calculated commission: S$546.40")).toBeVisible();
  await userEvent.click(screen.getByText("Compare calculation methods"));
  expect(screen.getByRole("img", { name: "Commission method comparison chart" })).toBeVisible();
  enter("Calculator monthly base", "4000");
  await userEvent.selectOptions(screen.getByLabelText("Calculator stage"), "new");
  expect(screen.getByText("Calculated commission: S$160.00")).toBeVisible();
});

it("preserves stored unsupported sales types on unrelated rule edits", async () => {
  const data = configuration();
  data.plans[0]!.versions[0]!.definition.components[0]!.commissionTypes = ["SVC", "GC_SALE"];
  mocks.get.mockResolvedValue(data);
  mount();
  await openEditor();
  expect(screen.queryByRole("checkbox", { name: "GC_SALE" })).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Services" })).toBeVisible();
  enter("Component name", "Renamed component");
  await review();
  await userEvent.click(screen.getByRole("button", { name: "Save plan draft" }));
  await confirm();
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith(
      "/payroll-configuration/plans/hair/draft",
      expect.objectContaining({
        definition: expect.objectContaining({
          components: expect.arrayContaining([
            expect.objectContaining({ commissionTypes: ["SVC", "GC_SALE"] }),
          ]),
        }),
      }),
    ),
  );
});

it("keeps managers read-only and historical monetary inputs owner-only", async () => {
  mount(false);
  await openEditor("rules", false);
  expect(screen.getByLabelText("Component name")).toBeDisabled();
  await review();
  expect(screen.queryByRole("button", { name: "Publish saved version" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Review historical impact" }));
  expect(screen.queryByRole("button", { name: "Check historical inputs" })).not.toBeInTheDocument();
});

it("does not expose company-only staff or impact actions in an outlet session", async () => {
  mocks.get.mockResolvedValue({ ...configuration(), outletId: "branch" });
  mount();
  await openEditor();
  await userEvent.click(screen.getByRole("button", { name: "Review historical impact" }));
  expect(screen.queryByRole("button", { name: "Check historical inputs" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Payroll policies" })).not.toBeInTheDocument();
});

it("removes historical inputs immediately when edit permission is revoked", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (canEdit: boolean) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PayrollPlans canEdit={canEdit} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { rerender } = render(view(true));
  await openEditor();
  await userEvent.click(screen.getByRole("button", { name: "Review historical impact" }));
  expect(screen.getByRole("button", { name: "Check historical inputs" })).toBeVisible();
  rerender(view(false));
  expect(screen.queryByRole("button", { name: "Check historical inputs" })).not.toBeInTheDocument();
});

it("paginates configuration history without discarding editor drafts", async () => {
  mocks.get.mockResolvedValue({ ...configuration(), historyTotal: 201 });
  mount();
  await openEditor();
  enter("Component name", "Draft survives history");
  await userEvent.click(screen.getByRole("button", { name: "Configuration history" }));
  expect(screen.getByRole("button", { name: "Previous audit page" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Next audit page" }));
  await waitFor(() =>
    expect(mocks.get).toHaveBeenCalledWith("/payroll-configuration", { historyPage: 2 }),
  );
  await userEvent.click(screen.getByRole("button", { name: "All plans" }));
  await openEditor();
  expect(screen.getByLabelText("Component name")).toHaveValue("Draft survives history");
});

it("handles an empty salon without inventing a selected plan", async () => {
  mocks.get.mockResolvedValue({ ...configuration(), plans: [] });
  mount();
  expect(await screen.findByText(/No pay plans yet/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Edit Hair" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Create plan" }));
  expect(screen.getByLabelText("New or duplicate plan name")).toBeVisible();
});

it("explains the dedicated owner security requirement and links to setup", async () => {
  mocks.get.mockRejectedValue(
    Object.assign(new Error("Owner verification is required."), {
      code: "OWNER_TWO_FACTOR_REQUIRED",
    }),
  );
  mount();
  expect(await screen.findByRole("link", { name: /Set up/ })).toHaveAttribute(
    "href",
    expect.stringContaining("returnTo=pay-plans"),
  );
  expect(screen.queryByRole("button", { name: "Create plan" })).not.toBeInTheDocument();
});

it("keeps generic load failures distinct from security enrollment and supports retry", async () => {
  mocks.get.mockRejectedValueOnce(new Error("offline"));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  expect(screen.queryByRole("link", { name: /Set up/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Retry plans" }));
  expect(await screen.findByRole("button", { name: "Edit Hair" })).toBeVisible();
});

it("automatically reloads plans when the refreshed account has enabled two-factor", async () => {
  mocks.get.mockRejectedValueOnce(
    Object.assign(new Error("Owner verification is required."), {
      code: "OWNER_TWO_FACTOR_REQUIRED",
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PayrollPlans canEdit />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { rerender } = render(view());
  await screen.findByRole("link", { name: "Set up email verification" });
  mocks.twoFactorEnabled = true;
  rerender(view());
  expect(await screen.findByRole("button", { name: "Edit Hair" })).toBeVisible();
  expect(mocks.get).toHaveBeenCalledTimes(2);
});
it("blocks duplicate retries and keeps the latest failure visible", async () => {
  mocks.get.mockRejectedValueOnce(new Error("offline"));
  mount();
  const user = userEvent.setup();
  const retry = await screen.findByRole("button", { name: "Retry plans" });
  let rejectRetry!: (reason: Error) => void;
  mocks.get.mockImplementationOnce(
    () => new Promise<PayrollConfiguration>((_resolve, reject) => (rejectRetry = reject)),
  );
  await user.click(retry);
  expect(await screen.findByRole("button", { name: "Retrying plans…" })).toBeDisabled();
  rejectRetry(new Error("Owner verification is required."));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Owner verification is required."),
  );
  expect(screen.getByRole("button", { name: "Retry plans" })).toBeEnabled();
  expect(mocks.get).toHaveBeenCalledTimes(2);
});
