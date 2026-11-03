import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { payrollPlanDefinitionSchema } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { signAccessToken } from "../lib/tokens.js";
import { createApp } from "../app.js";
import { Browser } from "../test-support/chrome-browser.js";
import { payrollCloseFixture } from "../test-support/payroll-close-fixture.js";
import { readPayrollConfiguration, savePayrollDraft } from "./payroll-configuration.service.js";
import { calculateStoredPayrollClose, readStoredPayrollClose } from "./payroll-close-store.js";
import { payrollPreviewWindow } from "./payroll-preview-inputs.js";

/** Opt-in: needs Chrome, Vite and a disposable payroll database. */
const skip = process.env.RUN_CP003A_BROWSER_ACCEPTANCE !== "true";

/** The reviewed month is the last completed salon month, exactly as the API decides
 * it: the fixture is built for that month so the browser sees real time. */
const TIME_ZONE = "Asia/Singapore";
const PERIOD = payrollPreviewWindow(TIME_ZONE, new Date()).periodKey;
/** Four staff, one hundred-dollar service each, ten percent flat: the month posts
 * forty. Raising the rate to 12.5 percent would post fifty. */
const POSTED = "S$40.00";
const RAISED = "S$50.00";

test(
  "CP-003A browser shows exact preview money and withdraws it when it can no longer be trusted",
  { skip, timeout: 300_000 },
  async (t) => {
    assert.ok(
      env.corsOrigins.includes("http://127.0.0.1:55173"),
      "Set CORS_ORIGINS=http://127.0.0.1:55173 for browser write acceptance",
    );
    const directory = await mkdtemp(join(tmpdir(), "cp003a-chrome-"));
    const browser = new Browser(directory);
    const server = createApp().listen(0, "127.0.0.1");
    let vite: ChildProcess | undefined;
    try {
      await once(server, "listening");
      const apiRoot = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const probe = createServer();
      probe.listen(55173, "127.0.0.1");
      await once(probe, "listening");
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      const root = fileURLToPath(new URL("../../../../", import.meta.url));
      vite = spawn(
        process.execPath,
        [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "55173"],
        {
          cwd: join(root, "apps/web"),
          env: { ...process.env, VITE_PROXY_TARGET: apiRoot, VITE_API_URL: "/api" },
          stdio: "ignore",
        },
      );
      const origin = "http://127.0.0.1:55173";
      // A real month through the real till: sales, collections, published plan and
      // assignment audits, all before the clock is frozen below.
      const fixture = await payrollCloseFixture(4, true, { periodKey: PERIOD });
      const ownerId = fixture.ownerId;
      const tenant = await fixture.scope(() =>
        prisma.tenant.findUniqueOrThrow({
          where: { id: fixture.tenantId },
          select: { timeZone: true },
        }),
      );
      // The month above is only the salon's last completed month under this time zone.
      assert.equal(tenant.timeZone, TIME_ZONE);
      const plan = await fixture.scope(async () => (await readPayrollConfiguration()).plans[0]!);
      assert.equal(plan.versions.length, 1);

      for (let attempt = 0; ; attempt++) {
        try {
          if ((await fetch(origin)).ok) break;
        } catch {
          /* Wait for local Vite startup. */
        }
        assert.ok(attempt < 100, "Local Vite failed to start");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      await browser.start();
      const scriptIdOf: { script?: string } = {};
      const text = (value: string) => `document.body.innerText.includes(${JSON.stringify(value)})`;
      const button = (label: string) =>
        `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
      const click = async (label: string) => {
        await browser.wait(`${button(label)} && !${button(label)}.disabled`);
        await browser.evaluate(`${button(label)}.click()`);
      };
      const field = (label: string) =>
        `document.getElementById([...document.querySelectorAll('label')].find(l => l.textContent.trim() === ${JSON.stringify(label)})?.htmlFor)`;
      const selectPlan = async () => {
        const select = field("Commission plan");
        await browser.wait(`${select}?.querySelector('option[value="${plan.id}"]')`);
        await browser.evaluate(
          `${select}.value = ${JSON.stringify(plan.id)}; ${select}.dispatchEvent(new Event('change', {bubbles: true}))`,
        );
        await browser.wait(`${select}.value === ${JSON.stringify(plan.id)}`);
      };
      const open = async (id = ownerId) => {
        if (scriptIdOf.script) {
          await browser.send("Page.removeScriptToEvaluateOnNewDocument", {
            identifier: scriptIdOf.script,
          });
          scriptIdOf.script = undefined;
        }
        const token = signAccessToken({
          id,
          email: `${id}@example.test`,
          globalRole: id === ownerId ? "SUPER_ADMIN" : "MANAGER",
          realm: "web",
          tokenVersion: 0,
          tenantId: fixture.tenantId,
        }).token;
        const marker = randomUUID();
        const script = await browser.send("Page.addScriptToEvaluateOnNewDocument", {
          source: `localStorage.clear(); sessionStorage.clear(); sessionStorage.setItem('cp003a-navigation', ${JSON.stringify(marker)}); localStorage.setItem('glampro.accessToken', ${JSON.stringify(token)}); localStorage.setItem('glampro.refreshToken', 'synthetic-bootstrap-only');`,
        });
        scriptIdOf.script = String(script.identifier);
        await browser.send("Page.navigate", { url: `${origin}/settings?section=team` });
        await browser.wait(
          `sessionStorage.getItem('cp003a-navigation') === ${JSON.stringify(marker)}`,
        );
        await browser.wait(text("Versioned commission plans"));
        await selectPlan();
      };
      const previewStatus = (revision: number) =>
        browser.evaluate(
          `fetch('/api/payroll-configuration/plans/${plan.id}/historical-preview?expectedRevision=${revision}', {headers: {Authorization: 'Bearer ' + localStorage.getItem('glampro.accessToken')}}).then(r => r.status)`,
        );
      /** Only the result region counts: the panel always shows its own static copy. */
      const resultShown = async () => {
        const inner = (await browser.evaluate(
          `document.querySelector('section[aria-label="Historical payroll input readiness"]')?.innerText ?? ""`,
        )) as string;
        const start = inner.indexOf("Calendar month:");
        return start === -1 ? "" : inner.slice(start);
      };

      await t.test(
        "owner sees posted money, its exact source and every staff amount",
        async (sub) => {
          await open();
          assert.equal(await resultShown(), "");
          await click("Check historical inputs");
          // Diagnose a refusal with the server's own words instead of a bare timeout.
          await browser.wait(
            `${text(`Calendar month: ${PERIOD}`)} || ${text("Unable to check historical inputs.")}`,
          );
          const panel = (await browser.evaluate(
            `document.querySelector('section[aria-label="Historical payroll input readiness"]')?.innerText ?? ""`,
          )) as string;
          // A refusal is reported with the server's own words instead of a bare timeout.
          if (panel.includes("Unable to check historical inputs."))
            sub.diagnostic(panel.replace(/\s+/g, " ").slice(0, 2000));
          assert.equal(panel.includes("Unable to check historical inputs."), false);
          await browser.wait(text(`Calendar month: ${PERIOD}`));
          const shown = await resultShown();
          // The posted month is money, not a readiness verdict: totals and rows appear.
          assert.match(shown, /Historical commission impact/);
          assert.equal(shown.includes(`Posted ${PERIOD} commission: ${POSTED}`), true);
          assert.match(shown, /with version 1 \(PUBLISHED/);
          assert.match(shown, /change S\$0\.00/);
          assert.match(shown, /Money source: authoritative inputs, not yet frozen by a close\./);
          assert.equal(
            shown.includes(`Commission and incentive per staff member for ${PERIOD}`),
            true,
          );
          assert.match(shown, /Salon total/);
          // Four staff at ten dollars each, and the change is zero because nothing moved.
          assert.equal((shown.match(/S\$10\.00/g) ?? []).length >= 4, true);
          assert.equal(shown.includes("Historical impact unavailable"), false);
          assert.equal(shown.includes("this check records nothing"), true);
          assert.equal(await previewStatus(plan.revision), 200);
        },
      );

      await t.test("a revision change withdraws the money until it is checked again", async () => {
        const raised = await fixture.scope(async () => {
          const definition = payrollPlanDefinitionSchema.parse(
            structuredClone(plan.versions[0]!.definition),
          );
          definition.components[0]!.flatRatePct = "12.5";
          return savePayrollDraft(plan.id, {
            expectedRevision: plan.revision,
            definition,
            effectiveFrom: new Date().toISOString().slice(0, 10),
            reason: "Synthetic browser money revision",
          });
        });
        assert.equal(raised.revision, plan.revision + 1);
        // The saved rules moved, so the shown money is stale: the check refuses it.
        await click("Check historical inputs");
        await browser.wait(text("Plan changed. Reload before previewing."));
        const stale = await resultShown();
        assert.equal(stale.includes(POSTED), false);
        assert.equal(stale.includes("Money source:"), false);
        assert.equal(stale.includes("Historical commission impact"), false);

        await click("Reload and discard plan draft");
        await browser.wait(
          `${button("Check historical inputs")} && !${button("Check historical inputs")}.disabled`,
        );
        // The revision remounts the check empty rather than keeping the old numbers.
        assert.equal(await resultShown(), "");
        await click("Check historical inputs");
        await browser.wait(text(`Calendar month: ${PERIOD}`));
        await browser.wait(text("with version 2 (DRAFT"));
        const fresh = await resultShown();
        assert.equal(fresh.includes(`Posted ${PERIOD} commission: ${POSTED}`), true);
        assert.equal(fresh.includes(RAISED), true);
        assert.match(fresh, /change \+S\$10\.00/);
        assert.equal(fresh.includes("Money source: authoritative inputs"), true);
        assert.equal(await previewStatus(raised.revision), 200);
        // The posted month is still forty: a draft changes the comparison, not history.
        const state = await fixture.scope(() => readStoredPayrollClose(PERIOD));
        assert.equal(state.calculation, null);
      });

      await t.test("losing payroll permission withdraws the money and the retry", async () => {
        await fixture.scope(() =>
          prisma.user.update({ where: { id: ownerId }, data: { globalRole: "MANAGER" } }),
        );
        try {
          await click("Check historical inputs");
          await browser.wait(text("Unable to check historical inputs."));
          const denied = await resultShown();
          // Neither the refusal nor the error text leaves a money figure behind.
          assert.equal(denied.includes(POSTED), false);
          assert.equal(denied.includes("Money source:"), false);
          assert.equal(await previewStatus(plan.revision + 1), 403);
        } finally {
          await fixture.scope(() =>
            prisma.user.update({ where: { id: ownerId }, data: { globalRole: "SUPER_ADMIN" } }),
          );
        }
        // Recovery keeps working: the same panel re-checks and shows money again.
        await click("Check historical inputs");
        await browser.wait(text(`Calendar month: ${PERIOD}`));
        assert.equal((await resultShown()).includes("Historical commission impact"), true);
      });

      await t.test("a failed request withdraws the money instead of leaving it shown", async () => {
        await browser.send("Network.setBlockedURLs", { urls: ["*historical-preview*"] });
        try {
          await click("Check historical inputs");
          await browser.wait(text("Unable to check historical inputs."));
          const failed = await resultShown();
          assert.equal(failed.includes(POSTED), false);
          assert.equal(failed.includes("Money source:"), false);
        } finally {
          await browser.send("Network.setBlockedURLs", { urls: [] });
        }
        await click("Check historical inputs");
        await browser.wait(text(`Calendar month: ${PERIOD}`));
        assert.equal((await resultShown()).includes(POSTED), true);
      });

      await t.test("a frozen close is the money source once the month is calculated", async () => {
        const open = await fixture.scope(() => readStoredPayrollClose(PERIOD));
        const calculated = await fixture.scope(() =>
          calculateStoredPayrollClose(PERIOD, open.revision),
        );
        assert.equal(calculated.status, "CALCULATED");
        await click("Check historical inputs");
        await browser.wait(text("Money source: the month's frozen approved calculation."));
        const frozen = await resultShown();
        // The frozen month is posted money: the loader is not consulted again.
        assert.equal(frozen.includes(`Posted ${PERIOD} commission: ${POSTED}`), true);
        assert.equal(frozen.includes("Money source: authoritative inputs"), false);
        assert.match(frozen, /with version 2 \(DRAFT/);
        await click("Check historical inputs");
        await browser.wait(text(`Calendar month: ${PERIOD}`));
        assert.equal((await resultShown()).includes("frozen approved calculation"), true);
      });
    } finally {
      const stop = async (child: ChildProcess | undefined) => {
        if (!child || child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, "exit");
        child.kill();
        await exited;
      };
      await Promise.all([stop(browser.process), stop(vite)]);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.$disconnect();
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  },
);
