import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { lockCommissionConfiguration } from "./commission.service.js";
import { lockPrepaid } from "../lib/prepaid-lock.js";
import { setTimeout } from "node:timers/promises";
import {
  payrollInputHash,
  type PayrollCloseInputs,
  type PayrollCloseState,
} from "./payroll-close-state.js";
import {
  adjustStoredPayrollClose,
  approveStoredPayrollClose,
  calculateStoredPayrollClose,
  confirmStoredPayrollPayout,
  correctStoredPayrollClose,
  readStoredPayrollStatement,
  type PayrollCloseLoader,
} from "./payroll-close-store.js";

test(
  "CP-005 isolated DB close persistence, rollback, audit, permissions and races",
  { skip: process.env.RUN_CP005_ACCEPTANCE !== "true" },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55485");
    assert.equal(url.pathname, "/payroll_close_test");
    const tenantId = `cp005-${randomUUID()}`;
    const ownerId = `${tenantId}-owner`;
    const managerId = `${tenantId}-manager`;
    const staffId = `${tenantId}-staff`;
    const otherId = `${tenantId}-other`;
    const scope = <T>(fn: () => T, actorId = ownerId) => runAsTenant(tenantId, fn, actorId);
    await runAsPlatform(async () => {
      for (const id of [tenantId, otherId])
        await prisma.tenant.create({
          data: { id, slug: id, name: "Synthetic CP005", status: "ACTIVE" },
        });
    });
    try {
      await scope(async () => {
        for (const [id, globalRole] of [
          [ownerId, "SUPER_ADMIN"],
          [managerId, "MANAGER"],
          [staffId, "STAFF"],
        ] as const)
          await prisma.user.create({
            data: {
              id,
              tenantId,
              name: id,
              email: `${id}@example.test`,
              passwordHash: "synthetic-unused",
              globalRole,
              twoFactorEnabled: true,
            },
          });
        const input = (): PayrollCloseInputs => ({
          periodKey: "2026-09",
          timeZone: "Asia/Singapore",
          currency: "SGD",
          startsAt: "2026-08-31T16:00:00.000Z",
          endsAt: "2026-09-30T16:00:00.000Z",
          evidence: { syntheticCompleteInventory: true, revision: 1 },
          staff: [
            {
              staff: { id: staffId, name: "Synthetic staff", disabled: false },
              profile: { basicSalary: "2000", fixedOvertime: "0", levy: "0", salesAlertPct: "50" },
              profileRevision: 1,
              collection: "0",
              adjustments: [],
              calculation: { staffId, periodKey: "2026-09", joinDate: null, plan: null, lines: [] },
            },
          ],
        });
        // Deliberately synthetic loader exercises persistence only, not authoritative money acceptance.
        const load: PayrollCloseLoader = async () => input();
        await assert.rejects(
          scope(() => calculateStoredPayrollClose("2026-09", 0, load), staffId),
          /not permitted/,
        );
        await assert.rejects(
          runAtOutlet("branch", () => calculateStoredPayrollClose("2026-09", 0, load)),
          /salon-wide/,
        );
        const failed: PayrollCloseLoader = async (tx) => {
          await tx.user.update({ where: { id: staffId }, data: { name: "Must roll back" } });
          throw new Error("Synthetic loader failure");
        };
        await assert.rejects(calculateStoredPayrollClose("2026-09", 0, failed), /loader failure/);
        assert.equal(
          (await prisma.user.findFirstOrThrow({ where: { id: staffId } })).name,
          staffId,
        );
        assert.equal(await prisma.payrollClose.count(), 0);
        assert.equal(await prisma.payrollCloseEvent.count(), 0);

        const race = await Promise.allSettled([
          calculateStoredPayrollClose("2026-09", 0, load),
          calculateStoredPayrollClose("2026-09", 0, load),
        ]);
        assert.equal(race.filter((row) => row.status === "fulfilled").length, 1);
        assert.equal(race.filter((row) => row.status === "rejected").length, 1);
        assert.equal(await prisma.payrollCloseEvent.count(), 1);
        await assert.rejects(
          scope(() => approveStoredPayrollClose("2026-09", 1, "Reviewed", load), managerId),
          /not permitted/,
        );
        const changed: PayrollCloseLoader = async () => ({ ...input(), evidence: { revision: 2 } });
        await assert.rejects(
          approveStoredPayrollClose("2026-09", 1, "Reviewed", changed),
          /inputs changed/,
        );
        assert.equal(await prisma.payrollCloseEvent.count(), 1);

        const adjustment = {
          id: "manual",
          staffId,
          actorId: ownerId,
          kind: "ADDITION" as const,
          amount: "12.00",
          reason: "Synthetic correction",
        };
        await adjustStoredPayrollClose("2026-09", 1, adjustment);
        await calculateStoredPayrollClose("2026-09", 2, load);
        const draft = await calculateStoredPayrollClose("2026-09", 3, load);
        assert.equal(draft.calculation!.statements[0].payroll.takeHome, "2012.00");
        const draftRow = await prisma.payrollClose.findFirstOrThrow();
        const corrupted = { ...draft, revision: 5 };
        await assert.rejects(
          prisma.payrollClose.update({
            where: { id: draftRow.id },
            data: { revision: 5, state: corrupted as never },
          }),
          /matching atomic audit/,
        );
        assert.equal((await prisma.payrollClose.findFirstOrThrow()).revision, 4);
        const previousEvent = await prisma.payrollCloseEvent.findFirstOrThrow({
          where: { revision: 4 },
        });
        await assert.rejects(
          prisma.payrollCloseEvent.create({
            data: {
              tenantId,
              periodKey: "2026-09",
              revision: 5,
              action: "APPROVE",
              actorId: ownerId,
              reason: "Orphan synthetic audit",
              previousHash: previousEvent.stateHash,
              stateHash: payrollInputHash(corrupted),
              state: corrupted as never,
            },
          }),
          /matching committed transition/,
        );
        await assert.rejects(readStoredPayrollStatement("2026-09", staffId), /Only approved/);

        // A close waiting on prepaid must not hold the tenant row needed by its
        // writer. NOWAIT turns the old inverted order into a deterministic failure.
        for (const action of ["CALCULATE", "APPROVE"] as const) {
          let ready!: (pid: number) => void;
          const holdingPrepaid = new Promise<number>((resolve) => {
            ready = resolve;
          });
          let releaseWriter!: () => void;
          const continueWriter = new Promise<void>((resolve) => {
            releaseWriter = resolve;
          });
          const writer = prisma.$transaction(async (tx) => {
            await lockPrepaid(tx, tenantId);
            const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
            ready(backend.pid);
            await continueWriter;
            await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE NOWAIT`;
          });
          const pid = await holdingPrepaid;
          const stopped = new Error("Lock-order probe stops before persistence");
          const probe: PayrollCloseLoader = async (tx) => {
            await lockPrepaid(tx, tenantId);
            await lockCommissionConfiguration(tx, tenantId);
            throw stopped;
          };
          const close = assert.rejects(
            action === "CALCULATE"
              ? calculateStoredPayrollClose("2026-09", 4, probe)
              : approveStoredPayrollClose("2026-09", 4, "Lock-order probe", probe),
            (error) => error === stopped,
          );
          let results: PromiseSettledResult<unknown>[];
          try {
            let waiting = false;
            for (let attempt = 0; attempt < 200 && !waiting; attempt++) {
              const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`
                SELECT EXISTS (
                  SELECT 1 FROM pg_locks held JOIN pg_locks blocked
                    ON held.locktype = blocked.locktype
                    AND held.database = blocked.database
                    AND held.classid = blocked.classid AND held.objid = blocked.objid
                    AND held.objsubid = blocked.objsubid
                  WHERE held.pid = ${pid} AND held.locktype = 'advisory'
                    AND held.granted AND NOT blocked.granted
                ) AS waiting`;
              waiting = row.waiting;
              if (!waiting) await setTimeout(10);
            }
            assert.equal(waiting, true, `${action} must wait on the writer's prepaid lock`);
          } finally {
            releaseWriter();
            results = await Promise.allSettled([writer, close]);
          }
          for (const result of results) if (result.status === "rejected") throw result.reason;
          assert.equal((await prisma.payrollClose.findFirstOrThrow()).revision, 4);
          assert.equal(await prisma.payrollCloseEvent.count(), 4);
        }

        // Lock barrier forces an authoritative input edit to commit before approval.
        let locked!: () => void;
        const holding = new Promise<void>((resolve) => {
          locked = resolve;
        });
        let release!: () => void;
        const barrier = new Promise<void>((resolve) => {
          release = resolve;
        });
        const edit = prisma.$transaction(async (tx) => {
          await lockCommissionConfiguration(tx, tenantId);
          await tx.user.update({
            where: { id: staffId },
            data: { name: "Changed authoritative staff" },
          });
          locked();
          await barrier;
        });
        await holding;
        const currentStaff: PayrollCloseLoader = async (tx) => {
          const data = input();
          data.staff[0].staff.name = (
            await tx.user.findFirstOrThrow({ where: { id: staffId } })
          ).name;
          return data;
        };
        const stale = assert.rejects(
          approveStoredPayrollClose("2026-09", 4, "Reviewed", currentStaff),
          /inputs changed/,
        );
        release();
        await edit;
        await stale;
        assert.equal((await prisma.payrollClose.findFirstOrThrow()).revision, 4);
        const approved = await approveStoredPayrollClose(
          "2026-09",
          4,
          "Synthetic reviewed close",
          load,
        );
        const frozenHash = payrollInputHash(approved.calculation);
        await assert.rejects(calculateStoredPayrollClose("2026-09", 5, load), /immutable/);
        await assert.rejects(
          adjustStoredPayrollClose("2026-09", 5, { ...adjustment, id: "other" }),
          /immutable/,
        );
        const stored = await prisma.payrollClose.findFirstOrThrow();
        const tampered = { ...approved, revision: 6, calculation: null };
        await assert.rejects(
          prisma.payrollClose.update({
            where: { id: stored.id },
            data: { revision: 6, state: tampered as never },
          }),
          /immutable/,
        );
        await assert.rejects(
          prisma.payrollCloseEvent.updateMany({ data: { reason: "tampered" } }),
          /append-only/,
        );
        await assert.rejects(prisma.payrollCloseEvent.deleteMany(), /append-only/);

        const own = await scope(() => readStoredPayrollStatement("2026-09", staffId), staffId);
        assert.equal(own.payroll.takeHome, "2012.00");
        await assert.rejects(
          scope(() => readStoredPayrollStatement("2026-09", staffId), managerId),
          /not permitted/,
        );
        assert.equal((await readStoredPayrollStatement("2026-09", staffId)).staff.id, staffId);
        await assert.rejects(
          runAsTenant(otherId, () => readStoredPayrollStatement("2026-09", staffId), ownerId),
          /unavailable/,
        );
        await prisma.user.update({
          where: { id: staffId },
          data: { name: "Later salary edit", disabled: true },
        });
        assert.equal(
          (await readStoredPayrollStatement("2026-09", staffId)).staff.name,
          "Synthetic staff",
        );

        const payouts = await Promise.allSettled([
          confirmStoredPayrollPayout("2026-09", 5, "bank-one", "Recorded bank transfer"),
          confirmStoredPayrollPayout("2026-09", 5, "bank-two", "Duplicate bank transfer"),
        ]);
        assert.equal(payouts.filter((row) => row.status === "fulfilled").length, 1);
        const paid = (await prisma.payrollClose.findFirstOrThrow())
          .state as unknown as PayrollCloseState;
        assert.equal(paid.revision, 6);
        assert.equal(payrollInputHash(paid.calculation), frozenHash);
        await assert.rejects(
          confirmStoredPayrollPayout("2026-09", 6, "duplicate", "Duplicate payout"),
          /already confirmed/,
        );
        const events = await prisma.payrollCloseEvent.findMany({ orderBy: { revision: "asc" } });
        assert.equal(events.length, 6);
        for (let index = 0; index < events.length; index++) {
          assert.equal(events[index].stateHash, payrollInputHash(events[index].state));
          assert.equal(events[index].previousHash, index ? events[index - 1].stateHash : null);
        }
        const originalHash = payrollInputHash(
          (await prisma.payrollClose.findFirstOrThrow({ where: { periodKey: "2026-09" } })).state,
        );
        const now = new Date();
        const localParts = new Intl.DateTimeFormat("en", {
          timeZone: "Asia/Singapore",
          year: "numeric",
          month: "2-digit",
        }).formatToParts(now);
        const nextPeriod = ["year", "month"]
          .map((key) => localParts.find((part) => part.type === key)!.value)
          .join("-");
        const corrected = await correctStoredPayrollClose("2026-09", nextPeriod, 0, {
          ...adjustment,
          id: "historical-correction",
        });
        assert.equal(corrected.status, "OPEN");
        assert.ok(corrected.adjustments[0].reason.includes("correction 2026-09@6"));
        assert.equal(
          payrollInputHash(
            (await prisma.payrollClose.findFirstOrThrow({ where: { periodKey: "2026-09" } })).state,
          ),
          originalHash,
        );
        await assert.rejects(
          correctStoredPayrollClose("2026-09", "2026-08", 0, { ...adjustment, id: "backdated" }),
          /backdated/,
        );
        await assert.rejects(
          scope(
            () =>
              correctStoredPayrollClose("2026-09", nextPeriod, 1, {
                ...adjustment,
                actorId: managerId,
                id: "manager-correction",
              }),
            managerId,
          ),
          /not permitted/,
        );
        await prisma.user.update({ where: { id: ownerId }, data: { twoFactorEnabled: false } });
        await assert.rejects(calculateStoredPayrollClose("2026-08", 0, load), /not permitted/);
        await prisma.user.update({ where: { id: ownerId }, data: { twoFactorEnabled: true } });
        await runAsPlatform(() =>
          prisma.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } }),
        );
        await assert.rejects(calculateStoredPayrollClose("2026-08", 0, load), /writable salon/);
        await runAsPlatform(() =>
          prisma.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE" } }),
        );
      });
    } finally {
      // Preserve immutable synthetic evidence inside the disposable database.
      await prisma.$disconnect();
    }
  },
);
