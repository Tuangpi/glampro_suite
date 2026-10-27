import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { CommissionConfiguration } from "@glampro_suite/shared";
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({
  get: mocks.get,
  post: mocks.post,
  getErrorMessage: (e: Error) => e.message,
}));
vi.mock("@/hooks/useDepartments", () => ({
  useDepartments: () => ({ data: [{ id: "skin", name: "Skin" }] }),
}));
import CommissionRules from "./CommissionRules";

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
  vi.clearAllMocks();
  mocks.get.mockImplementation((url: string) =>
    Promise.resolve(
      url.endsWith("options") ? { items: [{ id: "facial", name: "Facial" }], total: 70 } : config,
    ),
  );
  mocks.post.mockImplementation((url: string) =>
    Promise.resolve(
      url.endsWith("preview")
        ? { rate: "12.00", source: "DEPARTMENT", ruleId: "rule-1" }
        : { id: "rev-2" },
    ),
  );
});
function mount(staffId?: string, canEdit = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CommissionRules staffId={staffId} canEdit={canEdit} />
    </QueryClientProvider>,
  );
  return client;
}
it("publishes company defaults with revision, reason and immediate effective time", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByText("No published rules.");
  await user.selectOptions(screen.getByLabelText("Commission item type"), "PRODUCT");
  await user.clear(screen.getByLabelText("Commission percentage"));
  await user.type(screen.getByLabelText("Commission percentage"), "5");
  await user.type(screen.getByLabelText("Commission change reason"), "Retail policy");
  await user.click(screen.getByRole("button", { name: "Publish commission rule" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith("/commissions", {
      staffId: null,
      itemKind: "PRODUCT",
      scope: "COMPANY",
      targetId: null,
      rate: 5,
      reason: "Retail policy",
      expectedRevision: "rev-1",
    }),
  );
  expect(await screen.findByText(/Commission rule published/)).toBeInTheDocument();
});
it("publishes package overrides without activating earnings", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByText("No published rules.");
  await user.selectOptions(screen.getByLabelText("Commission item type"), "PACKAGE_REDEMPTION");
  await user.selectOptions(screen.getByLabelText("Rule scope"), "PACKAGE");
  await user.selectOptions(await screen.findByLabelText("Commission item"), "facial");
  await user.selectOptions(screen.getByLabelText("Rate behavior"), "inherit");
  await user.type(screen.getByLabelText("Commission change reason"), "Remove override");
  await user.click(screen.getByRole("button", { name: "Publish commission rule" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith(
      "/commissions",
      expect.objectContaining({
        scope: "PACKAGE",
        itemKind: "PACKAGE_REDEMPTION",
        staffId: null,
        targetId: "facial",
        rate: null,
        expectedRevision: "rev-1",
      }),
    ),
  );
  expect(screen.getByText(/New kinds remain disabled/)).toBeInTheDocument();
});
it("does not silently rebase single-rule drafts on a refreshed revision", async () => {
  const client = mount();
  const user = userEvent.setup();
  await screen.findByText("No published rules.");
  await user.type(screen.getByLabelText("Commission change reason"), "Pinned reason");
  act(() => client.setQueryData(["commissions", "company", 1], { ...config, revision: "new" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("changed");
  expect(screen.getByLabelText("Commission change reason")).toHaveValue("Pinned reason");
  expect(screen.getByLabelText("Commission change reason")).toBeDisabled();
  expect(mocks.post).not.toHaveBeenCalled();
});
it("distinguishes explicit zero from inheritance and previews the applied source", async () => {
  mount("amy");
  const user = userEvent.setup();
  await screen.findByText(/Legacy service fallback/);
  expect(screen.getByText(/Showing first 1 of 70/)).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Rule scope"), "ITEM");
  await user.selectOptions(screen.getByLabelText("Commission item"), "facial");
  await user.type(screen.getByLabelText("Commission change reason"), "Explicit zero");
  await user.click(screen.getByRole("button", { name: "Publish commission rule" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith(
      "/commissions",
      expect.objectContaining({ rate: 0, targetId: "facial", staffId: "amy" }),
    ),
  );
  await screen.findByText(/Commission rule published/);
  await user.selectOptions(screen.getByLabelText("Rate behavior"), "inherit");
  expect(screen.queryByLabelText("Commission percentage")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Commission change reason"), "Use department");
  await user.click(screen.getByRole("button", { name: "Publish commission rule" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith(
      "/commissions",
      expect.objectContaining({ rate: null }),
    ),
  );
  await user.selectOptions(screen.getByLabelText("Preview commission for item"), "facial");
  expect(
    await screen.findByText(/Current applied rate: 12.00% · Source: DEPARTMENT/),
  ).toBeInTheDocument();
});
it("read-only mode hides mutation controls but retains rule history", async () => {
  mount("amy", false);
  await screen.findByText(/Legacy service fallback/);
  expect(screen.queryByRole("button", { name: "Publish commission rule" })).not.toBeInTheDocument();
  expect(screen.getByText("Publication history")).toBeInTheDocument();
});
it("preserves a failed publication draft and displays the conflict", async () => {
  mocks.post.mockRejectedValue(new Error("Commission settings changed. Reload before publishing."));
  mount();
  const user = userEvent.setup();
  await screen.findByText("No published rules.");
  await user.type(screen.getByLabelText("Commission change reason"), "Keep my draft");
  await user.click(screen.getByRole("button", { name: "Publish commission rule" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Commission settings changed");
  expect(screen.getByLabelText("Commission change reason")).toHaveValue("Keep my draft");
  expect(screen.queryByText(/Commission rule published/)).not.toBeInTheDocument();
});
