import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

test(
  "explicit family credit POS allocation, revocation, reversals and append-only balance ledger",
  {
    skip: process.env.PREPAID_SHARING_ACCEPTANCE !== "1",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55440");
    assert.equal(url.pathname, "/package_expiry_test");
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "prepaid-sharing-disposable-test-secret";
    const { prisma } = await import("../lib/prisma.js");
    const { runAsPlatform, runAsTenant } = await import("../lib/tenant-context.js");
    const { signAccessToken } = await import("../lib/tokens.js");
    const { createApp } = await import("../app.js");
    const { createPrepaidFamily, changePrepaidMembership, sharePrepaid } =
      await import("../services/prepaid-family.service.js");
    const { getCustomerHoldings } = await import("../services/customer.service.js");
    const { createSale, completeSale, voidSale } = await import("../services/sale.service.js");
    const { transferPrepaid, listPrepaidBalanceEvents } =
      await import("../services/prepaid.service.js");
    const { reportOverview } = await import("../services/report.service.js");
    const tenantId = "prepaid-sharing-acceptance-a",
      foreignId = "prepaid-sharing-acceptance-b";
    const scoped = <T>(fn: () => T) => runAsTenant(tenantId, fn);
    const purge = () =>
      runAsPlatform(() =>
        prisma.tenant.deleteMany({ where: { id: { in: [tenantId, foreignId] } } }),
      );
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    try {
      await purge();
      const f = await runAsPlatform(async () => {
        await prisma.tenant.createMany({
          data: [
            { id: tenantId, name: "Sharing", slug: tenantId },
            { id: foreignId, name: "Foreign", slug: foreignId },
          ],
        });
        for (const code of ["customers", "sales", "catalogue"])
          await prisma.module.upsert({
            where: { code },
            update: { isCore: true },
            create: { code, name: code, category: "Core", isCore: true },
          });
        const module = await prisma.module.upsert({
          where: { code: "packages" },
          update: {},
          create: { code: "packages", name: "Packages", category: "Add-on", isCore: false },
        });
        await prisma.tenantModule.create({ data: { tenantId, moduleId: module.id } });
        const manager = await prisma.user.create({
          data: {
            tenantId,
            name: "Manager",
            email: "manager@prepaid-sharing.test",
            passwordHash: "unused",
            globalRole: "MANAGER",
          },
        });
        const staff = await prisma.user.create({
          data: {
            tenantId,
            name: "Staff",
            email: "staff@prepaid-sharing.test",
            passwordHash: "unused",
            globalRole: "STAFF",
          },
        });
        const a = await prisma.customer.create({ data: { tenantId, name: "Owner A" } });
        const b = await prisma.customer.create({ data: { tenantId, name: "Member B" } });
        const c = await prisma.customer.create({ data: { tenantId, name: "Outside C" } });
        const foreign = await prisma.customer.create({
          data: { tenantId: foreignId, name: "Foreign" },
        });
        const service = await prisma.service.create({
          data: { tenantId, name: "Care", memberPrice: 1, nonmemberPrice: 1 },
        });
        const credit = await prisma.valuePackage.create({
          data: { tenantId, name: "Credit", price: 100, credit: 100 },
        });
        return { manager, staff, a, b, c, foreign, service, credit };
      });
      const token = (user: typeof f.manager) =>
        signAccessToken({
          id: user.id,
          email: user.email!,
          globalRole: user.globalRole,
          realm: "web",
          tenantId,
          tokenVersion: user.tokenVersion,
        }).token;
      const post = (path: string, body: object, user = f.manager) =>
        fetch(`${base}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token(user)}` },
          body: JSON.stringify(body),
        });
      const family = (await scoped(() =>
        createPrepaidFamily(
          f.a.id,
          { name: "Family", reason: "Request", confirmed: true },
          f.manager.id,
        ),
      ))!;
      await scoped(() =>
        changePrepaidMembership(
          f.b.id,
          { familyId: family.id, expectedFamilyId: null, reason: "Join", confirmed: true },
          f.manager.id,
        ),
      );
      const holding = (id: string, amount: string, expiry: Date | null, owner = f.a.id) =>
        scoped(() =>
          prisma.customerValuePackageHolding.create({
            data: {
              id,
              tenantId,
              customerId: owner,
              valuePackageId: f.credit.id,
              amount,
              amountRemaining: amount,
              expiresAt: expiry,
              createdAt: new Date("2026-01-01T00:00:00Z"),
            },
          }),
        );
      const privateHolding = await holding("sharing-private", "500.00", null);
      const noExpiry = await holding("sharing-no-expiry", "10.00", null);
      const second = await holding("sharing-b", "20.02", new Date("2090-01-01"));
      const first = await holding("sharing-a", "10.01", new Date("2090-01-01"));
      const expired = await holding("sharing-expired", "300.00", new Date(0));
      const shareInput = (row: typeof first, familyId: string | null = family.id) => ({
        familyId,
        expectedUpdatedAt: row.updatedAt.toISOString(),
        reason: "Share on customer request",
        confirmed: true as const,
      });
      assert.equal(
        (await post(`/customers/${f.a.id}/prepaid/${first.id}/sharing`, shareInput(first), f.staff))
          .status,
        403,
      );
      assert.equal(
        (await post(`/customers/${f.foreign.id}/prepaid/${first.id}/sharing`, shareInput(first)))
          .status,
        404,
      );
      assert.equal(
        (await post(`/customers/${f.b.id}/prepaid/${first.id}/sharing`, shareInput(first))).status,
        404,
      );
      assert.equal(
        (await post(`/customers/${f.a.id}/prepaid/${expired.id}/sharing`, shareInput(expired)))
          .status,
        409,
      );
      assert.equal((await scoped(() => getCustomerHoldings(f.b.id))).holdings.length, 0);
      for (const row of [noExpiry, second, first])
        assert.equal(
          (await post(`/customers/${f.a.id}/prepaid/${row.id}/sharing`, shareInput(row))).status,
          200,
        );
      assert.equal(
        (await post(`/customers/${f.a.id}/prepaid/${first.id}/sharing`, shareInput(first))).status,
        409,
        "stale sharing snapshot rejected",
      );
      const offered = (await scoped(() => getCustomerHoldings(f.b.id))).holdings;
      assert.equal(offered.length, 1);
      assert.equal(offered[0]!.amountRemaining, "40.03");
      assert.equal(offered[0]!.id, `family:${family.id}`);
      const own = (await scoped(() => getCustomerHoldings(f.a.id))).holdings;
      assert.equal(own.filter((row) => row.id.startsWith("family:")).length, 1);
      assert.ok(own.some((row) => row.id === privateHolding.id));
      assert.ok(!own.some((row) => row.id === first.id), "no duplicate shared/private preview");
      const cart = (amount: number, customerId = f.b.id) => ({
        customerId,
        lines: [{ itemType: "SERVICE" as const, itemId: f.service.id, quantity: amount }],
        payments: [{ method: "PREPAID_CREDIT" as const, amount, holdingId: `family:${family.id}` }],
      });
      const before = (
        await scoped(() =>
          reportOverview({ from: "2026-10-01", to: "2026-10-31", timeZone: "Asia/Singapore" }),
        )
      ).liability;
      const response = await post("/sales", cart(25), f.staff);
      assert.equal(response.status, 201, await response.clone().text());
      const sale = ((await response.json()) as { data: { id: string } }).data;
      const draws = await scoped(() =>
        prisma.customerRedemption.findMany({
          where: { saleId: sale.id },
          orderBy: { holdingId: "asc" },
        }),
      );
      assert.deepEqual(
        draws.map((row) => [row.holdingId, row.amount!.toFixed(2)]),
        [
          [first.id, "10.01"],
          [second.id, "14.99"],
        ],
      );
      assert.equal(
        (
          await scoped(() =>
            prisma.customerValuePackageHolding.findFirstOrThrow({ where: { id: noExpiry.id } }),
          )
        ).amountRemaining.toFixed(2),
        "10.00",
      );
      const ledger = await scoped(() =>
        prisma.prepaidBalanceEvent.findMany({ where: { saleId: sale.id, kind: "SPEND" } }),
      );
      assert.equal(ledger.length, 2);
      assert.ok(ledger.every((row) => row.actorId === f.staff.id));
      const after = (
        await scoped(() =>
          reportOverview({ from: "2026-10-01", to: "2026-10-31", timeZone: "Asia/Singapore" }),
        )
      ).liability;
      assert.equal(Number(before.prepaidCredit.balance) - Number(after.prepaidCredit.balance), 25);
      await assert.rejects(
        scoped(() => createSale(cart(1, f.c.id))),
        { code: "HOLDING_NOT_FOUND" },
      );
      // Leaving the borrower does not prevent exact-source restoration.
      await scoped(() =>
        changePrepaidMembership(
          f.b.id,
          { familyId: null, expectedFamilyId: family.id, reason: "Leave", confirmed: true },
          f.manager.id,
        ),
      );
      const reverted = await post(`/sales/${sale.id}/void`, { reason: "Undo" });
      assert.equal(reverted.status, 200, await reverted.clone().text());
      await scoped(() => voidSale(sale.id, { reason: "Retry" }, f.manager.id));
      assert.equal(
        await scoped(() =>
          prisma.prepaidBalanceEvent.count({ where: { saleId: sale.id, kind: "RESTORE" } }),
        ),
        2,
      );
      assert.equal(
        (
          await scoped(() =>
            prisma.customerValuePackageHolding.findFirstOrThrow({ where: { id: first.id } }),
          )
        ).amountRemaining.toFixed(2),
        "10.01",
      );
      const event = ledger[0]!;
      await assert.rejects(
        scoped(() =>
          prisma.prepaidBalanceEvent.update({
            where: { id: event.id },
            data: { reason: "rewrite" },
          }),
        ),
        /append-only/,
      );
      await assert.rejects(
        scoped(() => prisma.prepaidBalanceEvent.delete({ where: { id: event.id } })),
        /append-only/,
      );
      assert.equal(await runAsTenant(foreignId, () => prisma.prepaidBalanceEvent.count()), 0);
      const history = await scoped(() =>
        listPrepaidBalanceEvents(f.b.id, { page: 1, pageSize: 1 }),
      );
      assert.equal(history.data.length, 1);
      assert.ok(history.total >= 4);
      // Owner leaving revokes sharing without redistributing or expiring credit.
      await scoped(() =>
        changePrepaidMembership(
          f.a.id,
          { familyId: null, expectedFamilyId: family.id, reason: "Withdraw", confirmed: true },
          f.manager.id,
        ),
      );
      const unshared = await scoped(() =>
        prisma.customerValuePackageHolding.findFirstOrThrow({ where: { id: first.id } }),
      );
      assert.equal(unshared.sharedFamilyId, null);
      assert.equal(unshared.expiresAt!.toISOString(), first.expiresAt!.toISOString());
      await scoped(() =>
        changePrepaidMembership(
          f.b.id,
          { familyId: family.id, expectedFamilyId: null, reason: "Rejoin", confirmed: true },
          f.manager.id,
        ),
      );
      assert.equal(
        (await scoped(() => getCustomerHoldings(f.b.id))).holdings.length,
        0,
        "owner exit revokes all its sharing",
      );
      // Reversing after a whole-holding transfer restores value to that same holding.
      await scoped(() =>
        transferPrepaid(
          f.a.id,
          first.id,
          {
            targetCustomerId: f.c.id,
            expectedUpdatedAt: unshared.updatedAt.toISOString(),
            reason: "Gift",
            confirmed: true,
          },
          f.manager.id,
        ),
      );
      assert.equal(
        await scoped(() =>
          prisma.prepaidBalanceEvent.count({
            where: { holdingId: first.id, kind: "TRANSFER", actorId: f.manager.id },
          }),
        ),
        1,
      );
      // Concurrent family draws cannot overdraw the last balance.
      await scoped(() =>
        changePrepaidMembership(
          f.a.id,
          { familyId: family.id, expectedFamilyId: null, reason: "Rejoin", confirmed: true },
          f.manager.id,
        ),
      );
      const currentNoExpiry = await scoped(() =>
        prisma.customerValuePackageHolding.findFirstOrThrow({ where: { id: noExpiry.id } }),
      );
      await scoped(() =>
        sharePrepaid(f.a.id, noExpiry.id, shareInput(currentNoExpiry), f.manager.id),
      );
      const raced = await Promise.allSettled([
        scoped(() => createSale(cart(10))),
        scoped(() => createSale(cart(10))),
      ]);
      assert.equal(raced.filter((row) => row.status === "fulfilled").length, 1);
      assert.equal(
        (
          await scoped(() =>
            prisma.customerValuePackageHolding.findFirstOrThrow({ where: { id: noExpiry.id } }),
          )
        ).amountRemaining.toFixed(2),
        "0.00",
      );
      const winning = raced.find((row) => row.status === "fulfilled");
      assert.ok(winning?.status === "fulfilled");
      // Restore to the exact holding even if it has since been unshared/transferred.
      const emptyShared = await scoped(() =>
        prisma.customerValuePackageHolding.findFirstOrThrow({ where: { id: noExpiry.id } }),
      );
      await scoped(() =>
        sharePrepaid(f.a.id, noExpiry.id, shareInput(emptyShared, null), f.manager.id),
      );
      await scoped(() =>
        voidSale(winning.value.id, { reason: "Restore before transfer" }, f.manager.id),
      );
      const restoredForTransfer = await scoped(() =>
        prisma.customerValuePackageHolding.findFirstOrThrow({ where: { id: noExpiry.id } }),
      );
      const directSpend = await scoped(() =>
        createSale({
          ...cart(5, f.a.id),
          payments: [{ method: "PREPAID_CREDIT", amount: 5, holdingId: noExpiry.id }],
        }),
      );
      const afterDirectSpend = await scoped(() =>
        prisma.customerValuePackageHolding.findFirstOrThrow({ where: { id: noExpiry.id } }),
      );
      await scoped(() =>
        transferPrepaid(
          f.a.id,
          noExpiry.id,
          {
            targetCustomerId: f.c.id,
            expectedUpdatedAt: afterDirectSpend.updatedAt.toISOString(),
            reason: "Transfer remaining",
            confirmed: true,
          },
          f.manager.id,
        ),
      );
      await scoped(() =>
        voidSale(directSpend.id, { reason: "Restore to source holding" }, f.manager.id),
      );
      const sourceRestored = await scoped(() =>
        prisma.customerValuePackageHolding.findFirstOrThrow({ where: { id: noExpiry.id } }),
      );
      assert.equal(sourceRestored.customerId, f.c.id);
      assert.equal(
        sourceRestored.amountRemaining.toFixed(2),
        restoredForTransfer.amountRemaining.toFixed(2),
      );
      // Concurrent revocation/spend is linearizable: either the draw committed
      // before withdrawal, or the entire sale is refused; never a partial draw.
      const revocable = await holding("sharing-revocable", "2.00", new Date("2091-01-01"));
      await scoped(() => sharePrepaid(f.a.id, revocable.id, shareInput(revocable), f.manager.id));
      const revocation = await Promise.allSettled([
        scoped(() =>
          changePrepaidMembership(
            f.b.id,
            {
              familyId: null,
              expectedFamilyId: family.id,
              reason: "Revoke borrower",
              confirmed: true,
            },
            f.manager.id,
          ),
        ),
        scoped(() => createSale(cart(2))),
      ]);
      assert.equal(revocation[0]!.status, "fulfilled");
      const remainingAfterRace = await scoped(() =>
        prisma.customerValuePackageHolding.findFirstOrThrow({ where: { id: revocable.id } }),
      );
      assert.equal(
        remainingAfterRace.amountRemaining.toFixed(2),
        revocation[1]!.status === "fulfilled" ? "0.00" : "2.00",
      );
      await assert.rejects(
        scoped(() => createSale(cart(1))),
        { code: "HOLDING_NOT_FOUND" },
      );
      await scoped(() =>
        changePrepaidMembership(
          f.b.id,
          { familyId: family.id, expectedFamilyId: null, reason: "Rejoin", confirmed: true },
          f.manager.id,
        ),
      );
      // Archiving an owner suppresses its shared credit; expiry boundary remains exact.
      await scoped(() =>
        prisma.customer.update({ where: { id: f.a.id }, data: { archivedAt: new Date() } }),
      );
      assert.equal((await scoped(() => getCustomerHoldings(f.b.id))).holdings.length, 0);
      await scoped(() =>
        prisma.customer.update({ where: { id: f.a.id }, data: { archivedAt: null } }),
      );
      await scoped(() =>
        prisma.customerValuePackageHolding.update({
          where: { id: revocable.id },
          data: { expiresAt: new Date(0) },
        }),
      );
      assert.equal((await scoped(() => getCustomerHoldings(f.b.id))).holdings.length, 0);
      // Grants, held completion and purchase voids produce balance evidence too.
      const purchase = {
        customerId: f.a.id,
        lines: [{ itemType: "VALUE_PACKAGE" as const, itemId: f.credit.id, quantity: 1 }],
        payments: [{ method: "CASH" as const, amount: 100 }],
      };
      const grant = await post("/sales", purchase);
      assert.equal(grant.status, 201, await grant.clone().text());
      const grantSale = ((await grant.json()) as { data: { id: string } }).data;
      assert.equal(
        await scoped(() =>
          prisma.prepaidBalanceEvent.count({
            where: { saleId: grantSale.id, kind: "GRANT", actorId: f.manager.id },
          }),
        ),
        1,
      );
      await scoped(() => voidSale(grantSale.id, { reason: "Cancel purchase" }, f.manager.id));
      assert.equal(
        await scoped(() =>
          prisma.prepaidBalanceEvent.count({
            where: { saleId: grantSale.id, kind: "REMOVAL", actorId: f.manager.id },
          }),
        ),
        1,
      );
      const held = await scoped(() => createSale({ ...purchase, hold: true, payments: [] }));
      await scoped(() => completeSale(held.id, purchase));
      assert.equal(
        await scoped(() =>
          prisma.prepaidBalanceEvent.count({ where: { saleId: held.id, kind: "GRANT" } }),
        ),
        1,
      );
      // Any failed balance evidence insert aborts the whole sale/holding change.
      const currentSecond = await scoped(() =>
        prisma.customerValuePackageHolding.findFirstOrThrow({ where: { id: second.id } }),
      );
      await scoped(() => sharePrepaid(f.a.id, second.id, shareInput(currentSecond), f.manager.id));
      await assert.rejects(
        scoped(() =>
          createSale({
            ...cart(1, f.a.id),
            payments: [{ method: "PREPAID_CREDIT", amount: 1, holdingId: second.id }],
          }),
        ),
        { code: "HOLDING_NOT_FOUND" },
      );
      const sharedSecond = await scoped(() =>
        prisma.customerValuePackageHolding.findFirstOrThrow({ where: { id: second.id } }),
      );
      await assert.rejects(
        scoped(() =>
          transferPrepaid(
            f.a.id,
            second.id,
            {
              targetCustomerId: f.c.id,
              expectedUpdatedAt: sharedSecond.updatedAt.toISOString(),
              reason: "Try transfer shared",
              confirmed: true,
            },
            f.manager.id,
          ),
        ),
        { code: "SHARED_TRANSFER_UNAVAILABLE" },
      );
      await runAsPlatform(() =>
        prisma.$executeRawUnsafe(
          `CREATE FUNCTION reject_balance_test_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId" = 'prepaid-sharing-acceptance-a' THEN RAISE EXCEPTION 'injected balance evidence failure'; END IF; RETURN NEW; END; $$`,
        ),
      );
      await runAsPlatform(() =>
        prisma.$executeRawUnsafe(
          `CREATE TRIGGER reject_balance_test_event BEFORE INSERT ON prepaid_balance_events FOR EACH ROW EXECUTE FUNCTION reject_balance_test_event()`,
        ),
      );
      try {
        const count = await scoped(() => prisma.sale.count());
        await assert.rejects(
          scoped(() => createSale(cart(1))),
          /injected balance evidence failure/,
        );
        assert.equal(await scoped(() => prisma.sale.count()), count);
        assert.equal(
          (
            await scoped(() =>
              prisma.customerValuePackageHolding.findFirstOrThrow({ where: { id: second.id } }),
            )
          ).amountRemaining.toFixed(2),
          currentSecond.amountRemaining.toFixed(2),
        );
      } finally {
        await runAsPlatform(() =>
          prisma.$executeRawUnsafe(
            `DROP TRIGGER reject_balance_test_event ON prepaid_balance_events`,
          ),
        );
        await runAsPlatform(() =>
          prisma.$executeRawUnsafe(`DROP FUNCTION reject_balance_test_event()`),
        );
      }
    } finally {
      server.close();
      await once(server, "close");
      await purge();
      await prisma.$disconnect();
    }
  },
);
