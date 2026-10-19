import "dotenv/config";

import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

const databaseUrl = process.env["DATABASE_URL"];
process.env.DATABASE_URL ??= "postgresql://glampro:glampro@127.0.0.1:5432/glampro_test";
process.env.JWT_SECRET ??= "reports-routes-test-secret";
process.env.NODE_ENV = "test";

const { createApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { runAsPlatform } = await import("../lib/tenant-context.js");
const { hashPassword } = await import("../lib/password.js");
const { CORE_MODULE_CODES, MODULE_CODES } = await import("@glampro_suite/shared");

const PASSWORD = "correct-horse-1";
const DOMAIN = "reports-rt.test";
const TENANT_A = "reports-a";
const TENANT_B = "reports-b";
const TENANT_IDS = [TENANT_A, TENANT_B];
const EMAIL = `owner@${DOMAIN}`;

interface ErrorEnvelope {
  code?: string;
  details?: { path?: string }[];
}

interface OverviewBody {
  totals: { revenue: string; paid: string; tax: string; sales: number; items: number };
  salesByDay: {
    date: string;
    sales: number;
    quantity: number;
    revenue: string;
    paid: string;
    tax: string;
  }[];
  topItems: { itemName: string; quantity: number; revenue: string }[];
  staffPerformance: {
    userId: string;
    name: string;
    position: string | null;
    creditedLines: number;
    revenue: string;
  }[];
}

async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    await prisma.tenantModule.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.tenant.deleteMany({ where: { id: { in: TENANT_IDS } } });
  });
}

async function seed(): Promise<void> {
  const passwordHash = await hashPassword(PASSWORD);

  await runAsPlatform(async () => {
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

    await prisma.tenant.create({ data: { id: TENANT_A, name: "Reports A", slug: TENANT_A } });
    await prisma.tenant.create({ data: { id: TENANT_B, name: "Reports B", slug: TENANT_B } });

    const owner = await prisma.user.create({
      data: {
        tenantId: TENANT_A,
        email: EMAIL,
        name: "Ola Owner",
        position: "Director",
        passwordHash,
        globalRole: "SUPER_ADMIN",
      },
    });
    const stylist = await prisma.user.create({
      data: {
        tenantId: TENANT_A,
        email: `stylist@${DOMAIN}`,
        name: "Stella Stylist",
        position: "Senior stylist",
        passwordHash,
      },
    });
    const foreign = await prisma.user.create({
      data: {
        tenantId: TENANT_B,
        email: `foreign@${DOMAIN}`,
        name: "Foreign Owner",
        passwordHash,
        globalRole: "SUPER_ADMIN",
      },
    });

    const first = await prisma.sale.create({
      data: {
        tenantId: TENANT_A,
        staffId: owner.id,
        status: "COMPLETED",
        totalQuantity: 3,
        totalAmount: "80.00",
        paidAmount: "70.00",
        taxAmount: "6.61",
        taxRate: "9.00",
        paymentStatus: "UNPAID",
        soldAt: new Date("2026-10-02T01:00:00.000Z"),
      },
    });
    const second = await prisma.sale.create({
      data: {
        tenantId: TENANT_A,
        staffId: owner.id,
        status: "COMPLETED",
        totalQuantity: 1,
        totalAmount: "25.00",
        paidAmount: "25.00",
        taxAmount: "2.06",
        taxRate: "9.00",
        paymentStatus: "PAID",
        soldAt: new Date("2026-10-02T18:00:00.000Z"),
      },
    });
    const voided = await prisma.sale.create({
      data: {
        tenantId: TENANT_A,
        staffId: owner.id,
        status: "VOID",
        totalQuantity: 99,
        totalAmount: "999.00",
        paidAmount: "999.00",
        paymentStatus: "PAID",
        soldAt: new Date("2026-10-02T19:00:00.000Z"),
      },
    });
    const other = await prisma.sale.create({
      data: {
        tenantId: TENANT_B,
        staffId: foreign.id,
        status: "COMPLETED",
        totalQuantity: 7,
        totalAmount: "700.00",
        paidAmount: "700.00",
        paymentStatus: "PAID",
        soldAt: new Date("2026-10-02T18:00:00.000Z"),
      },
    });

    await prisma.saleLine.createMany({
      data: [
        {
          tenantId: TENANT_A,
          saleId: first.id,
          itemType: "SERVICE",
          itemId: "cut",
          itemName: "Signature cut",
          quantity: 2,
          unitPrice: "30.00",
          lineTotal: "60.00",
          staffId: stylist.id,
        },
        {
          tenantId: TENANT_A,
          saleId: first.id,
          itemType: "PRODUCT",
          itemId: "oil",
          itemName: "Hair oil",
          quantity: 1,
          unitPrice: "20.00",
          lineTotal: "20.00",
        },
        {
          tenantId: TENANT_A,
          saleId: second.id,
          itemType: "SERVICE",
          itemId: "cut",
          itemName: "Signature cut",
          quantity: 1,
          unitPrice: "25.00",
          lineTotal: "25.00",
          staffId: stylist.id,
        },
        {
          tenantId: TENANT_A,
          saleId: voided.id,
          itemType: "SERVICE",
          itemId: "void",
          itemName: "Voided service",
          quantity: 99,
          unitPrice: "10.09",
          lineTotal: "999.00",
        },
        {
          tenantId: TENANT_B,
          saleId: other.id,
          itemType: "SERVICE",
          itemId: "foreign",
          itemName: "Foreign service",
          quantity: 7,
          unitPrice: "100.00",
          lineTotal: "700.00",
          staffId: foreign.id,
        },
      ],
    });

    await prisma.employeePerformance.createMany({
      data: [
        {
          tenantId: TENANT_A,
          userId: stylist.id,
          saleId: first.id,
          itemType: "SERVICE",
          itemId: "cut",
          amount: "60.00",
        },
        {
          tenantId: TENANT_A,
          userId: stylist.id,
          saleId: second.id,
          itemType: "SERVICE",
          itemId: "cut",
          amount: "25.00",
        },
        {
          tenantId: TENANT_B,
          userId: foreign.id,
          saleId: other.id,
          itemType: "SERVICE",
          itemId: "foreign",
          amount: "700.00",
        },
      ],
    });
  });
}

async function grantReports(): Promise<void> {
  await runAsPlatform(async () => {
    const module = await prisma.module.findUniqueOrThrow({ where: { code: "reports" } });
    await prisma.tenantModule.create({ data: { tenantId: TENANT_A, moduleId: module.id } });
  });
}

async function dataOf<T>(response: Response): Promise<T> {
  return ((await response.json()) as { data: T }).data;
}

let baseUrl = "";
let server: Server | undefined;
let token = "";

function request(path: string, accessToken?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

describe("reports endpoints", { skip: databaseUrl ? false : "DATABASE_URL is not set" }, () => {
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
    assert.equal(response.status, 200);
    token = (await dataOf<{ accessToken: string }>(response)).accessToken;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await purge();
  });

  it("mounts both reads behind auth", async () => {
    assert.equal((await request("/api/reports/dashboard")).status, 401);
    assert.equal((await request("/api/reports/overview")).status, 401);
  });

  it("keeps the dashboard core while the overview needs the reports add-on", async () => {
    const dashboard = await request("/api/reports/dashboard", token);
    const overview = await request(
      "/api/reports/overview?from=2026-10-01T00:00:00.000Z&to=2026-10-03T23:59:59.999Z&timeZone=UTC",
      token,
    );

    assert.equal(dashboard.status, 200);
    assert.equal(overview.status, 403);
    assert.equal(((await overview.json()) as ErrorEnvelope).code, "MODULE_NOT_ENTITLED");
  });

  it("returns a field-addressable 422 for a reversed range", async () => {
    await grantReports();
    const response = await request(
      "/api/reports/overview?from=2026-10-03T00:00:00.000Z&to=2026-10-01T00:00:00.000Z&timeZone=UTC",
      token,
    );
    const body = (await response.json()) as ErrorEnvelope;

    assert.equal(response.status, 422);
    assert.ok(body.details?.some((detail) => detail.path === "query.to"));
  });

  it("scopes, totals and groups the range in the supplied timezone", async () => {
    const response = await request(
      "/api/reports/overview?from=2026-10-01T00:00:00.000Z&to=2026-10-03T23:59:59.999Z&timeZone=America%2FNew_York",
      token,
    );
    const body = await dataOf<OverviewBody>(response);

    assert.equal(response.status, 200);
    assert.deepEqual(body.totals, {
      revenue: "105.00",
      paid: "95.00",
      tax: "8.67",
      sales: 2,
      items: 4,
    });
    assert.deepEqual(body.salesByDay, [
      { date: "2026-10-01", sales: 1, quantity: 3, revenue: "80.00", paid: "70.00", tax: "6.61" },
      { date: "2026-10-02", sales: 1, quantity: 1, revenue: "25.00", paid: "25.00", tax: "2.06" },
    ]);
    assert.deepEqual(body.topItems, [
      {
        itemType: "SERVICE",
        itemId: "cut",
        itemName: "Signature cut",
        quantity: 3,
        revenue: "85.00",
      },
      {
        itemType: "PRODUCT",
        itemId: "oil",
        itemName: "Hair oil",
        quantity: 1,
        revenue: "20.00",
      },
    ]);
    assert.deepEqual(body.staffPerformance, [
      {
        userId: body.staffPerformance[0]?.userId,
        name: "Stella Stylist",
        position: "Senior stylist",
        creditedLines: 2,
        revenue: "85.00",
      },
    ]);
  });
});
