// Static, so the `DATABASE_URL` gate below reads `.env` instead of skipping silently.
import "dotenv/config";

import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

/**
 * `GET /api/customers/:id/holdings` — what a customer can still spend (TK2610-0011).
 *
 * The till's payment sheet calls this before it offers a package or credit tender, so
 * three things are asserted over HTTP rather than in the service:
 *
 * - **Only spendable credit comes back.** An exhausted holding and an expired one are
 *   left out, because the picker's job is to offer something that will work.
 * - **Both ledgers arrive in one list**, with the tender that spends each of them.
 * - **Another salon's customer is simply not found**, never "forbidden" — the same rule
 *   the detail route keeps.
 *
 * Gated on `DATABASE_URL`, like the other route suites: it creates a salon, signs in
 * for real and removes everything it made.
 */
const databaseUrl = process.env["DATABASE_URL"];
process.env.DATABASE_URL ??= "postgresql://glampro:glampro@127.0.0.1:5432/glampro_test";
process.env.JWT_SECRET ??= "customers-holdings-routes-test-secret";
process.env.NODE_ENV = "test";

const { createApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { runAsPlatform } = await import("../lib/tenant-context.js");
const { hashPassword } = await import("../lib/password.js");
const { CORE_MODULE_CODES, MODULE_CODES } = await import("@glampro_suite/shared");

const PASSWORD = "correct-horse-1";
const DOMAIN = "customers-holdings-rt.test";

const TENANTS = { a: "customers-holdings-a", b: "customers-holdings-b" } as const;
const TENANT_IDS = Object.values(TENANTS);

const EMAIL = `owner@${DOMAIN}`;

/** The ids the assertions need, filled by `seed`. */
const IDS = { customer: "", otherCustomer: "", foreignCustomer: "" };

/** Removes everything this file created, so runs are repeatable. */
async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    await prisma.tenant.deleteMany({ where: { id: { in: TENANT_IDS } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  });
}

/**
 * Two salons. A has a customer with one live package, one exhausted package, one
 * expired package and two value-package holdings; B has a customer of its own.
 */
async function seed(): Promise<void> {
  const passwordHash = await hashPassword(PASSWORD);

  await runAsPlatform(async () => {
    await prisma.tenant.create({
      data: { id: TENANTS.a, name: "Holdings A", slug: "customers-holdings-a" },
    });
    await prisma.tenant.create({
      data: { id: TENANTS.b, name: "Holdings B", slug: "customers-holdings-b" },
    });

    await prisma.user.create({
      data: {
        tenantId: TENANTS.a,
        email: EMAIL,
        name: "Ola Owner",
        passwordHash,
        globalRole: "SUPER_ADMIN",
      },
    });

    // `requireModule` refuses an unknown module loudly, so the catalogue is seeded the
    // way the real seed does it — `isCore` derived from the shared constant.
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

    const service = await prisma.service.create({
      data: {
        tenantId: TENANTS.a,
        name: "Cut",
        memberPrice: "40.00",
        nonmemberPrice: "50.00",
      },
    });

    const bundle = await prisma.package.create({
      data: {
        tenantId: TENANTS.a,
        name: "Aloha Bundle",
        sessionCount: 8,
        memberPrice: "250.00",
        nonmemberPrice: "300.00",
      },
    });
    await prisma.packageService.create({
      data: { tenantId: TENANTS.a, packageId: bundle.id, serviceId: service.id },
    });

    const prepaid = await prisma.valuePackage.create({
      data: {
        tenantId: TENANTS.a,
        name: "Prepaid Credit",
        price: "100.00",
        credit: "120.00",
      },
    });

    const customer = await prisma.customer.create({
      data: { tenantId: TENANTS.a, name: "Mei Ling", email: `mei@${DOMAIN}` },
    });
    IDS.customer = customer.id;

    await prisma.customerPackageHolding.create({
      data: {
        tenantId: TENANTS.a,
        customerId: customer.id,
        packageId: bundle.id,
        quantity: 8,
        quantityRemaining: 3,
      },
    });
    // Spent out: not offered.
    await prisma.customerPackageHolding.create({
      data: {
        tenantId: TENANTS.a,
        customerId: customer.id,
        packageId: bundle.id,
        quantity: 4,
        quantityRemaining: 0,
      },
    });
    // Expired in 2020: not offered either.
    await prisma.customerPackageHolding.create({
      data: {
        tenantId: TENANTS.a,
        customerId: customer.id,
        packageId: bundle.id,
        quantity: 2,
        quantityRemaining: 2,
        expiresAt: new Date("2020-01-01T00:00:00Z"),
      },
    });

    await prisma.customerValuePackageHolding.create({
      data: {
        tenantId: TENANTS.a,
        customerId: customer.id,
        valuePackageId: prepaid.id,
        amount: "120.00",
        amountRemaining: "42.50",
      },
    });
    await prisma.customerValuePackageHolding.create({
      data: {
        tenantId: TENANTS.a,
        customerId: customer.id,
        valuePackageId: prepaid.id,
        amount: "50.00",
        amountRemaining: "0.00",
      },
    });

    const foreign = await prisma.customer.create({
      data: { tenantId: TENANTS.b, name: "Someone Else", email: `else@${DOMAIN}` },
    });
    IDS.foreignCustomer = foreign.id;

    const other = await prisma.customer.create({
      data: { tenantId: TENANTS.a, name: "Noor", email: `noor@${DOMAIN}` },
    });
    IDS.otherCustomer = other.id;
  });
}

interface Envelope {
  data?: unknown;
  message?: string;
  code?: string;
}

interface HoldingRow {
  id: string;
  kind: string;
  name: string;
  serviceIds: string[];
  quantityRemaining: number;
  amountRemaining: string | null;
  expiresAt: string | null;
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

async function request(method: "GET", path: string, accessToken?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

describe(
  "customer holdings endpoint",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    let token = "";

    before(async () => {
      await purge();
      await seed();

      await new Promise<void>((resolve) => {
        server = createApp().listen(0, "127.0.0.1", () => resolve());
      });
      baseUrl = `http://127.0.0.1:${(server?.address() as AddressInfo).port}`;

      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      });
      assert.equal(response.status, 200, "could not sign in as the owner");
      token = (await dataOf<{ accessToken: string }>(response)).accessToken;
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
    });

    it("requires a token", async () => {
      const response = await request("GET", `/api/customers/${IDS.customer}/holdings`);
      assert.equal(response.status, 401, "the route is mounted behind auth");
    });

    it("returns the live package and credit, and leaves the spent and expired out", async () => {
      const response = await request("GET", `/api/customers/${IDS.customer}/holdings`, token);
      assert.equal(response.status, 200);

      const { holdings } = await dataOf<{ holdings: HoldingRow[] }>(response);

      // One live package (3 sessions left) and one credit holding (42.50 left). The
      // exhausted package, the expired package and the empty credit are absent.
      assert.equal(holdings.length, 2);

      const bundle = holdings.find((holding) => holding.kind === "PACKAGE");
      assert.ok(bundle, `expected a package holding, got ${JSON.stringify(holdings)}`);
      assert.equal(bundle.name, "Aloha Bundle");
      assert.equal(bundle.quantityRemaining, 3);
      assert.equal(bundle.amountRemaining, null);
      assert.equal(bundle.expiresAt, null);
      // The service the package may be spent on, which is what the till matches a cart
      // line against.
      assert.equal(bundle.serviceIds.length, 1);

      const credit = holdings.find((holding) => holding.kind === "PREPAID_CREDIT");
      assert.ok(credit, `expected a credit holding, got ${JSON.stringify(holdings)}`);
      assert.equal(credit.name, "Prepaid Credit");
      assert.equal(credit.amountRemaining, "42.50", "money is a string on the wire");
      assert.equal(credit.quantityRemaining, 0);
      // Credit is fungible, so it restricts nothing.
      assert.deepEqual(credit.serviceIds, []);
    });

    it("answers with an empty list for a customer who has nothing", async () => {
      const response = await request("GET", `/api/customers/${IDS.otherCustomer}/holdings`, token);
      assert.equal(response.status, 200);

      const { holdings } = await dataOf<{ holdings: HoldingRow[] }>(response);
      assert.deepEqual(holdings, []);
    });

    it("does not find another salon's customer", async () => {
      const response = await request(
        "GET",
        `/api/customers/${IDS.foreignCustomer}/holdings`,
        token,
      );
      const body = await envelope(response);

      assert.equal(response.status, 404);
      assert.equal(body.code, "CUSTOMER_NOT_FOUND");
    });

    it("does not find a customer that never existed", async () => {
      const response = await request("GET", "/api/customers/no-such-customer/holdings", token);
      assert.equal(response.status, 404);
      assert.equal((await envelope(response)).code, "CUSTOMER_NOT_FOUND");
    });
  },
);
