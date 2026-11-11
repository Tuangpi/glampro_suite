import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/react";

vi.mock("@sentry/react", () => ({
  init: vi.fn(),
  isEnabled: vi.fn(),
  captureException: vi.fn(),
  globalHandlersIntegration: vi.fn(() => ({ name: "GlobalHandlers" })),
  dedupeIntegration: vi.fn(() => ({ name: "Dedupe" })),
}));

describe("browser monitoring", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("does not initialize without a DSN or while running tests", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    await import("./monitoring");
    expect(Sentry.init).not.toHaveBeenCalled();
    vi.resetModules();
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.test/1");
    await import("./monitoring");
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("initializes error-only monitoring and forwards errors only when enabled", async () => {
    vi.stubEnv("MODE", "production");
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.test/1");
    vi.stubEnv("VITE_SENTRY_RELEASE", "v1.0.0");
    const { captureUnexpectedError } = await import("./monitoring");
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        release: "v1.0.0",
        defaultIntegrations: false,
        maxBreadcrumbs: 0,
        dataCollection: expect.objectContaining({ userInfo: false, httpBodies: [] }),
        beforeSend: expect.any(Function),
      }),
    );
    const error = new Error("private");
    vi.mocked(Sentry.isEnabled).mockReturnValue(false);
    captureUnexpectedError(error);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    vi.mocked(Sentry.isEnabled).mockReturnValue(true);
    captureUnexpectedError(error);
    expect(Sentry.captureException).toHaveBeenCalledExactlyOnceWith(error);
  });
});
