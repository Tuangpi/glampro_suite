import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import bcrypt from "bcrypt";

test(
  "production seed initializes only a platform operator and shared modules and preserves existing operators",
  { skip: process.env.PRODUCTION_SEED_ACCEPTANCE !== "1" },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55468");
    assert.equal(url.pathname, "/seed_accounts_acceptance");
    assert.notEqual(
      process.env.SEED_ACCOUNTS_ACCEPTANCE,
      "1",
      "run seed modes separately on fresh databases",
    );
    const { prisma } = await import("../src/lib/prisma.js");
    const { runAsPlatform } = await import("../src/lib/tenant-context.js");
    const email = "platform@studio.sg";
    const password = "a-long-private-passphrase";
    const seed = (overrides: NodeJS.ProcessEnv = {}) =>
      spawnSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        env: {
          ...process.env,
          NODE_ENV: "test",
          SEED_MODE: "production",
          ADMIN_EMAIL: email,
          ADMIN_NAME: "Platform Operator",
          ADMIN_PASSWORD: password,
          SMTP_HOST: "",
          MESSAGING_WORKER_ENABLED: "false",
          ...overrides,
        },
        encoding: "utf8",
        timeout: 120_000,
      });
    try {
      await runAsPlatform(async () => {
        assert.equal(await prisma.tenant.count(), 0, "requires a fresh disposable database");
        assert.equal(await prisma.user.count(), 0);
        assert.equal(await prisma.platformAdmin.count(), 0);
        assert.notEqual(seed({ ADMIN_PASSWORD: "short" }).status, 0);
        assert.equal(await prisma.platformAdmin.count(), 0);
        assert.equal(await prisma.module.count(), 0);
        const initial = seed();
        assert.equal(initial.status, 0, initial.error?.message ?? initial.stderr);
        const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { email } });
        assert.equal(admin.name, "Platform Operator");
        assert.equal(await bcrypt.compare(password, admin.passwordHash), true);
        assert.equal(await prisma.tenant.count(), 0);
        assert.equal(await prisma.user.count(), 0);
        const modules = await prisma.module.count();
        assert.ok(modules > 0);
        const changedHash = await bcrypt.hash("changed-private-password", 10);
        await prisma.platformAdmin.update({
          where: { id: admin.id },
          data: { passwordHash: changedHash, status: "DISABLED" },
        });
        const repeated = seed();
        assert.equal(repeated.status, 0, repeated.error?.message ?? repeated.stderr);
        const preserved = await prisma.platformAdmin.findUniqueOrThrow({ where: { email } });
        assert.equal(preserved.passwordHash, changedHash);
        assert.equal(preserved.status, "DISABLED");
        assert.notEqual(seed({ ADMIN_EMAIL: "another@studio.sg" }).status, 0);
        assert.equal(await prisma.platformAdmin.count(), 1);
        assert.equal(await prisma.tenant.count(), 0);
        assert.equal(await prisma.user.count(), 0);
        assert.equal(await prisma.module.count(), modules);
        assert.equal(await prisma.auditLog.count({ where: { action: "platform.bootstrap" } }), 1);
      });
    } finally {
      await prisma.$disconnect();
    }
  },
);

test(
  "development seed separates platform and company accounts and preserves credentials on repeat",
  { skip: process.env.SEED_ACCOUNTS_ACCEPTANCE !== "1" },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55468");
    assert.equal(url.pathname, "/seed_accounts_acceptance");
    const { prisma } = await import("../src/lib/prisma.js");
    const { runAsPlatform } = await import("../src/lib/tenant-context.js");
    const seed = () => {
      const result = spawnSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        env: {
          ...process.env,
          NODE_ENV: "test",
          SEED_MODE: "development",
          SMTP_HOST: "",
          MESSAGING_WORKER_ENABLED: "false",
        },
        encoding: "utf8",
        timeout: 120_000,
      });
      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    };
    try {
      assert.equal(await prisma.tenant.count(), 0, "requires a fresh disposable database");
      assert.equal(await prisma.platformAdmin.count(), 0);
      seed();
      await runAsPlatform(async () => {
        const platform = await prisma.platformAdmin.findUniqueOrThrow({
          where: { email: "superadmin@gmail.com" },
        });
        const owner = await prisma.user.findUniqueOrThrow({ where: { email: "admin@gmail.com" } });
        const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: "glampro-demo" } });
        assert.equal(await prisma.tenant.count(), 1);
        assert.equal(await prisma.platformAdmin.count(), 1);
        assert.equal(await prisma.user.count({ where: { email: platform.email } }), 0);
        assert.equal(await prisma.platformAdmin.count({ where: { email: owner.email! } }), 0);
        assert.equal(owner.globalRole, "SUPER_ADMIN");
        assert.equal(tenant.ownerUserId, owner.id);
        assert.equal(owner.tenantId, tenant.id);
        assert.equal(await bcrypt.compare("superadmin12345", platform.passwordHash), true);
        assert.equal(await bcrypt.compare("admin12345", owner.passwordHash), true);
        const users = await prisma.user.count();
        const sales = await prisma.sale.count();
        const appointments = await prisma.appointment.count();
        const changedHash = await bcrypt.hash("changed-demo-password", 10);
        await prisma.platformAdmin.update({
          where: { id: platform.id },
          data: { passwordHash: changedHash, status: "DISABLED" },
        });
        await prisma.user.update({ where: { id: owner.id }, data: { passwordHash: changedHash } });
        seed();
        const repeatedPlatform = await prisma.platformAdmin.findUniqueOrThrow({
          where: { id: platform.id },
        });
        const repeatedOwner = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
        assert.equal(repeatedPlatform.passwordHash, changedHash);
        assert.equal(repeatedPlatform.status, "DISABLED");
        assert.equal(repeatedOwner.passwordHash, changedHash);
        assert.equal(await prisma.tenant.count(), 1);
        assert.equal(await prisma.platformAdmin.count(), 1);
        assert.equal(await prisma.user.count(), users);
        assert.equal(await prisma.sale.count(), sales);
        assert.equal(await prisma.appointment.count(), appointments);
        assert.equal(await prisma.auditLog.count({ where: { action: "platform.demo-seed" } }), 1);
      });
    } finally {
      await prisma.$disconnect();
    }
  },
);
