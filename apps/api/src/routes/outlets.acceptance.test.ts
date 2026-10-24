import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { CORE_MODULE_CODES } from "@glampro_suite/shared";

test(
  "outlet HTTP selection, shared stock, holds, permissions and consolidated reporting",
  { skip: process.env.OUTLET_ACCEPTANCE !== "1" },
  async (t) => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55448");
    assert.equal(url.pathname, "/outlet_test");
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "outlet-disposable-acceptance-secret";
    const { prisma } = await import("../lib/prisma.js");
    const { runAsPlatform, runAsTenant, runAtOutlet } = await import("../lib/tenant-context.js");
    const { signAccessToken } = await import("../lib/tokens.js");
    const { createApp } = await import("../app.js");
    const ids = ["outlet-http-a", "outlet-http-b"];
    const tenantId = ids[0]!;
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const purge = () =>
      runAsPlatform(async () => {
        // RESTRICT outlet links must be removed before cascading the tenant.
        await prisma.sale.deleteMany({ where: { tenantId: { in: ids } } });
        await prisma.product.deleteMany({ where: { tenantId: { in: ids } } });
        await prisma.package.deleteMany({ where: { tenantId: { in: ids } } });
        await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
        await prisma.outlet.deleteMany({ where: { tenantId: { in: ids } } });
        await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
      });
    try {
      await purge();
      const fixture = await runAsPlatform(async () => {
        for (const id of ids) await prisma.tenant.create({ data: { id, name: id, slug: id } });
        const manager = await prisma.user.create({
          data: {
            tenantId,
            name: "Manager",
            email: "manager@outlet-http.test",
            passwordHash: "unused",
            globalRole: "MANAGER",
          },
        });
        const staff = await prisma.user.create({
          data: {
            tenantId,
            name: "Staff",
            email: "staff@outlet-http.test",
            passwordHash: "unused",
            globalRole: "STAFF",
          },
        });
        for (const code of [
          "sales",
          "catalogue",
          "customers",
          "packages",
          "dashboard",
          "reports",
        ]) {
          const module = await prisma.module.upsert({
            where: { code },
            update: { isCore: (CORE_MODULE_CODES as readonly string[]).includes(code) },
            create: {
              code,
              name: code,
              category: "Test",
              isCore: (CORE_MODULE_CODES as readonly string[]).includes(code),
            },
          });
          await prisma.tenantModule.create({ data: { tenantId, moduleId: module.id } });
        }
        const a = await prisma.outlet.create({
          data: { tenantId, name: "Central", slug: "central" },
        });
        const b = await prisma.outlet.create({ data: { tenantId, name: "East", slug: "east" } });
        const suspended = await prisma.outlet.create({
          data: { tenantId, name: "Closed", slug: "closed", status: "SUSPENDED" },
        });
        const foreign = await prisma.outlet.create({
          data: { tenantId: ids[1]!, name: "Foreign", slug: "central" },
        });
        const shared = await prisma.product.create({
          data: { tenantId, name: "Shared", memberPrice: 10, nonmemberPrice: 10, quantity: 4 },
        });
        const privateProduct = await prisma.product.create({
          data: {
            tenantId,
            name: "East only",
            memberPrice: 20,
            nonmemberPrice: 20,
            quantity: 5,
            outletId: b.id,
          },
        });
        const customer = await prisma.customer.create({
          data: {
            tenantId,
            name: "Shared Customer",
            email: "customer@outlet-http.test",
            outletId: b.id,
            familyId: "family",
          },
        });
        const pack = await prisma.package.create({
          data: {
            tenantId,
            name: "Shared Package",
            memberPrice: 10,
            nonmemberPrice: 10,
            sessionCount: 2,
          },
        });
        return { manager, staff, a, b, suspended, foreign, shared, privateProduct, customer, pack };
      });
      function token(user = fixture.manager) {
        return signAccessToken({
          id: user.id,
          email: user.email!,
          globalRole: user.globalRole,
          realm: "web",
          tenantId,
          tokenVersion: user.tokenVersion,
        }).token;
      }
      async function request(
        path: string,
        outlet?: string,
        method = "GET",
        body?: unknown,
        user = fixture.manager,
      ) {
        const response = await fetch(`${base}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${token(user)}`,
            "content-type": "application/json",
            ...(outlet === undefined ? {} : { "x-outlet-id": outlet }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const json = await response.json();
        return { status: response.status, body: json };
      }
      const cart = (quantity = 1, key?: string) => ({
        lines: [{ itemType: "PRODUCT", itemId: fixture.shared.id, quantity }],
        payments: [{ method: "CASH", amount: quantity * 10 }],
        ...(key ? { idempotencyKey: key } : {}),
      });
      await t.test("valid, absent, malformed, suspended and foreign outlet selection", async () => {
        assert.equal((await request("/outlets")).status, 200);
        assert.equal((await request("/products", fixture.a.id)).status, 200);
        assert.equal((await request("/products", fixture.foreign.id)).status, 404);
        assert.equal((await request("/products", "missing")).status, 404);
        assert.equal((await request("/products", "bad outlet")).status, 422);
        assert.equal((await request("/products", fixture.suspended.id)).status, 403);
        const anonymous = await fetch(`${base}/outlets`);
        assert.equal(anonymous.status, 401);
        const list = await request("/outlets");
        assert.equal(list.body.data.length, 3);
        assert.equal(
          list.body.data.some((row: { id: string }) => row.id === fixture.foreign.id),
          false,
        );
      });
      await t.test(
        "company roles govern outlet management; assignment validates tenant ownership",
        async () => {
          assert.equal(
            (
              await request(
                "/outlets",
                undefined,
                "POST",
                { name: "Denied", slug: "denied" },
                fixture.staff,
              )
            ).status,
            403,
          );
          assert.equal(
            (await request("/outlets", undefined, "POST", { name: "North", slug: "north" })).status,
            201,
          );
          assert.equal(
            (await request("/outlets", undefined, "POST", { name: "Duplicate", slug: "north" }))
              .status,
            409,
          );
          assert.equal(
            (
              await request(`/outlets/${fixture.foreign.id}`, undefined, "PATCH", {
                name: "Forged",
              })
            ).status,
            404,
          );
          assert.equal(
            (
              await request("/outlets/assign", undefined, "POST", {
                kind: "PRODUCT",
                id: fixture.shared.id,
                outletId: fixture.foreign.id,
              })
            ).status,
            404,
          );
        },
      );
      await t.test(
        "customer identity stays shared; catalogue includes global but not another branch",
        async () => {
          const customers = await request("/customers", fixture.a.id);
          assert.equal(customers.status, 200);
          assert.equal(customers.body.data.data[0].id, fixture.customer.id);
          const products = await request("/products", fixture.a.id);
          assert.deepEqual(
            products.body.data.data.map((row: { id: string }) => row.id),
            [fixture.shared.id],
          );
          assert.equal(
            (await request(`/products/${fixture.privateProduct.id}`, fixture.a.id)).status,
            404,
          );
          const packages = await request("/packages", fixture.a.id);
          assert.equal(packages.status, 200);
          assert.equal(packages.body.data.data[0].id, fixture.pack.id);
          assert.equal(
            (await request(`/products/${fixture.privateProduct.id}`, fixture.b.id)).status,
            200,
          );
        },
      );
      let saleA = "";
      let saleB = "";
      await t.test("sales snapshot validated outlet and share one guarded stock pool", async () => {
        const a = await request("/sales", fixture.a.id, "POST", cart(2, "outlet-http-key-a"));
        assert.equal(a.status, 201, JSON.stringify(a.body));
        saleA = a.body.data.id;
        assert.equal(a.body.data.outletId, fixture.a.id);
        const b = await request("/sales", fixture.b.id, "POST", cart(1, "outlet-http-key-b"));
        assert.equal(b.status, 201, JSON.stringify(b.body));
        saleB = b.body.data.id;
        assert.equal((await request(`/sales/${saleA}`, fixture.b.id)).status, 404);
        assert.equal((await request("/sales", fixture.a.id, "POST", cart(2))).status, 400);
        const product = await request(`/products/${fixture.shared.id}`, fixture.b.id);
        assert.equal(product.body.data.quantity, 1);
        const replay = await request("/sales", fixture.a.id, "POST", cart(2, "outlet-http-key-a"));
        assert.equal(replay.body.data.id, saleA);
        const wrongBranchReplay = await request(
          "/sales",
          fixture.b.id,
          "POST",
          cart(1, "outlet-http-key-a"),
        );
        assert.equal(wrongBranchReplay.status, 409);
        assert.equal(wrongBranchReplay.body.code, "IDEMPOTENCY_OUTLET_MISMATCH");
      });
      await t.test("branch and consolidated dashboard and close reconcile", async () => {
        const a = await request("/reports/dashboard", fixture.a.id);
        const b = await request("/reports/dashboard", fixture.b.id);
        const all = await request("/reports/dashboard");
        assert.equal(a.status, 200, JSON.stringify(a.body));
        assert.equal(a.body.data.salesToday, 1);
        assert.equal(b.body.data.salesToday, 1);
        assert.equal(all.body.data.salesToday, 2);
        assert.equal(
          Number(all.body.data.incomeToday),
          Number(a.body.data.incomeToday) + Number(b.body.data.incomeToday),
        );
        const date = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Singapore",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());
        const closeA = await request(
          `/reports/z-report?date=${date}&timeZone=Asia%2FSingapore`,
          fixture.a.id,
        );
        const closeAll = await request(`/reports/z-report?date=${date}&timeZone=Asia%2FSingapore`);
        assert.equal(closeA.status, 200, JSON.stringify(closeA.body));
        assert.equal(Number(closeA.body.data.totals.netSales), 20);
        assert.equal(Number(closeAll.body.data.totals.netSales), 30);
      });
      await t.test("holds cannot be completed in another outlet", async () => {
        const held = await request("/sales", fixture.a.id, "POST", {
          ...cart(),
          hold: true,
          payments: [],
        });
        assert.equal(held.status, 201, JSON.stringify(held.body));
        assert.equal(
          (await request(`/sales/${held.body.data.id}/complete`, fixture.b.id, "POST", cart()))
            .status,
          404,
        );
        const done = await request(
          `/sales/${held.body.data.id}/complete`,
          fixture.a.id,
          "POST",
          cart(),
        );
        assert.equal(done.status, 200, JSON.stringify(done.body));
        assert.equal(done.body.data.outletId, fixture.a.id);
      });
      await t.test("runtime relation scoping and stock reversal after reassignment", async () => {
        const counts = await runAsTenant(tenantId, () =>
          runAtOutlet(fixture.a.id, async () => ({
            sales: await prisma.sale.count(),
            lines: await prisma.saleLine.count(),
            payments: await prisma.salePayment.count(),
          })),
        );
        assert.equal(counts.sales, 2);
        assert.equal(counts.lines, 2);
        assert.equal(counts.payments, 2);
        assert.equal(
          (
            await request("/outlets/assign", undefined, "POST", {
              kind: "PRODUCT",
              id: fixture.shared.id,
              outletId: fixture.b.id,
            })
          ).status,
          200,
        );
        const voided = await request(`/sales/${saleA}/void`, fixture.a.id, "POST", {
          reason: "Acceptance reversal",
        });
        assert.equal(voided.status, 200, JSON.stringify(voided.body));
        const product = await request(`/products/${fixture.shared.id}`, fixture.b.id);
        assert.equal(product.body.data.quantity, 2);
        assert.equal((await request(`/sales/${saleB}`, fixture.a.id)).status, 404);
      });
      await t.test("refunds are branch-bound and shared stock is restored once", async () => {
        const refund = {
          reason: "Acceptance refund",
          restock: true,
          payouts: [{ method: "CASH", amount: 10 }],
        };
        assert.equal(
          (await request(`/sales/${saleB}/refund`, fixture.a.id, "POST", refund)).status,
          404,
        );
        assert.equal(
          (await request(`/sales/${saleB}/refund`, fixture.b.id, "POST", refund)).status,
          200,
        );
        assert.equal(
          (await request(`/sales/${saleB}/refund`, fixture.b.id, "POST", refund)).status,
          200,
        );
        assert.equal(
          (await request(`/products/${fixture.shared.id}`, fixture.b.id)).body.data.quantity,
          3,
        );
        assert.equal(
          await runAsTenant(tenantId, () =>
            runAtOutlet(fixture.a.id, () => prisma.saleRefund.count()),
          ),
          0,
        );
        assert.equal(
          await runAsTenant(tenantId, () =>
            runAtOutlet(fixture.b.id, () => prisma.saleRefund.count()),
          ),
          1,
        );
      });
      await t.test("concurrent tills cannot oversell the shared pool", async () => {
        await runAsPlatform(() =>
          prisma.product.update({
            where: { id: fixture.shared.id },
            data: { quantity: 1, outletId: null },
          }),
        );
        const results = await Promise.all([
          request("/sales", fixture.a.id, "POST", cart(1, "outlet-http-race-a")),
          request("/sales", fixture.b.id, "POST", cart(1, "outlet-http-race-b")),
        ]);
        assert.equal(
          results.filter((result) => result.status === 201).length,
          1,
          JSON.stringify(results),
        );
        assert.ok(results.some((result) => [400, 409].includes(result.status)));
        assert.equal(
          (await request(`/products/${fixture.shared.id}`, fixture.a.id)).body.data.quantity,
          0,
        );
      });
      await t.test(
        "tenant-wide sales keep null attribution and appear only in consolidated totals",
        async () => {
          await runAsPlatform(() =>
            prisma.product.update({ where: { id: fixture.shared.id }, data: { quantity: 1 } }),
          );
          const unassigned = await request("/sales", undefined, "POST", cart());
          assert.equal(unassigned.status, 201, JSON.stringify(unassigned.body));
          assert.equal(unassigned.body.data.outletId, null);
          assert.equal(
            (await request(`/sales/${unassigned.body.data.id}`, fixture.a.id)).status,
            404,
          );
          assert.equal((await request(`/sales/${unassigned.body.data.id}`)).status, 200);
        },
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await purge();
      await prisma.$disconnect();
    }
  },
);
