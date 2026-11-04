import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { createApp } from "../app.js";
import { signAccessToken } from "../lib/tokens.js";
import { payrollCloseFixture } from "../test-support/payroll-close-fixture.js";

/**
 * NFR-03 release budget, measured on one dataset rather than two.
 *
 * The budget has two halves — a 50-staff month must **close** in under 10 seconds and
 * month-to-date progress must **answer** in under 500 milliseconds — and the second half
 * is only meaningful on a month a manager is actually looking at, so both are measured
 * here, over real receipts, through the mounted HTTP surface with the default loader.
 * Asserting them together is what stops the MTD figure from being evidenced on an empty
 * month (where `NOT_CALCULATED` short-circuits to no rows at all) or the close figure from
 * being evidenced on a month nobody can then read.
 *
 * Dataset: 50 staff, 20 real receipts each (1,000 sales through `createSale`), one flat
 * ten percent plan, September 2026, UTC server and Asia/Singapore salon month. Setup time
 * is excluded from every sample; the samples are wall clock around a single `fetch`, so
 * they include HTTP, authentication, tenant scoping and the database round trip.
 *
 * This is local synthetic evidence on a developer machine, not production sizing: it
 * proves the budget is met by the code path, not that a given host will meet it. Gated on
 * `RUN_CP007_PERFORMANCE=true` plus the disposable database the other payroll acceptance
 * suites use.
 */
const MONTH_CLOSE_BUDGET_MS = 10_000;
const MONTH_TO_DATE_BUDGET_MS = 500;

test(
  "NFR-03 fifty-staff month closes under 10 s and month-to-date answers under 500 ms",
  { skip: process.env.RUN_CP007_PERFORMANCE !== "true", timeout: 300_000 },
  async (t) => {
    const f = await payrollCloseFixture(50, true, { receiptsPerStaff: 20 });
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/payroll-close`;
    const manager = signAccessToken({
      id: f.managerId,
      email: `${f.managerId}@example.test`,
      globalRole: "MANAGER",
      tenantId: f.tenantId,
      realm: "web",
      tokenVersion: 0,
    }).token;
    /** One round trip, timed, with the envelope unwrapped — a failure shows the body. */
    const timed = async <T>(path: string, body?: unknown): Promise<[T, number]> => {
      const started = performance.now();
      const response = await fetch(root + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${manager}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const elapsed = performance.now() - started;
      assert.equal(response.status, 200, await response.clone().text());
      return [(await response.json()).data as T, elapsed];
    };

    try {
      const closeSamples: number[] = [];
      for (let revision = 0; revision < 2; revision++) {
        const [view, elapsed] = await timed<{
          revision: number;
          calculation: { statements: { staff: { id: string } }[] };
        }>(`/2026-09/calculate`, { expectedRevision: revision });
        closeSamples.push(elapsed);
        assert.ok(
          elapsed < MONTH_CLOSE_BUDGET_MS,
          `monthly close exceeded 10 s: ${elapsed.toFixed(1)}ms`,
        );
        assert.equal(view.calculation.statements.length, 50);
      }

      // The month now holds a stored calculation, so month-to-date has something to show:
      // this is the read a manager or the POS actually performs mid-month.
      //
      // One warm-up call is excluded and reported separately, so the ten samples below
      // measure the read rather than the first-touch compilation of this route and its
      // projection. It is reported as `monthToDateWarmUpMs` rather than dropped silently.
      const [warmUpProgress, warmUpMs] = await timed<{ totals: { staff: number } }>(
        `/progress?period=2026-09`,
      );
      assert.equal(warmUpProgress.totals.staff, 50);
      const progressSamples: number[] = [];
      for (let sample = 0; sample < 10; sample++) {
        const [progress, elapsed] = await timed<{
          periodKey: string;
          basis: string;
          estimated: boolean;
          scope: string;
          rows: Record<string, unknown>[];
          totals: { staff: number };
        }>(`/progress?period=2026-09`);
        progressSamples.push(elapsed);
        assert.equal(progress.periodKey, "2026-09");
        assert.equal(progress.basis, "ESTIMATED");
        assert.equal(progress.estimated, true);
        assert.equal(progress.scope, "SALON");
        assert.equal(progress.totals.staff, 50);
        // 50 staff x 20 receipts x SGD 100 = 2,000.0000 base each, 100,000.0000 pooled.
        assert.deepEqual(
          progress.rows.map((row) => row.baseAmount),
          Array.from({ length: 50 }, () => "2000.0000"),
        );
        assert.deepEqual(
          progress.rows.map((row) => row.commission),
          Array.from({ length: 50 }, () => "200.00"),
        );
        // Salary never crosses this boundary, so the projection cannot carry it.
        assert.equal("takeHome" in progress.rows[0]!, false);
        assert.equal("basicSalary" in progress.rows[0]!, false);
      }
      const report = (samples: number[]) => samples.map((sample) => sample.toFixed(1)).join(", ");
      for (const [index, elapsed] of progressSamples.entries()) {
        assert.ok(
          elapsed < MONTH_TO_DATE_BUDGET_MS,
          // Every request is budgeted, so one slow sample fails the case — but a bare
          // number hides whether this was a lone outlier or a systematic miss.
          `month-to-date read ${index + 1} exceeded 500 ms: ${elapsed.toFixed(1)}ms ` +
            `(warm-up ${warmUpMs.toFixed(1)}ms; all samples [${report(progressSamples)}])`,
        );
      }

      t.diagnostic(
        JSON.stringify({
          dataset: "50 staff, 1000 real receipts, September 2026, Asia/Singapore",
          monthCloseMs: closeSamples.map((sample) => Number(sample.toFixed(1))),
          monthCloseBudgetMs: MONTH_CLOSE_BUDGET_MS,
          monthToDateWarmUpMs: Number(warmUpMs.toFixed(1)),
          monthToDateMs: progressSamples.map((sample) => Number(sample.toFixed(1))),
          monthToDateBudgetMs: MONTH_TO_DATE_BUDGET_MS,
          note: "Real HTTP and default loader; setup and one warm-up call excluded. Local synthetic evidence, not production sizing.",
        }),
      );
    } finally {
      server.close();
      await once(server, "close");
    }
  },
);
