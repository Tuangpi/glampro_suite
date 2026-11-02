/** Returned-money purchase voids.
 *
 * A customer pays for a package or credit, changes their mind, and the salon hands the
 * money back as it voids. Until this path existed a manager could only attest "no money
 * moved", so payroll counted cash the salon no longer held — or refused the sale outright.
 * These cases prove the real writers on a disposable database:
 *
 * 1. The void writer binds the returned payouts to the tenders it can still see, refusing
 *    a figure that is not exactly the external money collected. Mixed ordinary purchase
 *    companions preserve their sources, including zero products and zero tenders.
 * 2. The loader re-derives that total from the surviving tenders, so an attestation edited
 *    outside the writer refuses instead of overstating a return.
 * 3. A fully returned purchase nets to zero cash while its commission base and its
 *    reversal both stay visible, and the month calculates and approves unchanged.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { PAYROLL_DEFAULT_SETTINGS } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { createSale, voidSale } from "./sale.service.js";
import {
  createPrepaidFamily,
  changePrepaidMembership,
  sharePrepaid,
} from "./prepaid-family.service.js";
import { loadPayrollPurchaseSaleVoid } from "./payroll-close-purchase-void-loader.js";
import { findValueHoldingRemovedByPurchaseVoid } from "./payroll-close-value-removed-holding.js";
import { loadAuthoritativePayrollCloseInputs } from "./payroll-close-loader.js";
import { openPayrollClose, payrollInputHash } from "./payroll-close-state.js";
import { authorizeStoredPayrollCarry } from "./payroll-close-authorizations.js";
import { calculateStoredPayrollClose, approveStoredPayrollClose } from "./payroll-close-store.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

const disabled = process.env.RUN_CP005_ACCEPTANCE !== "true";
const shares = (staffId: string) => [{ staffId, share: 10000 }];
const action = "sale.void.cash-disposition";
const reference = "Void slip 2026-11-01";

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
  purchaseId: string;
};

type ReturnedMetadata = {
  version: number;
  cashDisposition: string;
  purchaseHoldingHash?: string;
  returned: {
    reference: string;
    grossCents: string;
    payouts: { id: string; method: string; grossCents: string }[];
  };
};

const codeIs = (expected: string) => (error: { code?: string }) => error.code === expected;

/** One value-package purchase paid entirely in cash, plus a service the till could also
 * have rung up — the two shapes the writer must tell apart. */
async function setup(tag: string): Promise<Fixture> {
  const tenantId = `cp005-rv-${tag}-${randomUUID()}`;
  const ownerId = randomUUID();
  await runAsPlatform(() =>
    prisma.tenant.create({
      data: {
        id: tenantId,
        slug: tenantId,
        name: `CP-005 returned void ${tag}`,
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
        data: { tenantId, name: "Returned outlet", slug: "returned" },
      });
      const customer = await prisma.customer.create({
        data: { tenantId, name: "Returned buyer" },
      });
      const service = await prisma.service.create({
        data: { tenantId, name: "Returned service", memberPrice: "90", nonmemberPrice: "90" },
      });
      const item = await prisma.valuePackage.create({
        data: { tenantId, name: "545 for 600", price: "545", credit: "600" },
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
          "Reviewed opening for returned void acceptance",
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
      return {
        tenantId,
        ownerId,
        outletId: outlet.id,
        customerId: customer.id,
        serviceId: service.id,
        purchaseId: purchase.id,
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

/** The resolved cash evidence the month was built from (`evidence.resolved` is the
 * composed input evidence; `evidence.authoritative` is the frozen loader inventory). */
const resolvedCash = (inputs: Awaited<ReturnType<typeof loadMonth>>) =>
  (
    inputs.evidence as {
      resolved: {
        cash: {
          cash: {
            salonCash: string;
            staff: { staffId: string; collection: string }[];
            reversals: {
              voids: { returnedCash: { saleId: string; netCents: string }[] } | null;
            } | null;
          } | null;
        };
      };
    }
  ).resolved.cash;

const returnAll = (amount = 545) => ({
  cashDisposition: "RETURNED" as const,
  returnedCash: {
    reference,
    payouts: [{ method: "CASH" as const, amount }],
  },
});

for (const disposition of ["NO_MOVEMENT", "RETURNED"] as const) {
  test(
    `CP-005 actively shared unused credit purchase void ${disposition} freezes verified consent`,
    { skip: disabled },
    tenantCase(`shared-${disposition}`, async (fixture) => {
      const family = await createPrepaidFamily(
        fixture.customerId,
        { name: "Shared purchase", confirmed: true, reason: "Owner requests family sharing" },
        fixture.ownerId,
      );
      assert.ok(family);
      const holding = await prisma.customerValuePackageHolding.findFirstOrThrow({
        where: { saleLine: { saleId: fixture.purchaseId } },
      });
      await sharePrepaid(
        fixture.customerId,
        holding.id,
        {
          familyId: family.id,
          confirmed: true,
          expectedUpdatedAt: holding.updatedAt.toISOString(),
          reason: "Owner consents to sharing this purchase",
        },
        fixture.ownerId,
      );
      const beforeVoid = await loadMonth(fixture);
      const priorDraft = await calculateStoredPayrollClose(beforeVoid.periodKey, 0);
      await voidSale(
        fixture.purchaseId,
        {
          reason: "Customer cancels shared purchase",
          ...(disposition === "RETURNED" ? returnAll() : { cashDisposition: "NO_MOVEMENT" }),
        },
        fixture.ownerId,
      );
      const inputs = await loadMonth(fixture);
      assert.notEqual(payrollInputHash(inputs), payrollInputHash(beforeVoid));
      assert.equal(
        resolvedCash(inputs).cash!.salonCash,
        disposition === "RETURNED" ? "0.0000" : "500.0000",
      );
      assert.deepEqual(
        inputs.staff[0]!.calculation.lines.filter((row) => row.commissionType === "VP_SALE")
          .map((row) => row.baseAmount)
          .sort(),
        ["-500.0000", "500.0000"],
      );
      const revived = await prisma.$transaction((tx) =>
        findValueHoldingRemovedByPurchaseVoid(tx, fixture.tenantId, holding.id),
      );
      assert.equal(revived?.holding.sharedFamilyId, family.id);
      assert.equal(
        await prisma.customerValuePackageHolding.count({ where: { id: holding.id } }),
        0,
      );

      // Corrupt independent read evidence, not the append-only operational journals.
      // Every omission/mismatch must refuse without changing the existing draft.
      for (const corruption of [
        "MISSING_CONSENT",
        "MISSING_MEMBERSHIP",
        "MISSING_MEMBER",
        "MISSING_FAMILY",
        "FOREIGN_MEMBERSHIP",
        "REMOVAL_CONSENT",
        "REMOVAL_PREVIOUS_CONSENT",
      ] as const) {
        await assert.rejects(
          prisma.$transaction((tx) =>
            loadPayrollPurchaseSaleVoid(
              new Proxy(tx, {
                get(target, property, receiver) {
                  if (
                    ![
                      "prepaidBalanceEvent",
                      "prepaidFamilyEvent",
                      "prepaidFamilyMember",
                      "prepaidFamily",
                    ].includes(String(property))
                  )
                    return Reflect.get(target, property, receiver);
                  const delegate = Reflect.get(target, property, receiver);
                  return new Proxy(delegate, {
                    get(model, method) {
                      if (method !== "findMany") return Reflect.get(model, method);
                      return async (...args: unknown[]) => {
                        const rows = await model.findMany(...args);
                        if (
                          (property === "prepaidFamilyEvent" &&
                            corruption === "MISSING_MEMBERSHIP") ||
                          (property === "prepaidFamilyMember" && corruption === "MISSING_MEMBER") ||
                          (property === "prepaidFamily" && corruption === "MISSING_FAMILY")
                        )
                          return [];
                        if (
                          property === "prepaidFamilyEvent" &&
                          corruption === "FOREIGN_MEMBERSHIP"
                        )
                          return rows.map((row: object) => ({ ...row, tenantId: "foreign" }));
                        if (property === "prepaidBalanceEvent") {
                          if (corruption === "MISSING_CONSENT")
                            return rows.filter((row: { kind: string }) => row.kind !== "SHARING");
                          return rows.map((row: { kind: string }) =>
                            row.kind === "REMOVAL"
                              ? {
                                  ...row,
                                  ...(corruption === "REMOVAL_CONSENT" && { sharedFamilyId: null }),
                                  ...(corruption === "REMOVAL_PREVIOUS_CONSENT" && {
                                    previousSharedFamilyId: null,
                                  }),
                                }
                              : row,
                          );
                        }
                        return rows;
                      };
                    },
                  });
                },
              }) as PayrollCloseTransaction,
              fixture.tenantId,
              fixture.purchaseId,
              "Asia/Singapore",
            ),
          ),
          /Authoritative payroll inputs unavailable/,
          corruption,
        );
      }
      assert.equal((await prisma.payrollClose.findFirstOrThrow()).revision, priorDraft.revision);
      mock.timers.enable({ apis: ["Date"], now: new Date(inputs.endsAt) });
      let approved;
      try {
        await assert.rejects(
          approveStoredPayrollClose(
            inputs.periodKey,
            priorDraft.revision,
            "Reject stale shared draft",
          ),
          /changed|stale|recalculate/i,
        );
        const draft = await calculateStoredPayrollClose(inputs.periodKey, priorDraft.revision);
        approved = await approveStoredPayrollClose(
          inputs.periodKey,
          draft.revision,
          "Reviewed shared purchase void",
        );
        assert.equal(approved.status, "APPROVED");
        assert.equal(payrollInputHash(approved.calculation), payrollInputHash(draft.calculation));
      } finally {
        mock.timers.reset();
      }
      // A later membership change invalidates live evidence, never the frozen approval.
      const frozenHash = payrollInputHash(approved);
      await changePrepaidMembership(
        fixture.customerId,
        {
          familyId: null,
          expectedFamilyId: family.id,
          confirmed: true,
          reason: "Customer leaves after purchase void",
        },
        fixture.ownerId,
      );
      assert.equal(
        payrollInputHash((await prisma.payrollClose.findFirstOrThrow()).state),
        frozenHash,
      );
    }),
  );
}

test(
  "CP-005 a purchase void that returned the money nets to zero cash and approves",
  { skip: disabled },
  tenantCase("returned", async (fixture) => {
    await voidSale(
      fixture.purchaseId,
      { reason: "Customer changed their mind", ...returnAll() },
      fixture.ownerId,
    );
    // The attestation names the giving-back the manager performed, bound to the same
    // pre-deletion holding snapshot every purchase void records.
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, action, targetId: fixture.purchaseId },
    });
    const metadata = audit.metadata as ReturnedMetadata;
    assert.equal(metadata.version, 2);
    assert.equal(metadata.cashDisposition, "RETURNED");
    assert.ok(metadata.purchaseHoldingHash, "the storage snapshot is still bound");
    assert.equal(metadata.returned.reference, reference);
    assert.equal(metadata.returned.grossCents, "54500");
    assert.deepEqual(metadata.returned.payouts, [
      { id: `void-return:${fixture.purchaseId}:1`, method: "CASH", grossCents: "54500" },
    ]);
    // The holding is gone, exactly as a no-movement void would leave it.
    assert.equal(
      await prisma.customerValuePackageHolding.count({
        where: { tenantId: fixture.tenantId, saleLine: { saleId: fixture.purchaseId } },
      }),
      0,
    );

    const inputs = await loadMonth(fixture);
    const cash = resolvedCash(inputs);
    // 500.0000 collected and 500.0000 given back: the month holds none of it.
    assert.equal(cash.cash!.salonCash, "0.0000");
    assert.deepEqual(cash.cash!.staff, [{ staffId: fixture.ownerId, collection: "0.0000" }]);
    assert.deepEqual(
      cash.cash!.reversals!.voids!.returnedCash.map((row) => [row.saleId, row.netCents]),
      [[fixture.purchaseId, "50000"]],
    );
    // The sale's own commission base and the reversal that undid it both remain visible;
    // a returned void removes cash, not the history of what was sold.
    const saleLines = inputs.staff[0]!.calculation.lines.filter(
      (row) => row.commissionType === "VP_SALE",
    );
    assert.deepEqual(saleLines.map((row) => row.baseAmount).sort(), ["-500.0000", "500.0000"]);
    // Deterministic evidence, and nothing persisted before the calculation.
    assert.equal(payrollInputHash(await loadMonth(fixture)), payrollInputHash(inputs));
    assert.equal(await prisma.payrollClose.count({ where: { tenantId: fixture.tenantId } }), 0);

    const draft = await calculateStoredPayrollClose(inputs.periodKey, 0);
    assert.equal(draft.status, "CALCULATED");
    mock.timers.enable({ apis: ["Date"], now: new Date(inputs.endsAt) });
    try {
      const approved = await approveStoredPayrollClose(
        inputs.periodKey,
        1,
        "Reviewed returned purchase void",
      );
      assert.equal(approved.status, "APPROVED");
      assert.equal(payrollInputHash(approved.calculation), payrollInputHash(draft.calculation));
    } finally {
      mock.timers.reset();
    }
  }),
);

test(
  "CP-005 returned money must equal what the sale collected, or nothing is voided",
  { skip: disabled },
  tenantCase("mismatch", async (fixture) => {
    // 540.00 back on a 545.00 sale would leave five dollars of the customer's money in a
    // void that claims to have returned it, so the writer refuses before reversing anything.
    await assert.rejects(
      voidSale(
        fixture.purchaseId,
        { reason: "Customer changed their mind", ...returnAll(540) },
        fixture.ownerId,
      ),
      codeIs("VOID_RETURN_AMOUNT_MISMATCH"),
    );
    const purchase = await prisma.sale.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, id: fixture.purchaseId },
      select: { status: true },
    });
    assert.equal(purchase.status, "COMPLETED");
    assert.equal(
      await prisma.auditLog.count({
        where: { tenantId: fixture.tenantId, action, targetId: fixture.purchaseId },
      }),
      0,
    );
    // The refusal is not sticky: the same manager can say the right figure afterwards.
    await voidSale(
      fixture.purchaseId,
      { reason: "Customer changed their mind", ...returnAll() },
      fixture.ownerId,
    );
    const inputs = await loadMonth(fixture);
    assert.equal(resolvedCash(inputs).cash!.salonCash, "0.0000");
  }),
);

for (const { itemType, zeroProduct, zeroTender, foc = false } of [
  { itemType: "SERVICE", zeroProduct: false, zeroTender: false, foc: false },
  { itemType: "SERVICE", zeroProduct: false, zeroTender: false, foc: true },
  { itemType: "SERVICE", zeroProduct: false, zeroTender: true, foc: true },
  { itemType: "PRODUCT", zeroProduct: false, zeroTender: false },
  { itemType: "PRODUCT", zeroProduct: true, zeroTender: false },
  { itemType: "PRODUCT", zeroProduct: false, zeroTender: true },
  { itemType: "PRODUCT", zeroProduct: true, zeroTender: true },
] as const) {
  for (const crossMonth of [false, true]) {
    test(
      `CP-005 M1-16 mixed purchase/${itemType}${foc ? " FOC" : ""}${zeroProduct ? " zero-product" : ""}${zeroTender ? " zero-tender" : ""} ${crossMonth ? "cross-month" : "same-month"} returns external cash with exact source inventory`,
      { skip: disabled },
      tenantCase(`m116-${itemType}`, async (fixture) => {
        const zeroCompanion = zeroProduct || foc;
        const returnedAmount = zeroCompanion ? 545 : 635;
        const purchaseLine = await prisma.saleLine.findFirstOrThrow({
          where: { saleId: fixture.purchaseId },
        });
        const ordinaryId =
          itemType === "SERVICE"
            ? fixture.serviceId
            : (
                await prisma.product.create({
                  data: {
                    tenantId: fixture.tenantId,
                    name: "M116 product",
                    memberPrice: zeroProduct ? "0" : "90",
                    nonmemberPrice: zeroProduct ? "0" : "90",
                    quantity: 10,
                  },
                })
              ).id;
        const mixed = await runAtOutlet(fixture.outletId, () =>
          createSale({
            customerId: fixture.customerId,
            lines: [
              {
                itemType: "VALUE_PACKAGE",
                itemId: purchaseLine.itemId,
                quantity: 1,
                attribution: { sellers: shares(fixture.ownerId) },
              },
              {
                itemType,
                itemId: ordinaryId,
                quantity: 1,
                ...(foc ? { discountPercent: 100 } : {}),
                attribution: {
                  sellers: shares(fixture.ownerId),
                  ...(itemType === "SERVICE" ? { performers: shares(fixture.ownerId) } : {}),
                },
              },
            ],
            payments: [
              { method: "CASH", amount: returnedAmount },
              ...(zeroTender ? [{ method: "CARD" as const, amount: 0 }] : []),
            ],
            collection: {
              currency: "SGD",
              allocations: [
                { paymentIndex: 0, linePosition: 0, grossCents: "54500" },
                ...(zeroCompanion
                  ? []
                  : [{ paymentIndex: 0, linePosition: 1, grossCents: "9000" }]),
              ],
            },
          }),
        );
        const original = await loadMonth(fixture);
        let frozenOriginal: string | null = null;
        if (crossMonth) {
          const draft = await calculateStoredPayrollClose(original.periodKey, 0);
          mock.timers.enable({ apis: ["Date"], now: new Date(original.endsAt) });
          try {
            frozenOriginal = payrollInputHash(
              await approveStoredPayrollClose(
                original.periodKey,
                draft.revision,
                "Approve before later mixed return",
              ),
            );
          } finally {
            mock.timers.reset();
          }
          mock.timers.enable({
            apis: ["Date"],
            now: new Date(new Date(original.endsAt).getTime() + 86400000),
          });
        }
        try {
          const before = await loadMonth(fixture);
          const prior = await calculateStoredPayrollClose(before.periodKey, 0);
          if (zeroCompanion || zeroTender) {
            await assert.rejects(
              voidSale(
                mixed.id,
                {
                  reason: "Reject incorrect external return",
                  cashDisposition: "RETURNED",
                  returnedCash: {
                    reference: "Incorrect zero companion return",
                    payouts: [{ method: "CASH", amount: returnedAmount + 1 }],
                  },
                },
                fixture.ownerId,
              ),
              /must equal what this sale collected/,
            );
            assert.equal(
              (await prisma.sale.findFirstOrThrow({ where: { id: mixed.id } })).status,
              "COMPLETED",
            );
            assert.equal(
              await prisma.customerValuePackageHolding.count({
                where: { saleLine: { saleId: mixed.id } },
              }),
              1,
            );
            assert.equal(await prisma.auditLog.count({ where: { action, targetId: mixed.id } }), 0);
          }
          await voidSale(
            mixed.id,
            {
              reason: "Return complete mixed receipt",
              cashDisposition: "RETURNED",
              returnedCash: {
                reference: "M116 mixed return",
                payouts: [{ method: "CASH", amount: returnedAmount }],
              },
            },
            fixture.ownerId,
          );
          const inputs = await loadMonth(fixture);
          assert.equal(
            resolvedCash(inputs).cash!.salonCash,
            crossMonth ? (zeroCompanion ? "-500.0000" : "-582.5700") : "500.0000",
          );
          const loaded = await prisma.$transaction((tx) =>
            loadPayrollPurchaseSaleVoid(tx, fixture.tenantId, mixed.id, "Asia/Singapore"),
          );
          assert.equal(loaded.saleVoid.cashDisposition, "RETURNED");
          if (loaded.saleVoid.cashDisposition === "RETURNED") {
            assert.equal(loaded.saleVoid.grossCents, String(returnedAmount * 100));
            const ordinary = loaded.saleVoid.allocations.find((row) => row.itemType === itemType)!;
            assert.equal(ordinary.grossCents, zeroCompanion ? "0" : "9000");
            assert.equal(ordinary.cashAttribution?.allocations.length ?? 0, zeroCompanion ? 0 : 1);
          }
          assert.equal(loaded.payments.length, zeroTender ? 2 : 1);
          assert.equal(loaded.receipts.length, 1);
          assert.deepEqual(loaded.saleVoid.reversals.map((row) => row.originalSourceType).sort(), [
            "COLLECTION",
            "SALE_LINE",
          ]);
          if (foc) {
            const capture = loaded.events.find((row) => row.sourceType === "SALE_LINE")!;
            const evidence = capture.evidence as {
              lines: { commissionType: string; baseAmount: string }[];
            };
            assert.equal(evidence.lines[0].commissionType, "FOC");
            assert.equal(evidence.lines[0].baseAmount, "90.0000");
            // A nonzero FOC commission base is not a cash allocation. Its frozen
            // operational economics are still mandatory, independently of capture.
            await assert.rejects(
              prisma.$transaction((tx) =>
                loadPayrollPurchaseSaleVoid(
                  new Proxy(tx, {
                    get(target, property, receiver) {
                      if (property !== "sale") return Reflect.get(target, property, receiver);
                      return new Proxy(target.sale, {
                        get(delegate, method) {
                          if (method === "findFirst")
                            return async (...args: Parameters<typeof delegate.findFirst>) => {
                              const sale = (await delegate.findFirst(
                                ...args,
                              )) as typeof loaded.sale;
                              return {
                                ...sale,
                                lines: sale.lines.map((line) => ({
                                  ...line,
                                  payrollEconomics: null,
                                })),
                              };
                            };
                          return Reflect.get(delegate, method);
                        },
                      });
                    },
                  }) as PayrollCloseTransaction,
                  fixture.tenantId,
                  mixed.id,
                  "Asia/Singapore",
                ),
              ),
              /SALE_VOID_CASH_UNCONFIRMED|FOC_OPERATIONAL_LIST_PRICE_NOT_LOADED/,
            );
          }
          for (const corruption of [
            "salePayment",
            "commissionCollection",
            "payrollSourceEvent",
            "auditLog",
          ] as const) {
            await assert.rejects(
              prisma.$transaction((tx) =>
                loadPayrollPurchaseSaleVoid(
                  new Proxy(tx, {
                    get(target, property, receiver) {
                      if (property !== corruption) return Reflect.get(target, property, receiver);
                      return new Proxy(target[corruption], {
                        get(delegate, method) {
                          if (method === "findMany") return async () => [];
                          return Reflect.get(delegate, method);
                        },
                      });
                    },
                  }) as PayrollCloseTransaction,
                  fixture.tenantId,
                  mixed.id,
                  "Asia/Singapore",
                ),
              ),
              /Authoritative payroll inputs unavailable/,
              corruption,
            );
          }
          mock.timers.reset();
          mock.timers.enable({ apis: ["Date"], now: new Date(inputs.endsAt) });
          try {
            await assert.rejects(
              approveStoredPayrollClose(
                inputs.periodKey,
                prior.revision,
                "Refuse stale mixed draft",
              ),
              /changed|stale|recalculate/i,
            );
            const draft = await calculateStoredPayrollClose(inputs.periodKey, prior.revision);
            const approved = await approveStoredPayrollClose(
              inputs.periodKey,
              draft.revision,
              "Reviewed mixed cash return",
            );
            assert.equal(approved.status, "APPROVED");
            await prisma.service.update({
              where: { id: fixture.serviceId },
              data: { nonmemberPrice: "999" },
            });
            assert.equal(
              payrollInputHash(
                (
                  await prisma.payrollClose.findFirstOrThrow({
                    where: { periodKey: inputs.periodKey },
                  })
                ).state,
              ),
              payrollInputHash(approved),
            );
            if (frozenOriginal)
              assert.equal(
                payrollInputHash(
                  (
                    await prisma.payrollClose.findFirstOrThrow({
                      where: { periodKey: original.periodKey },
                    })
                  ).state,
                ),
                frozenOriginal,
              );
          } finally {
            mock.timers.reset();
          }
        } finally {
          mock.timers.reset();
        }
      }),
    );
  }
}

test(
  "CP-005 an ordinary sale cannot claim a returned void",
  { skip: disabled },
  tenantCase("ordinary", async (fixture) => {
    const service = await runAtOutlet(fixture.outletId, () =>
      createSale({
        customerId: fixture.customerId,
        lines: [
          {
            itemType: "SERVICE",
            itemId: fixture.serviceId,
            quantity: 1,
            attribution: {
              sellers: shares(fixture.ownerId),
              performers: shares(fixture.ownerId),
            },
          },
        ],
        payments: [{ method: "CASH", amount: 90 }],
        collection: {
          currency: "SGD",
          allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "9000" }],
        },
      }),
    );
    // A service sale that gave money back is refunded, not voided (ADR 0020 / R1): the
    // returned-void contract is a purchase shape, and the writer says so instead of
    // recording a giving-back in a vocabulary the close cannot reconcile.
    await assert.rejects(
      voidSale(
        service.id,
        {
          reason: "Customer changed their mind",
          cashDisposition: "RETURNED",
          returnedCash: { reference, payouts: [{ method: "CASH", amount: 90 }] },
        },
        fixture.ownerId,
      ),
      codeIs("VOID_RETURN_UNSUPPORTED_SALE"),
    );
    const sale = await prisma.sale.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, id: service.id },
      select: { status: true },
    });
    assert.equal(sale.status, "COMPLETED");
  }),
);

test(
  "CP-005 an attestation edited outside the writer cannot overstate the return",
  { skip: disabled },
  tenantCase("tampered", async (fixture) => {
    await voidSale(
      fixture.purchaseId,
      { reason: "Customer changed their mind", ...returnAll() },
      fixture.ownerId,
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, action, targetId: fixture.purchaseId },
    });
    const metadata = audit.metadata as ReturnedMetadata;
    await prisma.auditLog.update({
      where: { id: audit.id },
      data: {
        metadata: {
          ...metadata,
          returned: {
            ...metadata.returned,
            grossCents: "64500",
            payouts: [{ ...metadata.returned.payouts[0]!, grossCents: "64500" }],
          },
        },
      },
    });
    // The loader re-derives the total from the surviving tenders, so the month refuses
    // rather than subtracting a return the till never made.
    await assert.rejects(loadMonth(fixture), /SALE_VOID_CASH_UNCONFIRMED/);
  }),
);
