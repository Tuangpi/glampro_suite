import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
});
/** The key `api.ts` keeps the tab's refresh token under; a rename is a deliberate edit here. */
const REFRESH_KEY = "glampro.platform.refresh";
const admin = {
  id: "operator",
  name: "Operator",
  email: "operator@example.test",
  twoFactorEnabled: true,
};
const session = { accessToken: "access-one", refreshToken: "refresh-one", expiresIn: 900, admin };
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(status === 200 ? { data } : { message: "Request refused" }), {
    status,
  });
}
describe("operator API sessions", () => {
  it("sends administrative writes only to the selected company's platform endpoints", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          response(
            url.endsWith("/verify") || url.endsWith("/refresh")
              ? session
              : url.endsWith("/modules/bulk")
                ? { changed: [], unchanged: [] }
                : { success: true },
          ),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const { platformApi } = await import("./api");
    await platformApi.verify({ challenge: "a".repeat(64), code: "123456" });
    await platformApi.lifecycle("company/a", { action: "suspend", reason: "Manual review" });
    await platformApi.recordSubscription("company/a", {
      startDate: "2026-10-01T00:00:00Z",
      endDate: "2026-11-01T00:00:00Z",
      amount: "99.00",
      currency: "SGD",
      reason: "Manual period",
    });
    await platformApi.changeModule("company/a", {
      code: "packages",
      enabled: false,
      expiresAt: null,
      reason: "Contract ended",
    });
    await platformApi.changeModules("company/a", {
      enabled: true,
      expiresAt: null,
      reason: "Everything on",
    });
    expect(
      fetcher.mock.calls.filter(([url]) => url.includes("/companies/")).map(([url]) => url),
    ).toEqual([
      "/api/platform/companies/company%2Fa/lifecycle",
      "/api/platform/companies/company%2Fa/subscriptions",
      "/api/platform/companies/company%2Fa/modules",
      "/api/platform/companies/company%2Fa/modules/bulk",
    ]);
    expect(fetcher.mock.calls.every(([, options]) => options.credentials === "omit")).toBe(true);
  });
  it("waits for a company request's refresh before revoking the current token", async () => {
    let resolveRefresh!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(session))
      .mockReturnValueOnce(pending)
      .mockImplementation((url: string) =>
        Promise.resolve(
          response(
            url.includes("companies")
              ? {
                  items: [],
                  total: 0,
                  page: 1,
                  pageSize: 20,
                  stats: { total: 0, active: 0, suspended: 0, expiringSoon: 0 },
                }
              : { success: true },
          ),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const { platformApi } = await import("./api");
    await platformApi.verify({ challenge: "a".repeat(64), code: "123456" });
    const companies = platformApi.companies();
    const logout = platformApi.logout();
    expect(fetcher).toHaveBeenCalledTimes(2);
    resolveRefresh(response({ ...session, refreshToken: "refresh-two" }));
    await Promise.all([companies, logout]);
    const call = fetcher.mock.calls.find(([url]) => url.endsWith("/logout"));
    expect(JSON.parse(call![1].body).refreshToken).toBe("refresh-two");
  });
  it("stores only the rotated refresh token, and forgets it on sign-out", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(
        response({ ...session, accessToken: "access-two", refreshToken: "refresh-two" }),
      )
      .mockResolvedValueOnce(response(admin))
      .mockResolvedValueOnce(response({ success: true }));
    vi.stubGlobal("fetch", fetcher);
    const { platformApi } = await import("./api");
    await platformApi.verify({ challenge: "a".repeat(64), code: "123456" });
    expect(sessionStorage.getItem(REFRESH_KEY)).toBe("refresh-one");
    await platformApi.profile();
    // Rotation is kept: a reload spends the token the tab is holding, not an old one.
    expect(sessionStorage.getItem(REFRESH_KEY)).toBe("refresh-two");
    await platformApi.logout();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/platform/auth/verify",
      "/api/platform/auth/refresh",
      "/api/platform/auth/me",
      "/api/platform/auth/logout",
    ]);
    expect(fetcher.mock.calls[2][1].headers.Authorization).toBe("Bearer access-two");
    expect(JSON.parse(fetcher.mock.calls[3][1].body).refreshToken).toBe("refresh-two");
    // The refresh token is the only thing written, in `sessionStorage`, and the salon's
    // `localStorage` never holds operator credentials.
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    await expect(platformApi.profile()).rejects.toThrow("Please sign in again.");
  });
  it("resumes a reloaded tab from the refresh token it kept", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(
        response({ ...session, accessToken: "access-two", refreshToken: "refresh-two" }),
      )
      .mockResolvedValueOnce(
        response({ ...session, accessToken: "access-three", refreshToken: "refresh-three" }),
      )
      .mockResolvedValueOnce(response(admin));
    vi.stubGlobal("fetch", fetcher);
    const before = await import("./api");
    await before.platformApi.verify({ challenge: "a".repeat(64), code: "123456" });
    expect(sessionStorage.getItem(REFRESH_KEY)).toBe("refresh-one");
    // One entry: the access token and the profile were not kept beside it.
    expect(sessionStorage.length).toBe(1);

    // A reload: the module's memory is gone, the tab's storage is not.
    vi.resetModules();
    const after = await import("./api");
    await expect(after.platformApi.restore()).resolves.toEqual({ admin });
    expect(fetcher.mock.calls[1][0]).toBe("/api/platform/auth/refresh");
    expect(JSON.parse(fetcher.mock.calls[1][1].body).refreshToken).toBe("refresh-one");
    // The token that came back replaced the one that was spent.
    expect(sessionStorage.getItem(REFRESH_KEY)).toBe("refresh-two");
    // And the resumed session is a working one, without a second password or code.
    await expect(after.platformApi.profile()).resolves.toEqual(admin);
  });
  it("shares one exchange when two callers restore at once", async () => {
    // React's strict mode mounts an effect twice; the tab's token is spent once.
    sessionStorage.setItem(REFRESH_KEY, "kept-token");
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ ...session, refreshToken: "refresh-two" }));
    vi.stubGlobal("fetch", fetcher);
    const { platformApi } = await import("./api");
    await expect(Promise.all([platformApi.restore(), platformApi.restore()])).resolves.toEqual([
      { admin },
      { admin },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(REFRESH_KEY)).toBe("refresh-two");
  });
  it("asks the server nothing when the tab holds no session", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { platformApi } = await import("./api");
    await expect(platformApi.restore()).resolves.toEqual({ admin: null });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("forgets a stored token the server refuses, and says why", async () => {
    sessionStorage.setItem(REFRESH_KEY, "revoked-token");
    const fetcher = vi.fn().mockResolvedValueOnce(response(null, 401));
    vi.stubGlobal("fetch", fetcher);
    const { platformApi } = await import("./api");
    await expect(platformApi.restore()).resolves.toEqual({
      admin: null,
      error: "Request refused",
    });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).refreshToken).toBe("revoked-token");
    // A dead token is not kept for the next reload to offer again.
    expect(sessionStorage.length).toBe(0);
  });
  it("keeps a stored token it never presented, so an outage costs no second factor", async () => {
    sessionStorage.setItem(REFRESH_KEY, "unspent-token");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { platformApi } = await import("./api");
    await expect(platformApi.restore()).resolves.toEqual({
      admin: null,
      error: "Your session could not be restored. Sign in again.",
    });
    expect(sessionStorage.getItem(REFRESH_KEY)).toBe("unspent-token");
  });
  it("retains the session for retry after failed server logout", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response(null, 503))
      .mockResolvedValueOnce(response({ success: true }));
    vi.stubGlobal("fetch", fetcher);
    const { platformApi } = await import("./api");
    await platformApi.verify({ challenge: "a".repeat(64), code: "123456" });
    await expect(platformApi.logout()).rejects.toThrow("Request refused");
    await platformApi.logout();
    expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[2][1].body);
  });
  it("edits a company with PATCH on the encoded id, and reports a skipped invitation as null", async () => {
    const fetcher = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        response(
          url.endsWith("/verify") || url.endsWith("/refresh")
            ? session
            : {
                company: {
                  id: "company-a",
                  name: "Salon A",
                  slug: "salon-a",
                  status: "ACTIVE",
                  subscriptionEndsAt: null,
                  createdAt: new Date().toISOString(),
                  owner: null,
                  invitation: null,
                },
                invitationDelivery: null,
              },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const { platformApi } = await import("./api");
    await platformApi.verify({ challenge: "a".repeat(64), code: "123456" });
    const result = await platformApi.updateCompany("company/a", {
      name: "Salon A",
      slug: "salon-a",
      ownerName: "Owner B",
      ownerEmail: "owner-b@example.test",
      reason: "Owner was never recorded",
    });
    expect(result.invitationDelivery).toBeNull();
    const call = fetcher.mock.calls.find(([url]) => url.includes("/companies/"));
    expect(call?.[0]).toBe("/api/platform/companies/company%2Fa");
    expect(call?.[1].method).toBe("PATCH");
  });
  it("purges a company with DELETE and the typed slug, never a lifecycle POST", async () => {
    const fetcher = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        response(
          url.endsWith("/verify") || url.endsWith("/refresh")
            ? session
            : {
                purged: true,
                company: { id: "company-a", name: "Salon A", slug: "salon-a" },
                deletedRows: 12,
              },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const { platformApi } = await import("./api");
    await platformApi.verify({ challenge: "a".repeat(64), code: "123456" });
    const result = await platformApi.deleteCompany("company/a", {
      confirmSlug: "salon-a",
      reason: "Customer asked us to erase their data",
    });
    expect(result).toEqual({
      purged: true,
      company: { id: "company-a", name: "Salon A", slug: "salon-a" },
      deletedRows: 12,
    });
    const call = fetcher.mock.calls.find(([url]) => url.includes("/companies/"));
    expect(call?.[0]).toBe("/api/platform/companies/company%2Fa");
    expect(call?.[1].method).toBe("DELETE");
    expect(JSON.parse(call?.[1].body as string)).toEqual({
      confirmSlug: "salon-a",
      reason: "Customer asked us to erase their data",
    });
  });
});
