import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { after, before, mock, test } from "node:test";
import {
  PAYROLL_DEFAULT_SETTINGS,
  payrollPlanDefinitionSchema,
  type PayrollCarryBalance,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { lockCommissionConfiguration, publishCommissionRule } from "./commission.service.js";
import { authorizeStoredPayrollCarry } from "./payroll-close-authorizations.js";
import { loadAuthoritativePayrollCloseInputs } from "./payroll-close-loader.js";
import {
  assignPayrollPlan,
  createPayrollPlan,
  publishPayrollDraft,
  savePayrollDraft,
} from "./payroll-configuration.service.js";
import {
  approveStoredPayrollClose,
  calculateStoredPayrollClose,
  readStoredPayrollCarry,
  readStoredPayrollStatement,
} from "./payroll-close-store.js";
import { payrollInputHash, type PayrollCloseState } from "./payroll-close-state.js";
import { createSale } from "./sale.service.js";

const skip = process.env.RUN_CP005_ACCEPTANCE !== "true";
const reason = "Reviewed synthetic carry and plan-switch acceptance";
const zero = "0.0000000000";
let keepAlive: ReturnType<typeof setInterval> | undefined;
before(() => {
  // Prisma's idle pool may unref every socket while a lock barrier is pending.
  // Keep the acceptance process alive until the bounded race probes complete.
  if (!skip) keepAlive = setInterval(() => {}, 1000);
});
type Definition = ReturnType<typeof payrollPlanDefinitionSchema.parse>;

function definition(key = "service", fixed = false, rate = "10", basePct = "100"): Definition {
  return payrollPlanDefinitionSchema.parse({
    stages: [],
    components: [
      {
        key,
        name: key,
        sort: 1,
        commissionTypes: ["SVC"],
        basePct,
        method: fixed ? "FIXED_PER_UNIT" : "FLAT",
        ...(fixed ? { fixedAmount: rate } : { flatRatePct: rate }),
        bands: [],
      },
    ],
    incentives: [],
  });
}

function clock(at: string) {
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: new Date(at) });
}

async function fixture(
  carryForward: PayrollCarryBalance[],
  plan: Definition | null = definition(),
  fallbackCarryCommission = zero,
  departed = false,
) {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55485");
  assert.equal(url.pathname, "/payroll_close_test");
  const [identity] = await prisma.$queryRaw<{ directory: string; timezone: string }[]>`
    SELECT current_setting('data_directory') AS directory, current_setting('TimeZone') AS timezone`;
  assert.match(identity.directory, /^\/tmp\/cp005-/);
  assert.equal(identity.timezone, "UTC");
  const tenantId = `cp005-m3-${randomUUID()}`;
  const ownerId = randomUUID();
  const staffId = departed ? randomUUID() : ownerId;
  clock("2026-08-15T00:00:00Z");
  await runAsPlatform(() =>
    prisma.tenant.create({ data: { id: tenantId, slug: tenantId, name: "M3 acceptance" } }),
  );

  const scope = <T>(fn: () => T) => runAsTenant(tenantId, fn, ownerId);
  return scope(async () => {
    await prisma.user.create({
      data: {
        id: ownerId,
        tenantId,
        name: "Carry owner",
        passwordHash: "synthetic-unused",
        globalRole: "SUPER_ADMIN",
        twoFactorEnabled: true,
        startDate: new Date("2020-01-01"),
      },
    });
    if (departed)
      await prisma.user.create({
        data: {
          id: staffId,
          tenantId,
          name: "Departed debt staff",
          passwordHash: "synthetic-unused",
          disabled: true,
        },
      });
    for (const code of ["sales", "catalogue"]) {
      const module = await prisma.module.upsert({
        where: { code },
        update: {},
        create: { code, name: code, category: "Core", isCore: true },
      });
      await prisma.tenantModule.create({ data: { tenantId, moduleId: module.id } });
    }
    const outlet = await prisma.outlet.create({
      data: { tenantId, name: "Carry outlet", slug: "carry" },
    });
    const service = await prisma.service.create({
      data: { tenantId, name: "Carry service", memberPrice: "100", nonmemberPrice: "100" },
    });
    // Historical configuration fixtures only; all carry approvals, assignments,
    // checkout, monthly calculation and approval below use their real writers.
    for (const [kind, targetId, payload] of [
      ["SETTINGS", "company", PAYROLL_DEFAULT_SETTINGS],
      ...[...new Set([ownerId, staffId])].flatMap((id) => [
        [
          "STAFF",
          id,
          { joinDate: "2020-01-01", stageEndOverride: null, commissionRole: "NON_COMMISSION" },
        ],
        ["PROFILE", id, { basicSalary: "0", fixedOvertime: "0", levy: "0", salesAlertPct: "50" }],
      ]),
    ] as [string, string, object][])
      await prisma.payrollConfigurationEvent.create({
        data: {
          tenantId,
          kind,
          targetId,
          payload,
          revision: 1,
          actorId: ownerId,
          reason,
          createdAt: new Date("2026-08-15T00:00:00Z"),
        },
      });
    const publish = async (value: Definition) => {
      const row = await createPayrollPlan({
        name: `Carry plan ${randomUUID()}`,
        description: "Synthetic acceptance",
        positions: [],
        outletIds: [],
        definition: value,
        reason,
      });
      return publishPayrollDraft(row.id, { expectedRevision: row.revision, reason });
    };
    const first = plan ? await publish(plan) : null;
    const second = await publish(definition("next", false, "20"));
    const fixed = await publish(definition("units", true, "15"));
    if (first && !departed)
      await assignPayrollPlan({
        expectedRevision: 0,
        staffIds: [staffId],
        planId: first.id,
        fromDate: "2026-08-15",
        reason,
      });
    await authorizeStoredPayrollCarry(
      "OPENING",
      "2026-09",
      0,
      {
        staff: [...new Set([ownerId, staffId])].map((id) => ({
          staffId: id,
          carryForward: id === staffId ? carryForward : [],
          fallbackCarryCommission: id === staffId ? fallbackCarryCommission : zero,
        })),
        evidence: { inventoryReference: "Complete reviewed M3 synthetic opening" },
      },
      reason,
    );
    const switchPlan = async (planId: string | null, date = "2026-10-15") => {
      const event = await prisma.payrollConfigurationEvent.findFirst({
        where: { kind: "ASSIGNMENT", targetId: "company" },
        orderBy: { revision: "desc" },
      });
      return assignPayrollPlan({
        expectedRevision: event?.revision ?? 0,
        staffIds: [staffId],
        planId,
        fromDate: date,
        reason,
      });
    };
    const settle = async (
      period: string,
      components: { fromKey: string; toKey: string | null; reason: string }[],
      fallbackWriteOff: { amount: string } | null = null,
      expectedRevision = 0,
    ) => {
      const view = await readStoredPayrollCarry(period);
      const balance = view.balances.find((row) => row.staffId === staffId)!;
      return authorizeStoredPayrollCarry(
        "SETTLEMENT",
        period,
        expectedRevision,
        {
          staffId,
          balanceHash: balance.balanceHash,
          components,
          fallbackWriteOff,
          evidence: { reason },
        },
        reason,
      );
    };
    const sale = (quantity = 1) =>
      runAtOutlet(outlet.id, () =>
        createSale({
          lines: [
            {
              itemType: "SERVICE",
              itemId: service.id,
              quantity,
              attribution: {
                sellers: [{ staffId, share: 10000 }],
                performers: [{ staffId, share: 10000 }],
              },
            },
          ],
          payments: [{ method: "CASH", amount: quantity * 100 }],
          collection: {
            currency: "SGD",
            allocations: [
              { paymentIndex: 0, linePosition: 0, grossCents: String(quantity * 10000) },
            ],
          },
        }),
      );
    const statement = (state: PayrollCloseState) =>
      state.calculation!.statements.find((row) => row.staff.id === staffId)!;
    const close = async (period: string) => {
      const draft = await calculateStoredPayrollClose(period, 0);
      return approveStoredPayrollClose(period, draft.revision, reason);
    };
    return {
      tenantId,
      staffId,
      scope,
      first,
      second,
      fixed,
      switchPlan,
      settle,
      sale,
      statement,
      close,
    };
  });
}

after(async () => {
  mock.timers.reset();
  clearInterval(keepAlive);
  await prisma.$disconnect();
});

test(
  "M3 a new published version preserves prior approval and carries stable component balances",
  { skip },
  async () => {
    const f = await fixture([{ componentKey: "service", base: "-25.1234", units: "0.0000" }]);
    await f.scope(async () => {
      clock("2026-10-01T00:00:00Z");
      const prior = await f.close("2026-09");
      const hash = payrollInputHash(prior);
      const draft = await savePayrollDraft(f.first!.id, {
        expectedRevision: f.first!.revision,
        effectiveFrom: "2026-10-01",
        definition: definition("service", false, "20"),
        reason,
      });
      await publishPayrollDraft(draft.id, { expectedRevision: draft.revision, reason });
      clock("2026-10-15T00:00:00Z");
      await f.sale();
      clock("2026-11-01T00:00:00Z");
      const next = await f.close("2026-10");
      assert.equal(f.statement(next).result.planId, f.first!.id);
      assert.notEqual(f.statement(next).result.versionId, f.statement(prior).result.versionId);
      assert.equal(f.statement(next).result.components[0].pooledBase, "74.8766");
      assert.equal(f.statement(next).result.commissionTotal, "14.98");
      const stored = await prisma.payrollClose.findFirstOrThrow({
        where: { periodKey: "2026-09" },
      });
      assert.equal(payrollInputHash(stored.state), hash);
    });
  },
);

test(
  "M3 stable component debt is not scaled twice and rolls through three approved months",
  { skip },
  async () => {
    const f = await fixture(
      [{ componentKey: "service", base: "-100.1234", units: "0.0000" }],
      definition("service", false, "10", "50"),
    );
    await f.scope(async () => {
      clock("2026-09-15T00:00:00Z");
      await f.sale(2);
      clock("2026-10-01T00:00:00Z");
      const september = await f.close("2026-09");
      assert.deepEqual(f.statement(september).result.carryForward, [
        { componentKey: "service", base: "-0.1234", units: "0.0000" },
      ]);
      const frozen = payrollInputHash(september);
      clock("2026-10-15T00:00:00Z");
      await f.sale();
      clock("2026-11-01T00:00:00Z");
      const october = await f.close("2026-10");
      assert.equal(f.statement(october).result.commissionTotal, "4.99");
      assert.deepEqual(f.statement(october).result.carryForward, []);
      clock("2026-12-01T00:00:00Z");
      const november = await f.close("2026-11");
      assert.deepEqual(f.statement(november).result.carryForward, []);
      assert.equal(f.statement(november).result.commissionTotal, "0.00");
      const prior = await prisma.payrollClose.findFirstOrThrow({ where: { periodKey: "2026-09" } });
      assert.equal(payrollInputHash(prior.state), frozen);
    });
  },
);

test(
  "M3 month-end plan switch requires explicit many-to-one mapping and preserves four-decimal debt",
  { skip },
  async () => {
    const f = await fixture([
      { componentKey: "retired-a", base: "-25.1234", units: "0.0000" },
      { componentKey: "retired-b", base: "-74.8767", units: "0.0000" },
    ]);
    await f.scope(async () => {
      await assert.rejects(
        calculateStoredPayrollClose("2026-09", 0),
        /STAFF_CALCULATION_UNRESOLVED/,
      );
      assert.equal(await prisma.payrollCloseEvent.count(), 0);
      await f.settle("2026-09", [
        { fromKey: "retired-a", toKey: "service", reason },
        { fromKey: "retired-b", toKey: "service", reason },
      ]);
      clock("2026-10-01T00:00:00Z");
      const prior = await f.close("2026-09");
      assert.equal(f.statement(prior).result.carryForward[0].base, "-100.0001");
      await f.switchPlan(f.second.id);
      clock("2026-10-10T00:00:00Z");
      await f.sale(2); // Before the switch date; last-day selection applies to the whole month.
      await assert.rejects(
        calculateStoredPayrollClose("2026-10", 0),
        /STAFF_CALCULATION_UNRESOLVED/,
      );
      await f.settle("2026-10", [{ fromKey: "service", toKey: "next", reason }]);
      clock("2026-11-01T00:00:00Z");
      const next = await f.close("2026-10");
      assert.equal(f.statement(next).result.planId, f.second.id);
      assert.equal(f.statement(next).result.components[0].pooledBase, "99.9999");
      assert.equal(f.statement(next).result.commissionTotal, "20.00");
      assert.equal(f.statement(next).inputs.collection, "200.0000");
      assert.deepEqual(f.statement(next).result.carryForward, []);
    });
  },
);

test(
  "M3 fixed-unit carry maps only to fixed units and reconciles fractional awards",
  { skip },
  async () => {
    const f = await fixture(
      [{ componentKey: "old-units", base: "0.0000", units: "-1.3333" }],
      definition("service", true, "10"),
    );
    await f.scope(async () => {
      await f.settle("2026-09", [{ fromKey: "old-units", toKey: "service", reason }]);
      clock("2026-10-01T00:00:00Z");
      const prior = await f.close("2026-09");
      assert.equal(f.statement(prior).result.carryForward[0].units, "-1.3333");
      await f.switchPlan(f.fixed.id);
      await f.settle("2026-10", [{ fromKey: "service", toKey: "units", reason }]);
      clock("2026-10-15T00:00:00Z");
      await f.sale(2);
      clock("2026-11-01T00:00:00Z");
      const next = await f.close("2026-10");
      assert.equal(f.statement(next).result.components[0].units, "0.6667");
      assert.equal(f.statement(next).result.commissionTotal, "10.00");
      assert.deepEqual(f.statement(next).result.carryForward, []);
    });
  },
);

for (const shape of ["base-to-units", "units-to-base", "missing-target"] as const)
  test(`M3 ${shape} mapping cannot discard debt or persist a partial close`, { skip }, async () => {
    const units = shape === "units-to-base";
    const f = await fixture(
      [
        {
          componentKey: "old",
          base: units ? "0.0000" : "-1.2345",
          units: units ? "-0.1234" : "0.0000",
        },
      ],
      definition("service", shape === "base-to-units"),
    );
    await f.scope(async () => {
      await f.settle("2026-09", [
        { fromKey: "old", toKey: shape === "missing-target" ? "missing" : "service", reason },
      ]);
      await assert.rejects(
        calculateStoredPayrollClose("2026-09", 0),
        /STAFF_CALCULATION_UNRESOLVED/,
      );
      assert.equal(await prisma.payrollClose.count(), 0);
      assert.equal(await prisma.payrollCloseEvent.count(), 0);
      // A reviewed full write-off is a distinct, audited action, never a guessed mapping.
      await f.settle("2026-09", [{ fromKey: "old", toKey: null, reason }], null, 1);
      clock("2026-10-01T00:00:00Z");
      const approved = await f.close("2026-09");
      assert.deepEqual(f.statement(approved).result.carryWriteOffs, [
        {
          componentKey: "old",
          base: units ? "0.0000" : "-1.2345",
          units: units ? "-0.1234" : "0.0000",
          reason,
        },
      ]);
    });
  });

test(
  "M3 exact fallback commission offsets new source-rate earnings without repricing",
  { skip },
  async () => {
    const f = await fixture([], null, "-12.1234567890");
    await f.scope(async () => {
      await publishCommissionRule(
        {
          expectedRevision: null,
          staffId: f.staffId,
          itemKind: "SERVICE",
          scope: "STAFF",
          targetId: null,
          rate: 20,
          effectiveAt: "2026-09-01T00:00:00.000Z",
          reason,
        },
        f.staffId,
      );
      clock("2026-09-15T00:00:00Z");
      await f.sale();
      clock("2026-10-01T00:00:00Z");
      const approved = await f.close("2026-09");
      assert.equal(f.statement(approved).result.commissionTotal, "7.88");
      assert.equal(f.statement(approved).result.fallbackCarryCommission, zero);
      assert.equal(f.statement(approved).inputs.collection, "100.0000");
    });
  },
);

test(
  "M3 fallback-to-plan needs an exact audited debt write-off; stale drafts cannot approve",
  { skip },
  async () => {
    const f = await fixture([], null, "-12.1234567890");
    await f.scope(async () => {
      clock("2026-10-01T00:00:00Z");
      const prior = await f.close("2026-09");
      assert.equal(f.statement(prior).result.fallbackCarryCommission, "-12.1234567890");
      const draft = await calculateStoredPayrollClose("2026-10", 0);
      await f.switchPlan(f.second.id);
      await assert.rejects(
        calculateStoredPayrollClose("2026-10", 1),
        /STAFF_CALCULATION_UNRESOLVED/,
      );
      const count = await prisma.payrollCarryAuthorization.count();
      await assert.rejects(
        f.settle("2026-10", [], { amount: "-12.0000000000" }),
        /exact nonzero debt/,
      );
      assert.equal(await prisma.payrollCarryAuthorization.count(), count);
      await f.settle("2026-10", [], { amount: "-12.1234567890" });
      clock("2026-11-01T00:00:00Z");
      await assert.rejects(
        approveStoredPayrollClose("2026-10", draft.revision, reason),
        /inputs changed/,
      );
      const recalculated = await calculateStoredPayrollClose("2026-10", draft.revision);
      const approved = await approveStoredPayrollClose("2026-10", recalculated.revision, reason);
      assert.equal(f.statement(approved).result.fallbackCarryCommission, zero);
      await assert.rejects(f.settle("2026-10", [], { amount: "-12.1234567890" }, 1), /immutable/);
    });
  },
);

test(
  "M3 departed staff retain ten-decimal debt across approved months and frozen reads",
  { skip },
  async () => {
    const f = await fixture([], null, "-0.1234567890", true);
    await f.scope(async () => {
      clock("2026-10-01T00:00:00Z");
      await f.close("2026-09");
      clock("2026-11-01T00:00:00Z");
      const next = await f.close("2026-10");
      assert.equal(f.statement(next).staff.disabled, true);
      assert.equal(f.statement(next).result.fallbackCarryCommission, "-0.1234567890");
      const frozen = await readStoredPayrollStatement("2026-10", f.staffId);
      assert.equal(frozen.result.fallbackCarryCommission, "-0.1234567890");
    });
  },
);

test(
  "M3 plan-to-fallback never converts base debt into guessed commission money",
  { skip },
  async () => {
    const f = await fixture([{ componentKey: "service", base: "-25.1234", units: "0.0000" }]);
    await f.scope(async () => {
      clock("2026-10-01T00:00:00Z");
      await f.close("2026-09");
      await f.switchPlan(null);
      await assert.rejects(
        calculateStoredPayrollClose("2026-10", 0),
        /STAFF_CALCULATION_UNRESOLVED/,
      );
      await f.settle("2026-10", [{ fromKey: "service", toKey: "flat_rules", reason }]);
      await assert.rejects(
        calculateStoredPayrollClose("2026-10", 0),
        /STAFF_CALCULATION_UNRESOLVED/,
      );
      await f.settle("2026-10", [{ fromKey: "service", toKey: null, reason }], null, 1);
      clock("2026-11-01T00:00:00Z");
      const approved = await f.close("2026-10");
      assert.equal(f.statement(approved).result.planId, null);
      assert.equal(f.statement(approved).result.fallbackCarryCommission, zero);
      assert.equal(f.statement(approved).result.carryWriteOffs[0].base, "-25.1234");
    });
  },
);

test(
  "M3 a retained component key survives a plan change at its new rate without a settlement",
  { skip },
  async () => {
    const f = await fixture(
      [{ componentKey: "next", base: "-25.1234", units: "0.0000" }],
      definition("next"),
    );
    await f.scope(async () => {
      clock("2026-10-01T00:00:00Z");
      await f.close("2026-09");
      await f.switchPlan(f.second.id);
      clock("2026-10-15T00:00:00Z");
      await f.sale();
      clock("2026-11-01T00:00:00Z");
      const approved = await f.close("2026-10");
      assert.equal(f.statement(approved).result.components[0].pooledBase, "74.8766");
      assert.equal(f.statement(approved).result.commissionTotal, "14.98");
      assert.equal(
        await prisma.payrollCarryAuthorization.count({ where: { kind: "SETTLEMENT" } }),
        0,
      );
    });
  },
);

test(
  "M3 configuration guards approved plan-based periods independently of legacy locks",
  { skip },
  async () => {
    const f = await fixture([{ componentKey: "service", base: "-1.0000", units: "0.0000" }]);
    await f.scope(async () => {
      clock("2026-10-01T00:00:00Z");
      const approved = await f.close("2026-09");
      const hash = payrollInputHash(approved);
      assert.equal(await prisma.commissionPeriod.count(), 0);
      // Isolate the approved-close guard from the separate no-backdating guard.
      clock("2026-09-15T00:00:00Z");
      const audits = await prisma.payrollConfigurationEvent.count();
      await assert.rejects(f.switchPlan(f.second.id, "2026-09-15"), /approved payroll close/);
      const draft = await createPayrollPlan({
        name: "Cannot publish into frozen month",
        description: "Synthetic",
        positions: [],
        outletIds: [],
        definition: definition(),
        reason,
      });
      await assert.rejects(
        publishPayrollDraft(draft.id, { expectedRevision: draft.revision, reason }),
        /approved payroll close/,
      );
      assert.equal(await prisma.payrollConfigurationEvent.count(), audits + 1);
      const stored = await prisma.payrollClose.findFirstOrThrow({
        where: { periodKey: "2026-09" },
      });
      assert.equal(payrollInputHash(stored.state), hash);
      clock("2026-10-01T00:00:00Z");
      await f.switchPlan(f.second.id, "2026-10-15");
    });
  },
);

/** Observe actual PostgreSQL blocking, not a sleep-based claim of concurrency. */
async function waitForBlocked(pid: number) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_stat_activity
        WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS waiting`;
    if (row.waiting) return;
    await setTimeout(10);
  }
  assert.fail("Expected a queued PostgreSQL transaction");
}

for (const first of ["SETTLEMENT", "APPROVE"] as const)
  test(
    `M3 concurrent ${first.toLowerCase()} first preserves balances, rollback and frozen approval`,
    { skip },
    async () => {
      const f = await fixture([{ componentKey: "service", base: "-10.1234", units: "0.0000" }]);
      await f.scope(async () => {
        clock("2026-10-01T00:00:00Z");
        const draft = await calculateStoredPayrollClose("2026-09", 0);
        const view = await readStoredPayrollCarry("2026-09");
        const balanceHash = view.balances.find((row) => row.staffId === f.staffId)!.balanceHash;
        let ready!: (pid: number) => void;
        const holding = new Promise<number>((resolve) => {
          ready = resolve;
        });
        let release!: () => void;
        const barrier = new Promise<void>((resolve) => {
          release = resolve;
        });
        // Queue the first transaction behind a real tenant lock before launching
        // the competing writer. The lock queue, not JS scheduling, orders them.
        const blocker = prisma.$transaction(async (tx) => {
          await lockCommissionConfiguration(tx, f.tenantId);
          const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          ready(backend.pid);
          await barrier;
        });
        const pid = await holding;
        const settlement = () =>
          authorizeStoredPayrollCarry(
            "SETTLEMENT",
            "2026-09",
            0,
            {
              staffId: f.staffId,
              balanceHash,
              components: [{ fromKey: "service", toKey: null, reason }],
              fallbackWriteOff: null,
              evidence: { reason },
            },
            reason,
          );
        const approval = () => approveStoredPayrollClose("2026-09", draft.revision, reason);
        const earliest = (first === "SETTLEMENT" ? settlement() : approval()).then(
          (value) => ({ status: "fulfilled" as const, value }),
          (error: unknown) => ({ status: "rejected" as const, error }),
        );
        let latest: Promise<PromiseSettledResult<unknown>[]> | undefined;
        try {
          await waitForBlocked(pid);
          latest = Promise.allSettled([first === "SETTLEMENT" ? approval() : settlement()]);
          // Both operations are live before allowing either to commit.
          for (let attempt = 0; attempt < 200; attempt++) {
            const [row] = await prisma.$queryRaw<{ count: number }[]>`
            SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE cardinality(pg_blocking_pids(pid)) > 0 AND datname = current_database()`;
            if (row.count >= 2) break;
            if (attempt === 199) assert.fail("Both competing writers must be blocked");
            await setTimeout(10);
          }
        } finally {
          release();
          await blocker;
        }
        const winner = await earliest;
        const [loser] = await latest!;
        assert.equal(winner.status, "fulfilled");
        assert.equal(loser.status, "rejected");
        if (loser.status === "rejected")
          assert.match(
            String(loser.reason),
            first === "SETTLEMENT" ? /inputs changed/ : /immutable/,
          );
        if (first === "SETTLEMENT") {
          assert.equal(await prisma.payrollCloseEvent.count(), 1);
          const recalculated = await calculateStoredPayrollClose("2026-09", 1);
          const approved = await approveStoredPayrollClose(
            "2026-09",
            recalculated.revision,
            reason,
          );
          assert.deepEqual(f.statement(approved).result.carryForward, []);
          assert.equal(f.statement(approved).result.carryWriteOffs[0].base, "-10.1234");
        } else {
          assert.equal(await prisma.payrollCloseEvent.count(), 2);
          assert.equal(
            await prisma.payrollCarryAuthorization.count({ where: { kind: "SETTLEMENT" } }),
            0,
          );
          const frozen = await readStoredPayrollStatement("2026-09", f.staffId);
          assert.equal(frozen.result.carryForward[0].base, "-10.1234");
        }
      });
    },
  );

for (const first of ["ASSIGNMENT", "APPROVE"] as const)
  test(
    `M3 concurrent ${first.toLowerCase()} first serializes plan switching and approval`,
    { skip },
    async () => {
      const f = await fixture(
        [{ componentKey: "next", base: "-10.1234", units: "0.0000" }],
        definition("next"),
      );
      await f.scope(async () => {
        clock("2026-10-01T00:00:00Z");
        const prior = await f.close("2026-09");
        const priorHash = payrollInputHash(prior);
        clock("2026-10-15T00:00:00Z");
        await f.sale();
        const draft = await calculateStoredPayrollClose("2026-10", 0);
        assert.equal(f.statement(draft).result.commissionTotal, "8.99");
        const assignment = () =>
          assignPayrollPlan({
            expectedRevision: 1,
            staffIds: [f.staffId],
            planId: f.second.id,
            fromDate: "2026-10-20",
            reason,
          });
        // Model the month-end boundary while both transactions are live. The
        // approval uses the real loader, advancing its clock only after it owns
        // the shared lock. No input or state is fabricated by this wrapper.
        clock(first === "ASSIGNMENT" ? "2026-10-15T00:00:00Z" : "2026-11-01T00:00:00Z");
        let ready!: (pid: number) => void;
        const holding = new Promise<number>((resolve) => {
          ready = resolve;
        });
        let release!: () => void;
        const barrier = new Promise<void>((resolve) => {
          release = resolve;
        });
        const blocker = prisma.$transaction(async (tx) => {
          await lockCommissionConfiguration(tx, f.tenantId);
          const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          ready(backend.pid);
          await barrier;
        });
        const pid = await holding;
        const approval = () =>
          approveStoredPayrollClose("2026-10", draft.revision, reason, (tx, state) => {
            clock("2026-11-01T00:00:00Z");
            return loadAuthoritativePayrollCloseInputs(tx, state);
          });
        const earliest = Promise.allSettled([first === "ASSIGNMENT" ? assignment() : approval()]);
        let latest: Promise<PromiseSettledResult<unknown>[]> | undefined;
        try {
          await waitForBlocked(pid);
          latest = Promise.allSettled([first === "ASSIGNMENT" ? approval() : assignment()]);
          await waitForBlockedCount(2);
        } finally {
          release();
          await blocker;
        }
        const [winner] = await earliest;
        clock("2026-11-01T00:00:00Z");
        const [loser] = await latest!;
        assert.equal(
          winner.status,
          "fulfilled",
          winner.status === "rejected" ? String(winner.reason) : "",
        );
        assert.equal(loser.status, "rejected");
        if (loser.status === "rejected")
          assert.match(
            String(loser.reason),
            first === "ASSIGNMENT"
              ? /inputs changed/
              : /today or future dated|approved payroll close/,
          );
        if (first === "ASSIGNMENT") {
          const recalculated = await calculateStoredPayrollClose("2026-10", 1);
          assert.equal(f.statement(recalculated).result.commissionTotal, "17.98");
          await approveStoredPayrollClose("2026-10", recalculated.revision, reason);
        } else {
          assert.equal(
            (await readStoredPayrollStatement("2026-10", f.staffId)).result.commissionTotal,
            "8.99",
          );
          assert.equal(
            await prisma.payrollConfigurationEvent.count({ where: { kind: "ASSIGNMENT" } }),
            1,
          );
        }
        const stored = await prisma.payrollClose.findFirstOrThrow({
          where: { periodKey: "2026-09" },
        });
        assert.equal(payrollInputHash(stored.state), priorHash);
      });
    },
  );

async function waitForBlockedCount(count: number) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const [row] = await prisma.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM pg_stat_activity
    WHERE cardinality(pg_blocking_pids(pid)) > 0 AND datname = current_database()`;
    if (row.count >= count) return;
    await setTimeout(10);
  }
  assert.fail("Both competing writers must be blocked");
}
