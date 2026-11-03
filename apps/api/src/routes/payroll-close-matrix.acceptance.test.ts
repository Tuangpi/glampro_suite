import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { payrollPlanDefinitionSchema, type PayrollStatement } from "@glampro_suite/shared";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { signAccessToken } from "../lib/tokens.js";
import { payrollCloseFixture } from "../test-support/payroll-close-fixture.js";
import { payrollInputHash } from "../services/payroll-close-state.js";

const methods = ["FLAT", "TIER_WHOLE", "TIER_SLICE", "TIER_MIXED", "FIXED_PER_UNIT"] as const;
// Independent hand arithmetic at 20 receipts x SGD 100, not calculator-derived expectations:
// flat 10%; whole 2000 x 12%; slice 500 x 3% + 500 x 6% + 1000 x 12%;
// mixed 1000 x 6% + 1000 x 12%; fixed 20 units x 3.25.
const expected = ["200.00", "240.00", "165.00", "180.00", "65.00"];
const newStarterExpected = ["200.00", "160.00", "110.00", "120.00", "65.00"];
const plans = methods.map((method) =>
  payrollPlanDefinitionSchema.parse({
    stages: [
      { key: "new", name: "New", fromMonth: 1, toMonth: 12 },
      { key: "senior", name: "Senior", fromMonth: 13, toMonth: null },
    ],
    components: [
      {
        key: "service",
        name: "Service commission",
        sort: 1,
        commissionTypes: ["SVC"],
        basePct: "100",
        method,
        flatRatePct: "10",
        fixedAmount: "3.25",
        bands: method.startsWith("TIER_")
          ? [
              {
                upperLimit: "500",
                ratePct: "1",
                stageRates: { new: "2", senior: "3" },
                applyMode: "SLICE",
              },
              {
                upperLimit: "1000",
                ratePct: "2",
                stageRates: { new: "4", senior: "6" },
                applyMode: "WHOLE",
              },
              {
                upperLimit: null,
                ratePct: "3",
                stageRates: { new: "8", senior: "12" },
                applyMode: "SLICE",
              },
            ]
          : [],
      },
      {
        key: "bonus",
        name: "Supplemental capped commission",
        sort: 2,
        commissionTypes: ["SVC"],
        basePct: "50",
        method: "FLAT",
        flatRatePct: "1",
        monthlyCap: "7.50",
        bands: [],
      },
    ],
    incentives: [
      {
        key: "target",
        name: "Collection target",
        type: "GROUP_AND_INDIVIDUAL",
        individualMetricTypes: ["SVC"],
        groupMetric: "SALON_CASH",
        scope: "SALON",
        rows: [
          { individualTarget: "1000", groupTarget: "50000", amount: "25" },
          { individualTarget: "2000", groupTarget: "100000", amount: "50" },
        ],
      },
    ],
  }),
);

test(
  "M5 mounted money matrix and representative 50-staff/1000-receipt/five-plan monthly volume",
  {
    skip: process.env.RUN_CP005_ACCEPTANCE !== "true",
    timeout: 180000,
  },
  async (t) => {
    const f = await payrollCloseFixture(50, true, {
      plans,
      receiptsPerStaff: 20,
      alternateNewStarters: true,
    });
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/payroll-close/2026-09`;
    const token = (id: string, globalRole: "SUPER_ADMIN" | "MANAGER") =>
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
    const request = async (path = "", body?: unknown, bearer = owner) => {
      const response = await fetch(root + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      assert.equal(response.status, 200, await response.clone().text());
      return (await response.json()).data;
    };
    try {
      assert.equal(await f.scope(() => prisma.salePayment.count()), 1000);
      assert.equal(await f.scope(() => prisma.payrollPlanVersion.count()), 5);
      const timings: number[] = [];
      for (let revision = 0; revision < 3; revision++) {
        const started = performance.now();
        const draft = await request("/calculate", { expectedRevision: revision }, manager);
        const elapsed = performance.now() - started;
        timings.push(elapsed);
        assert.ok(
          elapsed < 10000,
          `Monthly HTTP calculation exceeded 10 seconds: ${elapsed.toFixed(1)}ms`,
        );
        assert.equal(draft.revision, revision + 1);
        assert.equal(draft.calculation.statements.length, 50);
        assert.equal(draft.calculation.inputs, undefined);
        for (const [index, id] of f.ids.entries()) {
          const row: PayrollStatement = draft.calculation.statements.find(
            (s: PayrollStatement) => s.staff.id === id,
          );
          assert.equal(row.inputs, undefined);
          assert.equal(row.payroll.takeHome, undefined);
          assert.equal(row.payroll.payrollSalesPct, undefined);
          assert.equal(row.result.stageKey, index % 2 ? "new" : "senior");
          assert.equal(row.result.components[0].method, methods[index % methods.length]);
          assert.equal(
            row.result.components[0].amount,
            (index % 2 ? newStarterExpected : expected)[index % expected.length],
          );
          assert.equal(row.result.components[0].rawBase, "2000.0000");
          assert.equal(row.result.components[0].units, "20.0000");
          assert.ok(row.result.components[0].working.length >= 2);
          assert.equal(row.result.components[1].amount, "7.50");
          assert.equal(row.result.components[1].capped, true);
          assert.equal(row.payroll.incentive, "50.00");
          assert.equal(row.payroll.collection, "2000.0000");
        }
      }
      t.diagnostic(
        `50 staff, 1000 real receipts, 5 active plan versions, 10 components, 2 tenure stages/plan, 3 bands/tier component, salon-cash incentives; monthly real HTTP/default-loader samples ms: ${timings.map((n) => n.toFixed(1)).join(", ")}; setup excluded; not MTD or production sizing`,
      );
      let revision = 3;
      for (const [kind, amount] of [
        ["UNPAID_LEAVE", "10.10"],
        ["OVERTIME", "20.20"],
        ["ADDITION", "30.30"],
        ["DEDUCTION", "4.40"],
        ["COMMISSION_ADJ", "-5.50"],
      ] as const) {
        const saved = await request(
          "/adjustments",
          {
            expectedRevision: revision++,
            adjustment: {
              id: `m5-${kind}`,
              staffId: f.ownerId,
              kind,
              amount,
              reason: `Reviewed matrix ${kind}`,
            },
          },
          manager,
        );
        assert.equal(saved.adjustments.at(-1).actorId, f.managerId);
        assert.equal(saved.adjustments.at(-1).reason, `Reviewed matrix ${kind}`);
      }
      await request("/calculate", { expectedRevision: revision++ }, manager);
      const reviewed = await request();
      const target: PayrollStatement = reviewed.calculation.statements.find(
        (s: PayrollStatement) => s.staff.id === f.ownerId,
      );
      assert.deepEqual(target.payroll, {
        basicSalary: "2000.00",
        fixedOvertime: "0.00",
        levy: "100.00",
        unpaidLeave: "10.10",
        commission: "202.00",
        incentive: "50.00",
        overtime: "20.20",
        additions: "30.30",
        deductions: "4.40",
        takeHome: "2288.00",
        collection: "2000.0000",
        payrollSalesPct: "119.40",
        alert: true,
      });
      assert.equal(target.result.commissionTotal, "207.50");
      assert.equal(reviewed.adjustments.length, 5);
      const frozen = await request("/approve", {
        expectedRevision: revision++,
        reason: "Reviewed final M5 money matrix",
      });
      const hash = payrollInputHash(frozen.calculation);
      assert.equal(payrollInputHash((await request()).calculation), hash);
      const events = await f.scope(() => prisma.payrollCloseEvent.count());
      const refused = await fetch(root + "/calculate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${owner}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expectedRevision: revision }),
      });
      assert.equal(refused.status, 409);
      assert.equal(await f.scope(() => prisma.payrollCloseEvent.count()), events);
      assert.equal(events, 10);
      assert.equal(payrollInputHash((await request()).calculation), hash);
      assert.equal(await f.scope(() => prisma.salePayment.count()), 1000);
      assert.equal(await f.scope(() => prisma.employeeCommission.count()), 0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.$disconnect();
    }
  },
);
