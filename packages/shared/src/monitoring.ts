/** Minimal error-only telemetry contract shared by browser and server SDKs. */
interface MonitoringEvent {
  exception?: {
    values?: Array<{
      type?: string;
      value?: string;
      stacktrace?: {
        frames?: Array<{
          filename?: string;
          abs_path?: string;
          debug_id?: string;
          function?: string;
          lineno?: number;
          colno?: number;
          in_app?: boolean;
        }>;
      };
    }>;
  };
}

/**
 * Allowlist rather than redact: errors can contain SQL parameters, message links,
 * customer names or provider responses. Keep locations, never raw messages/data.
 */
export function sanitizeMonitoringEvent<T extends MonitoringEvent>(event: T): T {
  const safe = { ...event };
  const allowed = new Set([
    "event_id",
    "timestamp",
    "platform",
    "level",
    "release",
    "environment",
    "sdk",
    "debug_meta",
    "exception",
  ]);
  for (const key of Object.keys(safe)) {
    if (!allowed.has(key)) delete safe[key as keyof T];
  }
  if (event.exception) {
    safe.exception = {
      values: event.exception.values?.map((exception) => ({
        type: "Error",
        value: "Application error (details withheld)",
        stacktrace: exception.stacktrace && {
          frames: exception.stacktrace.frames?.map((frame) => ({
            // Drop queries/fragments, including public receipt/message link tokens.
            filename: safeFilename(frame.filename),
            ...(frame.abs_path ? { abs_path: safeFilename(frame.abs_path) } : {}),
            ...(frame.debug_id ? { debug_id: frame.debug_id } : {}),
            function: frame.function,
            lineno: frame.lineno,
            colno: frame.colno,
            in_app: frame.in_app,
          })),
        },
      })),
    };
  }
  return safe;
}

function safeFilename(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const path = filename.split(/[?#]/, 1)[0];
  // Dynamic route paths can themselves contain bearer tokens. Only retain code files.
  return /\.(?:[cm]?js|tsx?)$/.test(path) ? path : "[redacted]";
}
