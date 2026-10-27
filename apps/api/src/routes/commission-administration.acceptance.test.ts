import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test(
  "SC-004 atomic administration, catalogue kinds, stale edits, previews and unchanged evidence",
  { skip: process.env.SC004_ADMIN_TEST !== "1" },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55465");
    assert.equal(url.pathname, "/commission_admin_test");
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "sc004-synthetic-secret";
    const { prisma } = await import("../lib/prisma.js");
    const { runAsPlatform, runAsTenant } = await import("../lib/tenant-context.js");
    const { signAccessToken } = await import("../lib/tokens.js");
    const { createApp } = await import("../app.js");
    const { createSale } = await import("../services/sale.service.js");
    const tenantId = `sc004-${randomUUID()}`,
      foreignId = tenantId + "-foreign";
    const scoped = <T>(fn: () => T) => runAsTenant(tenantId, fn);
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/commissions`;
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
      await runAsPlatform(() =>
        prisma.tenant.createMany({
          data: [
            { id: tenantId, name: "Synthetic admin", slug: tenantId },
            { id: foreignId, name: "Foreign", slug: foreignId },
          ],
        }),
      );
      for (const code of ["staff", "sales", "catalogue", "packages"]) {
        const module = await prisma.module.upsert({
          where: { code },
          update: {},
          create: { code, name: code, category: "Core", isCore: false },
        });
        for (const id of [tenantId, foreignId])
          await runAsTenant(id, () =>
            prisma.tenantModule.create({ data: { tenantId: id, moduleId: module.id } }),
          );
      }
      const user = (id: string, role: "MANAGER" | "STAFF") =>
        runAsTenant(id, () =>
          prisma.user.create({
            data: {
              tenantId: id,
              name: role,
              email: `${randomUUID()}@sc004.test`,
              passwordHash: "fixture",
              globalRole: role,
              commissionRate: 11,
            },
          }),
        );
      const manager = await user(tenantId, "MANAGER"),
        staff = await user(tenantId, "STAFF"),
        foreign = await user(foreignId, "MANAGER");
      const token = (u: typeof manager, realm: "web" | "platform" = "web") =>
        signAccessToken({
          id: u.id,
          email: "synthetic@sc004.test",
          tenantId: u.tenantId,
          globalRole: u.globalRole,
          tokenVersion: 0,
          realm,
        }).token;
      const admin = token(manager),
        employee = token(staff),
        outsider = token(foreign);
      const service = await scoped(() =>
        prisma.service.create({
          data: { tenantId, name: "Service", memberPrice: 100, nonmemberPrice: 100 },
        }),
      );
      const pkg = await scoped(() =>
        prisma.package.create({
          data: {
            tenantId,
            name: "Package",
            sessionCount: 3,
            memberPrice: 100,
            nonmemberPrice: 100,
          },
        }),
      );
      const credit = await scoped(() =>
        prisma.valuePackage.create({ data: { tenantId, name: "Credit", price: 100, credit: 120 } }),
      );
      const sale = await runAsTenant(
        tenantId,
        () =>
          createSale({
            lines: [{ itemType: "SERVICE", itemId: service.id, quantity: 1, staffId: staff.id }],
            payments: [{ method: "CASH", amount: 100 }],
          }),
        manager.id,
      );
      const original = await scoped(() => prisma.saleLine.findMany({ where: { saleId: sale.id } }));
      const earnings = await scoped(() =>
        prisma.employeeCommission.findMany({ where: { saleId: sale.id } }),
      );
      let revision: string | null = null;
      const rule = (kind: string, rate: number | null, extra: object = {}) => ({
        itemKind: kind,
        scope: "STAFF",
        staffId: staff.id,
        targetId: null,
        rate,
        ...extra,
      });
      async function publish(rules: object[], extra: object = {}) {
        const result = await call("/bulk", admin, {
          expectedRevision: revision,
          reason: "Synthetic administration",
          rules,
          ...extra,
        });
        assert.equal(result.status, 201, JSON.stringify(result.body));
        revision = result.body.data.revision;
        return result;
      }
      for (const path of ["/matrix", "?page=1"]) {
        assert.equal((await call(path)).status, 401);
        assert.equal((await call(path, employee)).status, 403);
        assert.equal((await call(path, token(manager, "platform"))).status, 403);
      }
      const body = {
        expectedRevision: null,
        reason: "Denied write",
        rules: [rule("PACKAGE_SALE", 10)],
      };
      assert.equal((await call("/bulk", employee, body)).status, 403);
      assert.equal((await call("/bulk", outsider, body)).status, 404);
      assert.equal((await call("/bulk", admin, { ...body, activateEarnings: true })).status, 422);
      await publish([
        rule("PACKAGE_SALE", 10),
        rule("PACKAGE_REDEMPTION", 20),
        rule("FOC", 5),
        rule("STORED_CREDIT_SALE", 6),
        rule("STORED_CREDIT_SPEND", 7),
      ]);
      for (const [kind, item] of [
        ["PACKAGE_SALE", pkg],
        ["PACKAGE_REDEMPTION", pkg],
        ["FOC", service],
        ["STORED_CREDIT_SALE", credit],
        ["STORED_CREDIT_SPEND", credit],
      ] as const) {
        const options = await call(`/options?itemKind=${kind}`, admin);
        assert.equal(options.status, 200);
        assert.ok(options.body.data.items.some((i: { id: string }) => i.id === item.id));
        assert.equal(
          (await call("/preview", admin, { staffId: staff.id, itemKind: kind, itemId: item.id }))
            .status,
          200,
        );
      }
      await publish([
        rule("PACKAGE_REDEMPTION", 30, { scope: "PACKAGE", staffId: null, targetId: pkg.id }),
      ]);
      const preview = () =>
        call("/preview", admin, {
          staffId: staff.id,
          itemKind: "PACKAGE_REDEMPTION",
          itemId: pkg.id,
        });
      assert.equal((await preview()).body.data.source, "PACKAGE");
      await publish([rule("PACKAGE_REDEMPTION", 0, { scope: "ITEM", targetId: pkg.id })]);
      assert.equal((await preview()).body.data.rate, "0");
      await publish([rule("PACKAGE_REDEMPTION", null, { scope: "ITEM", targetId: pkg.id })]);
      assert.equal((await preview()).body.data.rate, "30");
      await publish([
        rule("PACKAGE_REDEMPTION", null, { scope: "PACKAGE", staffId: null, targetId: pkg.id }),
      ]);
      assert.equal((await preview()).body.data.rate, "20");
      const future = new Date(Date.now() + 3600000).toISOString();
      await publish([rule("PACKAGE_REDEMPTION", 99)], { effectiveAt: future });
      assert.equal((await preview()).body.data.rate, "20");
      assert.equal((await call(`?staffId=${staff.id}`, admin)).body.data.scheduled.length, 1);
      const before = await scoped(() => prisma.commissionRule.count());
      const auditBefore = await scoped(() =>
        prisma.auditLog.count({ where: { action: "commission.rule.publish" } }),
      );
      // Fail the second insert after the first rule and audit have been written.
      // This trigger exists only in the guarded disposable test database.
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION sc004_fail_second() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason = 'Injected second-write failure' AND NEW."itemKind" = 'FOC' THEN RAISE EXCEPTION 'SC004 injected failure'; END IF; RETURN NEW; END $$`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER sc004_fail_second BEFORE INSERT ON commission_rules FOR EACH ROW EXECUTE FUNCTION sc004_fail_second()`,
      );
      try {
        assert.equal(
          (
            await call("/bulk", admin, {
              expectedRevision: revision,
              reason: "Injected second-write failure",
              rules: [rule("PACKAGE_SALE", 44), rule("FOC", 8)],
            })
          ).status,
          500,
        );
        assert.equal(await scoped(() => prisma.commissionRule.count()), before);
        assert.equal(
          await scoped(() =>
            prisma.auditLog.count({ where: { action: "commission.rule.publish" } }),
          ),
          auditBefore,
        );
        assert.equal((await call("/matrix", admin)).body.data.revision, revision);
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER sc004_fail_second ON commission_rules`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION sc004_fail_second()`);
      }
      for (const rules of [
        [rule("PACKAGE_SALE", 40), rule("PACKAGE_SALE", 10, { staffId: foreign.id })],
        [rule("FOC", 10, { scope: "ITEM", targetId: pkg.id })],
      ]) {
        assert.equal(
          (
            await call("/bulk", admin, {
              expectedRevision: revision,
              reason: "Atomic rollback",
              rules,
            })
          ).status,
          404,
        );
        assert.equal(await scoped(() => prisma.commissionRule.count()), before);
      }
      await scoped(() => prisma.user.update({ where: { id: staff.id }, data: { disabled: true } }));
      assert.equal(
        (
          await call("/bulk", admin, {
            expectedRevision: revision,
            reason: "Disabled staff",
            rules: [rule("PACKAGE_SALE", 1)],
          })
        ).status,
        400,
      );
      assert.equal(
        (await call("/matrix", admin)).body.data.rows.some(
          (r: { staffId: string }) => r.staffId === staff.id,
        ),
        false,
      );
      await scoped(() =>
        prisma.user.update({ where: { id: staff.id }, data: { disabled: false } }),
      );
      await scoped(() =>
        prisma.package.update({ where: { id: pkg.id }, data: { status: "INACTIVE" } }),
      );
      assert.equal((await preview()).status, 404);
      assert.equal(
        (
          await call("/bulk", admin, {
            expectedRevision: revision,
            reason: "Inactive package",
            rules: [rule("PACKAGE_SALE", 9, { scope: "PACKAGE", staffId: null, targetId: pkg.id })],
          })
        ).status,
        404,
      );
      await scoped(() =>
        prisma.package.update({ where: { id: pkg.id }, data: { status: "ACTIVE" } }),
      );
      const concurrent = {
        expectedRevision: revision,
        reason: "Concurrent bulk",
        rules: [rule("PACKAGE_SALE", 12), rule("FOC", 0)],
      };
      const outcomes = await Promise.all([
        call("/bulk", admin, concurrent),
        call("/bulk", admin, concurrent),
      ]);
      assert.deepEqual(outcomes.map((o) => o.status).sort(), [201, 409]);
      revision = outcomes.find((o) => o.status === 201)!.body.data.revision;
      assert.equal(
        (await call("/bulk", admin, { ...concurrent, expectedRevision: null })).status,
        409,
      );
      assert.equal(
        (
          await call("/bulk", admin, {
            ...concurrent,
            expectedRevision: revision,
            effectiveAt: "2020-01-01T00:00:00Z",
          })
        ).status,
        400,
      );
      const matrix = await call("/matrix?search=STAFF", admin);
      assert.equal(matrix.body.data.total, 1);
      assert.equal(matrix.body.data.rows[0].cells.length, 7);
      assert.equal(
        matrix.body.data.rows[0].cells.find((c: { itemKind: string }) => c.itemKind === "SERVICE")
          .source,
        "LEGACY_STAFF",
      );
      assert.equal((await call("/matrix?search=no-match", admin)).body.data.total, 0);
      assert.equal((await call("/matrix", outsider)).body.data.total, 1);
      await scoped(() =>
        prisma.user.createMany({
          data: Array.from({ length: 23 }, (_, index) => ({
            tenantId,
            name: `Pagination ${String(index).padStart(2, "0")}`,
            passwordHash: "fixture",
          })),
        }),
      );
      const firstPage = await call("/matrix", admin),
        secondPage = await call("/matrix?page=2", admin);
      assert.equal(firstPage.body.data.total, 25);
      assert.equal(firstPage.body.data.rows.length, 20);
      assert.equal(secondPage.body.data.rows.length, 5);
      assert.ok(
        !secondPage.body.data.rows.some((row: { staffId: string }) =>
          firstPage.body.data.rows.some(
            (other: { staffId: string }) => row.staffId === other.staffId,
          ),
        ),
      );
      await scoped(() =>
        prisma.user.update({ where: { id: manager.id }, data: { tokenVersion: 1 } }),
      );
      assert.equal(
        (
          await call("/bulk", admin, {
            expectedRevision: revision,
            reason: "Revoked actor",
            rules: [rule("FOC", 0)],
          })
        ).status,
        401,
      );
      await scoped(() =>
        prisma.user.update({ where: { id: manager.id }, data: { tokenVersion: 0 } }),
      );
      assert.deepEqual(
        await scoped(() => prisma.saleLine.findMany({ where: { saleId: sale.id } })),
        original,
      );
      assert.deepEqual(
        await scoped(() => prisma.employeeCommission.findMany({ where: { saleId: sale.id } })),
        earnings,
      );
      assert.equal(
        await scoped(() => prisma.employeeCommission.count({ where: { ledgerVersion: 1 } })),
        0,
      );
      const audits = await scoped(() =>
        prisma.auditLog.findMany({ where: { tenantId, action: "commission.rule.publish" } }),
      );
      assert.equal(audits.length, await scoped(() => prisma.commissionRule.count()));
      assert.ok(audits.every((a) => (a.metadata as { actorId: string }).actorId === manager.id));
      await runAsPlatform(() =>
        prisma.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } }),
      );
      assert.equal((await call("/matrix", admin)).status, 200);
      assert.equal(
        (await call("/bulk", admin, { ...concurrent, expectedRevision: revision })).status,
        403,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await runAsPlatform(() =>
        prisma.tenant.deleteMany({ where: { id: { in: [tenantId, foreignId] } } }),
      );
      await prisma.$disconnect();
    }
  },
);
