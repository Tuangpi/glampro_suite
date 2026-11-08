import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { requireTestDatabaseUrl } from "./test-database-safety.js";

const safeUrl = "postgresql://fixture:fixture@127.0.0.1:55490/glampro_test";
const cwd = fileURLToPath(new URL("../../", import.meta.url));

describe("test database isolation", () => {
  it("requires explicit test configuration without exposing credentials", () => {
    for (const value of [undefined, "", " ", "invalid-secret"]) {
      assert.throws(
        () => requireTestDatabaseUrl(value),
        (error: Error) => {
          assert.match(error.message, /TEST_DATABASE_URL/);
          assert.doesNotMatch(error.message, /invalid-secret/);
          return true;
        },
      );
    }
  });

  it("accepts local disposable test and acceptance databases", () => {
    for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
      for (const name of [
        "test",
        "glampro_test",
        "test_sales",
        "saas04_acceptance",
        "sales-test-1",
      ]) {
        const url = `postgresql://fixture:fixture@${host}:55490/${name}`;
        assert.equal(requireTestDatabaseUrl(url), url);
      }
    }
  });

  it("refuses application names, remote hosts, other protocols and connection overrides", () => {
    for (const url of [
      "postgresql://fixture:fixture@localhost/glampro_suite",
      "postgresql://fixture:fixture@localhost/latest",
      "postgresql://fixture:fixture@remote.example/glampro_test",
      "https://localhost/glampro_test",
      `${safeUrl}?host=remote.example`,
      `${safeUrl}#override`,
    ]) {
      assert.throws(() => requireTestDatabaseUrl(url), /Unsafe TEST_DATABASE_URL/);
    }
  });

  it("rejects the application database even through host aliases or different credentials", () => {
    assert.throws(
      () => requireTestDatabaseUrl(safeUrl, "postgres://other:private@localhost:5432/glampro_test"),
      /must not use the application database name/,
    );
    assert.equal(
      requireTestDatabaseUrl(safeUrl, "postgres://other:private@localhost:5432/glampro_suite"),
      safeUrl,
    );
    assert.throws(
      () => requireTestDatabaseUrl(safeUrl, "invalid"),
      /application DATABASE_URL is invalid/,
    );
  });

  const run = (imports: string[], code: string, overrides: NodeJS.ProcessEnv) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        ...imports.flatMap((path) => ["--import", path]),
        "--input-type=module",
        "-e",
        code,
      ],
      {
        cwd,
        encoding: "utf8",
        timeout: 15_000,
        env: {
          ...process.env,
          NODE_TEST_CONTEXT: "",
          DATABASE_URL: "postgresql://fixture:fixture@localhost:5432/glampro_suite",
          TEST_DATABASE_URL: "",
          ...overrides,
        },
      },
    );

  it("stops the test preload before tests run when TEST_DATABASE_URL is missing", () => {
    const result = run(
      ["./src/test-support/test-environment.ts"],
      'console.log("TEST_EXECUTED")',
      {},
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Database tests require TEST_DATABASE_URL/);
    assert.doesNotMatch(result.stdout, /TEST_EXECUTED/);
  });

  it("selects the test URL before imports, leaving the application URL unused", () => {
    const result = run(
      ["./src/test-support/test-environment.ts"],
      "console.log(JSON.stringify({url: process.env.DATABASE_URL, mode: process.env.NODE_ENV}))",
      { TEST_DATABASE_URL: safeUrl },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { url: safeUrl, mode: "test" });
  });

  it("rejects an explicitly supplied application connection before tests execute", () => {
    const result = run(["./src/test-support/test-environment.ts"], 'console.log("TEST_EXECUTED")', {
      TEST_DATABASE_URL: "postgresql://fixture:fixture@localhost:5432/glampro_suite",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsafe TEST_DATABASE_URL/);
    assert.doesNotMatch(result.stdout, /TEST_EXECUTED/);
  });

  it("blocks direct test-runner Prisma imports without the safe preload", () => {
    const result = run([], 'await import("./src/lib/prisma.ts")', {
      NODE_TEST_CONTEXT: "child-v8",
      TEST_DATABASE_URL: safeUrl,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsafe database test connection/);
  });
});
