import { PAYROLL_DEFAULT_SETTINGS } from "@glampro_suite/shared";
import { authorizeStoredPayrollCarry } from "./payroll-close-authorizations.js";
import {
  calculateStoredPayrollClose,
  approveStoredPayrollClose,
  readStoredPayrollClose,
} from "./payroll-close-store.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, mock, test } from "node:test";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { createSale, voidSale } from "./sale.service.js";
import { recordSaleCollection } from "./sale-collection.service.js";
import { createPackage } from "./package.service.js";
import { loadPayrollValueSaleAllocation } from "./payroll-close-value-sale.js";
import { loadAuthoritativePayrollCloseInputs } from "./payroll-close-loader.js";
import { openPayrollClose, payrollInputHash } from "./payroll-close-state.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";
import {
  correctRedemptionAttribution,
  redemptionCommissionEvidenceSchema,
} from "./redemption-commission-evidence.js";
import { loadPayrollPackageRedemptionHistory } from "./payroll-close-redemption-loader.js";

/** Real-writer mixed usage and independently reconciled ordinary credit instalments. */
after(async () => {
  await prisma.$disconnect();
});

const disabled = process.env.RUN_CP005_ACCEPTANCE !== "true";

const assertDisposableTarget = () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55485");
  assert.equal(url.pathname, "/payroll_close_test");
};

const shares = (staffId: string) => [{ staffId, share: 10000 }];

/** `runAtOutlet` validates the branch against the active tenant, so a fixture sale
 * has to open the tenant scope first. */
const atOutlet = <T>(fixture: Fixture, work: () => Promise<T>) =>
  runAsTenant(fixture.tenantId, () => runAtOutlet(fixture.outletId, work), fixture.ownerId);

/** Builds the fixture and runs the whole case under its tenant scope, so the
 * assertions read real rows through the same guard production code uses. Returns
 * the test body itself, because `node:test` only awaits a function it can call. */
function tenantCase(tag: string, work: (fixture: Fixture) => Promise<void>) {
  return async () => {
    assertDisposableTarget();
    const fixture = await setup(tag);
    await runAsTenant(fixture.tenantId, () => work(fixture), fixture.ownerId);
  };
}

type Fixture = {
  tenantId: string;
  ownerId: string;
  staffId: string;
  outletId: string;
  customerId: string;
  sessionServiceId: string;
  creditServiceId: string;
  sessionHoldingId: string;
  creditHoldingId: string;
};

/** One salon with a session bundle, stored credit and settled purchases of both.
 * Purchases carry no redemptions, so the loader's sale loop skips them and only the
 * scenario sale decides the refusal. */
async function setup(tag: string): Promise<Fixture> {
  const tenantId = `cp005-gap-${tag}-${randomUUID()}`;
  const ownerId = randomUUID();
  const staffId = randomUUID();
  await runAsPlatform(() =>
    prisma.tenant.create({
      data: {
        id: tenantId,
        slug: tenantId,
        name: `CP-005 unsupported ${tag}`,
        status: "ACTIVE",
        gstEnabled: true,
      },
    }),
  );
  return runAsTenant(
    tenantId,
    async () => {
      for (const [id, globalRole] of [
        [ownerId, "SUPER_ADMIN"],
        [staffId, "STAFF"],
      ] as const)
        await prisma.user.create({
          data: {
            id,
            tenantId,
            name: id,
            email: `${id}@example.invalid`,
            passwordHash: "synthetic-unused",
            globalRole,
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
        data: { tenantId, name: "Unsupported outlet", slug: "unsupported" },
      });
      const customer = await prisma.customer.create({
        data: { tenantId, name: "Unsupported buyer" },
      });
      const sessionService = await prisma.service.create({
        data: { tenantId, name: "Session service", memberPrice: "10", nonmemberPrice: "10" },
      });
      const creditService = await prisma.service.create({
        data: { tenantId, name: "Credit service", memberPrice: "90", nonmemberPrice: "90" },
      });
      const creditItem = await prisma.valuePackage.create({
        data: { tenantId, name: "545 for 600", price: "545", credit: "600" },
      });
      const bundle = await createPackage({
        name: "Unsupported bundle",
        sessionCount: 5,
        memberPrice: 100,
        nonmemberPrice: 100,
        serviceIds: [sessionService.id],
      });
      await prisma.package.update({
        where: { id: bundle.id },
        data: {
          commissionSettings: {
            sale: { mode: "FOLLOW_PLAN" },
            redemption: { mode: "FOLLOW_PLAN" },
            minimumDepositPct: "0",
          },
        },
      });
      const month = await currentMonth(tenantId);
      const [year, number] = month.split("-").map(Number);
      mock.timers.enable({
        apis: ["Date"],
        now: new Date(Date.UTC(year, number - 1, 1) - 86400000),
      });
      try {
        await authorizeStoredPayrollCarry(
          "OPENING",
          month,
          0,
          {
            staff: [ownerId, staffId].map((staffId) => ({
              staffId,
              carryForward: [],
              fallbackCarryCommission: "0.0000000000",
            })),
            evidence: { inventoryReference: "synthetic reviewed opening" },
          },
          "Reviewed synthetic opening",
        );
      } finally {
        mock.timers.reset();
      }
      for (const [kind, targetId, payload] of [
        ["SETTINGS", "company", PAYROLL_DEFAULT_SETTINGS],
        ...[ownerId, staffId].flatMap((id) => [
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
            revision: 1,
            actorId: ownerId,
            reason: "Synthetic historical configuration",
            createdAt: new Date("2026-01-01"),
            payload,
          },
        });
      const sellers = shares(ownerId);
      const bundlePurchase = await runAtOutlet(outlet.id, () =>
        createSale({
          customerId: customer.id,
          lines: [
            { itemType: "PACKAGE", itemId: bundle.id, quantity: 1, attribution: { sellers } },
          ],
          payments: [{ method: "CASH", amount: 100 }],
          collection: {
            currency: "SGD",
            allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "10000" }],
          },
        }),
      );
      const sessionHolding = await prisma.customerPackageHolding.findFirstOrThrow({
        where: { saleLine: { saleId: bundlePurchase.id } },
      });
      const creditPurchase = await runAtOutlet(outlet.id, () =>
        createSale({
          customerId: customer.id,
          lines: [
            {
              itemType: "VALUE_PACKAGE",
              itemId: creditItem.id,
              quantity: 1,
              attribution: { sellers },
            },
          ],
          payments: [{ method: "CASH", amount: 545 }],
          collection: {
            currency: "SGD",
            allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "54500" }],
          },
        }),
      );
      const creditHolding = await prisma.customerValuePackageHolding.findFirstOrThrow({
        where: { saleLine: { saleId: creditPurchase.id } },
      });
      return {
        tenantId,
        ownerId,
        staffId,
        outletId: outlet.id,
        customerId: customer.id,
        sessionServiceId: sessionService.id,
        creditServiceId: creditService.id,
        sessionHoldingId: sessionHolding.id,
        creditHoldingId: creditHolding.id,
      };
    },
    ownerId,
  );
}

async function currentMonth(tenantId: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { timeZone: true },
  });
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: tenant.timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return ["year", "month"].map((key) => parts.find((part) => part.type === key)!.value).join("-");
}

const loadMonth = async (fixture: Fixture) => {
  const month = await currentMonth(fixture.tenantId);
  return runAsTenant(
    fixture.tenantId,
    () =>
      prisma.$transaction((tx) => loadAuthoritativePayrollCloseInputs(tx, openPayrollClose(month))),
    fixture.ownerId,
  );
};

const loadValueSale = (fixture: Fixture, saleId: string) =>
  runAsTenant(
    fixture.tenantId,
    () => prisma.$transaction((tx) => loadPayrollValueSaleAllocation(tx, saleId)),
    fixture.ownerId,
  );

/** Gate only the first real transaction after its tenant row lock. Both real
 * writers retain their production advisory/row locking and commit behavior.
 * Restore the wrapper before starting the contender; no production test hooks. */
function holdFirstSourceTransaction() {
  let enter!: (pid: number) => void;
  let unlock!: () => void;
  const entered = new Promise<number>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const original = prisma.$transaction;
  const restore = () => {
    prisma.$transaction = original;
  };
  // Prisma's extended client exposes methods through a proxy, so node:test's
  // descriptor-based mock.method cannot wrap this method. Restore explicitly.
  const wrapper = async <T>(
    work: (tx: PayrollCloseTransaction) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ) =>
    original.call(
      prisma,
      async (tx: PayrollCloseTransaction) => {
        const gated = new Proxy(tx, {
          get(target, key, receiver) {
            if (key !== "$queryRaw") return Reflect.get(target, key, receiver);
            return async (...args: Parameters<typeof tx.$queryRaw>) => {
              const result = await tx.$queryRaw(...args);
              const query = args[0];
              if (Array.isArray(query) && query.join("").includes("FOR UPDATE")) {
                const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
                restore();
                enter(row.pid);
                await released;
              }
              return result;
            };
          },
        });
        return work(gated);
      },
      options,
    );
  prisma.$transaction = wrapper as typeof prisma.$transaction;
  return {
    entered,
    release: unlock,
    restore,
  };
}

async function assertSourceWriterBlockedBy(pid: number) {
  const deadline = performance.now() + 3000;
  while (performance.now() < deadline) {
    const rows = await prisma.$queryRaw<{ blocked: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE ${pid} = ANY(pg_blocking_pids(pid)) AND wait_event_type = 'Lock'
      ) AS blocked`;
    if (rows[0].blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Competing source/approval writer never reached the held database lock.");
}

for (const first of ["approval", "correction"] as const)
  test(
    `CP-005 deterministic ${first}-first session correction/approval locking`,
    { skip: disabled, timeout: 20000 },
    tenantCase(`ordered-${first}`, async (fixture) => {
      const sale = await atOutlet(fixture, () =>
        createSale({
          customerId: fixture.customerId,
          lines: [
            {
              itemType: "SERVICE",
              itemId: fixture.sessionServiceId,
              quantity: 1,
              attribution: {
                sellers: shares(fixture.ownerId),
                performers: shares(fixture.ownerId),
              },
            },
          ],
          payments: [
            {
              method: "PACKAGE",
              holdingId: fixture.sessionHoldingId,
              amount: 10,
              performers: shares(fixture.ownerId),
            },
          ],
          collection: { currency: "SGD", allocations: [] },
        }),
      );
      const redemption = await prisma.customerRedemption.findFirstOrThrow({
        where: { saleId: sale.id },
      });
      const inputs = await loadMonth(fixture);
      const draft = await calculateStoredPayrollClose(inputs.periodKey, 0);
      const draftHash = payrollInputHash(draft);
      mock.timers.enable({ apis: ["Date"], now: new Date(inputs.endsAt) });
      const gate = holdFirstSourceTransaction();
      const request = {
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        performers: shares(fixture.staffId),
        reason: "Deterministic correction approval ordering",
      };
      const approve = () =>
        approveStoredPayrollClose(
          inputs.periodKey,
          draft.revision,
          "Reviewed deterministic session close",
        );
      const correct = () =>
        correctRedemptionAttribution(sale.id, redemption.id, request, fixture.ownerId);
      const winner = first === "approval" ? approve() : correct();
      // Attach rejection handlers immediately; a failed assertion must still
      // release the real transaction and observe both writer outcomes.
      const winnerOutcome = Promise.allSettled([winner]);
      let contenderOutcome: Promise<PromiseSettledResult<unknown>[]> | undefined;
      try {
        const pid = await Promise.race([
          gate.entered,
          winner.then(() =>
            assert.fail("First writer completed without entering the lock barrier."),
          ),
        ]);
        contenderOutcome = Promise.allSettled([first === "approval" ? correct() : approve()]);
        await assertSourceWriterBlockedBy(pid);
        gate.release();
        const [won] = await winnerOutcome;
        const [contended] = await contenderOutcome;
        assert.equal(won.status, "fulfilled");
        if (first === "approval") {
          assert.equal(contended.status, "fulfilled");
          if (won.status === "fulfilled")
            assert.equal(
              payrollInputHash(await readStoredPayrollClose(inputs.periodKey)),
              payrollInputHash(won.value),
            );
        } else {
          assert.equal(contended.status, "rejected");
          if (contended.status === "rejected")
            assert.match(String(contended.reason), /changed|recalculate/i);
          assert.equal(payrollInputHash(await readStoredPayrollClose(inputs.periodKey)), draftHash);
        }
        const corrected = await prisma.commissionRedemptionSnapshot.findFirstOrThrow({
          where: { redemptionId: redemption.id, revision: 1 },
        });
        const posting = redemptionCommissionEvidenceSchema.parse(
          corrected.evidence,
        ).payrollCorrectionPosting!;
        const nextMonth = await currentMonth(fixture.tenantId);
        assert.equal(posting.periodKey, nextMonth);
        assert.equal(posting.postingAt, inputs.endsAt);
        assert.equal(
          await prisma.payrollCloseEvent.count({
            where: { periodKey: inputs.periodKey, action: "APPROVE" },
          }),
          first === "approval" ? 1 : 0,
        );
        const sources = await prisma.payrollSourceEvent.findMany({ where: { saleId: sale.id } });
        assert.equal(sources.length, 3);
        assert.equal(sources.filter((row) => row.sourceType === "REVERSAL").length, 1);
        assert.equal(sources.filter((row) => row.sourceType === "CORRECTION").length, 1);
        assert.equal((await correct()).id, corrected.id);
        if (first === "correction") {
          const recalculated = await calculateStoredPayrollClose(inputs.periodKey, draft.revision);
          await approveStoredPayrollClose(
            inputs.periodKey,
            recalculated.revision,
            "Reviewed correction-aware original close",
          );
        }
        const frozen = payrollInputHash(await readStoredPayrollClose(inputs.periodKey));
        const nextInputs = await loadMonth(fixture);
        assert.equal(
          nextInputs.staff.find((row) => row.staff.id === fixture.ownerId)!.calculation.lines[0]
            .baseAmount,
          "-18.3480",
        );
        assert.equal(
          nextInputs.staff.find((row) => row.staff.id === fixture.staffId)!.calculation.lines[0]
            .baseAmount,
          "18.3480",
        );
        assert.equal(
          nextInputs.staff.reduce((sum, row) => sum + Number(row.collection), 0),
          0,
        );
        const nextDraft = await calculateStoredPayrollClose(nextMonth, 0);
        mock.timers.setTime(new Date(nextInputs.endsAt).getTime());
        await approveStoredPayrollClose(
          nextMonth,
          nextDraft.revision,
          "Reviewed deterministic reverse repost month",
        );
        assert.equal(payrollInputHash(await readStoredPayrollClose(inputs.periodKey)), frozen);
        assert.equal(await prisma.payrollSourceEvent.count({ where: { saleId: sale.id } }), 3);
        assert.equal(
          await prisma.commissionRedemptionSnapshot.count({
            where: { redemptionId: redemption.id },
          }),
          2,
        );
      } finally {
        gate.restore();
        gate.release();
        await winnerOutcome;
        await contenderOutcome;
        mock.timers.reset();
      }
    }),
  );

test(
  "CP-005 session correction posts next month once and preserves approved original history",
  { skip: disabled },
  tenantCase("correction", async (fixture) => {
    const sale = await atOutlet(fixture, () =>
      createSale({
        customerId: fixture.customerId,
        lines: [
          {
            itemType: "SERVICE",
            itemId: fixture.sessionServiceId,
            quantity: 1,
            attribution: { sellers: shares(fixture.ownerId), performers: shares(fixture.ownerId) },
          },
        ],
        payments: [
          {
            method: "PACKAGE",
            holdingId: fixture.sessionHoldingId,
            amount: 10,
            performers: shares(fixture.ownerId),
          },
        ],
        collection: { currency: "SGD", allocations: [] },
      }),
    );
    const redemption = await prisma.customerRedemption.findFirstOrThrow({
      where: { saleId: sale.id },
    });
    const original = await loadMonth(fixture);
    const originalDraft = await calculateStoredPayrollClose(original.periodKey, 0);
    mock.timers.enable({
      apis: ["Date"],
      now: new Date(new Date(original.endsAt).getTime() + 86400000),
    });
    try {
      const approved = await approveStoredPayrollClose(
        original.periodKey,
        originalDraft.revision,
        "Reviewed original session attribution",
      );
      const frozenHash = payrollInputHash(approved);
      const current = await currentMonth(fixture.tenantId);
      const before = await calculateStoredPayrollClose(current, 0);
      const request = {
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        performers: shares(fixture.staffId),
        reason: "Correct original session performer",
      };
      const corrected = await Promise.all([
        correctRedemptionAttribution(sale.id, redemption.id, request, fixture.ownerId),
        correctRedemptionAttribution(sale.id, redemption.id, request, fixture.ownerId),
      ]);
      assert.equal(corrected[0].id, corrected[1].id);
      const evidence = redemptionCommissionEvidenceSchema.parse(corrected[0].evidence);
      assert.equal(evidence.payrollCorrectionPosting!.periodKey, current);
      assert.equal(evidence.payrollCorrectionPosting!.originalPeriodKey, original.periodKey);
      const events = await prisma.payrollSourceEvent.findMany({ where: { saleId: sale.id } });
      assert.equal(events.length, 3);
      assert.equal(events.filter((row) => row.sourceType === "CORRECTION").length, 1);
      assert.equal(events.filter((row) => row.sourceType === "REVERSAL").length, 1);
      const history = await prisma.$transaction((tx) =>
        loadPayrollPackageRedemptionHistory(tx, fixture.sessionHoldingId),
      );
      assert.equal(history.corrections[0].revisions.length, 1);
      assert.equal(payrollInputHash(await readStoredPayrollClose(original.periodKey)), frozenHash);
      const currentInputs = await loadMonth(fixture);
      assert.equal(
        currentInputs.staff.reduce((sum, row) => sum + Number(row.collection), 0),
        0,
      );
      assert.equal(
        currentInputs.staff.find((row) => row.staff.id === fixture.ownerId)!.calculation.lines[0]
          .baseAmount,
        "-18.3480",
      );
      assert.equal(
        currentInputs.staff.find((row) => row.staff.id === fixture.staffId)!.calculation.lines[0]
          .baseAmount,
        "18.3480",
      );
      mock.timers.setTime(new Date(currentInputs.endsAt).getTime());
      await assert.rejects(
        approveStoredPayrollClose(current, before.revision, "Reject stale pre-correction draft"),
        /changed|recalculate/i,
      );
      const recalculated = await calculateStoredPayrollClose(current, before.revision);
      const final = await approveStoredPayrollClose(
        current,
        recalculated.revision,
        "Reviewed session reverse and repost",
      );
      assert.equal(final.status, "APPROVED");
      assert.equal(payrollInputHash(await readStoredPayrollClose(original.periodKey)), frozenHash);
      // The source occurrence and its selected posting date are distinct. A
      // correction while its current month is already approved must skip it.
      mock.timers.setTime(new Date(currentInputs.endsAt).getTime() - 1);
      const deferred = await correctRedemptionAttribution(
        sale.id,
        redemption.id,
        {
          ...request,
          expectedRevision: 1,
          idempotencyKey: randomUUID(),
          performers: shares(fixture.ownerId),
          reason: "Correct session after current month approval",
        },
        fixture.ownerId,
      );
      const deferredPosting = redemptionCommissionEvidenceSchema.parse(
        deferred.evidence,
      ).payrollCorrectionPosting!;
      assert.equal(deferredPosting.inspectedPeriods[0].status, "APPROVED");
      assert.equal(deferredPosting.postingAt, currentInputs.endsAt);
      const futureEvent = await prisma.payrollSourceEvent.findFirstOrThrow({
        where: { sourceKey: `redemption:${redemption.id}:2` },
      });
      assert.ok(futureEvent.createdAt < futureEvent.occurredAt);
      const verifiedFuture = await prisma.$transaction((tx) =>
        loadPayrollPackageRedemptionHistory(tx, fixture.sessionHoldingId),
      );
      assert.equal(verifiedFuture.corrections[0].revisions.length, 2);
      assert.equal(
        payrollInputHash(await readStoredPayrollClose(current)),
        payrollInputHash(final),
      );
      mock.timers.setTime(new Date(currentInputs.endsAt).getTime() + 86400000);
      const futureMonth = await loadMonth(fixture);
      assert.equal(futureMonth.periodKey, deferredPosting.periodKey);
      assert.equal(
        futureMonth.staff.find((row) => row.staff.id === fixture.ownerId)!.calculation.lines[0]
          .baseAmount,
        "18.3480",
      );
      assert.equal(
        futureMonth.staff.find((row) => row.staff.id === fixture.staffId)!.calculation.lines[0]
          .baseAmount,
        "-18.3480",
      );
      const raceDraft = await calculateStoredPayrollClose(futureMonth.periodKey, 0);
      mock.timers.setTime(new Date(futureMonth.endsAt).getTime());
      const raceRequest = {
        ...request,
        expectedRevision: 2,
        idempotencyKey: randomUUID(),
        performers: shares(fixture.staffId),
        reason: "Session correction racing approval",
      };
      const race = await Promise.allSettled([
        approveStoredPayrollClose(
          futureMonth.periodKey,
          raceDraft.revision,
          "Approve while session correction competes",
        ),
        correctRedemptionAttribution(sale.id, redemption.id, raceRequest, fixture.ownerId),
      ]);
      assert.equal(race[1].status, "fulfilled");
      if (race[0].status === "rejected")
        assert.match(String(race[0].reason), /changed|recalculate/i);
      else assert.equal(race[0].value.status, "APPROVED");
      const raceSources = await prisma.payrollSourceEvent.findMany({ where: { saleId: sale.id } });
      assert.equal(raceSources.length, 7);
      assert.equal(
        payrollInputHash(await readStoredPayrollClose(current)),
        payrollInputHash(final),
      );
      const beforeRejected = await prisma.commissionRedemptionSnapshot.count({
        where: { redemptionId: redemption.id },
      });
      await assert.rejects(
        correctRedemptionAttribution(
          sale.id,
          redemption.id,
          {
            ...raceRequest,
            expectedRevision: 3,
            idempotencyKey: randomUUID(),
            performers: shares(randomUUID()),
          },
          fixture.ownerId,
        ),
        /staff|salon|attribution/i,
      );
      assert.equal(
        await prisma.commissionRedemptionSnapshot.count({ where: { redemptionId: redemption.id } }),
        beforeRejected,
      );
      assert.equal(await prisma.payrollSourceEvent.count({ where: { saleId: sale.id } }), 7);
    } finally {
      mock.timers.reset();
    }
  }),
);

for (const [partial, external] of [
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])
  test(
    `CP-005 ${partial ? "partial-line" : "disjoint"} session/credit usage reconciles ${external ? "with allocated cash" : "without new cash"}`,
    { skip: disabled },
    tenantCase(
      `${partial ? "partial" : "mixed"}-${external ? "cash" : "credit"}`,
      async (fixture) => {
        const sale = await atOutlet(fixture, () =>
          createSale({
            customerId: fixture.customerId,
            lines: [
              {
                itemType: "SERVICE",
                itemId: fixture.sessionServiceId,
                quantity: partial ? 6 : 1,
                attribution: {
                  sellers: shares(fixture.ownerId),
                  performers: shares(fixture.ownerId),
                },
              },
              {
                itemType: "SERVICE",
                itemId: fixture.creditServiceId,
                quantity: 1,
                attribution: {
                  sellers: shares(fixture.ownerId),
                  performers: shares(fixture.ownerId),
                },
              },
            ],
            payments: [
              {
                method: "PACKAGE",
                holdingId: fixture.sessionHoldingId,
                amount: partial ? 50 : 10,
                performers: shares(fixture.ownerId),
              },
              {
                method: "PREPAID_CREDIT",
                holdingId: fixture.creditHoldingId,
                amount: (external ? 60 : 90) + (partial ? 10 : 0),
              },
              ...(external ? [{ method: "CASH" as const, amount: 30 }] : []),
            ],
            collection: {
              currency: "SGD",
              allocations: external
                ? partial
                  ? [
                      { paymentIndex: 2, linePosition: 0, grossCents: "500" },
                      { paymentIndex: 2, linePosition: 1, grossCents: "2500" },
                    ]
                  : [{ paymentIndex: 2, linePosition: 1, grossCents: "3000" }]
                : [],
            },
          }),
        );
        assert.equal(sale.status, "COMPLETED");
        assert.equal(sale.paymentStatus, "PAID");
        const kinds = await prisma.customerRedemption.findMany({
          where: { tenantId: fixture.tenantId, saleId: sale.id },
          select: { itemType: true },
        });
        assert.deepEqual(kinds.map((row) => row.itemType).sort(), ["PACKAGE", "VALUE_PACKAGE"]);
        const allocated = await loadValueSale(fixture, sale.id);
        assert.equal(allocated.ordinary.length, partial ? 2 : 1);
        assert.deepEqual(
          allocated.ordinary.map((row) => row.baseAmount).sort(),
          partial
            ? external
              ? ["22.9400", "4.5900"]
              : ["0.0000", "0.0000"]
            : [external ? "27.5200" : "0.0000"],
        );
        assert.equal(allocated.packageTender!.grossCents, partial ? "5000" : "1000");
        const inputs = await loadMonth(fixture);
        assert.equal(
          inputs.staff.find((row) => row.staff.id === fixture.ownerId)!.collection,
          external ? (partial ? "619.2700" : "619.2600") : "591.7400",
        );
        // Corrupt persisted operational inputs inside rolled-back transactions: neither
        // tender nor frozen zero-base evidence may be inferred from source captures.
        const creditLine = await prisma.saleLine.findFirstOrThrow({
          where: { saleId: sale.id, itemId: fixture.creditServiceId },
        });
        // The database separately enforces immutability. A substituted read also
        // proves that the loader itself rejects absent prospective funding evidence.
        await assert.rejects(
          prisma.$transaction(async (tx) => {
            const original = tx.sale.findFirst.bind(tx.sale);
            const proxy = new Proxy(tx, {
              get(target, key) {
                if (key !== "sale") return Reflect.get(target, key);
                return new Proxy(target.sale, {
                  get(delegate, method) {
                    if (method !== "findFirst") return Reflect.get(delegate, method);
                    return async (args: Parameters<typeof original>[0]) => {
                      const row = await original(args);
                      if (!row || row.id !== sale.id || !("lines" in row)) return row;
                      return {
                        ...row,
                        lines: (row.lines as typeof sale.lines).map((line) => ({
                          ...line,
                          ...(line.id === creditLine.id
                            ? {
                                payrollEconomics: {
                                  ...(creditLine.payrollEconomics as object),
                                  sessionCreditFunding: null,
                                },
                              }
                            : {}),
                        })),
                      };
                    };
                  },
                });
              },
            });
            await loadPayrollValueSaleAllocation(proxy, sale.id);
          }),
          /VALUE_SALE_ALLOCATION_UNCONFIRMED/,
        );
        for (const corrupt of [
          async (tx: PayrollCloseTransaction) => {
            await tx.saleLine.update({
              where: { id: creditLine.id },
              data: {
                payrollEconomics: {
                  ...(creditLine.payrollEconomics as object),
                  sessionCreditFunding: null,
                },
              },
            });
          },
          async (tx: PayrollCloseTransaction) => {
            await tx.salePayment.updateMany({
              where: { saleId: sale.id, method: "PACKAGE" },
              data: { amount: "9.99" },
            });
          },
          async (tx: PayrollCloseTransaction) => {
            await tx.salePayment.updateMany({
              where: { saleId: sale.id, method: "PREPAID_CREDIT" },
              data: { amount: "89.99" },
            });
          },
        ])
          await assert.rejects(
            prisma.$transaction(async (tx) => {
              await corrupt(tx);
              await loadAuthoritativePayrollCloseInputs(tx, openPayrollClose(inputs.periodKey));
            }),
            /Authoritative payroll inputs unavailable|Original payroll sale economics are immutable/,
          );
        await calculateStoredPayrollClose(inputs.periodKey, 0);
        mock.timers.enable({ apis: ["Date"], now: new Date(inputs.endsAt) });
        try {
          // Both inventories remain valid, but historical configuration changed.
          const settings = await prisma.payrollConfigurationEvent.findFirstOrThrow({
            where: { tenantId: fixture.tenantId, kind: "PROFILE", targetId: fixture.ownerId },
          });
          await prisma.payrollConfigurationEvent.create({
            data: {
              tenantId: fixture.tenantId,
              kind: "PROFILE",
              targetId: fixture.ownerId,
              revision: 2,
              actorId: fixture.ownerId,
              reason: "Synthetic stale draft probe",
              createdAt: new Date("2026-01-02"),
              payload: { ...(settings.payload as object), basicSalary: "1" },
            },
          });
          await assert.rejects(
            approveStoredPayrollClose(inputs.periodKey, 1, "Stale mixed funding"),
            /changed|recalculate|stale/i,
          );
          const refreshed = await calculateStoredPayrollClose(inputs.periodKey, 1);
          const approved = await approveStoredPayrollClose(
            inputs.periodKey,
            refreshed.revision,
            "Reviewed mixed funding",
          );
          assert.equal(approved.status, "APPROVED");
          const frozenHash = payrollInputHash(approved);
          await prisma.service.update({
            where: { id: fixture.creditServiceId },
            data: { nonmemberPrice: "999" },
          });
          const persisted = await prisma.payrollClose.findFirstOrThrow({
            where: { tenantId: fixture.tenantId, periodKey: inputs.periodKey },
          });
          assert.equal(payrollInputHash(persisted.state), frozenHash);
          assert.equal(
            payrollInputHash(approved.calculation),
            payrollInputHash(refreshed.calculation),
          );
        } finally {
          mock.timers.reset();
        }
        assert.equal(
          payrollInputHash(
            JSON.parse(
              JSON.stringify(await loadValueSale(fixture, sale.id), (_key, value) =>
                typeof value === "bigint" ? value.toString() : value,
              ),
            ),
          ),
          payrollInputHash(
            JSON.parse(
              JSON.stringify(allocated, (_key, value) =>
                typeof value === "bigint" ? value.toString() : value,
              ),
            ),
          ),
        );
        assert.equal(await prisma.payrollClose.count({ where: { tenantId: fixture.tenantId } }), 1);
        assert.equal(
          await prisma.employeeCommission.count({ where: { tenantId: fixture.tenantId } }),
          0,
        );
        assert.equal(
          await prisma.commissionCollection.count({
            where: { tenantId: fixture.tenantId, saleId: sale.id },
          }),
          external ? 1 : 0,
        );
        assert.equal(
          await prisma.customerRedemption.count({
            where: { tenantId: fixture.tenantId, saleId: sale.id, revertedAt: { not: null } },
          }),
          0,
        );
      },
    ),
  );

test(
  "CP-005 mixed ordinary funding retains a wholly credit-funded line without missing evidence",
  { skip: disabled },
  tenantCase("zero-line", async (fixture) => {
    const sale = await atOutlet(fixture, () =>
      createSale({
        customerId: fixture.customerId,
        lines: [fixture.sessionServiceId, fixture.creditServiceId].map((itemId) => ({
          itemType: "SERVICE" as const,
          itemId,
          quantity: 1,
          attribution: { sellers: shares(fixture.ownerId), performers: shares(fixture.ownerId) },
        })),
        payments: [
          { method: "PREPAID_CREDIT", holdingId: fixture.creditHoldingId, amount: 70 },
          { method: "CASH", amount: 30 },
        ],
        collection: {
          currency: "SGD",
          allocations: [{ paymentIndex: 1, linePosition: 1, grossCents: "3000" }],
        },
      }),
    );
    const allocated = await loadValueSale(fixture, sale.id);
    assert.deepEqual(allocated.ordinary.map((row) => row.baseAmount).sort(), ["0.0000", "27.5200"]);
    const sources = await prisma.payrollSourceEvent.findMany({
      where: { saleId: sale.id, sourceType: "SALE_LINE" },
    });
    assert.equal(sources.length, 2);
    for (const source of sources)
      assert.deepEqual((source.evidence as { missingEvidence: string[] }).missingEvidence, []);
    const inputs = await loadMonth(fixture);
    assert.equal(
      inputs.staff.find((row) => row.staff.id === fixture.ownerId)!.collection,
      "619.2600",
    );
  }),
);

test(
  "CP-005 credit instalments retain checkout economics and post later cash once",
  { skip: disabled },
  tenantCase("instalment", async (fixture) => {
    const sale = await atOutlet(fixture, () =>
      createSale({
        customerId: fixture.customerId,
        lines: [
          {
            itemType: "SERVICE",
            itemId: fixture.creditServiceId,
            quantity: 1,
            attribution: { sellers: shares(fixture.ownerId), performers: shares(fixture.ownerId) },
          },
        ],
        payments: [{ method: "PREPAID_CREDIT", holdingId: fixture.creditHoldingId, amount: 30 }],
        collection: { currency: "SGD", allocations: [] },
      }),
    );
    assert.equal(sale.status, "COMPLETED");
    assert.equal(sale.paymentStatus, "UNPAID");
    const debt = await prisma.customerOutstanding.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, saleId: sale.id },
    });
    assert.equal(debt.unpaidAmount.toFixed(2), "60.00");
    const initial = await loadValueSale(fixture, sale.id);
    assert.equal(initial.ordinary[0].baseAmount, "0.0000");
    const originalEconomics = await prisma.saleLine.findFirstOrThrow({
      where: { saleId: sale.id },
    });
    await assert.rejects(
      prisma.saleLine.update({
        where: { id: originalEconomics.id },
        data: {
          payrollEconomics: {
            ...(originalEconomics.payrollEconomics as object),
            instalmentCreditFunding: { version: 1 },
          },
        },
      }),
      /immutable/,
    );
    assert.equal(
      (await loadMonth(fixture)).staff.find((row) => row.staff.id === fixture.ownerId)!.collection,
      "591.7400",
    );
    await calculateStoredPayrollClose((await loadMonth(fixture)).periodKey, 0);
    const line = sale.lines[0];
    const payment = {
      idempotencyKey: randomUUID(),
      currency: "SGD" as const,
      collected: true as const,
      grossCents: "3000",
      reason: "Collected instalment",
      allocations: [{ saleLineId: line.id, grossCents: "3000" }],
    };
    await Promise.all([
      atOutlet(fixture, () => recordSaleCollection(sale.id, payment)),
      atOutlet(fixture, () => recordSaleCollection(sale.id, payment)),
    ]);
    assert.equal(await prisma.customerOutstandingPayment.count({ where: { saleId: sale.id } }), 1);
    await assert.rejects(
      voidSale(
        sale.id,
        { reason: "Cannot void collected debt", cashDisposition: "NO_MOVEMENT" },
        fixture.ownerId,
      ),
      /paid against/,
    );
    assert.equal(
      (await prisma.sale.findFirstOrThrow({ where: { id: sale.id } })).status,
      "COMPLETED",
    );
    const allocated = await loadValueSale(fixture, sale.id);
    assert.equal(allocated.ordinary[0].baseAmount, "0.0000");
    assert.equal(allocated.laterOperations.length, 1);
    const month = await loadMonth(fixture);
    assert.equal(
      month.staff.find((row) => row.staff.id === fixture.ownerId)!.collection,
      "619.2600",
    );
    const late = await prisma.payrollSourceEvent.findFirstOrThrow({
      where: { saleId: sale.id, sourceType: "ORDINARY_COLLECTION" },
    });
    assert.equal(
      (late.evidence as { lines: { units: string; baseAmount: string }[] }).lines[0].units,
      "0.0000",
    );
    const allocation = await prisma.commissionCollectionAllocation.findFirstOrThrow({
      where: { collection: { sourceType: "OUTSTANDING_PAYMENT", saleId: sale.id } },
    });
    await assert.rejects(
      prisma.commissionCollectionAllocation.update({
        where: { id: allocation.id },
        data: { netCents: allocation.netCents + 1n },
      }),
      /append-only/,
    );
    mock.timers.enable({ apis: ["Date"], now: new Date(month.endsAt) });
    try {
      await assert.rejects(
        approveStoredPayrollClose(month.periodKey, 1, "Reject stale collection draft"),
        /changed|recalculate/i,
      );
      const draft = await calculateStoredPayrollClose(month.periodKey, 1);
      const approved = await approveStoredPayrollClose(
        month.periodKey,
        draft.revision,
        "Reviewed instalment cash and original credit",
      );
      assert.equal(approved.status, "APPROVED");
      assert.equal(payrollInputHash(approved.calculation), payrollInputHash(draft.calculation));
      const frozenHash = payrollInputHash(approved);
      await atOutlet(fixture, () =>
        recordSaleCollection(sale.id, {
          ...payment,
          idempotencyKey: randomUUID(),
          reason: "Collected final instalment in next month",
        }),
      );
      assert.equal(payrollInputHash(await readStoredPayrollClose(month.periodKey)), frozenHash);
      const nextPeriod = new Date(new Date(month.endsAt).getTime() + 86400000)
        .toISOString()
        .slice(0, 7);
      const next = await calculateStoredPayrollClose(nextPeriod, 0);
      assert.equal(
        next.calculation!.inputs.staff.find((row) => row.staff.id === fixture.ownerId)!.collection,
        "27.5300",
      );
      assert.equal(
        next
          .calculation!.inputs.staff.find((row) => row.staff.id === fixture.ownerId)!
          .calculation.lines.filter((row) => row.commissionType === "SVC").length,
        1,
      );
    } finally {
      mock.timers.reset();
    }
    assert.equal(await prisma.payrollClose.count({ where: { tenantId: fixture.tenantId } }), 2);
    assert.equal(
      await prisma.employeeCommission.count({ where: { tenantId: fixture.tenantId } }),
      0,
    );
    assert.equal(
      await prisma.customerOutstanding.count({
        where: { tenantId: fixture.tenantId, saleId: sale.id },
      }),
      1,
    );
  }),
);
