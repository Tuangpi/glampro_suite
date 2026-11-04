import {
  platformAdminSchema,
  platformSessionSchema,
  platformLoginResultSchema,
  type PlatformAuthSession,
  type PlatformAdminProfile,
  type PlatformLoginInput,
  type PlatformPasswordChangeInput,
  platformPasswordChangeResultSchema,
  type PlatformTwoFactorDisableInput,
  type PlatformVerifyInput,
  companyListSchema,
  companyDetailSchema,
  companyOnboardingSchema,
  type CreateCompanyInput,
  companyPurgeResultSchema,
  type CompanyPurgeInput,
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
const COMPANIES = "/api/platform/companies";

async function request(path: string, body?: unknown, token?: string, base = BASE, method?: string) {
  const response = await fetch(`${base}${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
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

/**
 * The current session, rotated first. The server validates status, version and
 * absolute expiry on every use; concurrent callers share one refresh request.
 */
async function rotate(): Promise<PlatformAuthSession> {
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
  return session;
}

async function operatorRequest(path: string, body?: unknown, method?: string) {
  const current = await rotate();
  return request(path, body, current.accessToken, COMPANIES, method);
}

/** Account & security lives on the auth router, not the companies one. */
async function operatorAuth(path: string, body?: unknown) {
  const current = await rotate();
  return request(path, body, current.accessToken, BASE);
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
  /** Permanent: removes the company and every row that belongs to it. */
  async deleteCompany(id: string, input: CompanyPurgeInput) {
    return companyPurgeResultSchema.parse(
      await operatorRequest(`/${encodeURIComponent(id)}`, input, "DELETE"),
    );
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
  async login(
    input: PlatformLoginInput,
  ): Promise<{ challenge: string } | { admin: PlatformAdminProfile }> {
    const result = platformLoginResultSchema.parse(await request("/login", input));
    // Verification is on: the operator still has to confirm the emailed code.
    if ("requiresTwoFactor" in result) return { challenge: result.challenge };
    // Verification is off: the session came back with the password check.
    session = result;
    return { admin: result.admin };
  },
  async verify(input: PlatformVerifyInput) {
    session = platformSessionSchema.parse(await request("/verify", input));
    return session.admin;
  },
  async profile() {
    // Rotate first: the server validates status, version and absolute expiry on
    // every use, so a stale in-memory session fails here rather than later.
    return platformAdminSchema.parse(await operatorAuth("/me"));
  },
  async changePassword(input: PlatformPasswordChangeInput) {
    return platformPasswordChangeResultSchema.parse(await operatorAuth("/password", input));
  },
  async enrollTwoFactor() {
    await operatorAuth("/two-factor/enroll", {});
  },
  async confirmTwoFactor(code: string) {
    return platformAdminSchema.parse(await operatorAuth("/two-factor/confirm", { code }));
  },
  async disableTwoFactor(input: PlatformTwoFactorDisableInput) {
    return platformAdminSchema.parse(await operatorAuth("/two-factor/disable", input));
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
