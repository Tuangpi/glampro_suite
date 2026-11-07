import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Departments from "../Departments";

const { auth, list, mutateAsync, mutation } = vi.hoisted(() => ({
  auth: { user: { globalRole: "MANAGER" }, isReadOnly: false },
  list: {
    data: [{ id: "hair", name: "Hair" }],
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  },
  mutateAsync: vi.fn(),
  mutation: { isPending: false },
}));
const { impact, remove } = vi.hoisted(() => ({
  impact: {
    data: {
      id: "hair",
      name: "Hair",
      products: 2,
      services: 3,
      staff: 4,
      customers: 5,
      commissionRules: 0,
    },
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  },
  remove: { mutateAsync: vi.fn(), isPending: false },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useDepartments", () => ({
  useDepartments: () => list,
  useSaveDepartment: () => ({ mutateAsync, ...mutation }),
  useDepartmentDeletionImpact: () => impact,
  useDeleteDepartment: () => remove,
}));
vi.mock("@/components/ui/toast-store", () => ({ showToast: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  auth.user.globalRole = "MANAGER";
  auth.isReadOnly = false;
  list.data = [{ id: "hair", name: "Hair" }];
  list.isPending = false;
  list.isError = false;
  mutation.isPending = false;
  mutateAsync.mockResolvedValue({ id: "new", name: "Nails" });
  impact.data.commissionRules = 0;
  impact.isPending = false;
  impact.isFetching = false;
  impact.isError = false;
  remove.isPending = false;
  remove.mutateAsync.mockReset().mockResolvedValue(impact.data);
});

describe("Departments", () => {
  it("creates a department with a trimmed name and closes the drawer", async () => {
    const user = userEvent.setup();
    render(<Departments />);
    await user.click(screen.getByRole("button", { name: "Add department" }));
    await user.type(screen.getByLabelText("Department name"), "  Nails  ");
    await user.click(screen.getByRole("button", { name: "Save department" }));
    expect(mutateAsync).toHaveBeenCalledWith({ id: undefined, input: { name: "Nails" } });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("renames an existing department without changing its id", async () => {
    const user = userEvent.setup();
    render(<Departments />);
    await user.click(screen.getByRole("button", { name: "Rename Hair" }));
    await user.clear(screen.getByLabelText("Department name"));
    await user.type(screen.getByLabelText("Department name"), "Beauty");
    await user.click(screen.getByRole("button", { name: "Save department" }));
    expect(mutateAsync).toHaveBeenCalledWith({ id: "hair", input: { name: "Beauty" } });
  });

  it("rejects blank names without sending a request", async () => {
    const user = userEvent.setup();
    render(<Departments />);
    await user.click(screen.getByRole("button", { name: "Add department" }));
    await user.click(screen.getByRole("button", { name: "Save department" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a department name.");
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("keeps the draft when saving fails", async () => {
    mutateAsync.mockRejectedValue(new Error("Save failed"));
    const user = userEvent.setup();
    render(<Departments />);
    await user.click(screen.getByRole("button", { name: "Add department" }));
    await user.type(screen.getByLabelText("Department name"), "Nails");
    await user.click(screen.getByRole("button", { name: "Save department" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByLabelText("Department name")).toHaveValue("Nails");
  });

  it("blocks management for staff even on direct navigation", () => {
    auth.user.globalRole = "STAFF";
    render(<Departments />);
    expect(screen.getByRole("alert")).toHaveTextContent("Only salon admins and managers");
    expect(screen.queryByRole("button", { name: "Add department" })).not.toBeInTheDocument();
  });

  it("disables changes for a read-only salon", () => {
    auth.isReadOnly = true;
    render(<Departments />);
    expect(screen.getByRole("button", { name: "Add department" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rename Hair" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete Hair" })).toBeDisabled();
  });

  it("shows an empty state", () => {
    list.data = [];
    render(<Departments />);
    expect(screen.getByText(/No departments yet/)).toBeVisible();
  });

  it("shows affected counts and only deletes after confirmation", async () => {
    const user = userEvent.setup();
    render(<Departments />);
    await user.click(screen.getByRole("button", { name: "Delete Hair" }));
    expect(remove.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText("2 products")).toBeVisible();
    expect(screen.getByText("3 services")).toBeVisible();
    expect(screen.getByText("4 staff members")).toBeVisible();
    expect(screen.getByText("5 customers")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Delete and unassign" }));
    expect(remove.mutateAsync).toHaveBeenCalledWith("hair");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("blocks deletion for commission references and allows cancellation", async () => {
    impact.data.commissionRules = 1;
    const user = userEvent.setup();
    render(<Departments />);
    await user.click(screen.getByRole("button", { name: "Delete Hair" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Deletion blocked");
    expect(screen.getByRole("button", { name: "Delete and unassign" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(remove.mutateAsync).not.toHaveBeenCalled();
  });

  it("fails closed if impact cannot be loaded", async () => {
    impact.isError = true;
    const user = userEvent.setup();
    render(<Departments />);
    await user.click(screen.getByRole("button", { name: "Delete Hair" }));
    expect(screen.getByRole("button", { name: "Delete and unassign" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Retry impact check" }));
    expect(impact.refetch).toHaveBeenCalled();
  });

  it("waits for impact counts before enabling deletion", async () => {
    impact.isPending = true;
    const user = userEvent.setup();
    render(<Departments />);
    await user.click(screen.getByRole("button", { name: "Delete Hair" }));
    expect(screen.getByRole("status")).toHaveTextContent("Checking related records");
    expect(screen.getByRole("button", { name: "Delete and unassign" })).toBeDisabled();
    // Real queries have no data while pending; also prevent acting on a refetch.
    expect(remove.mutateAsync).not.toHaveBeenCalled();
  });

  it("keeps confirmation open on a server refusal and refreshes impact", async () => {
    remove.mutateAsync.mockRejectedValue(new Error("Blocked"));
    const user = userEvent.setup();
    render(<Departments />);
    await user.click(screen.getByRole("button", { name: "Delete Hair" }));
    await user.click(screen.getByRole("button", { name: "Delete and unassign" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(impact.refetch).toHaveBeenCalled();
  });

  it("shows loading and retryable errors", async () => {
    list.isPending = true;
    const { rerender } = render(<Departments />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading departments");
    list.isPending = false;
    list.isError = true;
    rerender(<Departments />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(list.refetch).toHaveBeenCalled();
  });
});
