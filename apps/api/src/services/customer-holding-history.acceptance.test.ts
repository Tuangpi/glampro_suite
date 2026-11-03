import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Static, so the `DATABASE_URL` gate below reads `.env` instead of skipping silently.
import "dotenv/config";
import { after, before, describe, it } from "node:test";

/**
 * Customer holding payment/session history against real rows (FR-RPT-06).
 *
 * The pure suite proves the bucket rules; this one proves the read itself — that the
 * loader joins the frozen purchase snapshot, the remaining ordinals, collections,
 * redemptions, refunds and source-sale receivables into one consistent report, that a
 * foreign customer is simply not found, and that reading never writes.
 *
 * Gated on `DATABASE_URL`, like the other database suites: it creates a salon and removes
 * everything it made.
 */
const databaseUrl = process.env["DATABASE_URL"];
process.env.DATABASE_URL ??= "postgresql://glampro:glampro@127.0.0.1:5432/glampro_test";
process.env.NODE_ENV = "test";

const { prisma } = await import("../lib/prisma.js");
const { runAsTenant, runAsPlatform } = await import("../lib/tenant-context.js");
const { capturePayrollPackagePurchase } = await import("@glampro_suite/shared");
const { customerHoldingHistory } = await import("./customer-holding-history.js");

const tenantId = `holding-history-${randomUUID()}`;
const foreignTenantId = `holding-history-foreign-${randomUUID()}`;
const IDS = {
  customer: "",
  foreign: "",
  package: "",
  prepaid: "",
  sale: "",
  activePackage: "",
  activeLine: "",
  pendingPackage: "",
  valueHolding: "",
  reference: "",
  actor: "",
};

async function purge() {
  await runAsPlatform(() =>
    prisma.tenant.deleteMany({ where: { id: { in: [tenantId, foreignTenantId] } } }),
  );
}

/** One package holding plus its frozen purchase snapshot and remaining ordinals. */
async function addPackage(
  label: string,
  quantity: number,
  remaining: number,
  options: {
    grossCents?: string;
    netCents?: string;
    taxCents?: string;
    expiresAt?: Date | null;
    snapshot?: boolean;
  } = {},
) {
  const saleId = label === "active" ? IDS.sale : `sale-${label}`;
  const saleLineId = label === "active" ? IDS.activeLine : `line-${label}`;
  const purchase =
    options.snapshot === false
      ? null
      : capturePayrollPackagePurchase({
          saleId,
          saleLineId,
          packageId: IDS.package,
          originalCustomerId: IDS.customer,
          outletId: null,
          purchasedAt: "2026-10-01T02:00:00.000Z",
          currency: "SGD",
          grantedSessions: quantity,
          grossCents: options.grossCents ?? "40000",
          netCents: options.netCents ?? "36300",
          taxCents: options.taxCents ?? "3700",
          sellers: [{ staffId: "staff-1", share: 10000 }],
        });
  const expiresAt = options.expiresAt ?? null;
  const holding = await prisma.customerPackageHolding.create({
    data: {
      tenantId,
      customerId: IDS.customer,
      packageId: IDS.package,
      quantity,
      quantityRemaining: remaining,
      expiresAt,
      ...(purchase ? { payrollPurchaseSnapshot: purchase } : {}),
    },
  });
  if (!purchase) return { holding, saleLineId };
  const row = await prisma.packagePurchaseSnapshot.create({
    data: {
      tenantId,
      activationId: IDS.reference,
      policyVersion: 1,
      currency: "SGD",
      holdingId: holding.id,
      saleId,
      saleLineId,
      originalCustomerId: IDS.customer,
      grantedSessions: quantity,
      netCents: BigInt(purchase.netCents),
      taxCents: BigInt(purchase.taxCents),
      grossCents: BigInt(purchase.grossCents),
      originalExpiresAt: expiresAt,
      purchasedAt: new Date(purchase.purchasedAt),
      actorId: "owner-1",
    },
  });
  await prisma.packageValuationState.create({
    data: {
      tenantId,
      purchaseId: row.id,
      customerId: IDS.customer,
      availableOrdinals: remaining > 0 ? [{ first: quantity - remaining + 1, last: quantity }] : [],
      expired: Boolean(expiresAt && expiresAt <= new Date()),
    },
  });
  return { holding, saleLineId };
}

/** The whole fixture: two salons, four session holdings, three credit holdings and evidence. */
async function seed() {
  const activation = await prisma.packageValuationActivation.create({
    data: {
      tenantId,
      policyVersion: 1,
      currency: "SGD",
      actorId: "owner-1",
      reason: "Confirm purchase currency",
    },
  });
  IDS.reference = activation.id;
  const sale = await prisma.sale.create({
    data: {
      tenantId,
      customerId: IDS.customer,
      status: "COMPLETED",
      totalQuantity: 1,
      totalAmount: "400.00",
      paidAmount: "300.00",
      soldAt: new Date("2026-10-01T02:00:00.000Z"),
    },
  });
  IDS.sale = sale.id;
  IDS.activeLine = (
    await prisma.saleLine.create({
      data: {
        tenantId,
        saleId: sale.id,
        itemType: "PACKAGE",
        itemId: IDS.package,
        itemName: "Aloha Bundle",
        quantity: 1,
        unitPrice: "400.00",
        lineTotal: "400.00",
        taxAmount: "37.00",
        taxRate: "9.00",
        staffId: IDS.actor,
        attribution: { sellers: [{ staffId: IDS.actor, share: 10000 }] },
      },
    })
  ).id;

  const active = await addPackage("active", 4, 2);
  IDS.activePackage = active.holding.id;
  await addPackage("expired", 2, 2, {
    grossCents: "20000",
    netCents: "18150",
    taxCents: "1850",
    expiresAt: new Date("2020-01-01T00:00:00.000Z"),
  });
  await addPackage("legacy", 3, 3, { snapshot: false });
  const refunded = await addPackage("refunded", 2, 2, {
    grossCents: "20000",
    netCents: "18150",
    taxCents: "1850",
  });
  await prisma.payrollSourceEvent.create({
    data: {
      tenantId,
      sourceKey: `package-refund-${refunded.holding.id}`,
      sourceType: "PACKAGE_REFUND",
      sourceId: refunded.holding.id,
      saleId: sale.id,
      reason: "Cancelled package",
      occurredAt: new Date("2026-10-20T02:00:00.000Z"),
      evidence: { status: "REFUNDED" },
    },
  });
  // Expiry has passed but no expiry run has written the state yet: the report must judge it
  // from the holding and leave the row alone.
  const pending = await addPackage("pending", 2, 2, {
    grossCents: "20000",
    netCents: "18150",
    taxCents: "1850",
    expiresAt: new Date("2026-10-31T00:00:00.000Z"),
  });
  await prisma.packageValuationState.updateMany({
    where: { tenantId, purchase: { holdingId: pending.holding.id } },
    data: { expired: false },
  });
  IDS.pendingPackage = pending.holding.id;

  const value = await addValue("value", "120.00", "42.50");
  IDS.valueHolding = value.id;
  await addValue("spent", "50.00", "0.00");
  await addValue("refunded-value", "30.00", "30.00", true);

  const paidAt = new Date("2026-10-01T03:00:00.000Z");
  const payment = await prisma.salePayment.create({
    data: { tenantId, saleId: sale.id, method: "CASH", amount: "300.00", createdAt: paidAt },
  });
  await prisma.$transaction(async (tx) => {
    const collection = await tx.commissionCollection.create({
      data: {
        tenantId,
        eventKey: `collection-${sale.id}`,
        eventHash: "a".repeat(64),
        sourceType: "SALE_PAYMENT",
        sourceId: payment.id,
        saleId: sale.id,
        currency: "SGD",
        grossCents: 30000n,
        occurredAt: paidAt,
        actorId: IDS.actor,
        reason: "Deposit taken",
      },
    });
    // Tax is the exact cumulative delta over the line, so the evidence trigger accepts it.
    await tx.commissionCollectionAllocation.create({
      data: {
        tenantId,
        collectionId: collection.id,
        saleLineId: IDS.activeLine,
        grossCents: 30000n,
        netCents: 27225n,
        taxCents: 2775n,
        evidence: {},
      },
    });
  });
  const draw = (data: {
    itemType: "PACKAGE" | "VALUE_PACKAGE";
    itemId: string;
    holdingId: string;
    usedAt: string;
    revertedAt?: string;
    amount?: string;
  }) =>
    prisma.customerRedemption.create({
      data: {
        tenantId,
        customerId: IDS.customer,
        saleId: sale.id,
        itemType: data.itemType,
        itemId: data.itemId,
        quantity: 1,
        amount: data.amount ?? null,
        usedAt: new Date(data.usedAt),
        revertedAt: data.revertedAt ? new Date(data.revertedAt) : null,
        holdingId: data.holdingId,
      },
    });
  await draw({
    itemType: "PACKAGE",
    itemId: IDS.package,
    holdingId: active.holding.id,
    usedAt: "2026-10-05T02:00:00.000Z",
  });
  await draw({
    itemType: "PACKAGE",
    itemId: IDS.package,
    holdingId: active.holding.id,
    usedAt: "2026-10-06T02:00:00.000Z",
    revertedAt: "2026-10-07T02:00:00.000Z",
  });
  await draw({
    itemType: "VALUE_PACKAGE",
    itemId: IDS.prepaid,
    holdingId: value.id,
    usedAt: "2026-10-08T02:00:00.000Z",
    amount: "7.50",
  });

  // One receivable against the package sale, and one against an unrelated sale that this
  // read must ignore: receivables follow their own source, never the customer.
  await prisma.customerOutstanding.create({
    data: {
      tenantId,
      customerId: IDS.customer,
      saleId: sale.id,
      unpaidAmount: "100.00",
    },
  });
  const other = await prisma.sale.create({
    data: {
      tenantId,
      customerId: IDS.customer,
      status: "COMPLETED",
      totalQuantity: 1,
      totalAmount: "900.00",
      paidAmount: "0.00",
      soldAt: new Date("2026-10-02T02:00:00.000Z"),
    },
  });
  await prisma.customerOutstanding.create({
    data: {
      tenantId,
      customerId: IDS.customer,
      saleId: other.id,
      unpaidAmount: "900.00",
    },
  });
}

async function addValue(label: string, credit: string, remaining: string, refunded = false) {
  const holding = await prisma.customerValuePackageHolding.create({
    data: {
      tenantId,
      customerId: IDS.customer,
      valuePackageId: IDS.prepaid,
      amount: credit,
      amountRemaining: remaining,
      payrollPurchaseSnapshot: {
        version: 1,
        saleId: `sale-${label}`,
        saleLineId: `line-${label}`,
        currency: "SGD",
        paidNet: credit,
        credit,
        sellers: [{ staffId: "staff-1", share: 10000 }],
      },
    },
  });
  if (refunded)
    await prisma.payrollSourceEvent.create({
      data: {
        tenantId,
        sourceKey: `value-refund-${holding.id}`,
        sourceType: "VALUE_PACKAGE_REFUND",
        sourceId: holding.id,
        saleId: `sale-${label}`,
        reason: "Cancelled credit",
        occurredAt: new Date("2026-10-20T02:00:00.000Z"),
        evidence: { grossCents: "3000", netCents: "0", taxCents: "0" },
      },
    });
  return holding;
}

describe(
  "customer holding history read model",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    before(async () => {
      await purge();
      await runAsPlatform(async () => {
        for (const [id, name] of [
          [tenantId, "Holding history"],
          [foreignTenantId, "Holding history foreign"],
        ] as const)
          await prisma.tenant.create({ data: { id, name, slug: id } });
      });
      await runAsTenant(foreignTenantId, async () => {
        const customer = await prisma.customer.create({
          data: { tenantId: foreignTenantId, name: "Someone Else" },
        });
        IDS.foreign = customer.id;
      });
      await runAsTenant(tenantId, async () => {
        const service = await prisma.service.create({
          data: { tenantId, name: "Cut", memberPrice: "40.00", nonmemberPrice: "50.00" },
        });
        const bundle = await prisma.package.create({
          data: {
            tenantId,
            name: "Aloha Bundle",
            sessionCount: 4,
            memberPrice: "400.00",
            nonmemberPrice: "400.00",
            services: { create: { tenantId, serviceId: service.id } },
          },
        });
        const prepaid = await prisma.valuePackage.create({
          data: { tenantId, name: "Prepaid 120", price: "100.00", credit: "120.00" },
        });
        IDS.package = bundle.id;
        IDS.prepaid = prepaid.id;
        IDS.actor = (
          await prisma.user.create({
            data: {
              tenantId,
              name: "Manager",
              email: `manager-${randomUUID()}@holding-history.test`,
              passwordHash: "fixture",
              globalRole: "MANAGER",
            },
          })
        ).id;
        IDS.customer = (await prisma.customer.create({ data: { tenantId, name: "Mei Ling" } })).id;
        await seed();
      });
    });

    after(async () => {
      await purge();
    });

    it("separates active, expired, unvalued, credit and receivable buckets", async () => {
      const report = await runAsTenant(tenantId, () => customerHoldingHistory(IDS.customer));
      assert.equal(report.customerId, IDS.customer);
      // One live purchase with two of four sessions left.
      assert.deepEqual(report.active, {
        holdings: 1,
        sessionsRemaining: 2,
        net: "181.50",
        originalTax: "18.50",
        gross: "200.00",
      });
      // One long-expired purchase and one expiry no run has processed yet.
      assert.deepEqual(report.expired, {
        holdings: 2,
        sessionsRemaining: 4,
        net: "363.00",
        originalTax: "37.00",
        gross: "400.00",
      });
      // The legacy holding keeps its sessions and claims no money.
      assert.deepEqual(report.unvalued, {
        active: { holdings: 1, sessionsRemaining: 3 },
        expired: { holdings: 0, sessionsRemaining: 0 },
      });
      // Credit is a separate liability, never part of package value.
      assert.deepEqual(report.credit, {
        active: { holdings: 1, remaining: "42.50" },
        expired: { holdings: 0, remaining: "0.00" },
      });
      // Only the package sale's own balance; the unrelated 900.00 is not this purchase.
      assert.deepEqual(report.receivable, {
        sales: 1,
        holdings: 1,
        sourceSaleOutstanding: "100.00",
      });
    });

    it("names every holding's status, including refunds and a pending expiry", async () => {
      const report = await runAsTenant(tenantId, () => customerHoldingHistory(IDS.customer));
      assert.deepEqual(report.holdings.map((row) => row.status).sort(), [
        "ACTIVE",
        "ACTIVE",
        "ACTIVE",
        "EXHAUSTED",
        "EXPIRED",
        "EXPIRED",
        "REFUNDED",
        "REFUNDED",
      ]);
      const pending = report.holdings.find((row) => row.holdingId === IDS.pendingPackage)!;
      assert.equal(pending.status, "EXPIRED");
      assert.equal(pending.value?.gross, "200.00");
      assert.equal(pending.sessions?.remaining, 2);
      // The read judged the expiry from the holding and left the state row untouched.
      const state = await runAsTenant(tenantId, () =>
        prisma.packageValuationState.findFirst({
          where: { purchase: { holdingId: IDS.pendingPackage } },
        }),
      );
      assert.equal(state?.expired, false);
      const legacy = report.holdings.find((row) => row.kind === "SESSIONS" && row.saleId === null)!;
      assert.equal(legacy.value, null);
      assert.deepEqual(legacy.missingEvidence, ["ORIGINAL_PURCHASE_EVIDENCE"]);
    });

    it("lists the captured payment and every draw on the holding it belongs to", async () => {
      const report = await runAsTenant(tenantId, () => customerHoldingHistory(IDS.customer));
      const active = report.holdings.find((row) => row.holdingId === IDS.activePackage)!;
      assert.equal(active.saleId, IDS.sale);
      assert.deepEqual(
        active.payments.map((row) => [row.netCents, row.taxCents, row.grossCents]),
        [["27225", "2775", "30000"]],
      );
      assert.deepEqual(
        active.usage.map((row) => row.revertedAt),
        [null, "2026-10-07T02:00:00.000Z"],
      );
      const credit = report.holdings.find((row) => row.holdingId === IDS.valueHolding)!;
      assert.deepEqual(credit.credit, { granted: "120.00", remaining: "42.50" });
      assert.deepEqual(
        credit.usage.map((row) => row.amount),
        ["7.50"],
      );
      assert.deepEqual(credit.payments, []);
    });

    it("never reads another salon's customer", async () => {
      for (const id of [IDS.foreign, "no-such-customer"])
        await assert.rejects(
          runAsTenant(tenantId, () => customerHoldingHistory(id)),
          {
            code: "CUSTOMER_NOT_FOUND",
          },
        );
    });
  },
);
