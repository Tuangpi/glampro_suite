/**
 * The session contract the route guards and the rail depend on.
 *
 * The thing worth pinning is the *cold start*: a stored refresh token is the only
 * hint that a session might exist, `GET /api/auth/me` is the authority, and the
 * three states must stay distinguishable — collapsing "loading" into
 * "anonymous" is what turns a reload into a bounce off the login screen.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthProfile, AuthSession } from "@glampro_suite/shared";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock("@/lib/api", () => ({ get, post }));

const { AuthProvider, useAuth } = await import("@/contexts/AuthContext");
const { getRefreshToken, setSession } = await import("@/lib/auth-storage");

const USER = {
  id: "u1",
  name: "Ava Owner",
  email: "owner@glampro.test",
  globalRole: "MANAGER",
  tenantId: "t1",
} as const;

const PROFILE: AuthProfile = {
  user: USER,
  tenant: { id: "t1", name: "Glampro Studio", slug: "glampro-studio", status: "ACTIVE" },
  entitlements: [
    { code: "dashboard", name: "Dashboard", category: "Core", isCore: true, expiresAt: null },
  ],
};

const SESSION: AuthSession = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresIn: 900,
  user: USER,
};

function renderProvider() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Probe() {
    const { status, user, tenant, isReadOnly, signIn, verifySignIn, signOut } = useAuth();
    return (
      <div>
        <span data-testid="status">{status}</span>
        <span data-testid="name">{user?.name ?? "-"}</span>
        <span data-testid="tenant">{tenant?.name ?? "-"}</span>
        <span data-testid="readonly">{String(isReadOnly)}</span>
        <button onClick={() => void signIn("owner@glampro.test", "secret123")}>sign in</button>
        <button onClick={() => void signOut()}>sign out</button>
        <button onClick={() => void verifySignIn("owner@glampro.test", "a".repeat(64), "012345")}>
          verify
        </button>
      </div>
    );
  }

  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe("cold start", () => {
  it("spends no request when nothing is stored", async () => {
    renderProvider();

    expect(await screen.findByText("anonymous")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("restores the session from a stored refresh token", async () => {
    setSession(SESSION);
    get.mockResolvedValue(PROFILE);
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(get).toHaveBeenCalledWith("/auth/me");
    expect(screen.getByTestId("name")).toHaveTextContent("Ava Owner");
    expect(screen.getByTestId("tenant")).toHaveTextContent("Glampro Studio");
  });

  it("drops the tokens and becomes anonymous when /me is refused", async () => {
    setSession(SESSION);
    get.mockRejectedValue(new Error("401"));
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    expect(getRefreshToken()).toBeNull();
  });

  it("reports a suspended salon as read-only rather than locked out", async () => {
    setSession(SESSION);
    get.mockResolvedValue({
      ...PROFILE,
      tenant: { ...PROFILE.tenant, status: "SUSPENDED" },
    } satisfies AuthProfile);
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(screen.getByTestId("readonly")).toHaveTextContent("true");
  });
});

describe("signing in", () => {
  it("does not store tokens or load a profile for a challenge", async () => {
    post.mockResolvedValue({ requiresTwoFactor: true, challenge: "a".repeat(64) });
    renderProvider();
    await userEvent.click(screen.getByRole("button", { name: "sign in" }));
    expect(getRefreshToken()).toBeNull();
    expect(get).not.toHaveBeenCalled();
    expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
  });

  it("stores a session only after verification succeeds", async () => {
    post.mockResolvedValue(SESSION);
    get.mockResolvedValue(PROFILE);
    renderProvider();
    await userEvent.click(screen.getByRole("button", { name: "verify" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(post).toHaveBeenCalledWith("/auth/two-factor/verify-login", {
      email: "owner@glampro.test",
      challenge: "a".repeat(64),
      code: "012345",
    });
    expect(getRefreshToken()).toBe(SESSION.refreshToken);
  });

  it("posts the credentials, stores the pair, then loads the profile", async () => {
    post.mockResolvedValue(SESSION);
    get.mockResolvedValue(PROFILE);
    renderProvider();
    await screen.findByText("anonymous");

    await userEvent.click(screen.getByRole("button", { name: "sign in" }));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(post).toHaveBeenCalledWith("/auth/login", {
      email: "owner@glampro.test",
      password: "secret123",
    });
    // The realm is omitted on purpose: `loginSchema` defaults it to `web`.
    expect(post.mock.calls[0][1]).not.toHaveProperty("realm");
    expect(get).toHaveBeenCalledWith("/auth/me");
    expect(getRefreshToken()).toBe(SESSION.refreshToken);
  });
});

describe("signing out", () => {
  it("revokes the presented refresh token and clears the session", async () => {
    setSession(SESSION);
    get.mockResolvedValue(PROFILE);
    post.mockResolvedValue({ success: true });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));

    await userEvent.click(screen.getByRole("button", { name: "sign out" }));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    expect(post).toHaveBeenCalledWith("/auth/logout", { refreshToken: SESSION.refreshToken });
    expect(getRefreshToken()).toBeNull();
    expect(screen.getByTestId("tenant")).toHaveTextContent("-");
  });
});
