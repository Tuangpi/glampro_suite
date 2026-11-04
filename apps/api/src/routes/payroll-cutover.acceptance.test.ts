/**
 * CP-007 acceptance — prospective payroll cutover over real Postgres, real HTTP.
 *
 * The suites below prove the three promises the module makes:
 *
 * 1. **The dry run classifies and writes nothing.** Repeated inventories over an
 *    unchanged ledger hash identically, and the hash covers the whole window.
 * 2. **The switch is attested and prospective.** Activation refuses a stale hash, a
 *    stale revision, a month before the current one, and any outstanding double pay —
 *    then stops the legacy writer from the activation month onwards, without touching
 *    a single historic earning row.
 * 3. **Rollback resumes legacy accrual** from the current month, and the audit history
 *    is append-only and never alternates illegally.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { mock, test } from "node:test";
import type { PayrollCutoverInventory, PayrollCutoverState } from "@glampro_suite/shared";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { signAccessToken } from "../lib/tokens.js";
import { runAsPlatform, runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { payrollInputHash, type PayrollCloseState } from "../services/payroll-close-state.js";
import { salonPeriodKey } from "../services/payroll-progress.js";
import { payrollCutoverWindow, previousPeriodKey } from "../services/payroll-cutover-inventory.js";
import { createSale } from "../services/sale.service.js";

/** A half-hour offset zone, so a UTC sale can never be dated by accident. */
const TIME_ZONE = "Asia/Yangon";
/** Legacy per-staff service rate: SGD 100 of service earns SGD 10.00, exactly. */
const LEGACY_RATE = "10";
const LINE_PRICE = 100;

interface CutoverFixture {
  tenantId: string;
  ownerId: string;
  managerId: string;
  staffId: string;
  timeZone: string;
  scope: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Rung up at one instant with `Date` mocked, so the legacy row lands in a known month. */
  sell: (at: string) => Promise<string>;
}

async function cutoverFixture(): Promise<CutoverFixture> {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55485");
  assert.equal(url.pathname, "/payroll_close_test");
  const [identity] = await prisma.$queryRaw<{ directory: string; timezone: string }[]>`
    SELECT current_setting('data_directory') AS directory, current_setting('TimeZone') AS timezone`;
  assert.match(identity.directory, /^\/tmp\/cp005-/);
  assert.equal(identity.timezone, "UTC");

  const tenantId = `cp007-${randomUUID()}`;
  const ownerId = randomUUID();
  const managerId = randomUUID();
  const staffId = randomUUID();
  await runAsPlatform(() =>
    prisma.tenant.create({
      data: { id: tenantId, slug: tenantId, name: "Cutover acceptance", timeZone: TIME_ZONE },
    }),
  );
  const scope = <T>(fn: () => Promise<T>) => runAsTenant(tenantId, fn, ownerId);

  const { outletId, serviceId } = await scope(async () => {
    for (const [code, name] of [
      ["staff", "Staff"],
      ["sales", "Sales"],
      ["catalogue", "Catalogue"],
    ] as const) {
      const module = await prisma.module.upsert({
        where: { code },
        update: {},
        create: { code, name, category: "Core", isCore: true },
      });
      await prisma.tenantModule.create({ data: { tenantId, moduleId: module.id } });
    }
    const outlet = await prisma.outlet.create({
      data: { tenantId, name: "Cutover branch", slug: "branch" },
    });
    for (const [id, globalRole] of [
      [ownerId, "SUPER_ADMIN"],
      [managerId, "MANAGER"],
      [staffId, "STAFF"],
    ] as const)
      await prisma.user.create({
        data: {
          id,
          tenantId,
          name: `${globalRole} ${id.slice(0, 8)}`,
          email: `${id}@example.test`,
          passwordHash: "synthetic-unused",
          globalRole,
          // Cutover needs a verified owner and a documented second factor.
          twoFactorEnabled: globalRole === "SUPER_ADMIN",
          commissionRate: LEGACY_RATE,
        },
      });
    const service = await prisma.service.create({
      data: {
        tenantId,
        name: "Cutover service",
        memberPrice: String(LINE_PRICE),
        nonmemberPrice: String(LINE_PRICE),
      },
    });
    return { outletId: outlet.id, serviceId: service.id };
  });

  const sell = async (at: string): Promise<string> => {
    mock.timers.reset();
    mock.timers.enable({ apis: ["Date"], now: new Date(at) });
    try {
      const sale = await scope(() =>
        runAtOutlet(outletId, () =>
          createSale({
            lines: [
              {
                itemType: "SERVICE",
                itemId: serviceId,
                quantity: 1,
                // Line-level attribution is what legacy accrual reads: one earning per line.
                staffId,
              },
            ],
            payments: [{ method: "CASH", amount: LINE_PRICE }],
          }),
        ),
      );
      return sale.id;
    } finally {
      mock.timers.reset();
    }
  };

  return { tenantId, ownerId, managerId, staffId, timeZone: TIME_ZONE, scope, sell };
}

test(
  "CP-007 cutover stops legacy accrual at the attested month and rollback resumes it",
  { skip: process.env.RUN_CP005_ACCEPTANCE !== "true", timeout: 180000 },
  async (t) => {
    const f = await cutoverFixture();
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/payroll-cutover`;
    const token = (id: string, globalRole: "SUPER_ADMIN" | "MANAGER" | "STAFF") =>
      signAccessToken({
        id,
        email: `${id}@example.test`,
        globalRole,
        tenantId: f.tenantId,
        realm: "web",
        tokenVersion: 0,
      }).token;
    const owner = token(f.ownerId, "SUPER_ADMIN");
    const manager = token(f.managerId, "MANAGER");
    const staff = token(f.staffId, "STAFF");
    const call = async (
      path: string,
      options: { body?: unknown; bearer?: string; method?: "GET" | "POST" } = {},
    ) => {
      const response = await fetch(root + path, {
        method: options.method ?? (options.body === undefined ? "GET" : "POST"),
        headers: {
          Authorization: `Bearer ${options.bearer ?? owner}`,
          "Content-Type": "application/json",
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };
    const ok = async <T>(path: string, options: Parameters<typeof call>[1] = {}): Promise<T> => {
      const { status, body } = await call(path, options);
      assert.equal(status, 200, JSON.stringify(body));
      return (body as { data: T }).data;
    };
    const refused = async (path: string, options: Parameters<typeof call>[1] = {}) => {
      const { status, body } = await call(path, options);
      assert.ok(status >= 400, `${path} unexpectedly succeeded: ${JSON.stringify(body)}`);
      return { status, code: body.code, details: body.details };
    };

    // Real time, salon-local months: the window ends with the month this test runs in.
    const currentPeriodKey = salonPeriodKey(f.timeZone, new Date());
    const previousKey = previousPeriodKey(currentPeriodKey);

    try {
      // One legacy earning in the month before activation, one inside the activation month.
      const historicSale = await f.sell(`${previousKey}-15T03:00:00Z`);
      const coveredSale = await f.sell(`${currentPeriodKey}-01T03:00:00Z`);
      assert.equal(await f.scope(() => prisma.employeeCommission.count()), 2);

      // ── 1. Nothing has been activated, and management may read that ────────────
      const untouched = await ok<PayrollCutoverState>("", { bearer: manager });
      assert.equal(untouched.status, "NOT_ACTIVATED");
      assert.equal(untouched.revision, 0);
      assert.equal(untouched.effectivePeriodKey, null);
      assert.equal(untouched.inventoryHash, null);
      assert.deepEqual(untouched.history, []);

      // A cutover is an owner decision: staff cannot read it, managers cannot write it.
      assert.equal((await refused("", { bearer: staff })).status, 403);
      const managerAttempt = await refused("/activate", {
        bearer: manager,
        body: {
          expectedRevision: 0,
          effectivePeriodKey: currentPeriodKey,
          inventoryMonths: 6,
          inventoryHash: "0".repeat(64),
          reason: "Manager attempt",
        },
      });
      assert.equal(managerAttempt.status, 403);

      // ── 2. The dry run classifies the window and writes nothing ────────────────
      const dryRun = `?months=6&effectivePeriodKey=${currentPeriodKey}`;
      const inventory = await ok<PayrollCutoverInventory>(`/inventory${dryRun}`, {
        bearer: manager,
      });
      assert.equal(inventory.timeZone, TIME_ZONE);
      assert.equal(inventory.currentPeriodKey, currentPeriodKey);
      assert.equal(inventory.toPeriodKey, currentPeriodKey);
      assert.equal(inventory.fromPeriodKey, payrollCutoverWindow(currentPeriodKey, 6)[0]);
      assert.equal(inventory.effectivePeriodKey, currentPeriodKey);
      assert.equal(inventory.proposed, true);
      assert.match(inventory.inventoryHash, /^[0-9a-f]{64}$/);
      assert.equal(inventory.months.length, 6);
      assert.equal(inventory.totals.months, 6);
      assert.equal(inventory.totals.coveredMonths, 1);
      assert.deepEqual(inventory.totals.legacy, {
        total: { rows: 2, amount: "20.00" },
        paid: { rows: 0, amount: "0.00" },
        unpaid: { rows: 2, amount: "20.00" },
        clawback: { rows: 0, amount: "0.00" },
        unidentified: { rows: 0, amount: "0.00" },
      });
      // Only the covered month carries a warning: legacy money the plan re-derives.
      assert.deepEqual(inventory.issues, [
        {
          code: "LEGACY_EARNING_SUPERSEDED",
          severity: "WARNING",
          periodKey: currentPeriodKey,
          staffId: f.staffId,
          rows: 1,
          amount: "10.00",
        },
      ]);
      const monthOf = (key: string) => inventory.months.find((month) => month.periodKey === key)!;
      assert.equal(monthOf(previousKey).covered, false);
      assert.deepEqual(monthOf(previousKey).legacy.total, { rows: 1, amount: "10.00" });
      assert.equal(monthOf(currentPeriodKey).covered, true);
      assert.deepEqual(monthOf(currentPeriodKey).legacy.unpaid, { rows: 1, amount: "10.00" });
      assert.deepEqual(monthOf(currentPeriodKey).payroll, { status: null, payoutConfirmed: false });
      assert.equal(monthOf(currentPeriodKey).verdict, "RELIABLE");
      // Read-only: re-reviewing unchanged evidence must reproduce the attestation.
      const again = await ok<PayrollCutoverInventory>(`/inventory${dryRun}`);
      assert.equal(again.inventoryHash, inventory.inventoryHash);
      assert.equal(await f.scope(() => prisma.payrollCutover.count()), 0);
      assert.equal(await f.scope(() => prisma.payrollCutoverEvent.count()), 0);

      // ── 3. Activation refuses everything it cannot prove ──────────────────────
      const activation = {
        expectedRevision: 0,
        effectivePeriodKey: currentPeriodKey,
        inventoryMonths: 6,
        inventoryHash: inventory.inventoryHash,
        reason: "Reviewed legacy inventory with the owner",
      };
      const stale = await refused("/activate", {
        body: { ...activation, inventoryHash: "f".repeat(64) },
      });
      assert.equal(stale.status, 409);
      assert.equal(stale.code, "PAYROLL_CUTOVER_INVENTORY_STALE");
      // The refusal hands back the hash it computed, so the owner can re-review.
      assert.deepEqual(stale.details, { inventoryHash: inventory.inventoryHash });
      const staleRevision = await refused("/activate", {
        body: { ...activation, expectedRevision: 7 },
      });
      assert.equal(staleRevision.status, 409);
      assert.equal(staleRevision.code, "PAYROLL_CUTOVER_STALE");
      const badWindow = await refused("/activate", {
        body: { ...activation, inventoryMonths: 0 },
      });
      assert.equal(badWindow.status, 422);
      assert.equal(badWindow.code, "VALIDATION_FAILED");
      assert.equal(await f.scope(() => prisma.payrollCutover.count()), 0);

      // ── 4. The owner activates the month the evidence was reviewed for ─────────
      const activated = await ok<PayrollCutoverState>("/activate", { body: activation });
      assert.equal(activated.status, "ACTIVE");
      assert.equal(activated.revision, 1);
      assert.equal(activated.effectivePeriodKey, currentPeriodKey);
      assert.equal(activated.inventoryHash, inventory.inventoryHash);
      assert.equal(activated.activatedBy, f.ownerId);
      assert.equal(activated.rolledBackAt, null);
      assert.equal(activated.history.length, 1);
      assert.equal(activated.history[0]!.action, "ACTIVATE");
      assert.equal(activated.history[0]!.previousHash, null);
      assert.equal(activated.history[0]!.actorId, f.ownerId);
      assert.match(activated.history[0]!.stateHash, /^[0-9a-f]{64}$/);
      assert.equal(activated.history[0]!.inventoryHash, inventory.inventoryHash);

      const storedRow = await f.scope(() => prisma.payrollCutover.findFirst({ where: {} }));
      assert.equal(storedRow?.status, "ACTIVE");
      assert.equal(storedRow?.revision, 1);
      assert.equal(storedRow?.effectivePeriodKey, currentPeriodKey);
      assert.equal(await f.scope(() => prisma.payrollCutoverEvent.count()), 1);

      // Activating twice is a refusal, not a silent second switch.
      const alreadyActive = await refused("/activate", {
        body: { ...activation, expectedRevision: 1 },
      });
      assert.equal(alreadyActive.status, 409);
      assert.equal(alreadyActive.code, "PAYROLL_CUTOVER_ACTIVE");

      // ── 5. From the activation month the legacy writer stops ─────────────────
      const afterSwitch = await f.sell(`${currentPeriodKey}-02T03:00:00Z`);
      assert.equal(
        await f.scope(() => prisma.employeeCommission.count({ where: { saleId: afterSwitch } })),
        0,
      );
      // Plan payroll still gets its own inputs: the line snapshot is written either way.
      const snapshot = await f.scope(() =>
        prisma.saleLine.findFirst({
          where: { saleId: afterSwitch },
          select: { commissionSnapshot: true, staffId: true },
        }),
      );
      assert.equal(snapshot?.staffId, f.staffId);
      assert.equal((snapshot?.commissionSnapshot as { amount?: string } | null)?.amount, "10.00");
      // The switch never rewrites a historic earning row.
      assert.equal(
        await f.scope(() =>
          prisma.employeeCommission.count({
            where: { saleId: { in: [historicSale, coveredSale] } },
          }),
        ),
        2,
      );

      // ── 6. Rollback resumes legacy accrual from the current month ────────────
      const rolledBack = await ok<PayrollCutoverState>("/rollback", {
        body: { expectedRevision: 1, reason: "Owner resumed the legacy ledger" },
      });
      assert.equal(rolledBack.status, "ROLLED_BACK");
      assert.equal(rolledBack.revision, 2);
      assert.equal(rolledBack.rolledBackBy, f.ownerId);
      assert.equal(rolledBack.rolledBackReason, "Owner resumed the legacy ledger");
      assert.equal(rolledBack.history.length, 2);
      assert.equal(rolledBack.history[1]!.action, "ROLLBACK");
      // The chain verifies: each event points at its predecessor's hash.
      assert.equal(rolledBack.history[1]!.previousHash, rolledBack.history[0]!.stateHash);
      assert.notEqual(rolledBack.history[1]!.stateHash, rolledBack.history[0]!.stateHash);

      const afterRollback = await f.sell(`${currentPeriodKey}-03T03:00:00Z`);
      assert.equal(
        await f.scope(() => prisma.employeeCommission.count({ where: { saleId: afterRollback } })),
        1,
      );
      const rollbackOnly = await refused("/rollback", {
        body: { expectedRevision: 2, reason: "Rollback twice" },
      });
      assert.equal(rollbackOnly.status, 409);
      assert.equal(rollbackOnly.code, "PAYROLL_CUTOVER_NOT_ACTIVE");

      // ── 7. The switch can be re-armed, and the new evidence is re-attested ───
      const rearmed = await ok<PayrollCutoverInventory>(`/inventory${dryRun}`);
      assert.notEqual(rearmed.inventoryHash, inventory.inventoryHash);
      assert.deepEqual(rearmed.issues, [
        {
          code: "LEGACY_EARNING_SUPERSEDED",
          severity: "WARNING",
          periodKey: currentPeriodKey,
          staffId: f.staffId,
          rows: 2,
          amount: "20.00",
        },
      ]);
      const reactivated = await ok<PayrollCutoverState>("/activate", {
        body: {
          expectedRevision: 2,
          effectivePeriodKey: currentPeriodKey,
          inventoryMonths: 6,
          inventoryHash: rearmed.inventoryHash,
          reason: "Second reviewed activation",
        },
      });
      assert.equal(reactivated.status, "ACTIVE");
      assert.equal(reactivated.revision, 3);
      assert.deepEqual(
        reactivated.history.map((entry) => [entry.revision, entry.action]),
        [
          [1, "ACTIVATE"],
          [2, "ROLLBACK"],
          [3, "ACTIVATE"],
        ],
      );
      assert.equal(reactivated.history[2]!.previousHash, reactivated.history[1]!.stateHash);
      assert.equal(await f.scope(() => prisma.payrollCutoverEvent.count()), 3);

      t.diagnostic(
        `${f.timeZone}: activation month ${currentPeriodKey}; 2 legacy rows reviewed, 0 written while active, 1 written after rollback, 3 verified history events`,
      );
    } finally {
      mock.timers.reset();
      server.close();
      await once(server, "close");
    }
  },
);

test(
  "CP-007 activation refuses a legacy earning plan payroll would pay twice",
  { skip: process.env.RUN_CP005_ACCEPTANCE !== "true", timeout: 120000 },
  async () => {
    const f = await cutoverFixture();
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/payroll-cutover`;
    const bearer = signAccessToken({
      id: f.ownerId,
      email: `${f.ownerId}@example.test`,
      globalRole: "SUPER_ADMIN",
      tenantId: f.tenantId,
      realm: "web",
      tokenVersion: 0,
    }).token;
    const currentPeriodKey = salonPeriodKey(f.timeZone, new Date());
    const post = async (body: unknown) => {
      const response = await fetch(`${root}/activate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };
    const inventoryOf = async (): Promise<PayrollCutoverInventory> => {
      const response = await fetch(
        `${root}/inventory?months=3&effectivePeriodKey=${currentPeriodKey}`,
        {
          headers: { Authorization: `Bearer ${bearer}` },
        },
      );
      assert.equal(response.status, 200);
      return ((await response.json()) as { data: PayrollCutoverInventory }).data;
    };

    try {
      const saleId = await f.sell(`${currentPeriodKey}-01T03:00:00Z`);
      // Legacy already paid a traceable earning the plan would pay a second time.
      await f.scope(() =>
        prisma.employeeCommission.updateMany({ where: { saleId }, data: { paidAt: new Date() } }),
      );
      const blocked = await inventoryOf();
      assert.deepEqual(blocked.issues, [
        {
          code: "LEGACY_PAYOUT_INSIDE_COVERED_MONTH",
          severity: "BLOCKER",
          periodKey: currentPeriodKey,
          staffId: f.staffId,
          rows: 1,
          amount: "10.00",
        },
      ]);
      assert.equal(blocked.months[blocked.months.length - 1]!.verdict, "ALREADY_PAID");

      const refusal = await post({
        expectedRevision: 0,
        effectivePeriodKey: currentPeriodKey,
        inventoryMonths: 3,
        inventoryHash: blocked.inventoryHash,
        reason: "Activate over legacy double pay",
      });
      assert.equal(refusal.status, 409);
      assert.equal(refusal.body.code, "PAYROLL_CUTOVER_BLOCKED");
      // The blockers themselves are the refusal: each one names the money at risk.
      assert.deepEqual(refusal.body.details, blocked.issues);
      assert.equal(await f.scope(() => prisma.payrollCutover.count()), 0);

      // Settling the duplicate clears the blocker, and the attestation moves with it.
      await f.scope(() =>
        prisma.employeeCommission.updateMany({ where: { saleId }, data: { paidAt: null } }),
      );
      const cleared = await inventoryOf();
      assert.notEqual(cleared.inventoryHash, blocked.inventoryHash);
      assert.deepEqual(
        cleared.issues.map((issue) => issue.severity),
        ["WARNING"],
      );

      const stale = await post({
        expectedRevision: 0,
        effectivePeriodKey: currentPeriodKey,
        inventoryMonths: 3,
        inventoryHash: blocked.inventoryHash,
        reason: "Activate with the pre-settlement inventory",
      });
      assert.equal(stale.status, 409);
      assert.equal(stale.body.code, "PAYROLL_CUTOVER_INVENTORY_STALE");

      const activated = await post({
        expectedRevision: 0,
        effectivePeriodKey: currentPeriodKey,
        inventoryMonths: 3,
        inventoryHash: cleared.inventoryHash,
        reason: "Activate after settling the duplicate",
      });
      assert.equal(activated.status, 200, JSON.stringify(activated.body));
      assert.equal((activated.body as { data: PayrollCutoverState }).data.status, "ACTIVE");
      assert.equal((activated.body as { data: PayrollCutoverState }).data.revision, 1);
    } finally {
      mock.timers.reset();
      server.close();
      await once(server, "close");
    }
  },
);

test(
  "CP-007 cutover history is append-only and cannot skip a revision",
  { skip: process.env.RUN_CP005_ACCEPTANCE !== "true", timeout: 120000 },
  async () => {
    const f = await cutoverFixture();
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/payroll-cutover`;
    const bearer = signAccessToken({
      id: f.ownerId,
      email: `${f.ownerId}@example.test`,
      globalRole: "SUPER_ADMIN",
      tenantId: f.tenantId,
      realm: "web",
      tokenVersion: 0,
    }).token;
    const currentPeriodKey = salonPeriodKey(f.timeZone, new Date());
    /** Postgres raises, Prisma wraps: the trigger's own words are what we assert on. */
    const refuses = async (
      label: string,
      run: () => Promise<unknown>,
      expected: RegExp,
    ): Promise<void> => {
      await assert.rejects(
        run,
        (error: unknown) => {
          const meta = (error as { meta?: unknown }).meta;
          const text = `${(error as Error).message} ${JSON.stringify(meta ?? {})}`;
          assert.match(text, expected, label);
          return true;
        },
        label,
      );
    };

    try {
      // Written out of band, exactly as a hand-run migration or a console session would.
      const state = {
        status: "ACTIVE",
        revision: 1,
        effectivePeriodKey: currentPeriodKey,
        inventoryHash: "b".repeat(64),
      };
      await f.scope(() =>
        prisma.payrollCutover.create({
          data: {
            tenantId: f.tenantId,
            revision: 1,
            status: "ACTIVE",
            effectivePeriodKey: currentPeriodKey,
            state,
          },
        }),
      );
      await f.scope(() =>
        prisma.payrollCutoverEvent.create({
          data: {
            tenantId: f.tenantId,
            revision: 1,
            action: "ACTIVATE",
            actorId: f.ownerId,
            reason: "Written out of band",
            previousHash: null,
            stateHash: "a".repeat(64),
            state,
          },
        }),
      );

      // The read path verifies every event against its own state, so a forged row is
      // reported as broken history rather than presented as a valid cutover.
      const forged = await fetch(root, { headers: { Authorization: `Bearer ${bearer}` } });
      assert.equal(forged.status, 409);
      assert.equal(
        ((await forged.json()) as { code?: string }).code,
        "PAYROLL_CUTOVER_HISTORY_INVALID",
      );

      // ── The audit trail cannot be edited, deleted or re-pointed ───────────────
      await refuses(
        "event update",
        () =>
          f.scope(() =>
            prisma.payrollCutoverEvent.updateMany({
              where: { tenantId: f.tenantId },
              data: { reason: "Rewritten after the fact" },
            }),
          ),
        /append-only/,
      );
      await refuses(
        "event delete",
        () =>
          f.scope(() => prisma.payrollCutoverEvent.deleteMany({ where: { tenantId: f.tenantId } })),
        /append-only/,
      );
      await refuses(
        "evidence rewrite",
        () =>
          f.scope(() =>
            prisma.payrollCutoverEvent.updateMany({
              where: { tenantId: f.tenantId },
              data: { stateHash: "c".repeat(64) },
            }),
          ),
        /append-only/,
      );

      // ── The activation row keeps its identity and moves one revision at a time ─
      await refuses(
        "revision jump",
        () =>
          f.scope(() =>
            prisma.payrollCutover.update({
              where: { tenantId: f.tenantId },
              data: {
                revision: 3,
                status: "ROLLED_BACK",
                state: { ...state, revision: 3, status: "ROLLED_BACK" },
              },
            }),
          ),
        /identity\/revision is immutable/,
      );
      await refuses(
        "status held",
        () =>
          f.scope(() =>
            prisma.payrollCutover.update({
              where: { tenantId: f.tenantId },
              data: { revision: 2, status: "ACTIVE", state: { ...state, revision: 2 } },
            }),
          ),
        /status must alternate/,
      );
      await refuses(
        "cutover delete",
        () => f.scope(() => prisma.payrollCutover.deleteMany({ where: { tenantId: f.tenantId } })),
        /append-only/,
      );

      // The one transition the salon is allowed to make succeeds.
      const rolledBackState = { ...state, revision: 2, status: "ROLLED_BACK" };
      await f.scope(() =>
        prisma.payrollCutover.update({
          where: { tenantId: f.tenantId },
          data: { revision: 2, status: "ROLLED_BACK", state: rolledBackState },
        }),
      );
      const stored = await f.scope(() => prisma.payrollCutover.findFirst({ where: {} }));
      assert.equal(stored?.revision, 2);
      assert.equal(stored?.status, "ROLLED_BACK");
      assert.equal(stored?.effectivePeriodKey, currentPeriodKey);
    } finally {
      mock.timers.reset();
      server.close();
      await once(server, "close");
    }
  },
);

test(
  "CP-007 rollback is refused while plan payroll is approved for an unsettled month",
  { skip: process.env.RUN_CP005_ACCEPTANCE !== "true", timeout: 120000 },
  async () => {
    const f = await cutoverFixture();
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/payroll-cutover`;
    const bearer = signAccessToken({
      id: f.ownerId,
      email: `${f.ownerId}@example.test`,
      globalRole: "SUPER_ADMIN",
      tenantId: f.tenantId,
      realm: "web",
      tokenVersion: 0,
    }).token;
    const currentPeriodKey = salonPeriodKey(f.timeZone, new Date());
    const call = async (path: string, body?: unknown) => {
      const response = await fetch(`${root}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown> & {
          data?: PayrollCutoverState & PayrollCutoverInventory;
        },
      };
    };

    try {
      const inventory = (await call(`/inventory?months=3&effectivePeriodKey=${currentPeriodKey}`))
        .body.data!;
      const activated = await call("/activate", {
        expectedRevision: 0,
        effectivePeriodKey: currentPeriodKey,
        inventoryMonths: 3,
        inventoryHash: inventory.inventoryHash,
        reason: "Owner switched plan payroll on",
      });
      assert.equal(activated.status, 200, JSON.stringify(activated.body));

      // Plan payroll is approved for the current month and has not been paid out yet.
      const approvedState: PayrollCloseState = {
        periodKey: currentPeriodKey,
        status: "APPROVED",
        revision: 1,
        adjustments: [],
        calculation: null,
        approval: {
          at: new Date().toISOString(),
          actorId: f.ownerId,
          reason: "cp007 rollback guard fixture",
        },
        payout: null,
      };
      const approveHash = payrollInputHash(approvedState);
      await f.scope(() =>
        prisma.$transaction(async (tx) => {
          await tx.payrollClose.create({
            data: {
              tenantId: f.tenantId,
              periodKey: currentPeriodKey,
              revision: 1,
              status: "APPROVED",
              state: JSON.parse(JSON.stringify(approvedState)),
            },
          });
          await tx.payrollCloseEvent.create({
            data: {
              tenantId: f.tenantId,
              periodKey: currentPeriodKey,
              revision: 1,
              action: "APPROVE",
              actorId: f.ownerId,
              reason: "cp007 rollback guard fixture",
              previousHash: null,
              stateHash: approveHash,
              state: JSON.parse(JSON.stringify(approvedState)),
            },
          });
        }),
      );

      const refused = await call("/rollback", {
        expectedRevision: 1,
        reason: "Owner tried to drop back to the legacy ledger",
      });
      assert.equal(refused.status, 409);
      assert.equal(refused.body.code, "PAYROLL_CUTOVER_ROLLBACK_BLOCKED");
      assert.deepEqual(refused.body.details, { periodKeys: [currentPeriodKey] });

      // The refusal is not a partial write: the salon is still on plan payroll.
      const after = await call("");
      assert.equal(after.status, 200);
      assert.equal(after.body.data!.status, "ACTIVE");
      assert.equal(after.body.data!.revision, 1);
      assert.equal(after.body.data!.history.length, 1);
      assert.equal(
        await f.scope(() => prisma.payrollCutoverEvent.count({ where: { tenantId: f.tenantId } })),
        1,
      );

      // Confirming the payout settles the month: the frozen snapshot can never pay those
      // sales again, so the same rollback now succeeds and resumes legacy accrual.
      const settledState: PayrollCloseState = {
        ...approvedState,
        revision: 2,
        payout: {
          at: new Date().toISOString(),
          actorId: f.ownerId,
          reference: "PAYOUT-0001",
          reason: "Month settled",
        },
      };
      const settledHash = payrollInputHash(settledState);
      await f.scope(() =>
        prisma.$transaction(async (tx) => {
          await tx.payrollClose.update({
            where: { tenantId_periodKey: { tenantId: f.tenantId, periodKey: currentPeriodKey } },
            data: { revision: 2, state: JSON.parse(JSON.stringify(settledState)) },
          });
          await tx.payrollCloseEvent.create({
            data: {
              tenantId: f.tenantId,
              periodKey: currentPeriodKey,
              revision: 2,
              action: "PAYOUT",
              actorId: f.ownerId,
              reason: "Month settled",
              previousHash: approveHash,
              stateHash: settledHash,
              state: JSON.parse(JSON.stringify(settledState)),
            },
          });
        }),
      );

      const settled = await call("/rollback", {
        expectedRevision: 1,
        reason: "Owner resumed the legacy ledger after the month was paid",
      });
      assert.equal(settled.status, 200, JSON.stringify(settled.body));
      assert.equal(settled.body.data!.status, "ROLLED_BACK");
      assert.equal(settled.body.data!.revision, 2);
    } finally {
      mock.timers.reset();
      server.close();
      await once(server, "close");
    }
  },
);
