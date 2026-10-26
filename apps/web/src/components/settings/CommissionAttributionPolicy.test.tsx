import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { CommissionAttributionPolicyView } from "@glampro_suite/shared";
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({
  get: mocks.get,
  post: mocks.post,
  getErrorMessage: (error: Error) => error.message,
}));
import CommissionAttributionPolicy from "./CommissionAttributionPolicy";

const optional: CommissionAttributionPolicyView = {
  revision: null,
  requireSellers: false,
  requireServicePerformers: false,
  requireRedemptionPerformers: false,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue(optional);
  mocks.post.mockResolvedValue({ ...optional, revision: "rev-1", requireSellers: true });
});
function mount(canEdit = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CommissionAttributionPolicy canEdit={canEdit} />
    </QueryClientProvider>,
  );
  return client;
}
it("shows optional defaults and makes clear that policy is not earnings activation", async () => {
  mount();
  expect(await screen.findByRole("checkbox", { name: "Require sellers" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Require service performers" })).not.toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Require package redemption performers" }),
  ).not.toBeChecked();
  expect(screen.getByText(/do not enable new commission earnings/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Publish attribution policy" })).toBeDisabled();
});
it("publishes explicit flags, a trimmed reason and the loaded revision", async () => {
  mocks.get.mockResolvedValue({ ...optional, revision: "old" });
  mocks.post.mockResolvedValue({
    ...optional,
    revision: "new",
    requireSellers: true,
    requireRedemptionPerformers: true,
  });
  const client = mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("checkbox", { name: "Require sellers" }));
  await user.click(screen.getByRole("checkbox", { name: "Require package redemption performers" }));
  await user.type(
    screen.getByLabelText("Attribution policy change reason"),
    "  Require explicit attribution  ",
  );
  await user.click(screen.getByRole("button", { name: "Publish attribution policy" }));
  expect(await screen.findByText(/Attribution policy published/)).toBeInTheDocument();
  expect(mocks.post).toHaveBeenCalledExactlyOnceWith("/commissions/attribution-policy", {
    requireSellers: true,
    requireServicePerformers: false,
    requireRedemptionPerformers: true,
    expectedRevision: "old",
    reason: "Require explicit attribution",
  });
  expect(screen.getByLabelText("Attribution policy change reason")).toHaveValue("");
  expect(client.getQueryData(["commission-attribution-policy"])).toEqual({
    ...optional,
    revision: "new",
    requireSellers: true,
    requireRedemptionPerformers: true,
  });
});
it("keeps conflicting edits and reloads only on explicit discard", async () => {
  mocks.post.mockRejectedValue(new Error("Attribution policy changed. Reload before publishing."));
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("checkbox", { name: "Require sellers" }));
  await user.type(screen.getByLabelText("Attribution policy change reason"), "Keep my reason");
  await user.click(screen.getByRole("button", { name: "Publish attribution policy" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Attribution policy changed");
  expect(screen.getByRole("checkbox", { name: "Require sellers" })).toBeChecked();
  expect(screen.getByLabelText("Attribution policy change reason")).toHaveValue("Keep my reason");
  expect(mocks.post).toHaveBeenCalledTimes(1);
  mocks.get.mockResolvedValue({ ...optional, revision: "other", requireServicePerformers: true });
  await user.click(
    screen.getByRole("button", { name: "Reload attribution policy and discard draft" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "Require sellers" })).not.toBeChecked(),
  );
  expect(screen.getByRole("checkbox", { name: "Require service performers" })).toBeChecked();
  expect(screen.getByLabelText("Attribution policy change reason")).toHaveValue("");
});
it("pins the draft revision across background cache updates and blocks stale publishing", async () => {
  const client = mount();
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText("Attribution policy change reason"),
    "Reason-only edit pins revision",
  );
  act(() => {
    client.setQueryData(["commission-attribution-policy"], {
      ...optional,
      revision: "other",
      requireSellers: true,
    });
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("Reload and discard your draft");
  expect(screen.getByRole("checkbox", { name: "Require sellers" })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Publish attribution policy" })).toBeDisabled();
  expect(mocks.post).not.toHaveBeenCalled();
});
it("read-only mode displays policy without publishing controls", async () => {
  mount(false);
  expect(await screen.findByRole("checkbox", { name: "Require sellers" })).toBeDisabled();
  expect(screen.queryByLabelText("Attribution policy change reason")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Publish attribution policy" }),
  ).not.toBeInTheDocument();
});
it("does not treat a load failure as optional defaults and allows retry", async () => {
  mocks.get.mockRejectedValueOnce(new Error("Offline"));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "Reload attribution policy" }));
  expect(await screen.findByRole("checkbox", { name: "Require sellers" })).not.toBeChecked();
});
it("blocks controls during a publication and prevents duplicate submission", async () => {
  let finish!: (value: CommissionAttributionPolicyView) => void;
  mocks.post.mockImplementation(
    () =>
      new Promise<CommissionAttributionPolicyView>((resolve) => {
        finish = resolve;
      }),
  );
  mount();
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText("Attribution policy change reason"),
    "Required attribution",
  );
  const publish = screen.getByRole("button", { name: "Publish attribution policy" });
  await user.dblClick(publish);
  expect(mocks.post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("checkbox", { name: "Require sellers" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Reload attribution policy and discard draft" }),
  ).toBeDisabled();
  await act(async () => finish({ ...optional, revision: "saved" }));
  expect(await screen.findByText(/Attribution policy published/)).toBeInTheDocument();
});
it("retains draft flags and reason after a failed explicit reload", async () => {
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("checkbox", { name: "Require sellers" }));
  await user.type(screen.getByLabelText("Attribution policy change reason"), "Do not lose draft");
  mocks.get.mockRejectedValue(new Error("Reload failed"));
  await user.click(
    screen.getByRole("button", { name: "Reload attribution policy and discard draft" }),
  );
  expect(await screen.findByText("Reload failed")).toHaveAttribute("role", "alert");
  expect(screen.getByRole("checkbox", { name: "Require sellers" })).toBeChecked();
  expect(screen.getByLabelText("Attribution policy change reason")).toHaveValue(
    "Do not lose draft",
  );
  expect(screen.getByRole("button", { name: "Publish attribution policy" })).toBeDisabled();
  expect(mocks.post).not.toHaveBeenCalled();
});
it("follows refreshed policy when there is no unsaved draft", async () => {
  const client = mount();
  await screen.findByRole("checkbox", { name: "Require sellers" });
  act(() => {
    client.setQueryData(["commission-attribution-policy"], {
      ...optional,
      revision: "new",
      requireSellers: true,
    });
  });
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "Require sellers" })).toBeChecked(),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
