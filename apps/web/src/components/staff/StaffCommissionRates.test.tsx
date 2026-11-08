import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { CommissionConfiguration } from "@glampro_suite/shared";
import StaffCommissionRates from "./StaffCommissionRates";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({
  get: mocks.get,
  post: mocks.post,
  getErrorMessage: (error: Error) => error.message,
}));
const config: CommissionConfiguration = {
  revision: "rev-1",
  current: [],
  scheduled: [],
  history: [],
  page: 1,
  total: 0,
  legacyServiceRate: "10.00",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue(config);
  mocks.post.mockResolvedValue({ revision: "rev-2" });
});
function mount(canEdit = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <StaffCommissionRates staffId="amy" canEdit={canEdit} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}
it("shows unconfigured legacy fallback without silently opting into inheritance", async () => {
  mount();
  expect(await screen.findByLabelText("Services setting")).toHaveValue("unconfigured");
  expect(screen.getByText("Current default: 10.00% · Company fallback: 0%")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Publish rate changes" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "Compare team rates" })).toHaveAttribute(
    "href",
    "/settings?section=team&team=rates",
  );
});
it("shows current custom zero and inherited company defaults, ignoring scheduled changes", async () => {
  const rule = {
    id: "rule",
    staffId: "amy",
    itemKind: "SERVICE" as const,
    scope: "STAFF" as const,
    targetId: null,
    targetName: null,
    rate: "0.00",
    effectiveAt: "2026-01-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    actorId: "owner",
    actorName: "Owner",
    reason: "Policy",
  };
  mocks.get.mockImplementation((_url: string, query: { staffId?: string }) =>
    Promise.resolve({
      ...config,
      current: query.staffId
        ? [rule, { ...rule, id: "product", itemKind: "PRODUCT", rate: null }]
        : [
            {
              ...rule,
              id: "company",
              staffId: null,
              scope: "COMPANY",
              itemKind: "PRODUCT",
              rate: "8.00",
            },
          ],
      scheduled: [{ ...rule, rate: "50.00" }],
    }),
  );
  mount();
  expect(await screen.findByLabelText("Services setting")).toHaveValue("custom");
  expect(screen.getByLabelText("Services percentage")).toHaveValue(0);
  expect(screen.getByLabelText("Products setting")).toHaveValue("inherit");
  expect(screen.getByText("Current default: 8.00% · Company fallback: 8.00%")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Publish rate changes" })).toBeDisabled();
});
it("publishes only edited rates atomically, distinguishing zero and inheritance with a scheduled date", async () => {
  mount();
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText("Services setting"), "custom");
  await user.type(screen.getByLabelText("Services percentage"), "0");
  await user.selectOptions(screen.getByLabelText("Products setting"), "inherit");
  await user.type(screen.getByLabelText("Rate change reason"), "Annual review");
  fireEvent.change(screen.getByLabelText(/Rates effective from/), {
    target: { value: "2026-12-01T09:00" },
  });
  await user.click(screen.getByRole("button", { name: "Publish rate changes" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith("/commissions/bulk", {
      expectedRevision: "rev-1",
      reason: "Annual review",
      effectiveAt: new Date("2026-12-01T09:00").toISOString(),
      rules: [
        { staffId: "amy", itemKind: "SERVICE", scope: "STAFF", targetId: null, rate: 0 },
        { staffId: "amy", itemKind: "PRODUCT", scope: "STAFF", targetId: null, rate: null },
      ],
    }),
  );
  expect(await screen.findByText(/Rate changes published/)).toBeInTheDocument();
});
it("keeps drafts pinned across refetch and requires an explicit successful reload", async () => {
  const client = mount();
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText("Services setting"), "custom");
  await user.type(screen.getByLabelText("Services percentage"), "12");
  act(() => client.setQueryData(["commissions", "amy", 1], { ...config, revision: "new" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("settings changed");
  expect(screen.getByLabelText("Services percentage")).toBeDisabled();
  mocks.get.mockRejectedValue(new Error("Offline"));
  await user.click(screen.getByRole("button", { name: "Reload defaults and discard draft" }));
  expect(await screen.findByText(/Your draft has been kept/)).toBeInTheDocument();
  expect(screen.getByLabelText("Services percentage")).toHaveValue(12);
  mocks.get.mockResolvedValue(config);
  await user.click(screen.getByRole("button", { name: "Reload defaults and discard draft" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Services setting")).toHaveValue("unconfigured"),
  );
  expect(mocks.post).not.toHaveBeenCalled();
});
it("rejects blank and out-of-range custom rates without publishing", async () => {
  mount();
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText("Services setting"), "custom");
  await user.type(screen.getByLabelText("Rate change reason"), "Rate review");
  await user.click(screen.getByRole("button", { name: "Publish rate changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter a percentage");
  await user.type(screen.getByLabelText("Services percentage"), "101");
  await user.click(screen.getByRole("button", { name: "Publish rate changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Check percentages");
  expect(mocks.post).not.toHaveBeenCalled();
});
it("retains failed publication drafts and blocks duplicate publication while pending", async () => {
  mount();
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText("Products setting"), "inherit");
  await user.type(screen.getByLabelText("Rate change reason"), "Use company");
  let reject!: (error: Error) => void;
  mocks.post.mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await user.dblClick(screen.getByRole("button", { name: "Publish rate changes" }));
  expect(mocks.post).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Products setting")).toBeDisabled();
  await act(async () => reject(new Error("Conflict")));
  expect(await screen.findByRole("alert")).toHaveTextContent("Conflict");
  expect(screen.getByLabelText("Products setting")).toHaveValue("inherit");
  expect(screen.getByLabelText("Rate change reason")).toHaveValue("Use company");
});
it("permits read-only inspection without publication", async () => {
  mount(false);
  expect(await screen.findByLabelText("Services setting")).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Publish rate changes" })).not.toBeInTheDocument();
});
it("does not present a failed load as unconfigured rates", async () => {
  mocks.get.mockRejectedValue(new Error("Offline"));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load");
  expect(screen.queryByLabelText("Services setting")).not.toBeInTheDocument();
});
