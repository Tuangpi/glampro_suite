import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { CustomerDetail } from "@glampro_suite/shared";
import CustomerArchivePanel from "./CustomerArchivePanel";

const mocks = vi.hoisted(() => ({
  archive: vi.fn(),
  role: "MANAGER",
  readOnly: false,
  pending: false,
}));
vi.mock("@/hooks/useCustomers", () => ({
  useArchiveCustomer: () => ({ mutateAsync: mocks.archive, isPending: mocks.pending }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { globalRole: mocks.role }, isReadOnly: mocks.readOnly }),
}));
const customer = { id: "c1", name: "Mina", archivedAt: null } as CustomerDetail;
const panel = () => <CustomerArchivePanel customer={customer} />;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.role = "MANAGER";
  mocks.readOnly = false;
  mocks.pending = false;
  mocks.archive.mockResolvedValue({
    ...customer,
    archivedAt: "2026-10-22T01:00:00Z",
    archivedById: "manager1",
    archiveReason: "No further visits",
  });
});

it("requires an explicit reason and confirmation, then shows the returned archive evidence", async () => {
  render(panel());
  await userEvent.click(screen.getByRole("button", { name: "Archive customer" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Evidence and balances will not be erased");
  expect(screen.getByRole("button", { name: "Confirm archive" })).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Archive reason"), " No further visits ");
  expect(mocks.archive).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
  expect(mocks.archive).toHaveBeenCalledWith({ id: "c1", input: { reason: "No further visits" } });
  expect(await screen.findByRole("status")).toHaveTextContent("manager1");
  expect(screen.queryByRole("button", { name: "Archive customer" })).not.toBeInTheDocument();
});

it("preserves a refused archive draft for retry", async () => {
  mocks.archive.mockRejectedValueOnce(new Error("Archive refused"));
  render(panel());
  await userEvent.click(screen.getByRole("button", { name: "Archive customer" }));
  await userEvent.type(screen.getByLabelText("Archive reason"), "No further visits");
  await userEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Archive refused");
  expect(screen.getByLabelText("Archive reason")).toHaveValue("No further visits");
  await userEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Archived");
});

it("cancels without writing", async () => {
  render(panel());
  await userEvent.click(screen.getByRole("button", { name: "Archive customer" }));
  await userEvent.click(screen.getByRole("button", { name: "Cancel archival" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(mocks.archive).not.toHaveBeenCalled();
});

it.each(["STAFF", "CASHIER"])("blocks archival for %s", (role) => {
  mocks.role = role;
  render(panel());
  expect(screen.getByRole("button", { name: "Archive customer" })).toBeDisabled();
});

it("closes confirmation on role loss and blocks read-only users", async () => {
  const view = render(panel());
  await userEvent.click(screen.getByRole("button", { name: "Archive customer" }));
  mocks.role = "STAFF";
  view.rerender(panel());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  mocks.role = "SUPER_ADMIN";
  mocks.readOnly = true;
  view.rerender(panel());
  expect(screen.getByRole("button", { name: "Archive customer" })).toBeDisabled();
  expect(mocks.archive).not.toHaveBeenCalled();
});

it("shows existing archive evidence to read-only staff without permitting another archival", () => {
  mocks.readOnly = true;
  mocks.role = "STAFF";
  render(
    <CustomerArchivePanel
      customer={{
        ...customer,
        archivedAt: "2026-10-22T01:00:00Z",
        archivedById: "owner1",
        archiveReason: "Retained",
      }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("owner1");
  expect(screen.getByRole("status")).toHaveTextContent("Retained");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("blocks confirmation while refreshing or submitting", async () => {
  const view = render(panel());
  await userEvent.click(screen.getByRole("button", { name: "Archive customer" }));
  await userEvent.type(screen.getByLabelText("Archive reason"), "Retain evidence");
  view.rerender(<CustomerArchivePanel customer={customer} refreshing />);
  expect(screen.getByRole("button", { name: "Confirm archive" })).toBeDisabled();
  mocks.pending = true;
  view.rerender(panel());
  expect(screen.getByRole("button", { name: "Confirm archive" })).toBeDisabled();
});
