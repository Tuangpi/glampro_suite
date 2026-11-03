import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { payrollImpactTotal, payrollPlanDefinitionSchema } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { runAtOutlet } from "../lib/tenant-context.js";
import { payrollCloseFixture } from "../test-support/payroll-close-fixture.js";
import {
  readPayrollConfiguration,
  readPayrollHistoricalPreview,
} from "./payroll-configuration.service.js";
import { calculateStoredPayrollClose, readStoredPayrollClose } from "./payroll-close-store.js";
import { createSale, refundSale } from "./sale.service.js";

/** Opt-in: every case here writes a disposable tenant and a real month of sales. */
const skip = process.env.RUN_CP003A_PREVIEW_ACCEPTANCE !== "true";

/** The preview window comes from the salon clock, so the month under review is fixed
 * by moving the clock one month past the fixture's activity, never by asking the
 * preview for an arbitrary period. */
function at(iso: string) {
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: new Date(iso) });
}

const define = (component: Record<string, unknown>) =>
  payrollPlanDefinitionSchema.parse({ stages: [], components: [component], incentives: [] });

/** Two dollars a credited unit: a half share is fifty cents, so a split line proves
 * fractional units are carried exactly rather than rounded to a whole sale. */
const fixedPerUnit = define({
  key: "service",
  name: "Service commission",
  sort: 1,
  commissionTypes: ["SVC"],
  basePct: "100",
  method: "FIXED_PER_UNIT",
  fixedAmount: "2.00",
  bands: [],
});
const flatTenPercent = define({
  key: "service",
  name: "Service commission",
  sort: 1,
  commissionTypes: ["SVC"],
  basePct: "100",
  method: "FLAT",
  flatRatePct: "10",
  bands: [],
});
const flatZeroPercent = define({
  key: "service",
  name: "Service commission",
  sort: 1,
  commissionTypes: ["SVC"],
  basePct: "100",
  method: "FLAT",
  flatRatePct: "0",
  bands: [],
});

type Fixture = Awaited<ReturnType<typeof payrollCloseFixture>>;

async function publishedPlan(fixture: Fixture) {
  const plan = await fixture.scope(async () => (await readPayrollConfiguration()).plans[0]);
  assert.ok(plan, "fixture must publish one plan");
  return plan;
}

/** One attributed service sale through the real till service, so every evidence row
 * the loader verifies (line economics, attribution, collection allocation) is real. */
async function sell(
  fixture: Fixture,
  outletId: string,
  stock: { serviceId: string },
  line: { performers: { staffId: string; share: number }[]; sellerId: string; quantity?: number },
) {
  return fixture.scope(() =>
    runAtOutlet(outletId, () =>
      createSale({
        lines: [
          {
            itemType: "SERVICE",
            itemId: stock.serviceId,
            quantity: line.quantity ?? 1,
            attribution: {
              sellers: [{ staffId: line.sellerId, share: 10000 }],
              performers: line.performers,
            },
          },
        ],
        payments: [{ method: "CASH", amount: 100 }],
        collection: {
          currency: "SGD",
          allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "10000" }],
        },
      }),
    ),
  );
}

async function refund(fixture: Fixture, outletId: string, saleId: string) {
  return fixture.scope(() =>
    runAtOutlet(outletId, () =>
      refundSale(
        saleId,
        {
          reason: "Synthetic reversal for historical preview acceptance",
          restock: false,
          payouts: [{ method: "CASH", amount: 100 }],
        },
        fixture.ownerId,
      ),
    ),
  );
}

/** The month's own calculation is the money the preview must equal, so it is always
 * produced by the same loader rather than asserted from hand-written figures. */
async function postedMonth(fixture: Fixture, periodKey: string) {
  const open = await fixture.scope(() => readStoredPayrollClose(periodKey));
  const calculated = await fixture.scope(() =>
    calculateStoredPayrollClose(periodKey, open.revision),
  );
  assert.equal(calculated.status, "CALCULATED");
  const statements = new Map(
    (calculated.calculation?.statements ?? []).map((statement) => [statement.staff.id, statement]),
  );
  return { calculated, statements };
}

/** Equality with posted money is the whole contract: no tolerance, no re-derivation. */
function assertEqualsPosted(
  preview: Awaited<ReturnType<typeof readPayrollHistoricalPreview>>,
  posted: Awaited<ReturnType<typeof postedMonth>>,
) {
  assert.equal(preview.status, "AVAILABLE", JSON.stringify(preview.blockers));
  assert.equal(preview.inputSource, "AUTHORITATIVE_LOADER");
  const rows = preview.impact?.rows ?? [];
  let sum = 0;
  for (const row of rows) {
    const statement = posted.statements.get(row.staffId);
    assert.ok(statement, `no posted statement for ${row.staffId}`);
    assert.deepEqual(row.before, statement.result);
    assert.equal(row.beforeTotal, payrollImpactTotal(statement.result));
    sum += Number(row.beforeTotal);
  }
  assert.equal(Number(preview.impact?.totals.before), Math.round(sum * 100) / 100);
  assert.equal(preview.impact?.totals.after, preview.impact?.totals.before);
  assert.equal(preview.impact?.totals.change, "0.00");
  assert.equal(preview.impact?.inputHash, posted.calculated.calculation?.inputHash);
  assert.equal(JSON.stringify(preview).includes("basicSalary"), false);
  return rows;
}

function rowOf(
  rows: Awaited<ReturnType<typeof assertEqualsPosted>>,
  staffId: string,
  name: string,
) {
  const row = rows.find((line) => line.staffId === staffId);
  assert.ok(row, `no preview row for ${name}`);
  return row;
}

test(
  "CP-003A fractional fixed units, reversals and negative balances equal posted money",
  { skip, timeout: 240_000 },
  async () => {
    // No fixture sales: every line in this month is placed here, so each staff member
    // is a named case rather than an accident of the fixture's default activity.
    const fixture = await payrollCloseFixture(4, true, {
      receiptsPerStaff: 0,
      plans: [fixedPerUnit],
    });
    try {
      const plan = await publishedPlan(fixture);
      const serviceId = await fixture.scope(
        async () => (await prisma.service.findFirstOrThrow()).id,
      );
      const stock = { serviceId };
      const outletId = await fixture.scope(async () => (await prisma.outlet.findFirstOrThrow()).id);
      const [owner, manager, staff, cashier] = fixture.ids as [string, string, string, string];

      // Fractional fixed units: one sold unit split 50/50 credits half a unit each.
      at("2026-09-20T04:00:00Z");
      await sell(fixture, outletId, stock, {
        sellerId: owner,
        performers: [
          { staffId: owner, share: 5000 },
          { staffId: manager, share: 5000 },
        ],
      });
      // Reversal inside the month: the sale and its refund cancel, and both evidence
      // rows stay in the month rather than the sale disappearing.
      const reversed = await sell(fixture, outletId, stock, {
        sellerId: staff,
        performers: [{ staffId: staff, share: 10000 }],
      });
      at("2026-09-25T04:00:00Z");
      await refund(fixture, outletId, reversed.id);
      // Negative balance: the sale belongs to a prior month and only its reversal
      // falls in the reviewed month.
      at("2026-08-20T04:00:00Z");
      const priorMonth = await sell(fixture, outletId, stock, {
        sellerId: cashier,
        performers: [{ staffId: cashier, share: 10000 }],
      });
      at("2026-09-28T04:00:00Z");
      await refund(fixture, outletId, priorMonth.id);

      at("2026-10-05T03:00:00Z");
      // Read-only first: previewing neither calculates nor approves anything.
      const before = await fixture.scope(() => readStoredPayrollClose("2026-09"));
      assert.equal(before.calculation, null);
      const preview = await fixture.scope(() =>
        readPayrollHistoricalPreview(plan.id, plan.revision),
      );
      assert.equal(preview.periodKey, "2026-09");
      assert.equal(
        (await fixture.scope(() => readStoredPayrollClose("2026-09"))).calculation,
        null,
      );
      const posted = await postedMonth(fixture, preview.periodKey!);
      const rows = assertEqualsPosted(preview, posted);

      const ownerRow = rowOf(rows, owner, "owner");
      assert.equal(ownerRow.beforeTotal, "1.00");
      const ownerComponent = ownerRow.before.components[0]!;
      // Half a unit at two dollars: the fraction is the money, not a rounding artefact.
      assert.equal(ownerComponent.units, "0.5000");
      assert.equal(ownerComponent.rawBase, "50.0000");
      assert.equal(ownerComponent.amount, "1.00");
      assert.deepEqual(ownerComponent.working.at(-1), {
        kind: "FIXED",
        base: "0.5000",
        ratePct: null,
        amount: "1.00",
      });
      assert.equal(rowOf(rows, manager, "manager").beforeTotal, "1.00");

      const reversedRow = rowOf(rows, staff, "staff");
      assert.equal(reversedRow.beforeTotal, "0.00");
      assert.equal(reversedRow.before.components[0]!.rawBase, "0.0000");
      assert.equal(reversedRow.before.components[0]!.units, "0.0000");

      const negativeRow = rowOf(rows, cashier, "cashier");
      assert.equal(negativeRow.beforeTotal, "0.00");
      const negativeComponent = negativeRow.before.components[0]!;
      // A refunded prior-month sale is a reversal of one unit and one hundred dollars.
      assert.equal(negativeComponent.rawBase, "-100.0000");
      assert.equal(negativeComponent.units, "-1.0000");
      // Money never silently flips sign: the unit debt is carried, not paid out.
      assert.equal(negativeComponent.amount, "0.00");
      assert.equal(negativeComponent.carryUnitsOut, "-1.0000");
      assert.deepEqual(negativeRow.before.carryForward, [
        { componentKey: "service", base: "0.0000", units: "-1.0000" },
      ]);

      // Two staff at a dollar each: the reversed and negative months contribute zero.
      assert.equal(preview.impact?.totals.before, "2.00");
    } finally {
      mock.timers.reset();
    }
  },
);

test(
  "CP-003A outlet-pooled money and a negative base carry equal posted money",
  { skip, timeout: 240_000 },
  async () => {
    const fixture = await payrollCloseFixture(2, true, {
      receiptsPerStaff: 0,
      plans: [flatTenPercent],
    });
    try {
      const plan = await publishedPlan(fixture);
      const serviceId = await fixture.scope(
        async () => (await prisma.service.findFirstOrThrow()).id,
      );
      const stock = { serviceId };
      const firstOutlet = await fixture.scope(
        async () => (await prisma.outlet.findFirstOrThrow()).id,
      );
      // A second branch of the same salon: the plan is company-wide, so both branches
      // belong to one staff member's month.
      const secondOutlet = await fixture.scope(() =>
        prisma.outlet.create({
          data: { tenantId: fixture.tenantId, name: "Second branch", slug: "second" },
        }),
      );
      const [owner, manager] = fixture.ids as [string, string];

      at("2026-09-20T04:00:00Z");
      await sell(fixture, secondOutlet.id, stock, {
        sellerId: owner,
        performers: [{ staffId: owner, share: 10000 }],
      });
      await sell(fixture, firstOutlet, stock, {
        sellerId: owner,
        performers: [{ staffId: owner, share: 10000 }],
      });
      at("2026-08-20T04:00:00Z");
      const priorMonth = await sell(fixture, firstOutlet, stock, {
        sellerId: manager,
        performers: [{ staffId: manager, share: 10000 }],
      });
      at("2026-09-28T04:00:00Z");
      await refund(fixture, firstOutlet, priorMonth.id);

      at("2026-10-05T03:00:00Z");
      const preview = await fixture.scope(() =>
        readPayrollHistoricalPreview(plan.id, plan.revision),
      );
      const rows = assertEqualsPosted(preview, await postedMonth(fixture, "2026-09"));

      // Both outlets are pooled for the one staff member: 200 of base at ten percent.
      const ownerRow = rowOf(rows, owner, "owner");
      assert.equal(ownerRow.beforeTotal, "20.00");
      assert.equal(ownerRow.before.components[0]!.rawBase, "200.0000");
      assert.equal(ownerRow.before.components[0]!.units, "2.0000");
      assert.equal(ownerRow.before.components[0]!.working.at(-1)!.amount, "20.00");

      // The refunded prior-month sale carries a negative base instead of paying
      // negative money, and the month's money stays exact rather than netting it away.
      const managerRow = rowOf(rows, manager, "manager");
      assert.equal(managerRow.beforeTotal, "0.00");
      const component = managerRow.before.components[0]!;
      assert.equal(component.rawBase, "-100.0000");
      assert.equal(component.amount, "0.00");
      assert.deepEqual(managerRow.before.carryForward, [
        { componentKey: "service", base: "-100.0000", units: "0.0000" },
      ]);
      assert.equal(preview.impact?.totals.before, "20.00");

      // The same month is refused under an outlet context: preview money is salon-wide.
      await assert.rejects(
        fixture.scope(() =>
          runAtOutlet(secondOutlet.id, () => readPayrollHistoricalPreview(plan.id, plan.revision)),
        ),
        /company context/,
      );
    } finally {
      mock.timers.reset();
    }
  },
);

test(
  "CP-003A authoritative zero is available while the same month without opening evidence is not",
  { skip, timeout: 240_000 },
  async () => {
    // Same salon, same empty month, same configuration. The only difference is whether
    // the opening carry was explicitly authorized, so the two outcomes cannot be
    // explained by missing activity or missing settings.
    const authorized = await payrollCloseFixture(2, true, { receiptsPerStaff: 0 });
    const unauthorized = await payrollCloseFixture(2, true, {
      authorizeOpening: false,
      receiptsPerStaff: 0,
    });
    try {
      at("2026-10-05T03:00:00Z");
      const zeroPlan = await publishedPlan(authorized);
      const zero = await authorized.scope(() =>
        readPayrollHistoricalPreview(zeroPlan.id, zeroPlan.revision),
      );
      // An explicit, authorized zero: money is available and it is exactly zero.
      assert.equal(zero.status, "AVAILABLE", JSON.stringify(zero.blockers));
      assert.deepEqual(zero.blockers, []);
      assert.equal(zero.impact?.totals.before, "0.00");
      assert.equal(zero.impact?.totals.after, "0.00");
      assert.equal(zero.impact?.totals.change, "0.00");
      assert.equal(zero.impact?.rows.length, 2);
      assert.ok(zero.impact?.rows.every((row) => row.beforeTotal === "0.00"));
      assert.equal(zero.evidenceInventory.collectionCount, 0);
      assert.deepEqual(zero.configuration.blockers, []);

      const gapPlan = await publishedPlan(unauthorized);
      const gap = await unauthorized.scope(() =>
        readPayrollHistoricalPreview(gapPlan.id, gapPlan.revision),
      );
      // The identical month without that evidence is refused by name, with no money
      // and no invented zero.
      assert.equal(gap.status, "UNAVAILABLE");
      assert.equal(gap.inputSource, null);
      assert.equal(gap.impact, null);
      assert.deepEqual(gap.blockers, ["APPROVED_PREVIOUS_CLOSE_OR_PERSISTED_OPENING_REQUIRED"]);
      assert.equal(gap.periodKey, zero.periodKey);
      assert.deepEqual(gap.configuration.blockers, []);
      assert.equal(gap.evidenceInventory.collectionCount, 0);

      // Read-only: neither month was calculated by looking at it.
      for (const fixture of [authorized, unauthorized])
        assert.equal(
          (await fixture.scope(() => readStoredPayrollClose("2026-09"))).calculation,
          null,
        );
    } finally {
      mock.timers.reset();
    }
  },
);

test(
  "CP-003A a zero-rate rule posts evidence-backed zero money, not missing evidence",
  { skip, timeout: 240_000 },
  async () => {
    const fixture = await payrollCloseFixture(2, true, { plans: [flatZeroPercent] });
    try {
      const plan = await publishedPlan(fixture);
      at("2026-10-05T03:00:00Z");
      const preview = await fixture.scope(() =>
        readPayrollHistoricalPreview(plan.id, plan.revision),
      );
      const rows = assertEqualsPosted(preview, await postedMonth(fixture, "2026-09"));
      // Real collections, real statements, zero commission: the zero is derived from
      // complete evidence rather than standing in for absent evidence.
      assert.equal(preview.evidenceInventory.collectionCount, 2);
      assert.equal(rows.length, 2);
      assert.ok(rows.every((row) => row.beforeTotal === "0.00"));
      assert.ok(rows.every((row) => row.before.components[0]!.rawBase === "100.0000"));
      assert.ok(rows.every((row) => row.before.components[0]!.amount === "0.00"));
      assert.deepEqual(preview.impact?.staffWithoutActivity, []);
    } finally {
      mock.timers.reset();
    }
  },
);

/** Each entry is one evidence family the loader can refuse by name. The month is
 * otherwise identical and payable, so only the injected gap can withdraw the money. */
const families = [
  {
    label: "an unknown capture family",
    sourceType: "UNKNOWN_FAMILY",
    code: "SOURCE_WORKFLOW_NOT_LOADED",
  },
  {
    label: "a prepaid refund capture without its settlement",
    sourceType: "PACKAGE_REFUND",
    code: "PREPAID_SETTLEMENT_MISSING",
  },
  {
    label: "a redemption capture whose evidence contradicts itself",
    sourceType: "REDEMPTION",
    code: "SOURCE_EVIDENCE_INVALID",
  },
] as const;

for (const family of families)
  test(
    `CP-003A ${family.label} withholds every monetary total`,
    { skip, timeout: 240_000 },
    async () => {
      const fixture = await payrollCloseFixture(2, true);
      try {
        const plan = await publishedPlan(fixture);
        at("2026-10-05T03:00:00Z");
        const payable = await fixture.scope(() =>
          readPayrollHistoricalPreview(plan.id, plan.revision),
        );
        // The month is payable first, so the refusal below is caused by the gap.
        assert.equal(payable.status, "AVAILABLE", JSON.stringify(payable.blockers));
        assert.equal(payable.impact?.totals.before, "20.00");

        at("2026-09-19T04:00:00Z");
        const sale = await fixture.scope(() => prisma.sale.findFirstOrThrow());
        await fixture.scope(() =>
          prisma.payrollSourceEvent.create({
            data: {
              tenantId: fixture.tenantId,
              sourceKey: `${family.sourceType}:stray-${randomUUID()}`,
              sourceType: family.sourceType,
              sourceId: randomUUID(),
              saleId: sale.id,
              outletId: sale.outletId,
              actorId: fixture.ownerId,
              reason: "Synthetic contradictory capture for acceptance",
              occurredAt: new Date("2026-09-19T04:00:00.000Z"),
              evidence: { version: 1 },
              createdAt: new Date("2026-09-19T04:00:00.000Z"),
            },
          }),
        );

        at("2026-10-05T03:00:00Z");
        const refused = await fixture.scope(() =>
          readPayrollHistoricalPreview(plan.id, plan.revision),
        );
        // Money and gaps stay exclusive: no total, no change, no source label.
        assert.equal(refused.status, "UNAVAILABLE");
        assert.equal(refused.impact, null);
        assert.equal(refused.inputSource, null);
        assert.deepEqual(refused.blockers, [family.code]);
        // The configuration evidence is untouched, so the blocker names the family.
        assert.deepEqual(refused.configuration.blockers, []);
        assert.equal(refused.periodKey, payable.periodKey);
        assert.equal(refused.evidenceInventory.collectionCount, 2);
        assert.equal(
          (await fixture.scope(() => readStoredPayrollClose("2026-09"))).calculation,
          null,
        );
      } finally {
        mock.timers.reset();
      }
    },
  );

test(
  "CP-003A a disabled staff member keeps their posted money",
  { skip, timeout: 240_000 },
  async () => {
    const fixture = await payrollCloseFixture(2, true);
    try {
      const plan = await publishedPlan(fixture);
      const preview = async () => {
        at("2026-10-05T03:00:00Z");
        return fixture.scope(() => readPayrollHistoricalPreview(plan.id, plan.revision));
      };
      // Account status is present-day state, not historical eligibility: a disabled
      // staff member neither loses the month's money nor gains a replacement figure.
      await fixture.scope(() =>
        prisma.user.update({ where: { id: fixture.managerId }, data: { disabled: true } }),
      );
      const live = await preview();
      assert.equal(live.status, "AVAILABLE", JSON.stringify(live.blockers));
      assert.equal(live.impact?.totals.before, "20.00");
      assert.equal(
        live.impact!.rows.find((row) => row.staffId === fixture.managerId)?.disabled,
        true,
      );
      assert.equal(
        live.impact!.rows.find((row) => row.staffId === fixture.ownerId)?.disabled,
        false,
      );
      const rows = assertEqualsPosted(live, await postedMonth(fixture, "2026-09"));

      // The month is now frozen. Re-enabling the account is not restated into the
      // frozen snapshot either: the close keeps the record it was calculated with.
      await fixture.scope(() =>
        prisma.user.update({ where: { id: fixture.managerId }, data: { disabled: false } }),
      );
      const frozen = await preview();
      assert.equal(frozen.inputSource, "FROZEN_CLOSE");
      assert.equal(frozen.impact?.totals.before, "20.00");
      assert.deepEqual(
        frozen.impact!.rows.map((row) => [row.staffId, row.beforeTotal, row.change]),
        rows.map((row) => [row.staffId, row.beforeTotal, row.change]),
      );
      assert.equal(
        frozen.impact!.rows.find((row) => row.staffId === fixture.managerId)?.disabled,
        true,
      );
    } finally {
      mock.timers.reset();
    }
  },
);
