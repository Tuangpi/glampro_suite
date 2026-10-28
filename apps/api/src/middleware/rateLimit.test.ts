import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, it } from "node:test";
import express from "express";
import { completeSaleSchema, createSaleSchema } from "@glampro_suite/shared";
import { runAsTenant } from "../lib/tenant-context.js";
import { managerPinLimiter } from "./rateLimit.js";
import { validate } from "./validate.js";

// Real HTTP/middleware coverage without app, auth, Prisma, dotenv or database imports.
let server: Server;
let base: string;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    runAsTenant(
      req.get("x-test-tenant") ?? "salon-a",
      next,
      req.get("x-test-actor") ?? "operator-a",
    );
  });
  for (const [path, schema] of [
    ["/sales", createSaleSchema],
    ["/sales/held/complete", completeSaleSchema],
  ] as const) {
    app.post(path, validate(schema), managerPinLimiter, (req, res) => {
      res.status(req.get("x-test-success") === "yes" ? 201 : 409).json({ code: "TEST_CHECKOUT" });
    });
  }
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function checkout(
  actor: string,
  options: {
    pin?: boolean;
    success?: boolean;
    complete?: boolean;
    tenant?: string;
    manager?: string;
  } = {},
) {
  const response = await fetch(`${base}${options.complete ? "/sales/held/complete" : "/sales"}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-actor": actor,
      "x-test-tenant": options.tenant ?? "salon-a",
      "x-test-success": options.success ? "yes" : "no",
    },
    body: JSON.stringify({
      lines: [{ itemType: "SERVICE", itemId: "cut", quantity: 1 }],
      payments: options.pin
        ? [
            {
              method: "PACKAGE",
              amount: 50,
              holdingId: "holding",
              unpaidSessionOverride: {
                managerId: options.manager ?? "manager-a",
                pin: "1234",
                reason: "Approved unpaid session",
              },
            },
          ]
        : [{ method: "CASH", amount: 50 }],
    }),
  });
  const body = (await response.json()) as { code: string };
  return { status: response.status, code: body.code };
}

it("non-PIN checkout failures do not consume the approval budget", async () => {
  for (let i = 0; i < 12; i++) assert.equal((await checkout("ordinary")).status, 409);
  for (let i = 0; i < 10; i++)
    assert.equal((await checkout("ordinary", { pin: true })).status, 409);
  assert.equal((await checkout("ordinary", { pin: true })).status, 429);
});

it("an exhausted approval budget does not block ordinary create or complete", async () => {
  for (let i = 0; i < 10; i++) await checkout("exhausted", { pin: true });
  assert.deepEqual(await checkout("exhausted", { pin: true }), {
    status: 429,
    code: "MANAGER_PIN_RATE_LIMITED",
  });
  for (const complete of [false, true]) {
    assert.equal((await checkout("exhausted", { success: true, complete })).status, 201);
  }
});

it("create and complete share the operator budget even when the manager changes", async () => {
  for (let i = 0; i < 10; i++) {
    assert.equal(
      (await checkout("shared", { pin: true, complete: i % 2 === 0, manager: `manager-${i}` }))
        .status,
      409,
    );
  }
  assert.equal((await checkout("shared", { pin: true, complete: true })).status, 429);
  assert.equal((await checkout("shared", { pin: true })).status, 429);
});

it("approval budgets are isolated by tenant and operator", async () => {
  for (let i = 0; i < 10; i++) await checkout("isolated", { pin: true });
  assert.equal((await checkout("isolated", { pin: true })).status, 429);
  assert.equal((await checkout("other-operator", { pin: true })).status, 409);
  assert.equal((await checkout("isolated", { pin: true, tenant: "salon-b" })).status, 409);
});

it("concurrent failed approval requests cannot exceed the operator budget", async () => {
  const results = await Promise.all(
    Array.from({ length: 14 }, (_, index) =>
      checkout("concurrent", { pin: true, complete: index % 2 === 0 }),
    ),
  );
  assert.equal(results.filter((result) => result.status === 409).length, 10);
  assert.equal(results.filter((result) => result.status === 429).length, 4);
  assert.equal((await checkout("concurrent", { success: true })).status, 201);
});

it("successful approval checkouts do not consume the failure budget", async () => {
  for (let i = 0; i < 12; i++) {
    assert.equal((await checkout("successful", { pin: true, success: true })).status, 201);
  }
  for (let i = 0; i < 10; i++)
    assert.equal((await checkout("successful", { pin: true })).status, 409);
  assert.equal((await checkout("successful", { pin: true })).status, 429);
});
