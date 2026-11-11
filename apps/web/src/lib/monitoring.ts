import * as Sentry from "@sentry/react";
import { sanitizeMonitoringEvent } from "@glampro_suite/shared/monitoring";

const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();

if (dsn && import.meta.env.MODE !== "test") {
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    defaultIntegrations: false,
    integrations: [Sentry.globalHandlersIntegration(), Sentry.dedupeIntegration()],
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
      frameContextLines: 0,
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
