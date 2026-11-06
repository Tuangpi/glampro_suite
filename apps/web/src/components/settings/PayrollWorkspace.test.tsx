import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({
  role: "SUPER_ADMIN",
  readOnly: false,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { globalRole: auth.role }, isReadOnly: auth.readOnly }),
}));
vi.mock("./PayrollClose", () => ({
  default: ({ canWrite, isOwner }: { canWrite: boolean; isOwner: boolean }) => (
    <div data-testid="close" data-write={canWrite} data-owner={isOwner} />
  ),
}));
import PayrollWorkspace from "./PayrollWorkspace";
beforeEach(() => {
  auth.role = "SUPER_ADMIN";
  auth.readOnly = false;
});
it("mounts owner and manager close with their actual write permissions", () => {
  const view = render(<PayrollWorkspace />);
  expect(screen.getByTestId("close")).toHaveAttribute("data-owner", "true");
  auth.role = "MANAGER";
  auth.readOnly = true;
  view.rerender(<PayrollWorkspace />);
  expect(screen.getByTestId("close")).toHaveAttribute("data-owner", "false");
  expect(screen.getByTestId("close")).toHaveAttribute("data-write", "false");
});
it.each(["STAFF", "CASHIER"])("does not mount or fetch payroll for %s", (role) => {
  auth.role = role;
  render(<PayrollWorkspace />);
  expect(screen.queryByTestId("close")).not.toBeInTheDocument();
  expect(screen.getByText(/Only the owner or a manager/)).toBeInTheDocument();
});
