import {
  platformAdminSchema,
  platformSessionSchema,
  twoFactorChallengeSchema,
  type PlatformAuthSession,
  type PlatformLoginInput,
  type PlatformVerifyInput,
} from "@glampro_suite/shared";

// Operator tokens never enter salon localStorage. They live only in this app's
// memory and disappear on reload/tab close. No implicit persistent login.
let session: PlatformAuthSession | null = null;
let refreshing: Promise<void> | null = null;
const BASE = "/api/platform/auth";

async function request(path: string, body?: unknown, token?: string) {
  const response = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    credentials: "omit",
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? "Platform request failed.");
  return payload.data;
}

export const platformApi = {
  async login(input: PlatformLoginInput) {
    return twoFactorChallengeSchema.parse(await request("/login", input));
  },
  async verify(input: PlatformVerifyInput) {
    session = platformSessionSchema.parse(await request("/verify", input));
    return session.admin;
  },
  async profile() {
    if (!session) throw new Error("Please sign in again.");
    // Rotate before the profile check. The server validates status, version and
    // absolute expiry on every use. Collapse concurrent refreshes to one request.
    refreshing ??= request("/refresh", { refreshToken: session.refreshToken })
      .then((value) => {
        session = platformSessionSchema.parse(value);
      })
      .finally(() => {
        refreshing = null;
      });
    await refreshing;
    if (!session) throw new Error("Please sign in again.");
    return platformAdminSchema.parse(await request("/me", undefined, session.accessToken));
  },
  async logout() {
    const current = session;
    if (current) await request("/logout", { refreshToken: current.refreshToken });
    session = null;
  },
};
