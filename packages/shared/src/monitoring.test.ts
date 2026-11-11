import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeMonitoringEvent } from "./monitoring.js";

test("monitoring keeps stack locations but excludes all application/customer data", () => {
  const event = {
    event_id: "event",
    release: "v1.0.0",
    environment: "production",
    request: { headers: { authorization: "secret" }, data: "customer payment" },
    user: { email: "customer@example.test" },
    breadcrumbs: [{ message: "receipt-token" }],
    extra: { sql: "private query" },
    contexts: { customer: "private" },
    message: "customer@example.test",
    transaction: "/receipt/private-token",
    tags: { phone: "private" },
    server_name: "private-host",
    exception: {
      values: [
        {
          type: "PrivateCustomerError",
          value: "SQL customer@example.test",
          stacktrace: {
            frames: [
              {
                filename: "https://app.test/assets/app.js?token=secret#private",
                function: "save",
                lineno: 12,
                colno: 3,
                in_app: true,
                vars: { password: "private" },
                pre_context: ["private"],
              },
            ],
          },
        },
      ],
    },
  };
  const safe = sanitizeMonitoringEvent(event);
  assert.deepEqual(Object.keys(safe).sort(), ["environment", "event_id", "exception", "release"]);
  assert.deepEqual(safe.exception.values[0], {
    type: "Error",
    value: "Application error (details withheld)",
    stacktrace: {
      frames: [
        {
          filename: "https://app.test/assets/app.js",
          function: "save",
          lineno: 12,
          colno: 3,
          in_app: true,
        },
      ],
    },
  });
  assert.equal(event.exception.values[0].value, "SQL customer@example.test");
});

test("monitoring accepts events without exceptions or stack frames", () => {
  assert.deepEqual(sanitizeMonitoringEvent({}), {});
  assert.deepEqual(sanitizeMonitoringEvent({ exception: { values: [{ value: "secret" }] } }), {
    exception: {
      values: [
        { type: "Error", value: "Application error (details withheld)", stacktrace: undefined },
      ],
    },
  });
});

test("dynamic public link paths are not retained as stack filenames", () => {
  const safe = sanitizeMonitoringEvent({
    exception: {
      values: [
        {
          stacktrace: {
            frames: [{ filename: "https://app.test/api/public/messages/private-token" }],
          },
        },
      ],
    },
  });
  assert.equal(safe.exception.values[0].stacktrace?.frames?.[0].filename, "[redacted]");
});
