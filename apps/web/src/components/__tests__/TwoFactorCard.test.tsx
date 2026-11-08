import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import TwoFactorCard from "../TwoFactorCard";

const { post, auth, salon, showToast } = vi.hoisted(() => ({
  post: vi.fn(),
  showToast: vi.fn(),
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
vi.mock("@/components/ui/toast-store", () => ({ showToast }));
vi.mock("@/hooks/useSettings", () => ({
  useSalonProfile: () => ({
    data: { requireStaffTwoFactor: salon.policy },
    isError: salon.isError,
  }),
}));

const SWITCH = "Email verification code at sign-in";

beforeEach(() => {
  post.mockReset().mockResolvedValue({ sent: true });
  showToast.mockReset();
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
it("offers the Pay plans return action only after account verification is enabled", async () => {
  const onReturn = vi.fn();
  const user = userEvent.setup();
  const { rerender } = render(<TwoFactorCard onReturnToPayPlans={onReturn} />);
  expect(screen.queryByRole("button", { name: "Back to Pay plans" })).not.toBeInTheDocument();
  auth.user.twoFactorEnabled = true;
  rerender(<TwoFactorCard onReturnToPayPlans={onReturn} />);
  await user.click(screen.getByRole("button", { name: "Back to Pay plans" }));
  expect(onReturn).toHaveBeenCalledOnce();
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
  expect(
    screen.getByText(/Required for pay plans and other protected owner actions/),
  ).toBeVisible();

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

it("keeps a failed send in the dialog and allows retrying", async () => {
  post.mockRejectedValueOnce(new Error("SMTP unavailable"));
  const user = userEvent.setup();
  render(<TwoFactorCard />);

  await user.click(screen.getByRole("switch", { name: SWITCH }));

  expect(await screen.findByText("Could not verify the code.")).toBeInTheDocument();
  expect(screen.getByLabelText("Verification code")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Verify and turn on" })).toBeDisabled();
  expect(showToast).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Retry sending" }));
  expect(screen.getByLabelText("Verification code")).toBeEnabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(showToast).toHaveBeenCalledWith("success", "Verification code sent. Check your email.");
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

it("opens immediately while sending and never claims verification is already on", async () => {
  let resolveSend!: (value: { sent: true }) => void;
  post.mockImplementationOnce(() => new Promise((resolve) => (resolveSend = resolve)));
  const user = userEvent.setup();
  render(<TwoFactorCard />);
  const control = screen.getByRole("switch", { name: SWITCH });
  await user.click(control);
  expect(screen.getByRole("dialog", { name: "Turn on email verification" })).toBeVisible();
  expect(screen.getByText("Sending verification code…")).toBeVisible();
  expect(screen.getByText("Setup in progress")).toBeInTheDocument();
  expect(screen.getByLabelText("Verification code")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Sending code…" })).toBeDisabled();
  expect(control).toHaveAttribute("aria-checked", "false");
  expect(showToast).not.toHaveBeenCalled();
  await act(async () => resolveSend({ sent: true }));
  expect(screen.getByLabelText("Verification code")).toBeEnabled();
  expect(screen.queryByText("Sending verification code…")).not.toBeInTheDocument();
  expect(showToast).toHaveBeenCalledWith("success", "Verification code sent. Check your email.");
  expect(control).toHaveAttribute("aria-checked", "false");
});

it.each(["resolve", "reject"])(
  "ignores a late %s after cancelling the sending dialog",
  async (outcome) => {
    let resolveSend!: (value: { sent: true }) => void;
    let rejectSend!: (error: Error) => void;
    post.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          resolveSend = resolve;
          rejectSend = reject;
        }),
    );
    const user = userEvent.setup();
    render(<TwoFactorCard />);
    const control = screen.getByRole("switch", { name: SWITCH });
    await user.click(control);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => {
      if (outcome === "resolve") resolveSend({ sent: true });
      else rejectSend(new Error("SMTP unavailable"));
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(showToast).not.toHaveBeenCalled();
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(control).toBeEnabled();
    await user.click(control);
    expect(screen.getByLabelText("Verification code")).toBeEnabled();
    expect(post).toHaveBeenCalledTimes(2);
  },
);

it("resends a code, clears old input and prevents overlapping sends", async () => {
  const user = userEvent.setup();
  render(<TwoFactorCard />);
  await user.click(screen.getByRole("switch", { name: SWITCH }));
  await user.type(screen.getByLabelText("Verification code"), "123456");
  let resolveSend!: (value: { sent: true }) => void;
  post.mockImplementationOnce(() => new Promise((resolve) => (resolveSend = resolve)));
  await user.click(screen.getByRole("button", { name: "Resend code" }));
  expect(screen.getByLabelText("Verification code")).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "Sending code…" }));
  expect(post).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "Verify and turn on" })).toBeDisabled();
  await act(async () => resolveSend({ sent: true }));
  expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
});

it("only accepts six digits and refreshes the confirmed account before closing", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<TwoFactorCard />);
  await user.click(screen.getByRole("switch", { name: SWITCH }));
  await user.type(screen.getByLabelText("Verification code"), "123ab");
  expect(screen.getByRole("button", { name: "Verify and turn on" })).toBeDisabled();
  await user.clear(screen.getByLabelText("Verification code"));
  await user.type(screen.getByLabelText("Verification code"), "123456");
  let resolveConfirm!: () => void;
  post.mockImplementationOnce(() => new Promise<void>((resolve) => (resolveConfirm = resolve)));
  auth.refreshProfile.mockImplementationOnce(async () => {
    auth.user.twoFactorEnabled = true;
  });
  await user.click(screen.getByRole("button", { name: "Verify and turn on" }));
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Resend code" })).toBeDisabled();
  await act(async () => resolveConfirm());
  rerender(<TwoFactorCard />);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByRole("switch", { name: SWITCH })).toHaveAttribute("aria-checked", "true");
  expect(showToast).toHaveBeenCalledWith("success", "Email verification is now on.");
});
