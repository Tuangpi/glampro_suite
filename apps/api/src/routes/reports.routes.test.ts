import { loginForRouteTest } from "../test-support/route-login.js";
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
  totals: {
    revenue: string;
    paid: string;
    tax: string;
    discounts: string;
    sales: number;
    items: number;
  };
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
    commission: string;
  }[];
  serviceSales: { serviceId: string; name: string; quantity: number; revenue: string }[];
  tenders: { method: string; amount: string; redemption: boolean }[];
  liability: {
    packageSessions: { holdings: number; sessionsRemaining: number };
    prepaidCredit: { holdings: number; balance: string };
    giftCards: { holdings: number; balance: string };
    outstanding: { customers: number; balance: string };
    totalMoney: string;
    asOf: string;
  };
}

interface ZReportBody {
  date: string;
  timeZone: string;
  totals: {
    grossSales: string;
    discounts: string;
    netSales: string;
    tax: string;
    paid: string;
    collected: string;
    redeemed: string;
    sales: number;
    items: number;
  };
  tenders: { method: string; amount: string; redemption: boolean }[];
  voids: { count: number; amount: string };
  outstandingCreated: string;
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
        soldAt: new Date("2026-10-02T10:00:00.000Z"),
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
        voidedAt: new Date("2026-10-02T11:00:00.000Z"),
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
          unitPrice: "27.50",
          lineTotal: "55.00",
          discountAmount: "5.00",
          staffId: stylist.id,
        },
        {
          tenantId: TENANT_A,
          saleId: first.id,
          itemType: "PRODUCT",
          itemId: "oil",
          itemName: "Hair oil",
          quantity: 1,
          unitPrice: "25.00",
          lineTotal: "25.00",
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
          amount: "55.00",
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

    const customer = await prisma.customer.create({
      data: { tenantId: TENANT_A, name: "Cleo Customer" },
    });
    const secondCustomer = await prisma.customer.create({
      data: { tenantId: TENANT_A, name: "Ravi Regular" },
    });
    const packageRow = await prisma.package.create({
      data: {
        tenantId: TENANT_A,
        name: "Glow bundle",
        sessionCount: 5,
        memberPrice: "100.00",
        nonmemberPrice: "120.00",
      },
    });
    const valuePackage = await prisma.valuePackage.create({
      data: {
        tenantId: TENANT_A,
        name: "Prepaid 50",
        price: "45.00",
        credit: "50.00",
      },
    });
    const giftCard = await prisma.giftCard.create({
      data: { tenantId: TENANT_A, name: "Gift card", value: "15.00" },
    });

    await prisma.customerPackageHolding.createMany({
      data: [
        {
          tenantId: TENANT_A,
          customerId: customer.id,
          packageId: packageRow.id,
          quantity: 5,
          quantityRemaining: 4,
        },
        {
          tenantId: TENANT_A,
          customerId: customer.id,
          packageId: packageRow.id,
          quantity: 10,
          quantityRemaining: 9,
          expiresAt: new Date("2020-01-01T00:00:00.000Z"),
        },
        {
          tenantId: TENANT_A,
          customerId: customer.id,
          packageId: packageRow.id,
          quantity: 5,
          quantityRemaining: 0,
        },
      ],
    });
    await prisma.customerValuePackageHolding.createMany({
      data: [
        {
          tenantId: TENANT_A,
          customerId: customer.id,
          valuePackageId: valuePackage.id,
          amount: "50.00",
          amountRemaining: "40.00",
        },
        {
          tenantId: TENANT_A,
          customerId: customer.id,
          valuePackageId: valuePackage.id,
          amount: "50.00",
          amountRemaining: "20.00",
          expiresAt: new Date("2020-01-01T00:00:00.000Z"),
        },
      ],
    });
    await prisma.customerGiftCardHolding.create({
      data: {
        tenantId: TENANT_A,
        customerId: customer.id,
        giftCardId: giftCard.id,
        value: "15.00",
        valueRemaining: "15.00",
      },
    });

    await prisma.salePayment.createMany({
      data: [
        { tenantId: TENANT_A, saleId: first.id, method: "CARD", amount: "70.00" },
        { tenantId: TENANT_A, saleId: second.id, method: "CASH", amount: "25.00" },
      ],
    });
    await prisma.customerOutstanding.createMany({
      data: [
        { tenantId: TENANT_A, customerId: customer.id, saleId: first.id, unpaidAmount: "10.00" },
        { tenantId: TENANT_A, customerId: secondCustomer.id, unpaidAmount: "5.00" },
      ],
    });
    await prisma.employeeCommission.createMany({
      data: [
        { tenantId: TENANT_A, userId: stylist.id, saleId: first.id, rate: "5.00", amount: "3.00" },
        { tenantId: TENANT_A, userId: stylist.id, saleId: second.id, rate: "5.00", amount: "1.25" },
        {
          tenantId: TENANT_A,
          userId: stylist.id,
          rate: "2.00",
          amount: "2.00",
          createdAt: new Date("2026-10-02T09:00:00.000Z"),
        },
        {
          tenantId: TENANT_A,
          userId: stylist.id,
          rate: "50.00",
          amount: "99.00",
          createdAt: new Date("2026-09-02T09:00:00.000Z"),
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

    token = await loginForRouteTest(baseUrl, EMAIL, PASSWORD);
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await purge();
  });

  it("mounts every read behind auth", async () => {
    assert.equal((await request("/api/reports/dashboard")).status, 401);
    assert.equal((await request("/api/reports/overview")).status, 401);
    assert.equal((await request("/api/reports/z-report")).status, 401);
    assert.equal((await request("/api/reports/package-valuation")).status, 401);
  });

  it("keeps the dashboard core while the overview needs the reports add-on", async () => {
    const dashboard = await request("/api/reports/dashboard", token);
    const overview = await request(
      "/api/reports/overview?from=2026-10-01T00:00:00.000Z&to=2026-10-03T23:59:59.999Z&timeZone=UTC",
      token,
    );
    const close = await request("/api/reports/z-report?date=2026-10-02&timeZone=UTC", token);

    assert.equal(dashboard.status, 200);
    assert.equal(overview.status, 403);
    assert.equal(close.status, 403);
    assert.equal((await request("/api/reports/package-valuation", token)).status, 403);
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
      grossSales: "110.00",
      refunds: "0.00",
      commissionReconciliation: 0,
      revenue: "105.00",
      paid: "95.00",
      tax: "8.67",
      discounts: "5.00",
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
        revenue: "80.00",
      },
      {
        itemType: "PRODUCT",
        itemId: "oil",
        itemName: "Hair oil",
        quantity: 1,
        revenue: "25.00",
      },
    ]);
    assert.deepEqual(body.staffPerformance, [
      {
        userId: body.staffPerformance[0]?.userId,
        name: "Stella Stylist",
        position: "Senior stylist",
        creditedLines: 2,
        revenue: "80.00",
        commission: "6.25",
      },
    ]);
    assert.deepEqual(body.serviceSales, [
      { serviceId: "cut", name: "Signature cut", quantity: 3, revenue: "80.00" },
    ]);
    assert.deepEqual(body.tenders, [
      { method: "CASH", amount: "25.00", redemption: false },
      { method: "CARD", amount: "70.00", redemption: false },
    ]);
    assert.deepEqual(body.liability, {
      packageSessions: { holdings: 1, sessionsRemaining: 4 },
      prepaidCredit: { holdings: 1, balance: "40.00" },
      giftCards: { holdings: 1, balance: "15.00" },
      outstanding: { customers: 2, balance: "15.00" },
      totalMoney: "55.00",
      asOf: body.liability.asOf,
    });
    assert.ok(Number.isFinite(Date.parse(body.liability.asOf)));
  });

  it("reports legacy sessions as explicitly unvalued without activation or backfill", async () => {
    const { packageValuationReportSchema } = await import("@glampro_suite/shared");
    const response = await request("/api/reports/package-valuation", token);
    assert.equal(response.status, 200);
    const report = packageValuationReportSchema.parse(await dataOf(response));
    assert.equal(report.scope, "COMPANY");
    assert.equal(report.activation, null);
    assert.equal(report.active.net, "0.00");
    assert.equal(report.expired.net, "0.00");
    assert.ok(report.unvalued.active.sessionsRemaining > 0);
    assert.equal(report.reconciliation.purchases, 0);
  });

  it("returns current balances even for a historical range with no sales", async () => {
    const before = Date.now();
    const response = await request(
      "/api/reports/overview?from=2000-01-01T00:00:00.000Z&to=2000-01-02T00:00:00.000Z&timeZone=UTC",
      token,
    );
    const body = await dataOf<OverviewBody>(response);
    assert.equal(response.status, 200);
    assert.equal(body.totals.sales, 0);
    assert.equal(body.liability.prepaidCredit.balance, "40.00");
    assert.equal(body.liability.giftCards.balance, "15.00");
    assert.equal(body.liability.outstanding.balance, "15.00");
    assert.equal(body.liability.totalMoney, "55.00");
    assert.ok(Date.parse(body.liability.asOf) >= before);
    assert.ok(Date.parse(body.liability.asOf) <= Date.now());
  });

  it("draws the daily close in the salon's zone and separates collected from redeemed", async () => {
    const response = await request(
      "/api/reports/z-report?date=2026-10-02&timeZone=Asia%2FSingapore",
      token,
    );
    const body = await dataOf<ZReportBody>(response);

    assert.equal(response.status, 200);
    assert.equal(body.date, "2026-10-02");
    // 2026-10-02 00:00 SGT is 2026-10-01T16:00Z; the local day ends 24h later.
    assert.equal(body.totals.grossSales, "110.00");
    assert.equal(body.totals.discounts, "5.00");
    assert.equal(body.totals.netSales, "105.00");
    assert.equal(body.totals.tax, "8.67");
    assert.equal(body.totals.paid, "95.00");
    assert.equal(body.totals.collected, "95.00");
    assert.equal(body.totals.redeemed, "0.00");
    assert.equal(body.totals.sales, 2);
    assert.equal(body.totals.items, 4);
    assert.deepEqual(body.tenders, [
      { method: "CASH", amount: "25.00", redemption: false },
      { method: "CARD", amount: "70.00", redemption: false },
    ]);
    assert.deepEqual(body.voids, { count: 1, amount: "999.00" });
    assert.equal(body.outstandingCreated, "10.00");
  });

  it("rejects a date the calendar does not have and an unknown zone", async () => {
    const badDate = await request("/api/reports/z-report?date=2026-02-30&timeZone=UTC", token);
    const badZone = await request(
      "/api/reports/z-report?date=2026-10-02&timeZone=Mars%2FOlympus",
      token,
    );

    assert.equal(badDate.status, 422);
    assert.equal(badZone.status, 422);
    assert.equal(((await badZone.json()) as ErrorEnvelope).code, "VALIDATION_FAILED");
  });

  it("does not increase monetary liabilities when customer debt increases", async () => {
    const debt = await runAsPlatform(() =>
      prisma.customerOutstanding.findFirstOrThrow({
        where: { tenantId: TENANT_A },
      }),
    );
    try {
      await runAsPlatform(() =>
        prisma.customerOutstanding.update({
          where: { id: debt.id },
          data: { unpaidAmount: debt.unpaidAmount.add("100.01") },
        }),
      );
      const response = await request(
        "/api/reports/overview?from=2000-01-01T00:00:00.000Z&to=2000-01-02T00:00:00.000Z&timeZone=UTC",
        token,
      );
      const body = await dataOf<OverviewBody>(response);
      assert.equal(response.status, 200);
      assert.equal(body.liability.outstanding.balance, "115.01");
      assert.equal(body.liability.totalMoney, "55.00");
    } finally {
      await runAsPlatform(() =>
        prisma.customerOutstanding.update({
          where: { id: debt.id },
          data: { unpaidAmount: debt.unpaidAmount },
        }),
      );
    }
  });

  it("excludes expired gift cards and other tenants' debt from the snapshot", async () => {
    const gift = await runAsPlatform(() =>
      prisma.customerGiftCardHolding.findFirstOrThrow({
        where: { tenantId: TENANT_A },
      }),
    );
    let expiredId: string | undefined;
    let foreignId: string | undefined;
    try {
      await runAsPlatform(async () => {
        const expired = await prisma.customerGiftCardHolding.create({
          data: {
            tenantId: TENANT_A,
            customerId: gift.customerId,
            giftCardId: gift.giftCardId,
            value: "999.99",
            valueRemaining: "999.99",
            expiresAt: new Date("2000-01-01"),
          },
        });
        expiredId = expired.id;
        const foreign = await prisma.customer.create({
          data: { tenantId: TENANT_B, name: "Foreign debtor" },
        });
        foreignId = foreign.id;
        await prisma.customerOutstanding.create({
          data: {
            tenantId: TENANT_B,
            customerId: foreign.id,
            unpaidAmount: "999.99",
          },
        });
      });
      const response = await request(
        "/api/reports/overview?from=2000-01-01T00:00:00.000Z&to=2000-01-02T00:00:00.000Z&timeZone=UTC",
        token,
      );
      const body = await dataOf<OverviewBody>(response);
      assert.equal(response.status, 200);
      assert.deepEqual(body.liability.giftCards, { holdings: 1, balance: "15.00" });
      assert.deepEqual(body.liability.outstanding, { customers: 2, balance: "15.00" });
      assert.equal(body.liability.totalMoney, "55.00");
    } finally {
      await runAsPlatform(async () => {
        if (expiredId) await prisma.customerGiftCardHolding.delete({ where: { id: expiredId } });
        if (foreignId) await prisma.customer.delete({ where: { id: foreignId } });
      });
    }
  });
});
