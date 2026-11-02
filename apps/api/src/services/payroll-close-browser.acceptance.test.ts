import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createApp } from "../app.js";
import { env } from "../lib/env.js";
import { prisma } from "../lib/prisma.js";
import { signAccessToken } from "../lib/tokens.js";
import { Browser } from "../test-support/chrome-browser.js";
import { payrollCloseFixture } from "../test-support/payroll-close-fixture.js";

test(
  "M4 mounted payroll close in Chrome: reasoned adjustments, approval, frozen history, payout and permissions",
  { skip: process.env.RUN_CP005_BROWSER_ACCEPTANCE !== "true", timeout: 180000 },
  async (t) => {
    const origin = "http://127.0.0.1:55175";
    assert.ok(env.corsOrigins.includes(origin), "Set CORS_ORIGINS=http://127.0.0.1:55175");
    const f = await payrollCloseFixture(4, true);
    const directory = await mkdtemp(join(tmpdir(), "cp005-chrome-"));
    const browser = new Browser(directory);
    const server = createApp().listen(0, "127.0.0.1");
    let vite: ChildProcess | undefined;
    let scriptId: string | undefined;
    try {
      await once(server, "listening");
      const apiRoot = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const root = fileURLToPath(new URL("../../../../", import.meta.url));
      vite = spawn(
        process.execPath,
        [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "55175"],
        {
          cwd: join(root, "apps/web"),
          env: { ...process.env, VITE_PROXY_TARGET: apiRoot, VITE_API_URL: "/api" },
          stdio: "ignore",
        },
      );
      for (let attempt = 0; attempt < 150; attempt++) {
        try {
          if ((await fetch(origin)).ok) break;
        } catch {
          /* Local Vite is still starting. */
        }
        assert.ok(attempt < 149, "Local Vite failed to start");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await browser.start();
      const text = (value: string) => `document.body.innerText.includes(${JSON.stringify(value)})`;
      const button = (value: string) =>
        `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(value)})`;
      const field = (label: string) =>
        `document.getElementById([...document.querySelectorAll('label')].find(l => l.textContent.trim() === ${JSON.stringify(label)})?.htmlFor)`;
      const click = async (value: string) => {
        await browser.wait(`${button(value)} && !${button(value)}.disabled`);
        await browser.evaluate(`${button(value)}.click()`);
      };
      const fill = async (label: string, value: string) => {
        await browser.wait(`${field(label)} && !${field(label)}.matches(':disabled')`);
        await browser.evaluate(`${field(label)}.focus(); ${field(label)}.select()`);
        if (await browser.evaluate(`${field(label)}.type === 'month'`)) {
          await browser.evaluate(
            `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(${field(label)},${JSON.stringify(value)}); ${field(label)}.dispatchEvent(new Event('input',{bubbles:true}));`,
          );
        } else await browser.send("Input.insertText", { text: value });
      };
      const navigate = async (
        id: string,
        role: "SUPER_ADMIN" | "MANAGER" | "STAFF" | "CASHIER",
        outletId?: string,
      ) => {
        const token = signAccessToken({
          id,
          email: `${id}@example.test`,
          globalRole: role,
          tenantId: f.tenantId,
          realm: "web",
          tokenVersion: 0,
        }).token;
        if (scriptId)
          await browser.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId });
        const marker = `${role}-${Date.now()}`;
        const script = await browser.send("Page.addScriptToEvaluateOnNewDocument", {
          source: `localStorage.clear(); sessionStorage.clear(); localStorage.setItem('glampro.accessToken',${JSON.stringify(token)}); localStorage.setItem('glampro.refreshToken','synthetic-bootstrap-only'); sessionStorage.setItem('cp005-navigation',${JSON.stringify(marker)}); ${outletId ? `sessionStorage.setItem('glampro.outlet.v1',${JSON.stringify(outletId)});` : ""}`,
        });
        scriptId = String(script.identifier);
        await browser.send("Page.navigate", { url: `${origin}/settings?section=payroll` });
        await browser.wait(
          `sessionStorage.getItem('cp005-navigation') === ${JSON.stringify(marker)}`,
        );
        await browser.wait(text(outletId ? "Select “All outlets" : "Monthly payroll close"));
      };
      const load = async () => {
        await fill("Payroll month", "2026-09");
        await click("Load month");
        await browser.wait(text("revision"));
      };
      await t.test(
        "owner loads authoritative draft; missing reason makes no write; adjustment persists",
        async () => {
          await navigate(f.ownerId, "SUPER_ADMIN");
          await load();
          await click("Calculate payroll");
          await browser.wait(text("Close Staff"));
          await click("Approve payroll");
          await browser.wait(text("Enter a reason"));
          assert.equal(await f.scope(() => prisma.payrollCloseEvent.count()), 1);
          await browser.evaluate(
            `${field("Adjustment staff")}.value=${JSON.stringify(f.staffId)}; ${field("Adjustment staff")}.dispatchEvent(new Event('change',{bubbles:true}));`,
          );
          await fill("Adjustment amount", "12.30");
          await fill("Payroll action reason", "Reviewed browser addition");
          await click("Add adjustment");
          await browser.wait(text("revision 2"));
          await click("Calculate payroll");
          await browser.wait(text("2022.30"));
        },
      );
      await t.test(
        "owner approval freezes statements and payout remains a separate action",
        async () => {
          await fill("Payroll action reason", "Reviewed browser close");
          await click("Approve payroll");
          await browser.wait(text("Frozen payroll statements"));
          assert.equal(await browser.evaluate(`Boolean(${button("Calculate payroll")})`), false);
          const stored = await f.scope(() => prisma.payrollClose.findFirstOrThrow());
          assert.equal((stored.state as { payout: unknown }).payout, null);
          await fill("Payroll action reason", "Actual manual bank payment");
          await fill("Actual payout reference", "SYNTHETIC-BROWSER-BANK");
          await click("Record actual payout");
          await browser.wait(text("No funds were transferred"));
          await browser.wait(text("Payout recorded: SYNTHETIC-BROWSER-BANK"));
          assert.equal(await f.scope(() => prisma.salePayment.count()), 4);
        },
      );
      await t.test(
        "manager sees commission without salary or owner controls; direct owner write refuses",
        async () => {
          await navigate(f.managerId, "MANAGER");
          await load();
          await browser.wait(text("Frozen payroll statements"));
          assert.equal(
            await browser.evaluate(
              "[...document.querySelectorAll('th')].some(h=>['Salary','Take home'].includes(h.textContent))",
            ),
            false,
          );
          assert.equal(
            await browser.evaluate(
              `Boolean(${button("Approve payroll")} || ${button("Record actual payout")})`,
            ),
            false,
          );
          assert.equal(
            await browser.evaluate(
              "fetch('/api/payroll-close/2026-09/approve',{method:'POST',headers:{Authorization:'Bearer '+localStorage.getItem('glampro.accessToken'),'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:5,reason:'Forbidden attempt'})}).then(r=>r.status)",
            ),
            403,
          );
        },
      );
      await t.test(
        "failed frozen read hides cached salaries and retry restores the unchanged snapshot",
        async () => {
          await navigate(f.ownerId, "SUPER_ADMIN");
          await load();
          await browser.wait(text("2022.30"));
          await browser.send("Network.setBlockedURLs", { urls: ["*payroll-close/2026-09"] });
          await click("Load month");
          await browser.wait(`Boolean(${button("Retry payroll")})`);
          assert.equal(await browser.evaluate(text("2022.30")), false);
          await browser.send("Network.setBlockedURLs", { urls: [] });
          await click("Retry payroll");
          await browser.wait(text("2022.30"));
        },
      );
      await t.test(
        "outlet-scoped owner must explicitly select consolidated mode; direct scoped read refuses",
        async () => {
          const outlet = await f.scope(() => prisma.outlet.findFirstOrThrow());
          await navigate(f.ownerId, "SUPER_ADMIN", outlet.id);
          assert.equal(await browser.evaluate(`Boolean(${button("Load month")})`), false);
          assert.equal(
            await browser.evaluate(
              "fetch('/api/payroll-close/2026-09',{headers:{Authorization:'Bearer '+localStorage.getItem('glampro.accessToken'),'x-outlet-id':sessionStorage.getItem('glampro.outlet.v1')}}).then(r=>r.status)",
            ),
            403,
          );
        },
      );
      // Staff/cashier do not mount the screen. Direct reads remain server-guarded.
      for (const [id, role] of [
        [f.staffId, "STAFF"],
        [f.cashierId, "CASHIER"],
      ] as const)
        await t.test(`${role} cannot read management payroll`, async () => {
          if (scriptId)
            await browser.send("Page.removeScriptToEvaluateOnNewDocument", {
              identifier: scriptId,
            });
          const token = signAccessToken({
            id,
            email: `${id}@example.test`,
            globalRole: role,
            tenantId: f.tenantId,
            realm: "web",
            tokenVersion: 0,
          }).token;
          const script = await browser.send("Page.addScriptToEvaluateOnNewDocument", {
            source: `localStorage.clear();sessionStorage.clear();localStorage.setItem('glampro.accessToken',${JSON.stringify(token)});localStorage.setItem('glampro.refreshToken','synthetic-bootstrap-only');`,
          });
          scriptId = String(script.identifier);
          await browser.send("Page.navigate", { url: `${origin}/settings?section=payroll` });
          await browser.wait(text("Only the owner or a manager"));
          assert.equal(
            await browser.evaluate(
              "fetch('/api/payroll-close/2026-09',{headers:{Authorization:'Bearer '+localStorage.getItem('glampro.accessToken')}}).then(r=>r.status)",
            ),
            403,
          );
        });
      assert.equal(await f.scope(() => prisma.payrollCloseEvent.count()), 5);
      assert.equal(await f.scope(() => prisma.employeeCommission.count()), 0);
    } finally {
      const chromeExit =
        browser.process.exitCode === null ? once(browser.process, "exit") : Promise.resolve();
      const viteExit = vite && vite.exitCode === null ? once(vite, "exit") : Promise.resolve();
      browser.process.kill();
      vite?.kill();
      await Promise.all([chromeExit, viteExit]);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      await prisma.$disconnect();
    }
  },
);
