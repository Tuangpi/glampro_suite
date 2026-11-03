import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { payrollImpactTotal, payrollPlanDefinitionSchema } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { payrollCloseFixture } from "../test-support/payroll-close-fixture.js";
import {
  readPayrollConfiguration,
  readPayrollHistoricalPreview,
  savePayrollDraft,
} from "./payroll-configuration.service.js";
import { calculateStoredPayrollClose, readStoredPayrollClose } from "./payroll-close-store.js";

/** Preview money is only trustworthy if it equals the money the close posts for the
 * same authoritative month. This test calculates a real month, then compares. */
test(
  "CP-003A historical preview money equals posted monthly payroll money",
  { skip: process.env.RUN_CP003A_PREVIEW_ACCEPTANCE !== "true" },
  async () => {
    // Real sales on 2026-09-15, published plan assigned from 2026-08-15, opening carry
    // authorized for 2026-09 and configuration audited before the month ended.
    const fixture = await payrollCloseFixture(4, true);
    try {
      mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-05T03:00:00Z") });
      const period = "2026-09";
      const configuration = await fixture.scope(() => readPayrollConfiguration());
      const plan = configuration.plans[0];
      assert.ok(plan, "fixture must publish one plan");
      const auditRows = await fixture.scope(() =>
        prisma.payrollConfigurationEvent.count({ where: { tenantId: fixture.tenantId } }),
      );

      const loaderPreview = await fixture.scope(() =>
        readPayrollHistoricalPreview(plan.id, plan.revision),
      );
      assert.equal(loaderPreview.status, "AVAILABLE", JSON.stringify(loaderPreview.blockers));
      assert.equal(loaderPreview.inputSource, "AUTHORITATIVE_LOADER");
      assert.equal(loaderPreview.periodKey, period);
      assert.equal(loaderPreview.impact?.currency, "SGD");
      // Salary values never leave this boundary, not even inside stored inputs.
      assert.equal(JSON.stringify(loaderPreview).includes("basicSalary"), false);
      const previewRows = loaderPreview.impact?.rows ?? [];
      assert.equal(previewRows.length, 4);
      assert.equal(loaderPreview.impact?.staffWithoutActivity.length, 0);
      assert.ok(previewRows.every((row) => Number(row.beforeTotal) > 0));

      // The month is now calculated with the same loader the preview used.
      const open = await fixture.scope(() => readStoredPayrollClose(period));
      const calculated = await fixture.scope(() =>
        calculateStoredPayrollClose(period, open.revision),
      );
      assert.equal(calculated.status, "CALCULATED");
      const statements = new Map(
        (calculated.calculation?.statements ?? []).map((statement) => [
          statement.staff.id,
          statement,
        ]),
      );
      let postedSum = 0;
      for (const row of previewRows) {
        const statement = statements.get(row.staffId);
        assert.ok(statement, `no posted statement for ${row.staffId}`);
        // Not "close enough": the preview reuses the posted engine result itself.
        assert.deepEqual(row.before, statement.result);
        assert.equal(row.beforeTotal, payrollImpactTotal(statement.result));
        // Same rules before and after, so nothing may move.
        assert.equal(row.change, "0.00");
        assert.deepEqual(row.after, statement.result);
        postedSum += Number(row.beforeTotal);
      }
      assert.equal(Number(loaderPreview.impact?.totals.before), postedSum);
      assert.equal(loaderPreview.impact?.totals.after, loaderPreview.impact?.totals.before);
      assert.equal(loaderPreview.impact?.totals.change, "0.00");
      // The preview hashed the exact snapshot the close then froze.
      assert.equal(loaderPreview.impact?.inputHash, calculated.calculation?.inputHash);

      // A calculated month is the authoritative record: reloading sources could
      // disagree with it, so the frozen calculation wins.
      const frozenPreview = await fixture.scope(() =>
        readPayrollHistoricalPreview(plan.id, plan.revision),
      );
      assert.equal(frozenPreview.inputSource, "FROZEN_CLOSE");
      assert.equal(frozenPreview.impact?.inputHash, calculated.calculation?.inputHash);
      assert.deepEqual(
        frozenPreview.impact?.rows.map((row) => row.beforeTotal),
        previewRows.map((row) => row.beforeTotal),
      );
      assert.deepEqual(frozenPreview.impact?.totals, loaderPreview.impact?.totals);

      // Latest saved rules change the preview, never the posted money.
      const definition = payrollPlanDefinitionSchema.parse(plan.versions[0]!.definition);
      const raised = structuredClone(definition);
      raised.components[0]!.flatRatePct = "12.5";
      const draft = await fixture.scope(() =>
        savePayrollDraft(plan.id, {
          expectedRevision: plan.revision,
          definition: raised,
          effectiveFrom: "2026-11-01",
          reason: "Reviewed synthetic preview rate change",
        }),
      );
      assert.equal(draft.revision, plan.revision + 1);
      await assert.rejects(
        fixture.scope(() => readPayrollHistoricalPreview(plan.id, plan.revision)),
        /changed/,
      );
      const changed = await fixture.scope(() =>
        readPayrollHistoricalPreview(plan.id, draft.revision),
      );
      assert.equal(changed.status, "AVAILABLE", JSON.stringify(changed.blockers));
      assert.equal(changed.impact?.afterVersion.versionNo, 2);
      assert.equal(changed.impact?.afterVersion.status, "DRAFT");
      let changeSum = 0;
      for (const [index, row] of (changed.impact?.rows ?? []).entries()) {
        const posted = previewRows[index]!;
        assert.equal(row.staffId, posted.staffId);
        // Before is still exactly the posted month, even with a draft under review.
        assert.deepEqual(row.before, statements.get(row.staffId)!.result);
        assert.equal(row.beforeTotal, posted.beforeTotal);
        assert.ok(Number(row.afterTotal) > Number(row.beforeTotal));
        const difference =
          Math.round((Number(row.afterTotal) - Number(row.beforeTotal)) * 100) / 100;
        assert.equal(Number(row.change), difference);
        changeSum += difference;
      }
      assert.equal(
        Math.round(Number(changed.impact?.totals.change) * 100) / 100,
        Math.round(changeSum * 100) / 100,
      );

      // Read-only: one reviewed draft save and no payroll close state change.
      assert.equal(
        await fixture.scope(() =>
          prisma.payrollConfigurationEvent.count({ where: { tenantId: fixture.tenantId } }),
        ),
        auditRows + 1,
      );
      const after = await fixture.scope(() => readStoredPayrollClose(period));
      assert.equal(after.revision, calculated.revision);
      assert.equal(after.calculation?.inputHash, calculated.calculation?.inputHash);
    } finally {
      mock.timers.reset();
    }
  },
);
