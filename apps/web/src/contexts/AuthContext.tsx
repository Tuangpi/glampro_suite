/**
 * The session, as the browser sees it.
 *
 * Three states, and the middle one matters: `loading` is what a route guard has
 * to distinguish from `anonymous`, because redirecting during the cold-start
 * `GET /auth/me` would bounce a signed-in user to the login screen on every
 * reload.
 *
 * `profile` is the whole of `GET /api/auth/me` — the user, the salon and the
 * salon's effective entitlements. It arrives once per session and is what the
 * rail filters on, so nothing re-requests it per screen.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  AuthProfile,
  AuthSession,
  LoginResult,
  TwoFactorChallenge,
  AuthTenant,
  AuthUser,
  ModuleEntitlement,
} from "@glampro_suite/shared";

import { get, post } from "@/lib/api";
import { clearSession, getRefreshToken, setSession } from "@/lib/auth-storage";
import { clearSaleDraft, saleDraftIdentity } from "@/lib/sale-draft-storage";
import { selectOutlet } from "@/lib/outlet-storage";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  tenant: AuthTenant | null;
  entitlements: ModuleEntitlement[];
  /**
   * A suspended salon may sign in but not write (`saas/TENANCY.md` §6). The API
   * refuses writes with `TENANT_SUSPENDED`; this lets a screen explain that
   * before the user tries.
   */
  isReadOnly: boolean;
  signIn: (email: string, password: string) => Promise<TwoFactorChallenge | void>;
  verifySignIn: (email: string, challenge: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [profile, setProfile] = useState<AuthProfile | null>(null);

  // The initial status is *derived*, not set from an effect. With no stored
  // refresh token there is nothing to restore, so the provider is anonymous from
  // its very first render and the login screen never flashes a loading state.
  // With one, the answer is not known yet and only `GET /auth/me` can give it.
  const [status, setStatus] = useState<AuthStatus>(() =>
    getRefreshToken() ? "loading" : "anonymous",
  );

  const loadProfile = useCallback(async () => {
    const next = await get<AuthProfile>("/auth/me");
    setProfile(next);
    setStatus("authenticated");
    return next;
  }, []);

  // Cold start: `GET /auth/me` is the authority on whether a stored refresh token
  // still means a live session. If the access token has expired in the meantime
  // the interceptor renews it and replays the call, so an expired tab still lands
  // signed in.
  useEffect(() => {
    if (!getRefreshToken()) return;

    let cancelled = false;

    void get<AuthProfile>("/auth/me")
      .then((next) => {
        if (cancelled) return;
        setProfile(next);
        setStatus("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        clearSession();
        setProfile(null);
        setStatus("anonymous");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      // `loginSchema` defaults the realm to `web`, so the surface is not sent.
      const session = await post<LoginResult>("/auth/login", { email, password });
      if ("requiresTwoFactor" in session) return session;
      setSession(session);
      // The token pair alone is not the session: the tenant and the entitlement
      // list arrive with the profile, and the rail needs both.
      await loadProfile();
    },
    [loadProfile],
  );

  const verifySignIn = useCallback(
    async (email: string, challenge: string, code: string) => {
      const session = await post<AuthSession>("/auth/two-factor/verify-login", {
        email,
        challenge,
        code,
      });
      setSession(session);
      await loadProfile();
    },
    [loadProfile],
  );

  const signOut = useCallback(async () => {
    selectOutlet("");
    const refreshToken = getRefreshToken();
    const draftIdentity =
      profile?.tenant && profile.user
        ? saleDraftIdentity(profile.tenant.id, profile.user.id)
        : null;

    // Locally first, so the screen is usable even if the call below never
    // returns. ADR 0007 makes logout idempotent and the endpoint deliberately
    // unauthenticated, so a failure here changes nothing.
    clearSession();
    clearSaleDraft(draftIdentity);
    setProfile(null);
    setStatus("anonymous");
    queryClient.clear();

    if (refreshToken) {
      try {
        await post("/auth/logout", { refreshToken });
      } catch {
        // Best effort — the token is already gone from this browser.
      }
    }
  }, [profile, queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: profile?.user ?? null,
      tenant: profile?.tenant ?? null,
      entitlements: profile?.entitlements ?? [],
      isReadOnly: profile?.tenant.status === "SUSPENDED",
      signIn,
      verifySignIn,
      signOut,
    }),
    [status, profile, signIn, verifySignIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an <AuthProvider>");
  }
  return context;
}
