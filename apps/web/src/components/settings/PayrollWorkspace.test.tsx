import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import userEvent from "@testing-library/user-event";
vi.mock("@/components/payroll/PayrollProgress", () => ({
  default: ({ period }: { period?: string }) => <div data-testid="progress" data-period={period} />,
}));

function mount(period?: string, entry = "/settings?section=payroll") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <PayrollWorkspace period={period} />
    </MemoryRouter>,
  );
}
const auth = vi.hoisted(() => ({
  role: "SUPER_ADMIN",
  readOnly: false,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { globalRole: auth.role }, isReadOnly: auth.readOnly }),
}));
vi.mock("./PayrollClose", () => ({
  default: ({
    canWrite,
    isOwner,
    initialPeriod,
  }: {
    canWrite: boolean;
    isOwner: boolean;
    initialPeriod?: string;
  }) => (
    <div
      data-testid="close"
      data-write={canWrite}
      data-owner={isOwner}
      data-period={initialPeriod}
    />
  ),
}));
import PayrollWorkspace from "./PayrollWorkspace";
beforeEach(() => {
  auth.role = "SUPER_ADMIN";
  auth.readOnly = false;
});
it("mounts owner and manager close with their actual write permissions", () => {
  const view = mount();
  expect(screen.getByTestId("close")).toHaveAttribute("data-owner", "true");
  auth.role = "MANAGER";
  auth.readOnly = true;
  view.rerender(
    <MemoryRouter>
      <PayrollWorkspace />
    </MemoryRouter>,
  );
  expect(screen.getByTestId("close")).toHaveAttribute("data-owner", "false");
  expect(screen.getByTestId("close")).toHaveAttribute("data-write", "false");
});
it.each(["STAFF", "CASHIER"])("does not mount or fetch payroll for %s", (role) => {
  auth.role = role;
  mount();
  expect(screen.queryByTestId("close")).not.toBeInTheDocument();
  expect(screen.getByText(/Only the owner or a manager/)).toBeInTheDocument();
});

it("passes valid linked months and ignores invalid months", () => {
  const view = mount("2026-09");
  expect(screen.getByTestId("close")).toHaveAttribute("data-period", "2026-09");
  view.rerender(
    <MemoryRouter>
      <PayrollWorkspace period="2026-13" />
    </MemoryRouter>,
  );
  expect(screen.getByTestId("close")).toHaveAttribute("data-period", "");
});

it("opens progress lazily and preserves the close panel when switching tabs", async () => {
  mount("2026-09", "/settings?section=payroll&payroll=progress");
  expect(screen.getByTestId("progress")).toHaveAttribute("data-period", "2026-09");
  expect(screen.queryByTestId("close")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("tab", { name: "Monthly close" }));
  expect(screen.getByTestId("close")).toBeVisible();
  await userEvent.click(screen.getByRole("tab", { name: "Commission progress" }));
  expect(screen.getByTestId("close")).not.toBeVisible();
  expect(screen.getByTestId("progress")).toBeVisible();
});
