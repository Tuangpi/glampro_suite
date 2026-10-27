import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import StaffPayrollCreation from "./StaffPayrollCreation";

const { useQuery } = vi.hoisted(() => ({ useQuery: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery }));
const onChange = vi.fn();
const refetch = vi.fn();
const plan = {
  id: "company",
  name: "Company plan",
  archived: false,
  outletIds: [],
  versions: [{ status: "PUBLISHED" }],
};
beforeEach(() => {
  onChange.mockReset();
  refetch.mockReset();
  useQuery.mockReturnValue({
    data: {
      outletId: null,
      today: "2026-10-27",
      assignments: { revision: 7 },
      plans: [
        plan,
        { ...plan, id: "outlet", name: "Outlet plan", outletIds: ["branch"] },
        { ...plan, id: "archived", name: "Archived plan", archived: true },
        { ...plan, id: "draft", name: "Draft plan", versions: [{ status: "DRAFT" }] },
      ],
    },
    refetch,
  });
});
it("offers only published company plans and captures the assignment revision", async () => {
  const user = userEvent.setup();
  render(<StaffPayrollCreation value={null} onChange={onChange} />);
  expect(screen.queryByRole("option", { name: "Outlet plan" })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Archived plan" })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Draft plan" })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Initial payroll plan"), "company");
  expect(onChange).toHaveBeenLastCalledWith({
    planId: "company",
    expectedRevision: 7,
    fromDate: "2026-10-27",
    reason: "",
  });
  await user.click(screen.getByRole("button", { name: "Reload payroll plans" }));
  expect(onChange).toHaveBeenLastCalledWith(null);
  expect(refetch).toHaveBeenCalledOnce();
});
it("refuses outlet context", () => {
  useQuery.mockReturnValue({ data: { outletId: "branch" } });
  render(<StaffPayrollCreation value={null} onChange={onChange} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Switch to company context");
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});
it("reports loading and errors without offering a usable selection", () => {
  useQuery.mockReturnValue({ isPending: true });
  const view = render(<StaffPayrollCreation value={null} onChange={onChange} />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading");
  useQuery.mockReturnValue({ isError: true });
  view.rerender(<StaffPayrollCreation value={null} onChange={onChange} />);
  expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
});
