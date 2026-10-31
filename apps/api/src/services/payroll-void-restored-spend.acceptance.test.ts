/** Purchase voids whose credit was spent and then given back.
 *
 * Two facts decide the M1 void-gate scope, and both are proven here against the real
 * writers on a disposable database:
 *
 * 1. A purchase whose credit is still spent cannot be voided at all — the writer
 *    refuses `HOLDING_ALREADY_SPENT` ("Reverse the redemption first"), and the
 *    transferred case refuses `HOLDING_ALREADY_TRANSFERRED`, `OUTSTANDING_ALREADY_PAID`
 *    likewise. Those loader gates therefore defend against corrupted rows rather than
 *    modelling an operational path, which is why they may stay fail-closed.
 * 2. Undoing the spend restores the credit, and the purchase behind it *can* then be
 *    voided — that deletes the holding the spend drew on. The close reads that spend
 *    from the void's hash-verified pre-deletion snapshot (the row itself is gone) and
 *    verifies the restored balance against the surviving ledger, so the deleted holding
 *    is no longer a payroll boundary. Writer-recorded cash confirmations permit full
 *    monthly loading and persisted approval; missing confirmations still refuse.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { PAYROLL_DEFAULT_SETTINGS } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { createSale, voidSale } from "./sale.service.js";
import { loadAuthoritativePayrollCloseInputs } from "./payroll-close-loader.js";
import { loadPayrollValueSpendHistory } from "./payroll-close-value-loader.js";
import { openPayrollClose, payrollInputHash } from "./payroll-close-state.js";
import { SALE_VOID_PURCHASE_HOLDINGS_ACTION } from "./sale-void-purchase-evidence.js";
import { authorizeStoredPayrollCarry } from "./payroll-close-authorizations.js";
import { calculateStoredPayrollClose, approveStoredPayrollClose } from "./payroll-close-store.js";

const disabled = process.env.RUN_CP005_ACCEPTANCE !== "true";
const shares = (staffId: string) => [{ staffId, share: 10000 }];

const assertDisposableTarget = () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55485");
  assert.equal(url.pathname, "/payroll_close_test");
};

type Fixture = {
  tenantId: string;
  ownerId: string;
  outletId: string;
  customerId: string;
  serviceId: string;
  holdingId: string;
  purchaseId: string;
  spendId: string;
};

const codeIs = (expected: string) => (error: { code?: string }) => error.code === expected;

/** Credit bought for cash and then spent on one service, so the purchase, the spend
 * and the restore all share one holding and one month. */
async function setup(tag: string): Promise<Fixture> {
  const tenantId = `cp005-vr-${tag}-${randomUUID()}`;
  const ownerId = randomUUID();
  await runAsPlatform(() =>
    prisma.tenant.create({
      data: {
        id: tenantId,
        slug: tenantId,
        name: `CP-005 restored ${tag}`,
        status: "ACTIVE",
        gstEnabled: true,
      },
    }),
  );
  return runAsTenant(
    tenantId,
    async () => {
      await prisma.user.create({
        data: {
          id: ownerId,
          tenantId,
          name: ownerId,
          email: `${ownerId}@example.invalid`,
          passwordHash: "synthetic-unused",
          globalRole: "SUPER_ADMIN",
          twoFactorEnabled: true,
        },
      });
      for (const code of ["catalogue", "packages", "sales", "customers"]) {
        const module = await prisma.module.upsert({
          where: { code },
          update: {},
          create: { code, name: code, category: "Core", isCore: true },
        });
        await prisma.tenantModule.create({ data: { tenantId, moduleId: module.id } });
      }
      const outlet = await prisma.outlet.create({
        data: { tenantId, name: "Restored outlet", slug: "restored" },
      });
      const customer = await prisma.customer.create({
        data: { tenantId, name: "Restored buyer" },
      });
      const service = await prisma.service.create({
        data: { tenantId, name: "Credit service", memberPrice: "90", nonmemberPrice: "90" },
      });
      const item = await prisma.valuePackage.create({
        data: {
          tenantId,
          name: "545 for 600",
          price: "545",
          credit: "600",
          validityDays: tag.includes("expired") ? 1 : null,
        },
      });
      const period = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Singapore",
        year: "numeric",
        month: "2-digit",
      }).formatToParts(new Date());
      const month = ["year", "month"]
        .map((key) => period.find((part) => part.type === key)!.value)
        .join("-");
      const [year, number] = month.split("-").map(Number);
      mock.timers.enable({
        apis: ["Date"],
        now: new Date(Date.UTC(year, number - 1, 1) - 86400000),
      });
      try {
        await authorizeStoredPayrollCarry(
          "OPENING",
          month,
          0,
          {
            staff: [
              { staffId: ownerId, carryForward: [], fallbackCarryCommission: "0.0000000000" },
            ],
            evidence: { inventoryReference: "reviewed synthetic complete opening" },
          },
          "Reviewed opening for restored credit acceptance",
        );
      } finally {
        mock.timers.reset();
      }
      for (const [kind, targetId, payload] of [
        ["SETTINGS", "company", PAYROLL_DEFAULT_SETTINGS],
        [
          "STAFF",
          ownerId,
          { joinDate: "2020-01-01", stageEndOverride: null, commissionRole: "NON_COMMISSION" },
        ],
        [
          "PROFILE",
          ownerId,
          { basicSalary: "0", fixedOvertime: "0", levy: "0", salesAlertPct: "50" },
        ],
      ] as [string, string, object][]) {
        await prisma.payrollConfigurationEvent.create({
          data: {
            tenantId,
            kind,
            targetId,
            revision: 1,
            actorId: ownerId,
            reason: "Synthetic historical configuration",
            createdAt: new Date("2026-01-01"),
            payload,
          },
        });
      }
      const purchase = await runAtOutlet(outlet.id, () =>
        createSale({
          customerId: customer.id,
          lines: [
            {
              itemType: "VALUE_PACKAGE",
              itemId: item.id,
              quantity: 1,
              attribution: { sellers: shares(ownerId) },
            },
          ],
          payments: [{ method: "CASH", amount: 545 }],
          collection: {
            currency: "SGD",
            allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "54500" }],
          },
        }),
      );
      const holding = await prisma.customerValuePackageHolding.findFirstOrThrow({
        where: { saleLine: { saleId: purchase.id } },
      });
      const spend =
        tag === "unused-expired"
          ? null
          : await runAtOutlet(outlet.id, () =>
              createSale({
                customerId: customer.id,
                lines: [
                  {
                    itemType: "SERVICE",
                    itemId: service.id,
                    quantity: 1,
                    // A real credit spend carries performers: the redemption, not the sale
                    // commission, is what `VALUE_SPEND` captures.
                    attribution: { sellers: shares(ownerId), performers: shares(ownerId) },
                  },
                ],
                payments: [{ method: "PREPAID_CREDIT", holdingId: holding.id, amount: 90 }],
                collection: { currency: "SGD", allocations: [] },
              }),
            );
      return {
        tenantId,
        ownerId,
        outletId: outlet.id,
        customerId: customer.id,
        serviceId: service.id,
        holdingId: holding.id,
        purchaseId: purchase.id,
        spendId: spend?.id ?? "unused-no-spend",
      };
    },
    ownerId,
  );
}

const tenantCase = (tag: string, work: (fixture: Fixture) => Promise<void>) => async () => {
  assertDisposableTarget();
  const fixture = await setup(tag);
  await runAsTenant(fixture.tenantId, () => work(fixture), fixture.ownerId);
};

const loadMonth = (fixture: Fixture) =>
  runAsTenant(
    fixture.tenantId,
    async () => {
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: fixture.tenantId },
        select: { timeZone: true },
      });
      const parts = new Intl.DateTimeFormat("en", {
        timeZone: tenant.timeZone,
        year: "numeric",
        month: "2-digit",
      }).formatToParts(new Date());
      const month = ["year", "month"]
        .map((key) => parts.find((part) => part.type === key)!.value)
        .join("-");
      return prisma.$transaction((tx) =>
        loadAuthoritativePayrollCloseInputs(tx, openPayrollClose(month)),
      );
    },
    fixture.ownerId,
  );

test(
  "CP-005 a purchase whose credit is spent cannot be voided at all",
  { skip: disabled },
  tenantCase("spent", async (fixture) => {
    // The writer refuses before anything is reversed, so the close never has to model
    // a used purchase void; the loader gate behind it defends against edited rows.
    await assert.rejects(
      voidSale(fixture.purchaseId, { reason: "cancel purchased credit" }, fixture.ownerId),
      codeIs("HOLDING_ALREADY_SPENT"),
    );
    const purchase = await prisma.sale.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, id: fixture.purchaseId },
      select: { status: true },
    });
    assert.equal(purchase.status, "COMPLETED");
    const holding = await prisma.customerValuePackageHolding.findFirstOrThrow({
      where: { id: fixture.holdingId },
      select: { amount: true, amountRemaining: true },
    });
    assert.equal(holding.amountRemaining.toFixed(2), "510.00");
    assert.equal(holding.amount.toFixed(2), "600.00");
    // Nothing was reversed on the refused attempt: the spend still stands.
    assert.equal(
      await prisma.customerRedemption.count({
        where: { tenantId: fixture.tenantId, saleId: fixture.spendId, revertedAt: null },
      }),
      1,
    );
  }),
);

test(
  "CP-005 reverting the spend lets the purchase void, and the close reads that spend",
  { skip: disabled },
  tenantCase("reverted", async (fixture) => {
    await voidSale(
      fixture.spendId,
      { reason: "undo the spend", cashDisposition: "NO_MOVEMENT" },
      fixture.ownerId,
    );
    // Independent journals for the give-back: the session/amount returns and the
    // redemption is stamped rather than deleted.
    const balances = await prisma.prepaidBalanceEvent.findMany({
      where: { tenantId: fixture.tenantId, holdingId: fixture.holdingId },
      select: { kind: true, delta: true },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(
      balances.map((row) => `${row.kind}:${row.delta.toFixed(2)}`),
      ["GRANT:600.00", "SPEND:-90.00", "RESTORE:90.00"],
    );
    const restored = await prisma.customerValuePackageHolding.findFirstOrThrow({
      where: { id: fixture.holdingId },
      select: { amountRemaining: true },
    });
    assert.equal(restored.amountRemaining.toFixed(2), "600.00");
    // Restored credit is not "spent", so the writer now allows the purchase void.
    await voidSale(
      fixture.purchaseId,
      { reason: "cancel the restored purchase", cashDisposition: "NO_MOVEMENT" },
      fixture.ownerId,
    );
    const purchase = await prisma.sale.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, id: fixture.purchaseId },
      select: { status: true },
    });
    assert.equal(purchase.status, "VOID");
    // The void deletes the holding the spend drew on and journals the removal, so the
    // spend's own row and customer survive only in those two places.
    assert.equal(
      await prisma.customerValuePackageHolding.count({
        where: { tenantId: fixture.tenantId, id: fixture.holdingId },
      }),
      0,
    );
    const removal = await prisma.prepaidBalanceEvent.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, holdingId: fixture.holdingId, kind: "REMOVAL" },
      select: { delta: true, amountBefore: true, amountAfter: true, saleId: true },
    });
    assert.equal(removal.delta.toFixed(2), "-600.00");
    assert.equal(removal.amountBefore.toFixed(2), "600.00");
    assert.equal(removal.amountAfter.toFixed(2), "0.00");
    assert.equal(removal.saleId, fixture.purchaseId);
    const redemption = await prisma.customerRedemption.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, saleId: fixture.spendId },
      select: { id: true, revertedAt: true },
    });
    assert.notEqual(redemption.revertedAt, null);
    // No live holding row remains, so the loader rebuilds it from the void's verified
    // pre-deletion snapshot and verifies the restored spend against the ledger that
    // outlived the row. This is the boundary that used to refuse by name.
    const history = await prisma.$transaction((tx) =>
      loadPayrollValueSpendHistory(tx, fixture.holdingId),
    );
    assert.equal(history.evidence.holding.id, fixture.holdingId);
    assert.equal(history.evidence.holding.amount.toFixed(2), "600.00");
    assert.equal(history.evidence.holding.amountRemaining.toFixed(2), "600.00");
    assert.equal(history.evidence.sale.id, fixture.purchaseId);
    assert.equal(history.restorations.length, 1);
    assert.equal(history.restorations[0]!.redemptionId, redemption.id);
    assert.ok(
      history.evidence.balanceEvents.some((row) => row.kind === "REMOVAL"),
      "the terminal removal stays in the frozen evidence",
    );
    // The month itself still refuses, but no longer at the spend: a voided sale needs the
    // cash confirmation the void writer records, and this fixture voids without one.
    const inputs = await loadMonth(fixture);
    assert.equal(inputs.staff.length, 1);
    assert.equal(inputs.staff[0]!.collection, "500.0000");
    const spendLines = inputs.staff[0]!.calculation.lines.filter(
      (row) => row.commissionType === "VP_SPEND",
    );
    assert.deepEqual(spendLines.map((row) => row.baseAmount).sort(), ["-75.0000", "75.0000"]);
    assert.equal(payrollInputHash(await loadMonth(fixture)), payrollInputHash(inputs));
    for (const kind of ["SPEND", "RESTORE", "REMOVAL"] as const) {
      await assert.rejects(
        prisma.$transaction(async (tx) => {
          const original = tx.prepaidBalanceEvent.findMany.bind(tx.prepaidBalanceEvent);
          const proxy = new Proxy(tx, {
            get(target, key) {
              if (key !== "prepaidBalanceEvent") return Reflect.get(target, key);
              return new Proxy(target.prepaidBalanceEvent, {
                get(delegate, method) {
                  if (method !== "findMany") return Reflect.get(delegate, method);
                  return async (args: Parameters<typeof original>[0]) =>
                    (await original(args)).filter((row) => row.kind !== kind);
                },
              });
            },
          });
          return loadAuthoritativePayrollCloseInputs(proxy, openPayrollClose(inputs.periodKey));
        }),
        /VALUE_SPEND_HISTORY_UNCONFIRMED/,
      );
    }
    assert.equal(await prisma.payrollClose.count({ where: { tenantId: fixture.tenantId } }), 0);
    assert.equal(
      await prisma.employeeCommission.count({ where: { tenantId: fixture.tenantId } }),
      0,
    );
    const draft = await calculateStoredPayrollClose(inputs.periodKey, 0);
    assert.equal(draft.status, "CALCULATED");
    mock.timers.enable({ apis: ["Date"], now: new Date(inputs.endsAt) });
    try {
      const approved = await approveStoredPayrollClose(
        inputs.periodKey,
        1,
        "Reviewed restored spend and purchase void",
      );
      assert.equal(approved.status, "APPROVED");
      assert.equal(payrollInputHash(approved.calculation), payrollInputHash(draft.calculation));
    } finally {
      mock.timers.reset();
    }
  }),
);

test(
  "CP-005 unused expired credit purchase void replays expiry and approves exact removal",
  { skip: disabled },
  tenantCase("unused-expired", async (fixture) => {
    assert.equal(
      await prisma.customerRedemption.count({ where: { holdingId: fixture.holdingId } }),
      0,
    );
    mock.timers.enable({ apis: ["Date"], now: new Date(Date.now() + 2 * 86400000) });
    try {
      await voidSale(
        fixture.purchaseId,
        { reason: "Void unused expired purchase", cashDisposition: "NO_MOVEMENT" },
        fixture.ownerId,
      );
    } finally {
      mock.timers.reset();
    }
    assert.equal(
      await prisma.customerValuePackageHolding.count({ where: { id: fixture.holdingId } }),
      0,
    );
    const inputs = await loadMonth(fixture);
    assert.equal(
      inputs.staff.find((row) => row.staff.id === fixture.ownerId)!.collection,
      "500.0000",
    );
    const draft = await calculateStoredPayrollClose(inputs.periodKey, 0);
    mock.timers.enable({ apis: ["Date"], now: new Date(inputs.endsAt) });
    try {
      const approved = await approveStoredPayrollClose(
        inputs.periodKey,
        1,
        "Reviewed unused expired credit removal",
      );
      assert.equal(approved.status, "APPROVED");
      assert.equal(payrollInputHash(approved.calculation), payrollInputHash(draft.calculation));
    } finally {
      mock.timers.reset();
    }
  }),
);

test(
  "CP-005 expired restored credit purchase void reconciles and approves without new cash",
  { skip: disabled },
  tenantCase("expired", async (fixture) => {
    await voidSale(
      fixture.spendId,
      { reason: "Restore before expiry", cashDisposition: "NO_MOVEMENT" },
      fixture.ownerId,
    );
    mock.timers.enable({ apis: ["Date"], now: new Date(Date.now() + 2 * 86400000) });
    try {
      await voidSale(
        fixture.purchaseId,
        { reason: "Void expired purchase", cashDisposition: "NO_MOVEMENT" },
        fixture.ownerId,
      );
    } finally {
      mock.timers.reset();
    }
    assert.equal(
      await prisma.customerValuePackageHolding.count({ where: { id: fixture.holdingId } }),
      0,
    );
    const inputs = await loadMonth(fixture);
    assert.equal(
      inputs.staff.find((row) => row.staff.id === fixture.ownerId)!.collection,
      "500.0000",
    );
    const draft = await calculateStoredPayrollClose(inputs.periodKey, 0);
    mock.timers.enable({ apis: ["Date"], now: new Date(inputs.endsAt) });
    try {
      const approved = await approveStoredPayrollClose(
        inputs.periodKey,
        1,
        "Reviewed expired restored credit purchase void",
      );
      assert.equal(approved.status, "APPROVED");
      assert.equal(payrollInputHash(approved.calculation), payrollInputHash(draft.calculation));
    } finally {
      mock.timers.reset();
    }
  }),
);

test(
  "CP-005 restored purchase void without cash confirmation remains refused",
  { skip: disabled },
  () =>
    tenantCase("unconfirmed", async (fixture) => {
      await voidSale(
        fixture.spendId,
        { reason: "Restore spend", cashDisposition: "NO_MOVEMENT" },
        fixture.ownerId,
      );
      await voidSale(fixture.purchaseId, { reason: "Legacy unconfirmed cash" }, fixture.ownerId);
      await assert.rejects(loadMonth(fixture), /SALE_VOID_CASH_UNCONFIRMED/);
    })(),
);

test(
  "CP-005 a purchase void keeps its pre-deletion snapshot whoever the session is",
  { skip: disabled },
  tenantCase("snapshot", async (fixture) => {
    // The void writer takes the actor as a parameter, so a manager can void a sale the
    // session is not signed in as. The snapshot must still be captured, and captured for
    // returned cash too — otherwise the credit is deleted with no evidence at all.
    const managerId = `${fixture.tenantId}-manager`;
    await prisma.user.create({
      data: {
        id: managerId,
        tenantId: fixture.tenantId,
        name: managerId,
        email: `${managerId}@example.invalid`,
        passwordHash: "synthetic-unused",
        globalRole: "MANAGER",
      },
    });
    // Give the credit back first (the writer refuses to void a spent purchase), then void
    // the purchase without a no-movement disposition — i.e. with the cash returned.
    await voidSale(fixture.spendId, { reason: "undo the spend" }, managerId);
    await voidSale(fixture.purchaseId, { reason: "manager cancels the purchase" }, managerId);
    const audits = await prisma.auditLog.findMany({
      where: {
        tenantId: fixture.tenantId,
        action: SALE_VOID_PURCHASE_HOLDINGS_ACTION,
        targetId: fixture.purchaseId,
      },
    });
    assert.equal(audits.length, 1, "one pre-deletion snapshot per purchase void");
    const metadata = audits[0]!.metadata as {
      snapshot: { credits: { id: string }[]; actorId: string };
      hash: string;
    };
    assert.equal(payrollInputHash(metadata.snapshot), metadata.hash, "snapshot hash verifies");
    assert.deepEqual(
      metadata.snapshot.credits.map((row) => row.id),
      [fixture.holdingId],
      "the deleted credit is named in the snapshot",
    );
    assert.equal(metadata.snapshot.actorId, managerId);
    // Snapshot capture alone does not establish authoritative returned-cash history.
    await assert.rejects(loadMonth(fixture), /VALUE_SPEND_HISTORY_UNCONFIRMED/);
    assert.equal(
      await prisma.customerValuePackageHolding.count({ where: { id: fixture.holdingId } }),
      0,
      "the void removed the holding row itself",
    );
  }),
);
