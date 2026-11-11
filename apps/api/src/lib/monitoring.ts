import * as Sentry from "@sentry/node";
import { sanitizeMonitoringEvent } from "@glampro_suite/shared/monitoring";
import "dotenv/config";

const dsn = process.env.SENTRY_DSN?.trim();

// Explicit error reporting needs no Express/Prisma/OpenTelemetry instrumentation.
// This module has no application/database imports, so it can load before startup.
if (dsn && process.env.NODE_ENV !== "test") {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE || undefined,
    defaultIntegrations: false,
    integrations: [
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
    ],
    enableRuntimeChannelInjection: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
    },
    beforeSendLog: () => null,
    beforeSendMetric: () => null,
    maxBreadcrumbs: 0,
    beforeSend: sanitizeMonitoringEvent,
  });
}

export function captureUnexpectedError(error: unknown): void {
  if (Sentry.isEnabled()) Sentry.captureException(error);
}

export async function flushMonitoring(): Promise<void> {
  await Sentry.flush(2000);
}
