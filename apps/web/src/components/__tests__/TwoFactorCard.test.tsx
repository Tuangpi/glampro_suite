import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import TwoFactorCard from "../TwoFactorCard";

const { post, auth } = vi.hoisted(() => ({
  post: vi.fn(),
  auth: { user: { globalRole: "MANAGER" } },
}));
vi.mock("@/lib/api", () => ({ post, getErrorMessage: () => "Could not verify the code." }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

beforeEach(() => {
  post.mockReset().mockResolvedValue({ sent: true });
  auth.user.globalRole = "MANAGER";
});

it("enrolls an optional account by sending and confirming an email code", async () => {
  const user = userEvent.setup();
  render(<TwoFactorCard />);
  await user.click(screen.getByRole("button", { name: "Enable two-factor authentication" }));
  expect(post).toHaveBeenCalledWith("/auth/two-factor/enable", {});
  await user.type(screen.getByLabelText("Enrollment verification code"), "012345");
  await user.click(screen.getByRole("button", { name: "Confirm two-factor authentication" }));
  expect(post).toHaveBeenCalledWith("/auth/two-factor/confirm", { code: "012345" });
  expect(await screen.findByText(/Two-factor authentication is enabled/)).toBeInTheDocument();
});

it("explains mandatory owner verification without offering a disable button", () => {
  auth.user.globalRole = "SUPER_ADMIN";
  render(<TwoFactorCard />);
  expect(screen.getByText(/Owners must verify an email code/)).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("shows enrollment errors without claiming success", async () => {
  post.mockRejectedValue(new Error("SMTP unavailable"));
  render(<TwoFactorCard />);
  await userEvent.click(screen.getByRole("button", { name: "Enable two-factor authentication" }));
  expect(await screen.findByText("Could not verify the code.")).toBeInTheDocument();
  expect(screen.queryByLabelText("Enrollment verification code")).not.toBeInTheDocument();
});
