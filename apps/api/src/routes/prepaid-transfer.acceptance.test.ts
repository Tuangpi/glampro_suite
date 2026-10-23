import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

test(
  "same-salon prepaid transfer HTTP, locking, evidence and reversal acceptance",
  {
    skip: process.env.PREPAID_TRANSFER_ACCEPTANCE !== "1",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55440");
    assert.equal(url.pathname, "/package_expiry_test");
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "prepaid-transfer-isolated-test-secret";
    const { prisma } = await import("../lib/prisma.js");
    const { runAsPlatform, runAsTenant } = await import("../lib/tenant-context.js");
    const { signAccessToken } = await import("../lib/tokens.js");
    const { createApp } = await import("../app.js");
    const { createSale, voidSale } = await import("../services/sale.service.js");
    const { transferPrepaid, listPrepaidTransfers } =
      await import("../services/prepaid.service.js");
    const { reportOverview } = await import("../services/report.service.js");
    const tenantId = "prepaid-transfer-acceptance-a";
    const foreignId = "prepaid-transfer-acceptance-b";
    const scoped = <T>(fn: () => T) => runAsTenant(tenantId, fn);
    const purge = () =>
      runAsPlatform(() =>
        prisma.tenant.deleteMany({ where: { id: { in: [tenantId, foreignId] } } }),
      );
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/customers`;
    try {
      await purge();
      const fixture = await runAsPlatform(async () => {
        for (const code of ["customers", "sale", "catalogue"]) {
          await prisma.module.upsert({
            where: { code },
            update: { isCore: true },
            create: { code, name: code, category: "Core", isCore: true },
          });
        }
        await prisma.tenant.createMany({
          data: [
            { id: tenantId, name: "Transfers A", slug: tenantId },
            { id: foreignId, name: "Transfers B", slug: foreignId },
          ],
        });
        const owner = await prisma.user.create({
          data: {
            tenantId,
            name: "Owner",
            email: "owner@prepaid-transfer.test",
            passwordHash: "unused",
            globalRole: "SUPER_ADMIN",
            twoFactorEnabled: true,
          },
        });
        const manager = await prisma.user.create({
          data: {
            tenantId,
            name: "Manager",
            email: "manager@prepaid-transfer.test",
            passwordHash: "unused",
            globalRole: "MANAGER",
          },
        });
        const staff = await prisma.user.create({
          data: {
            tenantId,
            name: "Staff",
            email: "staff@prepaid-transfer.test",
            passwordHash: "unused",
            globalRole: "STAFF",
          },
        });
        const a = await prisma.customer.create({ data: { tenantId, name: "Sender" } });
        const b = await prisma.customer.create({ data: { tenantId, name: "Receiver" } });
        const c = await prisma.customer.create({ data: { tenantId, name: "Other receiver" } });
        const foreign = await prisma.customer.create({
          data: { tenantId: foreignId, name: "Foreign" },
        });
        const credit = await prisma.valuePackage.create({
          data: { tenantId, name: "Prepaid", price: 100, credit: 100 },
        });
        const service = await prisma.service.create({
          data: { tenantId, name: "Care", memberPrice: 10, nonmemberPrice: 10 },
        });
        const module = await prisma.module.upsert({
          where: { code: "packages" },
          update: {},
          create: { code: "packages", name: "Packages", category: "Add-on", isCore: false },
        });
        return { owner, manager, staff, a, b, c, foreign, credit, service, module };
      });
      const token = (user: typeof fixture.owner) =>
        signAccessToken({
          id: user.id,
          email: user.email!,
          globalRole: user.globalRole,
          realm: "web",
          tenantId,
          tokenVersion: user.tokenVersion,
        }).token;
      const ownerToken = token(fixture.owner);
      const managerToken = token(fixture.manager);
      const staffToken = token(fixture.staff);
      const newHolding = (extra = {}) =>
        scoped(() =>
          prisma.customerValuePackageHolding.create({
            data: {
              tenantId,
              customerId: fixture.a.id,
              valuePackageId: fixture.credit.id,
              amount: 100,
              amountRemaining: 75,
              expiresAt: new Date("2090-01-01T00:00:00.000Z"),
              ...extra,
            },
          }),
        );
      const holding = await newHolding();
      const input = (updatedAt = holding.updatedAt, targetCustomerId = fixture.b.id) => ({
        targetCustomerId,
        expectedUpdatedAt: updatedAt.toISOString(),
        reason: " Customer request ",
        confirmed: true as const,
      });
      const transfer = (sourceId: string, id: string, body: object, bearer?: string) =>
        fetch(`${base}/${sourceId}/prepaid/${id}/transfer`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          },
          body: JSON.stringify(body),
        });
      const get = (path: string, bearer = ownerToken) =>
        fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${bearer}` } });
      const code = (expected: string) => (error: unknown) =>
        !!error && typeof error === "object" && "code" in error && error.code === expected;

      assert.equal((await transfer(fixture.a.id, holding.id, input())).status, 401);
      assert.equal(
        (await transfer(fixture.a.id, holding.id, input(), ownerToken)).status,
        403,
        "packages entitlement required",
      );
      await scoped(() =>
        prisma.tenantModule.create({ data: { tenantId, moduleId: fixture.module.id } }),
      );
      assert.equal((await transfer(fixture.a.id, holding.id, input(), staffToken)).status, 403);
      for (const extra of [
        { confirmed: false },
        { reason: " " },
        { tenantId: foreignId },
        { actorId: fixture.staff.id },
        { amount: 1 },
      ])
        assert.equal(
          (await transfer(fixture.a.id, holding.id, { ...input(), ...extra }, ownerToken)).status,
          422,
        );
      assert.equal(
        (
          await transfer(
            fixture.a.id,
            holding.id,
            input(holding.updatedAt, fixture.foreign.id),
            ownerToken,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await transfer(
            fixture.a.id,
            holding.id,
            input(holding.updatedAt, fixture.a.id),
            ownerToken,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await transfer(
            fixture.b.id,
            holding.id,
            input(holding.updatedAt, fixture.c.id),
            ownerToken,
          )
        ).status,
        404,
      );
      assert.equal(
        (await transfer(fixture.a.id, holding.id, input(new Date(0)), ownerToken)).status,
        409,
      );
      for (const extra of [
        { expiresAt: new Date(0) },
        { amountRemaining: 0 },
        { familyId: "legacy-shared" },
      ]) {
        const invalid = await newHolding(extra);
        assert.equal(
          (await transfer(fixture.a.id, invalid.id, input(invalid.updatedAt), ownerToken)).status,
          409,
        );
      }
      await scoped(() =>
        prisma.customer.update({ where: { id: fixture.b.id }, data: { archivedAt: new Date() } }),
      );
      assert.equal((await transfer(fixture.a.id, holding.id, input(), ownerToken)).status, 409);
      await scoped(() =>
        prisma.customer.update({ where: { id: fixture.b.id }, data: { archivedAt: null } }),
      );
      await runAsPlatform(() =>
        prisma.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } }),
      );
      assert.equal((await transfer(fixture.a.id, holding.id, input(), ownerToken)).status, 403);
      await runAsPlatform(() =>
        prisma.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE" } }),
      );
      await assert.rejects(
        scoped(() => transferPrepaid(fixture.a.id, holding.id, input(), fixture.staff.id)),
        code("FORBIDDEN"),
      );

      const reportQuery = { from: "2026-10-01", to: "2026-10-31", timeZone: "Asia/Singapore" };
      const beforeLiability = (await scoped(() => reportOverview(reportQuery))).liability;
      const response = await transfer(fixture.a.id, holding.id, input(), managerToken);
      assert.equal(response.status, 201, await response.clone().text());
      const { data: event } = (await response.json()) as {
        data: { id: string; amount: string; reason: string; actorId: string };
      };
      assert.equal(event.amount, "75.00");
      assert.equal(event.reason, "Customer request");
      assert.equal(event.actorId, fixture.manager.id);
      const moved = await scoped(() =>
        prisma.customerValuePackageHolding.findFirstOrThrow({ where: { id: holding.id } }),
      );
      assert.equal(moved.customerId, fixture.b.id);
      assert.equal(moved.amountRemaining.toFixed(2), "75.00");
      assert.equal(moved.expiresAt?.toISOString(), holding.expiresAt?.toISOString());
      assert.equal(moved.saleLineId, holding.saleLineId);
      assert.deepEqual(
        (await scoped(() => reportOverview(reportQuery))).liability,
        beforeLiability,
        "transfer conserves liability",
      );
      assert.equal(
        (await transfer(fixture.a.id, holding.id, input(), ownerToken)).status,
        404,
        "duplicate cannot move again",
      );
      for (const id of [fixture.a.id, fixture.b.id]) {
        const history = await get(`/${id}/prepaid-transfers?page=1&pageSize=1`, staffToken);
        assert.equal(history.status, 200);
        const body = (await history.json()) as { data: { total: number; data: { id: string }[] } };
        assert.equal(body.data.total, 1);
        assert.equal(body.data.data[0]?.id, event.id);
      }
      assert.equal((await get(`/${fixture.foreign.id}/prepaid-transfers`)).status, 404);
      assert.equal(await runAsTenant(foreignId, () => prisma.prepaidTransferEvent.count()), 0);
      await assert.rejects(
        scoped(() =>
          prisma.prepaidTransferEvent.update({
            where: { id: event.id },
            data: { reason: "rewrite" },
          }),
        ),
      );
      await assert.rejects(
        scoped(() => prisma.prepaidTransferEvent.delete({ where: { id: event.id } })),
      );

      // Concurrent ownership attempts: only one event and one recipient.
      const race = await newHolding();
      const raced = await Promise.all([
        transfer(fixture.a.id, race.id, input(race.updatedAt, fixture.b.id), ownerToken),
        transfer(fixture.a.id, race.id, input(race.updatedAt, fixture.c.id), ownerToken),
      ]);
      assert.deepEqual(raced.map((r) => r.status).sort(), [201, 404]);
      assert.equal(
        await scoped(() => prisma.prepaidTransferEvent.count({ where: { holdingId: race.id } })),
        1,
      );

      // Spend at original owner vs transfer must serialize, never lose a draw or mint credit.
      const spendRace = await newHolding();
      const saleInput = (customerId: string, holdingId: string) => ({
        customerId,
        lines: [{ itemType: "SERVICE" as const, itemId: fixture.service.id, quantity: 1 }],
        payments: [{ method: "PREPAID_CREDIT" as const, amount: 10, holdingId }],
      });
      const concurrent = await Promise.allSettled([
        scoped(() =>
          transferPrepaid(fixture.a.id, spendRace.id, input(spendRace.updatedAt), fixture.owner.id),
        ),
        scoped(() => createSale(saleInput(fixture.a.id, spendRace.id))),
      ]);
      assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
      const finalRace = await scoped(() =>
        prisma.customerValuePackageHolding.findFirstOrThrow({ where: { id: spendRace.id } }),
      );
      assert.ok(
        (finalRace.customerId === fixture.b.id &&
          finalRace.amountRemaining.toFixed(2) === "75.00") ||
          (finalRace.customerId === fixture.a.id &&
            finalRace.amountRemaining.toFixed(2) === "65.00"),
      );

      // A previous redemption reversal restores the same holding under its new owner.
      const spent = await newHolding();
      const sale = await scoped(() => createSale(saleInput(fixture.a.id, spent.id)));
      const afterSpend = await scoped(() =>
        prisma.customerValuePackageHolding.findFirstOrThrow({ where: { id: spent.id } }),
      );
      await scoped(() =>
        transferPrepaid(fixture.a.id, spent.id, input(afterSpend.updatedAt), fixture.owner.id),
      );
      await scoped(() => voidSale(sale.id, { reason: "Reverse service" }, fixture.owner.id));
      const restored = await scoped(() =>
        prisma.customerValuePackageHolding.findFirstOrThrow({ where: { id: spent.id } }),
      );
      assert.equal(restored.customerId, fixture.b.id);
      assert.equal(restored.amountRemaining.toFixed(2), "75.00");

      // Purchased credit retains provenance and cannot be erased by void after transfer.
      const purchase = await scoped(() =>
        createSale({
          customerId: fixture.a.id,
          lines: [{ itemType: "VALUE_PACKAGE", itemId: fixture.credit.id, quantity: 1 }],
          payments: [{ method: "CASH", amount: 100 }],
        }),
      );
      const purchased = await scoped(() =>
        prisma.customerValuePackageHolding.findFirstOrThrow({
          where: { saleLine: { saleId: purchase.id } },
        }),
      );
      await scoped(() =>
        transferPrepaid(fixture.a.id, purchased.id, input(purchased.updatedAt), fixture.owner.id),
      );
      await assert.rejects(
        scoped(() => voidSale(purchase.id, { reason: "Wrong purchase" }, fixture.owner.id)),
        code("HOLDING_ALREADY_TRANSFERRED"),
      );
      assert.equal(
        (await scoped(() => prisma.sale.findFirstOrThrow({ where: { id: purchase.id } }))).status,
        "COMPLETED",
      );

      // Atomicity: force evidence insertion failure in this disposable DB only.
      const atomic = await newHolding();
      await runAsPlatform(() =>
        prisma.$executeRawUnsafe(
          `CREATE FUNCTION fail_prepaid_test_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected test failure'; END; $$`,
        ),
      );
      await runAsPlatform(() =>
        prisma.$executeRawUnsafe(
          `CREATE TRIGGER fail_prepaid_test_event BEFORE INSERT ON prepaid_transfer_events FOR EACH ROW EXECUTE FUNCTION fail_prepaid_test_event()`,
        ),
      );
      try {
        await assert.rejects(
          scoped(() =>
            transferPrepaid(fixture.a.id, atomic.id, input(atomic.updatedAt), fixture.owner.id),
          ),
        );
        assert.equal(
          (
            await scoped(() =>
              prisma.customerValuePackageHolding.findFirstOrThrow({ where: { id: atomic.id } }),
            )
          ).customerId,
          fixture.a.id,
        );
      } finally {
        await runAsPlatform(() =>
          prisma.$executeRawUnsafe(
            `DROP TRIGGER fail_prepaid_test_event ON prepaid_transfer_events`,
          ),
        );
        await runAsPlatform(() =>
          prisma.$executeRawUnsafe(`DROP FUNCTION fail_prepaid_test_event()`),
        );
      }
      const historyPage = await scoped(() =>
        listPrepaidTransfers(fixture.a.id, { page: 1, pageSize: 1 }),
      );
      assert.ok(historyPage.total > 1);
      assert.equal(historyPage.data.length, 1);
    } finally {
      await purge();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await prisma.$disconnect();
    }
  },
);
