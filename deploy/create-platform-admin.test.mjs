import assert from "node:assert/strict";
import { test } from "node:test";
import { provisionPlatformAdmin } from "./create-platform-admin.mjs";

function fixture({ active = true, duplicate = false, auditFails = false } = {}) {
  const writes = [];
  const tx = {
    $queryRaw: async () => [],
    platformAdmin: {
      findUnique: async ({ where }) =>
        where.email === "authorizer@company.org"
          ? { id: "actor", status: active ? "ACTIVE" : "DISABLED" }
          : duplicate
            ? { id: "existing" }
            : null,
      create: async (args) => {
        writes.push(args);
        return { id: "new" };
      },
    },
    auditLog: {
      create: async (args) => {
        if (auditFails) throw new Error("audit unavailable");
        writes.push(args);
      },
    },
  };
  return {
    writes,
    environment: {
      NODE_ENV: "production",
      AUTHORIZING_ADMIN_EMAIL: "authorizer@company.org",
      ADMIN_CREATION_REASON: "Approved second operator",
    },
    dependencies: {
      prisma: {
        $transaction: async (callback) => {
          try {
            return await callback(tx);
          } catch (error) {
            writes.length = 0;
            throw error;
          }
        },
      },
      hashPassword: async () => "hashed-password",
      resolveSeedAdmin: () => ({
        email: "new@company.org",
        name: "Operator",
        password: "private-input",
      }),
    },
  };
}

test("creates an operator and audit in one transaction with verification enabled", async () => {
  const f = fixture();
  assert.equal(await provisionPlatformAdmin(f.dependencies, f.environment), "new");
  assert.equal(f.writes[0].data.passwordHash, "hashed-password");
  assert.equal(f.writes[0].data.twoFactorEnabled, true);
  assert.equal(f.writes[1].data.actorPlatformAdminId, "actor");
  assert.equal(f.writes[1].data.targetId, "new");
  assert.ok(!JSON.stringify(f.writes).includes("private-input"));
});

for (const options of [{ active: false }, { duplicate: true }, { auditFails: true }]) {
  test(`rejects safely: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    await assert.rejects(provisionPlatformAdmin(f.dependencies, f.environment));
    assert.equal(f.writes.length, 0);
  });
}

test("requires production, authorizer and reason before writes", async () => {
  for (const change of [
    { NODE_ENV: "development" },
    { AUTHORIZING_ADMIN_EMAIL: "" },
    { ADMIN_CREATION_REASON: "" },
  ]) {
    const f = fixture();
    await assert.rejects(provisionPlatformAdmin(f.dependencies, { ...f.environment, ...change }));
    assert.equal(f.writes.length, 0);
  }
});

test("uses existing credential validation before writes", async () => {
  const f = fixture();
  f.dependencies.resolveSeedAdmin = () => {
    throw new Error("Invalid credentials");
  };
  await assert.rejects(
    provisionPlatformAdmin(f.dependencies, f.environment),
    /Invalid credentials/,
  );
  assert.equal(f.writes.length, 0);
});
