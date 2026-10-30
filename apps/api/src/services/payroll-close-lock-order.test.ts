import assert from "node:assert/strict";
import { test } from "node:test";
import { prisma } from "../lib/prisma.js";
import { runAsTenant } from "../lib/tenant-context.js";
import {
  approveStoredPayrollClose,
  calculateStoredPayrollClose,
  type PayrollCloseTransaction,
} from "./payroll-close-store.js";

test("calculate and approve acquire prepaid before tenant and authorization reads", async () => {
  const original = prisma.$transaction;
  const stopped = new Error("Stop before persistence");
  const calls: { kind: string; values?: unknown[] }[] = [];
  const tx = {
    $executeRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      assert.match(sql.join(""), /pg_advisory_xact_lock/);
      calls.push({ kind: "prepaid", values });
      return 1;
    },
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ kind: sql.join("").includes("FOR UPDATE") ? "tenant" : "context", values });
      return [];
    },
    user: {
      findFirst: async () => {
        calls.push({ kind: "actor" });
        throw stopped;
      },
    },
  } as unknown as PayrollCloseTransaction;
  Reflect.set(prisma, "$transaction", async (callback: (tx: PayrollCloseTransaction) => unknown) =>
    callback(tx),
  );
  try {
    for (const action of [
      () => calculateStoredPayrollClose("2026-09", 0),
      () => approveStoredPayrollClose("2026-09", 1, "Reviewed monthly payroll"),
    ]) {
      calls.length = 0;
      await assert.rejects(runAsTenant("salon", action, "owner"), (error) => error === stopped);
      assert.deepEqual(calls, [
        { kind: "prepaid", values: ["prepaid:salon"] },
        { kind: "context", values: ["owner", ""] },
        { kind: "tenant", values: ["salon"] },
        { kind: "actor" },
      ]);
    }
  } finally {
    Reflect.set(prisma, "$transaction", original);
  }
});
