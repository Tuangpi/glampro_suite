import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.js";
import type { GlobalRole } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { signAccessToken } from "../lib/tokens.js";
import { payrollInputHash } from "../services/payroll-close-state.js";
import type { PayrollCloseState } from "../services/payroll-close-state.js";
import {
  approvedPayrollExportState,
  calculatedPayrollExportState,
} from "../services/payroll-export.test-helper.js";

const restorers: (() => void)[] = [];
function replace<T extends object>(target: T, key: keyof T, value: unknown) {
  const original = target[key];
  Reflect.set(target, key, value);
  restorers.push(() => {
    Reflect.set(target, key, original);
  });
}
const app = createApp();
let server: ReturnType<typeof app.listen>;
let base: string;
let role: GlobalRole;
let enabled: boolean;
let status: "ACTIVE" | "SUSPENDED";
let transactions: number;
/** Frozen close the payroll store reports for the current test, or null for none. */
let storedClose: {
  periodKey: string;
  revision: number;
  status: string;
  state: PayrollCloseState;
} | null = null;
/** Source events the drill-down may resolve; reset per test. */
let sourceEvents: {
  sourceKey: string;
  sourceType: string;
  sourceId: string;
  saleId: string;
  occurredAt: Date;
}[] = [];
/** Every `sourceKey IN (...)` list the store asked for, so tenant scoping stays visible. */
let sourceLookups: string[][] = [];
/** Snapshots the store snapshot as approved or draft so export gating can be exercised. */
function storePayrollClose(approved: boolean) {
  const state = approved ? approvedPayrollExportState() : calculatedPayrollExportState();
  storedClose = {
    periodKey: state.periodKey,
    revision: state.revision,
    status: state.status,
    state,
  };
}
const token = (overrides: Partial<Parameters<typeof signAccessToken>[0]> = {}) =>
  signAccessToken({
    id: "actor",
    email: "actor@example.test",
    globalRole: role,
    realm: "web",
    tenantId: "salon",
    tokenVersion: 0,
    ...overrides,
  }).token;
async function request(path = "/2026-09", body?: unknown, bearer: string | null = token()) {
  return fetch(`${base}/api/payroll-close${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
before(async () => {
  replace(prisma.user, "findUnique", async () => ({
    id: "actor",
    tenantId: "salon",
    email: "actor@example.test",
    name: "Actor",
    globalRole: role,
    tokenVersion: 0,
    disabled: false,
    twoFactorEnabled: true,
  }));
  replace(prisma.tenant, "findUnique", async () => ({
    id: "salon",
    name: "Salon",
    slug: "salon",
    status,
    subscriptions: [{ endDate: new Date("2099-01-01") }],
  }));
  replace(prisma.module, "findMany", async () => [{ code: "staff", isCore: false }]);
  replace(prisma.outlet, "findFirst", async () => ({ id: "branch", status: "ACTIVE" }));
  replace(prisma.tenantModule, "findMany", async () =>
    enabled ? [{ expiresAt: null, module: { code: "staff" } }] : [],
  );
  replace(prisma, "$transaction", async (callback: (tx: unknown) => Promise<unknown>) => {
    transactions++;
    assert.deepEqual(currentScope(), { kind: "tenant", tenantId: "salon", actorId: "actor" });
    return callback({
      $executeRaw: async () => 1,
      $queryRaw: async () => [],
      user: {
        findFirst: async () => ({
          id: "actor",
          globalRole: role,
          disabled: false,
          twoFactorEnabled: true,
        }),
      },
      payrollClose: { findFirst: async () => storedClose },
      payrollCloseEvent: {
        findFirst: async () =>
          storedClose
            ? { stateHash: payrollInputHash(storedClose.state), state: storedClose.state }
            : null,
      },
      payrollSourceEvent: {
        findMany: async (args: { where: { sourceKey: { in: string[] } } }) => {
          sourceLookups.push(args.where.sourceKey.in);
          return sourceEvents.filter((event) => args.where.sourceKey.in.includes(event.sourceKey));
        },
      },
    });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => {
  role = "SUPER_ADMIN";
  enabled = true;
  status = "ACTIVE";
  transactions = 0;
  storedClose = null;
  sourceEvents = [];
  sourceLookups = [];
});
after(async () => {
  for (const restore of restorers.reverse()) restore();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("real auth rejects missing, platform and cross-tenant tokens before close persistence", async () => {
  assert.equal((await request("/2026-09", undefined, null)).status, 401);
  assert.equal((await request("/2026-09", undefined, token({ realm: "platform" }))).status, 403);
  assert.equal((await request("/2026-09", undefined, token({ tenantId: "foreign" }))).status, 401);
  assert.equal(transactions, 0);
});
test("module and staff permissions deny management reads and owner actions", async () => {
  enabled = false;
  assert.equal((await request()).status, 403);
  enabled = true;
  role = "STAFF";
  assert.equal((await request()).status, 403);
  for (const action of ["calculate", "approve", "payout", "opening", "settlements", "adjustments"])
    assert.equal((await request(`/2026-09/${action}`, {})).status, 403);
  role = "MANAGER";
  for (const action of ["approve", "payout", "opening", "settlements"])
    assert.equal((await request(`/2026-09/${action}`, {})).status, 403);
  assert.equal(transactions, 0);
});
test("owner and manager reads use authenticated scope and never trigger calculation", async () => {
  for (const globalRole of ["SUPER_ADMIN", "MANAGER"] as const) {
    role = globalRole;
    const response = await request();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      data: {
        periodKey: "2026-09",
        revision: 0,
        status: "OPEN",
        adjustments: [],
        calculation: null,
        approval: null,
        payout: null,
      },
    });
  }
  assert.equal(transactions, 2);
});
test("strict requests reject injected inputs, actor identities and invalid revisions", async () => {
  for (const body of [
    { expectedRevision: -1 },
    { expectedRevision: 0, sources: [] },
    { expectedRevision: 0, loader: "client" },
    { expectedRevision: 0, actorId: "other" },
  ])
    assert.equal((await request("/2026-09/calculate", body)).status, 422);
  assert.equal((await request("/2026-13")).status, 422);
  assert.equal(
    (
      await request("/2026-09/adjustments", {
        expectedRevision: 0,
        adjustment: {
          id: "adjustment",
          staffId: "actor",
          actorId: "forged",
          kind: "ADDITION",
          amount: "1.00",
          reason: "Testing",
        },
      })
    ).status,
    422,
  );
  assert.equal(transactions, 0);
});
test("suspended salons cannot mutate payroll", async () => {
  status = "SUSPENDED";
  assert.equal((await request("/2026-09/calculate", { expectedRevision: 0 })).status, 403);
  assert.equal(transactions, 0);
});
test("outlet-scoped close reads refuse rather than exposing salon-wide payroll", async () => {
  const response = await fetch(`${base}/api/payroll-close/2026-09`, {
    headers: { Authorization: `Bearer ${token()}`, "x-outlet-id": "branch" },
  });
  assert.equal(response.status, 403);
  assert.equal(transactions, 0);
});
test("own-statement reads do not expose another staff route to staff or managers", async () => {
  for (const globalRole of ["STAFF", "MANAGER"] as const) {
    role = globalRole;
    assert.equal((await request("/2026-09/statements/other")).status, 403);
    assert.equal((await request("/2026-09/statement")).status, 404);
  }
});

test("cashiers cannot read even their own payroll statement", async () => {
  role = "CASHIER";
  assert.equal((await request("/2026-09/statement")).status, 403);
  assert.equal((await request()).status, 403);
  assert.equal(transactions, 0);
});
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const EXPORTS = ["workbook.xlsx", "payslips.pdf", "ledger.csv"] as const;
const exportPath = (kind: string, query = "") => `/2026-09/exports/${kind}${query}`;

test("frozen exports are owner-only and never open the payroll store for other roles", async () => {
  storePayrollClose(true);
  for (const globalRole of ["MANAGER", "STAFF", "CASHIER"] as const) {
    role = globalRole;
    for (const kind of EXPORTS)
      assert.equal((await request(exportPath(kind))).status, 403, `${globalRole} ${kind}`);
  }
  for (const kind of EXPORTS)
    assert.equal((await request(exportPath(kind), undefined, null)).status, 401, kind);
  assert.equal(transactions, 0);
});

test("exports refuse a close that is not an approved snapshot and write no file", async () => {
  storePayrollClose(false);
  for (const kind of EXPORTS) assert.equal((await request(exportPath(kind))).status, 409, kind);
  storedClose = null;
  assert.equal((await request(exportPath("workbook.xlsx"))).status, 409);
  assert.equal(transactions, 4);
});

test("approved close downloads a workbook, payslips and a filtered ledger as attachments", async () => {
  storePayrollClose(true);
  const workbook = await request(exportPath("workbook.xlsx"));
  assert.equal(workbook.status, 200);
  assert.equal(workbook.headers.get("content-type"), XLSX_TYPE);
  assert.equal(
    workbook.headers.get("content-disposition"),
    'attachment; filename="payroll-2026-09.xlsx"',
  );
  assert.equal(workbook.headers.get("cache-control"), "no-store");
  assert.equal(workbook.headers.get("x-content-type-options"), "nosniff");
  const bytes = Buffer.from(await workbook.arrayBuffer());
  assert.equal(bytes.subarray(0, 2).toString("latin1"), "PK");

  const payslips = await request(exportPath("payslips.pdf"));
  assert.equal(payslips.status, 200);
  assert.equal(payslips.headers.get("content-type"), "application/pdf");
  assert.equal(
    payslips.headers.get("content-disposition"),
    'attachment; filename="payroll-payslips-2026-09.pdf"',
  );
  assert.equal(
    Buffer.from(await payslips.arrayBuffer())
      .subarray(0, 5)
      .toString("latin1"),
    "%PDF-",
  );

  const ledger = await request(exportPath("ledger.csv", "?staffId=staff-a&commissionType=SVC"));
  assert.equal(ledger.status, 200);
  assert.equal(ledger.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(
    ledger.headers.get("content-disposition"),
    'attachment; filename="payroll-base-ledger-2026-09.csv"',
  );
  const ledgerBytes = Buffer.from(await ledger.arrayBuffer());
  assert.equal(
    ledgerBytes.subarray(0, 3).toString("hex"),
    "efbbbf",
    "ledger CSV keeps its UTF-8 BOM",
  );
  const csv = ledgerBytes.toString("utf8");
  assert.ok(csv.includes("line-a-1"), "matching line is exported");
  assert.ok(!csv.includes("line-a-2"), "filtered commission type is excluded");
  assert.ok(!csv.includes("line-b-1"), "filtered staff is excluded");
  assert.equal(transactions, 3);
});

test("ledger export validates filters before the store is opened", async () => {
  storePayrollClose(true);
  for (const query of [
    "?staffId=",
    "?commissionType=NOPE",
    "?status=OPEN",
    "?from=2026-09-30x",
    "?actorId=forged",
  ])
    assert.equal((await request(exportPath("ledger.csv", query))).status, 422, query);
  assert.equal(
    (await request(exportPath("ledger.csv", "?from=2026-09-30&to=2026-09-01"))).status,
    400,
    "reversed date range is a bad request",
  );
  assert.equal(transactions, 1);
});

const REPORT = "/2026-09/report";
const linesPath = (staffId: string, query = "") => `/2026-09/statements/${staffId}/lines${query}`;

test("the period report and drill-down are management-only and open no store for others", async () => {
  storePayrollClose(true);
  for (const globalRole of ["STAFF", "CASHIER"] as const) {
    role = globalRole;
    assert.equal((await request(REPORT)).status, 403, globalRole);
    assert.equal((await request(linesPath("staff-a"))).status, 403, globalRole);
  }
  assert.equal((await request(REPORT, undefined, null)).status, 401);
  assert.equal((await request(linesPath("staff-a"), undefined, null)).status, 401);
  assert.equal(transactions, 0);
});

test("report reads refuse a month that has no approved snapshot", async () => {
  assert.equal((await request(REPORT)).status, 409);
  storePayrollClose(false);
  assert.equal((await request(REPORT)).status, 409);
  assert.equal(
    (await request(linesPath("staff-a"))).status,
    409,
    "a calculated draft is not reportable",
  );
  assert.equal(transactions, 3);
});

test("the approved report returns frozen totals, breakdowns and never salary", async () => {
  storePayrollClose(true);
  const response = await request(REPORT);
  assert.equal(response.status, 200);
  assert.match(String(response.headers.get("content-type")), /application\/json/);
  const text = await response.text();
  const { data } = JSON.parse(text) as {
    data: {
      periodKey: string;
      totals: Record<string, string | number>;
      staff: { staff: { id: string }; payroll: Record<string, string> }[];
      approval: { at: string; reason: string };
    };
  };
  assert.equal(data.periodKey, "2026-09");
  assert.equal(data.totals.staff, 2);
  assert.equal(data.totals.lines, 3);
  assert.equal(data.totals.baseAmount, "2400.7500");
  assert.equal(data.totals.units, "6.0000");
  assert.deepEqual(
    data.staff.map((row) => row.staff.id),
    ["staff-a", "staff-b"],
  );
  assert.ok(data.approval.at, "the approval the report belongs to stays visible");
  for (const field of ["basicSalary", "takeHome", "fixedOvertime", "levy"])
    assert.ok(!text.includes(field), `report must not expose ${field}`);
  role = "MANAGER";
  assert.equal((await request(REPORT)).status, 200, "managers may read commission figures");
  assert.equal(transactions, 2);
});

test("drill-down filters, paginates and attaches the captured source record", async () => {
  storePayrollClose(true);
  sourceEvents = [
    {
      sourceKey: "line-a-1",
      sourceType: "SALE_LINE",
      sourceId: "sale-line-1",
      saleId: "sale-1",
      occurredAt: new Date("2026-09-05T04:00:00.000Z"),
    },
  ];
  const first = await request(linesPath("staff-a", "?limit=1&page=1"));
  assert.equal(first.status, 200);
  const page = (await first.json()) as {
    data: {
      staff: { id: string; name: string };
      total: number;
      pages: number;
      matching: { lines: number; baseAmount: string };
      lines: { line: { id: string }; source: { sourceType: string; saleId: string } | null }[];
    };
  };
  assert.equal(page.data.staff.id, "staff-a");
  assert.equal(page.data.total, 2);
  assert.equal(page.data.pages, 2);
  assert.equal(page.data.matching.lines, 2);
  assert.equal(page.data.matching.baseAmount, "2150.5000");
  assert.equal(page.data.lines.length, 1);
  assert.equal(page.data.lines[0]!.line.id, "line-a-1");
  assert.equal(page.data.lines[0]!.source?.sourceType, "SALE_LINE");
  assert.equal(page.data.lines[0]!.source?.saleId, "sale-1");
  assert.deepEqual(sourceLookups, [["line-a-1"]], "only the visible page is looked up");

  const second = await request(linesPath("staff-a", "?limit=1&page=2"));
  const secondPage = (await second.json()) as typeof page;
  assert.equal(secondPage.data.lines[0]!.line.id, "line-a-2");
  assert.equal(secondPage.data.lines[0]!.source, null, "no captured event stays null");

  const byType = await request(linesPath("staff-a", "?commissionType=PRD"));
  const typed = (await byType.json()) as typeof page;
  assert.equal(typed.data.total, 1, "the filter only keeps the PRD line");
  assert.equal(typed.data.lines[0]!.line.id, "line-a-2");

  const byOutlet = await request(linesPath("staff-a", "?outletId=outlet-b"));
  assert.equal(((await byOutlet.json()) as typeof page).data.total, 1);
  assert.equal((await request(linesPath("staff-z"))).status, 404);
});

test("drill-down refuses unknown filters before the store is opened", async () => {
  storePayrollClose(true);
  for (const query of [
    "?staffId=staff-b",
    "?commissionType=NOPE",
    "?status=OPEN",
    "?limit=0",
    "?limit=501",
    "?page=0",
    "?from=2026-09-31",
    "?actorId=forged",
  ])
    assert.equal((await request(linesPath("staff-a", query))).status, 422, query);
  assert.equal(transactions, 0);
  assert.equal(
    (await request(linesPath("staff-a", "?from=2026-09-30&to=2026-09-01"))).status,
    400,
    "a reversed range is a bad request, not an empty report",
  );
  assert.equal(transactions, 1);
});
