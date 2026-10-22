/**
 * The sign-in screen.
 *
 * Two things here are load-bearing beyond the form itself:
 *
 * - `?next=` decides where the user lands afterwards, and it is attacker
 *   controlled, so the same-origin rule is asserted directly.
 * - The screen branches on the API's **error code** rather than its message, so
 *   that a suspended salon is not told "try again" when retrying cannot help.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { signIn, verifySignIn, getErrorCode, getErrorMessage, getValidationDetails } = vi.hoisted(
  () => ({
    signIn: vi.fn(),
    verifySignIn: vi.fn(),
    getErrorCode: vi.fn<() => string | undefined>(() => undefined),
    getErrorMessage: vi.fn<() => string>(() => "Something went wrong."),
    getValidationDetails: vi.fn<() => Record<string, string>>(() => ({})),
  }),
);

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ signIn, verifySignIn }) }));
vi.mock("@/lib/api", () => ({ getErrorCode, getErrorMessage, getValidationDetails }));

const { default: Login } = await import("@/pages/Login");
const { setAuthNotice } = await import("@/lib/auth-storage");

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="path">{`${location.pathname}${location.search}`}</span>;
}

function renderLogin(entry = "/login") {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Login />
      <LocationProbe />
    </MemoryRouter>,
  );
  return user;
}

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "owner@glampro.test");
  await user.type(screen.getByLabelText("Password"), "secret123");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  signIn.mockReset().mockResolvedValue(undefined);
  verifySignIn.mockReset().mockResolvedValue(undefined);
  getErrorCode.mockReset().mockReturnValue(undefined);
  getErrorMessage.mockReset().mockReturnValue("Something went wrong.");
  getValidationDetails.mockReset().mockReturnValue({});
});

describe("the form", () => {
  it("waits for email verification before navigating and never retains the password", async () => {
    signIn.mockResolvedValue({ requiresTwoFactor: true, challenge: "a".repeat(64) });
    const user = renderLogin("/login?next=%2Fcustomers");
    await submit(user);
    expect(screen.getByTestId("path")).toHaveTextContent("/login");
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Verification code"), "012345");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect(verifySignIn).toHaveBeenCalledWith("owner@glampro.test", "a".repeat(64), "012345");
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/customers"));
  });

  it("keeps the challenge on invalid codes and allows requesting a new code through password login", async () => {
    signIn.mockResolvedValue({ requiresTwoFactor: true, challenge: "a".repeat(64) });
    verifySignIn.mockRejectedValue(new Error("invalid code"));
    getErrorMessage.mockReturnValue("The code is not right.");
    const user = renderLogin();
    await submit(user);
    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect(await screen.findByText("The code is not right.")).toBeInTheDocument();
    expect(screen.getByLabelText("Verification code")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to sign in / request a new code" }));
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.queryByLabelText("Verification code")).not.toBeInTheDocument();
  });

  it("offers a labelled email and password and one submit", () => {
    renderLogin();

    expect(screen.getByRole("heading", { name: "Sign in to Glampro Suite" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("hands the typed credentials to the auth context", async () => {
    const user = renderLogin();

    await submit(user);

    expect(signIn).toHaveBeenCalledWith("owner@glampro.test", "secret123");
  });

  it("marks the submit busy while the credentials are in flight", async () => {
    let release: () => void = () => {};
    signIn.mockReturnValue(
      new Promise<void>((resolve) => {
        release = () => resolve();
      }),
    );
    const user = renderLogin();

    await submit(user);

    const pending = screen.getByRole("button", { name: "Signing in…" });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");

    release();
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/"));
  });
});

describe("the password field", () => {
  it("can be revealed without losing its label or what was typed", async () => {
    const user = renderLogin();

    await user.type(screen.getByLabelText("Password"), "secret123");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Show password" }));

    // The same input, still reachable by the same label: the toggle changes the
    // control's type, not the control. A second input that replaced it would
    // lose the value on the way across, which is the one thing reveal must not
    // do.
    const revealed = screen.getByLabelText("Password");
    expect(revealed).toHaveAttribute("type", "text");
    expect(revealed).toHaveValue("secret123");

    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });
});

describe("where it goes afterwards", () => {
  it("returns the user to where they came from", async () => {
    const user = renderLogin("/login?next=%2Fcustomers%3Fpage%3D2");

    await submit(user);

    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/customers?page=2"));
  });

  it("falls back to the dashboard with no next", async () => {
    const user = renderLogin();

    await submit(user);

    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/"));
  });

  it.each([
    ["an absolute URL", "https%3A%2F%2Fevil.example%2Fsteal"],
    ["a protocol-relative host", "%2F%2Fevil.example"],
  ])("refuses %s in next, so the screen is not an open redirect", async (_label, next) => {
    const user = renderLogin(`/login?next=${next}`);

    await submit(user);

    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/"));
  });
});

describe("what it says when signing in fails", () => {
  it("explains bad credentials in its own words", async () => {
    signIn.mockRejectedValue(new Error("401"));
    getErrorCode.mockReturnValue("INVALID_CREDENTIALS");
    const user = renderLogin();

    await submit(user);

    expect(
      await screen.findByText("That email and password combination is not right."),
    ).toBeInTheDocument();
  });

  it("marks a suspended salon read-only instead of telling the user to retry", async () => {
    signIn.mockRejectedValue(new Error("403"));
    getErrorCode.mockReturnValue("TENANT_SUSPENDED");
    getErrorMessage.mockReturnValue("This salon's subscription is suspended.");
    const user = renderLogin();

    await submit(user);

    const notice = await screen.findByText(/changes are disabled while the subscription/);
    // Not the danger tone: a suspended salon is not a failure, and amber has no
    // token (Q23), so this uses the brand surface.
    expect(notice).toHaveClass("bg-purple-soft");
    expect(notice).not.toHaveClass("bg-danger/5");
  });

  it.each(["TENANT_EXPIRED", "TENANT_CANCELLED", "TENANT_NOT_FOUND"])(
    "says %s is a lockout rather than a retry",
    async (code) => {
      signIn.mockRejectedValue(new Error("403"));
      getErrorCode.mockReturnValue(code);
      getErrorMessage.mockReturnValue("This account is closed.");
      const user = renderLogin();

      await submit(user);

      expect(await screen.findByText(/cannot sign in/)).toBeInTheDocument();
    },
  );

  it("puts a 422 on the field that caused it", async () => {
    signIn.mockRejectedValue(new Error("422"));
    getValidationDetails.mockReturnValue({ email: "Enter a valid email address." });
    const user = renderLogin();

    await submit(user);

    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
  });

  it("clears the password so a retry is not a guess on top of a guess", async () => {
    signIn.mockRejectedValue(new Error("401"));
    getErrorCode.mockReturnValue("INVALID_CREDENTIALS");
    const user = renderLogin();

    await submit(user);

    await waitFor(() => expect(screen.getByLabelText("Password")).toHaveValue(""));
  });

  it("shows the reason a 401 redirect left behind", async () => {
    setAuthNotice("Your session has expired. Please log in again.");

    renderLogin();

    expect(
      await screen.findByText("Your session has expired. Please log in again."),
    ).toBeInTheDocument();
  });
});
