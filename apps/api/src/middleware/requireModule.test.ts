import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { CORE_MODULE_CODES } from "@glampro_suite/shared";
import express, { type Express } from "express";

import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { requireModule } from "./requireModule.js";

const databaseUrl = process.env["DATABASE_URL"];

const TENANT = "rm-test-tenant";
const CORE = CORE_MODULE_CODES[0];
const ADD_ON = "packages";
/** A second add-on, because its key is two words and its name is two words. */
const ADD_ON_GIFT_CARDS = "giftCards";

async function seed(): Promise<void> {
  // `TenantModule` is tenant-scoped, so setup writes through the platform scope
  // the way the seed script and the console would.
  await runAsPlatform(async () => {
    await prisma.tenantModule.deleteMany({ where: { tenantId: TENANT } });
    await prisma.tenant.deleteMany({ where: { id: TENANT } });
    await prisma.user.deleteMany({ where: { email: { contains: "@rm-test.local" } } });

    // Tenant first, then its owner user: `users.tenantId` and `tenants.ownerUserId`
    // point at each other, so neither row can be inserted before the other.
    await prisma.tenant.create({ data: { id: TENANT, name: "Rent Test", slug: "rm-test" } });

    const owner = await prisma.user.create({
      data: {
        tenantId: TENANT,
        email: `owner-${TENANT}@rm-test.local`,
        name: "Owner",
        passwordHash: "not-a-real-hash",
      },
    });

    await prisma.tenant.update({ where: { id: TENANT }, data: { ownerUserId: owner.id } });
  });
}

function appFor(code: string, scope: "tenant" | "platform" | "none"): Express {
  const app = express();

  // Stands in for `middleware/auth.ts`, which establishes the scope from the
  // verified token. The scope must be entered on the server side — wrapping the
  // outgoing `fetch` would not reach the handler's async context.
  const establishScope = (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ): void => {
    req.user = {
      id: "user-1",
      email: "a@b.test",
      name: "A",
      globalRole: "MANAGER",
      realm: "web",
      tokenVersion: 0,
      twoFactorEnabled: false,
    };

    if (scope === "tenant") {
      runAsTenant(TENANT, next);
      return;
    }
    if (scope === "platform") {
      runAsPlatform(next);
      return;
    }
    next();
  };

  app.use(establishScope);
  app.get("/guarded", requireModule(code));

  app.use((_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const httpError = error as HttpError;
      res.status(httpError.statusCode ?? 500).json({
        statusCode: httpError.statusCode ?? 500,
        // The app's own `errorHandler` sends `message` too; it is echoed here so a
        // test can assert *what a salon would read*, which is the whole point of the
        // copy in `requireModule`.
        message: httpError.message,
        code: httpError.code,
        details: httpError.details,
      });
    },
  );

  return app;
}

async function call(code: string, scope: "tenant" | "platform" | "none") {
  const server = await new Promise<Server>((resolve) => {
    const listener = appFor(code, scope).listen(0, "127.0.0.1", () => resolve(listener));
  });

  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/guarded`);

    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("requireModule", { skip: databaseUrl ? false : "DATABASE_URL is not set" }, () => {
  before(async () => {
    await seed();
    // The guard resolves modules from the seeded catalogue. The catalogue is shared by
    // every suite on this database, and `packages` is created as *core* by suites that
    // need the add-on to pass (e.g. `commission-collection-evidence.acceptance.test.ts`
    // upserts it with `update: {}`, so the first writer wins). These assertions are
    // about an add-on being refused, so this file states the core-ness it depends on
    // instead of inheriting whatever a parallel suite happened to leave behind.
    for (const [index, code] of [...CORE_MODULE_CODES, ADD_ON, ADD_ON_GIFT_CARDS].entries()) {
      const isCore = CORE_MODULE_CODES.includes(code as (typeof CORE_MODULE_CODES)[number]);

      await prisma.module.upsert({
        where: { code },
        update: { isCore },
        create: {
          code,
          name: code,
          category: isCore ? "Core" : "Add-on",
          isCore,
          sortOrder: index,
        },
      });
    }
  });

  after(async () => {
    await runAsPlatform(async () => {
      await prisma.tenantModule.deleteMany({ where: { tenantId: TENANT } });
      await prisma.tenant.deleteMany({ where: { id: TENANT } });
      await prisma.user.deleteMany({ where: { email: { contains: "@rm-test.local" } } });
    });
    await prisma.$disconnect();
  });

  it("lets a core module through without any entitlement row", async () => {
    assert.equal((await call(CORE, "tenant")).status, 200);
  });

  it("refuses an add-on the tenant has not bought", async () => {
    const { status, body } = await call(ADD_ON, "tenant");

    assert.equal(status, 403);
    assert.equal(body.code, "MODULE_NOT_ENTITLED");
    assert.deepEqual(body.details, { module: ADD_ON });
    // What the salon reads names the add-on the way the Modules panel does. The key
    // stays in `details` and in the log; it is not a word to put in a sentence
    // (P0-07).
    assert.equal(body.message, "This feature needs the Packages add-on.");
  });

  it("refuses a `giftCards` add-on under its display name too", async () => {
    const { body } = await call("giftCards", "tenant");

    assert.equal(body.message, "This feature needs the Gift cards add-on.");
    assert.deepEqual(body.details, { module: "giftCards" }, "details still carries the key");
  });

  it("allows an add-on once a TenantModule row exists", async () => {
    const module = await prisma.module.findFirstOrThrow({ where: { code: ADD_ON } });

    await runAsPlatform(() =>
      prisma.tenantModule.create({ data: { tenantId: TENANT, moduleId: module.id } }),
    );

    try {
      assert.equal((await call(ADD_ON, "tenant")).status, 200);
    } finally {
      await runAsPlatform(() => prisma.tenantModule.deleteMany({ where: { tenantId: TENANT } }));
    }
  });

  it("refuses an add-on whose entitlement has lapsed", async () => {
    const module = await prisma.module.findFirstOrThrow({ where: { code: ADD_ON } });

    await runAsPlatform(() =>
      prisma.tenantModule.create({
        data: {
          tenantId: TENANT,
          moduleId: module.id,
          expiresAt: new Date(Date.now() - 86_400_000),
        },
      }),
    );

    try {
      const { status, body } = await call(ADD_ON, "tenant");
      assert.equal(status, 403);
      assert.equal(body.code, "MODULE_NOT_ENTITLED");
    } finally {
      await runAsPlatform(() => prisma.tenantModule.deleteMany({ where: { tenantId: TENANT } }));
    }
  });

  it("refuses a typo'd module code rather than granting access", async () => {
    const { status, body } = await call("no-such-module", "tenant");

    assert.equal(status, 403);
    assert.equal(body.code, "MODULE_UNKNOWN");
    // The code goes to the log and to `details` for whoever fixes the seed; the
    // sentence a cashier would read must not say "Unknown module" and quote a key
    // (P0-07).
    assert.deepEqual(body.details, { module: "no-such-module" });
    assert.match(String(body.message), /unavailable/i);
    assert.doesNotMatch(String(body.message), /no-such-module/);
  });

  it("refuses outside a tenant context", async () => {
    const { status, body } = await call(CORE, "platform");

    assert.equal(status, 403);
    assert.equal(body.code, "TENANT_CONTEXT_REQUIRED");
  });
});
