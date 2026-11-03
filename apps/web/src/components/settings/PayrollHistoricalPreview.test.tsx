import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({ get: mocks.get, getErrorMessage: (e: Error) => e.message }));
import PayrollHistoricalPreview from "./PayrollHistoricalPreview";

function response() {
  return {
    status: "UNAVAILABLE",
    earningsActive: false,
    inputSource: null,
    impact: null,
    planId: "hair",
    planRevision: 1,
    periodKey: "2026-09",
    timeZone: "Asia/Singapore",
    startsAt: "2026-08-31T16:00:00.000Z",
    endsAt: "2026-09-30T16:00:00.000Z",
    blockers: [
      "APPROVED_PREVIOUS_CLOSE_OR_PERSISTED_OPENING_REQUIRED",
      "SOURCES_UNAVAILABLE",
      "CARRY_UNAVAILABLE",
      "GROUPS_UNAVAILABLE",
      "STAFF_COLLECTION_MISMATCH",
    ],
    configuration: {
      assignmentRevision: 3,
      settingsRevision: 0,
      blockers: ["HISTORICAL_SALON_SETTINGS_UNAVAILABLE"],
      staff: [
        {
          staffId: "amy",
          staffName: "Amy",
          disabled: true,
          joinDate: null,
          staffRevision: null,
          version: { id: "v1", versionNo: 1 },
          blockers: ["HISTORICAL_STAFF_SETTINGS_UNAVAILABLE"],
        },
      ],
    },
    evidenceInventory: { collectionCount: 2, legacyEarningsCount: 5 },
  };
}
/** Money-bearing response: posted money plus what the saved rules would pay. */
function available() {
  const base = response();
  return {
    ...base,
    status: "AVAILABLE" as const,
    inputSource: "FROZEN_CLOSE" as const,
    blockers: [],
    configuration: {
      ...base.configuration,
      blockers: [],
      // The server rolls per-staff gaps into the top-level blockers, so a money
      // bearing response never carries one.
      staff: base.configuration.staff.map((row) => ({ ...row, blockers: [] })),
    },
    impact: {
      currency: "SGD",
      calculationVersion: "cp-005-v2",
      inputHash: "hash",
      afterVersion: {
        id: "v2",
        versionNo: 2,
        status: "DRAFT",
        effectiveFrom: "2026-11-01",
      },
      rows: [
        {
          staffId: "amy",
          staffName: "Amy",
          disabled: false,
          assignedVersion: { id: "v1", versionNo: 1 },
          beforeTotal: "120.00",
          afterTotal: "135.50",
          change: "15.50",
        },
        {
          staffId: "bob",
          staffName: "Bob",
          disabled: true,
          assignedVersion: { id: "v1", versionNo: 1 },
          beforeTotal: "80.00",
          afterTotal: "75.00",
          change: "-5.00",
        },
      ],
      staffWithoutActivity: [{ staffId: "cat", staffName: "Cat", disabled: false }],
      totals: { before: "200.00", after: "210.50", change: "10.50" },
    },
  };
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (planId = "hair", revision = 1, disabled = false) => (
    <QueryClientProvider client={client}>
      <PayrollHistoricalPreview
        key={`${planId}-${revision}`}
        planId={planId}
        revision={revision}
        disabled={disabled}
      />
    </QueryClientProvider>
  );
  const rendered = render(view());
  return { ...rendered, view };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(response());
});

it("loads only on request and explains authoritative evidence gaps without a payout total", async () => {
  mount();
  expect(mocks.get).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Check historical inputs" }));
  expect(await screen.findByText(/Calendar month: 2026-09/)).toHaveTextContent("Asia/Singapore");
  expect(mocks.get).toHaveBeenCalledExactlyOnceWith(
    "/payroll-configuration/plans/hair/historical-preview",
    { expectedRevision: 1 },
  );
  expect(screen.getByText(/Historical impact unavailable/)).toBeInTheDocument();
  expect(screen.getByText(/approved prior close or a persisted opening carry/)).toBeInTheDocument();
  expect(screen.getByText(/Complete historical commission bases/)).toBeInTheDocument();
  expect(screen.getByText(/Frozen carry balances/)).toBeInTheDocument();
  expect(screen.getByText(/Authoritative group incentive metrics/)).toBeInTheDocument();
  // An unmapped code keeps its raw name instead of disappearing from the gap list.
  expect(
    screen.getByText("Unresolved input requirement: STAFF_COLLECTION_MISMATCH"),
  ).toBeInTheDocument();
  expect(screen.getByText(/Pre-close audited salon settings/)).toBeInTheDocument();
  expect(screen.getByText(/Amy \(currently disabled\)/)).toHaveTextContent("Published version 1");
  expect(screen.getByText(/Pre-close audited staff settings/)).toBeInTheDocument();
  expect(screen.getByText(/Salon-wide evidence inventory only/)).toHaveTextContent(
    "2 collection records; 5 legacy earnings records",
  );
  expect(screen.queryByText(/S\$/)).not.toBeInTheDocument();
});

it("shows empty membership as unknown earnings, not a zero amount", async () => {
  const data = response();
  data.configuration.staff = [];
  mocks.get.mockResolvedValue(data);
  mount();
  await userEvent.click(screen.getByRole("button", { name: "Check historical inputs" }));
  expect(await screen.findByText(/not evidence of zero earnings/)).toBeInTheDocument();
});

it("hides prior results while retrying and after failure, then permits recovery", async () => {
  mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Check historical inputs" }));
  await screen.findByText(/Calendar month:/);
  let reject!: (error: Error) => void;
  mocks.get.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await user.click(screen.getByRole("button", { name: "Check historical inputs" }));
  expect(screen.getByRole("status")).toHaveTextContent("Checking historical inputs");
  expect(screen.queryByText(/Calendar month:/)).not.toBeInTheDocument();
  await act(async () => reject(new Error("Plan changed. Reload before previewing.")));
  expect(await screen.findByRole("alert")).toHaveTextContent("Plan changed");
  expect(screen.queryByText(/Calendar month:/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Check historical inputs" }));
  expect(await screen.findByText(/Calendar month:/)).toBeInTheDocument();
});

it("rejects mismatched revisions and unexpected monetary responses", async () => {
  mocks.get.mockResolvedValueOnce({ ...response(), planRevision: 2 });
  mount();
  await userEvent.click(screen.getByRole("button", { name: "Check historical inputs" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Plan changed");
  // Money must arrive as exact decimal strings; a float total is refused rather than
  // rendered, and an UNAVAILABLE claim can never smuggle a monetary block.
  mocks.get.mockResolvedValueOnce({
    ...available(),
    impact: { ...available().impact, totals: { before: 200, after: 210.5, change: 10.5 } },
  });
  await userEvent.click(screen.getByRole("button", { name: "Check historical inputs" }));
  await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(/Calendar month:/)).not.toBeInTheDocument();
  mocks.get.mockResolvedValueOnce({ ...response(), impact: { totalChange: "0" } });
  await userEvent.click(screen.getByRole("button", { name: "Check historical inputs" }));
  await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(3));
  expect(screen.queryByText(/Calendar month:/)).not.toBeInTheDocument();
});

it("ignores late results when the selected plan or revision changes", async () => {
  let resolve!: (data: unknown) => void;
  mocks.get.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { rerender, view } = mount();
  await userEvent.click(screen.getByRole("button", { name: "Check historical inputs" }));
  rerender(view("tp", 2));
  await act(async () => resolve(response()));
  expect(screen.queryByText(/Calendar month:/)).not.toBeInTheDocument();
  expect(mocks.get).toHaveBeenCalledTimes(1);
  mocks.get.mockResolvedValue({ ...response(), planId: "tp", planRevision: 2 });
  await userEvent.click(screen.getByRole("button", { name: "Check historical inputs" }));
  await screen.findByText(/Calendar month:/);
  expect(mocks.get).toHaveBeenLastCalledWith("/payroll-configuration/plans/tp/historical-preview", {
    expectedRevision: 2,
  });
  rerender(view("tp", 3));
  expect(screen.queryByText(/Calendar month:/)).not.toBeInTheDocument();
});

it("disables checks and hides results during configuration refresh or save", async () => {
  const { rerender, view } = mount();
  await userEvent.click(screen.getByRole("button", { name: "Check historical inputs" }));
  await screen.findByText(/Calendar month:/);
  rerender(view("hair", 1, true));
  expect(screen.getByRole("button", { name: "Check historical inputs" })).toBeDisabled();
  expect(screen.queryByText(/Calendar month:/)).not.toBeInTheDocument();
});

it("shows posted money against saved rules with the money source, and keeps gaps out", async () => {
  mocks.get.mockResolvedValue(available());
  mount();
  await userEvent.click(screen.getByRole("button", { name: "Check historical inputs" }));
  expect(await screen.findByText("Historical commission impact")).toBeInTheDocument();
  const summary = screen.getByText(/Posted 2026-09 commission/);
  expect(summary).toHaveTextContent("S$200.00");
  expect(summary).toHaveTextContent("version 2");
  expect(summary).toHaveTextContent("S$210.50");
  expect(summary).toHaveTextContent("+S$10.50");
  expect(screen.getByText(/Money source/)).toHaveTextContent("frozen approved calculation");
  expect(screen.getByRole("row", { name: /Amy/ })).toHaveTextContent("S$120.00");
  expect(screen.getByRole("row", { name: /Amy/ })).toHaveTextContent("S$135.50");
  expect(screen.getByRole("row", { name: /Amy/ })).toHaveTextContent("+S$15.50");
  expect(screen.getByRole("row", { name: /Bob/ })).toHaveTextContent("S$75.00");
  expect(screen.getByRole("row", { name: /Bob/ })).toHaveTextContent("-S$5.00");
  expect(screen.getByRole("row", { name: /Bob/ })).toHaveTextContent("currently disabled");
  expect(screen.getByRole("row", { name: /Salon total/ })).toHaveTextContent("S$200.00");
  expect(screen.getByRole("row", { name: /Salon total/ })).toHaveTextContent("S$210.50");
  expect(screen.getByRole("row", { name: /Salon total/ })).toHaveTextContent("+S$10.50");
  // A staff member without authoritative activity is named, never given a zero.
  expect(screen.getByText(/Cat/)).toHaveTextContent("no zero");
  expect(screen.queryByText(/Historical impact unavailable/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Unresolved input requirement/)).not.toBeInTheDocument();
  expect(screen.getByText(/Preview only/)).toHaveTextContent("records nothing");
});

it("publishes the posted money for other plan views only after a completed check", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onResult = vi.fn();
  const view = (planId: string, revision: number) => (
    <QueryClientProvider client={client}>
      <PayrollHistoricalPreview
        key={`${planId}-${revision}`}
        planId={planId}
        revision={revision}
        disabled={false}
        onResult={onResult}
      />
    </QueryClientProvider>
  );
  const { rerender } = render(view("hair", 1));
  // Nothing is published before the owner asks for the check.
  expect(onResult).not.toHaveBeenCalled();
  mocks.get.mockResolvedValue(available());
  await userEvent.click(screen.getByRole("button", { name: "Check historical inputs" }));
  await screen.findByText("Historical commission impact");
  // Exact decimal strings travel unchanged, so a second view cannot re-round the money.
  expect(onResult).toHaveBeenCalledExactlyOnceWith("hair", 1, {
    periodKey: "2026-09",
    inputSource: "FROZEN_CLOSE",
    impact: available().impact,
  });
  // A month that cannot be valued withdraws the money instead of leaving it on screen.
  mocks.get.mockResolvedValue(response());
  await userEvent.click(screen.getByRole("button", { name: "Check historical inputs" }));
  await screen.findByText(/Historical impact unavailable/);
  expect(onResult).toHaveBeenLastCalledWith("hair", 1, null);
  expect(onResult).toHaveBeenCalledTimes(2);
  // Another plan or revision reports nothing until its own check completes.
  rerender(view("tp", 2));
  expect(onResult).toHaveBeenCalledTimes(2);
});
