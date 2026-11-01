/** Returned-money purchase voids.
 *
 * A customer pays for a package or credit, changes their mind, and the salon hands the
 * money back as it voids. Until this path existed a manager could only attest "no money
 * moved", so payroll counted cash the salon no longer held — or refused the sale outright.
 * These cases prove the real writers on a disposable database:
 *
 * 1. The void writer binds the returned payouts to the tenders it can still see, refusing
 *    a figure that is not exactly what the sale collected and a sale whose consideration
 *    was not all money (an ordinary line, or credit).
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
import { loadAuthoritativePayrollCloseInputs } from "./payroll-close-loader.js";
import { openPayrollClose, payrollInputHash } from "./payroll-close-state.js";
import { authorizeStoredPayrollCarry } from "./payroll-close-authorizations.js";
import { calculateStoredPayrollClose, approveStoredPayrollClose } from "./payroll-close-store.js";

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
