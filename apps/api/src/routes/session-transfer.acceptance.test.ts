import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

test(
  "same-salon session transfer HTTP, locking, evidence and reversal acceptance",
  {
    skip: process.env.SESSION_TRANSFER_ACCEPTANCE !== "1",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55448");
    assert.equal(url.pathname, "/session_transfer_test");
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "session-transfer-isolated-test-secret";
    const { prisma } = await import("../lib/prisma.js");
    const { runAsPlatform, runAsTenant } = await import("../lib/tenant-context.js");
    const { signAccessToken } = await import("../lib/tokens.js");
    const { createApp } = await import("../app.js");
    const { createSale, voidSale, refundSale } = await import("../services/sale.service.js");
    const {
      listTreatmentRedemptions,
      createTreatmentRecord,
      updateTreatmentRecord,
      getTreatmentRecord,
    } = await import("../services/treatment.service.js");
    const { transferSessionPackage, listSessionPackageTransfers } =
      await import("../services/session-transfer.service.js");
    const { reportOverview } = await import("../services/report.service.js");
    const { createPackage, updatePackage } = await import("../services/package.service.js");
    const tenantId = "session-transfer-acceptance-a";
    const foreignId = "session-transfer-acceptance-b";
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
            email: "owner@session-transfer.test",
            passwordHash: "unused",
            globalRole: "SUPER_ADMIN",
            twoFactorEnabled: true,
          },
        });
        const manager = await prisma.user.create({
          data: {
            tenantId,
            name: "Manager",
            email: "manager@session-transfer.test",
            passwordHash: "unused",
            globalRole: "MANAGER",
          },
        });
        const staff = await prisma.user.create({
          data: {
            tenantId,
            name: "Staff",
            email: "staff@session-transfer.test",
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
        const credit = await prisma.package.create({
          data: {
            tenantId,
            name: "Five sessions",
            sessionCount: 5,
            memberPrice: 100,
            nonmemberPrice: 100,
          },
        });
        const service = await prisma.service.create({
          data: { tenantId, name: "Care", memberPrice: 10, nonmemberPrice: 10 },
        });
        await prisma.packageService.create({
          data: { tenantId, packageId: credit.id, serviceId: service.id },
        });
        const cashier = await prisma.user.create({
          data: {
            tenantId,
            name: "Cashier",
            email: "cashier@session-transfer.test",
            passwordHash: "unused",
            globalRole: "CASHIER",
          },
        });
        const module = await prisma.module.upsert({
          where: { code: "packages" },
          update: {},
          create: { code: "packages", name: "Packages", category: "Add-on", isCore: false },
        });
        return { owner, manager, staff, cashier, a, b, c, foreign, credit, service, module };
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
          prisma.customerPackageHolding.create({
            data: {
              tenantId,
              customerId: fixture.a.id,
              packageId: fixture.credit.id,
              quantity: 5,
              quantityRemaining: 5,
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
        fetch(`${base}/${sourceId}/session-packages/${id}/transfer`, {
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
      assert.equal(
        (await transfer(fixture.a.id, holding.id, input(), token(fixture.cashier))).status,
        403,
      );
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
      for (const extra of [{ expiresAt: new Date(0) }, { quantityRemaining: 0 }]) {
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
      await assert.rejects(
        scoped(() => transferSessionPackage(fixture.a.id, holding.id, input(), fixture.owner.id)),
        code("TENANT_READ_ONLY"),
      );
      await runAsPlatform(() =>
        prisma.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE" } }),
      );
      await assert.rejects(
        scoped(() => transferSessionPackage(fixture.a.id, holding.id, input(), fixture.staff.id)),
        code("FORBIDDEN"),
      );
      await scoped(() =>
        prisma.user.update({ where: { id: fixture.manager.id }, data: { disabled: true } }),
      );
      await assert.rejects(
        scoped(() => transferSessionPackage(fixture.a.id, holding.id, input(), fixture.manager.id)),
        code("FORBIDDEN"),
      );
      await scoped(() =>
        prisma.user.update({ where: { id: fixture.manager.id }, data: { disabled: false } }),
      );

      const reportQuery = { from: "2026-10-01", to: "2026-10-31", timeZone: "Asia/Singapore" };
      const beforeLiability = (await scoped(() => reportOverview(reportQuery))).liability;
      const response = await transfer(fixture.a.id, holding.id, input(), managerToken);
      assert.equal(response.status, 201, await response.clone().text());
      const { data: event } = (await response.json()) as {
        data: { id: string; quantity: number; reason: string; actorId: string };
      };
      assert.equal(event.quantity, 5);
      assert.equal(event.reason, "Customer request");
      assert.equal(event.actorId, fixture.manager.id);
      const moved = await scoped(() =>
        prisma.customerPackageHolding.findFirstOrThrow({ where: { id: holding.id } }),
      );
      assert.equal(moved.customerId, fixture.b.id);
      assert.equal(moved.quantityRemaining, 5);
      assert.equal(moved.expiresAt?.toISOString(), holding.expiresAt?.toISOString());
      assert.equal(moved.saleLineId, holding.saleLineId);
      const owned = await get(`/${fixture.b.id}/session-packages?page=1&pageSize=1`, staffToken);
      assert.equal(owned.status, 200);
      const ownedBody = (await owned.json()) as {
        data: { data: { id: string; quantityRemaining: number }[]; total: number };
      };
      assert.equal(ownedBody.data.total, 1);
      assert.equal(ownedBody.data.data[0]?.id, holding.id);
      assert.equal(ownedBody.data.data[0]?.quantityRemaining, 5);
      const afterLiability = (await scoped(() => reportOverview(reportQuery))).liability;
      assert.deepEqual(
        { ...afterLiability, asOf: beforeLiability.asOf },
        beforeLiability,
        "transfer conserves every liability balance; report snapshot time advances independently",
      );
      assert.equal(
        (await transfer(fixture.a.id, holding.id, input(), ownerToken)).status,
        404,
        "duplicate cannot move again",
      );
      for (const id of [fixture.a.id, fixture.b.id]) {
        const history = await get(`/${id}/session-package-transfers?page=1&pageSize=1`, staffToken);
        assert.equal(history.status, 200);
        const body = (await history.json()) as { data: { total: number; data: { id: string }[] } };
        assert.equal(body.data.total, 1);
        assert.equal(body.data.data[0]?.id, event.id);
      }
      assert.equal((await get(`/${fixture.foreign.id}/session-package-transfers`)).status, 404);
      assert.equal(
        await runAsTenant(foreignId, () => prisma.sessionPackageTransferEvent.count()),
        0,
      );
      await assert.rejects(
        scoped(() =>
          prisma.sessionPackageTransferEvent.update({
            where: { id: event.id },
            data: { reason: "rewrite" },
          }),
        ),
      );
      await assert.rejects(
        scoped(() => prisma.sessionPackageTransferEvent.delete({ where: { id: event.id } })),
      );

      // Concurrent ownership attempts: only one event and one recipient.
      const race = await newHolding();
      const raced = await Promise.all([
        transfer(fixture.a.id, race.id, input(race.updatedAt, fixture.b.id), ownerToken),
        transfer(fixture.a.id, race.id, input(race.updatedAt, fixture.c.id), ownerToken),
      ]);
      assert.deepEqual(raced.map((r) => r.status).sort(), [201, 404]);
      assert.equal(
        await scoped(() =>
          prisma.sessionPackageTransferEvent.count({ where: { holdingId: race.id } }),
        ),
        1,
      );

      // Spend at original owner vs transfer must serialize, never lose a draw or mint credit.
      const spendRace = await newHolding();
      const saleInput = (customerId: string, holdingId: string) => ({
        customerId,
        lines: [{ itemType: "SERVICE" as const, itemId: fixture.service.id, quantity: 1 }],
        payments: [{ method: "PACKAGE" as const, amount: 10, holdingId }],
      });
      const concurrent = await Promise.allSettled([
        scoped(() =>
          transferSessionPackage(
            fixture.a.id,
            spendRace.id,
            input(spendRace.updatedAt),
            fixture.owner.id,
          ),
        ),
        scoped(() => createSale(saleInput(fixture.a.id, spendRace.id))),
      ]);
      assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
      const finalRace = await scoped(() =>
        prisma.customerPackageHolding.findFirstOrThrow({ where: { id: spendRace.id } }),
      );
      assert.ok(
        (finalRace.customerId === fixture.b.id && finalRace.quantityRemaining === 5) ||
          (finalRace.customerId === fixture.a.id && finalRace.quantityRemaining === 4),
      );

      // A previous redemption reversal restores the same holding under its new owner.
      const spent = await newHolding();
      const sale = await scoped(() => createSale(saleInput(fixture.a.id, spent.id)));
      const afterSpend = await scoped(() =>
        prisma.customerPackageHolding.findFirstOrThrow({ where: { id: spent.id } }),
      );
      await scoped(() =>
        transferSessionPackage(
          fixture.a.id,
          spent.id,
          input(afterSpend.updatedAt),
          fixture.owner.id,
        ),
      );
      const options = await scoped(() =>
        listTreatmentRedemptions({
          customerId: fixture.a.id,
          page: 1,
          pageSize: 10,
        }),
      );
      assert.ok(
        options.data.some((row) => row.receiptNumber === sale.receiptNumber),
        "original customer's treatment evidence remains linkable after transfer",
      );
      const recipientOptions = await scoped(() =>
        listTreatmentRedemptions({
          customerId: fixture.b.id,
          page: 1,
          pageSize: 10,
        }),
      );
      assert.ok(!recipientOptions.data.some((row) => row.receiptNumber === sale.receiptNumber));
      const evidence = options.data.find((row) => row.receiptNumber === sale.receiptNumber)!;
      const treatment = await scoped(() =>
        createTreatmentRecord({
          customerId: fixture.a.id,
          serviceId: fixture.service.id,
          treatmentType: "Care",
          status: "SCHEDULED",
          packageRedemptionId: evidence.id,
          quantityConsumed: 1,
        }),
      );
      assert.equal(treatment.customerId, fixture.a.id);
      await scoped(() =>
        updateTreatmentRecord(treatment.id, {
          packageRedemptionId: evidence.id,
          quantityConsumed: 1,
        }),
      );
      await assert.rejects(
        scoped(() =>
          createTreatmentRecord({
            customerId: fixture.b.id,
            serviceId: fixture.service.id,
            treatmentType: "Care",
            status: "SCHEDULED",
            packageRedemptionId: evidence.id,
            quantityConsumed: 1,
          }),
        ),
        code("REDEMPTION_NOT_FOUND"),
      );
      await assert.rejects(
        scoped(() =>
          refundSale(
            sale.id,
            {
              reason: "No package-funded refund",
              restock: false,
              payouts: [{ method: "CASH", amount: 10 }],
            },
            fixture.owner.id,
          ),
        ),
        code("SALE_NOT_REFUNDABLE"),
      );
      await scoped(() => voidSale(sale.id, { reason: "Reverse service" }, fixture.owner.id));
      const restored = await scoped(() =>
        prisma.customerPackageHolding.findFirstOrThrow({ where: { id: spent.id } }),
      );
      assert.equal(restored.customerId, fixture.b.id);
      assert.equal(restored.quantityRemaining, 5);
      assert.equal((await scoped(() => getTreatmentRecord(treatment.id))).customerId, fixture.a.id);
      await scoped(() => voidSale(sale.id, { reason: "Repeated reversal" }, fixture.owner.id));
      assert.equal(
        (
          await scoped(() =>
            prisma.customerPackageHolding.findFirstOrThrow({
              where: { id: spent.id },
            }),
          )
        ).quantityRemaining,
        5,
        "retry cannot restore twice",
      );
      assert.equal(restored.expiresAt?.toISOString(), spent.expiresAt?.toISOString());
      const recipientSale = await scoped(() => createSale(saleInput(fixture.b.id, spent.id)));
      await scoped(() =>
        voidSale(recipientSale.id, { reason: "Undo recipient visit" }, fixture.owner.id),
      );
      assert.equal(
        (
          await scoped(() =>
            prisma.customerPackageHolding.findFirstOrThrow({
              where: { id: spent.id },
            }),
          )
        ).quantityRemaining,
        5,
      );

      // Purchased credit retains provenance and cannot be erased by void after transfer.
      const purchase = await scoped(() =>
        createSale({
          customerId: fixture.a.id,
          lines: [{ itemType: "PACKAGE", itemId: fixture.credit.id, quantity: 1 }],
          payments: [{ method: "CASH", amount: 100 }],
        }),
      );
      const purchased = await scoped(() =>
        prisma.customerPackageHolding.findFirstOrThrow({
          where: { saleLine: { saleId: purchase.id } },
        }),
      );
      await scoped(() =>
        transferSessionPackage(
          fixture.a.id,
          purchased.id,
          input(purchased.updatedAt),
          fixture.owner.id,
        ),
      );
      const purchasedMoved = await scoped(() =>
        prisma.customerPackageHolding.findFirstOrThrow({
          where: { id: purchased.id },
        }),
      );
      assert.equal(purchasedMoved.saleLineId, purchased.saleLineId);
      assert.deepEqual(purchasedMoved.redemptionRules, purchased.redemptionRules);
      await scoped(() =>
        transferSessionPackage(
          fixture.b.id,
          purchased.id,
          input(purchasedMoved.updatedAt, fixture.a.id),
          fixture.owner.id,
        ),
      );
      await assert.rejects(
        scoped(() =>
          refundSale(
            purchase.id,
            {
              reason: "No package purchase refund",
              restock: false,
              payouts: [{ method: "CASH", amount: 100 }],
            },
            fixture.owner.id,
          ),
        ),
        code("SALE_NOT_REFUNDABLE"),
      );
      await assert.rejects(
        scoped(() => voidSale(purchase.id, { reason: "Wrong purchase" }, fixture.owner.id)),
        code("HOLDING_ALREADY_TRANSFERRED"),
      );
      assert.equal(
        (await scoped(() => prisma.sale.findFirstOrThrow({ where: { id: purchase.id } }))).status,
        "COMPLETED",
      );

      // Transfer vs purchase void: one wins, no missing holding behind a committed transfer.
      const racedPurchase = await scoped(() =>
        createSale({
          customerId: fixture.a.id,
          lines: [{ itemType: "PACKAGE", itemId: fixture.credit.id, quantity: 1 }],
          payments: [{ method: "CASH", amount: 100 }],
        }),
      );
      const racedHolding = await scoped(() =>
        prisma.customerPackageHolding.findFirstOrThrow({
          where: { saleLine: { saleId: racedPurchase.id } },
        }),
      );
      const purchaseRace = await Promise.allSettled([
        scoped(() =>
          transferSessionPackage(
            fixture.a.id,
            racedHolding.id,
            input(racedHolding.updatedAt),
            fixture.owner.id,
          ),
        ),
        scoped(() =>
          voidSale(racedPurchase.id, { reason: "Concurrent purchase reversal" }, fixture.owner.id),
        ),
      ]);
      assert.equal(purchaseRace.filter((result) => result.status === "fulfilled").length, 1);
      const raceEventCount = await scoped(() =>
        prisma.sessionPackageTransferEvent.count({
          where: { holdingId: racedHolding.id },
        }),
      );
      const remainingRaceHolding = await scoped(() =>
        prisma.customerPackageHolding.findFirst({
          where: { id: racedHolding.id },
        }),
      );
      assert.equal(!!remainingRaceHolding, raceEventCount === 1);
      if (remainingRaceHolding) assert.equal(remainingRaceHolding.quantityRemaining, 5);

      // A redemption void racing transfer cannot mint/lose sessions. A stale transfer may refuse.
      const reverseRaceHolding = await newHolding();
      const reverseRaceSale = await scoped(() =>
        createSale(saleInput(fixture.a.id, reverseRaceHolding.id)),
      );
      const reverseSnapshot = await scoped(() =>
        prisma.customerPackageHolding.findFirstOrThrow({
          where: { id: reverseRaceHolding.id },
        }),
      );
      const reverseRace = await Promise.allSettled([
        scoped(() =>
          transferSessionPackage(
            fixture.a.id,
            reverseSnapshot.id,
            input(reverseSnapshot.updatedAt),
            fixture.owner.id,
          ),
        ),
        scoped(() =>
          voidSale(reverseRaceSale.id, { reason: "Concurrent visit reversal" }, fixture.owner.id),
        ),
      ]);
      assert.equal(reverseRace[1]?.status, "fulfilled");
      assert.equal(
        (
          await scoped(() =>
            prisma.customerPackageHolding.findFirstOrThrow({
              where: { id: reverseSnapshot.id },
            }),
          )
        ).quantityRemaining,
        5,
      );

      // A service-set session transfers as one intact set, never as selected services.
      const secondService = await scoped(() =>
        prisma.service.create({
          data: {
            tenantId,
            name: "Second care",
            memberPrice: 20,
            nonmemberPrice: 20,
          },
        }),
      );
      const serviceSet = await scoped(() =>
        createPackage({
          name: "Two complete care sets",
          sessionCount: 2,
          memberPrice: 100,
          nonmemberPrice: 100,
          redemptionMode: "SERVICE_SET",
          serviceIds: [fixture.service.id, secondService.id],
          serviceSet: [
            { serviceId: fixture.service.id, quantity: 2 },
            { serviceId: secondService.id, quantity: 1 },
          ],
        }),
      );
      const setPurchase = await scoped(() =>
        createSale({
          customerId: fixture.a.id,
          lines: [{ itemType: "PACKAGE", itemId: serviceSet.id, quantity: 1 }],
          payments: [{ method: "CASH", amount: 100 }],
        }),
      );
      const setHolding = await scoped(() =>
        prisma.customerPackageHolding.findFirstOrThrow({
          where: { saleLine: { saleId: setPurchase.id } },
        }),
      );
      await scoped(() =>
        transferSessionPackage(
          fixture.a.id,
          setHolding.id,
          input(setHolding.updatedAt),
          fixture.owner.id,
        ),
      );
      await scoped(() =>
        updatePackage(serviceSet.id, {
          redemptionMode: "PER_UNIT",
          serviceSet: [],
          serviceIds: [secondService.id],
        }),
      );
      const setSpend = await scoped(() =>
        createSale({
          customerId: fixture.b.id,
          lines: [
            { itemType: "SERVICE", itemId: fixture.service.id, quantity: 2 },
            { itemType: "SERVICE", itemId: secondService.id, quantity: 1 },
          ],
          payments: [{ method: "PACKAGE", holdingId: setHolding.id, amount: 40 }],
        }),
      );
      assert.equal(
        (
          await scoped(() =>
            prisma.customerPackageHolding.findFirstOrThrow({
              where: { id: setHolding.id },
            }),
          )
        ).quantityRemaining,
        1,
      );
      await scoped(() =>
        voidSale(setSpend.id, { reason: "Undo complete care set" }, fixture.owner.id),
      );
      assert.equal(
        (
          await scoped(() =>
            prisma.customerPackageHolding.findFirstOrThrow({
              where: { id: setHolding.id },
            }),
          )
        ).quantityRemaining,
        2,
      );

      // Atomicity: force evidence insertion failure in this disposable DB only.
      const atomic = await newHolding();
      await runAsPlatform(() =>
        prisma.$executeRawUnsafe(
          `CREATE FUNCTION fail_session_test_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected test failure'; END; $$`,
        ),
      );
      await runAsPlatform(() =>
        prisma.$executeRawUnsafe(
          `CREATE TRIGGER fail_session_test_event BEFORE INSERT ON session_package_transfer_events FOR EACH ROW EXECUTE FUNCTION fail_session_test_event()`,
        ),
      );
      try {
        await assert.rejects(
          scoped(() =>
            transferSessionPackage(
              fixture.a.id,
              atomic.id,
              input(atomic.updatedAt),
              fixture.owner.id,
            ),
          ),
        );
        assert.equal(
          (
            await scoped(() =>
              prisma.customerPackageHolding.findFirstOrThrow({ where: { id: atomic.id } }),
            )
          ).customerId,
          fixture.a.id,
        );
      } finally {
        await runAsPlatform(() =>
          prisma.$executeRawUnsafe(
            `DROP TRIGGER fail_session_test_event ON session_package_transfer_events`,
          ),
        );
        await runAsPlatform(() =>
          prisma.$executeRawUnsafe(`DROP FUNCTION fail_session_test_event()`),
        );
      }
      const historyPage = await scoped(() =>
        listSessionPackageTransfers(fixture.a.id, { page: 1, pageSize: 1 }),
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
