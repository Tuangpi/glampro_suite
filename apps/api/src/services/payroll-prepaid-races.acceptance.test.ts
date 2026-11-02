import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { PAYROLL_DEFAULT_SETTINGS } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { createSale, voidSale } from "./sale.service.js";
import {
  createPrepaidFamily,
  changePrepaidMembership,
  sharePrepaid,
} from "./prepaid-family.service.js";
import { authorizeStoredPayrollCarry } from "./payroll-close-authorizations.js";
import { loadAuthoritativePayrollCloseInputs } from "./payroll-close-loader.js";
import { openPayrollClose, payrollInputHash } from "./payroll-close-state.js";
import {
  calculateStoredPayrollClose,
  approveStoredPayrollClose,
  type PayrollCloseTransaction,
} from "./payroll-close-store.js";

const disabled = process.env.RUN_CP005_ACCEPTANCE !== "true";
const shares = (staffId: string) => [{ staffId, share: 10000 }];

async function fixture() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55485");
  assert.equal(url.pathname, "/payroll_close_test");
  const tenantId = `cp005-m118-${randomUUID()}`;
  const ownerId = randomUUID();
  await runAsPlatform(() =>
    prisma.tenant.create({
      data: {
        id: tenantId,
        slug: tenantId,
        name: "M1-18 synthetic races",
        status: "ACTIVE",
        gstEnabled: true,
      },
    }),
  );
  return runAsTenant(
    tenantId,
    async () => {
      await prisma.user.create({
        data: {
          id: ownerId,
          tenantId,
          name: "Race owner",
          passwordHash: "synthetic-unused",
          globalRole: "SUPER_ADMIN",
          twoFactorEnabled: true,
        },
      });
      for (const code of ["catalogue", "packages", "sales", "customers"]) {
        const module = await prisma.module.upsert({
          where: { code },
          update: {},
          create: { code, name: code, category: "Core", isCore: true },
        });
        await prisma.tenantModule.create({ data: { tenantId, moduleId: module.id } });
      }
      const outlet = await prisma.outlet.create({
        data: { tenantId, name: "Race outlet", slug: "races" },
      });
      const customer = await prisma.customer.create({ data: { tenantId, name: "Credit owner" } });
      const member = await prisma.customer.create({ data: { tenantId, name: "Family spender" } });
      const service = await prisma.service.create({
        data: { tenantId, name: "Race service", memberPrice: "90", nonmemberPrice: "90" },
      });
      const item = await prisma.valuePackage.create({
        data: { tenantId, name: "545 for 600", price: "545", credit: "600" },
      });
      const parts = new Intl.DateTimeFormat("en", {
        timeZone: "Asia/Singapore",
        year: "numeric",
        month: "2-digit",
      }).formatToParts(new Date());
      const periodKey = ["year", "month"]
        .map((key) => parts.find((part) => part.type === key)!.value)
        .join("-");
      const [year, month] = periodKey.split("-").map(Number);
      mock.timers.enable({
        apis: ["Date"],
        now: new Date(Date.UTC(year, month - 1, 1) - 86400000),
      });
      try {
        await authorizeStoredPayrollCarry(
          "OPENING",
          periodKey,
          0,
          {
            staff: [
              { staffId: ownerId, carryForward: [], fallbackCarryCommission: "0.0000000000" },
            ],
            evidence: { inventoryReference: "Synthetic race opening" },
          },
          "Reviewed synthetic race opening",
        );
      } finally {
        mock.timers.reset();
      }
      for (const [kind, targetId, payload] of [
        ["SETTINGS", "company", PAYROLL_DEFAULT_SETTINGS],
        [
          "STAFF",
          ownerId,
          { joinDate: "2020-01-01", stageEndOverride: null, commissionRole: "NON_COMMISSION" },
        ],
        [
          "PROFILE",
          ownerId,
          { basicSalary: "0", fixedOvertime: "0", levy: "0", salesAlertPct: "50" },
        ],
      ] as [string, string, object][]) {
        await prisma.payrollConfigurationEvent.create({
          data: {
            tenantId,
            kind,
            targetId,
            revision: 1,
            actorId: ownerId,
            reason: "Synthetic historical race configuration",
            createdAt: new Date("2026-01-01"),
            payload,
          },
        });
      }
      const purchase = await runAtOutlet(outlet.id, () =>
        createSale({
          customerId: customer.id,
          lines: [
            {
              itemType: "VALUE_PACKAGE",
              itemId: item.id,
              quantity: 1,
              attribution: { sellers: shares(ownerId) },
            },
          ],
          payments: [{ method: "CASH", amount: 545 }],
          collection: {
            currency: "SGD",
            allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "54500" }],
          },
        }),
      );
      const holding = await prisma.customerValuePackageHolding.findFirstOrThrow({
        where: { saleLine: { saleId: purchase.id } },
      });
      const family = await createPrepaidFamily(
        customer.id,
        { name: "Race family", confirmed: true, reason: "Share for race acceptance" },
        ownerId,
      );
      assert.ok(family);
      await changePrepaidMembership(
        member.id,
        {
          expectedFamilyId: null,
          familyId: family.id,
          confirmed: true,
          reason: "Join before race spending",
        },
        ownerId,
      );
      await sharePrepaid(
        customer.id,
        holding.id,
        {
          familyId: family.id,
          expectedUpdatedAt: holding.updatedAt.toISOString(),
          confirmed: true,
          reason: "Explicit race consent",
        },
        ownerId,
      );
      const spend = () =>
        runAtOutlet(outlet.id, () =>
          createSale({
            customerId: member.id,
            lines: [
              {
                itemType: "SERVICE",
                itemId: service.id,
                quantity: 1,
                attribution: { sellers: shares(ownerId), performers: shares(ownerId) },
              },
            ],
            payments: [{ method: "PREPAID_CREDIT", holdingId: `family:${family.id}`, amount: 90 }],
            collection: { currency: "SGD", allocations: [] },
          }),
        );
      const usage = await spend();
      const revoke = async () => {
        const current = await prisma.customerValuePackageHolding.findFirstOrThrow({
          where: { id: holding.id },
        });
        return sharePrepaid(
          customer.id,
          holding.id,
          {
            familyId: null,
            expectedUpdatedAt: current.updatedAt.toISOString(),
            confirmed: true,
            reason: "Revoke race consent",
          },
          ownerId,
        );
      };
      const leave = () =>
        changePrepaidMembership(
          member.id,
          {
            expectedFamilyId: family.id,
            familyId: null,
            confirmed: true,
            reason: "Member leaves during race",
          },
          ownerId,
        );
      const restore = () =>
        voidSale(
          usage.id,
          { reason: "Restore race usage", cashDisposition: "NO_MOVEMENT" },
          ownerId,
        );
      const cancel = (returned = false) =>
        voidSale(
          purchase.id,
          {
            reason: "Void race purchase",
            cashDisposition: returned ? "RETURNED" : "NO_MOVEMENT",
            ...(returned && {
              returnedCash: {
                reference: "Witnessed race return",
                payouts: [{ method: "CASH" as const, amount: 545 }],
              },
            }),
          },
          ownerId,
        );
      const load = () =>
        prisma.$transaction((tx) =>
          loadAuthoritativePayrollCloseInputs(tx, openPayrollClose(periodKey)),
        );
      return {
        tenantId,
        ownerId,
        holdingId: holding.id,
        purchaseId: purchase.id,
        usageId: usage.id,
        memberId: member.id,
        familyId: family.id,
        customerId: customer.id,
        periodKey,
        spend,
        revoke,
        leave,
        restore,
        cancel,
        load,
      };
    },
    ownerId,
  );
}

// Pause the first writer after it really owns the production advisory lock.
// The contender uses an unwrapped transaction and must visibly block in PostgreSQL.
function holdFirstTransaction() {
  let enter!: (pid: number) => void;
  let release!: () => void;
  const entered = new Promise<number>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = prisma.$transaction;
  const restore = () => {
    prisma.$transaction = original;
  };
  const wrapper = <T>(
    work: (tx: PayrollCloseTransaction) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
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
  return { entered, release, restore };
}

async function ordered(first: () => Promise<unknown>, second: () => Promise<unknown>) {
  const gate = holdFirstTransaction();
  const winner = Promise.allSettled([first()]);
  let contender: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    const pid = await Promise.race([
      gate.entered,
      winner.then(() => assert.fail("First writer never reached its lock barrier")),
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
    assert.ok(blocked, "Contender must reach the real PostgreSQL lock");
    gate.release();
    return [(await winner)[0], (await contender)[0]] as const;
  } finally {
    gate.restore();
    gate.release();
    await winner;
    await contender;
  }
}

function fulfilled(result: PromiseSettledResult<unknown>) {
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

for (const action of ["calculate", "approve"] as const)
  for (const first of ["invalid-void", "close"] as const)
    test(
      `CP-005-M1-18 invalid payout versus ${action}, ${first} first rolls back`,
      { skip: disabled, timeout: 20000 },
      () =>
        withFixture(async (f) => {
          await f.restore();
          const inputs = await f.load();
          const draft = await calculateStoredPayrollClose(f.periodKey, 0);
          const purchase = await prisma.sale.findFirstOrThrow({ where: { id: f.purchaseId } });
          const holding = await prisma.customerValuePackageHolding.findFirstOrThrow({
            where: { id: f.holdingId },
          });
          const balanceCount = await prisma.prepaidBalanceEvent.count();
          const auditCount = await prisma.auditLog.count({ where: { tenantId: f.tenantId } });
          mock.timers.enable({ apis: ["Date"], now: new Date(inputs.endsAt) });
          const invalid = () =>
            voidSale(
              f.purchaseId,
              {
                reason: "Refuse incorrect concurrent return",
                cashDisposition: "RETURNED",
                returnedCash: {
                  reference: "Wrong return must roll back",
                  payouts: [{ method: "CASH", amount: 544 }],
                },
              },
              f.ownerId,
            );
          const close = () =>
            action === "calculate"
              ? calculateStoredPayrollClose(f.periodKey, draft.revision)
              : approveStoredPayrollClose(
                  f.periodKey,
                  draft.revision,
                  "Approve despite refused payout",
                );
          const results = await ordered(
            first === "invalid-void" ? invalid : close,
            first === "invalid-void" ? close : invalid,
          );
          const refused = results[first === "invalid-void" ? 0 : 1];
          assert.equal(refused.status, "rejected");
          if (refused.status === "rejected")
            assert.match(String(refused.reason), /return|amount|collected|payout/i);
          fulfilled(results[first === "close" ? 0 : 1]);
          assert.deepEqual(
            await prisma.sale.findFirstOrThrow({ where: { id: f.purchaseId } }),
            purchase,
          );
          assert.deepEqual(
            await prisma.customerValuePackageHolding.findFirstOrThrow({
              where: { id: f.holdingId },
            }),
            holding,
          );
          assert.equal(await prisma.prepaidBalanceEvent.count(), balanceCount);
          assert.equal(
            await prisma.auditLog.count({ where: { tenantId: f.tenantId } }),
            auditCount,
          );
          assert.equal(payrollInputHash(await f.load()), payrollInputHash(inputs));
          const state = await prisma.payrollClose.findFirstOrThrow();
          assert.equal(state.status, action === "approve" ? "APPROVED" : "CALCULATED");
          assert.equal(await prisma.payrollCloseEvent.count(), 2);
        }),
    );

for (const action of ["calculate", "approve"] as const)
  test(
    `CP-005-M1-18 competing ${action} requests commit one revision`,
    { skip: disabled, timeout: 20000 },
    () =>
      withFixture(async (f) => {
        const inputs = await f.load();
        const draft = await calculateStoredPayrollClose(f.periodKey, 0);
        mock.timers.enable({ apis: ["Date"], now: new Date(inputs.endsAt) });
        const close = () =>
          action === "calculate"
            ? calculateStoredPayrollClose(f.periodKey, draft.revision)
            : approveStoredPayrollClose(
                f.periodKey,
                draft.revision,
                "Competing same-revision approval",
              );
        const results = await ordered(close, close);
        const winner = fulfilled(results[0]);
        assert.equal(results[1].status, "rejected");
        if (results[1].status === "rejected")
          assert.match(String(results[1].reason), /changed|reload/i);
        const state = await prisma.payrollClose.findFirstOrThrow();
        assert.equal(state.revision, draft.revision + 1);
        assert.equal(payrollInputHash(state.state), payrollInputHash(winner));
        assert.equal(await prisma.payrollCloseEvent.count(), 2);
      }),
  );

async function withFixture(work: (value: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  try {
    const value = await fixture();
    await runAsTenant(value.tenantId, () => work(value), value.ownerId);
  } finally {
    mock.timers.reset();
  }
}

for (const source of ["membership", "consent", "usage-void", "purchase-void"] as const)
  for (const action of ["calculate", "approve"] as const)
    for (const first of ["source", "close"] as const)
      test(
        `CP-005-M1-18 ${source} versus ${action}, ${first} first`,
        { skip: disabled, timeout: 20000 },
        () =>
          withFixture(async (f) => {
            if (source === "purchase-void") await f.restore();
            const original = await f.load();
            const draft = await calculateStoredPayrollClose(f.periodKey, 0);
            const beforeHash = payrollInputHash(
              (await prisma.payrollClose.findFirstOrThrow()).state,
            );
            const beforeEvents = await prisma.payrollCloseEvent.count();
            mock.timers.enable({ apis: ["Date"], now: new Date(original.endsAt) });
            const mutate =
              source === "membership"
                ? f.leave
                : source === "consent"
                  ? f.revoke
                  : source === "usage-void"
                    ? f.restore
                    : () => f.cancel(true);
            const close = () =>
              action === "calculate"
                ? calculateStoredPayrollClose(f.periodKey, draft.revision)
                : approveStoredPayrollClose(
                    f.periodKey,
                    draft.revision,
                    "Review ordered prepaid close",
                  );
            const results = await ordered(
              first === "source" ? mutate : close,
              first === "source" ? close : mutate,
            );
            fulfilled(results[0]);
            if (first === "source" && action === "approve") {
              assert.equal(results[1].status, "rejected");
              if (results[1].status === "rejected")
                assert.match(String(results[1].reason), /changed|recalculate/i);
              assert.equal(
                payrollInputHash((await prisma.payrollClose.findFirstOrThrow()).state),
                beforeHash,
              );
              assert.equal(await prisma.payrollCloseEvent.count(), beforeEvents);
            } else fulfilled(results[1]);
            const after = await f.load();
            assert.equal(after.staff[0]!.collection, "500.0000");
            if (action === "calculate") {
              const calculated = fulfilled(results[first === "source" ? 1 : 0]) as Awaited<
                ReturnType<typeof calculateStoredPayrollClose>
              >;
              assert.equal(
                payrollInputHash(calculated.calculation!.inputs),
                payrollInputHash(first === "source" ? after : original),
              );
            }
            const holding = await prisma.customerValuePackageHolding.findFirst({
              where: { id: f.holdingId },
            });
            assert.equal(
              holding?.amountRemaining.toFixed(2) ?? null,
              source === "purchase-void" ? null : source === "usage-void" ? "600.00" : "510.00",
            );
            const stored = await prisma.payrollClose.findFirstOrThrow();
            if (action === "approve" && first === "close") {
              assert.equal(stored.status, "APPROVED");
              assert.equal(payrollInputHash(stored.state), payrollInputHash(fulfilled(results[0])));
              await assert.rejects(
                calculateStoredPayrollClose(f.periodKey, stored.revision),
                /immutable/i,
              );
              assert.equal(
                payrollInputHash((await prisma.payrollClose.findFirstOrThrow()).state),
                payrollInputHash(stored.state),
              );
            } else {
              const fresh = await calculateStoredPayrollClose(f.periodKey, stored.revision);
              const approved = await approveStoredPayrollClose(
                f.periodKey,
                fresh.revision,
                "Approve reconciled race result",
              );
              assert.equal(approved.status, "APPROVED");
              assert.equal(approved.calculation!.inputHash, fresh.calculation!.inputHash);
            }
          }),
      );

for (const revocation of ["membership", "consent"] as const)
  for (const first of ["spend", "revoke"] as const)
    test(
      `CP-005-M1-18 family spend versus ${revocation}, ${first} first`,
      { skip: disabled, timeout: 20000 },
      () =>
        withFixture(async (f) => {
          const revoke = revocation === "membership" ? f.leave : f.revoke;
          const count = await prisma.sale.count();
          const results = await ordered(
            first === "spend" ? f.spend : revoke,
            first === "spend" ? revoke : f.spend,
          );
          fulfilled(results[0]);
          if (first === "spend" && revocation === "consent") {
            assert.equal(results[1].status, "rejected");
            if (results[1].status === "rejected")
              assert.equal(results[1].reason.code, "SHARING_STALE");
            assert.equal(
              (
                await prisma.customerValuePackageHolding.findFirstOrThrow({
                  where: { id: f.holdingId },
                })
              ).sharedFamilyId,
              f.familyId,
            );
            await f.revoke();
          } else if (first === "spend") fulfilled(results[1]);
          else {
            assert.equal(results[1].status, "rejected");
            if (results[1].status === "rejected")
              assert.match(String(results[1].reason), /credit|family|holding/i);
          }
          assert.equal(await prisma.sale.count(), count + (first === "spend" ? 1 : 0));
          assert.equal(
            (
              await prisma.customerValuePackageHolding.findFirstOrThrow({
                where: { id: f.holdingId },
              })
            ).amountRemaining.toFixed(2),
            first === "spend" ? "420.00" : "510.00",
          );
          assert.equal(
            await prisma.prepaidBalanceEvent.count({ where: { kind: "SPEND" } }),
            first === "spend" ? 2 : 1,
          );
          assert.equal((await f.load()).staff[0]!.collection, "500.0000");
          const draft = await calculateStoredPayrollClose(f.periodKey, 0);
          mock.timers.enable({ apis: ["Date"], now: new Date(draft.calculation!.inputs.endsAt) });
          assert.equal(
            (
              await approveStoredPayrollClose(
                f.periodKey,
                draft.revision,
                "Approve serialized family spend",
              )
            ).status,
            "APPROVED",
          );
        }),
    );

for (const first of ["restore", "purchase-void"] as const)
  test(
    `CP-005-M1-18 restoration versus purchase void, ${first} first`,
    { skip: disabled, timeout: 20000 },
    () =>
      withFixture(async (f) => {
        const before = await prisma.sale.findFirstOrThrow({ where: { id: f.purchaseId } });
        const cancel = () => f.cancel(true);
        const results = await ordered(
          first === "restore" ? f.restore : cancel,
          first === "restore" ? cancel : f.restore,
        );
        if (first === "purchase-void") {
          assert.equal(results[0].status, "rejected");
          if (results[0].status === "rejected")
            assert.equal(results[0].reason.code, "HOLDING_ALREADY_SPENT");
          assert.deepEqual(
            await prisma.sale.findFirstOrThrow({ where: { id: f.purchaseId } }),
            before,
          );
          assert.equal(
            await prisma.customerValuePackageHolding.count({ where: { id: f.holdingId } }),
            1,
          );
          assert.equal(await prisma.prepaidBalanceEvent.count({ where: { kind: "REMOVAL" } }), 0);
          fulfilled(results[1]);
          await cancel();
        } else {
          fulfilled(results[0]);
          fulfilled(results[1]);
        }
        assert.equal(
          await prisma.customerValuePackageHolding.count({ where: { id: f.holdingId } }),
          0,
        );
        assert.equal(await prisma.prepaidBalanceEvent.count({ where: { kind: "RESTORE" } }), 1);
        assert.equal(await prisma.prepaidBalanceEvent.count({ where: { kind: "REMOVAL" } }), 1);
        assert.equal((await f.load()).staff[0]!.collection, "0.0000");
        const draft = await calculateStoredPayrollClose(f.periodKey, 0);
        mock.timers.enable({ apis: ["Date"], now: new Date(draft.calculation!.inputs.endsAt) });
        assert.equal(
          (
            await approveStoredPayrollClose(
              f.periodKey,
              draft.revision,
              "Approve restored purchase race",
            )
          ).status,
          "APPROVED",
        );
      }),
  );

test(
  "CP-005-M1-18 duplicate purchase void returns money and removes credit exactly once",
  { skip: disabled, timeout: 20000 },
  () =>
    withFixture(async (f) => {
      await f.restore();
      const cancel = () => f.cancel(true);
      const results = await ordered(cancel, cancel);
      fulfilled(results[0]);
      fulfilled(results[1]);
      assert.equal(await prisma.prepaidBalanceEvent.count({ where: { kind: "REMOVAL" } }), 1);
      assert.equal(
        await prisma.auditLog.count({
          where: { tenantId: f.tenantId, action: "sale.void.purchase-holdings" },
        }),
        1,
      );
      assert.equal((await f.load()).staff[0]!.collection, "0.0000");
      const hash = payrollInputHash(await f.load());
      await cancel();
      assert.equal(payrollInputHash(await f.load()), hash);
      const draft = await calculateStoredPayrollClose(f.periodKey, 0);
      mock.timers.enable({ apis: ["Date"], now: new Date(draft.calculation!.inputs.endsAt) });
      assert.equal(
        (
          await approveStoredPayrollClose(
            f.periodKey,
            draft.revision,
            "Approve unique purchase return",
          )
        ).status,
        "APPROVED",
      );
    }),
);

for (const kind of ["membership", "consent"] as const)
  test(
    `CP-005-M1-18 competing ${kind} requests refuse stale evidence without duplicate journals`,
    { skip: disabled, timeout: 20000 },
    () =>
      withFixture(async (f) => {
        const current = await prisma.customerValuePackageHolding.findFirstOrThrow({
          where: { id: f.holdingId },
        });
        const mutate =
          kind === "membership"
            ? f.leave
            : () =>
                sharePrepaid(
                  f.customerId,
                  f.holdingId,
                  {
                    familyId: null,
                    expectedUpdatedAt: current.updatedAt.toISOString(),
                    confirmed: true,
                    reason: "Same original consent revision",
                  },
                  f.ownerId,
                );
        const familyCount = await prisma.prepaidFamilyEvent.count();
        const sharingCount = await prisma.prepaidBalanceEvent.count({ where: { kind: "SHARING" } });
        const results = await ordered(mutate, mutate);
        fulfilled(results[0]);
        assert.equal(results[1].status, "rejected");
        if (results[1].status === "rejected")
          assert.equal(
            results[1].reason.code,
            kind === "membership" ? "FAMILY_MEMBERSHIP_STALE" : "SHARING_STALE",
          );
        assert.equal(
          await prisma.prepaidFamilyEvent.count(),
          familyCount + (kind === "membership" ? 1 : 0),
        );
        assert.equal(
          await prisma.prepaidBalanceEvent.count({ where: { kind: "SHARING" } }),
          sharingCount + (kind === "consent" ? 1 : 0),
        );
        assert.equal(
          (
            await prisma.customerValuePackageHolding.findFirstOrThrow({
              where: { id: f.holdingId },
            })
          ).amountRemaining.toFixed(2),
          "510.00",
        );
        assert.equal((await f.load()).staff[0]!.collection, "500.0000");
      }),
  );
