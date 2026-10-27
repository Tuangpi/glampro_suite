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
    impact: null,
    planId: "hair",
    planRevision: 1,
    periodKey: "2026-09",
    timeZone: "Asia/Singapore",
    startsAt: "2026-08-31T16:00:00.000Z",
    endsAt: "2026-09-30T16:00:00.000Z",
    blockers: [
      "AUTHORITATIVE_RATE_FREE_BASES_UNAVAILABLE",
      "FROZEN_CARRY_INPUTS_UNAVAILABLE",
      "AUTHORITATIVE_GROUP_METRICS_UNAVAILABLE",
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
  expect(screen.getByText(/Complete historical commission bases/)).toBeInTheDocument();
  expect(screen.getByText(/Frozen carry balances/)).toBeInTheDocument();
  expect(screen.getByText(/Authoritative group incentive metrics/)).toBeInTheDocument();
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
  mocks.get.mockResolvedValueOnce({ ...response(), impact: { totalChange: "0" } });
  await userEvent.click(screen.getByRole("button", { name: "Check historical inputs" }));
  await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
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
