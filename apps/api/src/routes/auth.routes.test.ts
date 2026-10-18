import "dotenv/config";

import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import {
  CORE_MODULE_CODES,
  MODULE_CODES,
  type AuthProfile,
  type AuthSession,
} from "@glampro_suite/shared";

/**
 * Integration tests for the web session endpoints.
 *
 * `dotenv/config` is imported **statically and first** on purpose: the gate below
 * reads `process.env` at module scope, and every other suite in the API gets that
 * value for free by importing `lib/prisma.js` statically. This file deliberately
 * imports the app *dynamically* (so `app.js` always receives a DATABASE_URL), which
 * would otherwise leave the gate reading a variable that is set a few lines later —
 * a suite that skips without saying so, because node does not count the children of
 * a skipped `describe`.
 *
 * The gate is read *before* the defaults are applied: the suite only runs when a
 * real database was offered, but `app.js` fails fast on a missing DATABASE_URL at
 * import time, so the dynamic imports below always receive one.
 */
const databaseUrl = process.env["DATABASE_URL"];
process.env.DATABASE_URL ??= "postgresql://glampro:glampro@127.0.0.1:5432/glampro_test";
process.env.JWT_SECRET ??= "auth-routes-test-secret";
process.env.NODE_ENV = "test";

const { createApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { runAsPlatform } = await import("../lib/tenant-context.js");
const { hashPassword } = await import("../lib/password.js");

const PASSWORD = "correct-horse-1";
const NEW_PASSWORD = "brand-new-pass-9";
const DOMAIN = "auth-rt.test";

/** One tenant per stored/effective status the login path has to distinguish. */
const TENANTS = {
  active: "authrt-active-tenant",
  suspended: "authrt-suspended-tenant",
  expired: "authrt-expired-tenant",
  lapsed: "authrt-lapsed-tenant",
} as const;
const TENANT_IDS = Object.values(TENANTS);

/** Everyone in the fixture shares one password, so a hash is computed once. */
const USERS = [
  {
    tenantId: TENANTS.active,
    email: `owner@${DOMAIN}`,
    name: "Auth RT Owner",
    globalRole: "MANAGER" as const,
  },
  {
    tenantId: TENANTS.active,
    email: `rotate@${DOMAIN}`,
    name: "Auth RT Rotate",
    globalRole: "STAFF" as const,
  },
  {
    tenantId: TENANTS.active,
    email: `chpw@${DOMAIN}`,
    name: "Auth RT Chpw",
    globalRole: "MANAGER" as const,
  },
  {
    tenantId: TENANTS.suspended,
    email: `susp@${DOMAIN}`,
    name: "Auth RT Susp",
    globalRole: "MANAGER" as const,
  },
  {
    tenantId: TENANTS.expired,
    email: `exp@${DOMAIN}`,
    name: "Auth RT Exp",
    globalRole: "MANAGER" as const,
  },
  {
    tenantId: TENANTS.lapsed,
    email: `lapse@${DOMAIN}`,
    name: "Auth RT Lapse",
    globalRole: "MANAGER" as const,
  },
];

/** Removes everything this file created, so runs are repeatable. */
async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { endsWith: `@${DOMAIN}` } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await prisma.subscription.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.tenant.deleteMany({ where: { id: { in: TENANT_IDS } } });
  });
}

/** Recreates the four tenants, their users, and the module catalogue. */
async function seed(): Promise<void> {
  const passwordHash = await hashPassword(PASSWORD);

  await runAsPlatform(async () => {
    await prisma.tenant.create({
      data: { id: TENANTS.active, name: "Auth RT Active", slug: "authrt-active" },
    });
    await prisma.tenant.create({
      data: {
        id: TENANTS.suspended,
        name: "Auth RT Suspended",
        slug: "authrt-suspended",
        status: "SUSPENDED",
      },
    });
    await prisma.tenant.create({
      data: {
        id: TENANTS.expired,
        name: "Auth RT Expired",
        slug: "authrt-expired",
        status: "EXPIRED",
      },
    });
    await prisma.tenant.create({
      data: { id: TENANTS.lapsed, name: "Auth RT Lapsed", slug: "authrt-lapsed" },
    });

    // Stored status ACTIVE, but the subscription period already ended: the
    // effective status must come out as EXPIRED.
    await prisma.subscription.create({
      data: {
        tenantId: TENANTS.lapsed,
        startDate: new Date(Date.now() - 30 * 86_400_000),
        endDate: new Date(Date.now() - 86_400_000),
        amount: 49,
      },
    });

    for (const user of USERS) {
      await prisma.user.create({ data: { ...user, passwordHash } });
    }

    for (const [index, code] of MODULE_CODES.entries()) {
      const isCore = (CORE_MODULE_CODES as readonly string[]).includes(code);
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
}

/** Thin helpers so each assertion names the shape it expects. */
interface Envelope {
  data?: unknown;
  statusCode?: number;
  message?: string;
  code?: string;
}

async function envelope(response: Response): Promise<Envelope> {
  return (await response.json()) as Envelope;
}

async function dataOf<T>(response: Response): Promise<T> {
  const body = await envelope(response);
  assert.ok(body.data !== undefined, `expected a data envelope, got ${JSON.stringify(body)}`);
  return body.data as T;
}

let baseUrl = "";
let server: Server | undefined;

async function post(path: string, body: unknown, accessToken?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function me(accessToken: string | undefined): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/me`, {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

/** Signs in with an explicit password; the only way back in after a password change. */
async function loginWith(email: string, password: string): Promise<Response> {
  return post("/api/auth/login", { email, password });
}

/** Opens a login session for a fixture user; returns the raw response. */
async function login(email: string, realm?: string): Promise<Response> {
  const body: Record<string, string> = { email, password: PASSWORD };
  if (realm) {
    body["realm"] = realm;
  }
  return post("/api/auth/login", body);
}

describe("web session endpoints", { skip: databaseUrl ? false : "DATABASE_URL is not set" }, () => {
  before(async () => {
    await purge();
    await seed();

    await new Promise<void>((resolve) => {
      server = createApp().listen(0, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server?.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await purge();
    await prisma.$disconnect();
  });

  describe("POST /api/auth/login", () => {
    it("rejects a wrong password with INVALID_CREDENTIALS", async () => {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `owner@${DOMAIN}`, password: "definitely-wrong-1" }),
      });

      assert.equal(response.status, 401);
      assert.equal((await envelope(response)).code, "INVALID_CREDENTIALS");
    });

    it("answers an unknown email the same way, so accounts cannot be enumerated", async () => {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `nobody@${DOMAIN}`, password: PASSWORD }),
      });

      assert.equal(response.status, 401);
      assert.equal((await envelope(response)).code, "INVALID_CREDENTIALS");
    });

    it("refuses a realm that does not sign in through this endpoint", async () => {
      const response = await login(`owner@${DOMAIN}`, "pos");

      assert.equal(response.status, 403);
      assert.equal((await envelope(response)).code, "REALM_NOT_SUPPORTED");
    });

    it("locks out a tenant whose stored status is EXPIRED", async () => {
      const response = await login(`exp@${DOMAIN}`);

      assert.equal(response.status, 403);
      assert.equal((await envelope(response)).code, "TENANT_EXPIRED");
    });

    it("locks out a tenant whose subscription has lapsed", async () => {
      const response = await login(`lapse@${DOMAIN}`);

      assert.equal(response.status, 403);
      assert.equal((await envelope(response)).code, "TENANT_EXPIRED");
    });

    it("issues a session carrying the tenant", async () => {
      const session = await dataOf<AuthSession>(await login(`owner@${DOMAIN}`));

      assert.equal(typeof session.accessToken, "string");
      assert.equal(typeof session.refreshToken, "string");
      assert.ok(session.expiresIn > 0);
      assert.equal(session.user.tenantId, TENANTS.active);
      assert.equal(session.user.email, `owner@${DOMAIN}`);
    });
  });

  describe("GET /api/auth/me", () => {
    it("refuses a request that carries no token", async () => {
      const response = await me(undefined);

      assert.equal(response.status, 401);
      assert.equal((await envelope(response)).code, "UNAUTHORIZED");
    });

    it("refuses a token whose signature does not verify", async () => {
      const session = await dataOf<AuthSession>(await login(`owner@${DOMAIN}`));
      // Replace the last character rather than appending to it, so the tamper is real
      // even when the signature happens to end in the replacement character.
      const last = session.accessToken.slice(-1);
      const tampered = `${session.accessToken.slice(0, -1)}${last === "A" ? "B" : "A"}`;

      const response = await me(tampered);

      assert.equal(response.status, 401);
      assert.equal((await envelope(response)).code, "SESSION_INVALIDATED");
    });

    it("answers with the user, the salon's effective status and the core entitlements", async () => {
      const session = await dataOf<AuthSession>(await login(`owner@${DOMAIN}`));
      const profile = await dataOf<AuthProfile>(await me(session.accessToken));

      assert.equal(profile.user.email, `owner@${DOMAIN}`);
      assert.equal(profile.user.tenantId, TENANTS.active);
      assert.equal(profile.tenant.id, TENANTS.active);
      assert.equal(profile.tenant.status, "ACTIVE");

      const codes = profile.entitlements.map((entitlement) => entitlement.code);
      for (const core of CORE_MODULE_CODES) {
        assert.ok(codes.includes(core), `the profile is missing the core module ${core}`);
      }
    });
  });

  describe("a suspended salon", () => {
    it("signs in and reads, so the owner can see why it is suspended", async () => {
      const session = await dataOf<AuthSession>(await login(`susp@${DOMAIN}`));
      const profile = await dataOf<AuthProfile>(await me(session.accessToken));

      assert.equal(profile.tenant.status, "SUSPENDED");
    });

    it("is refused every write", async () => {
      const session = await dataOf<AuthSession>(await login(`susp@${DOMAIN}`));

      const response = await post(
        "/api/auth/change-password",
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        session.accessToken,
      );

      assert.equal(response.status, 403);
      assert.equal((await envelope(response)).code, "TENANT_SUSPENDED");
    });
  });

  describe("POST /api/auth/refresh", () => {
    it("refuses a token it never issued", async () => {
      const response = await post("/api/auth/refresh", { refreshToken: "not-a-token-we-issued" });

      assert.equal(response.status, 401);
      assert.equal((await envelope(response)).code, "SESSION_INVALIDATED");
    });

    it("rotates the token and refuses the one it replaced", async () => {
      const first = await dataOf<AuthSession>(await login(`rotate@${DOMAIN}`));

      const rotated = await dataOf<AuthSession>(
        await post("/api/auth/refresh", { refreshToken: first.refreshToken }),
      );

      assert.notEqual(rotated.refreshToken, first.refreshToken);
      assert.equal(rotated.user.email, `rotate@${DOMAIN}`);

      const replay = await post("/api/auth/refresh", { refreshToken: first.refreshToken });
      assert.equal(replay.status, 401);
      assert.equal((await envelope(replay)).code, "SESSION_INVALIDATED");

      // A replay is refused, but per ADR 0007 it is not treated as theft of the
      // whole family: a dead token presented by one client must not sign the
      // legitimate holder of the rotated pair out of their other devices.
      // Family revocation happens only through password change or forced sign-out.
      const rotatedStillValid = await post("/api/auth/refresh", {
        refreshToken: rotated.refreshToken,
      });
      assert.equal(rotatedStillValid.status, 200);
    });
  });

  describe("POST /api/auth/logout", () => {
    it("revokes the presented token without needing an access token", async () => {
      const session = await dataOf<AuthSession>(await login(`owner@${DOMAIN}`));

      const response = await post("/api/auth/logout", { refreshToken: session.refreshToken });
      assert.equal(response.status, 200);
      assert.equal((await dataOf<{ success: boolean }>(response)).success, true);

      const afterLogout = await post("/api/auth/refresh", { refreshToken: session.refreshToken });
      assert.equal(afterLogout.status, 401);
      assert.equal((await envelope(afterLogout)).code, "SESSION_INVALIDATED");
    });

    it("is idempotent, so ending an already-dead session is not an error", async () => {
      const session = await dataOf<AuthSession>(await login(`owner@${DOMAIN}`));
      const body = { refreshToken: session.refreshToken };

      assert.equal((await post("/api/auth/logout", body)).status, 200);
      assert.equal((await post("/api/auth/logout", body)).status, 200);
    });

    it("ends the session, not the user: the access token survives to its expiry", async () => {
      const session = await dataOf<AuthSession>(await login(`owner@${DOMAIN}`));

      await post("/api/auth/logout", { refreshToken: session.refreshToken });

      // ADR 0007: logout revokes the refresh row and leaves `tokenVersion` alone, so
      // the client discards the access token and it expires within its 15-minute
      // lifetime. Other devices on the same user stay signed in.
      assert.equal((await me(session.accessToken)).status, 200);
    });
  });

  describe("POST /api/auth/change-password", () => {
    it("requires an access token", async () => {
      const response = await post("/api/auth/change-password", {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      });

      assert.equal(response.status, 401);
    });

    it("refuses a wrong current password", async () => {
      const session = await dataOf<AuthSession>(await login(`chpw@${DOMAIN}`));

      const response = await post(
        "/api/auth/change-password",
        { currentPassword: "not-the-current-password", newPassword: NEW_PASSWORD },
        session.accessToken,
      );

      assert.equal(response.status, 401);
      assert.equal((await envelope(response)).code, "INVALID_CREDENTIALS");
    });

    it("ends every session, including the caller's, and accepts only the new password", async () => {
      const session = await dataOf<AuthSession>(await login(`chpw@${DOMAIN}`));

      const changed = await post(
        "/api/auth/change-password",
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        session.accessToken,
      );
      assert.equal(changed.status, 200);
      assert.equal((await dataOf<{ success: boolean }>(changed)).success, true);

      // The access token that made the call is already dead: `tokenVersion` moved.
      const afterChange = await me(session.accessToken);
      assert.equal(afterChange.status, 401);
      assert.equal((await envelope(afterChange)).code, "SESSION_INVALIDATED");

      // ...and its refresh row was revoked, so it cannot be exchanged either.
      const refreshAfterChange = await post("/api/auth/refresh", {
        refreshToken: session.refreshToken,
      });
      assert.equal(refreshAfterChange.status, 401);

      // The old password is refused; the new one opens a session.
      assert.equal((await loginWith(`chpw@${DOMAIN}`, PASSWORD)).status, 401);
      const relogin = await loginWith(`chpw@${DOMAIN}`, NEW_PASSWORD);
      assert.equal(relogin.status, 200);
      assert.equal((await dataOf<AuthSession>(relogin)).user.email, `chpw@${DOMAIN}`);
    });
  });
});
