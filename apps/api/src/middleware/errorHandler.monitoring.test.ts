import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { ZodError } from "zod";

import { HttpError } from "../lib/http-error.js";
import { errorHandler } from "./errorHandler.js";

const captured: unknown[] = [];
Sentry.init({
  dsn: "https://public@example.test/1",
  defaultIntegrations: false,
  beforeSend: (event) => {
    captured.push(event);
    return null;
  },
});
after(async () => {
  await Sentry.close();
});

async function handle(error: unknown): Promise<number> {
  let status = 0;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  };
  errorHandler(
    error,
    { method: "GET", path: "/api/test" } as Request,
    res as unknown as Response,
    () => {},
  );
  await Sentry.flush();
  return status;
}

test("expected HTTP/validation/conflict errors do not report to Sentry", async () => {
  for (const [error, status] of [
    [new HttpError(403, "Denied"), 403],
    [new ZodError([]), 422],
    [{ code: "P2002" }, 409],
  ] as const)
    assert.equal(await handle(error), status);
  assert.equal(captured.length, 0);
});

test("unexpected and explicit server errors report once without changing responses", async () => {
  assert.equal(await handle(new Error("unexpected")), 500);
  assert.equal(captured.length, 1);
  assert.equal(await handle(new HttpError(503, "Unavailable")), 503);
  assert.equal(captured.length, 2);
});
