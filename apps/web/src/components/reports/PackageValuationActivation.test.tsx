import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import PackageValuationActivation from "./PackageValuationActivation";

const { useAuth, useActivatePackageValuation, mutate } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useActivatePackageValuation: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth }));
vi.mock("@/hooks/useReports", () => ({ useActivatePackageValuation }));
vi.mock("@/lib/api", () => ({ getErrorMessage: () => "Request failed" }));
beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ user: { globalRole: "MANAGER" }, isReadOnly: false });
  useActivatePackageValuation.mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
    isSuccess: false,
  });
});

it.each(["STAFF", "RECEPTIONIST"])("hides activation for %s", (globalRole) => {
  useAuth.mockReturnValue({ user: { globalRole }, isReadOnly: false });
  render(<PackageValuationActivation />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("hides activation for a read-only manager", () => {
  useAuth.mockReturnValue({ user: { globalRole: "MANAGER" }, isReadOnly: true });
  render(<PackageValuationActivation />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it.each(["MANAGER", "SUPER_ADMIN"])(
  "requires a reason and explicit policy/currency confirmation for %s",
  async (globalRole) => {
    useAuth.mockReturnValue({ user: { globalRole }, isReadOnly: false });
    const user = userEvent.setup();
    render(<PackageValuationActivation />);
    expect(screen.getByText(/cannot be edited or undone/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Activate package valuation" });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("Activation reason"), "  Approved SGD purchases  ");
    expect(button).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(button);
    expect(mutate).toHaveBeenCalledExactlyOnceWith({
      policyVersion: 1,
      currency: "SGD",
      reason: "Approved SGD purchases",
      confirmed: true,
    });
  },
);

it("locks confirmation while pending and avoids repeated submissions", () => {
  useActivatePackageValuation.mockReturnValue({ mutate, isPending: true });
  render(<PackageValuationActivation />);
  expect(screen.getByLabelText("Activation reason")).toBeDisabled();
  expect(screen.getByRole("checkbox")).toBeDisabled();
  expect(screen.getByRole("button")).toBeDisabled();
});

it("explains uncertain failure and shows recorded success without another control", () => {
  useActivatePackageValuation.mockReturnValue({ mutate, isError: true, error: new Error("lost") });
  const { rerender } = render(<PackageValuationActivation />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Refresh to check whether it was recorded before retrying",
  );
  useActivatePackageValuation.mockReturnValue({ mutate, isSuccess: true });
  rerender(<PackageValuationActivation />);
  expect(screen.getByRole("status")).toHaveTextContent("Activation recorded");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
