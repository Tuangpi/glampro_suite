/**
 * Session persistence.
 *
 * A thin wrapper around `localStorage` so no component reaches for raw string
 * keys. The token pair is written by the auth flow and read by the axios
 * interceptor.
 */
import type { AuthSession, AuthUser } from "@glampro_suite/shared";
import { clearPosIdentity } from "@/lib/pos-identity";

const ACCESS_TOKEN_KEY = "glampro.accessToken";
const REFRESH_TOKEN_KEY = "glampro.refreshToken";
const USER_KEY = "glampro.user";
/** Survives the redirect to /login so the reason can be shown there. */
const NOTICE_KEY = "glampro.authNotice";

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setSession(session: AuthSession): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
}

export function clearSession(): void {
  clearPosIdentity();
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function setAuthNotice(message: string): void {
  sessionStorage.setItem(NOTICE_KEY, message);
}

/** Reads and clears the pending notice, so it is only shown once. */
export function consumeAuthNotice(): string | null {
  const notice = sessionStorage.getItem(NOTICE_KEY);
  if (notice) sessionStorage.removeItem(NOTICE_KEY);
  return notice;
}
