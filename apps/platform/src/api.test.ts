import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
const admin = { id: "operator", name: "Operator", email: "operator@example.test" };
const session = { accessToken: "access-one", refreshToken: "refresh-one", expiresIn: 900, admin };
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(status === 200 ? { data } : { message: "Request refused" }), {
    status,
  });
}
describe("operator API sessions", () => {
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
              ? { items: [], total: 0, page: 1, pageSize: 20 }
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
  it("uses only platform routes, rotates refresh and keeps credentials out of browser storage", async () => {
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
    await platformApi.profile();
    await platformApi.logout();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/platform/auth/verify",
      "/api/platform/auth/refresh",
      "/api/platform/auth/me",
      "/api/platform/auth/logout",
    ]);
    expect(fetcher.mock.calls[2][1].headers.Authorization).toBe("Bearer access-two");
    expect(JSON.parse(fetcher.mock.calls[3][1].body).refreshToken).toBe("refresh-two");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    await expect(platformApi.profile()).rejects.toThrow("Please sign in again.");
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
});
