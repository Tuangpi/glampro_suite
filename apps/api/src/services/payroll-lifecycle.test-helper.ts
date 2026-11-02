import assert from "node:assert/strict";
import { prisma } from "../lib/prisma.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";
import { loadPayrollLifecyclePostings } from "./payroll-lifecycle-posting.js";
import { payrollInputHash } from "./payroll-close-state.js";

/** Inject failure only at the final posting audit, after the real operational
 * writes. The transaction must undo every money/holding/source/audit change. */
export async function assertLifecycleRollback(source: () => Promise<unknown>, tenantId: string) {
  const snapshot = async () =>
    payrollInputHash(
      JSON.parse(
        JSON.stringify(
          await Promise.all([
            prisma.sale.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
            prisma.saleRefund.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
            prisma.customerPackageHolding.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
            prisma.customerValuePackageHolding.findMany({
              where: { tenantId },
              orderBy: { id: "asc" },
            }),
            prisma.customerRedemption.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
            prisma.payrollSourceEvent.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
            prisma.prepaidRefundSettlement.findMany({
              where: { tenantId },
              orderBy: { id: "asc" },
            }),
            prisma.prepaidBalanceEvent.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
            prisma.auditLog.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
          ]),
          (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item),
        ),
      ),
    );
  const before = await snapshot();
  const original = prisma.$transaction;
  prisma.$transaction = ((work: (tx: PayrollCloseTransaction) => Promise<unknown>) =>
    original.call(prisma, (tx: PayrollCloseTransaction) =>
      work(
        new Proxy(tx, {
          get(target, key, receiver) {
            if (key !== "auditLog") return Reflect.get(target, key, receiver);
            return new Proxy(tx.auditLog, {
              get(model, property, context) {
                if (property !== "create") return Reflect.get(model, property, context);
                return async (args: Parameters<typeof model.create>[0]) => {
                  if (args.data.action === "payroll.lifecycle.posting")
                    throw new Error("Injected lifecycle audit failure");
                  return model.create(args);
                };
              },
            });
          },
        }),
      ),
    )) as typeof prisma.$transaction;
  try {
    await assert.rejects(source(), /Injected lifecycle audit failure/);
  } finally {
    prisma.$transaction = original;
  }
  assert.equal(
    await snapshot(),
    before,
    "Failed posting must roll back complete operational state",
  );
}

/** Corrupt read evidence, never bypass append-only DB constraints. Each refusal
 * is checked against the real transactional loader and unchanged persisted data. */
export async function assertLifecycleCorruptionRefused(tenantId: string) {
  const audit = await prisma.auditLog.findFirstOrThrow({
    where: { tenantId, action: "payroll.lifecycle.posting" },
  });
  const metadata = audit.metadata as unknown as {
    events: { id: string }[];
    posting: { postingAt: string };
  };
  const eventId = metadata.events[0].id;
  for (const fault of [
    "missing-audit",
    "duplicate-audit",
    "posting-date",
    "missing-capture",
    "capture-date",
    "capture-lines",
  ] as const) {
    await prisma.$transaction(async (tx) => {
      const proxy = new Proxy(tx, {
        get(target, key, receiver) {
          if (key !== "auditLog" && key !== "payrollSourceEvent")
            return Reflect.get(target, key, receiver);
          const model = tx[key];
          return new Proxy(model, {
            get(delegate, property, context) {
              if (property !== "findMany") return Reflect.get(delegate, property, context);
              return async (args: unknown) => {
                const rows = (await Reflect.apply(delegate.findMany, delegate, [args])) as {
                  id: string;
                  metadata?: unknown;
                  occurredAt?: Date;
                  evidence?: unknown;
                }[];
                if (key === "auditLog") {
                  if (fault === "missing-audit") return rows.filter((row) => row.id !== audit.id);
                  if (fault === "duplicate-audit")
                    return [...rows, ...rows.filter((row) => row.id === audit.id)];
                  if (fault === "posting-date")
                    return rows.map((row) =>
                      row.id === audit.id
                        ? {
                            ...row,
                            metadata: {
                              ...metadata,
                              posting: {
                                ...metadata.posting,
                                postingAt: new Date(0).toISOString(),
                              },
                            },
                          }
                        : row,
                    );
                }
                if (key === "payrollSourceEvent") {
                  if (fault === "missing-capture") return rows.filter((row) => row.id !== eventId);
                  if (fault === "capture-date")
                    return rows.map((row) =>
                      row.id === eventId ? { ...row, occurredAt: new Date(0) } : row,
                    );
                  if (fault === "capture-lines")
                    return rows.map((row) =>
                      row.id === eventId ? { ...row, evidence: { lines: [] } } : row,
                    );
                }
                return rows;
              };
            },
          });
        },
      });
      await assert.rejects(
        loadPayrollLifecyclePostings(proxy, tenantId),
        /posting|capture|audit|inconsistent|invalid/i,
        fault,
      );
    });
  }
}

/** Pause only the first real writer, after its advisory lock, and prove that
 * the contender waits in PostgreSQL before releasing it. */
export async function orderedCorrectionWriters(
  first: () => Promise<unknown>,
  second: () => Promise<unknown>,
) {
  const original = prisma.$transaction;
  let release!: () => void;
  let enter!: (pid: number) => void;
  const entered = new Promise<number>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const restore = () => {
    prisma.$transaction = original;
  };
  const wrapper = <T>(
    work: (tx: PayrollCloseTransaction) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ) =>
    original.call(
      prisma,
      async (tx: PayrollCloseTransaction) =>
        work(
          new Proxy(tx, {
            get(target, key, receiver) {
              if (key !== "$executeRaw") return Reflect.get(target, key, receiver);
              return async (...args: Parameters<typeof tx.$executeRaw>) => {
                const result = await tx.$executeRaw(...args);
                if (Array.isArray(args[0]) && args[0].join("").includes("pg_advisory_xact_lock")) {
                  const [row] = await tx.$queryRaw<
                    { pid: number }[]
                  >`SELECT pg_backend_pid() AS pid`;
                  restore();
                  enter(row.pid);
                  await released;
                }
                return result;
              };
            },
          }),
        ),
      options,
    );
  prisma.$transaction = wrapper as typeof prisma.$transaction;
  const winner = Promise.allSettled([first()]);
  let contender: ReturnType<typeof Promise.allSettled> | undefined;
  try {
    const pid = await Promise.race([
      entered,
      winner.then(() => assert.fail("Writer did not reach its lock barrier")),
    ]);
    contender = Promise.allSettled([second()]);
    let blocked = false;
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline) {
      const [row] = await prisma.$queryRaw<
        { blocked: boolean }[]
      >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid)) AND wait_event_type = 'Lock') AS blocked`;
      if (row.blocked) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(blocked, "Contender must wait on the real PostgreSQL lock");
    release();
    return [(await winner)[0], (await contender)[0]] as const;
  } finally {
    restore();
    release();
    await winner;
    await contender;
  }
}
