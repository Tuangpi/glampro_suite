import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test(
  "COMM-01 real HTTP permissions, rule history, tenant isolation and sale/refund snapshots",
  {
    skip: process.env.COMMISSION_ACCEPTANCE !== "1",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55443");
    assert.equal(url.pathname, "/commission_test");
    process.env.JWT_SECRET = "commission-disposable-test-secret";
    process.env.NODE_ENV = "test";
    const { prisma } = await import("../lib/prisma.js");
    const { runAsPlatform, runAsTenant } = await import("../lib/tenant-context.js");
    const { createApp } = await import("../app.js");
    const { signAccessToken } = await import("../lib/tokens.js");
    const { createSale, refundSale } = await import("../services/sale.service.js");
    const { updateStaff } = await import("../services/staff.service.js");
    const { commissionConfiguration, publishCommissionRule } =
      await import("../services/commission.service.js");
    const { publishCommissionRuleSchema } = await import("@glampro_suite/shared");
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/commissions`;
    const ids: string[] = [];
    async function call(path: string, token?: string, body?: object) {
      const response = await fetch(base + path, {
        method: body ? "POST" : "GET",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    }
    try {
      for (const code of ["staff", "sales", "catalogue"])
        await prisma.module.upsert({
          where: { code },
          update: { isCore: true },
          create: { code, name: code, category: "Core", isCore: true },
        });
      const a = await prisma.tenant.create({
        data: {
          name: "Commission A",
          slug: `comm-a-${randomUUID()}`,
          gstEnabled: true,
          gstRegistrationNumber: "M12345678X",
        },
      });
      ids.push(a.id);
      const b = await prisma.tenant.create({
        data: { name: "Commission B", slug: `comm-b-${randomUUID()}` },
      });
      ids.push(b.id);
      const makeUser = (tenantId: string, role: "MANAGER" | "STAFF") =>
        runAsTenant(tenantId, () =>
          prisma.user.create({
            data: {
              tenantId,
              name: role,
              email: `${randomUUID()}@commission.test`,
              passwordHash: "not-a-login-fixture",
              globalRole: role,
              commissionRate: 10,
            },
          }),
        );
      const manager = await makeUser(a.id, "MANAGER"),
        staff = await makeUser(a.id, "STAFF"),
        foreign = await makeUser(b.id, "MANAGER");
      const token = (user: typeof manager) =>
        signAccessToken({
          id: user.id,
          email: user.email!,
          globalRole: user.globalRole,
          tenantId: user.tenantId,
          tokenVersion: 0,
          realm: "web",
        }).token;
      const adminToken = token(manager),
        staffToken = token(staff),
        foreignToken = token(foreign);
      const { department, service, product } = await runAsTenant(a.id, async () => {
        const department = await prisma.department.create({
          data: { tenantId: a.id, name: "Skin" },
        });
        const service = await prisma.service.create({
          data: {
            tenantId: a.id,
            name: "Facial",
            departmentId: department.id,
            memberPrice: 109,
            nonmemberPrice: 109,
          },
        });
        const product = await prisma.product.create({
          data: {
            tenantId: a.id,
            name: "Cream",
            departmentId: department.id,
            memberPrice: 109,
            nonmemberPrice: 109,
            quantity: 30,
          },
        });
        return { department, service, product };
      });
      const foreignService = await runAsTenant(b.id, () =>
        prisma.service.create({
          data: { tenantId: b.id, name: "Foreign", memberPrice: 10, nonmemberPrice: 10 },
        }),
      );
      assert.equal((await call("")).status, 401);
      assert.equal((await call("", staffToken)).status, 403);
      assert.equal((await call(`?staffId=${foreign.id}`, adminToken)).status, 404);
      let revision: string | null = null;
      async function publish(extra: object) {
        const result = await call("", adminToken, {
          itemKind: "SERVICE",
          scope: "COMPANY",
          rate: 8,
          reason: "Approved policy",
          expectedRevision: revision,
          ...extra,
        });
        assert.equal(result.status, 201, JSON.stringify(result.body));
        revision = result.body.data.id;
        return revision!;
      }
      await publish({});
      const stale = await call("", adminToken, {
        itemKind: "SERVICE",
        scope: "COMPANY",
        rate: 9,
        reason: "Stale policy",
        expectedRevision: null,
      });
      assert.equal(stale.status, 409);
      for (const extra of [
        { staffId: foreign.id, scope: "STAFF" },
        { staffId: staff.id, scope: "ITEM", targetId: foreignService.id },
      ])
        assert.equal(
          (
            await call("", adminToken, {
              itemKind: "SERVICE",
              rate: 10,
              reason: "Cross tenant",
              expectedRevision: revision,
              ...extra,
            })
          ).status,
          404,
        );
      assert.equal(
        (
          await call("/preview", foreignToken, {
            staffId: staff.id,
            itemKind: "SERVICE",
            itemId: service.id,
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await call("", adminToken, {
            scope: "COMPANY",
            itemKind: "SERVICE",
            rate: 5,
            reason: "Backdate",
            expectedRevision: revision,
            effectiveAt: "2026-01-01T00:00:00Z",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call("/preview", adminToken, {
            staffId: staff.id,
            itemKind: "SERVICE",
            itemId: service.id,
          })
        ).body.data.source,
        "LEGACY_STAFF",
      );
      await publish({ staffId: staff.id, scope: "STAFF", rate: null });
      assert.equal(
        (
          await call("/preview", adminToken, {
            staffId: staff.id,
            itemKind: "SERVICE",
            itemId: service.id,
          })
        ).body.data.rate,
        "8",
      );
      await publish({ staffId: staff.id, scope: "DEPARTMENT", targetId: department.id, rate: 12 });
      const itemRule = await publish({
        staffId: staff.id,
        scope: "ITEM",
        targetId: service.id,
        rate: 15,
      });
      await publish({ itemKind: "PRODUCT", rate: 5 });
      await publish({
        staffId: staff.id,
        scope: "ITEM",
        targetId: service.id,
        rate: 99,
        effectiveAt: new Date(Date.now() + 86400000).toISOString(),
      });
      const input = {
        idempotencyKey: randomUUID(),
        lines: [
          {
            itemType: "SERVICE" as const,
            itemId: service.id,
            staffId: staff.id,
            quantity: 1,
            discountPercent: 10,
          },
          {
            itemType: "PRODUCT" as const,
            itemId: product.id,
            staffId: staff.id,
            quantity: 1,
            discountPercent: 10,
          },
        ],
        payments: [{ method: "CASH" as const, amount: 196.2 }],
      };
      await runAsTenant(a.id, async () => {
        const sale = await createSale(input);
        assert.equal((await createSale(input)).id, sale.id);
        const commissions = await prisma.employeeCommission.findMany({
          where: { saleId: sale.id },
          orderBy: { rate: "desc" },
        });
        assert.equal(commissions.length, 2);
        assert.equal(commissions[0]!.amount.toFixed(2), "13.50");
        assert.equal(commissions[0]!.basis?.toFixed(2), "90.00");
        assert.equal(commissions[0]!.ruleId, itemRule);
        assert.equal(commissions[0]!.ruleSource, "ITEM");
        assert.ok(commissions[0]!.saleLineId);
        assert.equal(commissions[1]!.amount.toFixed(2), "4.50");
        await refundSale(
          sale.id,
          {
            payouts: [{ method: "CASH", amount: 196.2 }],
            reason: "Commission regression",
            restock: false,
          },
          manager.id,
        );
        const reversals = await prisma.employeeCommission.findMany({
          where: { saleId: sale.id, refundAdjustment: true },
        });
        assert.deepEqual(reversals.map((r) => r.amount.toFixed(2)).sort(), ["-13.50", "-4.50"]);
        assert.ok(reversals.every((r) => r.saleLineId && r.basis?.toFixed(2) === "-90.00"));
        await assert.rejects(
          () => updateStaff(staff.id, { commissionRate: 77 }),
          /Publish commission changes/,
        );
        await assert.rejects(
          () => prisma.commissionRule.update({ where: { id: itemRule }, data: { rate: 77 } }),
          /append-only/,
        );
        await assert.rejects(
          () => prisma.commissionRule.delete({ where: { id: itemRule } }),
          /append-only/,
        );
      });
      await publish({ staffId: staff.id, scope: "ITEM", targetId: service.id, rate: 0 });
      await runAsTenant(a.id, async () => {
        const zero = await createSale({
          idempotencyKey: randomUUID(),
          lines: [{ itemType: "SERVICE", itemId: service.id, staffId: staff.id, quantity: 1 }],
          payments: [{ method: "CASH", amount: 109 }],
        });
        const line = await prisma.saleLine.findFirstOrThrow({ where: { saleId: zero.id } });
        assert.deepEqual(JSON.parse(JSON.stringify(line.commissionSnapshot)).rate, "0.00");
        assert.equal(await prisma.employeeCommission.count({ where: { saleId: zero.id } }), 0);
      });
      assert.equal(
        (
          await call("/preview", adminToken, {
            staffId: staff.id,
            itemKind: "SERVICE",
            itemId: service.id,
          })
        ).body.data.rate,
        "0",
      );
      await publish({ staffId: staff.id, scope: "ITEM", targetId: service.id, rate: null });
      assert.equal(
        (
          await call("/preview", adminToken, {
            staffId: staff.id,
            itemKind: "SERVICE",
            itemId: service.id,
          })
        ).body.data.rate,
        "12",
      );
      const history = await call(`?staffId=${staff.id}`, adminToken);
      assert.equal(history.body.data.scheduled.length, 1);
      assert.ok(
        history.body.data.history.every((r: { actorId: string }) => r.actorId === manager.id),
      );
      assert.equal((await call("", foreignToken)).body.data.total, 0);
      // Pagination never truncates the effective policy; all publication events remain.
      await runAsTenant(a.id, async () => {
        for (let n = 0; n < 21; n++) {
          const latest = (await commissionConfiguration(undefined, 1)).revision;
          await publishCommissionRule(
            publishCommissionRuleSchema.parse({
              scope: "COMPANY",
              itemKind: "PRODUCT",
              rate: n,
              reason: `History event ${n}`,
              expectedRevision: latest,
            }),
            manager.id,
          );
        }
        const first = await commissionConfiguration(undefined, 1);
        const second = await commissionConfiguration(undefined, 2);
        assert.equal(first.history.length, 20);
        assert.ok(second.history.length > 0);
        assert.equal(first.current.find((row) => row.itemKind === "PRODUCT")?.rate, "20.00");
        assert.ok(
          !second.history.some((row) => first.history.some((other) => other.id === row.id)),
        );
      });
      // Serialize competing publishers and reject a stale revision atomically.
      await runAsTenant(a.id, async () => {
        const latest = (await commissionConfiguration(undefined, 1)).revision;
        const rule = publishCommissionRuleSchema.parse({
          scope: "COMPANY",
          itemKind: "PRODUCT",
          rate: 6,
          reason: "Concurrent policy",
          expectedRevision: latest,
        });
        const outcomes = await Promise.allSettled([
          publishCommissionRule(rule, manager.id),
          publishCommissionRule(rule, manager.id),
        ]);
        assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
      });
      await prisma.tenant.update({ where: { id: a.id }, data: { status: "SUSPENDED" } });
      assert.equal((await call("", adminToken)).status, 200);
      assert.equal(
        (
          await call("", adminToken, {
            itemKind: "SERVICE",
            scope: "COMPANY",
            rate: 8,
            reason: "Suspended write",
            expectedRevision: revision,
          })
        ).status,
        403,
      );
      const audits = await prisma.auditLog.findMany({
        where: { tenantId: a.id, action: "commission.rule.publish" },
      });
      assert.ok(audits.length >= 8);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await runAsPlatform(async () => {
        await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
      });
      await prisma.$disconnect();
    }
  },
);
