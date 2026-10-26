import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { postCommission, reverseCommission } from "./commission-ledger.js";
import type { CommissionEvent } from "@glampro_suite/shared";

const enabled = process.env.COMMISSION_FOUNDATION_ACCEPTANCE === "1";
test("commission foundation transactional PostgreSQL acceptance", { skip: !enabled }, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/commission_foundation_test");
  const suffix = Date.now().toString();
  const tenantId = `sc002-${suffix}`;
  const actorId = `${tenantId}-manager`;
  const now = new Date();
  const start = new Date(now.getTime() - 60000);
  const end = new Date(now.getTime() + 3600000);
  try {
    await runAsPlatform(async () => {
      await prisma.tenant.create({
        data: { id: tenantId, name: "Synthetic commission", slug: tenantId },
      });
      await prisma.tenant.create({
        data: { id: `${tenantId}-other`, name: "Other salon", slug: `${tenantId}-other` },
      });
    });
    await runAsTenant(
      tenantId,
      async () => {
        await prisma.user.create({
          data: {
            id: actorId,
            tenantId,
            name: "Manager",
            passwordHash: "synthetic-not-login",
            globalRole: "MANAGER",
          },
        });
        const period = await prisma.commissionPeriod.create({
          data: { tenantId, startsAt: start, endsAt: end, timezone: "Asia/Singapore" },
        });
        await assert.rejects(
          prisma.commissionPeriod.create({
            data: { tenantId, startsAt: start, endsAt: end, timezone: "Asia/Singapore" },
          }),
        );
        const input: CommissionEvent = {
          eventKey: `earning-${suffix}`,
          kind: "PACKAGE_REDEMPTION",
          userId: actorId,
          actorId,
          sourceType: "REDEMPTION",
          sourceId: "synthetic-redemption",
          saleId: null,
          saleLineId: null,
          occurredAt: now.toISOString(),
          periodId: period.id,
          currency: "SGD",
          basis: "0.03",
          rate: "50.00",
          share: 3333,
          ruleId: null,
          ruleSource: "NONE",
          reason: "Synthetic foundation test",
        };
        const post = (value: CommissionEvent) =>
          prisma.$transaction((tx) => postCommission(tx, value));
        const [first, retry] = await Promise.all([post(input), post(input)]);
        assert.equal(first.id, retry.id);
        assert.equal(first.amount.toFixed(10), "0.0049995000");
        await assert.rejects(post({ ...input, rate: "51.00" }));
        await assert.rejects(
          post({ ...input, eventKey: "end-boundary", occurredAt: end.toISOString() }),
        );
        await assert.rejects(
          post({
            ...input,
            eventKey: "before-boundary",
            occurredAt: new Date(start.getTime() - 1).toISOString(),
          }),
        );
        await assert.rejects(post({ ...input, eventKey: "foreign-user", userId: "foreign-user" }));
        await assert.rejects(
          prisma.$transaction(async (tx) => {
            await postCommission(tx, { ...input, eventKey: "rollback" });
            throw new Error("synthetic downstream failure");
          }),
        );
        assert.equal(await prisma.employeeCommission.count({ where: { eventKey: "rollback" } }), 0);
        await assert.rejects(
          prisma.employeeCommission.update({ where: { id: first.id }, data: { amount: 99 } }),
        );
        await assert.rejects(prisma.employeeCommission.delete({ where: { id: first.id } }));
        await runAsTenant(`${tenantId}-other`, async () => {
          assert.equal(
            await prisma.employeeCommission.findFirst({ where: { id: first.id } }),
            null,
          );
          await assert.rejects(prisma.$transaction((tx) => postCommission(tx, input)));
        });
        await prisma.commissionPeriod.update({
          where: { id: period.id },
          data: { approvedAt: now, lockedAt: now },
        });
        assert.equal((await post(input)).id, first.id); // Retry does not re-post into a closed period.
        await assert.rejects(post({ ...input, eventKey: "closed" }));
        const next = await prisma.commissionPeriod.create({
          data: {
            tenantId,
            startsAt: end,
            endsAt: new Date(end.getTime() + 3600000),
            timezone: "Asia/Singapore",
          },
        });
        await assert.rejects(
          prisma.$transaction((tx) =>
            reverseCommission(tx, {
              originalId: first.id,
              eventKey: "future-reversal",
              actorId,
              reason: "Wrong future period",
              periodId: next.id,
            }),
          ),
        );
        // Use a second synthetic source in a currently open period for exact reversal.
      },
      actorId,
    );
    const reversalTenant = `${tenantId}-other`;
    await runAsTenant(reversalTenant, async () => {
      const actor = await prisma.user.create({
        data: {
          tenantId: reversalTenant,
          name: "Manager",
          passwordHash: "synthetic-not-login",
          globalRole: "MANAGER",
        },
      });
      const period = await prisma.commissionPeriod.create({
        data: {
          tenantId: reversalTenant,
          startsAt: start,
          endsAt: new Date(now.getTime() - 1000),
          timezone: "UTC",
        },
      });
      const entry = await prisma.$transaction((tx) =>
        postCommission(tx, {
          eventKey: "original",
          kind: "SERVICE",
          userId: actor.id,
          actorId: actor.id,
          sourceType: "MANUAL",
          sourceId: "synthetic",
          saleId: null,
          saleLineId: null,
          occurredAt: new Date(now.getTime() - 30000).toISOString(),
          periodId: period.id,
          currency: "SGD",
          basis: "0.01",
          rate: "0.01",
          share: 1,
          ruleId: null,
          ruleSource: "NONE",
          reason: "Exact reversal test",
        }),
      );
      await prisma.commissionPeriod.update({
        where: { id: period.id },
        data: { approvedAt: now, lockedAt: now },
      });
      const currentPeriod = await prisma.commissionPeriod.create({
        data: {
          tenantId: reversalTenant,
          startsAt: new Date(now.getTime() - 1000),
          endsAt: end,
          timezone: "UTC",
        },
      });
      const reversal = {
        originalId: entry.id,
        eventKey: "reverse",
        actorId: actor.id,
        reason: "Reverse synthetic source",
        periodId: currentPeriod.id,
      };
      const [a, b] = await Promise.all([
        prisma.$transaction((tx) => reverseCommission(tx, reversal)),
        prisma.$transaction((tx) => reverseCommission(tx, reversal)),
      ]);
      assert.equal(a.id, b.id);
      assert.equal(a.amount.plus(entry.amount).toString(), "0");
      await assert.rejects(
        prisma.$transaction((tx) =>
          reverseCommission(tx, { ...reversal, eventKey: "second-reversal" }),
        ),
      );
    });
  } finally {
    // Immutable financial fixtures intentionally survive until the disposable cluster is stopped.
    await prisma.$disconnect();
  }
});
