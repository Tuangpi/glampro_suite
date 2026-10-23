import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { platformApi } from "./api";

vi.mock("./api", () => ({
  platformApi: {
    login: vi.fn(),
    verify: vi.fn(),
    logout: vi.fn(),
    profile: vi.fn(),
  },
}));
vi.mock("./Companies", () => ({ default: () => <h2>Company management</h2> }));
const admin = { id: "operator", name: "Operator", email: "operator@example.test" };
beforeEach(() => vi.resetAllMocks());
async function login() {
  vi.mocked(platformApi.login).mockResolvedValue({
    requiresTwoFactor: true,
    challenge: "a".repeat(64),
  });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: admin.email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "private-passphrase" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByLabelText("Verification code");
}
async function verify() {
  vi.mocked(platformApi.verify).mockResolvedValue(admin);
  fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
  await screen.findByText("Welcome, Operator");
}
describe("operator portal", () => {
  it("requires verification before showing the operator shell and signs out", async () => {
    render(<App />);
    await login();
    expect(screen.queryByText("Company management")).not.toBeInTheDocument();
    await verify();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("heading", { name: "Operator sign in" });
    expect(platformApi.logout).toHaveBeenCalledOnce();
  });
  it("shows a verification error without entering the shell", async () => {
    render(<App />);
    await login();
    vi.mocked(platformApi.verify).mockRejectedValue(new Error("Code expired"));
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Code expired");
    expect(screen.queryByText("Company management")).not.toBeInTheDocument();
  });
  it("does not claim server sign-out when revocation fails", async () => {
    render(<App />);
    await login();
    await verify();
    vi.mocked(platformApi.logout).mockRejectedValue(new Error("Network unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Network unavailable"));
    expect(screen.getByText("Welcome, Operator")).toBeInTheDocument();
  });
});
