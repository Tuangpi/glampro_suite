import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import type {
  ApiErrorBody,
  ApiResponse,
  AuthSession,
  PaginatedResponse,
  QueryParams,
} from "@glampro_suite/shared";

import { showToast } from "@/components/ui/toast-store";
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  setAuthNotice,
  setSession,
} from "@/lib/auth-storage";
import { normalisePaginated } from "@/lib/apiUtils";
import { clearPosIdentity, getPosIdentity } from "@/lib/pos-identity";

/**
 * Per-request flags the interceptors below set on the axios config.
 *
 * Declared here rather than as a global module augmentation so the contract is
 * visible where it is used and a typo is a type error.
 */
interface RequestFlags {
  /** The refresh call itself: a 401 there must not start another refresh. */
  _skipAuthRefresh?: boolean;
  /** Stops a replay whose renewed token is refused a second time. */
  _hasRetried?: boolean;
}

type FlaggedConfig = InternalAxiosRequestConfig & RequestFlags;

/** Carries `_skipAuthRefresh` through axios, which types its config narrowly. */
function flagged(flags: RequestFlags): AxiosRequestConfig {
  return flags as AxiosRequestConfig;
}

/**
 * The single axios instance for the whole app.
 *
 * `baseURL` is a same-origin `/api` in both development (Vite proxy) and
 * production (nginx), so no CORS configuration is needed in the browser.
 */
const api: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  timeout: 30_000,
});

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const identity = getPosIdentity();
  if (
    identity &&
    config.method === "post" &&
    (config.url === "/sales" || /^\/sales\/[^/]+\/complete$/.test(config.url ?? ""))
  ) {
    config.headers["x-pos-staff-token"] = identity.token;
  }
  return config;
});

/**
 * The one in-flight refresh, joined by every request that hits a 401.
 *
 * A screen that fires five queries at once would otherwise send five refreshes.
 * The server **rotates** the refresh token on every use, so the first rotation
 * makes the other four a replay — and a replay revokes the whole family
 * (`services/auth.service.ts`). One shared promise is the only correct shape:
 * every caller awaits the same renewal and the same stored token.
 */
let refreshInFlight: Promise<string> | null = null;

function refreshAccessToken(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        throw new Error("No refresh token is stored, so the session cannot be renewed.");
      }

      const response = await api.post<ApiResponse<AuthSession> | AuthSession>(
        "/auth/refresh",
        { refreshToken },
        flagged({ _skipAuthRefresh: true }),
      );
      const session = extractData<AuthSession>(response.data);
      setSession(session);
      return session.accessToken;
    })().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}

/** Sends a dead session to the login screen, remembering where it came from. */
function redirectToLogin(): void {
  if (window.location.pathname === "/login") return;

  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    const status: number | undefined = error.response?.status;
    const config = error.config as FlaggedConfig | undefined;
    const data = error.response?.data as Partial<ApiErrorBody> | undefined;

    // Renew once, then replay the original request exactly once. The access
    // token lives 15 minutes, so this is the difference between a screen that
    // quietly renews and one that dumps the user on the login page.
    if (
      status === 401 &&
      config &&
      !config._skipAuthRefresh &&
      !config._hasRetried &&
      getAccessToken()
    ) {
      config._hasRetried = true;
      try {
        config.headers.Authorization = `Bearer ${await refreshAccessToken()}`;
        return await api.request(config);
      } catch {
        // The renewal or the replay failed; fall through and end the session.
      }
    }

    if (status === 401) {
      clearPosIdentity();
      const hadToken = Boolean(getAccessToken());
      clearSession();

      if (hadToken) {
        if (data?.code === "SESSION_INVALIDATED" || data?.code === "SESSION_EXPIRED") {
          setAuthNotice(data.message ?? "Your session has expired. Please log in again.");
        }
        // A hard redirect, not a router navigate: the session is gone, so every
        // cached query and in-memory store is suspect. A full load also re-runs
        // the cold-start bootstrap on the login screen.
        redirectToLogin();
      }
    } else if (status !== undefined && status >= 500) {
      // Surface unexpected server failures globally; pages still handle their
      // own 4xx cases.
      showToast("error", data?.message ?? "An unexpected server error occurred. Please try again.");
    }

    return Promise.reject(error);
  },
);

export function buildQueryString(params?: QueryParams): string {
  if (!params) return "";

  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  });

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

/** GET returning unwrapped data (envelopes are transparently unwrapped). */
export async function get<T>(url: string, params?: QueryParams): Promise<T> {
  const response = await api.get<ApiResponse<T> | T>(url + buildQueryString(params));
  return extractData<T>(response.data);
}

/**
 * GET returning a `PaginatedResponse`, normalised from any supported shape.
 *
 * A list route answers `{ data: { data: [...], total, … } }` — the documented
 * `ApiResponse` envelope wrapped around the page, the same one wrap that `get`,
 * `post`, `patch` and `del` see through. Handing the body straight to the
 * normaliser made the *envelope* the page instead: `data` was not an array and no
 * `total` was visible, so every list in the app resolved to `data: []` with
 * `total: 0` — a salon with twelve products rendered as "No products yet", HTTP
 * 200, nothing logged.
 */
export async function getPaginated<T>(
  url: string,
  params?: QueryParams,
  dataKey = "data",
): Promise<PaginatedResponse<T>> {
  const response = await api.get<unknown>(url + buildQueryString(params));
  return normalisePaginated<T>(unwrapEnvelope(response.data), dataKey);
}

/**
 * Unwraps `{ data: T }` when `T` is the page, for `getPaginated`.
 *
 * Only a nested **object** is the envelope. A body whose `data` is already the row
 * array (`{ data: [...] }`) or a bare collection (`{ items: [...] }`) is the shape
 * `normalisePaginated` reads, so it is handed over untouched.
 */
function unwrapEnvelope(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== "object") return {};

  const inner = (payload as { data?: unknown }).data;
  return inner !== null && typeof inner === "object" && !Array.isArray(inner)
    ? (inner as Record<string, unknown>)
    : (payload as Record<string, unknown>);
}

export async function post<T>(url: string, data?: unknown): Promise<T> {
  const response = await api.post<ApiResponse<T> | T>(url, data);
  return extractData<T>(response.data);
}

export async function put<T>(url: string, data?: unknown): Promise<T> {
  const response = await api.put<ApiResponse<T> | T>(url, data);
  return extractData<T>(response.data);
}

export async function patch<T>(url: string, data?: unknown): Promise<T> {
  const response = await api.patch<ApiResponse<T> | T>(url, data);
  return extractData<T>(response.data);
}

export async function del<T>(url: string): Promise<T> {
  const response = await api.delete<ApiResponse<T> | T>(url);
  return extractData<T>(response.data);
}

/**
 * Unwraps `{ data: T }` when present, so endpoints may return either shape
 * while the mobile client keeps its historical contract.
 */
function extractData<T>(payload: ApiResponse<T> | T): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as ApiResponse<T>).data;
  }
  return payload as T;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null && "statusCode" in value && "message" in value;
}

/** Human-readable message for any thrown value (axios error, HttpError body, Error). */
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (isApiErrorBody(data)) return data.message;
    return error.message;
  }
  if (isApiErrorBody(error)) return error.message;
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred";
}

/**
 * The machine-readable error code (`INVALID_CREDENTIALS`, `TENANT_SUSPENDED`,
 * `SESSION_INVALIDATED`, …).
 *
 * Messages are for people and get localised and reworded; a screen branches on
 * the code, so this is how it tells "your salon is closed" apart from "that
 * password is wrong" without matching on copy.
 */
export function getErrorCode(error: unknown): string | undefined {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (typeof data === "object" && data !== null && "code" in data) {
      const { code } = data as { code?: unknown };
      return typeof code === "string" ? code : undefined;
    }
    return undefined;
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code?: unknown };
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** Field-level validation problems from a 422, keyed by dotted request path. */
export function getValidationDetails(error: unknown): Record<string, string> {
  if (!axios.isAxiosError(error)) return {};

  const details = (error.response?.data as Partial<ApiErrorBody> | undefined)?.details;
  if (!Array.isArray(details)) return {};

  return details.reduce<Record<string, string>>((accumulator, entry) => {
    if (entry && typeof entry === "object" && "path" in entry && "message" in entry) {
      const { path, message } = entry as { path: string; message: string };
      accumulator[path] = message;
    }
    return accumulator;
  }, {});
}

export default api;
