import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";

test(
  "SC-003 transferred redemption HTTP correction/void permissions, atomic financial retries and isolation",
  {
    skip: process.env.SC003_CORRECTION_HTTP_TEST !== "1",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55464");
    assert.equal(url.pathname, "/commission_redemption_test");
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "sc003-correction-disposable-secret";
    const { Prisma } = await import("../../generated/prisma/client.js");
    const { prisma } = await import("../lib/prisma.js");
    const { runAsPlatform, runAsTenant } = await import("../lib/tenant-context.js");
    const { signAccessToken } = await import("../lib/tokens.js");
    const { createApp } = await import("../app.js");
    const { createSale } = await import("../services/sale.service.js");
    const { createPackage } = await import("../services/package.service.js");
    const { transferSessionPackage } = await import("../services/session-transfer.service.js");
    const { activatePackageValuation } = await import("../services/package-valuation.service.js");
    const { postVerifiedRedemptionCommission } =
      await import("../services/redemption-commission-posting.js");
    const { redemptionCommissionEvidenceSchema } =
      await import("../services/redemption-commission-evidence.js");
    const tenantId = `sc003-http-${randomUUID()}`,
      foreignId = `${tenantId}-foreign`;
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sales`;
    const scoped = <T>(fn: () => T) => runAsTenant(tenantId, fn);
    let packagesCore: boolean | undefined;
    async function call(path: string, body: object, token?: string) {
      const response = await fetch(base + path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }
    try {
      await runAsPlatform(() =>
        prisma.tenant.createMany({
          data: [
            { id: tenantId, name: "Synthetic HTTP correction", slug: tenantId },
            { id: foreignId, name: "Foreign synthetic", slug: foreignId },
          ],
        }),
      );
      for (const code of ["sales", "packages", "catalogue", "vouchers"]) {
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
      const makeUser = (id: string, globalRole: "MANAGER" | "STAFF" | "SUPER_ADMIN") =>
        runAsTenant(id, () =>
          prisma.user.create({
            data: {
              tenantId: id,
              name: globalRole,
              globalRole,
              passwordHash: "synthetic-not-login",
              email: `${randomUUID()}@sc003-http.test`,
            },
          }),
        );
      const manager = await makeUser(tenantId, "MANAGER"),
        staff = await makeUser(tenantId, "STAFF"),
        owner = await makeUser(tenantId, "SUPER_ADMIN"),
        foreign = await makeUser(foreignId, "MANAGER");
      const token = (user: typeof manager, realm: "web" | "platform" = "web") =>
        signAccessToken({
          id: user.id,
          email: user.email!,
          globalRole: user.globalRole,
          tenantId: user.tenantId,
          tokenVersion: 0,
          realm,
        }).token;
      const admin = token(manager),
        employee = token(staff),
        proprietor = token(owner),
        outsider = token(foreign);
      const fixture = await runAsTenant(
        tenantId,
        async () => {
          const buyer = await prisma.customer.create({
            data: { tenantId, name: "Buyer", familyId: "legacy-family" },
          });
          const recipient = await prisma.customer.create({
            data: { tenantId, name: "Recipient", familyId: "legacy-family" },
          });
          const service = await prisma.service.create({
            data: { tenantId, name: "Service", memberPrice: 10, nonmemberPrice: 10 },
          });
          await activatePackageValuation(
            {
              policyVersion: 1,
              currency: "SGD",
              reason: "Synthetic HTTP financial acceptance",
              confirmed: true,
            },
            manager.id,
          );
          const pkg = await createPackage({
            name: "Original three sessions",
            sessionCount: 3,
            memberPrice: 100,
            nonmemberPrice: 100,
            serviceIds: [service.id],
          });
          for (const [staffId, rate] of [
            [manager.id, "10.00"],
            [staff.id, "20.00"],
          ])
            await prisma.commissionRule.create({
              data: {
                tenantId,
                staffId: staffId!,
                itemKind: "PACKAGE_REDEMPTION",
                scope: "STAFF",
                scopeKey: randomUUID(),
                rate: rate!,
                effectiveAt: new Date(0),
                actorId: manager.id,
                reason: "Original own rate",
              },
            });
          const purchase = await createSale({
            customerId: buyer.id,
            lines: [{ itemType: "PACKAGE", itemId: pkg.id, quantity: 1 }],
            payments: [{ method: "CASH", amount: 100 }],
          });
          const holding = await prisma.customerPackageHolding.findFirstOrThrow({
            where: { saleLineId: { in: purchase.lines.map((line) => line.id) } },
          });
          // A legacy family label is not authorization to consume another person's sessions.
          await assert.rejects(
            createSale({
              customerId: recipient.id,
              lines: [{ itemType: "SERVICE", itemId: service.id, quantity: 1 }],
              payments: [{ method: "PACKAGE", amount: 10, holdingId: holding.id }],
            }),
            (error: unknown) =>
              error instanceof Error && "code" in error && error.code === "HOLDING_NOT_FOUND",
          );
          await transferSessionPackage(
            buyer.id,
            holding.id,
            {
              targetCustomerId: recipient.id,
              expectedUpdatedAt: holding.updatedAt.toISOString(),
              reason: "Explicit session ownership transfer",
              confirmed: true,
            },
            manager.id,
          );
          // Redemption prices may change; original package ordinal cents must not.
          await prisma.service.update({
            where: { id: service.id },
            data: { memberPrice: 70, nonmemberPrice: 70 },
          });
          const sale = await createSale({
            customerId: recipient.id,
            lines: [{ itemType: "SERVICE", itemId: service.id, quantity: 1 }],
            payments: [
              {
                method: "PACKAGE",
                amount: 70,
                holdingId: holding.id,
                performers: [{ staffId: manager.id, share: 10000 }],
              },
            ],
          });
          const redemption = await prisma.customerRedemption.findFirstOrThrow({
            where: { saleId: sale.id },
          });
          const snapshot = await prisma.commissionRedemptionSnapshot.findFirstOrThrow({
            where: { redemptionId: redemption.id },
          });
          assert.equal(
            redemptionCommissionEvidenceSchema.parse(snapshot.evidence).valuation?.netCents,
            "3334",
          );
          assert.equal(await prisma.employeeCommission.count({ where: { ledgerVersion: 1 } }), 0);
          const end = new Date(Date.now() + 1200);
          const period = await prisma.commissionPeriod.create({
            data: {
              tenantId,
              startsAt: new Date(redemption.usedAt.getTime() - 60000),
              endsAt: end,
              timezone: "UTC",
            },
          });
          const posted = await prisma.$transaction((tx) =>
            postVerifiedRedemptionCommission(tx, snapshot.id, manager.id),
          );
          assert.equal(posted[0]!.amount.toFixed(10), "3.3340000000");
          await setTimeout(Math.max(0, end.getTime() - Date.now() + 50));
          await prisma.commissionPeriod.update({
            where: { id: period.id },
            data: { approvedAt: new Date(), lockedAt: new Date() },
          });
          return { sale, redemption, snapshot, holding, recipient, end, posted };
        },
        manager.id,
      );
      const path = `/${fixture.sale.id}/redemptions/${fixture.redemption.id}/attribution-corrections`;
      const voidPath = `/${fixture.sale.id}/void`;
      const input = {
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        performers: [{ staffId: staff.id, share: 10000 }],
        reason: "Wrong performer corrected over HTTP",
      };
      const unchanged = async () =>
        scoped(async () => {
          assert.equal(await prisma.commissionRedemptionSnapshot.count(), 1);
          assert.equal(await prisma.employeeCommission.count({ where: { ledgerVersion: 1 } }), 1);
          assert.equal(
            (await prisma.sale.findFirstOrThrow({ where: { id: fixture.sale.id } })).status,
            "COMPLETED",
          );
          assert.equal(
            (
              await prisma.customerPackageHolding.findFirstOrThrow({
                where: { id: fixture.holding.id },
              })
            ).quantityRemaining,
            2,
          );
        });
      for (const [bearer, status] of [
        [undefined, 401],
        [employee, 403],
        [outsider, 404],
        [token(manager, "platform"), 403],
        [proprietor, 401],
      ] as const) {
        assert.equal((await call(path, input, bearer)).status, status);
        assert.equal(
          (await call(voidPath, { reason: "Unauthorized void" }, bearer)).status,
          status,
        );
        await unchanged();
      }
      for (const extra of [
        { tenantId: foreignId },
        { performers: [{ staffId: staff.id, share: 1 }] },
        { amount: "500.00" },
        { expectedRevision: -1 },
        { reason: "" },
      ]) {
        assert.equal((await call(path, { ...input, ...extra }, admin)).status, 422);
      }
      assert.equal(
        (await call(path, { ...input, performers: [{ staffId: foreign.id, share: 10000 }] }, admin))
          .status,
        400,
      );
      assert.equal(
        (
          await call(
            `/wrong-sale/redemptions/${fixture.redemption.id}/attribution-corrections`,
            input,
            admin,
          )
        ).status,
        404,
      );
      assert.equal(
        (await call(path, input, admin)).status,
        409,
        "No current open period must roll back correction",
      );
      assert.equal((await call(voidPath, { reason: "No open period" }, admin)).status, 409);
      await unchanged();
      const packages = await prisma.module.findUniqueOrThrow({ where: { code: "packages" } });
      packagesCore = packages.isCore;
      await prisma.module.update({ where: { id: packages.id }, data: { isCore: false } });
      await scoped(() =>
        prisma.tenantModule.updateMany({
          where: { moduleId: packages.id },
          data: { expiresAt: new Date(0) },
        }),
      );
      assert.equal((await call(path, input, admin)).body.code, "MODULE_NOT_ENTITLED");
      await unchanged();
      await scoped(() =>
        prisma.tenantModule.updateMany({
          where: { moduleId: packages.id },
          data: { expiresAt: null },
        }),
      );
      await prisma.module.update({ where: { id: packages.id }, data: { isCore: packagesCore } });
      const current = await scoped(() =>
        prisma.commissionPeriod.create({
          data: {
            tenantId,
            startsAt: fixture.end,
            endsAt: new Date(Date.now() + 3600000),
            timezone: "UTC",
          },
        }),
      );
      await runAsPlatform(() =>
        prisma.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } }),
      );
      assert.equal((await call(path, input, admin)).body.code, "TENANT_SUSPENDED");
      assert.equal(
        (await call(voidPath, { reason: "Suspended" }, admin)).body.code,
        "TENANT_SUSPENDED",
      );
      await unchanged();
      await runAsPlatform(() =>
        prisma.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE" } }),
      );
      await scoped(() => prisma.user.update({ where: { id: staff.id }, data: { disabled: true } }));
      assert.equal((await call(path, input, admin)).status, 400);
      await unchanged();
      await scoped(() =>
        prisma.user.update({ where: { id: staff.id }, data: { disabled: false } }),
      );
      await scoped(() =>
        prisma.user.update({ where: { id: manager.id }, data: { disabled: true } }),
      );
      assert.equal((await call(path, input, admin)).status, 401);
      assert.equal((await call(voidPath, { reason: "Disabled actor" }, admin)).status, 401);
      await unchanged();
      await scoped(() =>
        prisma.user.update({ where: { id: manager.id }, data: { disabled: false } }),
      );
      const corrections = await Promise.all([call(path, input, admin), call(path, input, admin)]);
      assert.deepEqual(
        corrections.map((row) => row.status),
        [200, 200],
      );
      assert.equal(corrections[0]!.body.data.id, corrections[1]!.body.data.id);
      assert.deepEqual(Object.keys(corrections[0]!.body.data).sort(), [
        "eventType",
        "id",
        "recordedAt",
        "redemptionId",
        "revision",
      ]);
      assert.equal(
        (await call(path, { ...input, reason: "Conflicting retry" }, admin)).status,
        409,
      );
      assert.equal(
        (await call(path, { ...input, idempotencyKey: randomUUID() }, admin)).status,
        409,
      );
      await scoped(async () => {
        const rows = await prisma.employeeCommission.findMany({ where: { ledgerVersion: 1 } });
        assert.equal(rows.length, 3);
        const reversal = rows.find((row) => row.entryType === "REVERSAL")!;
        assert.equal(reversal.reversesId, fixture.posted[0]!.id);
        assert.equal(reversal.periodId, current.id);
        const replacement = rows.find(
          (row) => row.entryType === "EARNING" && row.userId === staff.id,
        )!;
        assert.equal(replacement.amount.toFixed(10), "6.6680000000");
        assert.equal(replacement.periodId, current.id);
        // Current membership/token/role checks must also protect retry paths.
        await prisma.user.update({ where: { id: manager.id }, data: { globalRole: "STAFF" } });
      });
      assert.equal((await call(path, input, admin)).status, 403);
      assert.equal((await call(voidPath, { reason: "Revoked manager role" }, admin)).status, 403);
      await scoped(() =>
        prisma.user.update({
          where: { id: manager.id },
          data: { globalRole: "MANAGER", tokenVersion: 1 },
        }),
      );
      assert.equal((await call(path, input, admin)).status, 401);
      assert.equal((await call(voidPath, { reason: "Revoked token" }, admin)).status, 401);
      await scoped(() =>
        prisma.user.update({ where: { id: owner.id }, data: { twoFactorEnabled: true } }),
      );
      // A different actor cannot reuse the manager's correction key.
      assert.equal((await call(path, input, proprietor)).status, 409);
      const voids = await Promise.all([
        call(voidPath, { reason: "Void corrected redemption" }, proprietor),
        call(voidPath, { reason: "Concurrent void retry" }, proprietor),
      ]);
      assert.deepEqual(
        voids.map((row) => row.status),
        [200, 200],
      );
      assert.equal(
        (
          await call(
            path,
            { ...input, expectedRevision: 2, idempotencyKey: randomUUID() },
            proprietor,
          )
        ).status,
        404,
      );
      await scoped(async () => {
        const rows = await prisma.employeeCommission.findMany({ where: { ledgerVersion: 1 } });
        assert.equal(rows.length, 4);
        assert.equal(
          rows.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0)).toString(),
          "0",
        );
        assert.equal(await prisma.commissionRedemptionSnapshot.count(), 3);
        const restored = await prisma.customerPackageHolding.findFirstOrThrow({
          where: { id: fixture.holding.id },
        });
        assert.equal(restored.quantityRemaining, 3);
        assert.equal(
          restored.customerId,
          fixture.recipient.id,
          "Void does not undo a prior ownership transfer",
        );
        assert.notEqual(
          (
            await prisma.customerRedemption.findFirstOrThrow({
              where: { id: fixture.redemption.id },
            })
          ).revertedAt,
          null,
        );
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      if (packagesCore !== undefined)
        await prisma.module.update({ where: { code: "packages" }, data: { isCore: packagesCore } });
      // Immutable financial fixtures remain in this explicitly disposable database only.
      await prisma.$disconnect();
    }
  },
);
