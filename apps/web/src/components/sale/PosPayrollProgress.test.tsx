import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ role: "STAFF" }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "staff-a", globalRole: auth.role } }),
}));
vi.mock("@/components/payroll/PayrollProgress", () => ({
  default: ({ selfOnly, compact }: { selfOnly?: boolean; compact?: boolean }) => (
    <section
      aria-label="POS progress"
      data-self-only={String(selfOnly)}
      data-compact={String(compact)}
    />
  ),
}));

const { default: PosPayrollProgress } = await import("./PosPayrollProgress");

beforeEach(() => {
  auth.role = "STAFF";
});

it("shows the operator's own progress on the till", () => {
  render(<PosPayrollProgress />);
  const panel = screen.getByLabelText("POS progress");
  expect(panel).toHaveAttribute("data-self-only", "true");
  expect(panel).toHaveAttribute("data-compact", "true");
});

it("renders nothing for a cashier, who holds no commission statement", () => {
  auth.role = "CASHIER";
  render(<PosPayrollProgress />);
  expect(screen.queryByLabelText("POS progress")).not.toBeInTheDocument();
});

it("renders for an owner, whose own statement the API still narrows to one line", () => {
  auth.role = "SUPER_ADMIN";
  render(<PosPayrollProgress />);
  expect(screen.getByLabelText("POS progress")).toHaveAttribute("data-self-only", "true");
});
