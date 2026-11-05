import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import StaffSecurityPolicyCard from "../settings/StaffSecurityPolicyCard";

const { mutateAsync, salon } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  salon: { data: { requireStaffTwoFactor: false }, isPending: false, isError: false },
}));

vi.mock("@/hooks/useSettings", () => ({
  useSalonProfile: () => salon,
  useUpdateSalonSecurityPolicy: () => ({ mutateAsync, isPending: salon.isPending }),
}));
vi.mock("@/lib/api", () => ({ getErrorMessage: () => "Policy could not be saved." }));

const SWITCH = "Require two-factor authentication for all staff";

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue({});
  salon.data.requireStaffTwoFactor = false;
  salon.isPending = false;
  salon.isError = false;
});

it("confirms before requiring a code of the whole team", async () => {
  const user = userEvent.setup();
  render(<StaffSecurityPolicyCard />);

  const control = screen.getByRole("switch", { name: SWITCH });
  expect(control).toHaveAttribute("aria-checked", "false");

  await user.click(control);
  // Nothing is saved until the owner confirms: this changes everyone's sign-in.
  expect(mutateAsync).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Require for all staff" }));
  expect(mutateAsync).toHaveBeenCalledWith({ requireStaffTwoFactor: true });
  expect(await screen.findByText(/All staff now answer an email code/)).toBeInTheDocument();
});

it("lifts the requirement without a confirmation step", async () => {
  salon.data.requireStaffTwoFactor = true;
  const user = userEvent.setup();
  render(<StaffSecurityPolicyCard />);

  await user.click(screen.getByRole("switch", { name: SWITCH }));

  expect(mutateAsync).toHaveBeenCalledWith({ requireStaffTwoFactor: false });
  expect(await screen.findByText(/Staff no longer need an email code/)).toBeInTheDocument();
});

it("reports a refused change and leaves the switch where the server has it", async () => {
  mutateAsync.mockRejectedValueOnce(new Error("forbidden"));
  const user = userEvent.setup();
  render(<StaffSecurityPolicyCard />);

  await user.click(screen.getByRole("switch", { name: SWITCH }));
  await user.click(screen.getByRole("button", { name: "Require for all staff" }));

  expect(await screen.findByText("Policy could not be saved.")).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: SWITCH })).toHaveAttribute("aria-checked", "false");
});
