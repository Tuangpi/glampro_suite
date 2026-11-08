import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { hairPayrollExample, PAYROLL_DEFAULT_SETTINGS } from "@glampro_suite/shared";
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
it("offers scoped assignments without changing the single staff timeline or trusting client scope", async () => {
  const data = configuration();
  data.plans[0]!.outletIds = ["branch-a", "branch-b"];
  data.plans[0]!.versions[0]!.status = "PUBLISHED";
  mocks.get.mockResolvedValue(data);
  mount(true, "amy");
  const user = userEvent.setup();
  await screen.findByLabelText("Assignment plan");
  expect(screen.getByText(/One plan timeline per staff member/)).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Assignment plan"), "hair");
  expect(screen.getByRole("option", { name: "Hair — selected outlets" })).toBeInTheDocument();
  enter("Payroll change reason", "Branch coverage");
  await user.click(screen.getByRole("button", { name: "Assign selected staff" }));
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
it("limits the staff panel to the selected identity and saves profiles independently", async () => {
  const data = configuration();
  data.staff.push({ ...data.staff[0]!, id: "ben", name: "Ben" });
  mocks.get.mockResolvedValue(data);
  mount(true, "amy");
  const user = userEvent.setup();
  expect(await screen.findByLabelText("Payroll change reason")).toBeInTheDocument();
  expect(screen.queryByLabelText("New or duplicate plan name")).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Ben" })).not.toBeInTheDocument();
  enter("Payroll change reason", "Salary review");
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
  enter("Basic monthly salary", "1200");
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
  enter("Plan description", "Revised description");
  enter("Plan change reason", "Metadata review");
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
  enter(
    "Component name",
    `${(screen.getByLabelText("Component name") as HTMLInputElement).value} revised`,
  );
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
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Previous audit page" })).toBeEnabled(),
  );
});
it("uses the shared exact calculator and explains the historical preview", async () => {
  mount();
  expect(await screen.findByText("Calculated commission: S$546.40")).toBeInTheDocument();
  expect(screen.getByText(/compares the last completed salon month/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check historical inputs" })).toBeInTheDocument();
  expect(
    screen.getByRole("img", { name: "Commission method comparison chart" }),
  ).toBeInTheDocument();
});
it("does not expose historical staff inputs to managers", async () => {
  mount(false);
  await screen.findByText("Calculated commission: S$546.40");
  expect(screen.queryByRole("button", { name: "Check historical inputs" })).not.toBeInTheDocument();
});
it("does not expose historical staff inputs to company owners using outlet sessions", async () => {
  const config = configuration();
  config.outletId = "branch";
  mocks.get.mockResolvedValue(config);
  mount(true);
  await screen.findByText("Calculated commission: S$546.40");
  expect(screen.queryByRole("button", { name: "Check historical inputs" })).not.toBeInTheDocument();
});
it("removes historical inputs immediately when owner permissions are revoked", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (canEdit: boolean) => (
    <QueryClientProvider client={client}>
      <PayrollPlans canEdit={canEdit} />
    </QueryClientProvider>
  );
  const { rerender } = render(view(true));
  await screen.findByRole("button", { name: "Check historical inputs" });
  rerender(view(false));
  expect(
    screen.queryByRole("region", { name: "Historical payroll input readiness" }),
  ).not.toBeInTheDocument();
  expect(mocks.get).toHaveBeenCalledTimes(1);
});
it("requires a reason and publishes only the saved revision", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByText("Calculated commission: S$546.40");
  await user.click(screen.getByRole("button", { name: "Publish saved version" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter a change reason");
  expect(mocks.post).not.toHaveBeenCalled();
  enter("Plan change reason", "Approved sample");
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
  enter("Component name", "New cash name");
  expect(screen.getByRole("button", { name: "Publish saved version" })).toBeDisabled();
  enter("Plan change reason", "Rename component");
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
  await screen.findByText("Calculated commission: S$546.40");
  enter(
    "Component name",
    `${(screen.getByLabelText("Component name") as HTMLInputElement).value} changed`,
  );
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
  enter("Plan change reason", "New assignment");
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
  expect(screen.getByRole("alert")).toHaveTextContent("offline");
  expect(screen.queryByRole("button", { name: "Save plan draft" })).not.toBeInTheDocument();
});
it("explains an owner verification refusal without exposing payroll controls", async () => {
  mocks.get.mockRejectedValue(new Error("Owner verification is required."));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Owner verification is required.");
  expect(screen.queryByLabelText("Basic monthly salary")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save plan draft" })).not.toBeInTheDocument();
});
it("offers security setup only for the dedicated owner two-factor requirement", async () => {
  mocks.get.mockRejectedValue(
    Object.assign(new Error("Owner verification is required."), {
      code: "OWNER_TWO_FACTOR_REQUIRED",
    }),
  );
  mount();
  const link = await screen.findByRole("link", { name: "Set up email verification" });
  expect(link).toHaveAttribute("href", "/settings?section=privacy&returnTo=pay-plans");
  expect(screen.getByText("Enable two-factor authentication to access pay plans")).toBeVisible();
  expect(screen.queryByText("Unable to load commission plans.")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Retry plans" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Basic monthly salary")).not.toBeInTheDocument();
});
it("does not treat other permission errors as missing two-factor setup", async () => {
  mocks.get.mockRejectedValue(
    Object.assign(new Error("Permission denied."), { code: "FORBIDDEN" }),
  );
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Permission denied.");
  expect(screen.queryByRole("link", { name: "Set up email verification" })).not.toBeInTheDocument();
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
  expect(await screen.findByText("Calculated commission: S$546.40")).toBeInTheDocument();
  expect(mocks.get).toHaveBeenCalledTimes(2);
});
it("retries a failed load and restores the configuration after recovery", async () => {
  mocks.get.mockRejectedValueOnce(new Error("offline"));
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Retry plans" }));
  expect(await screen.findByText("Calculated commission: S$546.40")).toBeInTheDocument();
  expect(screen.queryByText("Unable to load commission plans.")).not.toBeInTheDocument();
  expect(mocks.get).toHaveBeenCalledTimes(2);
  expect(mocks.get).toHaveBeenLastCalledWith("/payroll-configuration", { historyPage: 1 });
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
it("requires a reason for structured salary saves and retains edits after server failure", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByText("Calculated commission: S$546.40");
  await user.clear(screen.getByLabelText("Basic monthly salary"));
  enter("Basic monthly salary", "1234.56");
  await user.click(screen.getByRole("button", { name: "Save salary profile" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter a change reason");
  expect(mocks.post).not.toHaveBeenCalled();
  enter("Plan change reason", "Salary review");
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
  enter("Staff join date", "2026-08-01");
  enter("Plan change reason", "Correct employment date");
  await user.click(screen.getByRole("button", { name: "Save staff payroll settings" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/payroll-configuration/staff/amy/settings", {
      expectedRevision: 0,
      reason: "Correct employment date",
      expectedJoinDate: "2026-09-01",
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
  enter("Minimum package deposit percentage", "45");
  enter("Plan change reason", "New deposit policy");
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
  enter("Basic monthly salary", "1200");
  const next = configuration();
  next.staff[0]!.profile = { ...next.staff[0]!.profile!, revision: 1, basicSalary: "1500" };
  mocks.get.mockResolvedValue(next);
  await client.invalidateQueries({ queryKey: ["payroll-configuration"] });
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Salary profile changed"),
  );
  expect(screen.getByLabelText("Basic monthly salary")).toHaveValue("1200");
  expect(screen.getByRole("button", { name: "Save salary profile" })).toBeDisabled();
});
it("saves structured stage and incentive edits in the revision-bound draft", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByText("Calculated commission: S$546.40");
  enter("Stage 1 name", "Probation");
  enter("Incentive 1 row 1 award", "125.50");
  enter("Plan change reason", "New stage and award");
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
  enter("Plan change reason", "Filter and reorder");
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

it("carries posted money from the readiness check into the rule version comparison", async () => {
  mocks.get.mockImplementation(async (url: string) =>
    url === "/payroll-configuration/plans/hair/historical-preview"
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
            afterVersion: {
              id: "v1",
              versionNo: 1,
              status: "DRAFT",
              effectiveFrom: "2026-10-27",
            },
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
  await screen.findByText("Calculated commission: S$546.40");
  // Money reaches the comparison only through a completed check, never from a rule diff.
  expect(
    screen.queryByRole("region", { name: "Posted money under the selected version" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Check historical inputs" }));
  const money = await screen.findByRole("region", {
    name: "Posted money under the selected version",
  });
  expect(money).toHaveTextContent("Posted 2026-09 commission: S$120.00");
  expect(money).toHaveTextContent("change +S$10.50");
  expect(money).toHaveTextContent("the month's frozen approved calculation");
  expect(money).toHaveTextContent(
    "not the difference between the two rule versions selected above",
  );
  expect(within(money).getByRole("row", { name: /Salon total/ })).toHaveTextContent("+S$10.50");
});

it("renders a salon with no plans yet instead of reading a definition off a null draft", async () => {
  // The empty configuration is the first thing a fresh salon sees: no plan means
  // no selected plan and no draft. Comparing `draft?.planId` with `plan?.id` there
  // held (`undefined === undefined`) and the draft was dereferenced as if it
  // existed, which took the whole Team & commissions section down.
  const data = configuration();
  data.plans = [];
  mocks.get.mockResolvedValue(data);
  mount();
  expect(await screen.findByText(/0 active plans/)).toBeInTheDocument();
  expect(screen.getByLabelText("Commission plan")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save plan draft" })).not.toBeInTheDocument();
  expect(screen.getByText(/without a plan \(flat fallback\)/)).toBeInTheDocument();
});

it("stops offering gift-card commission that nothing can produce", async () => {
  // CP-008 (d): no loader writes a GC_SALE base line, so a component that counted it
  // would promise commission on revenue the close can never see. The picker narrows;
  // the contract keeps the value (see the round-trip test below).
  mount();
  await screen.findByLabelText("Component name");
  expect(screen.queryByRole("checkbox", { name: "GC_SALE" })).not.toBeInTheDocument();
  // The seven types that do have producers remain, so this is a narrowing, not a purge.
  for (const type of ["SVC", "PRD", "PKG_SALE", "PKG_RED", "FOC", "VP_SALE", "VP_SPEND"])
    expect(screen.getByRole("checkbox", { name: type })).toBeInTheDocument();
});

it("leaves a stored gift-card rule alone when another field of its component changes", async () => {
  const data = configuration();
  const stored = data.plans[0]!.versions[0]!.definition.components[0]!;
  // A definition saved while the picker still offered GC_SALE must survive an edit to
  // an unrelated field: the schema is strict, so unlinking the checkbox and the value
  // would strand that definition rather than fix it.
  stored.commissionTypes = ["SVC", "GC_SALE"];
  mocks.get.mockResolvedValue(data);
  mount();
  const user = userEvent.setup();
  await screen.findByLabelText("Component name");
  enter(
    "Component name",
    `${(screen.getByLabelText("Component name") as HTMLInputElement).value} revised`,
  );
  enter("Plan change reason", "Rename component");
  await user.click(screen.getByRole("button", { name: "Save plan draft" }));
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
