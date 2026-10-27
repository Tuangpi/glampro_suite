import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocatePayrollSplit,
  calculatePayrollComponent,
  calculatePayrollStaffPeriod,
  comparePayrollMethods,
  evaluatePayrollIncentive,
  hairPayrollExample,
  payrollBaseLineSchema,
  payrollCommissionCurve,
  payrollMonthEnd,
  payrollPlanDefinitionSchema,
  payrollStageSchedule,
  payrollTenureMonth,
  payrollValuePackageSpend,
  previewPayrollImpact,
  resolvePayrollPlan,
  resolvePayrollStage,
  partitionPayrollOutletLines,
  payrollAssignmentSchema,
  tpPayrollExample,
  validatePayrollPlan,
  type PayrollBaseLine,
  type PayrollComponent,
  type PayrollPlanDefinition,
  type PayrollStaffPeriodInput,
  type PayrollPlanVersion,
} from "./index.js";

function component(key = "cash_pkg") {
  return hairPayrollExample().components.find((row) => row.key === key)!;
}
function line(
  id: string,
  commissionType: PayrollBaseLine["commissionType"],
  amount: string,
  extra: Partial<PayrollBaseLine> = {},
): PayrollBaseLine {
  return {
    id,
    staffId: "staff",
    outletId: "outlet-a",
    commissionType,
    baseAmount: amount,
    units: "1",
    businessDate: "2026-09-15",
    status: "EARNED",
    mode: "FOLLOW_PLAN",
    ...extra,
  };
}
function input(
  lines: PayrollBaseLine[] = [],
  definition = hairPayrollExample(),
): PayrollStaffPeriodInput {
  return {
    staffId: "staff",
    periodKey: "2026-09",
    joinDate: "2020-01-01",
    plan: { planId: "hair", versionId: "v1", definition },
    lines,
    groupMetrics: [
      {
        ruleKey: "group_ind",
        periodKey: "2026-09",
        scope: "SALON",
        outletId: null,
        metric: "SALON_CASH",
        amount: "46210",
      },
    ],
  };
}

describe("CP-002 SRS tier/component acceptance", () => {
  it("snapshots unique assignment outlets while retaining legacy company-wide history", () => {
    const assignment = {
      id: "a",
      staffId: "staff",
      planId: "hair",
      fromDate: "2026-09-01",
      toDate: null,
    };
    assert.deepEqual(payrollAssignmentSchema.parse(assignment), assignment);
    assert.equal(
      payrollAssignmentSchema.safeParse({ ...assignment, outletIds: ["a", "a"] }).success,
      false,
    );
    assert.deepEqual(
      payrollAssignmentSchema.parse({ ...assignment, outletIds: ["a", "b"] }).outletIds,
      ["a", "b"],
    );
  });
  it("pools eligible outlets once and separates out-of-scope activity for source-rate fallback", () => {
    const lines = [
      line("a", "SVC", "4000", { outletId: "a", fallbackRatePct: "5" }),
      line("b", "SVC", "7000", { outletId: "b", fallbackRatePct: "5" }),
      line("c", "SVC", "1000", { outletId: "c", fallbackRatePct: "3" }),
    ];
    const original = structuredClone(lines);
    const split = partitionPayrollOutletLines(lines, ["a", "b"]);
    assert.deepEqual(
      split.planLines.map((l) => l.id),
      ["a", "b"],
    );
    assert.deepEqual(
      split.fallbackLines.map((l) => l.id),
      ["c"],
    );
    assert.deepEqual(lines, original);
    const definition = { ...hairPayrollExample(), incentives: [] };
    const planned = input(split.planLines, definition);
    planned.plan!.outletIds = ["a", "b"];
    const result = calculatePayrollStaffPeriod(planned);
    assert.equal(
      result.components.find((c) => c.componentKey === "cash_pkg")!.rawBase,
      "11000.0000",
    );
    assert.equal(result.commissionTotal, "1100.00");
    const fallback = calculatePayrollStaffPeriod({ ...input(split.fallbackLines), plan: null });
    assert.equal(fallback.commissionTotal, "30.00");
    assert.throws(
      () => calculatePayrollStaffPeriod({ ...planned, lines }),
      /Partition out-of-scope/,
    );
    assert.equal(partitionPayrollOutletLines(lines, []).planLines.length, 3);
  });
  it("refuses unknown outlet attribution, duplicate pools and forged scope inputs", () => {
    const unknown = line("unknown", "SVC", "10", { outletId: null });
    assert.throws(() => partitionPayrollOutletLines([unknown], ["a"]), /evidenced outlet/);
    assert.throws(() => partitionPayrollOutletLines([], ["a", "a"]), /Duplicate plan outlets/);
    assert.throws(() => partitionPayrollOutletLines([unknown, unknown], []), /Duplicate base line/);
    assert.equal(partitionPayrollOutletLines([unknown], []).planLines.length, 1);
    assert.equal(
      partitionPayrollOutletLines([{ ...unknown, status: "REVERSED" }], ["a"]).fallbackLines.length,
      1,
    );
  });
  it("partitions fixed awards and refund reversals without duplicate payout or lost debt", () => {
    const lines = [
      line("fixed-in", "PKG_SALE", "100", { outletId: "a", mode: "FIXED", fixedCommission: "10" }),
      line("fixed-out", "PKG_SALE", "100", { outletId: "b", mode: "FIXED", fixedCommission: "15" }),
      line("refund-out", "SVC", "-200", { outletId: "b", fallbackRatePct: "5" }),
    ];
    const partition = partitionPayrollOutletLines(lines, ["a"]);
    const planned = input(partition.planLines, { ...hairPayrollExample(), incentives: [] });
    planned.plan!.outletIds = ["a"];
    const result = calculatePayrollStaffPeriod(planned);
    const fallback = calculatePayrollStaffPeriod({ ...input(partition.fallbackLines), plan: null });
    assert.equal(result.commissionTotal, "10.00");
    assert.equal(fallback.commissionTotal, "15.00");
    assert.equal(fallback.fallbackCarryCommission, "-10.0000000000");
    assert.equal(partition.planLines.length + partition.fallbackLines.length, lines.length);
  });
  it("TC-01 Hair cash + package whole-tier 6830 → 546.40", () => {
    const result = calculatePayrollComponent(component(), "6830");
    assert.equal(result.amount, "546.40");
    assert.equal(result.ratePct, "8");
    assert.equal(result.rawBase, "6830.0000");
    assert.equal(result.gapToNext, "3170.0001");
  });
  it("TC-02 and TC-03 On course whole 628.99 vs slice 488.99", () => {
    assert.equal(calculatePayrollComponent(component("on_course"), "8985.50").amount, "628.99");
    assert.equal(
      calculatePayrollComponent({ ...component("on_course"), method: "TIER_SLICE" }, "8985.50")
        .amount,
      "488.99",
    );
  });
  it("TC-04 exact boundaries and one four-decimal tick above", () => {
    assert.deepEqual(
      ["4000", "4000.01", "6000", "6000.01"].map(
        (base) => calculatePayrollComponent(component(), base).amount,
      ),
      ["0.00", "160.00", "240.00", "480.00"],
    );
    assert.equal(calculatePayrollComponent(component(), "4000.0001").ratePct, "4");
    assert.equal(calculatePayrollComponent(component(), "6000.0001").ratePct, "8");
  });
  it("TC-07 historical TP sales-value package base 9256.31 → 647.94", () => {
    const plan = tpPayrollExample();
    assert.equal(
      calculatePayrollComponent(
        plan.components.find((row) => row.key === "package")!,
        "9256.31",
      ).amount,
      "647.94",
    );
  });
  it("TC-21 same 12000 input gives whole 1200 / slice 600 / mixed 1000", () => {
    assert.deepEqual(
      comparePayrollMethods(component(), "12000").map((row) => row.result.amount),
      ["1200.00", "600.00", "1000.00"],
    );
    const allSlice = {
      ...component(),
      method: "TIER_MIXED" as const,
      bands: component().bands.map((band) => ({ ...band, applyMode: "SLICE" as const })),
    };
    assert.equal(calculatePayrollComponent(allSlice, "12000").amount, "600.00");
  });
  it("TC-22 cap is applied after calculation and is explained", () => {
    const result = calculatePayrollComponent(
      { ...component("on_course"), monthlyCap: "500" },
      "8985.50",
    );
    assert.equal(result.amount, "500.00");
    assert.equal(result.capped, true);
    assert.equal(result.working.at(-1)?.kind, "CAP");
  });
  it("FOC applies base percentage once; zero base percentage is not a default", () => {
    assert.equal(calculatePayrollComponent(component("foc"), "492").amount, "12.30");
    assert.equal(
      calculatePayrollComponent({ ...component("foc"), basePct: "0" }, "492").amount,
      "0.00",
    );
  });
  it("rounds half-up only once after pooling/tier arithmetic", () => {
    assert.equal(
      calculatePayrollComponent({ ...component("product"), flatRatePct: "5" }, "0.1").amount,
      "0.01",
    );
    const result = calculatePayrollStaffPeriod(
      input([line("a", "PRD", "0.025"), line("b", "PRD", "0.025")]),
    );
    assert.equal(result.commissionTotal, "0.01");
    assert.equal(
      calculatePayrollComponent(component(), "999999999999.9999").amount,
      "250000000000.00",
    );
  });
  it("negative base TC-13 carries or writes off explicitly, then offsets next month's pool", () => {
    const result = calculatePayrollComponent(component(), "-500");
    assert.equal(result.amount, "0.00");
    assert.equal(result.carryForwardOut, "-500.0000");
    assert.equal(
      calculatePayrollComponent(component(), "6000", { carryForwardIn: "-500" }).amount,
      "220.00",
    );
    assert.equal(
      calculatePayrollComponent(component(), "-500", { negativeBase: "WRITE_OFF" }).carryForwardOut,
      "0.0000",
    );
  });
  it("fixed-per-unit uses fractional credited units, caps, and negative unit carry", () => {
    const fixed: PayrollComponent = {
      ...component("foc"),
      method: "FIXED_PER_UNIT",
      fixedAmount: "5",
    };
    assert.equal(calculatePayrollComponent(fixed, "0", { units: "0.5" }).amount, "2.50");
    assert.equal(
      calculatePayrollComponent({ ...fixed, monthlyCap: "4" }, "0", { units: "2" }).amount,
      "4.00",
    );
    const result = calculatePayrollComponent(fixed, "0", { units: "-0.5" });
    assert.equal(result.amount, "0.00");
    assert.equal(result.carryUnitsOut, "-0.5000");
    assert.equal(
      calculatePayrollComponent(fixed, "0", { units: "1", carryUnitsIn: result.carryUnitsOut })
        .amount,
      "2.50",
    );
  });
  it("chart uses exact decimal strings and the same component calculator", () => {
    const points = payrollCommissionCurve(component(), "12000", 2);
    assert.deepEqual(
      points.map((row) => row.base),
      ["0.0000", "6000.0000", "12000.0000"],
    );
    assert.equal(points[2].methods[2].result.amount, "1000.00");
    assert.throws(() => payrollCommissionCurve(component(), "100", 0));
  });
});

describe("CP-002 stages and last-day plan selection", () => {
  it("TC-05/06 joined September 10 gives October new and December standard", () => {
    assert.equal(payrollTenureMonth("2026-09-10", "2026-10"), 2);
    assert.equal(payrollTenureMonth("2026-09-10", "2026-12"), 4);
    const plan = hairPayrollExample();
    assert.equal(resolvePayrollStage(plan.stages, 2).key, "new");
    assert.equal(resolvePayrollStage(plan.stages, 4).key, "std");
    for (const [periodKey, amount] of [
      ["2026-10", "144.00"],
      ["2026-12", "0.00"],
    ]) {
      const result = calculatePayrollStaffPeriod({
        ...input([line("a", "SVC", "3600", { businessDate: `${periodKey}-15` })]),
        periodKey,
        joinDate: "2026-09-10",
        groupMetrics: [
          {
            ruleKey: "group_ind",
            periodKey,
            scope: "SALON",
            outletId: null,
            metric: "SALON_CASH",
            amount: "0",
          },
        ],
      });
      assert.equal(result.commissionTotal, amount);
    }
    assert.deepEqual(payrollStageSchedule(plan.stages, "2026-09-10"), [
      { stageKey: "new", from: "2026-09", to: "2026-11" },
      { stageKey: "std", from: "2026-12", to: null },
    ]);
  });
  it("supports explicit stage shortening to zero and delayed join-month counting", () => {
    const stages = hairPayrollExample().stages;
    assert.equal(resolvePayrollStage(stages, 1, 0).key, "std");
    assert.equal(resolvePayrollStage(stages, 4, 5).key, "new");
    assert.equal(payrollTenureMonth("2026-09-20", "2026-09", 15), 0);
    assert.equal(resolvePayrollStage(stages, 0).key, "new");
    assert.equal(payrollStageSchedule(stages, "2026-09-20", 15)[0].from, "2026-10");
  });
  it("does not invent standard-stage history for missing or future join dates", () => {
    assert.throws(() => calculatePayrollStaffPeriod({ ...input(), joinDate: null }), /join date/);
    assert.throws(
      () => calculatePayrollStaffPeriod({ ...input(), joinDate: "2026-10-01" }),
      /precedes employment/,
    );
    const definition = hairPayrollExample();
    definition.stages = [];
    delete definition.components[0].bands[0].stageRates;
    assert.equal(
      calculatePayrollStaffPeriod({ ...input([], definition), joinDate: null }).stageKey,
      "std",
    );
    assert.throws(() => payrollTenureMonth("2026-02-30", "2026-10"));
    assert.throws(() => payrollMonthEnd("2026-13"));
    assert.equal(payrollMonthEnd("2028-02"), "2028-02-29");
  });
  it("TC-14/15 selects last-day assignment and version, ignores drafts, rejects ambiguity", () => {
    const definition = hairPayrollExample();
    const assignments = [
      { id: "a1", staffId: "staff", planId: "old", fromDate: "2020-01-01", toDate: "2026-11-14" },
      { id: "a2", staffId: "staff", planId: "new", fromDate: "2026-11-15", toDate: null },
    ];
    const versions: PayrollPlanVersion[] = [
      {
        id: "v3",
        planId: "new",
        versionNo: 3,
        effectiveFrom: "2026-01-01",
        status: "PUBLISHED",
        definition,
      },
      {
        id: "v4",
        planId: "new",
        versionNo: 4,
        effectiveFrom: "2027-01-01",
        status: "PUBLISHED",
        definition,
      },
      {
        id: "draft",
        planId: "new",
        versionNo: 5,
        effectiveFrom: "2026-11-01",
        status: "DRAFT",
        definition,
      },
    ];
    assert.equal(
      resolvePayrollPlan("staff", "2026-11", assignments, versions)?.assignment.planId,
      "new",
    );
    assert.equal(resolvePayrollPlan("staff", "2026-12", assignments, versions)?.version.id, "v3");
    assert.equal(resolvePayrollPlan("staff", "2027-01", assignments, versions)?.version.id, "v4");
    assert.equal(resolvePayrollPlan("none", "2026-12", assignments, versions), null);
    assert.throws(
      () =>
        resolvePayrollPlan("staff", "2026-12", assignments, [
          ...versions,
          { ...versions[0], id: "duplicate" },
        ]),
      /Ambiguous/,
    );
    assert.throws(
      () =>
        resolvePayrollPlan(
          "staff",
          "2026-12",
          [...assignments, { ...assignments[1], id: "overlap" }],
          versions,
        ),
      /Overlapping/,
    );
    assert.throws(() => resolvePayrollPlan("staff", "2026-12", assignments, []), /no effective/);
  });
});

describe("CP-002 monthly fixtures and special modes", () => {
  it("Alvin new policy is 1187.69; historical already-halved FOC input is separately 1199.99", () => {
    const sources = [
      line("cash", "SVC", "159"),
      line("pkg", "PKG_SALE", "6671"),
      line("red", "PKG_RED", "8985.50"),
      line("foc", "FOC", "492"),
    ];
    assert.equal(calculatePayrollStaffPeriod(input(sources)).commissionTotal, "1187.69");
    // Historical 492 half-base means full list 984, not a change to the policy.
    assert.equal(
      calculatePayrollStaffPeriod(
        input(sources.map((row) => (row.id === "foc" ? { ...row, baseAmount: "984" } : row))),
      ).commissionTotal,
      "1199.99",
    );
  });
  it("Stella historical sales-value vs new cash-collected fixtures remain distinct", () => {
    const sources = [
      line("cash", "SVC", "1087"),
      line("red", "PKG_RED", "12071.84"),
      line("prd", "PRD", "78"),
      line("pkg", "PKG_SALE", "9256.31"),
    ];
    const historical = calculatePayrollStaffPeriod(input(sources, tpPayrollExample()));
    assert.equal(historical.commissionTotal, "1971.62");
    assert.equal(historical.incentiveTotal, "50.00");
    const collected = calculatePayrollStaffPeriod(
      input(
        sources.map((row) => (row.id === "pkg" ? { ...row, baseAmount: "8688" } : row)),
        tpPayrollExample(),
      ),
    );
    assert.equal(collected.commissionTotal, "1931.84");
    assert.equal(collected.incentiveTotal, "0.00");
  });
  it("category snapshots split TP Beauty and other products", () => {
    const result = calculatePayrollStaffPeriod(
      input(
        [
          line("beauty", "PRD", "100", { productCategory: "Beauty" }),
          line("other", "PRD", "100", { productCategory: "Hair" }),
        ],
        tpPayrollExample(),
      ),
    );
    assert.equal(result.components.find((row) => row.componentKey === "beauty")?.amount, "5.00");
    assert.equal(result.components.find((row) => row.componentKey === "product")?.amount, "10.00");
  });
  it("fixed/excluded/reversed lines bypass pools and fixed awards work without a plan", () => {
    const lines = [
      line("a", "PKG_SALE", "10000", { mode: "FIXED", fixedCommission: "25" }),
      line("b", "SVC", "10000", { mode: "EXCLUDE" }),
      line("c", "SVC", "10000", { status: "REVERSED" }),
      line("d", "PRD", "100", { fallbackRatePct: "10" }),
    ];
    assert.equal(calculatePayrollStaffPeriod(input(lines)).commissionTotal, "35.00");
    assert.equal(
      calculatePayrollStaffPeriod({ ...input(lines), plan: null }).commissionTotal,
      "35.00",
    );
    assert.equal(
      calculatePayrollStaffPeriod({
        ...input([line("zero", "PKG_SALE", "1000", { mode: "FIXED", fixedCommission: "0" })]),
        plan: null,
      }).commissionTotal,
      "0.00",
    );
    assert.equal(
      calculatePayrollStaffPeriod({
        ...input([line("neg", "PKG_SALE", "-500", { mode: "FIXED", fixedCommission: "-5" })]),
        plan: null,
      }).commissionTotal,
      "-5.00",
    );
  });
  it("fallback consumes evidenced resolved rates, not fabricated defaults", () => {
    assert.throws(
      () => calculatePayrollStaffPeriod({ ...input([line("a", "SVC", "100")]), plan: null }),
      /rate evidence/,
    );
    const result = calculatePayrollStaffPeriod({
      ...input([
        line("a", "SVC", "100", { fallbackRatePct: "8" }),
        line("b", "SVC", "50", { fallbackRatePct: "2" }),
      ]),
      plan: null,
    });
    assert.equal(result.commissionTotal, "9.00");
  });
  it("rejects duplicate, wrong-staff and wrong-month bases instead of silently dropping evidence", () => {
    const a = line("a", "SVC", "100");
    assert.throws(() => calculatePayrollStaffPeriod(input([a, a])), /Duplicate/);
    assert.throws(
      () => calculatePayrollStaffPeriod(input([{ ...a, staffId: "foreign" }])),
      /belong/,
    );
    assert.throws(
      () => calculatePayrollStaffPeriod(input([{ ...a, businessDate: "2026-10-01" }])),
      /belong/,
    );
  });
  it("removed-component carry requires explicit mapping or write-off; mapping preserves amount", () => {
    const source = input([line("a", "SVC", "6000")]);
    source.carryForward = [{ componentKey: "old", base: "-500", units: "0" }];
    assert.throws(() => calculatePayrollStaffPeriod(source), /explicit mapping/);
    const mapped = calculatePayrollStaffPeriod({
      ...source,
      carryResolutions: [{ fromKey: "old", toKey: "cash_pkg", reason: "Plan replacement" }],
    });
    assert.equal(mapped.commissionTotal, "220.00");
    const writtenOff = calculatePayrollStaffPeriod({
      ...source,
      carryResolutions: [{ fromKey: "old", toKey: null, reason: "Approved write-off" }],
    });
    assert.equal(writtenOff.commissionTotal, "240.00");
    assert.equal(writtenOff.carryWriteOffs[0].base, "-500.0000");
    assert.throws(() =>
      calculatePayrollStaffPeriod({
        ...source,
        carryResolutions: [{ fromKey: "old", toKey: null, reason: "" }],
      }),
    );
    assert.throws(
      () =>
        calculatePayrollStaffPeriod({
          ...input(),
          carryForward: [{ componentKey: "cash_pkg", base: "0", units: "-1" }],
        }),
      /Unit carry/,
    );
  });
  it("TC-23/25 impact preview equals a full draft run and delta is -140", () => {
    const source = input([line("red", "PKG_RED", "8985.50")]);
    const draft = hairPayrollExample();
    draft.components.find((row) => row.key === "on_course")!.method = "TIER_SLICE";
    const beforeJson = JSON.stringify(source);
    const preview = previewPayrollImpact([source], draft);
    assert.equal(preview.totalChange, "-140.00");
    assert.deepEqual(
      preview.rows[0].after,
      calculatePayrollStaffPeriod({ ...source, plan: { ...source.plan!, definition: draft } }),
    );
    assert.equal(JSON.stringify(source), beforeJson);
  });
});

describe("CP-002 incentive scope and metrics", () => {
  it("TC-08 highest target row is noncumulative and is based on exact thresholds", () => {
    const rule = tpPayrollExample().incentives[0];
    assert.equal(evaluatePayrollIncentive(rule, "10421.31", null).amount, "50.00");
    assert.equal(evaluatePayrollIncentive(rule, "9853", null).amount, "0.00");
    assert.equal(evaluatePayrollIncentive(rule, "16000", null).amount, "150.00");
    assert.equal(evaluatePayrollIncentive(rule, "9999.9999", null).amount, "0.00");
  });
  it("group incentives require matching external collection metrics, not a sum of split bases", () => {
    const source = input([line("a", "SVC", "15500")]);
    assert.equal(calculatePayrollStaffPeriod(source).incentiveTotal, "200.00");
    assert.throws(
      () => calculatePayrollStaffPeriod({ ...source, groupMetrics: [] }),
      /authoritative/,
    );
    assert.throws(
      () =>
        calculatePayrollStaffPeriod({
          ...source,
          groupMetrics: [{ ...source.groupMetrics![0], metric: "SUM_INDIVIDUAL" }],
        }),
      /authoritative/,
    );
    assert.throws(
      () =>
        calculatePayrollStaffPeriod({
          ...source,
          groupMetrics: [{ ...source.groupMetrics![0], periodKey: "2026-10" }],
        }),
      /mismatch/,
    );
  });
  it("outlet incentive pools cannot combine individual sales across branches", () => {
    const plan = hairPayrollExample();
    plan.incentives[0].scope = "OUTLET";
    const source = input(
      [line("a", "SVC", "8000"), line("b", "SVC", "8000", { outletId: "outlet-b" })],
      plan,
    );
    source.groupMetrics = ["outlet-a", "outlet-b"].map((outletId) => ({
      ruleKey: "group_ind",
      periodKey: source.periodKey,
      scope: "OUTLET",
      outletId,
      metric: "SALON_CASH",
      amount: "50000",
    }));
    assert.equal(calculatePayrollStaffPeriod(source).incentiveTotal, "0.00");
    assert.equal(calculatePayrollStaffPeriod(source).incentives.length, 2);
    assert.throws(
      () =>
        calculatePayrollStaffPeriod({
          ...source,
          lines: [line("null", "SVC", "15500", { outletId: null })],
        }),
      /evidenced outlet/,
    );
  });
  it("incentive metric counts activity independently of plan exclusions/fixed awards", () => {
    const source = input([line("a", "PKG_SALE", "15500", { mode: "EXCLUDE" })]);
    assert.equal(calculatePayrollStaffPeriod(source).commissionTotal, "0.00");
    assert.equal(calculatePayrollStaffPeriod(source).incentiveTotal, "200.00");
  });
});

describe("CP-002 exact allocation and ratio residuals", () => {
  const shares = [
    { staffId: "b", share: 3333 },
    { staffId: "c", share: 3334 },
    { staffId: "a", share: 3333 },
  ];
  it("split totals and negative reversals are exact and deterministic", () => {
    const parts = allocatePayrollSplit("1000.01", shares);
    const ticks = parts.reduce((sum, part) => sum + BigInt(part.amount.replace(".", "")), 0n);
    assert.equal(ticks, 10000100n);
    assert.deepEqual(allocatePayrollSplit("1000.01", [...shares].reverse()), parts);
    const reversed = allocatePayrollSplit("-1000.01", shares);
    assert.deepEqual(
      reversed.map((row) => row.amount),
      parts.map((row) => `-${row.amount}`),
    );
    assert.throws(() => allocatePayrollSplit("10", [{ staffId: "a", share: 6000 }]));
    assert.throws(() =>
      allocatePayrollSplit("10", [
        { staffId: "a", share: 5000 },
        { staffId: "a", share: 5000 },
      ]),
    );
  });
  it("fixed unit split does not award each employee a whole unit", () => {
    const parts = allocatePayrollSplit("1", [
      { staffId: "a", share: 5000 },
      { staffId: "b", share: 5000 },
    ]);
    const fixed: PayrollComponent = {
      ...component("foc"),
      method: "FIXED_PER_UNIT",
      fixedAmount: "5",
    };
    assert.deepEqual(
      parts.map((row) => calculatePayrollComponent(fixed, "0", { units: row.amount }).amount),
      ["2.50", "2.50"],
    );
  });
  it("TC-17 cumulative value-package ratio absorbs final residual", () => {
    assert.equal(payrollValuePackageSpend("500", "600", "0", "100"), "83.3333");
    const bases = Array.from({ length: 6 }, (_, i) =>
      payrollValuePackageSpend("500", "600", String(i * 100), "100"),
    );
    assert.equal(
      bases.reduce((sum, value) => sum + BigInt(value.replace(".", "")), 0n),
      5000000n,
    );
    assert.throws(() => payrollValuePackageSpend("500", "0", "0", "100"));
    assert.throws(() => payrollValuePackageSpend("500", "600", "590", "20"));
  });
});

describe("CP-002 plan and number validation", () => {
  it("safeParse reports malformed nested numbers instead of throwing arithmetic errors", () => {
    for (const invalid of ["NaN", "Infinity", "1e3", "", "0.00001", "-1"]) {
      const plan = hairPayrollExample();
      plan.components[0].bands[0].upperLimit = invalid;
      assert.equal(payrollPlanDefinitionSchema.safeParse(plan).success, false);
      const incentivePlan = hairPayrollExample();
      incentivePlan.incentives[0].rows[0].individualTarget = invalid;
      assert.equal(payrollPlanDefinitionSchema.safeParse(incentivePlan).success, false);
    }
  });
  it("fallback negative earnings carry exact source-rate debt without repricing", () => {
    const source = {
      ...input([line("refund", "SVC", "-0.0001", { fallbackRatePct: "0.0001" })]),
      plan: null,
    };
    const first = calculatePayrollStaffPeriod(source);
    assert.equal(first.commissionTotal, "0.00");
    assert.equal(first.fallbackCarryCommission, "-0.0000000001");
    const next = calculatePayrollStaffPeriod({
      ...source,
      lines: [line("earning", "SVC", "0.1", { fallbackRatePct: "5" })],
      fallbackCarryCommission: first.fallbackCarryCommission,
    });
    assert.equal(next.commissionTotal, "0.00");
    assert.equal(next.fallbackCarryCommission, "0.0000000000");
    assert.equal(
      calculatePayrollStaffPeriod({ ...source, negativeBase: "WRITE_OFF" }).fallbackCarryCommission,
      "0.0000000000",
    );
    assert.throws(
      () =>
        calculatePayrollStaffPeriod({
          ...input(),
          fallbackCarryCommission: first.fallbackCarryCommission,
        }),
      /explicit settlement/,
    );
  });
  it("rejects invalid carry and group contracts even through untyped callers", () => {
    assert.throws(
      () =>
        calculatePayrollStaffPeriod({
          ...input(),
          carryForward: [{ componentKey: "cash_pkg", base: "1", units: "0" }],
        }),
      /positive/,
    );
    assert.throws(
      () => calculatePayrollComponent(component(), "100", { carryUnitsIn: "-1" }),
      /unit carry/,
    );
    assert.throws(() =>
      calculatePayrollStaffPeriod({
        ...input(),
        groupMetrics: [{ ...input().groupMetrics![0], scope: "FOREIGN" as "SALON" }],
      }),
    );
  });
  it("TC-24 decreasing bands fail validation; seed plans pass with whole-tier warnings", () => {
    const plan = hairPayrollExample();
    assert.deepEqual(validatePayrollPlan(plan).errors, []);
    assert.ok(validatePayrollPlan(plan).warnings.some((warning) => warning.includes("7000.0000")));
    plan.components[0].bands[1].upperLimit = "3000";
    assert.ok(validatePayrollPlan(plan).errors.length);
  });
  it("rejects invalid decimal strings, floats, percent ranges and missing method fields", () => {
    for (const base of ["NaN", "Infinity", "1e3", "", " 1", "01", "0.00001", "1000000000000", 1])
      assert.throws(() => calculatePayrollComponent(component(), base as string), String(base));
    for (const rate of ["-1", "101", "NaN"])
      assert.equal(
        payrollPlanDefinitionSchema.safeParse({
          ...hairPayrollExample(),
          components: [{ ...component("product"), flatRatePct: rate }],
        }).success,
        false,
      );
    assert.equal(
      payrollBaseLineSchema.safeParse({ ...line("a", "SVC", "1"), units: 1 }).success,
      false,
    );
    assert.equal(
      payrollBaseLineSchema.safeParse({ ...line("a", "SVC", "1"), fixedCommission: "5" }).success,
      false,
    );
    const plan = hairPayrollExample();
    delete plan.components[1].flatRatePct;
    assert.ok(validatePayrollPlan(plan).errors.length);
  });
  it("rejects stage gaps/overlaps, unknown overrides, reserved and duplicate component keys", () => {
    const bad: PayrollPlanDefinition[] = [];
    const gap = hairPayrollExample();
    gap.stages[1].fromMonth = 5;
    bad.push(gap);
    const overlap = hairPayrollExample();
    overlap.stages[1].fromMonth = 3;
    bad.push(overlap);
    const unknown = hairPayrollExample();
    unknown.components[0].bands[0].stageRates = { missing: "5" };
    bad.push(unknown);
    const duplicate = hairPayrollExample();
    duplicate.components.push(duplicate.components[0]);
    bad.push(duplicate);
    const reserved = hairPayrollExample();
    reserved.components[0].key = "package_fixed";
    bad.push(reserved);
    const cappedEnd = hairPayrollExample();
    cappedEnd.components[0].bands.at(-1)!.upperLimit = "25000";
    bad.push(cappedEnd);
    for (const plan of bad) assert.ok(validatePayrollPlan(plan).errors.length);
  });
});
