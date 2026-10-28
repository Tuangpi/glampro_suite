import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { hairPayrollExample } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { signAccessToken } from "../lib/tokens.js";
import { createApp } from "../app.js";
import {
  createPayrollPlan,
  updatePayrollPlan,
  publishPayrollDraft,
  savePayrollProfile,
  savePayrollSettings,
} from "./payroll-configuration.service.js";

/** Chrome's local debugging pipe: no browser automation dependency or TCP debugger. */
class Browser {
  private nextId = 0;
  private pending = new Map<
    number,
    { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
  >();
  private buffer = "";
  private sessionId = "";
  readonly process: ChildProcess;

  constructor(directory: string) {
    this.process = spawn(
      process.env.CP003_CHROME ?? "/usr/bin/google-chrome",
      [
        "--headless=new",
        "--remote-debugging-pipe",
        "--no-first-run",
        `--user-data-dir=${directory}`,
      ],
      { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
    );
    (this.process.stdio[4] as Readable).setEncoding("utf8").on("data", (chunk: string) => {
      this.buffer += chunk;
      let end: number;
      while ((end = this.buffer.indexOf("\0")) >= 0) {
        const message = JSON.parse(this.buffer.slice(0, end));
        this.buffer = this.buffer.slice(end + 1);
        const request = this.pending.get(message.id);
        if (!request) continue;
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result ?? {});
      }
    });
    const fail = () => {
      for (const request of this.pending.values()) request.reject(new Error("Chrome exited"));
      this.pending.clear();
    };
    this.process.on("exit", fail);
    this.process.on("error", fail);
  }

  async send(method: string, params: object = {}, browser = false) {
    const id = ++this.nextId;
    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    const timer = setTimeout(() => {
      this.pending.get(id)?.reject(new Error(`Chrome command timed out: ${method}`));
      this.pending.delete(id);
    }, 15_000);
    try {
      (this.process.stdio[3] as Writable).write(
        `${JSON.stringify({ id, method, params, ...(!browser && this.sessionId ? { sessionId: this.sessionId } : {}) })}\0`,
      );
      return await result;
    } finally {
      clearTimeout(timer);
    }
  }

  async start() {
    const target = await this.send("Target.createTarget", { url: "about:blank" }, true);
    const attached = await this.send(
      "Target.attachToTarget",
      { targetId: target.targetId, flatten: true },
      true,
    );
    this.sessionId = String(attached.sessionId);
    await this.send("Page.enable");
    await this.send("Network.enable");
  }

  async evaluate(expression: string): Promise<unknown> {
    const response = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    assert.equal(response.exceptionDetails, undefined, "Browser expression failed");
    return (response.result as { value?: unknown }).value;
  }

  async wait(expression: string) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (await this.evaluate(`Boolean(${expression})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // Deliberately omit page HTML/storage: they could contain session material.
    throw new Error(`Browser condition timed out: ${expression}`);
  }
}

test(
  "CP-003 authenticated historical readiness and plan lifecycle in Chrome",
  { skip: process.env.RUN_CP003_BROWSER_ACCEPTANCE !== "true", timeout: 180_000 },
  async (t) => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.ok(["55473", "55474"].includes(url.port));
    assert.equal(url.pathname, "/payroll_configuration_test");
    assert.ok(
      env.corsOrigins.includes("http://127.0.0.1:55173"),
      "Set CORS_ORIGINS=http://127.0.0.1:55173 for browser write acceptance",
    );
    const tenantId = `cp003-browser-${randomUUID()}`;
    const ownerId = `${tenantId}-owner`;
    const managerId = `${tenantId}-manager`;
    const scope = <T>(fn: () => T) => runAsTenant(tenantId, fn, ownerId);
    const directory = await mkdtemp(join(tmpdir(), "cp003-chrome-"));
    const browser = new Browser(directory);
    const server = createApp().listen(0, "127.0.0.1");
    let vite: ChildProcess | undefined;
    let scriptId: string | undefined;
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
      await runAsPlatform(async () => {
        await prisma.tenant.create({
          data: { id: tenantId, slug: tenantId, name: "Browser fixture" },
        });
        await prisma.module.upsert({
          where: { code: "staff" },
          update: {},
          create: { code: "staff", name: "Staff", category: "Core", isCore: true },
        });
      });
      const outlet = await scope(async () => {
        for (const [id, globalRole] of [
          [ownerId, "SUPER_ADMIN"],
          [managerId, "MANAGER"],
        ] as const)
          await prisma.user.create({
            data: {
              id,
              tenantId,
              name: globalRole,
              email: `${id}@example.test`,
              passwordHash: "unused-synthetic-hash",
              globalRole,
              twoFactorEnabled: true,
            },
          });
        return prisma.outlet.create({ data: { tenantId, name: "Browser branch", slug: "branch" } });
      });
      const reason = "Synthetic browser acceptance";
      const plan = await scope(() =>
        createPayrollPlan({
          name: "Browser plan",
          description: "Synthetic",
          positions: [],
          outletIds: [],
          definition: hairPayrollExample(),
          reason,
        }),
      );
      const evidenceBefore = await scope(async () => ({
        audit: await prisma.payrollConfigurationEvent.count(),
        earnings: await prisma.employeeCommission.count(),
        collections: await prisma.commissionCollection.count(),
      }));
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
      const text = (value: string) => `document.body.innerText.includes(${JSON.stringify(value)})`;
      const button = (label: string) =>
        `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
      const click = async (label: string) => {
        await browser.wait(`${button(label)} && !${button(label)}.disabled`);
        await browser.evaluate(`${button(label)}.click()`);
      };
      const field = (label: string) =>
        `document.getElementById([...document.querySelectorAll('label')].find(l => l.textContent.trim() === ${JSON.stringify(label)})?.htmlFor)`;
      const fill = async (label: string, value: string) => {
        await browser.wait(`${field(label)} && !${field(label)}.matches(':disabled')`);
        await browser.evaluate(`${field(label)}.focus(); ${field(label)}.select()`);
        if (await browser.evaluate(`${field(label)}.type === 'date'`)) {
          await browser.evaluate(
            `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(${field(label)}, ${JSON.stringify(value)}); ${field(label)}.dispatchEvent(new Event('input', {bubbles: true}));`,
          );
        } else {
          await browser.send("Input.insertText", { text: value });
        }
        assert.equal(await browser.evaluate(`${field(label)}.value`), value);
      };
      const selectPlan = async (id: string) => {
        await browser.wait(`${field("Commission plan")}?.querySelector('option[value="${id}"]')`);
        await browser.evaluate(
          `${field("Commission plan")}.value = ${JSON.stringify(id)}; ${field("Commission plan")}.dispatchEvent(new Event('change', {bubbles: true}))`,
        );
        await browser.wait(`${field("Commission plan")}.value === ${JSON.stringify(id)}`);
      };
      const select = async (label: string, value: string) => {
        await browser.wait(`${field(label)} && !${field(label)}.matches(':disabled')`);
        await browser.evaluate(
          `${field(label)}.value = ${JSON.stringify(value)}; ${field(label)}.dispatchEvent(new Event('change', {bubbles: true}))`,
        );
        await browser.wait(`${field(label)}.value === ${JSON.stringify(value)}`);
      };
      const open = async (id = ownerId, outletId = "") => {
        if (scriptId)
          await browser.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId });
        const token = signAccessToken({
          id,
          email: `${id}@example.test`,
          globalRole: id === ownerId ? "SUPER_ADMIN" : "MANAGER",
          realm: "web",
          tokenVersion: 0,
          tenantId,
        }).token;
        const marker = randomUUID();
        const script = await browser.send("Page.addScriptToEvaluateOnNewDocument", {
          source: `localStorage.clear(); sessionStorage.clear(); sessionStorage.setItem('cp003-navigation', ${JSON.stringify(marker)}); localStorage.setItem('glampro.accessToken', ${JSON.stringify(token)}); localStorage.setItem('glampro.refreshToken', 'synthetic-bootstrap-only'); ${outletId ? `sessionStorage.setItem('glampro.outlet.v1', ${JSON.stringify(outletId)});` : ""}`,
        });
        scriptId = String(script.identifier);
        await browser.send("Page.navigate", { url: `${origin}/settings?section=team` });
        await browser.wait(
          `sessionStorage.getItem('cp003-navigation') === ${JSON.stringify(marker)}`,
        );
        await browser.wait(text("Versioned commission plans"));
        await browser.wait("document.querySelector('select') !== null");
      };
      const previewStatus = () =>
        browser.evaluate(
          `fetch('/api/payroll-configuration/plans/${plan.id}/historical-preview?expectedRevision=1', {headers: {Authorization: 'Bearer ' + localStorage.getItem('glampro.accessToken'), ...(sessionStorage.getItem('glampro.outlet.v1') ? {'x-outlet-id': sessionStorage.getItem('glampro.outlet.v1')} : {})}}).then(r => r.status)`,
        );

      await t.test("owner company context displays blockers without monetary impact", async () => {
        await open();
        assert.equal(await browser.evaluate(text("Calendar month:")), false);
        await click("Check historical inputs");
        await browser.wait(text("Calendar month:"));
        assert.equal(await browser.evaluate(text("Historical impact unavailable")), true);
        assert.equal(await browser.evaluate(text("Counts do not establish complete bases")), true);
        assert.equal(await previewStatus(), 200);
      });
      await t.test("failed retry removes prior evidence and can recover", async () => {
        await browser.send("Network.setBlockedURLs", { urls: ["*historical-preview*"] });
        await click("Check historical inputs");
        await browser.wait(text("Unable to check historical inputs."));
        assert.equal(await browser.evaluate(text("Calendar month:")), false);
        await browser.send("Network.setBlockedURLs", { urls: [] });
        await click("Check historical inputs");
        await browser.wait(text("Calendar month:"));
      });
      await t.test(
        "server stale revision hides prior results; reload requires a new check",
        async () => {
          await scope(() =>
            updatePayrollPlan(plan.id, {
              name: "Browser plan",
              description: "Revised",
              positions: [],
              outletIds: [],
              expectedRevision: 1,
              reason,
            }),
          );
          await click("Check historical inputs");
          await browser.wait(text("Plan changed. Reload before previewing."));
          assert.equal(await browser.evaluate(text("Calendar month:")), false);
          await click("Reload and discard plan draft");
          await browser.wait(
            `${button("Check historical inputs")} && !${button("Check historical inputs")}.disabled`,
          );
          assert.equal(await browser.evaluate(text("Calendar month:")), false);
          await click("Check historical inputs");
          await browser.wait(text("Calendar month:"));
        },
      );
      await t.test("server permission loss refuses retry and clears prior evidence", async () => {
        await scope(() =>
          prisma.user.update({ where: { id: ownerId }, data: { globalRole: "MANAGER" } }),
        );
        try {
          await click("Check historical inputs");
          await browser.wait(text("Unable to check historical inputs."));
          assert.equal(await browser.evaluate(text("Calendar month:")), false);
          assert.equal(await previewStatus(), 403);
        } finally {
          await scope(() =>
            prisma.user.update({ where: { id: ownerId }, data: { globalRole: "SUPER_ADMIN" } }),
          );
        }
      });
      await t.test(
        "manager hides readiness and server denies a direct browser request",
        async () => {
          await open(managerId);
          assert.equal(await browser.evaluate(text("Historical payroll input readiness")), false);
          assert.equal(await previewStatus(), 403);
        },
      );
      await t.test(
        "owner outlet context hides readiness and server denies direct access",
        async () => {
          await open(ownerId, outlet.id);
          await browser.wait(text("Outlet-scoped plans only."));
          assert.equal(await browser.evaluate(text("Historical payroll input readiness")), false);
          assert.equal(await previewStatus(), 403);
        },
      );
      await scope(async () => {
        // Only the intentional metadata edit writes payroll evidence.
        assert.equal(await prisma.payrollConfigurationEvent.count(), evidenceBefore.audit + 1);
        assert.equal(await prisma.employeeCommission.count(), evidenceBefore.earnings);
        assert.equal(await prisma.commissionCollection.count(), evidenceBefore.collections);
      });
      const lifecycleName = "Browser lifecycle sample";
      let lifecycleId = "";
      let publishedId = "";
      let publishedDefinition: unknown;
      await t.test(
        "owner sample creation requires a reason and persists an audited draft",
        async () => {
          await open();
          const before = await scope(() => prisma.payrollConfigurationEvent.count());
          await fill("New or duplicate plan name", lifecycleName);
          await click("Create Hair sample draft");
          await browser.wait(text("Enter a change reason (at least 3 characters)."));
          await scope(async () => {
            assert.equal(await prisma.payrollPlan.count({ where: { name: lifecycleName } }), 0);
            assert.equal(await prisma.payrollConfigurationEvent.count(), before);
          });
          await fill("Plan change reason", reason);
          await click("Create Hair sample draft");
          await browser.wait(text("Configuration saved. Plan-based earnings remain inactive."));
          const created = await scope(() =>
            prisma.payrollPlan.findFirstOrThrow({
              where: { name: lifecycleName },
              include: { versions: true },
            }),
          );
          lifecycleId = created.id;
          assert.equal(created.revision, 1);
          assert.equal(created.versions.length, 1);
          assert.equal(created.versions[0].status, "DRAFT");
          assert.deepEqual(created.versions[0].definition, hairPayrollExample());
          await scope(async () => {
            const audit = await prisma.payrollConfigurationEvent.findMany({
              where: { targetId: lifecycleId },
            });
            assert.equal(audit.length, 1);
            assert.equal(audit[0].actorId, ownerId);
            assert.equal(audit[0].reason, reason);
          });
          await selectPlan(lifecycleId);
        },
      );
      await t.test(
        "owner saves before publishing and later drafts preserve the published snapshot",
        async () => {
          assert.ok(lifecycleId, "Sample creation must succeed first");
          await fill("Component name", "Browser revised component");
          assert.equal(
            await browser.evaluate(`${button("Publish saved version")}.matches(':disabled')`),
            true,
          );
          await fill("Plan change reason", reason);
          await click("Save plan draft");
          await browser.wait(text("Revision 2"));
          const saved = await scope(() =>
            prisma.payrollPlanVersion.findFirstOrThrow({ where: { planId: lifecycleId } }),
          );
          assert.equal(
            (saved.definition as { components: { name: string }[] }).components[0].name,
            "Browser revised component",
          );
          assert.equal(saved.status, "DRAFT");
          await fill("Plan change reason", reason);
          await click("Publish saved version");
          await browser.wait(text("Revision 3"));
          const published = await scope(() =>
            prisma.payrollPlanVersion.findUniqueOrThrow({ where: { id: saved.id } }),
          );
          assert.equal(published.status, "PUBLISHED");
          assert.ok(published.publishedAt);
          assert.equal(published.actorId, ownerId);
          publishedId = published.id;
          publishedDefinition = published.definition;
          assert.equal(
            await browser.evaluate(`${button("Publish saved version")}.matches(':disabled')`),
            true,
          );
          await fill("Component name", "Browser next version component");
          const tomorrow = new Date(`${saved.effectiveFrom}T00:00:00Z`);
          tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
          await fill("Plan effective date", tomorrow.toISOString().slice(0, 10));
          await fill("Plan change reason", reason);
          await click("Save plan draft");
          await browser.wait(text("Revision 4"));
          await scope(async () => {
            const versions = await prisma.payrollPlanVersion.findMany({
              where: { planId: lifecycleId },
              orderBy: { versionNo: "asc" },
            });
            assert.equal(versions.length, 2);
            assert.equal(versions[0].id, publishedId);
            assert.equal(versions[0].status, "PUBLISHED");
            assert.deepEqual(versions[0].definition, publishedDefinition);
            assert.equal(versions[1].status, "DRAFT");
            assert.equal(versions[1].versionNo, 2);
            assert.equal(versions[1].effectiveFrom, tomorrow.toISOString().slice(0, 10));
            assert.equal(
              (versions[1].definition as { components: { name: string }[] }).components[0].name,
              "Browser next version component",
            );
            assert.equal(
              await prisma.payrollConfigurationEvent.count({ where: { targetId: lifecycleId } }),
              4,
            );
          });
        },
      );
      await t.test(
        "owner duplicates and archives a plan without altering the source history",
        async () => {
          assert.ok(publishedId, "Publication must succeed first");
          const sourceBefore = await scope(() =>
            prisma.payrollPlan.findUniqueOrThrow({
              where: { id: lifecycleId },
              include: { versions: true },
            }),
          );
          await fill("New or duplicate plan name", "Browser lifecycle duplicate");
          await fill("Plan change reason", reason);
          await click("Duplicate plan");
          await browser.wait(text("Configuration saved. Plan-based earnings remain inactive."));
          const duplicate = await scope(() =>
            prisma.payrollPlan.findFirstOrThrow({
              where: { name: "Browser lifecycle duplicate" },
              include: { versions: true },
            }),
          );
          assert.notEqual(duplicate.id, lifecycleId);
          assert.equal(duplicate.revision, 1);
          assert.equal(duplicate.versions.length, 1);
          assert.equal(duplicate.versions[0].status, "DRAFT");
          assert.deepEqual(
            duplicate.versions[0].definition,
            sourceBefore.versions.find((v) => v.versionNo === 2)!.definition,
          );
          await selectPlan(duplicate.id);
          await fill("Plan change reason", reason);
          await click("Archive plan");
          await browser.wait(text("Revision 2"));
          assert.equal(
            await browser.evaluate(`${button("Archive plan")}.matches(':disabled')`),
            true,
          );
          await scope(async () => {
            const archived = await prisma.payrollPlan.findUniqueOrThrow({
              where: { id: duplicate.id },
            });
            assert.equal(archived.archived, true);
            assert.equal(archived.revision, 2);
            assert.equal(
              await prisma.payrollConfigurationEvent.count({ where: { targetId: duplicate.id } }),
              2,
            );
            assert.deepEqual(
              await prisma.payrollPlan.findUniqueOrThrow({
                where: { id: lifecycleId },
                include: { versions: true },
              }),
              sourceBefore,
            );
          });
        },
      );
      await t.test("manager cannot edit or publish the persisted lifecycle plan", async () => {
        assert.ok(lifecycleId, "Sample creation must succeed first");
        const before = await scope(() => prisma.payrollConfigurationEvent.count());
        await open(managerId);
        await selectPlan(lifecycleId);
        assert.equal(
          await browser.evaluate(`${field("Component name")}.matches(':disabled')`),
          true,
        );
        assert.equal(await browser.evaluate(`!!${button("Save plan draft")}`), false);
        assert.equal(await browser.evaluate(`!!${button("Publish saved version")}`), false);
        const status = await browser.evaluate(
          `fetch('/api/payroll-configuration/plans/${lifecycleId}/publish', {method: 'POST', headers: {Authorization: 'Bearer ' + localStorage.getItem('glampro.accessToken'), 'Content-Type': 'application/json'}, body: JSON.stringify({expectedRevision: 4, reason: ${JSON.stringify(reason)}})}).then(r => r.status)`,
        );
        assert.equal(status, 403);
        await scope(async () => {
          assert.equal(await prisma.payrollConfigurationEvent.count(), before);
          assert.equal(await prisma.employeeCommission.count(), evidenceBefore.earnings);
          assert.equal(await prisma.commissionCollection.count(), evidenceBefore.collections);
          assert.deepEqual(
            (await prisma.payrollPlanVersion.findUniqueOrThrow({ where: { id: publishedId } }))
              .definition,
            publishedDefinition,
          );
        });
      });
      await t.test(
        "commission classification requires coverage and failed save leaves identity and audit unchanged",
        async () => {
          await open();
          await select("Payroll staff member", ownerId);
          const before = await scope(async () => ({
            person: await prisma.user.findUniqueOrThrow({ where: { id: ownerId } }),
            audit: await prisma.payrollConfigurationEvent.count(),
          }));
          const version = await scope(() =>
            prisma.payrollPlanVersion.findUniqueOrThrow({ where: { id: publishedId } }),
          );
          await fill("Staff join date", version.effectiveFrom);
          await select("Commission role classification", "COMMISSION_EARNING");
          await fill("Plan change reason", reason);
          await click("Save staff payroll settings");
          await browser.wait(
            text("Commission-earning staff require an assignment for the current payroll month."),
          );
          assert.equal(
            await browser.evaluate(`${field("Staff join date")}.value`),
            version.effectiveFrom,
          );
          assert.equal(
            await browser.evaluate(`${field("Commission role classification")}.value`),
            "COMMISSION_EARNING",
          );
          await scope(async () => {
            assert.deepEqual(
              await prisma.user.findUniqueOrThrow({ where: { id: ownerId } }),
              before.person,
            );
            assert.equal(await prisma.payrollConfigurationEvent.count(), before.audit);
          });
        },
      );
      await t.test(
        "owner assigns a published plan then saves reasoned commission classification",
        async () => {
          const before = await scope(() => prisma.payrollConfigurationEvent.count());
          // Establish an audited join date before assignment; the refused commission
          // classification above must not have changed the employment record.
          await select("Commission role classification", "NON_COMMISSION");
          await fill("Plan change reason", reason);
          await click("Save staff payroll settings");
          await browser.wait(
            text(
              "Staff payroll settings changed. Reload saved values before saving; local edits will be discarded.",
            ),
          );
          await click("Reload staff payroll settings");
          const checkbox = `[...document.querySelectorAll('label')].find(l => l.textContent.trim() === 'SUPER_ADMIN')?.querySelector('input[type=checkbox]')`;
          await browser.wait(checkbox);
          await browser.evaluate(`${checkbox}.click()`);
          await select("Assignment plan", lifecycleId);
          await fill("Plan change reason", reason);
          await click("Assign selected staff");
          await browser.wait(text("Configuration saved. Plan-based earnings remain inactive."));
          const assignments = await scope(() =>
            prisma.payrollConfigurationEvent.findFirstOrThrow({
              where: { kind: "ASSIGNMENT", targetId: "company" },
              orderBy: { revision: "desc" },
            }),
          );
          const rows = assignments.payload as {
            staffId: string;
            planId: string;
            outletIds: string[];
            toDate: string | null;
          }[];
          assert.equal(rows.filter((row) => row.staffId === ownerId).length, 1);
          assert.equal(rows.find((row) => row.staffId === ownerId)!.planId, lifecycleId);
          assert.equal(rows.find((row) => row.staffId === ownerId)!.toDate, null);
          assert.deepEqual(rows.find((row) => row.staffId === ownerId)!.outletIds, []);
          assert.equal(assignments.actorId, ownerId);
          assert.equal(assignments.reason, reason);
          // Assignment refresh remounts the staff panel; explicitly reselect and enter fields.
          await select("Payroll staff member", ownerId);
          const version = await scope(() =>
            prisma.payrollPlanVersion.findUniqueOrThrow({ where: { id: publishedId } }),
          );
          await fill("Staff join date", version.effectiveFrom);
          await select("Commission role classification", "COMMISSION_EARNING");
          await fill("Plan change reason", reason);
          await click("Save staff payroll settings");
          await browser.wait(
            text(
              "Staff payroll settings changed. Reload saved values before saving; local edits will be discarded.",
            ),
          );
          await scope(async () => {
            const event = await prisma.payrollConfigurationEvent.findFirstOrThrow({
              where: { kind: "STAFF", targetId: ownerId },
              orderBy: { revision: "desc" },
            });
            assert.equal(event.revision, 2);
            assert.equal(event.actorId, ownerId);
            assert.equal(event.reason, reason);
            assert.equal(
              (event.payload as { commissionRole: string }).commissionRole,
              "COMMISSION_EARNING",
            );
            assert.equal(
              (await prisma.user.findUniqueOrThrow({ where: { id: ownerId } }))
                .startDate!.toISOString()
                .slice(0, 10),
              version.effectiveFrom,
            );
            assert.equal(await prisma.payrollConfigurationEvent.count(), before + 3);
          });
          await click("Reload staff payroll settings");
          assert.equal(
            await browser.evaluate(`${field("Commission role classification")}.value`),
            "COMMISSION_EARNING",
          );
        },
      );
      await t.test(
        "salon settings retain edits after network failure and save exact audited values",
        async () => {
          await browser.evaluate(
            `[...document.querySelectorAll('summary')].find(s => s.textContent === 'Salon commission settings (configuration only)').click()`,
          );
          const before = await scope(() => prisma.payrollConfigurationEvent.count());
          await fill("Minimum package deposit percentage", "42.5");
          await fill("Refund administration fee", "12.34");
          await fill("Plan change reason", reason);
          await browser.send("Network.setBlockedURLs", {
            urls: ["*/payroll-configuration/settings"],
          });
          await click("Save salon commission settings");
          await browser.wait(text("Network Error"));
          assert.equal(
            await browser.evaluate(`${field("Minimum package deposit percentage")}.value`),
            "42.5",
          );
          assert.equal(
            await browser.evaluate(`${field("Refund administration fee")}.value`),
            "12.34",
          );
          assert.equal(await scope(() => prisma.payrollConfigurationEvent.count()), before);
          await browser.send("Network.setBlockedURLs", { urls: [] });
          await click("Save salon commission settings");
          await browser.wait(
            text(
              "Salon commission settings changed. Reload saved values before saving; local edits will be discarded.",
            ),
          );
          await scope(async () => {
            const event = await prisma.payrollConfigurationEvent.findFirstOrThrow({
              where: { kind: "SETTINGS", targetId: "company" },
              orderBy: { revision: "desc" },
            });
            assert.equal(event.revision, 1);
            assert.equal(event.reason, reason);
            assert.equal(event.actorId, ownerId);
            assert.equal(
              (event.payload as { minimumDepositPct: string }).minimumDepositPct,
              "42.5",
            );
            assert.equal((event.payload as { refundAdminFee: string }).refundAdminFee, "12.34");
            assert.equal(await prisma.payrollConfigurationEvent.count(), before + 1);
          });
          await click("Reload salon commission settings");
          assert.equal(
            await browser.evaluate(`${field("Refund administration fee")}.value`),
            "12.34",
          );
        },
      );
      await t.test("manager cannot alter assignment classification or salon settings", async () => {
        const before = await scope(() => prisma.payrollConfigurationEvent.count());
        await open(managerId);
        await select("Payroll staff member", ownerId);
        assert.equal(
          await browser.evaluate(`${field("Assignment plan")}.matches(':disabled')`),
          true,
        );
        assert.equal(
          await browser.evaluate(`${field("Commission role classification")}.matches(':disabled')`),
          true,
        );
        await browser.evaluate(
          `[...document.querySelectorAll('summary')].find(s => s.textContent === 'Salon commission settings (configuration only)').click()`,
        );
        assert.equal(
          await browser.evaluate(
            `${field("Minimum package deposit percentage")}.matches(':disabled')`,
          ),
          true,
        );
        for (const path of ["assignments", `staff/${ownerId}/settings`, "settings"]) {
          const status = await browser.evaluate(
            `fetch('/api/payroll-configuration/${path}', {method: 'POST', headers: {Authorization: 'Bearer ' + localStorage.getItem('glampro.accessToken'), 'Content-Type': 'application/json'}, body: '{}'}).then(r => r.status)`,
          );
          assert.equal(status, 403);
        }
        await scope(async () => {
          assert.equal(await prisma.payrollConfigurationEvent.count(), before);
          assert.equal(await prisma.employeeCommission.count(), evidenceBefore.earnings);
          assert.equal(await prisma.commissionCollection.count(), evidenceBefore.collections);
        });
      });
      await t.test(
        "salary saves require reasons and stale refresh never rebases unsaved salary",
        async () => {
          await open();
          await select("Payroll staff member", ownerId);
          await fill("Basic monthly salary", "1234.56");
          await click("Save salary profile");
          await browser.wait(text("Enter a change reason (at least 3 characters)."));
          assert.equal(
            await scope(() =>
              prisma.payrollConfigurationEvent.count({
                where: { kind: "PROFILE", targetId: ownerId },
              }),
            ),
            0,
          );
          await fill("Plan change reason", reason);
          await click("Save salary profile");
          await browser.wait(
            text(
              "Salary profile changed. Reload saved values before saving; local edits will be discarded.",
            ),
          );
          await click("Reload salary profile");
          await fill("Basic monthly salary", "2345.67");
          await scope(() =>
            savePayrollProfile(ownerId, {
              expectedRevision: 1,
              reason,
              basicSalary: "3456.78",
              fixedOvertime: "0",
              levy: "0",
              salesAlertPct: "0",
            }),
          );
          await click("Reload and discard plan draft");
          await browser.wait(
            text(
              "Salary profile changed. Reload saved values before saving; local edits will be discarded.",
            ),
          );
          assert.equal(await browser.evaluate(`${field("Basic monthly salary")}.value`), "2345.67");
          assert.equal(
            await browser.evaluate(`${button("Save salary profile")}.matches(':disabled')`),
            true,
          );
          await click("Reload salary profile");
          assert.equal(await browser.evaluate(`${field("Basic monthly salary")}.value`), "3456.78");
          await scope(async () => {
            const events = await prisma.payrollConfigurationEvent.findMany({
              where: { kind: "PROFILE", targetId: ownerId },
              orderBy: { revision: "asc" },
            });
            assert.equal(events.length, 2);
            assert.equal((events[0].payload as { basicSalary: string }).basicSalary, "1234.56");
            assert.equal(events[0].actorId, ownerId);
            assert.equal(events[0].reason, reason);
          });
          await open(managerId);
          assert.equal(await browser.evaluate(`!!${field("Basic monthly salary")}`), false);
          const result = await browser.evaluate(
            `fetch('/api/payroll-configuration', {headers: {Authorization: 'Bearer ' + localStorage.getItem('glampro.accessToken')}}).then(r => r.json()).then(r => ({profile: r.data.staff.some(s => 'profile' in s), salaryAudit: r.data.history.some(e => e.kind === 'PROFILE')}))`,
          );
          assert.deepEqual(result, { profile: false, salaryAudit: false });
          assert.equal(
            await browser.evaluate(
              `fetch('/api/payroll-configuration/staff/${ownerId}/profile', {method: 'POST', headers: {Authorization: 'Bearer ' + localStorage.getItem('glampro.accessToken'), 'Content-Type': 'application/json'}, body: '{}'}).then(r => r.status)`,
            ),
            403,
          );
        },
      );
      await t.test("stale salon settings preserve local edits until explicit reload", async () => {
        await open();
        await browser.evaluate(
          `[...document.querySelectorAll('summary')].find(s => s.textContent === 'Salon commission settings (configuration only)').click()`,
        );
        await fill("Refund administration fee", "88.88");
        await scope(() =>
          savePayrollSettings({
            expectedRevision: 1,
            reason,
            joinAfterDay: null,
            negativeBase: "CARRY_FORWARD",
            minimumDepositPct: "42.5",
            refundAdminFee: "77.77",
            requireAttribution: true,
          }),
        );
        await click("Reload and discard plan draft");
        await browser.wait(
          text(
            "Salon commission settings changed. Reload saved values before saving; local edits will be discarded.",
          ),
        );
        assert.equal(
          await browser.evaluate(`${field("Refund administration fee")}.value`),
          "88.88",
        );
        assert.equal(
          await browser.evaluate(
            `${button("Save salon commission settings")}.matches(':disabled')`,
          ),
          true,
        );
        await click("Reload salon commission settings");
        assert.equal(
          await browser.evaluate(`${field("Refund administration fee")}.value`),
          "77.77",
        );
        assert.equal(
          await scope(() =>
            prisma.payrollConfigurationEvent.count({
              where: { kind: "SETTINGS", targetId: "company" },
            }),
          ),
          2,
        );
      });
      await t.test(
        "owner atomically creates commission staff with a scoped published assignment",
        async () => {
          const scoped = await scope(() =>
            createPayrollPlan({
              name: "Scoped browser plan",
              description: "Synthetic",
              positions: [],
              outletIds: [outlet.id],
              definition: hairPayrollExample(),
              reason,
            }),
          );
          await scope(() => publishPayrollDraft(scoped.id, { expectedRevision: 1, reason }));
          const date = scoped.versions[0].effectiveFrom;
          const department = await scope(() =>
            prisma.department.create({ data: { tenantId, name: "Browser creation department" } }),
          );
          const before = await scope(() => prisma.payrollConfigurationEvent.count());
          await open();
          await browser.send("Page.navigate", { url: `${origin}/staff` });
          await browser.wait(button("Add staff member"));
          await click("Add staff member");
          await browser.wait(field("Name"));
          await fill("Name", "Scoped browser staff");
          await fill("Email", `scoped-${tenantId}@example.test`);
          await fill("Password", "Synthetic-browser-only-2026!");
          await fill("Start date", date);
          await select("Initial commission classification", "COMMISSION_EARNING");
          await fill("Classification reason", reason);
          const submit = `document.querySelector('button[form="staff-form"]')`;
          await browser.evaluate(`${submit}.click()`);
          await browser.wait(text("Choose an initial payroll plan before creating staff."));
          assert.equal(
            await scope(() => prisma.user.count({ where: { name: "Scoped browser staff" } })),
            0,
          );
          await select("Initial payroll plan", scoped.id);
          await fill("Assignment reason", reason);
          await browser.evaluate(
            `[...document.querySelectorAll('label')].find(l => l.textContent.includes('Browser creation department')).querySelector('input').click()`,
          );
          await browser.evaluate(`${submit}.click()`);
          await browser.wait(`!document.getElementById('staff-form')`);
          await scope(async () => {
            const staff = await prisma.user.findFirstOrThrow({
              where: { name: "Scoped browser staff" },
            });
            assert.equal(staff.startDate!.toISOString().slice(0, 10), date);
            assert.equal(
              await prisma.staffDepartment.count({
                where: { userId: staff.id, departmentId: department.id },
              }),
              1,
            );
            const classification = await prisma.payrollConfigurationEvent.findFirstOrThrow({
              where: { kind: "STAFF", targetId: staff.id },
            });
            assert.equal(
              (classification.payload as { commissionRole: string }).commissionRole,
              "COMMISSION_EARNING",
            );
            assert.equal(classification.reason, reason);
            const assignment = await prisma.payrollConfigurationEvent.findFirstOrThrow({
              where: { kind: "ASSIGNMENT" },
              orderBy: { revision: "desc" },
            });
            const row = (
              assignment.payload as { staffId: string; planId: string; outletIds: string[] }[]
            ).find((r) => r.staffId === staff.id)!;
            assert.equal(row.planId, scoped.id);
            assert.deepEqual(row.outletIds, [outlet.id]);
            assert.equal(await prisma.payrollConfigurationEvent.count(), before + 2);
            assert.equal(await prisma.employeeCommission.count(), evidenceBefore.earnings);
            assert.equal(await prisma.commissionCollection.count(), evidenceBefore.collections);
          });
          await open(managerId);
          await browser.send("Page.navigate", { url: `${origin}/staff` });
          await browser.wait(text("Ask the owner to add staff"));
          assert.equal(await browser.evaluate(`!!${button("Add staff member")}`), false);
          assert.equal(
            await browser.evaluate(
              `fetch('/api/staff', {method: 'POST', headers: {Authorization: 'Bearer ' + localStorage.getItem('glampro.accessToken'), 'Content-Type': 'application/json'}, body: '{}'}).then(r => r.status)`,
            ),
            403,
          );
        },
      );
    } finally {
      const stop = async (child: ChildProcess | undefined) => {
        if (!child || child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, "exit");
        child.kill();
        await exited;
      };
      await Promise.all([stop(browser.process), stop(vite)]);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      // Retain immutable synthetic audit evidence in the disposable database.
      await prisma.$disconnect();
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  },
);
