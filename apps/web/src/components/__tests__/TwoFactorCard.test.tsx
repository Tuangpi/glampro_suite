import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import TwoFactorCard from "../TwoFactorCard";

const { post, auth, salon } = vi.hoisted(() => ({
  post: vi.fn(),
  auth: {
    user: { globalRole: "STAFF", twoFactorEnabled: false } as {
      globalRole: string;
      twoFactorEnabled: boolean;
    },
    refreshProfile: vi.fn(),
  },
  /** The salon's policy, which the card reads from `GET /settings/profile`. */
  salon: { policy: false, isError: false },
}));

vi.mock("@/lib/api", () => ({
  post,
  getErrorMessage: () => "Could not verify the code.",
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useSettings", () => ({
  useSalonProfile: () => ({
    data: { requireStaffTwoFactor: salon.policy },
    isError: salon.isError,
  }),
}));

const SWITCH = "Email verification code at sign-in";

beforeEach(() => {
  post.mockReset().mockResolvedValue({ sent: true });
  auth.user.globalRole = "STAFF";
  auth.user.twoFactorEnabled = false;
  auth.refreshProfile.mockReset();
  salon.policy = false;
  salon.isError = false;
});

it("turns the second factor on by sending, then confirming, an email code", async () => {
  const user = userEvent.setup();
  render(<TwoFactorCard />);

  const control = screen.getByRole("switch", { name: SWITCH });
  expect(control).toHaveAttribute("aria-checked", "false");

  await user.click(control);
  expect(post).toHaveBeenCalledWith("/auth/two-factor/enable", {});
  // Nothing is claimed until the code is answered: the switch is still off.
  expect(control).toHaveAttribute("aria-checked", "false");

  await user.type(screen.getByLabelText("Verification code"), "012345");
  await user.click(screen.getByRole("button", { name: "Verify and turn on" }));
  expect(post).toHaveBeenCalledWith("/auth/two-factor/confirm", { code: "012345" });
  expect(auth.refreshProfile).toHaveBeenCalled();
  expect(await screen.findByText(/Two-factor authentication is on/)).toBeInTheDocument();
});

it("turns the second factor off only after the confirmation is answered", async () => {
  auth.user.twoFactorEnabled = true;
  const user = userEvent.setup();
  render(<TwoFactorCard />);

  const control = screen.getByRole("switch", { name: SWITCH });
  expect(control).toHaveAttribute("aria-checked", "true");

  await user.click(control);
  expect(post).not.toHaveBeenCalledWith("/auth/two-factor/disable", {});

  await user.click(screen.getByRole("button", { name: "Turn off email verification" }));
  expect(post).toHaveBeenCalledWith("/auth/two-factor/disable", {});
  expect(auth.refreshProfile).toHaveBeenCalled();
  expect(await screen.findByText(/Two-factor authentication is off/)).toBeInTheDocument();
});

it("keeps a salon-required second factor on and says who can change it", () => {
  auth.user.twoFactorEnabled = true;
  salon.policy = true;
  render(<TwoFactorCard />);

  const control = screen.getByRole("switch", { name: SWITCH });
  expect(control).toHaveAttribute("aria-checked", "true");
  // The API refuses this, so the screen does not offer it.
  expect(control).toBeDisabled();
  expect(screen.getByText("Required by your salon")).toBeInTheDocument();
  expect(screen.getByText(/The owner can lift the requirement/)).toBeInTheDocument();
});

it("lets an owner turn their own factor off and says what still needs one", async () => {
  auth.user.globalRole = "SUPER_ADMIN";
  auth.user.twoFactorEnabled = true;
  const user = userEvent.setup();
  render(<TwoFactorCard />);

  const control = screen.getByRole("switch", { name: SWITCH });
  expect(control).toHaveAttribute("aria-checked", "true");
  // The owner's switch is theirs: nothing in the UI or the API holds it on.
  expect(control).not.toBeDisabled();
  expect(screen.getByText(/screens that move money/)).toBeVisible();

  await user.click(control);
  await user.click(screen.getByRole("button", { name: "Turn off email verification" }));
  expect(post).toHaveBeenCalledWith("/auth/two-factor/disable", {});
  expect(auth.refreshProfile).toHaveBeenCalled();
  expect(await screen.findByText(/Two-factor authentication is off/)).toBeInTheDocument();
});

it("does not put an owner's switch under the salon's staff policy", () => {
  auth.user.globalRole = "SUPER_ADMIN";
  auth.user.twoFactorEnabled = true;
  salon.policy = true;
  render(<TwoFactorCard />);

  // The policy is a staff rule, so the owner keeps a live switch and sees no
  // "required by your salon" badge telling them otherwise.
  expect(screen.getByRole("switch", { name: SWITCH })).not.toBeDisabled();
  expect(screen.queryByText("Required by your salon")).not.toBeInTheDocument();
});

it("reports a failed enrollment without opening the code dialog", async () => {
  post.mockRejectedValueOnce(new Error("SMTP unavailable"));
  const user = userEvent.setup();
  render(<TwoFactorCard />);

  await user.click(screen.getByRole("switch", { name: SWITCH }));

  expect(await screen.findByText("Could not verify the code.")).toBeInTheDocument();
  expect(screen.queryByLabelText("Verification code")).not.toBeInTheDocument();
});

it("keeps the enrollment dialog open when the code is refused", async () => {
  const user = userEvent.setup();
  render(<TwoFactorCard />);

  await user.click(screen.getByRole("switch", { name: SWITCH }));
  post.mockRejectedValueOnce(new Error("bad code"));
  await user.type(screen.getByLabelText("Verification code"), "000000");
  await user.click(screen.getByRole("button", { name: "Verify and turn on" }));

  expect(await screen.findByText("Could not verify the code.")).toBeInTheDocument();
  expect(screen.getByLabelText("Verification code")).toBeInTheDocument();
  expect(auth.refreshProfile).not.toHaveBeenCalled();
});
