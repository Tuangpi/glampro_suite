import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test(
  "admin provisioning persists safe fields, serializes duplicates and rolls back on audit failure",
  {
    skip: process.env.PLATFORM_ADMIN_ACCEPTANCE !== "1",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55468");
    assert.equal(url.pathname, "/platform_admin_test");
    const { prisma } = await import("../lib/prisma.js");
    const { createPlatformAdmin, listPlatformAdmins } = await import("./platform-admin.service.js");
    const { verifyPassword } = await import("../lib/password.js");
    const prefix = randomUUID();
    const email = `operator-${prefix}@example.test`;
    const input = {
      name: "New operator",
      email,
      password: "private-integration-passphrase",
      reason: "Approved support",
    };
    const actor = await prisma.platformAdmin.create({
      data: {
        email: `actor-${prefix}@example.test`,
        name: "Authorizer",
        passwordHash: "unused",
      },
    });
    const originalTransaction = prisma.$transaction;
    try {
      const results = await Promise.allSettled([
        createPlatformAdmin(actor.id, input),
        createPlatformAdmin(actor.id, { ...input, email: email.toUpperCase() }),
      ]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      const rejected = results.find((result) => result.status === "rejected");
      assert.equal((rejected?.reason as { statusCode: number }).statusCode, 409);
      const created = await prisma.platformAdmin.findUniqueOrThrow({ where: { email } });
      assert.equal(await verifyPassword(input.password, created.passwordHash), true);
      assert.equal(created.twoFactorEnabled, true);
      const list = await listPlatformAdmins({ page: 1, pageSize: 20, search: prefix });
      assert.equal(list.total, 2);
      assert.equal("passwordHash" in list.items[0], false);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { targetId: created.id, action: "platform.admin.create" },
      });
      assert.equal(audit.actorPlatformAdminId, actor.id);
      assert.deepEqual(audit.metadata, { reason: input.reason, source: "platform-console" });
      // Force a real FK failure at audit insertion after the account INSERT.
      Object.assign(prisma, {
        $transaction: (callback: (tx: object) => Promise<unknown>) =>
          originalTransaction.call(prisma, async (tx) =>
            callback({
              $queryRaw: tx.$queryRaw.bind(tx),
              platformAdmin: tx.platformAdmin,
              auditLog: {
                create: () =>
                  tx.auditLog.create({
                    data: {
                      actorPlatformAdminId: "missing-authorizer",
                      action: "test.rollback",
                      targetType: "PlatformAdmin",
                    },
                  }),
              },
            }),
          ),
      });
      const rollbackEmail = `rollback-${prefix}@example.test`;
      await assert.rejects(createPlatformAdmin(actor.id, { ...input, email: rollbackEmail }));
      prisma.$transaction = originalTransaction;
      assert.equal(await prisma.platformAdmin.count({ where: { email: rollbackEmail } }), 0);
    } finally {
      prisma.$transaction = originalTransaction;
      await prisma.auditLog.deleteMany({ where: { actorPlatformAdminId: actor.id } });
      await prisma.platformAdmin.deleteMany({ where: { email: { contains: prefix } } });
      await prisma.$disconnect();
    }
  },
);
