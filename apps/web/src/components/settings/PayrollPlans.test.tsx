import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { hairPayrollExample, PAYROLL_DEFAULT_SETTINGS } from "@glampro_suite/shared";
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({
  get: mocks.get,
  post: mocks.post,
  getErrorMessage: (e: Error) => e.message,
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
});
function mount(canEdit = true, staffId?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <PayrollPlans canEdit={canEdit} staffId={staffId} />
    </QueryClientProvider>,
  );
  return client;
}
it("limits the staff panel to the selected identity and saves profiles independently", async () => {
  const data = configuration();
  data.staff.push({ ...data.staff[0]!, id: "ben", name: "Ben" });
  mocks.get.mockResolvedValue(data);
  mount(true, "amy");
  const user = userEvent.setup();
  expect(await screen.findByLabelText("Payroll change reason")).toBeInTheDocument();
  expect(screen.queryByLabelText("New or duplicate plan name")).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Ben" })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Payroll change reason"), "Salary review");
  await user.click(screen.getByRole("button", { name: "Save salary profile" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith(
      "/payroll-configuration/staff/amy/profile",
      expect.objectContaining({ expectedRevision: 0, reason: "Salary review" }),
    ),
  );
});

it("preserves unsaved salary fields while changing audit pages", async () => {
  mocks.get.mockResolvedValue({ ...configuration(), historyTotal: 201 });
  mount();
  const user = userEvent.setup();
  await screen.findByText("Calculated commission: S$546.40");
  await user.clear(screen.getByLabelText("Basic monthly salary"));
  await user.type(screen.getByLabelText("Basic monthly salary"), "1200");
  await user.click(screen.getByRole("button", { name: "Next audit page" }));
  await waitFor(() =>
    expect(mocks.get).toHaveBeenCalledWith("/payroll-configuration", { historyPage: 2 }),
  );
  expect(screen.getByLabelText("Basic monthly salary")).toHaveValue("1200");
});
it("saves metadata with a reason and does not overwrite unsaved rule edits", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByText("Calculated commission: S$546.40");
  await user.clear(screen.getByLabelText("Plan description"));
  await user.type(screen.getByLabelText("Plan description"), "Revised description");
  await user.type(screen.getByLabelText("Plan change reason"), "Metadata review");
  await user.click(screen.getByRole("button", { name: "Save plan metadata" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/payroll-configuration/plans/hair/metadata", {
      expectedRevision: 1,
      reason: "Metadata review",
      name: "Hair",
      description: "Revised description",
      positions: [],
      outletIds: [],
    }),
  );
  await user.type(screen.getByLabelText("Component name"), " revised");
  expect(screen.getByRole("button", { name: "Save plan metadata" })).toBeDisabled();
});

it("navigates audit pages using server totals rather than truncating history", async () => {
  mocks.get.mockResolvedValue({ ...configuration(), historyTotal: 201 });
  mount();
  const user = userEvent.setup();
  await screen.findByText("Calculated commission: S$546.40");
  expect(screen.getByRole("button", { name: "Previous audit page" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Next audit page" }));
  await waitFor(() =>
    expect(mocks.get).toHaveBeenCalledWith("/payroll-configuration", { historyPage: 2 }),
  );
  expect(await screen.findByRole("button", { name: "Previous audit page" })).toBeEnabled();
});
it("uses the shared exact calculator and discloses historical preview is unavailable", async () => {
  mount();
  expect(await screen.findByText("Calculated commission: S$546.40")).toBeInTheDocument();
  expect(screen.getByText(/Historical impact preview is not available/)).toBeInTheDocument();
  expect(
    screen.getByRole("img", { name: "Commission method comparison chart" }),
  ).toBeInTheDocument();
});
it("requires a reason and publishes only the saved revision", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByText("Calculated commission: S$546.40");
  await user.click(screen.getByRole("button", { name: "Publish saved version" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter a change reason");
  expect(mocks.post).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("Plan change reason"), "Approved sample");
  await user.click(screen.getByRole("button", { name: "Publish saved version" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/payroll-configuration/plans/hair/publish", {
      expectedRevision: 1,
      reason: "Approved sample",
    }),
  );
});
it("edits components without mutating published rules and prevents publishing unsaved work", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByText("Calculated commission: S$546.40");
  await user.clear(screen.getByLabelText("Component name"));
  await user.type(screen.getByLabelText("Component name"), "New cash name");
  expect(screen.getByRole("button", { name: "Publish saved version" })).toBeDisabled();
  await user.type(screen.getByLabelText("Plan change reason"), "Rename component");
  await user.click(screen.getByRole("button", { name: "Save plan draft" }));
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
it("does not silently rebase a draft when a newer revision arrives", async () => {
  const client = mount();
  const user = userEvent.setup();
  await screen.findByText("Calculated commission: S$546.40");
  await user.type(screen.getByLabelText("Component name"), " changed");
  const next = configuration();
  next.plans[0]!.revision = 2;
  mocks.get.mockResolvedValue(next);
  await client.invalidateQueries({ queryKey: ["payroll-configuration"] });
  expect(await screen.findByText(/This draft is stale/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save plan draft" })).toBeDisabled();
});
it("keeps manager controls read-only and does not invent missing salary profiles", async () => {
  const config = configuration();
  delete config.staff[0]!.profile;
  mocks.get.mockResolvedValue(config);
  mount(false);
  await screen.findByText("Calculated commission: S$546.40");
  expect(screen.queryByRole("button", { name: "Publish saved version" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Component name")).toBeDisabled();
  expect(screen.queryByLabelText("Basic monthly salary")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Staff join date")).toBeDisabled();
});
it("bulk assigns selected staff with the assignment revision", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByText("Calculated commission: S$546.40");
  await user.click(screen.getByLabelText("Amy"));
  await user.selectOptions(screen.getByLabelText("Assignment plan"), "hair");
  await user.type(screen.getByLabelText("Plan change reason"), "New assignment");
  await user.click(screen.getByRole("button", { name: "Assign selected staff" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/payroll-configuration/assignments", {
      expectedRevision: 0,
      staffIds: ["amy"],
      planId: "hair",
      fromDate: "2026-10-27",
      reason: "New assignment",
    }),
  );
});
it("fails closed when configuration cannot be loaded", async () => {
  mocks.get.mockRejectedValue(new Error("offline"));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load commission plans");
  expect(screen.queryByRole("button", { name: "Save plan draft" })).not.toBeInTheDocument();
});
it("requires a reason for structured salary saves and retains edits after server failure", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByText("Calculated commission: S$546.40");
  await user.clear(screen.getByLabelText("Basic monthly salary"));
  await user.type(screen.getByLabelText("Basic monthly salary"), "1234.56");
  await user.click(screen.getByRole("button", { name: "Save salary profile" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter a change reason");
  expect(mocks.post).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("Plan change reason"), "Salary review");
  mocks.post.mockRejectedValueOnce(new Error("Revision conflict"));
  await user.click(screen.getByRole("button", { name: "Save salary profile" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Revision conflict");
  expect(screen.getByLabelText("Basic monthly salary")).toHaveValue("1234.56");
  expect(mocks.post).toHaveBeenCalledWith("/payroll-configuration/staff/amy/profile", {
    expectedRevision: 0,
    reason: "Salary review",
    basicSalary: "1234.56",
    fixedOvertime: "0",
    levy: "0",
    salesAlertPct: "40",
  });
});
it("routes structured join-date settings with required reason and revision", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByText("Calculated commission: S$546.40");
  await user.clear(screen.getByLabelText("Staff join date"));
  await user.type(screen.getByLabelText("Staff join date"), "2026-08-01");
  await user.type(screen.getByLabelText("Plan change reason"), "Correct employment date");
  await user.click(screen.getByRole("button", { name: "Save staff payroll settings" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/payroll-configuration/staff/amy/settings", {
      expectedRevision: 0,
      reason: "Correct employment date",
      joinDate: "2026-08-01",
      stageEndOverride: null,
    }),
  );
});
it("routes structured salon settings with required reason and revision", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByText("Calculated commission: S$546.40");
  await user.click(screen.getByText("Salon commission settings (configuration only)"));
  await user.clear(screen.getByLabelText("Minimum package deposit percentage"));
  await user.type(screen.getByLabelText("Minimum package deposit percentage"), "45");
  await user.type(screen.getByLabelText("Plan change reason"), "New deposit policy");
  await user.click(screen.getByRole("button", { name: "Save salon commission settings" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/payroll-configuration/settings", {
      ...PAYROLL_DEFAULT_SETTINGS,
      expectedRevision: 0,
      reason: "New deposit policy",
      minimumDepositPct: "45",
    }),
  );
});
it("does not discard salary edits or rebase them when configuration is refreshed", async () => {
  const client = mount();
  const user = userEvent.setup();
  await screen.findByText("Calculated commission: S$546.40");
  await user.clear(screen.getByLabelText("Basic monthly salary"));
  await user.type(screen.getByLabelText("Basic monthly salary"), "1200");
  const next = configuration();
  next.staff[0]!.profile = { ...next.staff[0]!.profile!, revision: 1, basicSalary: "1500" };
  mocks.get.mockResolvedValue(next);
  await client.invalidateQueries({ queryKey: ["payroll-configuration"] });
  expect(await screen.findByRole("alert")).toHaveTextContent("Salary profile changed");
  expect(screen.getByLabelText("Basic monthly salary")).toHaveValue("1200");
  expect(screen.getByRole("button", { name: "Save salary profile" })).toBeDisabled();
});
it("saves structured stage and incentive edits in the revision-bound draft", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByText("Calculated commission: S$546.40");
  await user.clear(screen.getByLabelText("Stage 1 name"));
  await user.type(screen.getByLabelText("Stage 1 name"), "Probation");
  await user.clear(screen.getByLabelText("Incentive 1 row 1 award"));
  await user.type(screen.getByLabelText("Incentive 1 row 1 award"), "125.50");
  await user.type(screen.getByLabelText("Plan change reason"), "New stage and award");
  await user.click(screen.getByRole("button", { name: "Save plan draft" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith(
      "/payroll-configuration/plans/hair/draft",
      expect.objectContaining({
        expectedRevision: 1,
        definition: expect.objectContaining({
          stages: expect.arrayContaining([
            expect.objectContaining({ key: "new", name: "Probation" }),
          ]),
          incentives: expect.arrayContaining([
            expect.objectContaining({
              rows: expect.arrayContaining([expect.objectContaining({ amount: "125.50" })]),
            }),
          ]),
        }),
      }),
    ),
  );
});
it("blocks invalid tenure ranges from being saved or published", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByText("Calculated commission: S$546.40");
  await user.clear(screen.getByLabelText("Stage 2 from month"));
  await user.type(screen.getByLabelText("Stage 2 from month"), "3");
  expect(screen.getByRole("button", { name: "Save plan draft" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Publish saved version" })).toBeDisabled();
  expect(screen.getAllByText(/Stages must cover tenure without gaps/).length).toBeGreaterThan(0);
  expect(mocks.post).not.toHaveBeenCalled();
});
it("saves normalized category filters and reordered components", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByText("Calculated commission: S$546.40");
  await user.type(
    screen.getByLabelText("Included category keys (comma-separated, blank = all)"),
    "hair, skin, hair",
  );
  await user.tab();
  await user.type(screen.getByLabelText("Excluded category keys (comma-separated)"), "retail");
  await user.tab();
  await user.click(screen.getByRole("button", { name: "Move Product up" }));
  await user.type(screen.getByLabelText("Plan change reason"), "Filter and reorder");
  await user.click(screen.getByRole("button", { name: "Save plan draft" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith(
      "/payroll-configuration/plans/hair/draft",
      expect.objectContaining({
        definition: expect.objectContaining({
          components: expect.arrayContaining([
            expect.objectContaining({
              key: "cash_pkg",
              sort: 2,
              categoryInclude: ["hair", "skin"],
              categoryExclude: ["retail"],
            }),
            expect.objectContaining({ key: "product", sort: 1 }),
          ]),
        }),
      }),
    ),
  );
});
it("updates the chart and calculator together when selecting a tenure stage", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByText("Calculated commission: S$546.40");
  await user.clear(screen.getByLabelText("Calculator monthly base"));
  await user.type(screen.getByLabelText("Calculator monthly base"), "4000");
  expect(screen.getByText("Calculated commission: S$0.00")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Calculator stage"), "new");
  expect(screen.getByText("Calculated commission: S$160.00")).toBeInTheDocument();
  expect(screen.getByText(/Commission vs base, New staff stage/)).toBeInTheDocument();
});
