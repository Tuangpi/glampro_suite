import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test(
  "valuation activation permissions, currency evidence, retry/race and atomic audit",
  {
    skip: process.env.PACKAGE_VALUATION_ACTIVATION_TEST !== "1",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55461");
    assert.equal(url.pathname, "/valuation_test");
    const { prisma } = await import("../lib/prisma.js");
    const { runAsTenant, runAsPlatform } = await import("../lib/tenant-context.js");
    const { activatePackageValuation, getPackageValuationActivation } =
      await import("./package-valuation.service.js");
    const { lockPrepaid } = await import("../lib/prepaid-lock.js");
    const ids: string[] = [];
    const input = {
      policyVersion: 1 as const,
      currency: "SGD" as const,
      reason: "Confirmed business purchases are SGD",
      confirmed: true as const,
    };
    try {
      async function salon() {
        const row = await prisma.tenant.create({
          data: { name: "Valuation activation fixture", slug: randomUUID() },
        });
        ids.push(row.id);
        return row;
      }
      const a = await salon(),
        b = await salon(),
        c = await salon(),
        d = await salon();
      async function user(
        tenantId: string,
        role: "MANAGER" | "STAFF" | "SUPER_ADMIN",
        disabled = false,
      ) {
        return runAsTenant(tenantId, () =>
          prisma.user.create({
            data: {
              tenantId,
              name: role,
              email: `${randomUUID()}@valuation.test`,
              passwordHash: "not-a-login-fixture",
              globalRole: role,
              disabled,
            },
          }),
        );
      }
      const manager = await user(a.id, "MANAGER"),
        staff = await user(a.id, "STAFF"),
        disabled = await user(a.id, "MANAGER", true),
        owner = await user(a.id, "SUPER_ADMIN"),
        foreign = await user(b.id, "MANAGER"),
        rollbackActor = await user(c.id, "MANAGER"),
        racingActor = await user(d.id, "MANAGER");
      const activate = (tenantId: string, actorId: string, request = input) =>
        runAsTenant(tenantId, () => activatePackageValuation(request, actorId), actorId);
      assert.equal(await runAsTenant(a.id, getPackageValuationActivation), null);
      await assert.rejects(() => activatePackageValuation(input, manager.id), /tenant scope/);
      await assert.rejects(
        () => runAsTenant(a.id, () => activatePackageValuation(input, manager.id)),
        /authenticated actor/,
      );
      for (const actor of [staff, disabled, owner, foreign]) {
        await assert.rejects(() => activate(a.id, actor.id), /Only an enabled owner or manager/);
      }
      await prisma.tenant.update({ where: { id: a.id }, data: { status: "SUSPENDED" } });
      await assert.rejects(() => activate(a.id, manager.id), /read-only/);
      await prisma.tenant.update({ where: { id: a.id }, data: { status: "ACTIVE" } });
      const subscription = await runAsTenant(a.id, () =>
        prisma.subscription.create({
          data: {
            tenantId: a.id,
            amount: 1,
            currency: "USD",
            status: "EXPIRED",
            startDate: new Date("2020-01-01T00:00:00Z"),
            endDate: new Date("2020-02-01T00:00:00Z"),
          },
        }),
      );
      await assert.rejects(() => activate(a.id, manager.id), /read-only/);
      await runAsTenant(a.id, () =>
        prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: "ACTIVE",
            endDate: new Date("2099-01-01T00:00:00Z"),
          },
        }),
      );
      const before = Date.now();
      const [first, retry] = await Promise.all([
        activate(a.id, manager.id),
        activate(a.id, manager.id),
      ]);
      assert.deepEqual(first, retry);
      assert.equal(
        first.currency,
        "SGD",
        "USD subscription billing must not supply purchase currency.",
      );
      assert.ok(new Date(first.activatedAt).getTime() >= before - 1);
      assert.equal(first.actorId, manager.id);
      assert.equal(await runAsTenant(b.id, getPackageValuationActivation), null);
      assert.equal(
        await runAsTenant(a.id, () => prisma.packagePurchaseSnapshot.count()),
        0,
        "Activation must never backfill holdings.",
      );
      await assert.rejects(
        () => activate(a.id, manager.id, { ...input, reason: "Rewrite evidence" }),
        /already activated/,
      );
      const audits = await prisma.auditLog.findMany({
        where: { tenantId: a.id, action: "package.valuation.activate" },
      });
      assert.equal(audits.length, 1);
      assert.equal(audits[0]?.targetId, first.id);

      // Failure at the audit boundary must roll back the activation row too.
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION valuation_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'package.valuation.activate' THEN RAISE EXCEPTION 'forced valuation audit failure'; END IF; RETURN NEW; END $$`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER valuation_test_reject_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION valuation_test_reject_audit()`,
      );
      try {
        await assert.rejects(
          () => activate(c.id, rollbackActor.id),
          /forced valuation audit failure/,
        );
        assert.equal(await runAsTenant(c.id, getPackageValuationActivation), null);
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER valuation_test_reject_audit ON audit_logs`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION valuation_test_reject_audit()`);
      }
      // A waiting activation must timestamp after the previous POS transaction releases its lock.
      let release!: () => void;
      let ready!: () => void;
      const readyPromise = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const releasePromise = new Promise<void>((resolve) => {
        release = resolve;
      });
      const blocker = runAsTenant(d.id, () =>
        prisma.$transaction(async (tx) => {
          await lockPrepaid(tx, d.id);
          ready();
          await releasePromise;
        }),
      );
      await readyPromise;
      const pending = Promise.allSettled([
        activate(d.id, racingActor.id),
        activate(d.id, racingActor.id, { ...input, reason: "Different concurrent confirmation" }),
      ]);
      const releasedAt = Date.now();
      release();
      await blocker;
      const results = await pending;
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.filter((result) => result.status === "rejected").length, 1);
      const result = await runAsTenant(d.id, getPackageValuationActivation);
      assert.ok(result && new Date(result.activatedAt).getTime() >= releasedAt - 1);
      await runAsTenant(b.id, () =>
        prisma.user.update({
          where: { id: foreign.id },
          data: { globalRole: "SUPER_ADMIN", twoFactorEnabled: true },
        }),
      );
      assert.equal(
        (await activate(b.id, foreign.id)).actorId,
        foreign.id,
        "Verified owner is permitted.",
      );
    } finally {
      await runAsPlatform(() => prisma.tenant.deleteMany({ where: { id: { in: ids } } }));
      await prisma.$disconnect();
    }
  },
);
