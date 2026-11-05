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
  type UpdateCompanyInput,
  companyUpdateResultSchema,
  companyPurgeResultSchema,
  type CompanyPurgeInput,
  companyAdministrationSchema,
  companyAuditSchema,
  type CompanyLifecycleInput,
  type RecordSubscriptionInput,
  type CompanyModuleInput,
  companyModulesBulkResultSchema,
  type CompanyModulesBulkInput,
} from "@glampro_suite/shared";

// Operator credentials never enter the salon's `localStorage`. The refresh token
// alone survives a reload, in `sessionStorage` under its own key — tab-scoped on
// purpose: the salon app's stored session lives in `localStorage`, so a reload of
// the console must not resurrect an operator from a machine's disk, and closing the
// tab must end the session. Access tokens are never written: every request rotates
// the session, so a stored access token would be stale the moment it was saved.
// `restore()` trades the kept token for a session on the first render after a
// reload; see docs/platform-console.md.
const STORAGE_KEY = "glampro.platform.refresh";
let session: PlatformAuthSession | null = null;
let refreshing: Promise<void> | null = null;
let resuming: Promise<{ admin: PlatformAdminProfile | null; error?: string }> | null = null;
const BASE = "/api/platform/auth";
const COMPANIES = "/api/platform/companies";

/** Storage can be refused (blocked cookies, a sandbox, no `window`): then stay in memory. */
function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The one place the session changes. It stores the refresh token and nothing else —
 * no access token, no profile — so a reload re-reads both from the server rather
 * than trusting a copy that may be minutes out of date.
 */
function remember(next: PlatformAuthSession | null) {
  session = next;
  const store = storage();
  if (!store) return;
  if (next) store.setItem(STORAGE_KEY, next.refreshToken);
  else store.removeItem(STORAGE_KEY);
}

/** A refusal by the server, as distinct from a request that never arrived. */
class RequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RequestError";
    this.status = status;
  }
}

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
  if (!response.ok) {
    throw new RequestError(payload.message ?? "Platform request failed.", response.status);
  }
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
      remember(platformSessionSchema.parse(value));
    })
    .finally(() => {
      refreshing = null;
    });
  await refreshing;
  if (!session) throw new Error("Please sign in again.");
  return session;
}

/**
 * Trades the tab's stored refresh token for a session, on the first render after a
 * reload.
 *
 * `/refresh` rotates the row in place, so the token that comes back replaces the one
 * that was kept: the stored value is spent, never reused. A refusal — revoked,
 * expired, password changed, operator disabled — is final, so the entry is dropped
 * and the console says why it is asking again. A request that never reached the
 * server keeps the entry, because an outage is not a reason to cost the operator a
 * second factor; the next reload tries again.
 */
async function restore(): Promise<{ admin: PlatformAdminProfile | null; error?: string }> {
  // One exchange at a time. A double-mounted effect — React's strict mode — must not
  // spend the tab's token twice: `/refresh` rotates in place, so the second attempt
  // would be refused and take the entry down with it.
  resuming ??= exchange().finally(() => {
    resuming = null;
  });
  return resuming;
}

async function exchange(): Promise<{ admin: PlatformAdminProfile | null; error?: string }> {
  const token = storage()?.getItem(STORAGE_KEY);
  if (!token) return { admin: null };
  try {
    const resumed = platformSessionSchema.parse(await request("/refresh", { refreshToken: token }));
    remember(resumed);
    return { admin: resumed.admin };
  } catch (cause) {
    if (cause instanceof RequestError) {
      remember(null);
      return { admin: null, error: cause.message };
    }
    return { admin: null, error: "Your session could not be restored. Sign in again." };
  }
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
  /** Picks up the session this tab left behind, if any. Called once, at boot. */
  restore,
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
  /** Every add-on at once, under one reason. Answers what actually moved. */
  async changeModules(id: string, input: CompanyModulesBulkInput) {
    return companyModulesBulkResultSchema.parse(
      await operatorRequest(`/${encodeURIComponent(id)}/modules/bulk`, input),
    );
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
  /**
   * Rename a company, re-address it, or give it an owner. The owner fields are
   * omitted together to leave the current owner alone.
   */
  async updateCompany(id: string, input: UpdateCompanyInput) {
    return companyUpdateResultSchema.parse(
      await operatorRequest(`/${encodeURIComponent(id)}`, input, "PATCH"),
    );
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
    remember(result);
    return { admin: result.admin };
  },
  async verify(input: PlatformVerifyInput) {
    const verified = platformSessionSchema.parse(await request("/verify", input));
    remember(verified);
    return verified.admin;
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
    // Only once the server has revoked it: a failed logout keeps both copies so the
    // operator can retry rather than being left with a live session they cannot end.
    remember(null);
  },
};
