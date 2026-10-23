import {
  platformAdminSchema,
  platformSessionSchema,
  twoFactorChallengeSchema,
  type PlatformAuthSession,
  type PlatformLoginInput,
  type PlatformVerifyInput,
  companyListSchema,
  companyDetailSchema,
  companyOnboardingSchema,
  type CreateCompanyInput,
  companyAdministrationSchema,
  companyAuditSchema,
  type CompanyLifecycleInput,
  type RecordSubscriptionInput,
  type CompanyModuleInput,
} from "@glampro_suite/shared";

// Operator tokens never enter salon localStorage. They live only in this app's
// memory and disappear on reload/tab close. No implicit persistent login.
let session: PlatformAuthSession | null = null;
let refreshing: Promise<void> | null = null;
const BASE = "/api/platform/auth";

async function request(path: string, body?: unknown, token?: string, base = BASE) {
  const response = await fetch(`${base}${path}`, {
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

async function operatorRequest(path: string, body?: unknown) {
  if (!session) throw new Error("Please sign in again.");
  refreshing ??= request("/refresh", { refreshToken: session.refreshToken })
    .then((value) => {
      session = platformSessionSchema.parse(value);
    })
    .finally(() => {
      refreshing = null;
    });
  await refreshing;
  if (!session) throw new Error("Please sign in again.");
  return request(path, body, session.accessToken, "/api/platform/companies");
}

export const platformApi = {
  async administration(id: string) {
    return companyAdministrationSchema.parse(
      await operatorRequest(`/${encodeURIComponent(id)}/administration`),
    );
  },
  async audit(id: string, page = 1) {
    return companyAuditSchema.parse(
      await operatorRequest(`/${encodeURIComponent(id)}/audit?page=${page}&pageSize=20`),
    );
  },
  async lifecycle(id: string, input: CompanyLifecycleInput) {
    await operatorRequest(`/${encodeURIComponent(id)}/lifecycle`, input);
  },
  async recordSubscription(id: string, input: RecordSubscriptionInput) {
    await operatorRequest(`/${encodeURIComponent(id)}/subscriptions`, input);
  },
  async changeModule(id: string, input: CompanyModuleInput) {
    await operatorRequest(`/${encodeURIComponent(id)}/modules`, input);
  },
  async companies(search = "", page = 1) {
    return companyListSchema.parse(
      await operatorRequest(
        `?${new URLSearchParams({ search, page: String(page), pageSize: "20" })}`,
      ),
    );
  },
  async company(id: string) {
    return companyDetailSchema.parse(await operatorRequest(`/${encodeURIComponent(id)}`));
  },
  async createCompany(input: CreateCompanyInput) {
    return companyOnboardingSchema.parse(await operatorRequest("", input));
  },
  async resendInvitation(id: string) {
    return companyOnboardingSchema.parse(
      await operatorRequest(`/${encodeURIComponent(id)}/invitation`, {}),
    );
  },
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
    // Company screens may already be rotating the token. Revoke the resulting
    // current token, not an obsolete value that the server no longer recognizes.
    if (refreshing) await refreshing;
    const current = session;
    if (current) await request("/logout", { refreshToken: current.refreshToken });
    session = null;
  },
};
