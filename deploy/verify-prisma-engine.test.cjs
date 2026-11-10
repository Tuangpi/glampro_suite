const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const { verifyPrismaEngine } = require("./verify-prisma-engine.cjs");

function fixture(t, version, mode = 0o755) {
  const modules = mkdtempSync(join(tmpdir(), "glampro-engine-"));
  t.after(() => rmSync(modules, { recursive: true, force: true }));
  const directory = join(modules, "@prisma/engines");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "index.js"), 'exports.enginesVersion = "locked-commit";\n');
  if (version !== null) {
    writeFileSync(
      join(directory, "schema-engine-debian-openssl-3.0.x"),
      `#!/bin/sh\nprintf '%s\\n' 'schema-engine-cli ${version}'\n`,
      { mode },
    );
  }
  return modules;
}

test("accepts the executable engine matching the locked commit", (t) => {
  assert.equal(verifyPrismaEngine(fixture(t, "locked-commit")), "schema-engine-cli locked-commit");
});

test("rejects a missing OpenSSL 3 engine", (t) => {
  assert.throws(() => verifyPrismaEngine(fixture(t, null)), /ENOENT/);
});

test("rejects a non-executable engine", (t) => {
  assert.throws(() => verifyPrismaEngine(fixture(t, "locked-commit", 0o644)), /EACCES/);
});

test("rejects a mismatched engine commit", (t) => {
  assert.throws(() => verifyPrismaEngine(fixture(t, "different-commit")), /version mismatch/);
});
