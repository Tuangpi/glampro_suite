/**
 * The 401 recovery path in `lib/api.ts`.
 *
 * This runs the real axios instance with a scripted adapter rather than mocking
 * the module, because the behaviour under test *is* the interceptor chain: a
 * burst of parallel requests must produce exactly one renewal, each must be
 * replayed once with the new token, and a failed renewal must end the session.
 *
 * The single-flight requirement is not an optimisation. The server rotates the
 * refresh token on every use and revokes the family on a replay, so N parallel
 * refreshes would kill the user's own session.
 *
 * It also covers `getPaginated`'s unwrapping of the list envelope, which needs the
 * same real call: that bug shipped green through every suite, because the web
 * suites mock the query hooks and the API suites assert only what the *server*
 * sends.
 */
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "@glampro_suite/shared";

import api, { downloadFile, getPaginated } from "@/lib/api";
import { clearSession, getRefreshToken, setSession } from "@/lib/auth-storage";

/** Annotated so `globalRole` stays a `GlobalRole` union instead of widening. */
const USER: AuthUser = {
  id: "u1",
  name: "Ava Owner",
  email: "owner@glampro.test",
  globalRole: "MANAGER",
  tenantId: "t1",
};

const STALE = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresIn: 900,
  user: USER,
};

const RENEWED = {
  accessToken: "access-2",
  refreshToken: "refresh-2",
  expiresIn: 900,
  user: USER,
};

interface Call {
  url: string;
  auth: string | null;
}

let calls: Call[] = [];
let handler: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>;

function respond(config: InternalAxiosRequestConfig, status: number, data: unknown): AxiosResponse {
  return { data, status, statusText: "", headers: {}, config };
}

const countFor = (url: string) => calls.filter((call) => call.url === url).length;

/** Lets the test hold the renewal open until a burst is fully in flight. */
function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const assign = vi.fn();

beforeEach(() => {
  calls = [];
  assign.mockClear();

  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { pathname: "/customers", search: "?page=2", assign },
  });

  api.defaults.adapter = async (config) => {
    calls.push({
      url: config.url ?? "",
      auth: (config.headers.Authorization as string | undefined) ?? null,
    });

    const response = await handler(config);

    // An adapter is responsible for settling its own promise: axios's built-in
    // adapters call `settle`, and `dispatchRequest` does not re-check the status.
    // Without this a scripted 401 would resolve and no interceptor would run.
    if (!config.validateStatus?.(response.status)) {
      throw new AxiosError(
        `Request failed with status code ${response.status}`,
        AxiosError.ERR_BAD_RESPONSE,
        config,
        {},
        response,
      );
    }

    return response;
  };
});

afterEach(() => {
  clearSession();
});

describe("a burst of 401s", () => {
  it("renews once, replays every request, and stores the new pair", async () => {
    const hold = gate();

    setSession(STALE);
    handler = async (config) => {
      const url = config.url ?? "";
      if (url === "/auth/refresh") {
        await hold.promise;
        return respond(config, 200, { data: RENEWED });
      }
      // Every data route refuses the stale token on its first attempt.
      return countFor(url) === 1
        ? respond(config, 401, { code: "SESSION_EXPIRED", message: "expired" })
        : respond(config, 200, `${url}:ok`);
    };

    const customers = api.get("/customers");
    const products = api.get("/products");

    // Both original requests must have failed before the renewal is allowed to
    // answer — otherwise this cannot distinguish 1 shared refresh from 2 lucky ones.
    await vi.waitFor(() => expect(countFor("/customers") + countFor("/products")).toBe(2));
    hold.release();

    const [first, second] = await Promise.all([customers, products]);

    expect(countFor("/auth/refresh")).toBe(1);
    expect(first.data).toBe("/customers:ok");
    expect(second.data).toBe("/products:ok");

    // The replays carried the renewed access token, not the stale one.
    const replayed = calls.filter((call) => call.auth === "Bearer access-2");
    expect(replayed).toHaveLength(2);
    // The stale token went out on the original pair — and on the refresh call,
    // which is deliberately unauthenticated — but never on a data replay.
    expect(
      calls.filter((call) => call.auth === "Bearer access-1" && call.url !== "/auth/refresh"),
    ).toHaveLength(2);

    expect(getRefreshToken()).toBe(RENEWED.refreshToken);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("when the renewal fails", () => {
  it("clears the session and sends the user to login with their place kept", async () => {
    setSession(STALE);
    handler = async (config) => {
      if ((config.url ?? "") === "/auth/refresh") {
        return respond(config, 401, { code: "SESSION_INVALIDATED", message: "revoked" });
      }
      return respond(config, 401, { code: "SESSION_EXPIRED", message: "expired" });
    };

    await expect(api.get("/customers")).rejects.toThrow();

    expect(countFor("/auth/refresh")).toBe(1);
    expect(getRefreshToken()).toBeNull();
    expect(assign).toHaveBeenCalledWith("/login?next=%2Fcustomers%3Fpage%3D2");
  });
});

describe("when the renewal is not appropriate", () => {
  it("neither renews nor redirects on a 401 that arrived with no session", async () => {
    // The login form's own `INVALID_CREDENTIALS`: there is no session to renew,
    // so a refresh attempt would be wrong and a redirect would loop.
    clearSession();
    handler = async (config) =>
      respond(config, 401, { code: "INVALID_CREDENTIALS", message: "That email and password…" });

    await expect(api.post("/auth/login", {})).rejects.toThrow();

    expect(countFor("/auth/refresh")).toBe(0);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("replay safety", () => {
  it("replays at most once, so a persistently refused request cannot loop", async () => {
    setSession(STALE);
    handler = async (config) => {
      if ((config.url ?? "") === "/auth/refresh") {
        return respond(config, 200, { data: RENEWED });
      }
      // Refuses both the original and the replay.
      return respond(config, 401, { code: "SESSION_INVALIDATED", message: "revoked" });
    };

    await expect(api.get("/customers")).rejects.toThrow();

    expect(countFor("/auth/refresh")).toBe(1);
    expect(countFor("/customers")).toBe(2); // original + exactly one replay
  });
});

describe("downloadFile", () => {
  const create = vi.fn(() => "blob:frozen-export");
  const revoke = vi.fn();
  /** What the anchor looked like at the moment the browser was asked to save it. */
  let clicked: { href: string | null; download: string; attached: boolean }[] = [];

  beforeEach(() => {
    create.mockClear();
    revoke.mockClear();
    clicked = [];
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    // jsdom has no download machinery: record the anchor instead of navigating.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({
        href: this.getAttribute("href"),
        download: this.download,
        attached: document.body.contains(this),
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fetches the export as a blob under the filename the server chose", async () => {
    let responseType: string | undefined;
    handler = async (config) => {
      responseType = config.responseType;
      return {
        ...respond(config, 200, new Blob(["frozen"])),
        headers: { "content-disposition": 'attachment; filename="payroll-2026-09.xlsx"' },
      };
    };

    await expect(
      downloadFile("/payroll-close/2026-09/exports/ledger.csv", { staffId: "staff-a" }),
    ).resolves.toBe("payroll-2026-09.xlsx");

    // A salary export must never be decoded as JSON text on the way in, and the
    // filter has to reach the server: the CSV is filtered, not filtered client-side.
    expect(responseType).toBe("blob");
    expect(calls.at(-1)?.url).toBe("/payroll-close/2026-09/exports/ledger.csv?staffId=staff-a");
    expect(create).toHaveBeenCalledWith(expect.any(Blob));
    expect(clicked).toEqual([
      { href: "blob:frozen-export", download: "payroll-2026-09.xlsx", attached: true },
    ]);
    // The anchor must not survive the click, and the object URL must be released.
    expect(document.querySelectorAll("a")).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revoke).toHaveBeenCalledWith("blob:frozen-export");
  });

  it("falls back to the caller's name when the server sends no disposition", async () => {
    handler = async (config) => respond(config, 200, new Blob(["frozen"]));

    await expect(
      downloadFile("/payroll-close/2026-09/exports/payslips.pdf", undefined, "payroll"),
    ).resolves.toBe("payroll");
    expect(clicked[0]?.download).toBe("payroll");
  });
});

describe("getPaginated", () => {
  it("unwraps the envelope the list routes wrap the page in", async () => {
    // What every list route actually puts on the wire: the page — rows plus its own
    // `total`, `page`, `pageSize`, `pageCount` — nested one level inside the
    // `ApiResponse` envelope. Handed the body raw, the normaliser read the
    // *envelope* as the page: no array, no `total`, so twelve products rendered as
    // "No products yet" with `total: 0`, HTTP 200 and nothing in the console.
    handler = async (config) =>
      respond(config, 200, {
        data: { data: [{ id: "p1" }], total: 12, page: 1, pageSize: 20, pageCount: 1 },
      });

    await expect(getPaginated<{ id: string }>("/products")).resolves.toEqual({
      data: [{ id: "p1" }],
      total: 12,
      page: 1,
      pageSize: 20,
      pageCount: 1,
    });
  });

  it("leaves a page whose rows are already flattened alone", async () => {
    // Unwrapping twice would take the rows away — `{ data: [...] }` is the shape
    // `normalisePaginated` reads, not an envelope around one.
    handler = async (config) =>
      respond(config, 200, {
        data: [{ id: "p1" }],
        total: 1,
        page: 1,
        pageSize: 20,
        pageCount: 1,
      });

    await expect(getPaginated<{ id: string }>("/products")).resolves.toEqual({
      data: [{ id: "p1" }],
      total: 1,
      page: 1,
      pageSize: 20,
      pageCount: 1,
    });
  });

  it("still accepts a bare collection inside the envelope", async () => {
    handler = async (config) => respond(config, 200, { data: { items: [{ id: "p1" }] } });

    await expect(getPaginated<{ id: string }>("/products")).resolves.toEqual({
      data: [{ id: "p1" }],
      total: 1,
      page: 1,
      pageSize: 1,
      pageCount: 1,
    });
  });

  it("honours the caller's own data key after unwrapping", async () => {
    handler = async (config) =>
      respond(config, 200, { data: { rows: [{ id: "p1" }], total: 1, pageSize: 20 } });

    await expect(getPaginated<{ id: string }>("/products", undefined, "rows")).resolves.toEqual({
      data: [{ id: "p1" }],
      total: 1,
      page: 1,
      pageSize: 20,
      pageCount: 1,
    });
  });

  it("reads an empty list as empty rather than as malformed", async () => {
    handler = async (config) =>
      respond(config, 200, { data: { data: [], total: 0, page: 1, pageSize: 20, pageCount: 0 } });

    await expect(getPaginated<{ id: string }>("/products")).resolves.toEqual({
      data: [],
      total: 0,
      page: 1,
      pageSize: 20,
      pageCount: 0,
    });
  });
});
