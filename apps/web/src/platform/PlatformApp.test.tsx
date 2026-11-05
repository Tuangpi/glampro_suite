import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import type { PlatformAdminProfile } from "@glampro_suite/shared";
import PlatformApp from "./PlatformApp";

function Location() {
  return <output aria-label="Current path">{useLocation().pathname}</output>;
}

/** The console has no link to a bogus path, and sign-in always lands on the
 *  directory, so deep links are reached by navigating from an open session. */
function Go({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>{`Go to ${to}`}</button>;
}

function App({ path = "/platform/login" }: { path?: string }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      {/* Mounted exactly as `App.tsx` mounts it: as the `/platform/*` route. */}
      <Routes>
        <Route path="/platform/*" element={<PlatformApp />} />
      </Routes>
      <Location />
      <Go to="/platform/nowhere" />
      <Go to="/platform/companies/company-a" />
      <Go to="/platform/companies/new" />
      <Go to="/platform/account" />
    </MemoryRouter>
  );
}
import { platformApi } from "./api";

vi.mock("./api", () => ({
  platformApi: {
    restore: vi.fn(),
    login: vi.fn(),
    verify: vi.fn(),
    logout: vi.fn(),
  },
}));
// The pages have their own tests; this one is about the routing and the session.
vi.mock("./CompaniesPage", () => ({ default: () => <h2>Company management</h2> }));
vi.mock("./CreateCompanyPage", () => ({ default: () => <h2>Create company</h2> }));
vi.mock("./CompanyDetailPage", () => ({ default: () => <h2>Company detail</h2> }));
vi.mock("./Account", () => ({ default: () => <h2>Account &amp; security</h2> }));

const admin = {
  id: "operator",
  name: "Operator",
  email: "operator@example.test",
  twoFactorEnabled: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  // Every test below starts in a tab with no session until it says otherwise.
  vi.mocked(platformApi.restore).mockResolvedValue({ admin: null });
});

async function login() {
  vi.mocked(platformApi.login).mockResolvedValue({ challenge: "a".repeat(64) });
  // The console checks the tab's stored session before it draws the form.
  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: admin.email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "private-passphrase" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByLabelText("Verification code");
}

async function verify(profile = admin) {
  vi.mocked(platformApi.verify).mockResolvedValue(profile);
  fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
  await screen.findByRole("heading", { name: "Company management" });
  await waitFor(() =>
    expect(screen.getByLabelText("Current path")).toHaveTextContent(/^\/platform$/),
  );
}

describe("operator console routing and session", () => {
  it.each(["/platform", "/platform/companies", "/platform/account", "/platform/unknown"])(
    "redirects unauthenticated %s to platform login",
    async (path) => {
      render(<App path={path} />);
      await waitFor(() =>
        expect(screen.getByLabelText("Current path")).toHaveTextContent("/platform/login"),
      );
    },
  );

  // Same shape as the salon sign-in: a hand-composed masked control whose
  // `type` is an expression, so the prompt is the only text a reader gets
  // before the first keystroke.
  it("prompts for the operator password instead of sampling one", async () => {
    render(<App />);

    const password = await screen.findByLabelText("Password");
    expect(password).toHaveAttribute("placeholder", "Please enter your password");
    // The prompt is not the name.
    expect(password).toHaveAccessibleName("Password");
  });

  it("requires verification before showing the console and signs out", async () => {
    render(<App />);
    await login();
    expect(screen.queryByText("Company management")).not.toBeInTheDocument();
    await verify();
    // No credentials in `localStorage`: the tab-scoped token belongs to `platformApi`
    // and is asserted in `api.test.ts`.
    expect(localStorage.length).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("heading", { name: "Operator sign in" });
    expect(platformApi.logout).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Current path")).toHaveTextContent("/platform/login");
  });

  it("shows a verification error without entering the console", async () => {
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
    vi.mocked(platformApi.logout).mockRejectedValue(new Error("Network down"));

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network down");
    // The session was never revoked, so the console stays and says so.
    expect(screen.getByRole("heading", { name: "Company management" })).toBeInTheDocument();
  });

  it("resumes the tab's session instead of asking for the password again", async () => {
    vi.mocked(platformApi.restore).mockResolvedValue({ admin });
    // A reload of a deep link: the operator stays on the page they were reading.
    render(<App path="/platform/companies/company-a" />);

    expect(await screen.findByRole("heading", { name: "Company detail" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current path")).toHaveTextContent(
      "/platform/companies/company-a",
    );
    expect(screen.queryByRole("heading", { name: "Operator sign in" })).not.toBeInTheDocument();
    // It resumes from the tab's token only: no password, no verification code.
    expect(platformApi.login).not.toHaveBeenCalled();
    expect(platformApi.verify).not.toHaveBeenCalled();
  });

  it("does not flash the sign-in form while the tab's session is checked", async () => {
    let resume!: (result: { admin: PlatformAdminProfile | null }) => void;
    vi.mocked(platformApi.restore).mockReturnValue(
      new Promise((resolve) => {
        resume = resolve;
      }),
    );
    render(<App path="/platform" />);

    expect(screen.getByText("Restoring your session…")).toHaveAttribute("role", "status");
    // The password form is never drawn for an operator who is already signed in.
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();

    resume({ admin });
    expect(await screen.findByRole("heading", { name: "Company management" })).toBeInTheDocument();
  });

  it("says why a stored session could not be resumed", async () => {
    vi.mocked(platformApi.restore).mockResolvedValue({
      admin: null,
      error: "Your platform session is no longer valid.",
    });
    render(<App path="/platform/companies/company-a" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your platform session is no longer valid.",
    );
    expect(screen.getByRole("heading", { name: "Operator sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current path")).toHaveTextContent("/platform/login");
  });

  it("navigates between the directory and the account page", async () => {
    render(<App />);
    await login();
    await verify();

    fireEvent.click(screen.getByRole("link", { name: "Account & security" }));
    await screen.findByRole("heading", { name: "Account & security" });
    expect(screen.getByLabelText("Current path")).toHaveTextContent("/platform/account");

    fireEvent.click(screen.getByRole("link", { name: "Companies" }));
    await screen.findByRole("heading", { name: "Company management" });
    expect(screen.getByLabelText("Current path")).toHaveTextContent("/platform");
  });

  it.each([
    ["/platform/companies/company-a", "Company detail"],
    ["/platform/companies/new", "Create company"],
    ["/platform/account", "Account & security"],
  ])("serves %s from its own route", async (path, heading) => {
    render(<App />);
    await login();
    await verify();

    fireEvent.click(screen.getByRole("button", { name: `Go to ${path}` }));
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByLabelText("Current path")).toHaveTextContent(path);
  });

  it("sends an unknown path back to the directory instead of a blank screen", async () => {
    render(<App />);
    await login();
    await verify();

    fireEvent.click(screen.getByRole("button", { name: "Go to /platform/nowhere" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Current path")).toHaveTextContent(/^\/platform$/),
    );
    expect(screen.getByRole("heading", { name: "Company management" })).toBeInTheDocument();
  });
});
