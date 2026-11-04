import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import Account from "./Account";
import { platformApi } from "./api";

vi.mock("./api", () => ({
  platformApi: {
    changePassword: vi.fn(),
    enrollTwoFactor: vi.fn(),
    confirmTwoFactor: vi.fn(),
    disableTwoFactor: vi.fn(),
  },
}));

const admin = {
  id: "operator",
  name: "Operator",
  email: "operator@example.test",
  twoFactorEnabled: true,
};

beforeEach(() => vi.resetAllMocks());

function setup(twoFactorEnabled = true) {
  const onChange = vi.fn();
  render(<Account admin={{ ...admin, twoFactorEnabled }} onChange={onChange} />);
  return onChange;
}

it("reports what the server did to the other sessions after a password change", async () => {
  setup();
  vi.mocked(platformApi.changePassword).mockResolvedValue({
    success: true,
    revokedSessions: 2,
  });

  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "private-passphrase" },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "a-brand-new-operator-passphrase" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: "a-brand-new-operator-passphrase" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Update password" }));

  await screen.findByText(/2 other sessions were signed out/);
  expect(platformApi.changePassword).toHaveBeenCalledWith({
    currentPassword: "private-passphrase",
    newPassword: "a-brand-new-operator-passphrase",
  });
});

it("refuses a password confirmation that does not match", async () => {
  setup();

  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "private-passphrase" },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "a-brand-new-operator-passphrase" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: "a-different-operator-passphrase" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Update password" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("The two new passwords do not match.");
  expect(platformApi.changePassword).not.toHaveBeenCalled();
});

it("shows the rules the server enforces while the password is being typed", () => {
  setup();
  const rules = screen.getByRole("list", { name: "Password requirements" });
  expect(rules).toHaveTextContent("At least 12 characters — not met yet");

  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short" } });
  expect(rules).toHaveTextContent("At least 12 characters — not met yet");

  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "a-brand-new-operator-passphrase" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: "a-brand-new-operator-passphrase" },
  });
  expect(rules).toHaveTextContent("At least 12 characters — met");
  expect(rules).toHaveTextContent("Both new passwords match — met");
});

it("only turns email verification on after the emailed code is confirmed", async () => {
  const onChange = setup(false);
  vi.mocked(platformApi.enrollTwoFactor).mockResolvedValue(undefined);
  expect(screen.getByRole("switch", { name: "Email verification" })).toHaveAttribute(
    "aria-checked",
    "false",
  );

  fireEvent.click(screen.getByRole("switch", { name: "Email verification" }));
  const dialog = screen.getByRole("dialog", { name: "Turn on email verification" });
  expect(platformApi.enrollTwoFactor).toHaveBeenCalledOnce();
  // Nothing has flipped yet: the server only enables it on confirmation.
  expect(within(dialog).getByRole("button", { name: "Confirm email verification" })).toBeDisabled();

  vi.mocked(platformApi.confirmTwoFactor).mockResolvedValue({ ...admin, twoFactorEnabled: true });
  // The field is disabled until the enrollment request has answered.
  const codeField = within(dialog).getByLabelText("Verification code");
  await waitFor(() => expect(codeField).toBeEnabled());
  expect(platformApi.confirmTwoFactor).not.toHaveBeenCalled();

  fireEvent.change(codeField, { target: { value: "123456" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm email verification" }));

  await screen.findByText("Email verification is on. Sign-in now asks for a code.");
  expect(platformApi.confirmTwoFactor).toHaveBeenCalledWith("123456");
  expect(onChange).toHaveBeenCalledWith({ ...admin, twoFactorEnabled: true });
});

it("turns email verification off only after the password is re-entered", async () => {
  const onChange = setup();
  vi.mocked(platformApi.disableTwoFactor).mockResolvedValue({
    ...admin,
    twoFactorEnabled: false,
  });

  fireEvent.click(screen.getByRole("switch", { name: "Email verification" }));
  const dialog = screen.getByRole("dialog", { name: "Turn off email verification" });
  expect(platformApi.disableTwoFactor).not.toHaveBeenCalled();

  fireEvent.change(within(dialog).getByLabelText("Your password"), {
    target: { value: "private-passphrase" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Turn off email verification" }));

  await screen.findByText("Email verification is off. Sign-in uses only your password.");
  expect(platformApi.disableTwoFactor).toHaveBeenCalledWith({
    currentPassword: "private-passphrase",
  });
  expect(onChange).toHaveBeenCalledWith({ ...admin, twoFactorEnabled: false });
});

it("reports a failed enrollment in the dialog instead of overstating the switch", async () => {
  setup(false);
  vi.mocked(platformApi.enrollTwoFactor).mockRejectedValue(new Error("EMAIL_SEND_FAILED"));

  fireEvent.click(screen.getByRole("switch", { name: "Email verification" }));
  const dialog = screen.getByRole("dialog", { name: "Turn on email verification" });

  expect(await within(dialog).findByRole("alert")).toHaveTextContent("EMAIL_SEND_FAILED");
  // The switch still shows the server's answer: verification is off.
  expect(screen.getByRole("switch", { name: "Email verification" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
});
