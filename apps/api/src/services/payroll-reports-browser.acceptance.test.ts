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
import { runAtOutlet } from "../lib/tenant-context.js";
import { signAccessToken } from "../lib/tokens.js";
import { Browser } from "../test-support/chrome-browser.js";
import { payrollCloseFixture } from "../test-support/payroll-close-fixture.js";
import { payrollReportingFixture } from "../test-support/payroll-reporting-fixture.js";
import { createSale } from "./sale.service.js";

/**
 * CP-006 browser acceptance: the reporting surfaces as a person actually reaches them.
 *
 * Every assertion below is made through the mounted React app in headless Chrome — the frozen
 * period report, its base-line drill-down, the three frozen exports, month-to-date progress on
 * the settings and till screens, own-data self-service for a staff member, and a customer's
 * holding history. Nothing is stubbed past the fixture and one synthetic value-package
 * purchase, so each figure on screen came from the server's stored snapshot.
 *
 * Gated: needs a disposable PostgreSQL cluster, a real Chrome and the fixed ports below.
 */

/** The salon-local month the mounted progress cards show when no period is passed. */
const currentPeriod = new Date().toISOString().slice(0, 7);

/**
 * One customer with one value-package purchase. Holding history is a customer screen, so the
 * browser pass needs a real purchase behind it; the entitlement is what makes the panel mount
 * at all, so the same modules are enabled here.
 */
async function seedHoldingHistory(
  fixture: Awaited<ReturnType<typeof payrollCloseFixture>>,
  module: string,
) {
  return fixture.scope(async () => {
    for (const code of ["catalogue", "packages", "sales", "customers", "reports"]) {
      const row = await prisma.module.upsert({
        where: { code },
        update: {},
        create: { code, name: code, category: "Core", isCore: true },
      });
      // The fixture may already entitle some of these; a repeat is not a failure.
      await prisma.tenantModule.createMany({
        data: [{ tenantId: fixture.tenantId, moduleId: row.id }],
        skipDuplicates: true,
      });
    }
    const outlet = await prisma.outlet.findFirstOrThrow();
    const customer = await prisma.customer.create({
      data: { tenantId: fixture.tenantId, name: "Browser holder" },
    });
    const item = await prisma.valuePackage.create({
      data: {
        tenantId: fixture.tenantId,
        name: "Browser 545 for 600",
        price: "545",
        credit: "600",
      },
    });
    await runAtOutlet(outlet.id, () =>
      createSale({
        customerId: customer.id,
        lines: [
          {
            itemType: "VALUE_PACKAGE",
            itemId: item.id,
            quantity: 1,
            attribution: { sellers: [{ staffId: fixture.ownerId, share: 10000 }] },
          },
        ],
        payments: [{ method: "CASH", amount: 545 }],
        collection: {
          currency: "SGD",
          allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "54500" }],
        },
      }),
    );
    assert.equal(
      await prisma.customerValuePackageHolding.count({ where: { customerId: customer.id } }),
      1,
      `${module} fixture must leave exactly one holding to display`,
    );
    return customer.id;
  });
}

test(
  "CP-006 mounted reports in Chrome: frozen period report, drill-down, exports, MTD/POS progress, own-data self-service and holding history",
  { skip: process.env.RUN_CP006_BROWSER_ACCEPTANCE !== "true", timeout: 300000 },
  async (t) => {
    const origin = "http://127.0.0.1:55175";
    assert.ok(env.corsOrigins.includes(origin), "Set CORS_ORIGINS=http://127.0.0.1:55175");
    const f = await payrollCloseFixture(4, true);
    const customerId = await seedHoldingHistory(f, "holding history");
    const reporting = await payrollReportingFixture(f);
    const directory = await mkdtemp(join(tmpdir(), "cp006-chrome-"));
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
      const labeled = (value: string) =>
        `[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(value)})`;
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
      /** Mounts the app as one real user; the token is the same one the API issues. */
      const navigate = async (
        id: string,
        role: "SUPER_ADMIN" | "MANAGER" | "STAFF" | "CASHIER",
        path: string,
        ready: string,
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
        const marker = `${role}-${Date.now()}-${Math.random()}`;
        const script = await browser.send("Page.addScriptToEvaluateOnNewDocument", {
          source: `localStorage.clear(); sessionStorage.clear(); localStorage.setItem('glampro.accessToken',${JSON.stringify(token)}); localStorage.setItem('glampro.refreshToken','synthetic-bootstrap-only'); sessionStorage.setItem('cp006-navigation',${JSON.stringify(marker)}); ${outletId ? `sessionStorage.setItem('glampro.outlet.v1',${JSON.stringify(outletId)});` : ""}`,
        });
        scriptId = String(script.identifier);
        await browser.send("Page.navigate", { url: `${origin}${path}` });
        await browser.wait(
          `sessionStorage.getItem('cp006-navigation') === ${JSON.stringify(marker)}`,
        );
        await browser.wait(ready);
      };
      /** Loads one payroll month in the close screen and waits for that month's own state. */
      const loadMonth = async (period: string) => {
        await fill("Payroll month", period);
        await click("Load month");
        // The state line starts with the loaded month, so a stale view cannot satisfy it.
        await browser.wait(text(`${period}:`));
      };
      /** Bytes of a frozen export, read in the page with the mounted session. */
      const exportBytes = (path: string) =>
        browser.evaluate(`fetch(${JSON.stringify(path)}, {
          headers: { Authorization: 'Bearer ' + localStorage.getItem('glampro.accessToken') },
        }).then(async (r) => {
          const bytes = new Uint8Array(await r.arrayBuffer());
          return {
            status: r.status,
            type: r.headers.get('content-type'),
            disposition: r.headers.get('content-disposition'),
            size: bytes.length,
            magic: [...bytes.slice(0, 4)],
            head: new TextDecoder().decode(bytes.slice(0, 600)),
          };
        })`) as Promise<{
          status: number;
          type: string;
          disposition: string;
          size: number;
          magic: number[];
          head: string;
        }>;

      await t.test(
        "owner freezes the reviewed month through the mounted close screen",
        async () => {
          await navigate(
            f.ownerId,
            "SUPER_ADMIN",
            "/settings?section=payroll",
            text("Monthly payroll close"),
          );
          await loadMonth("2026-09");
          await click("Calculate payroll");
          await browser.wait(
            `${button("Approve payroll")} && !${button("Approve payroll")}.disabled`,
          );
          await browser.wait(text("Close Staff"));
          await fill("Payroll action reason", "Reviewed browser approval for CP-006");
          await click("Approve payroll");
          await browser.wait(text("2026-09: APPROVED"));
          assert.equal(await browser.evaluate(`Boolean(${button("Calculate payroll")})`), false);
          assert.equal(await f.scope(() => prisma.payrollClose.count()), 1);
        },
      );

      await t.test(
        "owner closes the carry month, then leaves the open month as a draft estimate",
        async () => {
          // The open month needs the month before it approved before it may calculate at all.
          assert.notEqual(
            currentPeriod,
            "2026-09",
            "the open month must differ from the closed one",
          );
          await loadMonth("2026-10");
          await click("Calculate payroll");
          await browser.wait(
            `${button("Approve payroll")} && !${button("Approve payroll")}.disabled`,
          );
          await fill("Payroll action reason", "Reviewed browser approval for the carry month");
          await click("Approve payroll");
          await browser.wait(text("2026-10: APPROVED"));
          await loadMonth(currentPeriod);
          await click("Calculate payroll");
          await browser.wait(
            `(${button("Approve payroll")} && !${button("Approve payroll")}.disabled) || document.querySelector('[role="alert"]')`,
          );
          const failure = await browser.evaluate(
            `document.querySelector('[role="alert"]')?.textContent ?? null`,
          );
          assert.equal(failure, null, `the open month must calculate, not fail: ${failure}`);
          await browser.wait(text(`${currentPeriod}: CALCULATED`));
        },
      );

      await t.test(
        "owner reads the frozen report, drills into base lines and downloads all three exports",
        async () => {
          await navigate(
            f.ownerId,
            "SUPER_ADMIN",
            "/settings?section=payroll",
            text("Monthly payroll close"),
          );
          await loadMonth("2026-09");
          await browser.wait(text("Frozen payroll statements"));
          await browser.wait(text("Period report"));
          const report = `document.querySelector('[aria-label="Payroll period report"]')`;
          // The owner sees salary on the frozen statements, but never in the report or exports.
          assert.equal(
            await browser.evaluate(
              `[...document.querySelectorAll('th')].some(h => h.textContent === 'Salary')`,
            ),
            true,
          );
          assert.equal(await browser.evaluate(`${report}.innerText.includes('Salary')`), false);
          assert.equal(await browser.evaluate(`${report}.innerText.includes('Take home')`), false);
          assert.equal(
            await browser.evaluate(`${report}.innerText.includes('Base amount (4 dp)')`),
            true,
          );
          assert.equal(await browser.evaluate(`${report}.innerText.includes('2026-09')`), true);

          await browser.wait(
            `${labeled("Base lines for Close Staff")} && !${labeled("Base lines for Close Staff")}.disabled`,
          );
          await browser.evaluate(`${labeled("Base lines for Close Staff")}.click()`);
          await browser.wait(text("Frozen base lines for Close Staff"));
          const lines = await browser.evaluate(`(() => {
            const table = [...document.querySelectorAll('table')].find(t => t.querySelector('caption')?.textContent?.startsWith('Frozen base lines'));
            return table ? table.querySelectorAll('tbody tr').length : 0;
          })()`);
          assert.ok(
            Number(lines) >= 1,
            "the drill-down must show the frozen lines behind a staff row",
          );
          assert.equal(
            await browser.evaluate(
              `[...document.querySelectorAll('th')].some(h => h.textContent === 'Source')`,
            ),
            true,
          );
          assert.equal(await browser.evaluate(`${report}.innerText.includes('Salary')`), false);
        },
      );

      await t.test(
        "all three frozen exports download with real bytes and a filtered ledger",
        async () => {
          await click("Download workbook");
          await browser.wait(text("Downloaded payroll-2026-09.xlsx."));
          await click("Download payslips");
          await browser.wait(text("Downloaded payroll-payslips-2026-09.pdf."));
          await click("Download ledger");
          await browser.wait(text("Downloaded payroll-base-ledger-2026-09.csv."));

          const workbook = await exportBytes("/api/payroll-close/2026-09/exports/workbook.xlsx");
          assert.equal(workbook.status, 200);
          assert.deepEqual(workbook.magic, [0x50, 0x4b, 0x03, 0x04]);
          assert.match(String(workbook.type), /spreadsheetml/);
          assert.match(String(workbook.disposition), /payroll-2026-09\.xlsx/);
          assert.ok(workbook.size > 2000, "the workbook must carry real sheet data");

          const payslips = await exportBytes("/api/payroll-close/2026-09/exports/payslips.pdf");
          assert.equal(payslips.status, 200);
          assert.deepEqual(payslips.magic, [0x25, 0x50, 0x44, 0x46]);
          assert.match(String(payslips.disposition), /payroll-payslips-2026-09\.pdf/);
          assert.ok(payslips.size > 1000, "the payslip PDF must carry real pages");

          const ledger = (path: string) =>
            browser.evaluate(
              `fetch(${JSON.stringify(path)},{headers:{Authorization:'Bearer '+localStorage.getItem('glampro.accessToken')}}).then(async r => {
                const bytes = new Uint8Array(await r.arrayBuffer());
                return { bom: [...bytes.slice(0, 3)], text: new TextDecoder().decode(bytes) };
              })`,
            ) as Promise<{ bom: number[]; text: string }>;
          const all = await ledger("/api/payroll-close/2026-09/exports/ledger.csv");
          assert.deepEqual(all.bom, [0xef, 0xbb, 0xbf], "the CSV keeps its UTF-8 BOM for Excel");
          assert.ok(all.text.startsWith("Period,Staff ID,Staff,"));
          assert.ok(all.text.endsWith("\r\n"));
          const rows = all.text.split("\r\n").slice(1, -1);
          assert.equal(rows.length, 5, "four service bases plus the package purchase base");
          assert.deepEqual(rows.map((row) => row.split(",")[2]).sort(), [
            "Close Cashier",
            "Close Manager",
            "Close Owner",
            "Close Staff",
            "Close Staff",
          ]);
          const filtered = await ledger(
            `/api/payroll-close/2026-09/exports/ledger.csv?staffId=${f.staffId}`,
          );
          const filteredRows = filtered.text.split("\r\n").slice(1, -1);
          assert.equal(filteredRows.length, 2);
          assert.equal(filteredRows[0]!.split(",")[2], "Close Staff");
        },
      );

      await t.test(
        "manager reads the same frozen report without salary, owner controls or exports",
        async () => {
          await navigate(
            f.managerId,
            "MANAGER",
            "/settings?section=payroll",
            text("Monthly payroll close"),
          );
          await loadMonth("2026-09");
          await browser.wait(text("Frozen payroll statements"));
          await browser.wait(text("Period report"));
          assert.equal(
            await browser.evaluate(
              `[...document.querySelectorAll('th')].some(h => ['Salary','Take home'].includes(h.textContent))`,
            ),
            false,
          );
          assert.equal(
            await browser.evaluate(
              `Boolean(${button("Approve payroll")} || ${button("Download workbook")} || ${button("Download payslips")} || ${button("Download ledger")})`,
            ),
            false,
          );
          const statuses = await browser.evaluate(`Promise.all([
            fetch('/api/payroll-close/2026-09/report',{headers:{Authorization:'Bearer '+localStorage.getItem('glampro.accessToken')}}).then(r=>r.status),
            fetch('/api/payroll-close/2026-09/exports/ledger.csv',{headers:{Authorization:'Bearer '+localStorage.getItem('glampro.accessToken')}}).then(r=>r.status),
            fetch('/api/payroll-close/2026-09/approve',{method:'POST',headers:{Authorization:'Bearer '+localStorage.getItem('glampro.accessToken'),'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:2,reason:'Manager attempt'})}).then(r=>r.status),
          ])`);
          assert.deepEqual(statuses, [200, 403, 403]);
        },
      );

      await t.test("staff member reads only their own progress and frozen statement", async () => {
        await navigate(
          f.staffId,
          "STAFF",
          "/settings?section=my-payroll",
          text("Your frozen statements"),
        );
        await browser.wait(text("Your month-to-date progress"));
        // The open month is a draft: the card must call it an estimate, never a freeze.
        await browser.wait(
          text("Later sales and redemptions appear after the month is recalculated"),
        );
        assert.equal(await browser.evaluate(text("Estimated")), true);
        // The explanation mentions salary; no column or figure may carry one.
        assert.equal(
          await browser.evaluate(
            `[...document.querySelectorAll('th')].some(h => ['Salary','Take home','Basic salary'].includes(h.textContent))`,
          ),
          false,
        );
        // Only the approved month is listed; the open draft is not a statement yet.
        const listed = await browser.evaluate(`(() => {
          const table = [...document.querySelectorAll('table')].find(t => t.querySelector('caption')?.textContent === 'Your frozen payroll statements');
          return [...(table?.querySelectorAll('tbody tr') ?? [])].map(row => row.cells[0].textContent);
        })()`);
        assert.deepEqual(listed, ["2026-10", "2026-09"]);
        await browser.wait(`${labeled("Open your 2026-09 statement")}`);
        await browser.evaluate(`${labeled("Open your 2026-09 statement")}.click()`);
        await browser.wait(text("Commission components"));
        assert.equal(
          await browser.evaluate(
            `[...document.querySelectorAll('th')].some(h => ['Salary','Take home'].includes(h.textContent))`,
          ),
          false,
        );
        const history = (await browser.evaluate(
          `fetch('/api/payroll-close/statements',{headers:{Authorization:'Bearer '+localStorage.getItem('glampro.accessToken')}}).then(r=>r.json())`,
        )) as { data: { statements: Record<string, unknown>[]; limit: number; hasMore: boolean } };
        assert.deepEqual(
          history.data.statements.map((row) => row.periodKey),
          ["2026-10", "2026-09"],
        );
        assert.equal(history.data.limit, 12);
        // The projection names nobody and carries no salary: it is already the caller's own.
        assert.deepEqual(Object.keys(history.data.statements[0]!).sort(), [
          "approvedAt",
          "baseAmount",
          "calculation",
          "collection",
          "commission",
          "incentive",
          "lines",
          "paidAt",
          "periodKey",
          "status",
          "units",
        ]);
        const statuses = await browser.evaluate(`Promise.all([
          fetch('/api/payroll-close/2026-09/report',{headers:{Authorization:'Bearer '+localStorage.getItem('glampro.accessToken')}}).then(r=>r.status),
          fetch('/api/payroll-close/2026-09/exports/payslips.pdf',{headers:{Authorization:'Bearer '+localStorage.getItem('glampro.accessToken')}}).then(r=>r.status),
        ])`);
        assert.deepEqual(statuses, [403, 403]);
      });

      await t.test(
        "cashier is told the panel is not theirs and the API refuses the read",
        async () => {
          await navigate(
            f.cashierId,
            "CASHIER",
            "/settings?section=my-payroll",
            text("Commission statements belong to the staff member they were calculated for."),
          );
          assert.equal(await browser.evaluate(text("Your month-to-date progress")), false);
          assert.equal(
            await browser.evaluate(
              `fetch('/api/payroll-close/statements',{headers:{Authorization:'Bearer '+localStorage.getItem('glampro.accessToken')}}).then(r=>r.status)`,
            ),
            403,
          );
        },
      );

      await t.test(
        "the till shows the seller's own progress and nothing for a cashier",
        async () => {
          const tillReady = `document.querySelector('input[placeholder^="Search services"]')`;
          await navigate(f.staffId, "STAFF", "/sale", tillReady);
          await browser.wait(text("Your commission progress"));
          await browser.wait(
            text("Later sales and redemptions appear after the month is recalculated"),
          );
          assert.equal(await browser.evaluate(text("Basic salary")), false);
          await navigate(f.cashierId, "CASHIER", "/sale", tillReady);
          assert.equal(await browser.evaluate(text("Your commission progress")), false);
        },
      );

      await t.test(
        "owner reads package percentage rules without a second configuration writer",
        async () => {
          await f.scope(() =>
            prisma.commissionRule.create({
              data: {
                tenantId: f.tenantId,
                staffId: null,
                itemKind: "PACKAGE_SALE",
                scope: "PACKAGE",
                targetId: reporting.pkg.id,
                scopeKey: `package-browser-${reporting.pkg.id}`,
                rate: "7",
                effectiveAt: new Date(),
                actorId: f.ownerId,
                reason: "Browser read-only package rule",
              },
            }),
          );
          await navigate(f.ownerId, "SUPER_ADMIN", "/products", text("Products"));
          await browser.wait(
            `[...document.querySelectorAll('[role="tab"]')].some(tab => tab.textContent === 'Packages')`,
          );
          await browser.evaluate(
            `[...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === 'Packages').click()`,
          );
          await browser.wait(text(reporting.pkg.name));
          await browser.evaluate(
            `[...document.querySelectorAll('tr')].find(row => row.textContent.includes(${JSON.stringify(reporting.pkg.name)})).querySelector('button').click()`,
          );
          await browser.wait(text("Package percentage rules (read-only)"));
          await browser.wait(text("Browser read-only package rule"));
          const panel = `document.querySelector('[aria-label="Package percentage rules"]')`;
          assert.equal(
            await browser.evaluate(`${panel}.querySelectorAll('input,select,button').length`),
            0,
          );
          assert.equal(
            await browser.evaluate(`${panel}.querySelector('a').getAttribute('href')`),
            "/settings?section=team&team=rules",
          );
        },
      );

      await t.test(
        "staff cart preview renders a conditional own estimate without posting",
        async () => {
          const tillReady = `document.querySelector('input[placeholder^="Search services"]')`;
          const before = await f.scope(() => prisma.payrollSourceEvent.count());
          await navigate(f.staffId, "STAFF", "/sale", tillReady);
          await browser.wait(
            `document.querySelector('button[aria-label^="Add "][aria-label*="to the cart"]')`,
          );
          await browser.evaluate(
            `document.querySelector('button[aria-label^="Add "][aria-label*="to the cart"]').click()`,
          );
          // Services require an explicit performer; the seller default must not invent one.
          await browser.wait(text("Commission attribution"));
          await click("Commission attribution");
          await click("Add therapist");
          await browser.wait(
            `document.querySelector('select[aria-label="Staff member"]') || ${text("Performing therapists")}`,
          );
          const performerSelect = `document.querySelector('select[aria-label="performers staff 1"]')`;
          await browser.wait(
            `${performerSelect} && [...${performerSelect}.options].some(option => option.value === ${JSON.stringify(f.staffId)})`,
          );
          await browser.evaluate(
            `(() => { const select = ${performerSelect}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(f.staffId)}); select.dispatchEvent(new Event('change',{bubbles:true})); })()`,
          );
          await click("Save attribution");
          await browser.wait(text("Hypothetical fully money-paid line"));
          assert.equal(await browser.evaluate(text("Nothing is posted")), true);
          assert.equal(await f.scope(() => prisma.payrollSourceEvent.count()), before);
          // Continue through the actual payment sheet with a customer-owned
          // package. The package need not be usable for the synthetic line: zero
          // coverage must explicitly remain unavailable, never borrow cash value.
          const customerSearch = `document.querySelector('input[aria-label="Attach a customer by name or phone"]')`;
          await browser.evaluate(`${customerSearch}.focus()`);
          await browser.send("Input.insertText", { text: "Reporting package buyer" });
          await browser.wait(
            `document.querySelector('button[aria-label="Attach Reporting package buyer"]')`,
          );
          await browser.evaluate(
            `document.querySelector('button[aria-label="Attach Reporting package buyer"]').click()`,
          );
          await click("Take payment");
          const tender = field("Tender 1");
          await browser.wait(
            `${tender} && [...${tender}.options].some(option => option.value === 'PACKAGE')`,
          );
          await browser.evaluate(
            `Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(${tender},'PACKAGE'); ${tender}.dispatchEvent(new Event('change',{bubbles:true}));`,
          );
          await browser.wait(text("Estimated session commission"));
          assert.equal(await browser.evaluate(text("explicit performers")), true);
          assert.equal(await f.scope(() => prisma.payrollSourceEvent.count()), before);
        },
      );

      await reporting.seedSessions(currentPeriod);
      await t.test(
        "management report panels filter approved bases and show distinct utilisation units",
        async () => {
          await navigate(f.managerId, "MANAGER", "/reports", text("Customer balances"));
          await browser.evaluate(
            `[...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === 'Customer balances').click()`,
          );
          await browser.wait(text("Commission detail"));
          await browser.wait(text("No approved payroll snapshot for this month."));
          await fill("Commission month", "2026-09");
          await browser.wait(`document.querySelector('caption') && ${text("matching base lines")}`);
          await fill("Package ID", reporting.pkg.id);
          await browser.wait(text("1 matching base lines"));
          const table = `[...document.querySelectorAll('table')].find(table => table.querySelector('caption')?.textContent === 'Approved commission bases')`;
          assert.equal(await browser.evaluate(`${table}.querySelectorAll('tbody tr').length`), 1);
          assert.equal(
            await browser.evaluate(
              `${table}.innerText.includes(${JSON.stringify(reporting.customer.id)})`,
            ),
            true,
          );
          await browser.wait(
            `${button("Export commission detail (Excel)")} && !${button("Export commission detail (Excel)")}.disabled`,
          );
          const file = await exportBytes(
            `/api/payroll-close/commission-detail.xlsx?period=2026-09&packageId=${reporting.pkg.id}`,
          );
          assert.equal(file.status, 200);
          assert.deepEqual(file.magic.slice(0, 2), [80, 75]);
          const utilisation = `[...document.querySelectorAll('table')].find(table => table.querySelector('caption')?.textContent === 'Package utilisation')`;
          await browser.wait(
            `${utilisation}?.innerText.includes('Reporting four-session package')`,
          );
          assert.deepEqual(
            await browser.evaluate(
              `[...${utilisation}.querySelector('tbody tr').cells].map(cell => cell.textContent)`,
            ),
            [reporting.pkg.name, "1", "2", "1"],
          );
          await fill("Package ID", "missing-evidence");
          await browser.wait(text("0 matching base lines"));
          assert.equal(await browser.evaluate(`${table}.querySelectorAll('tbody tr').length`), 0);
          await fill("Package ID", reporting.pkg.id);
          await fill("Through payroll month (optional)", "2026-10");
          await browser.wait(text("1 matching base lines"));
          const range = await exportBytes(
            `/api/payroll-close/commission-detail.xlsx?period=2026-09&throughPeriod=2026-10&packageId=${reporting.pkg.id}`,
          );
          assert.equal(range.status, 200);
          assert.deepEqual(range.magic.slice(0, 2), [80, 75]);
        },
      );

      await t.test(
        "staff sees only own recorded sessions and no signature or customer identity",
        async () => {
          await navigate(
            f.staffId,
            "STAFF",
            "/settings?section=my-payroll",
            text("My recorded package sessions"),
          );
          const section = `document.querySelector('[aria-label="My recorded package sessions"]')`;
          await browser.wait(
            `${section}.innerText.includes('your share 100% · VOIDED') && ${section}.innerText.includes('your share 100% · ACTIVE')`,
          );
          const response = (await browser.evaluate(
            `fetch('/api/payroll-close/my-sessions?period=${currentPeriod}',{headers:{Authorization:'Bearer '+localStorage.getItem('glampro.accessToken')}}).then(r=>r.json())`,
          )) as { data: { rows: { status: string }[]; total: number } };
          assert.equal(response.data.total, 2);
          assert.deepEqual(
            response.data.rows.map((row) => row.status),
            ["VOIDED", "ACTIVE"],
          );
          assert.equal(JSON.stringify(response).includes("synthetic-recorded-signature"), false);
          assert.equal(JSON.stringify(response).includes(reporting.customer.id), false);
        },
      );

      await t.test(
        "customer session drawer distinguishes recorded and unsigned evidence, including voids",
        async () => {
          await navigate(
            f.ownerId,
            "SUPER_ADMIN",
            `/customers/${reporting.customer.id}?tab=packages`,
            text("Balances and actions"),
          );
          await click(`Purchase & payments for ${reporting.pkg.name}`);
          await browser.wait(text("Customer signed"));
          await browser.wait(`${text("Recorded")} && ${text("Not recorded")}`);
          assert.equal(await browser.evaluate(text("synthetic-recorded-signature")), false);
          assert.equal(await browser.evaluate(text("Voided")), true);
        },
      );

      await t.test("customer profile renders the holding history of a real purchase", async () => {
        await navigate(
          f.ownerId,
          "SUPER_ADMIN",
          `/customers/${customerId}?tab=packages`,
          text("Balances and actions"),
        );
        await browser.wait(`document.querySelector('dl[aria-label="Holding totals"]')`);
        const totals = String(
          await browser.evaluate(
            `document.querySelector('dl[aria-label="Holding totals"]').innerText`,
          ),
        );
        assert.match(totals, /Unused session value/);
        assert.match(totals, /Unused credit/);
        assert.match(totals, /Owed on these sales/);
        // The purchase itself is listed, priced from the source sale rather than recomputed.
        await browser.wait(text("Browser 545 for 600"));
      });
    } finally {
      vite?.kill();
      server.close();
      browser.process.kill();
      // Chrome writes into its profile directory while shutting down; retry the cleanup.
      await new Promise((resolve) => setTimeout(resolve, 500));
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    }
  },
);
