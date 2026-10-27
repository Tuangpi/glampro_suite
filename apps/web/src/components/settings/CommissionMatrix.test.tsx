import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { commissionKindSchema, type CommissionMatrix as MatrixView } from "@glampro_suite/shared";
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({
  get: mocks.get,
  post: mocks.post,
  getErrorMessage: (e: Error) => e.message,
}));
import CommissionMatrix from "./CommissionMatrix";
const matrix: MatrixView = {
  revision: "rev-1",
  page: 1,
  total: 21,
  rows: [
    {
      staffId: "amy",
      name: "Amy",
      cells: commissionKindSchema.options.map((itemKind) => ({
        itemKind,
        configured: false,
        configuredRate: null,
        rate: "0",
        source: "NONE",
      })),
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue(matrix);
  mocks.post.mockResolvedValue({ revision: "rev-2" });
});
function mount(canEdit = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CommissionMatrix canEdit={canEdit} />
    </QueryClientProvider>,
  );
  return client;
}
it("shows all kinds without conflating unconfigured rates with zero", async () => {
  mount();
  expect(await screen.findByLabelText("Amy: Package sales")).toHaveValue("");
  expect(screen.getByText(/Blank means unconfigured/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Publish staff commission defaults" })).toBeDisabled();
});
it("atomically publishes explicit zero and inheritance with revision and reason", async () => {
  mount();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Amy: Package sales"), "0");
  await user.type(screen.getByLabelText("Amy: Package redemptions"), "inherit");
  await user.type(screen.getByLabelText("Bulk commission change reason"), "Split policy");
  expect(screen.getByRole("button", { name: "Next commission staff" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Publish staff commission defaults" }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith("/commissions/bulk", {
      expectedRevision: "rev-1",
      reason: "Split policy",
      rules: [
        { staffId: "amy", itemKind: "PACKAGE_SALE", scope: "STAFF", targetId: null, rate: 0 },
        {
          staffId: "amy",
          itemKind: "PACKAGE_REDEMPTION",
          scope: "STAFF",
          targetId: null,
          rate: null,
        },
      ],
    }),
  );
  expect(await screen.findByText(/published atomically/)).toBeInTheDocument();
});
it("pins draft revisions across refetch and requires explicit reload", async () => {
  const client = mount();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Amy: Package sales"), "15");
  await user.type(screen.getByLabelText("Bulk commission change reason"), "Preserve draft");
  act(() =>
    client.setQueryData(["commissions", "matrix", 1, ""], { ...matrix, revision: "rev-new" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("changed");
  expect(screen.getByLabelText("Amy: Package sales")).toHaveValue("15");
  expect(screen.getByLabelText("Amy: Package sales")).toBeDisabled();
  mocks.get.mockResolvedValue({ ...matrix, revision: "rev-new" });
  await user.click(
    screen.getByRole("button", { name: "Reload commission matrix and discard draft" }),
  );
  await waitFor(() => expect(screen.getByLabelText("Amy: Package sales")).toHaveValue(""));
  expect(mocks.post).not.toHaveBeenCalled();
});
it("preserves draft after rejected publication or reload", async () => {
  mount();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Amy: Package sales"), "10");
  await user.type(screen.getByLabelText("Bulk commission change reason"), "Keep this");
  mocks.post.mockRejectedValue(new Error("Stale revision"));
  await user.click(screen.getByRole("button", { name: "Publish staff commission defaults" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Stale revision");
  mocks.get.mockRejectedValue(new Error("Offline"));
  await user.click(
    screen.getByRole("button", { name: "Reload commission matrix and discard draft" }),
  );
  expect(await screen.findByText("Offline")).toBeInTheDocument();
  expect(screen.getByLabelText("Amy: Package sales")).toHaveValue("10");
  expect(screen.getByLabelText("Bulk commission change reason")).toHaveValue("Keep this");
});
it("read-only mode permits reads and pagination but not publication", async () => {
  mount(false);
  const user = userEvent.setup();
  expect(await screen.findByLabelText("Amy: Package sales")).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Publish staff commission defaults" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next commission staff" }));
  await waitFor(() =>
    expect(mocks.get).toHaveBeenCalledWith("/commissions/matrix", { page: 2, search: "" }),
  );
});
it("blocks invalid percentages before sending", async () => {
  mount();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Amy: Package sales"), "101");
  await user.type(screen.getByLabelText("Bulk commission change reason"), "Invalid draft");
  await user.click(screen.getByRole("button", { name: "Publish staff commission defaults" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Check rates");
  expect(mocks.post).not.toHaveBeenCalled();
});
it("does not show load failures as an empty matrix", async () => {
  mocks.get.mockRejectedValue(new Error("Offline"));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load");
  expect(screen.queryByLabelText("Amy: Package sales")).not.toBeInTheDocument();
});
it("blocks duplicate submission and edited controls while publishing", async () => {
  let finish!: (value: object) => void;
  mocks.post.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mount();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Amy: Package sales"), "10");
  await user.type(screen.getByLabelText("Bulk commission change reason"), "Pending publication");
  await user.dblClick(screen.getByRole("button", { name: "Publish staff commission defaults" }));
  expect(mocks.post).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Amy: Package sales")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Reload commission matrix and discard draft" }),
  ).toBeDisabled();
  await act(async () => finish({ revision: "saved" }));
  expect(await screen.findByText(/published atomically/)).toBeInTheDocument();
});
