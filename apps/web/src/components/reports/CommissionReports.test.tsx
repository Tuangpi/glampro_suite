import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import CommissionDetailPanel from "./CommissionDetailPanel";
import PackageUtilisationPanel from "./PackageUtilisationPanel";

const mocks = vi.hoisted(() => ({ get: vi.fn(), downloadFile: vi.fn() }));
vi.mock("@/lib/api", () => ({ ...mocks, getErrorMessage: (error: Error) => error.message }));
function mount(component: React.ReactNode) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {component}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
});
it("shows no approved snapshot without presenting zero earnings", async () => {
  mocks.get.mockResolvedValue({ approved: false, rows: [], total: 0, pages: 0, page: 1 });
  mount(<CommissionDetailPanel />);
  expect(
    await screen.findByText("No approved payroll snapshot for this month."),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Export commission detail/ })).toBeDisabled();
});
it("passes the same filters to the detail query and Excel export", async () => {
  mocks.get.mockResolvedValue({ approved: true, rows: [], total: 0, pages: 0, page: 1 });
  mount(<CommissionDetailPanel />);
  await screen.findByText(/0 matching base lines/);
  fireEvent.change(screen.getByLabelText("Customer ID"), { target: { value: "customer" } });
  await waitFor(() =>
    expect(mocks.get).toHaveBeenLastCalledWith(
      "/payroll-close/commission-detail",
      expect.objectContaining({ customerId: "customer", page: 1 }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Export commission detail/ })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: /Export commission detail/ }));
  await waitFor(() =>
    expect(mocks.downloadFile).toHaveBeenCalledWith(
      "/payroll-close/commission-detail.xlsx",
      expect.objectContaining({ customerId: "customer", page: 1 }),
    ),
  );
});
it("keeps pack counts distinct from session counts", async () => {
  mocks.get.mockResolvedValue({
    asOf: "2026-11-06T00:00:00Z",
    rows: [
      {
        id: "pkg",
        name: "Facial pack",
        packsSold: 2,
        sessionsRedeemed: 7,
        sessionsExpiredUnused: 3,
      },
    ],
  });
  mount(<PackageUtilisationPanel />);
  expect(await screen.findByRole("cell", { name: "Facial pack" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Packs sold" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Sessions redeemed" })).toBeInTheDocument();
  expect(screen.getByText(/not a balancing equation/)).toBeInTheDocument();
});
it("shows a failed utilisation query as unavailable, not zero", async () => {
  mocks.get.mockRejectedValue(new Error("Report unavailable"));
  mount(<PackageUtilisationPanel />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Report unavailable");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
it("sends the cross-month bound to both detail and export", async () => {
  mocks.get.mockResolvedValue({ approved: true, rows: [], total: 0, pages: 0, page: 1 });
  mount(<CommissionDetailPanel />);
  await screen.findByText(/0 matching base lines/);
  fireEvent.change(screen.getByLabelText("Through payroll month (optional)"), {
    target: { value: "2026-12" },
  });
  await waitFor(() =>
    expect(mocks.get).toHaveBeenLastCalledWith(
      "/payroll-close/commission-detail",
      expect.objectContaining({ throughPeriod: "2026-12" }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Export commission detail/ })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: /Export commission detail/ }));
  await waitFor(() =>
    expect(mocks.downloadFile).toHaveBeenCalledWith(
      "/payroll-close/commission-detail.xlsx",
      expect.objectContaining({ throughPeriod: "2026-12" }),
    ),
  );
});
it("names even a single unavailable month and refuses a partial range export", async () => {
  mocks.get.mockResolvedValue({
    approved: false,
    unavailablePeriods: ["2026-10"],
    rows: [],
    total: 0,
    pages: 0,
    page: 1,
  });
  mount(<CommissionDetailPanel />);
  expect(await screen.findByText(/Unavailable months: 2026-10/)).toHaveTextContent(
    "The range is not partially exported",
  );
  expect(screen.getByRole("button", { name: /Export commission detail/ })).toBeDisabled();
});
