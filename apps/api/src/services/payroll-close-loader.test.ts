import assert from "node:assert/strict";
import { test } from "node:test";
import { PAYROLL_DEFAULT_SETTINGS } from "@glampro_suite/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { loadAuthoritativePayrollCloseInputs } from "./payroll-close-loader.js";
import {
  approvePayrollClose,
  calculatePayrollClose,
  openPayrollClose,
  payrollInputHash,
  type PayrollCloseInputs,
} from "./payroll-close-state.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";
import type { PayrollOpeningCarry } from "./payroll-close-opening.js";

const owner = { id: "owner", role: "SUPER_ADMIN", disabled: false, twoFactorEnabled: true };
const D = (value: string) => new Prisma.Decimal(value);
export function loaderFixture() {
  const previousInputs: PayrollCloseInputs = {
    periodKey: "2026-08",
    timeZone: "Asia/Singapore",
    currency: "SGD",
    startsAt: "2026-07-31T16:00:00.000Z",
    endsAt: "2026-08-31T16:00:00.000Z",
    evidence: { syntheticPrior: true },
    staff: [],
  };
  const priorDraft = calculatePayrollClose(
    openPayrollClose("2026-08"),
    0,
    previousInputs,
    owner,
    "2026-09-01T00:00:00.000Z",
  );
  const prior = approvePayrollClose(
    priorDraft,
    1,
    previousInputs,
    owner,
    "2026-09-01T00:00:00.000Z",
    "Reviewed prior month",
  );
  const event = (kind: string, targetId: string, payload: unknown) => ({
    id: `${kind}-${targetId}`,
    tenantId: "salon",
    kind,
    targetId,
    payload,
    revision: 1,
    createdAt: new Date("2026-08-01T00:00:00Z"),
  });
  const shares = [{ staffId: "staff", share: 10000 }];
  const line = {
    tenantId: "salon",
    id: "line",
    saleId: "sale",
    itemType: "SERVICE",
    itemId: "service",
    quantity: 1,
    lineTotal: D("109"),
    voucherDiscountAmount: D("0"),
    taxAmount: D("9"),
    attribution: { sellers: shares, performers: shares },
  };
  const sale = {
    tenantId: "salon",
    id: "sale",
    status: "COMPLETED",
    outletId: "branch",
    collectionCurrency: "SGD",
    soldAt: new Date("2026-09-15T00:00:00Z"),
    voidedAt: null,
    lines: [line],
  };
  const capture = {
    tenantId: "salon",
    id: "capture",
    sourceKey: "sale-line:line",
    sourceType: "SALE_LINE",
    sourceId: "line",
    saleId: "sale",
    outletId: "branch",
    occurredAt: sale.soldAt,
    createdAt: sale.soldAt,
    evidence: {
      version: 1,
      status: "CAPTURED",
      postingStatus: "PENDING_RELEASE",
      currency: "SGD",
      itemId: "service",
      rateProvenance: {
        version: 1,
        rateAt: sale.soldAt.toISOString(),
        itemId: "service",
        category: null as string | null,
        selections: [
          {
            staffId: "staff",
            legacyServiceRate: "10",
            selection: { rate: "10", source: "LEGACY_STAFF", ruleId: null as string | null },
          },
        ],
      },
      lines: [
        {
          id: "base",
          staffId: "staff",
          outletId: "branch",
          commissionType: "SVC",
          baseAmount: "100.0000",
          units: "1.0000",
          businessDate: "2026-09-15",
          mode: "FOLLOW_PLAN",
          status: "EARNED",
          fallbackRatePct: "10",
        },
      ],
    },
  };
  const data = {
    sales: [sale],
    payments: [
      {
        tenantId: "salon",
        id: "payment",
        saleId: "sale",
        method: "CASH",
        sessionId: null as string | null,
        amount: D("109"),
        createdAt: sale.soldAt,
        sale,
      },
    ],
    outstanding: [] as unknown[],
    redemptions: [] as unknown[],
    refunds: [] as unknown[],
    events: [capture],
    legacy: [] as unknown[],
    configuration: [
      event("SETTINGS", "company", PAYROLL_DEFAULT_SETTINGS),
      event("STAFF", "staff", {
        joinDate: "2020-01-01",
        stageEndOverride: null,
        commissionRole: "NON_COMMISSION",
      }),
      event("PROFILE", "staff", {
        basicSalary: "2000",
        fixedOvertime: "0",
        levy: "0",
        salesAlertPct: "50",
      }),
    ],
    staff: [{ tenantId: "salon", id: "staff", name: "Staff", disabled: false }],
    collections: [
      {
        tenantId: "salon",
        id: "collection",
        sourceType: "SALE_PAYMENT",
        sourceId: "payment",
        saleId: "sale",
        currency: "SGD",
        grossCents: 10900n,
        occurredAt: sale.soldAt,
        allocations: [
          {
            tenantId: "salon",
            id: "allocation",
            collectionId: "collection",
            saleLineId: "line",
            grossCents: 10900n,
            netCents: 10000n,
            taxCents: 900n,
            evidence: { version: 1, attributionStatus: "KNOWN", sellers: shares },
          },
        ],
      },
    ],
    prior: {
      id: "prior",
      tenantId: "salon",
      periodKey: "2026-08",
      status: "APPROVED",
      revision: prior.revision,
      state: prior,
    },
    usageCount: 0,
  };
  const queries: { model: string; args: unknown }[] = [];
  const many = (model: string, read: () => unknown) => ({
    findMany: async (args: unknown) => {
      queries.push({ model, args });
      return read();
    },
  });
  const tx = {
    $queryRaw: async () => [],
    tenant: { findUniqueOrThrow: async () => ({ id: "salon", timeZone: "Asia/Singapore" }) },
    user: {
      ...many("user", () => data.staff),
      findFirst: async () => ({
        id: owner.id,
        globalRole: "SUPER_ADMIN",
        disabled: false,
        twoFactorEnabled: true,
      }),
    },
    sale: { ...many("sale", () => data.sales), findFirstOrThrow: async () => sale },
    salePayment: many("salePayment", () => data.payments),
    customerOutstandingPayment: many("customerOutstandingPayment", () => data.outstanding),
    customerRedemption: {
      ...many("customerRedemption", () => data.redemptions),
      count: async () => data.usageCount,
    },
    saleRefund: many("saleRefund", () => data.refunds),
    payrollSourceEvent: many("payrollSourceEvent", () => data.events),
    payrollConfigurationEvent: many("payrollConfigurationEvent", () => data.configuration),
    payrollPlanVersion: many("payrollPlanVersion", () => []),
    commissionCollection: many("commissionCollection", () => data.collections),
    employeeCommission: many("employeeCommission", () => data.legacy),
    payrollClose: {
      ...many("payrollClose", () => [data.prior]),
      findFirst: async () => data.prior,
    },
    payrollCloseEvent: {
      findFirst: async () => ({
        stateHash: payrollInputHash(data.prior.state),
        state: data.prior.state,
      }),
    },
    payrollCarryAuthorization: many("payrollCarryAuthorization", () => []),
    commissionRule: many("commissionRule", () => []),
  } as unknown as PayrollCloseTransaction;
  const load = () =>
    runAsTenant(
      "salon",
      () => loadAuthoritativePayrollCloseInputs(tx, openPayrollClose("2026-09")),
      "owner",
    );
  return { data, tx, load, queries };
}

test("transactional loader reconciles independent ordinary economics and GST-exclusive cash", async () => {
  const f = loaderFixture();
  const inputs = await f.load();
  assert.equal(inputs.staff[0].collection, "100.0000");
  const close = calculatePayrollClose(
    openPayrollClose("2026-09"),
    0,
    inputs,
    owner,
    "2026-10-01T00:00:00.000Z",
  );
  assert.equal(close.calculation!.statements[0].payroll.takeHome, "2010.00");
  assert.equal(payrollInputHash(await f.load()), payrollInputHash(inputs));
  assert.doesNotThrow(() => payrollInputHash(inputs));
  for (const query of f.queries) {
    const args = query.args as { where: { tenantId: string }; take?: number; skip?: number };
    assert.equal(args.where.tenantId, "salon");
    assert.equal(args.take, undefined);
    assert.equal(args.skip, undefined);
  }
  const saleQuery = f.queries.find((query) => query.model === "sale")!;
  const where = (saleQuery.args as { where: { OR: { soldAt?: { gte: Date; lt: Date } }[] } }).where;
  assert.equal(where.OR[0].soldAt!.gte.toISOString(), "2026-08-31T16:00:00.000Z");
  assert.equal(where.OR[0].soldAt!.lt.toISOString(), "2026-09-30T16:00:00.000Z");
});

test("missing operational captures and cash allocations cannot become empty payroll", async () => {
  for (const mutate of [
    (f: ReturnType<typeof loaderFixture>) => {
      f.data.events = [];
    },
    (f: ReturnType<typeof loaderFixture>) => {
      f.data.collections = [];
    },
    (f: ReturnType<typeof loaderFixture>) => {
      f.data.payments = [];
    },
  ]) {
    const f = loaderFixture();
    mutate(f);
    await assert.rejects(f.load(), /UNAVAILABLE/);
  }
});

test("independent sale economics reject captures with fabricated bases or staff", async () => {
  for (const mutate of [
    (f: ReturnType<typeof loaderFixture>) => {
      f.data.events[0].evidence.lines[0].baseAmount = "999.0000";
    },
    (f: ReturnType<typeof loaderFixture>) => {
      f.data.events[0].evidence.lines[0].staffId = "other";
    },
    (f: ReturnType<typeof loaderFixture>) => {
      f.data.events[0].evidence.lines[0].units = "2.0000";
    },
  ]) {
    const f = loaderFixture();
    mutate(f);
    await assert.rejects(f.load(), /ORDINARY_SOURCE_ECONOMICS_MISMATCH/);
  }
});

test("uncertain settlement, usage, refunds and package inputs fail closed independently", async () => {
  for (const [mutate, expected] of [
    [
      (f) => {
        f.data.payments[0].sessionId = "pending";
      },
      /GATEWAY_SETTLEMENT_UNCONFIRMED/,
    ],
    [
      (f) => {
        f.data.redemptions.push({ id: "uncaptured" });
      },
      /REDEMPTION_WORKFLOW_NOT_LOADED/,
    ],
    [
      (f) => {
        f.data.refunds.push({ id: "uncaptured" });
      },
      /REFUND_OR_VOID_WORKFLOW_NOT_LOADED/,
    ],
    [
      (f) => {
        f.data.usageCount = 1;
      },
      /SALE_USAGE_COVERAGE_NOT_LOADED/,
    ],
    [
      (f) => {
        f.data.sales[0].lines[0].itemType = "PACKAGE";
      },
      /PACKAGE_PURCHASE_WORKFLOW_NOT_LOADED/,
    ],
    [
      (f) => {
        f.data.sales[0].lines[0].lineTotal = D("0");
      },
      /FOC_OPERATIONAL_LIST_PRICE_NOT_LOADED/,
    ],
  ] as [(f: ReturnType<typeof loaderFixture>) => void, RegExp][]) {
    const f = loaderFixture();
    mutate(f);
    await assert.rejects(f.load(), expected);
  }
});

test("loader rejects missing history, legacy payout overlap and changed attribution", async () => {
  const missing = loaderFixture();
  missing.tx.payrollClose.findFirst = (async () =>
    null) as unknown as typeof missing.tx.payrollClose.findFirst;
  await assert.rejects(missing.load(), /PERSISTED_OPENING_REQUIRED/);
  const legacy = loaderFixture();
  legacy.data.legacy.push({
    id: "legacy",
    tenantId: "salon",
    userId: "staff",
    saleId: "sale",
    saleLineId: "line",
    sourceType: null,
    sourceId: null,
    ledgerVersion: null,
    amount: D("0"),
    paidAt: null,
    reversesId: null,
    reconciliationRequired: false,
  });
  await assert.rejects(legacy.load(), /SOURCES_UNAVAILABLE/);
  const attribution = loaderFixture();
  attribution.data.collections[0].allocations[0].evidence.sellers = [
    { staffId: "other", share: 10000 },
  ];
  await assert.rejects(attribution.load(), /HISTORICAL_CASH_ATTRIBUTION_UNCONFIRMED/);
});

test("loader denies unauthenticated, outlet and staff contexts", async () => {
  const f = loaderFixture();
  await assert.rejects(
    loadAuthoritativePayrollCloseInputs(f.tx, openPayrollClose("2026-09")),
    /authenticated/,
  );
  await assert.rejects(
    runAsTenant(
      "salon",
      () =>
        runAtOutlet("branch", () =>
          loadAuthoritativePayrollCloseInputs(f.tx, openPayrollClose("2026-09")),
        ),
      "owner",
    ),
    /salon-wide/,
  );
  f.tx.user.findFirst = (async () => ({
    id: "staff",
    globalRole: "STAFF",
  })) as unknown as typeof f.tx.user.findFirst;
  await assert.rejects(f.load(), /not permitted/);
});

test("collection net cannot be fabricated by moving GST into cash", async () => {
  const f = loaderFixture();
  f.data.collections[0].allocations[0].netCents = 10900n;
  f.data.collections[0].allocations[0].taxCents = 0n;
  await assert.rejects(f.load(), /OPERATIONAL_COLLECTION_TAX_MISMATCH/);
});

test("orphan captures and mismatched prior audit fail closed", async () => {
  const orphan = loaderFixture();
  orphan.data.sales = [];
  await assert.rejects(orphan.load(), /INVENTORY_UNAVAILABLE/);
  const audit = loaderFixture();
  audit.tx.payrollCloseEvent.findFirst = (async () => ({
    stateHash: "tampered",
    state: audit.data.prior.state,
  })) as unknown as typeof audit.tx.payrollCloseEvent.findFirst;
  await assert.rejects(audit.load(), /audit does not match/);
});

test("authoritative loader blocks ordinary captured fallback tampering", async () => {
  const f = loaderFixture();
  f.data.events[0].evidence.lines[0].fallbackRatePct = "90";
  await assert.rejects(f.load(), /RATE_PROVENANCE_UNCONFIRMED/);
  const legacy = loaderFixture();
  Reflect.deleteProperty(legacy.data.events[0].evidence, "rateProvenance");
  await assert.rejects(legacy.load(), /RATE_PROVENANCE_UNCONFIRMED/);
});

test("operational changes invalidate a calculated draft at approval", async () => {
  const f = loaderFixture();
  const inputs = await f.load();
  const draft = calculatePayrollClose(
    openPayrollClose("2026-09"),
    0,
    inputs,
    owner,
    "2026-10-01T00:00:00.000Z",
  );
  f.data.configuration.push({
    ...f.data.configuration[2],
    id: "profile-2",
    revision: 2,
    payload: { basicSalary: "2100", fixedOvertime: "0", levy: "0", salesAlertPct: "50" },
  });
  const changed = await f.load();
  assert.throws(
    () =>
      approvePayrollClose(draft, 1, changed, owner, "2026-10-01T00:00:00.000Z", "Approved review"),
    /inputs changed/,
  );
});

test("persisted opening and exact settlement compose authoritative inputs and invalidate stale approval", async () => {
  const f = loaderFixture();
  const opening: PayrollOpeningCarry = {
    id: "opening",
    tenantId: "salon",
    periodKey: "2026-09",
    revision: 1,
    timeZone: "Asia/Singapore",
    effectiveAt: "2026-08-31T16:00:00.000Z",
    firstClose: true,
    completeInventory: true,
    approval: { actorId: "owner", at: "2026-08-01T00:00:00.000Z", reason: "Complete cutover debt" },
    evidence: { reference: "audited-opening" },
    staff: [{ staffId: "staff", carryForward: [], fallbackCarryCommission: "-5.1234567890" }],
  };
  const row = (
    payload: PayrollOpeningCarry | import("./payroll-close-settlements.js").PayrollCarrySettlement,
    kind: string,
    targetId: string,
  ) => ({
    id: payload.id,
    tenantId: "salon",
    periodKey: payload.periodKey,
    revision: payload.revision,
    kind,
    targetId,
    actorId: payload.approval.actorId,
    reason: payload.approval.reason,
    createdAt: new Date(payload.approval.at),
    payloadHash: payrollInputHash(payload),
    payload,
  });
  const records = [row(opening, "OPENING", "opening")];
  f.tx.payrollClose.findFirst = (async () => null) as unknown as typeof f.tx.payrollClose.findFirst;
  f.tx.payrollClose.findMany = (async () => []) as unknown as typeof f.tx.payrollClose.findMany;
  f.tx.payrollClose.count = (async () => 0) as unknown as typeof f.tx.payrollClose.count;
  f.tx.payrollCarryAuthorization.findMany = (async () =>
    records) as unknown as typeof f.tx.payrollCarryAuthorization.findMany;
  const inputs = await f.load();
  assert.equal(inputs.staff[0].calculation.fallbackCarryCommission, "-5.1234567890");
  const draft = calculatePayrollClose(
    openPayrollClose("2026-09"),
    0,
    inputs,
    owner,
    "2026-10-01T00:00:00.000Z",
  );
  assert.equal(draft.calculation!.statements[0].payroll.takeHome, "2004.88");
  records.push(
    row(
      {
        id: "settlement",
        tenantId: "salon",
        periodKey: "2026-09",
        revision: 1,
        staffId: "staff",
        balanceHash: payrollInputHash(opening.staff[0]),
        components: [],
        fallbackWriteOff: { amount: "-5.1234567890" },
        evidence: { reference: "owner-write-off" },
        approval: {
          actorId: "owner",
          at: "2026-09-20T00:00:00.000Z",
          reason: "Exact debt writeoff",
        },
      },
      "SETTLEMENT",
      "staff",
    ),
  );
  const settled = await f.load();
  assert.equal(settled.staff[0].calculation.fallbackCarryCommission, "0.0000000000");
  assert.throws(
    () =>
      approvePayrollClose(
        draft,
        1,
        settled,
        owner,
        "2026-10-01T00:00:00.000Z",
        "Changed settlement denied",
      ),
    /inputs changed/,
  );
  const recalculated = calculatePayrollClose(draft, 1, settled, owner, "2026-10-01T00:00:00.000Z");
  assert.equal(recalculated.calculation!.statements[0].payroll.takeHome, "2010.00");
  assert.equal(
    approvePayrollClose(
      recalculated,
      2,
      settled,
      owner,
      "2026-10-01T00:00:00.000Z",
      "Settled payroll review",
    ).status,
    "APPROVED",
  );
  records[0].payloadHash = "0".repeat(64);
  await assert.rejects(f.load(), /audit mismatch/);
});
