import "dotenv/config";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { CustomerConsent, PrivacyNotice } from "@glampro_suite/shared";

process.env.JWT_SECRET ??= "consent-routes-test-secret";
process.env.NODE_ENV = "test";
const { createApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { runAsPlatform } = await import("../lib/tenant-context.js");
const { hashPassword } = await import("../lib/password.js");
const tenantIds = ["consent-routes-a", "consent-routes-b"];
const noticeInput = {
  version: "v1",
  dataConsentText: "Approved purposes",
  marketingConsentText: "Optional marketing",
};
let base = "";
let server: Server;
let manager = "";
let staff = "";
let actorId = "";
let customer = "";
let foreign = "";
async function purge() {
  await runAsPlatform(async () => {
    await prisma.customerConsentEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  });
}
async function request(path: string, token?: string, body?: unknown) {
  return fetch(`${base}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function dataOf<T>(response: Response): Promise<T> {
  assert.ok(response.ok, `unexpected HTTP ${response.status}: ${await response.clone().text()}`);
  return ((await response.json()) as { data: T }).data;
}
describe(
  "consent HTTP permissions and validation",
  { skip: process.env.DATABASE_URL ? false : "DATABASE_URL not set" },
  () => {
    before(async () => {
      await purge();
      const passwordHash = await hashPassword("correct-horse-1");
      await runAsPlatform(async () => {
        for (const id of tenantIds)
          await prisma.tenant.create({ data: { id, name: id, slug: id } });
        for (const role of ["MANAGER", "STAFF"] as const) {
          const user = await prisma.user.create({
            data: {
              tenantId: tenantIds[0]!,
              email: `${role}@consent-routes.test`,
              name: role,
              globalRole: role,
              passwordHash,
            },
          });
          if (role === "STAFF") actorId = user.id;
        }
        await prisma.module.upsert({
          where: { code: "customers" },
          update: { isCore: true },
          create: { code: "customers", name: "Customers", category: "Core", isCore: true },
        });
        customer = (
          await prisma.customer.create({ data: { tenantId: tenantIds[0]!, name: "Customer" } })
        ).id;
        foreign = (
          await prisma.customer.create({ data: { tenantId: tenantIds[1]!, name: "Foreign" } })
        ).id;
      });
      server = createApp().listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.on("listening", resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      for (const role of ["MANAGER", "STAFF"]) {
        const response = await request("/auth/login", undefined, {
          email: `${role}@consent-routes.test`,
          password: "correct-horse-1",
        });
        const session = await dataOf<{ accessToken: string }>(response);
        if (role === "MANAGER") manager = session.accessToken;
        else staff = session.accessToken;
      }
    });
    after(async () => {
      if (server)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      await purge();
    });
    it("requires authentication and restricts publishing to managers", async () => {
      assert.equal((await request("/settings/privacy-notice")).status, 401);
      assert.equal((await request("/settings/privacy-notice", staff, noticeInput)).status, 403);
      assert.equal((await request(`/customers/${customer}/consent`)).status, 401);
      assert.equal(
        (
          await request("/settings/privacy-notice", manager, {
            ...noticeInput,
            dataConsentText: " ",
          })
        ).status,
        422,
      );
      const notice = await dataOf<PrivacyNotice>(
        await request("/settings/privacy-notice", manager, noticeInput),
      );
      assert.equal(notice.version, "v1");
      assert.equal((await request("/settings/privacy-notice", manager, noticeInput)).status, 409);
    });
    it("records staff choices without trusting client audit data", async () => {
      const notice = await dataOf<PrivacyNotice>(await request("/settings/privacy-notice", staff));
      const input = {
        pdpaConsent: true,
        marketingOptIn: false,
        expectedRevision: 0,
        noticeId: notice.id,
      };
      assert.equal(
        (
          await request(`/customers/${customer}/consent`, staff, {
            ...input,
            recordedById: "forged",
          })
        ).status,
        422,
      );
      assert.equal(
        (
          await request(`/customers/${customer}/consent`, staff, {
            ...input,
            pdpaConsent: false,
            marketingOptIn: true,
          })
        ).status,
        422,
      );
      const result = await dataOf<CustomerConsent>(
        await request(`/customers/${customer}/consent`, staff, input),
      );
      assert.equal(result.history[0]?.recordedById, actorId);
      assert.equal(result.pdpaConsent, true);
      assert.equal(result.marketingOptIn, false);
      assert.equal((await request(`/customers/${customer}/consent`, staff, input)).status, 409);
    });
    it("hides foreign customers and validates history pagination", async () => {
      assert.equal((await request(`/customers/${foreign}/consent`, staff)).status, 404);
      assert.equal(
        (
          await request(`/customers/${foreign}/consent`, staff, {
            pdpaConsent: false,
            marketingOptIn: false,
            expectedRevision: 0,
            noticeId: null,
          })
        ).status,
        404,
      );
      assert.equal((await request(`/customers/${customer}/consent?page=0`, staff)).status, 422);
    });
    it("refuses consent and notice writes when the tenant is read-only", async () => {
      // Keep tokens valid: this tests the write boundary, not token-version revocation.
      await runAsPlatform(() =>
        prisma.tenant.update({ where: { id: tenantIds[0]! }, data: { status: "SUSPENDED" } }),
      );
      assert.equal(
        (
          await request(`/customers/${customer}/consent`, staff, {
            pdpaConsent: false,
            marketingOptIn: false,
            expectedRevision: 1,
            noticeId: null,
          })
        ).status,
        403,
      );
      assert.equal(
        (await request("/settings/privacy-notice", manager, { ...noticeInput, version: "v2" }))
          .status,
        403,
      );
      assert.equal((await request(`/customers/${customer}/consent`, staff)).status, 200);
    });
  },
);
