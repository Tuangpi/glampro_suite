import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { PAYROLL_DEFAULT_SETTINGS, capturePayrollPackagePurchase } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { captureCollectionEvidence } from "./commission-collection-evidence.js";
import { appendPayrollSource } from "./payroll-source-event.js";
import {
  approveStoredPayrollClose,
  calculateStoredPayrollClose,
  type PayrollCloseLoader,
} from "./payroll-close-store.js";
import { payrollInputHash } from "./payroll-close-state.js";
import { lockCommissionConfiguration } from "./commission.service.js";
import { createSale } from "./sale.service.js";
import { resolvePayrollFocEconomics } from "./payroll-close-foc.js";
import { drawPayrollPackageSessions } from "./payroll-package-session.js";
import { captureRedemptionCommission } from "./redemption-commission-evidence.js";
import { loadPayrollPackageRedemptionHistory } from "./payroll-close-redemption-loader.js";
import { loadPayrollSalePackageCoverage } from "./payroll-close-sale-coverage.js";
import { loadAuthoritativePayrollCloseInputs } from "./payroll-close-loader.js";
import { openPayrollClose } from "./payroll-close-state.js";
import { transferSessionPackage } from "./session-transfer.service.js";

test(
  "CP-005 isolated authoritative ordinary close, missing-capture rollback and stale approval",
  { skip: process.env.RUN_CP005_ACCEPTANCE !== "true" },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55485");
    assert.equal(url.pathname, "/payroll_close_test");
    const tenantId = `cp005-load-${randomUUID()}`;
    const ownerId = `${tenantId}-o`;
    const staffId = `${tenantId}-s`;
    const scope = <T>(fn: () => T) => runAsTenant(tenantId, fn, ownerId);
    try {
      await runAsPlatform(() =>
        prisma.tenant.create({
          data: { id: tenantId, slug: tenantId, name: "Synthetic loader", status: "ACTIVE" },
        }),
      );
      await scope(async () => {
        for (const [id, globalRole] of [
          [ownerId, "SUPER_ADMIN"],
          [staffId, "STAFF"],
        ] as const) {
          await prisma.user.create({
            data: {
              id,
              tenantId,
              name: id,
              email: `${id}@example.test`,
              passwordHash: "synthetic-unused",
              globalRole,
              twoFactorEnabled: true,
            },
          });
        }
        // Bootstrap only: persisted first-close inventory is intentionally still missing.
        // August is synthetic; September below must use the server-owned DB loader.
        const bootstrap: PayrollCloseLoader = async () => ({
          periodKey: "2026-08",
          timeZone: "Asia/Singapore",
          currency: "SGD",
          startsAt: "2026-07-31T16:00:00.000Z",
          endsAt: "2026-08-31T16:00:00.000Z",
          evidence: { syntheticBootstrap: true },
          staff: [],
        });
        await calculateStoredPayrollClose("2026-08", 0, bootstrap);
        await approveStoredPayrollClose("2026-08", 1, "Synthetic prior bootstrap", bootstrap);
        const outlet = await prisma.outlet.create({
          data: { tenantId, name: "Synthetic outlet", slug: "synthetic-loader" },
        });
        const at = new Date("2026-09-15T00:00:00Z");
        const sale = await runAtOutlet(outlet.id, () =>
          prisma.sale.create({
            data: {
              tenantId,
              outletId: outlet.id,
              status: "COMPLETED",
              collectionCurrency: "SGD",
              totalQuantity: 1,
              totalAmount: "109",
              paidAmount: "109",
              taxAmount: "9",
              soldAt: at,
            },
          }),
        );
        const shares = [{ staffId, share: 10000 }];
        const line = await prisma.saleLine.create({
          data: {
            tenantId,
            saleId: sale.id,
            itemType: "SERVICE",
            itemId: "synthetic-service",
            itemName: "Synthetic service",
            quantity: 1,
            unitPrice: "109",
            lineTotal: "109",
            taxAmount: "9",
            attribution: { sellers: shares, performers: shares },
          },
        });
        const payment = await prisma.salePayment.create({
          data: { tenantId, saleId: sale.id, method: "CASH", amount: "109", createdAt: at },
        });
        await prisma.$transaction(async (tx) => {
          await captureCollectionEvidence(tx, {
            eventKey: `synthetic:${payment.id}`,
            sourceType: "SALE_PAYMENT",
            sourceId: payment.id,
            saleId: sale.id,
            currency: "SGD",
            reason: "Synthetic cash collection",
            allocations: [{ saleLineId: line.id, grossCents: "10900" }],
          });
        });
        for (const [kind, targetId, payload] of [
          ["SETTINGS", "company", PAYROLL_DEFAULT_SETTINGS],
          ...[ownerId, staffId].flatMap((id) => [
            [
              "STAFF",
              id,
              { joinDate: "2020-01-01", stageEndOverride: null, commissionRole: "NON_COMMISSION" },
            ],
            [
              "PROFILE",
              id,
              {
                basicSalary: id === staffId ? "2000" : "0",
                fixedOvertime: "0",
                levy: "0",
                salesAlertPct: "50",
              },
            ],
          ]),
        ] as [string, string, object][]) {
          await prisma.payrollConfigurationEvent.create({
            data: {
              tenantId,
              kind,
              targetId,
              revision: 1,
              actorId: ownerId,
              reason: "Synthetic audited configuration",
              createdAt: new Date("2026-08-01T00:00:00Z"),
              payload,
            },
          });
        }
        // Independent sale inventory finds the missing source and rolls back the draft.
        await assert.rejects(calculateStoredPayrollClose("2026-09", 0), /INVENTORY_UNAVAILABLE/);
        assert.equal(await prisma.payrollClose.count({ where: { periodKey: "2026-09" } }), 0);
        assert.equal(await prisma.payrollCloseEvent.count({ where: { periodKey: "2026-09" } }), 0);
        await prisma.$transaction(async (tx) => {
          await lockCommissionConfiguration(tx, tenantId);
          await appendPayrollSource(tx, {
            sourceKey: `sale-line:${line.id}`,
            sourceType: "SALE_LINE",
            sourceId: line.id,
            saleId: sale.id,
            occurredAt: at,
            reason: "Synthetic operational service",
            commissionType: "SVC",
            baseAmount: "100.0000",
            units: "1.0000",
            shares,
            itemId: "synthetic-service",
          });
        });
        // Actual checkout writes independent immutable FOC economics. Catalogue
        // member/list prices intentionally differ and later catalogue edits cannot
        // rewrite the original list-price activity.
        const catalogue = await prisma.module.upsert({
          where: { code: "catalogue" },
          update: {},
          create: { code: "catalogue", name: "Catalogue", category: "Core", isCore: true },
        });
        await prisma.tenantModule.create({ data: { tenantId, moduleId: catalogue.id } });
        const complimentary = await prisma.service.create({
          data: {
            tenantId,
            name: "FOC independent list",
            memberPrice: "100",
            nonmemberPrice: "492",
          },
        });
        // Keep the separate live-checkout shape check outside the two historical
        // close months. It is not a settled receipt in either fixture inventory.
        mock.timers.enable({ apis: ["Date"], now: new Date("2027-01-15T00:00:00Z") });
        let focSale;
        try {
          focSale = await runAtOutlet(outlet.id, () =>
            createSale({
              lines: [
                {
                  itemType: "SERVICE",
                  itemId: complimentary.id,
                  quantity: 2,
                  discountPercent: 100,
                  attribution: { performers: shares },
                },
              ],
              payments: [],
            }),
          );
        } finally {
          mock.timers.reset();
        }
        const checkoutLine = await prisma.saleLine.findFirstOrThrow({
          where: { saleId: focSale.id },
        });
        const checkoutSale = await prisma.sale.findFirstOrThrow({ where: { id: focSale.id } });
        assert.equal(
          resolvePayrollFocEconomics(checkoutLine, checkoutSale.soldAt).baseAmount,
          "984.0000",
        );
        await assert.rejects(
          prisma.saleLine.update({
            where: { id: checkoutLine.id },
            data: {
              payrollEconomics: { listUnitPrice: "1.00" },
            },
          }),
          /immutable/,
        );
        await assert.rejects(
          prisma.saleLine.delete({ where: { id: checkoutLine.id } }),
          /immutable/,
        );
        await prisma.service.update({
          where: { id: complimentary.id },
          data: { nonmemberPrice: "999" },
        });
        // Historical synthetic receipt exercises default-loader month calculation;
        // it carries the same shape as the actual independently verified checkout.
        const historicalFoc = await runAtOutlet(outlet.id, () =>
          prisma.sale.create({
            data: {
              tenantId,
              outletId: outlet.id,
              status: "COMPLETED",
              collectionCurrency: "SGD",
              totalQuantity: 2,
              totalAmount: "0",
              paidAmount: "0",
              soldAt: at,
            },
          }),
        );
        const historicalLine = await prisma.saleLine.create({
          data: {
            tenantId,
            saleId: historicalFoc.id,
            itemType: "SERVICE",
            itemId: complimentary.id,
            itemName: "Synthetic historical FOC",
            quantity: 2,
            unitPrice: "0",
            lineTotal: "0",
            attribution: { performers: shares },
          },
        });
        await assert.rejects(
          calculateStoredPayrollClose("2026-09", 0),
          /FOC_OPERATIONAL_LIST_PRICE_NOT_LOADED/,
        );
        await prisma.saleLine.update({
          where: { id: historicalLine.id },
          data: {
            payrollEconomics: {
              ...(checkoutLine.payrollEconomics as object),
              saleId: historicalFoc.id,
              saleLineId: historicalLine.id,
              soldAt: at.toISOString(),
            },
          },
        });
        await assert.rejects(calculateStoredPayrollClose("2026-09", 0), /INVENTORY_UNAVAILABLE/);
        await prisma.$transaction(async (tx) => {
          await lockCommissionConfiguration(tx, tenantId);
          await appendPayrollSource(tx, {
            sourceKey: `sale-line:${historicalLine.id}`,
            sourceType: "SALE_LINE",
            sourceId: historicalLine.id,
            saleId: historicalFoc.id,
            occurredAt: at,
            reason: "Synthetic historical FOC",
            commissionType: "FOC",
            baseAmount: "984.0000",
            units: "2.0000",
            shares,
            itemId: complimentary.id,
          });
        });
        const customer = await prisma.customer.create({
          data: { tenantId, name: "Synthetic credit buyer" },
        });
        const valuePackage = await prisma.valuePackage.create({
          data: { tenantId, name: "Synthetic bonus credit", price: "109", credit: "150" },
        });
        const valueSale = await runAtOutlet(outlet.id, () =>
          prisma.sale.create({
            data: {
              tenantId,
              customerId: customer.id,
              outletId: outlet.id,
              status: "COMPLETED",
              collectionCurrency: "SGD",
              totalQuantity: 1,
              totalAmount: "109",
              paidAmount: "109",
              taxAmount: "9",
              soldAt: at,
            },
          }),
        );
        const valueLine = await prisma.saleLine.create({
          data: {
            tenantId,
            saleId: valueSale.id,
            itemType: "VALUE_PACKAGE",
            itemId: valuePackage.id,
            itemName: "Synthetic bonus credit",
            quantity: 1,
            unitPrice: "109",
            lineTotal: "109",
            taxAmount: "9",
            attribution: { sellers: shares },
          },
        });
        const valuePayment = await prisma.salePayment.create({
          data: {
            tenantId,
            saleId: valueSale.id,
            method: "CASH",
            amount: "109",
            createdAt: at,
          },
        });
        await prisma.$transaction((tx) =>
          captureCollectionEvidence(tx, {
            eventKey: `synthetic:${valuePayment.id}`,
            sourceType: "SALE_PAYMENT",
            sourceId: valuePayment.id,
            saleId: valueSale.id,
            currency: "SGD",
            reason: "Synthetic value collection",
            allocations: [{ saleLineId: valueLine.id, grossCents: "10900" }],
          }),
        );
        // A captured commission alone cannot establish original purchase economics.
        await assert.rejects(
          calculateStoredPayrollClose("2026-09", 0),
          /VALUE_PURCHASE_EVIDENCE_UNCONFIRMED/,
        );
        assert.equal(await prisma.payrollClose.count({ where: { periodKey: "2026-09" } }), 0);
        const holding = await prisma.customerValuePackageHolding.create({
          data: {
            tenantId,
            customerId: customer.id,
            valuePackageId: valuePackage.id,
            saleLineId: valueLine.id,
            amount: "150",
            amountRemaining: "150",
            payrollPurchaseSnapshot: {
              version: 1,
              saleId: valueSale.id,
              saleLineId: valueLine.id,
              currency: "SGD",
              paidNet: "100.00",
              credit: "150.00",
              sellers: shares,
            },
          },
        });
        await assert.rejects(
          prisma.customerValuePackageHolding.update({
            where: { id: holding.id },
            data: { payrollPurchaseSnapshot: { paidNet: "150.00" } },
          }),
          /cannot be rewritten/,
        );
        await prisma.valuePackage.update({
          where: { id: valuePackage.id },
          data: { price: "999", credit: "999" },
        });
        const packageSettings = {
          sale: { mode: "FIXED" as const, amount: "12.34" },
          redemption: { mode: "FOLLOW_PLAN" as const },
          minimumDepositPct: "30",
        };
        const sessionPackage = await prisma.package.create({
          data: {
            tenantId,
            name: "Synthetic fixed sale package",
            sessionCount: 10,
            memberPrice: "109",
            nonmemberPrice: "109",
            commissionSettings: packageSettings,
          },
        });
        const packageSale = await runAtOutlet(outlet.id, () =>
          prisma.sale.create({
            data: {
              tenantId,
              customerId: customer.id,
              outletId: outlet.id,
              status: "COMPLETED",
              collectionCurrency: "SGD",
              totalQuantity: 1,
              totalAmount: "109",
              paidAmount: "109",
              taxAmount: "9",
              soldAt: at,
            },
          }),
        );
        const packageLine = await prisma.saleLine.create({
          data: {
            tenantId,
            saleId: packageSale.id,
            itemType: "PACKAGE",
            itemId: sessionPackage.id,
            itemName: "Synthetic fixed sale package",
            quantity: 1,
            unitPrice: "109",
            lineTotal: "109",
            taxAmount: "9",
            attribution: { sellers: shares },
          },
        });
        const packagePayment = await prisma.salePayment.create({
          data: {
            tenantId,
            saleId: packageSale.id,
            method: "CASH",
            amount: "32.70",
            createdAt: at,
          },
        });
        await prisma.$transaction((tx) =>
          captureCollectionEvidence(tx, {
            eventKey: `synthetic:${packagePayment.id}`,
            sourceType: "SALE_PAYMENT",
            sourceId: packagePayment.id,
            saleId: packageSale.id,
            currency: "SGD",
            reason: "Synthetic package minimum deposit",
            allocations: [{ saleLineId: packageLine.id, grossCents: "3270" }],
          }),
        );
        await assert.rejects(
          calculateStoredPayrollClose("2026-09", 0),
          /PACKAGE_PURCHASE_EVIDENCE_UNCONFIRMED/,
        );
        assert.equal(await prisma.payrollClose.count({ where: { periodKey: "2026-09" } }), 0);
        const packageHolding = await prisma.customerPackageHolding.create({
          data: {
            tenantId,
            customerId: customer.id,
            packageId: sessionPackage.id,
            saleLineId: packageLine.id,
            quantity: 10,
            quantityRemaining: 10,
            redemptionRules: {
              mode: "PER_UNIT",
              requirements: [{ serviceId: complimentary.id, quantity: 1 }],
            },
            payrollAvailableOrdinals: [{ first: 1, last: 10 }],
            payrollPurchaseSnapshot: capturePayrollPackagePurchase({
              saleId: packageSale.id,
              saleLineId: packageLine.id,
              packageId: sessionPackage.id,
              originalCustomerId: customer.id,
              outletId: outlet.id,
              purchasedAt: at.toISOString(),
              currency: "SGD",
              grantedSessions: 10,
              grossCents: "10900",
              netCents: "10000",
              taxCents: "900",
              sellers: shares,
              commissionSettings: packageSettings,
            }),
          },
        });
        await assert.rejects(
          prisma.customerPackageHolding.update({
            where: { id: packageHolding.id },
            data: { payrollPurchaseSnapshot: { netCents: "99900" } },
          }),
          /immutable/,
        );
        await prisma.package.update({
          where: { id: sessionPackage.id },
          data: {
            memberPrice: "999",
            nonmemberPrice: "999",
            sessionCount: 99,
            commissionSettings: { ...packageSettings, sale: { mode: "EXCLUDE" } },
          },
        });
        // Deposit alone earns only its collected net, with original units/award.
        const depositDraft = await calculateStoredPayrollClose("2026-09", 0);
        const depositStatement = depositDraft.calculation!.statements.find(
          (row) => row.staff.id === staffId,
        )!;
        assert.equal(depositStatement.inputs.collection, "230.0000");
        const debt = await prisma.customerOutstanding.create({
          data: {
            tenantId,
            customerId: customer.id,
            saleId: packageSale.id,
            unpaidAmount: "76.30",
          },
        });
        const laterPayment = await prisma.customerOutstandingPayment.create({
          data: {
            tenantId,
            customerId: customer.id,
            outstandingId: debt.id,
            saleId: packageSale.id,
            paidAmount: "54.50",
            paidAt: new Date("2026-09-20T00:00:00Z"),
          },
        });
        await prisma.$transaction((tx) =>
          captureCollectionEvidence(tx, {
            eventKey: `synthetic:${laterPayment.id}`,
            sourceType: "OUTSTANDING_PAYMENT",
            sourceId: laterPayment.id,
            saleId: packageSale.id,
            currency: "SGD",
            reason: "Synthetic outstanding package collection",
            allocations: [{ saleLineId: packageLine.id, grossCents: "5450" }],
          }),
        );
        await prisma.customerOutstanding.update({
          where: { id: debt.id },
          data: { unpaidAmount: "21.80" },
        });
        await assert.rejects(
          approveStoredPayrollClose("2026-09", 1, "Receipt changed"),
          /inputs changed/,
        );
        const draft = await calculateStoredPayrollClose("2026-09", 1);
        const statement = draft.calculation!.statements.find((row) => row.staff.id === staffId)!;
        assert.equal(statement.inputs.collection, "280.0000");
        const packageBase = draft
          .calculation!.inputs.staff.find((row) => row.staff.id === staffId)!
          .calculation.lines.find(
            (row) => row.commissionType === "PKG_SALE" && row.units === "1.0000",
          )!;
        assert.equal(packageBase.baseAmount, "30.0000");
        assert.equal(packageBase.units, "1.0000");
        assert.equal(packageBase.mode, "FIXED");
        assert.equal(packageBase.fixedCommission, "12.3400");
        const laterBase = draft
          .calculation!.inputs.staff.find((row) => row.staff.id === staffId)!
          .calculation.lines.find(
            (row) => row.commissionType === "PKG_SALE" && row.units === "0.0000",
          )!;
        assert.equal(laterBase.baseAmount, "50.0000");
        assert.equal(laterBase.mode, "FIXED");
        assert.equal(laterBase.fixedCommission, "0.0000");
        const valueBase = draft
          .calculation!.inputs.staff.find((row) => row.staff.id === staffId)!
          .calculation.lines.find((row) => row.commissionType === "VP_SALE")!;
        assert.equal(valueBase.baseAmount, "100.0000");
        assert.equal(valueBase.units, "1.0000");
        assert.equal(valueBase.fallbackRatePct, "0");
        assert.equal(statement.payroll.takeHome, "2061.54");
        // Current legacy staff rate and later-published backdated rules must not
        // rewrite a source whose operational writer froze the earlier selection.
        await prisma.$transaction(async (tx) => {
          await lockCommissionConfiguration(tx, tenantId);
          await tx.user.update({ where: { id: staffId }, data: { commissionRate: "75" } });
          await tx.commissionRule.create({
            data: {
              tenantId,
              staffId,
              itemKind: "SERVICE",
              scope: "ITEM",
              targetId: "synthetic-service",
              scopeKey: JSON.stringify([staffId, "SERVICE", "ITEM", "synthetic-service"]),
              rate: "90",
              effectiveAt: new Date("2026-09-01T00:00:00Z"),
              createdAt: new Date(Date.now() + 60_000),
              actorId: ownerId,
              reason: "Synthetic later publication",
            },
          });
        });
        await prisma.$transaction(async (tx) => {
          await lockCommissionConfiguration(tx, tenantId);
          await tx.payrollConfigurationEvent.create({
            data: {
              tenantId,
              kind: "PROFILE",
              targetId: staffId,
              revision: 2,
              actorId: ownerId,
              reason: "Synthetic historical revision",
              createdAt: new Date("2026-09-20T00:00:00Z"),
              payload: { basicSalary: "2100", fixedOvertime: "0", levy: "0", salesAlertPct: "50" },
            },
          });
        });
        await assert.rejects(
          approveStoredPayrollClose("2026-09", 2, "Stale approval refused"),
          /inputs changed/,
        );
        assert.equal(await prisma.payrollCloseEvent.count({ where: { periodKey: "2026-09" } }), 2);
        const updated = await calculateStoredPayrollClose("2026-09", 2);
        assert.equal(
          updated.calculation!.statements.find((row) => row.staff.id === staffId)!.payroll.takeHome,
          "2161.54",
        );
        assert.equal(
          updated
            .calculation!.inputs.staff.find((row) => row.staff.id === staffId)!
            .calculation.lines.find((row) => row.commissionType === "SVC")!.fallbackRatePct,
          "0",
        );
        const approved = await approveStoredPayrollClose(
          "2026-09",
          3,
          "Authoritative ordinary review",
        );
        assert.equal(approved.status, "APPROVED");
        assert.equal(payrollInputHash(approved.calculation), payrollInputHash(updated.calculation));
        await assert.rejects(calculateStoredPayrollClose("2026-09", 4), /immutable/);
        const frozenSeptember = payrollInputHash(approved.calculation);
        // October is still open on the development date; exercise approval only
        // under an explicit post-month test clock, never weaken the runtime gate.
        mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-01T00:00:00Z") });
        const octoberEmpty = await calculateStoredPayrollClose("2026-10", 0);
        const finalPayment = await prisma.customerOutstandingPayment.create({
          data: {
            tenantId,
            customerId: customer.id,
            outstandingId: debt.id,
            saleId: packageSale.id,
            paidAmount: "21.80",
            paidAt: new Date("2026-09-30T16:00:00.000Z"),
          },
        });
        await prisma.$transaction((tx) =>
          captureCollectionEvidence(tx, {
            eventKey: `synthetic:${finalPayment.id}`,
            sourceType: "OUTSTANDING_PAYMENT",
            sourceId: finalPayment.id,
            saleId: packageSale.id,
            currency: "SGD",
            reason: "Synthetic cross-month balance",
            allocations: [{ saleLineId: packageLine.id, grossCents: "2180" }],
          }),
        );
        await prisma.customerOutstanding.update({
          where: { id: debt.id },
          data: { unpaidAmount: "0" },
        });
        await assert.rejects(
          approveStoredPayrollClose("2026-10", octoberEmpty.revision, "Stale cross-month draft"),
          /inputs changed/,
        );
        const october = await calculateStoredPayrollClose("2026-10", octoberEmpty.revision);
        const octoberStaff = october.calculation!.inputs.staff.find(
          (row) => row.staff.id === staffId,
        )!;
        assert.equal(octoberStaff.collection, "20.0000");
        assert.equal(octoberStaff.calculation.lines.length, 1);
        assert.equal(octoberStaff.calculation.lines[0].baseAmount, "20.0000");
        assert.equal(octoberStaff.calculation.lines[0].units, "0.0000");
        assert.equal(octoberStaff.calculation.lines[0].fixedCommission, "0.0000");
        const octoberApproved = await approveStoredPayrollClose(
          "2026-10",
          october.revision,
          "Synthetic cross-month review",
        );
        assert.equal(octoberApproved.status, "APPROVED");
        const frozenOctober = payrollInputHash(octoberApproved.calculation);
        const september = await prisma.payrollClose.findFirstOrThrow({
          where: { periodKey: "2026-09" },
        });
        assert.equal(
          payrollInputHash((september.state as unknown as typeof approved).calculation),
          frozenSeptember,
        );
        // Real append-only transfer writer preserves the purchase and seller
        // snapshot, while November usage belongs to the recipient.
        mock.timers.reset();
        const recipient = await prisma.customer.create({
          data: { tenantId, name: "Synthetic package recipient" },
        });
        const beforeTransfer = await prisma.customerPackageHolding.findFirstOrThrow({
          where: { id: packageHolding.id },
        });
        const transfer = await transferSessionPackage(
          customer.id,
          packageHolding.id,
          {
            targetCustomerId: recipient.id,
            expectedUpdatedAt: beforeTransfer.updatedAt.toISOString(),
            reason: "Synthetic original-value transfer acceptance",
            confirmed: true,
          },
          ownerId,
        );
        assert.equal(transfer.quantity, 10);
        // Server-owned holding history remains separate from enabling monthly
        // usage coverage. Exercise real draw/capture writers on the isolated DB.
        mock.timers.reset();
        mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-02T00:00:00Z") });
        await prisma.$transaction(
          async (tx) => {
            const usage = await runAtOutlet(outlet.id, () =>
              tx.sale.create({
                data: {
                  tenantId,
                  customerId: recipient.id,
                  outletId: outlet.id,
                  status: "COMPLETED",
                  collectionCurrency: "SGD",
                  totalQuantity: 1,
                  totalAmount: "109",
                  paidAmount: "109",
                  soldAt: new Date(),
                },
              }),
            );
            const serviceLine = await tx.saleLine.create({
              data: {
                tenantId,
                saleId: usage.id,
                itemType: "SERVICE",
                itemId: complimentary.id,
                itemName: "Synthetic covered service",
                quantity: 1,
                unitPrice: "109",
                lineTotal: "109",
                attribution: { performers: shares },
              },
            });
            const draw = await drawPayrollPackageSessions(tx, packageHolding.id, 1);
            await tx.salePayment.create({
              data: {
                tenantId,
                saleId: usage.id,
                method: "PACKAGE",
                amount: "109",
                createdAt: new Date(),
              },
            });
            const redemption = await tx.customerRedemption.create({
              data: {
                tenantId,
                customerId: recipient.id,
                saleId: usage.id,
                itemType: "PACKAGE",
                itemId: sessionPackage.id,
                holdingId: packageHolding.id,
                quantity: 1,
                usedAt: new Date(),
              },
            });
            await tx.customerPackageHolding.update({
              where: { id: packageHolding.id },
              data: { quantityRemaining: { decrement: 1 } },
            });
            await assert.rejects(
              loadPayrollPackageRedemptionHistory(tx, packageHolding.id),
              /HISTORY_UNCONFIRMED/,
            );
            await captureRedemptionCommission(
              tx,
              redemption.id,
              [
                {
                  saleLineId: serviceLine.id,
                  serviceId: complimentary.id,
                  quantity: 1,
                  performers: shares,
                },
              ],
              undefined,
              draw,
            );
            const loaded = await loadPayrollPackageRedemptionHistory(tx, packageHolding.id);
            assert.equal(loaded.verified.redemptions.length, 1);
            assert.equal(loaded.verified.redemptions[0].session.baseAmount, "10.0000");
            assert.deepEqual(loaded.verified.remaining, [{ first: 2, last: 10 }]);
            const covered = await loadPayrollSalePackageCoverage(tx, usage.id);
            assert.deepEqual(covered.lines, [
              {
                saleLineId: serviceLine.id,
                coveredQuantity: 1,
                remainingQuantity: 0,
              },
            ]);
          },
          { timeout: 30000 },
        );
        const history = await prisma.$transaction((tx) =>
          loadPayrollPackageRedemptionHistory(tx, packageHolding.id),
        );
        assert.equal(history.verified.redemptions[0].session.baseAmount, "10.0000");
        assert.equal(history.verified.purchase.originalCustomerId, customer.id);
        assert.deepEqual(history.verified.purchase.sellers, shares);
        assert.equal(history.evidence.ownership.customerId, recipient.id);
        assert.equal(history.evidence.transfers.length, 1);
        assert.equal(history.evidence.receipts.length, 3);
        const coverage = await prisma.$transaction((tx) =>
          loadPayrollSalePackageCoverage(tx, history.evidence.redemptions[0].saleId),
        );
        assert.equal(coverage.lines[0].coveredQuantity, 1);
        assert.equal(coverage.evidence.histories.length, 1);
        // A second independently purchased/paid holding shares usage service lines
        // with the first. Never clone immutable history or remove captures to make
        // a corruption case: inspect the incomplete state before its real writer.
        mock.timers.reset();
        mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-01T00:00:00Z") });
        const secondHolding = await prisma.$transaction(async (tx) => {
          const purchase = await runAtOutlet(outlet.id, () =>
            tx.sale.create({
              data: {
                tenantId,
                customerId: recipient.id,
                outletId: outlet.id,
                status: "COMPLETED",
                collectionCurrency: "SGD",
                totalQuantity: 1,
                totalAmount: "109",
                paidAmount: "109",
                taxAmount: "9",
                soldAt: new Date(),
              },
            }),
          );
          const line = await tx.saleLine.create({
            data: {
              tenantId,
              saleId: purchase.id,
              itemType: "PACKAGE",
              itemId: sessionPackage.id,
              itemName: "Second independent package",
              quantity: 1,
              unitPrice: "109",
              lineTotal: "109",
              taxAmount: "9",
              attribution: { sellers: shares },
            },
          });
          const holding = await tx.customerPackageHolding.create({
            data: {
              tenantId,
              customerId: recipient.id,
              packageId: sessionPackage.id,
              saleLineId: line.id,
              quantity: 10,
              quantityRemaining: 10,
              redemptionRules: {
                mode: "PER_UNIT",
                requirements: [{ serviceId: complimentary.id, quantity: 1 }],
              },
              payrollAvailableOrdinals: [{ first: 1, last: 10 }],
              payrollPurchaseSnapshot: capturePayrollPackagePurchase({
                saleId: purchase.id,
                saleLineId: line.id,
                packageId: sessionPackage.id,
                originalCustomerId: recipient.id,
                outletId: outlet.id,
                purchasedAt: purchase.soldAt.toISOString(),
                currency: "SGD",
                grantedSessions: 10,
                grossCents: "10900",
                netCents: "10000",
                taxCents: "900",
                sellers: shares,
                commissionSettings: packageSettings,
              }),
            },
          });
          const payment = await tx.salePayment.create({
            data: {
              tenantId,
              saleId: purchase.id,
              method: "CASH",
              amount: "109",
              createdAt: new Date(),
            },
          });
          await captureCollectionEvidence(tx, {
            eventKey: `synthetic:${payment.id}`,
            sourceType: "SALE_PAYMENT",
            sourceId: payment.id,
            saleId: purchase.id,
            currency: "SGD",
            reason: "Second independent package purchase",
            allocations: [{ saleLineId: line.id, grossCents: "10900" }],
          });
          return holding;
        });
        for (const [day, quantity] of [
          [3, 3],
          [4, 1],
        ] as const) {
          mock.timers.reset();
          mock.timers.enable({
            apis: ["Date"],
            now: new Date(`2026-${day === 4 ? "12" : "11"}-0${day}T00:00:00Z`),
          });
          const usageId = await prisma.$transaction(
            async (tx) => {
              const usage = await runAtOutlet(outlet.id, () =>
                tx.sale.create({
                  data: {
                    tenantId,
                    customerId: recipient.id,
                    outletId: outlet.id,
                    status: "COMPLETED",
                    collectionCurrency: "SGD",
                    totalQuantity: quantity,
                    totalAmount: `${109 * quantity}`,
                    paidAmount: "0",
                    soldAt: new Date(),
                  },
                }),
              );
              const line = await tx.saleLine.create({
                data: {
                  tenantId,
                  saleId: usage.id,
                  itemType: "SERVICE",
                  itemId: complimentary.id,
                  itemName: "Shared covered service",
                  quantity,
                  unitPrice: "109",
                  lineTotal: `${109 * quantity}`,
                  attribution: { performers: shares },
                },
              });
              for (const holding of [packageHolding, secondHolding]) {
                const draw = await drawPayrollPackageSessions(tx, holding.id, 1);
                const redemption = await tx.customerRedemption.create({
                  data: {
                    tenantId,
                    customerId: recipient.id,
                    saleId: usage.id,
                    itemType: "PACKAGE",
                    itemId: sessionPackage.id,
                    holdingId: holding.id,
                    quantity: 1,
                    usedAt: new Date(),
                  },
                });
                await tx.customerPackageHolding.update({
                  where: { id: holding.id },
                  data: {
                    quantityRemaining: { decrement: 1 },
                  },
                });
                await assert.rejects(
                  loadPayrollSalePackageCoverage(tx, usage.id),
                  /COVERAGE_UNCONFIRMED/,
                );
                await captureRedemptionCommission(
                  tx,
                  redemption.id,
                  [
                    {
                      saleLineId: line.id,
                      serviceId: complimentary.id,
                      quantity: 1,
                      performers: shares,
                    },
                  ],
                  undefined,
                  draw,
                );
              }
              // Both holdings independently pass, including in the overclaim case.
              await tx.salePayment.createMany({
                data: [packageHolding, secondHolding].map(() => ({
                  tenantId,
                  saleId: usage.id,
                  method: "PACKAGE" as const,
                  amount: "109",
                  createdAt: new Date(),
                })),
              });
              for (const holding of [packageHolding, secondHolding])
                await loadPayrollPackageRedemptionHistory(tx, holding.id);
              if (quantity === 1) {
                await assert.rejects(
                  loadPayrollSalePackageCoverage(tx, usage.id),
                  /SALE_PACKAGE_COVERAGE_UNCONFIRMED/,
                );
              } else {
                // Mirror the checkout writer's uncovered unit, not the original
                // three units. Close must reject missing or full-line captures.
                await assert.rejects(
                  loadAuthoritativePayrollCloseInputs(tx, openPayrollClose("2026-11")),
                  /INVENTORY_UNAVAILABLE/,
                );
                await appendPayrollSource(tx, {
                  sourceKey: `sale-line:${line.id}`,
                  sourceType: "SALE_LINE",
                  sourceId: line.id,
                  saleId: usage.id,
                  occurredAt: usage.soldAt,
                  reason: "Uncovered shared service unit",
                  commissionType: "SVC",
                  baseAmount: "109.0000",
                  units: "1.0000",
                  shares,
                  itemId: complimentary.id,
                });
                const result = await loadPayrollSalePackageCoverage(tx, usage.id);
                assert.deepEqual(result.lines, [
                  { saleLineId: line.id, coveredQuantity: 2, remainingQuantity: 1 },
                ]);
                assert.equal(result.evidence.histories.length, 2);
                assert.equal(result.evidence.captures.length, 2);
              }
              return usage.id;
            },
            { timeout: 30000 },
          );
          // Read committed JSONB records in a fresh transaction, not cached writer inputs.
          if (quantity === 1) {
            await assert.rejects(
              prisma.$transaction((tx) => loadPayrollSalePackageCoverage(tx, usageId)),
              /SALE_PACKAGE_COVERAGE_UNCONFIRMED/,
            );
          } else {
            const reloaded = await prisma.$transaction((tx) =>
              loadPayrollSalePackageCoverage(tx, usageId),
            );
            assert.equal(reloaded.lines[0].remainingQuantity, 1);
            assert.equal(reloaded.evidence.histories.length, 2);
            mock.timers.reset();
            mock.timers.enable({ apis: ["Date"], now: new Date("2026-12-01T00:00:00Z") });
            const november = await calculateStoredPayrollClose("2026-11", 0);
            const inputs = november.calculation!.inputs.staff.find(
              (row) => row.staff.id === staffId,
            )!;
            const packageDraws = inputs.calculation.lines.filter(
              (row) => row.commissionType === "PKG_RED",
            );
            assert.equal(packageDraws.length, 3);
            assert.deepEqual(
              packageDraws.map((row) => row.baseAmount),
              ["10.0000", "10.0000", "10.0000"],
            );
            assert.deepEqual(
              inputs.calculation.lines
                .filter((row) => row.commissionType === "SVC")
                .map((row) => [row.baseAmount, row.units]),
              [["109.0000", "1.0000"]],
            );
            assert.equal(inputs.collection, "100.0000");
            const reloadedDraft = await calculateStoredPayrollClose("2026-11", november.revision);
            assert.equal(reloadedDraft.calculation!.inputHash, november.calculation!.inputHash);
            for (const corruption of [
              "MISSING",
              "FROM",
              "QUANTITY",
              "EXPIRY",
              "TIE",
              "FOREIGN",
            ] as const) {
              const before = await prisma.payrollClose.findFirstOrThrow({
                where: { periodKey: "2026-11" },
              });
              const audits = await prisma.payrollCloseEvent.count({
                where: { periodKey: "2026-11" },
              });
              const alteredLoader: PayrollCloseLoader = (tx, state) =>
                loadAuthoritativePayrollCloseInputs(
                  new Proxy(tx, {
                    get(target, property) {
                      if (property !== "sessionPackageTransferEvent")
                        return Reflect.get(target, property);
                      return new Proxy(target.sessionPackageTransferEvent, {
                        get(delegate, method) {
                          if (method !== "findMany") return Reflect.get(delegate, method);
                          return async (args: Parameters<typeof delegate.findMany>[0]) => {
                            const rows = await delegate.findMany(args);
                            if (corruption === "MISSING") return [];
                            return rows.map((row) => ({
                              ...row,
                              ...(corruption === "FROM" ? { fromCustomerId: recipient.id } : {}),
                              ...(corruption === "QUANTITY" ? { quantity: row.quantity - 1 } : {}),
                              ...(corruption === "EXPIRY"
                                ? { expiresAt: new Date("2027-01-01T00:00:00Z") }
                                : {}),
                              ...(corruption === "TIE"
                                ? { createdAt: history.evidence.redemptions[0].usedAt }
                                : {}),
                              ...(corruption === "FOREIGN" ? { tenantId: "foreign" } : {}),
                            }));
                          };
                        },
                      });
                    },
                  }),
                  state,
                );
              await assert.rejects(
                calculateStoredPayrollClose("2026-11", reloadedDraft.revision, alteredLoader),
                /PACKAGE_OWNERSHIP_UNCONFIRMED/,
                corruption,
              );
              assert.equal(
                payrollInputHash(
                  (await prisma.payrollClose.findFirstOrThrow({ where: { periodKey: "2026-11" } }))
                    .state,
                ),
                payrollInputHash(before.state),
              );
              assert.equal(
                await prisma.payrollCloseEvent.count({ where: { periodKey: "2026-11" } }),
                audits,
              );
            }
            for (const corruption of [
              "MISSING",
              "AMOUNT",
              "GATEWAY",
              "CASH",
              "CREDIT",
              "MONTH_MISSING",
            ] as const) {
              const before = await prisma.payrollClose.findFirstOrThrow({
                where: { periodKey: "2026-11" },
              });
              const audits = await prisma.payrollCloseEvent.count({
                where: { periodKey: "2026-11" },
              });
              const alteredLoader: PayrollCloseLoader = (tx, state) => {
                const altered = new Proxy(tx, {
                  get(target, property) {
                    if (property !== "salePayment") return Reflect.get(target, property);
                    return new Proxy(target.salePayment, {
                      get(delegate, method) {
                        if (method !== "findMany") return Reflect.get(delegate, method);
                        return async (args: Parameters<typeof delegate.findMany>[0]) => {
                          const rows = await delegate.findMany(args);
                          return rows.flatMap((row) => {
                            if (row.method !== "PACKAGE") return [row];
                            if (
                              corruption === "MISSING" ||
                              (corruption === "MONTH_MISSING" && args?.where?.createdAt)
                            )
                              return [];
                            if (corruption === "MONTH_MISSING") return [row];
                            return [
                              {
                                ...row,
                                ...(corruption === "AMOUNT"
                                  ? { amount: row.amount.plus("0.01") }
                                  : {}),
                                ...(corruption === "GATEWAY" ? { sessionId: "unsettled" } : {}),
                                ...(corruption === "CASH" ? { method: "CASH" as const } : {}),
                                ...(corruption === "CREDIT"
                                  ? { method: "PREPAID_CREDIT" as const }
                                  : {}),
                              },
                            ];
                          });
                        };
                      },
                    });
                  },
                });
                return loadAuthoritativePayrollCloseInputs(altered, state);
              };
              await assert.rejects(
                calculateStoredPayrollClose("2026-11", reloadedDraft.revision, alteredLoader),
                /PACKAGE_TENDER_/,
                corruption,
              );
              assert.equal(
                payrollInputHash(
                  (await prisma.payrollClose.findFirstOrThrow({ where: { periodKey: "2026-11" } }))
                    .state,
                ),
                payrollInputHash(before.state),
              );
              assert.equal(
                await prisma.payrollCloseEvent.count({ where: { periodKey: "2026-11" } }),
                audits,
              );
            }
            // Read-only corruptions exercise monthly gates without rewriting or
            // deleting immutable source history. Coverage loaders still read the
            // real operational inventory independently of these monthly events.
            for (const corruption of [
              "FULL_LINE",
              "COVERED_LINE",
              "MISSING_REDEMPTION",
              "REVERSED",
            ] as const) {
              await prisma.$transaction(async (tx) => {
                const altered = new Proxy(tx, {
                  get(target, property) {
                    if (property !== "payrollSourceEvent") return Reflect.get(target, property);
                    return new Proxy(target.payrollSourceEvent, {
                      get(delegate, method) {
                        if (method !== "findMany") return Reflect.get(delegate, method);
                        return async (args: Parameters<typeof delegate.findMany>[0]) => {
                          const rows = await delegate.findMany(args);
                          if (!args?.where?.occurredAt) return rows;
                          if (corruption === "MISSING_REDEMPTION")
                            return rows.filter((row) => row.sourceType !== "REDEMPTION");
                          if (corruption === "COVERED_LINE") {
                            const source = rows.find((row) => row.sourceType === "SALE_LINE")!;
                            return [
                              ...rows,
                              {
                                ...source,
                                id: "unexpected-covered-capture",
                                sourceId: history.evidence.usages[0].lines[0].id,
                              },
                            ];
                          }
                          return rows.map((row) => {
                            if (row.sourceType !== "SALE_LINE") return row;
                            if (corruption === "REVERSED")
                              return { ...row, sourceType: "REVERSAL" };
                            const evidence = row.evidence as { lines: object[] };
                            return {
                              ...row,
                              evidence: {
                                ...evidence,
                                lines: evidence.lines.map((part) => ({
                                  ...part,
                                  baseAmount: "327.0000",
                                  units: "3.0000",
                                })),
                              },
                            };
                          });
                        };
                      },
                    });
                  },
                });
                await assert.rejects(
                  loadAuthoritativePayrollCloseInputs(altered, openPayrollClose("2026-11")),
                  /ORDINARY_SOURCE_ECONOMICS_MISMATCH|COVERED_SERVICE_SOURCE_UNEXPECTED|REDEMPTION_MONTH_CAPTURE_UNCONFIRMED|SOURCE_WORKFLOW_NOT_LOADED/,
                  corruption,
                );
              });
            }
          }
        }
        // Monthly integration supports verified histories, never aggregate overclaims.
        await assert.rejects(
          calculateStoredPayrollClose("2026-12", 0),
          /SALE_PACKAGE_COVERAGE_UNCONFIRMED/,
        );
        assert.equal(await prisma.payrollClose.count({ where: { periodKey: "2026-12" } }), 0);
        assert.equal(await prisma.payrollCloseEvent.count({ where: { periodKey: "2026-12" } }), 0);
        const frozenAfterMultiHolding = await prisma.payrollClose.findFirstOrThrow({
          where: { periodKey: "2026-10" },
        });
        assert.equal(
          payrollInputHash(
            (frozenAfterMultiHolding.state as unknown as typeof octoberApproved).calculation,
          ),
          frozenOctober,
        );
        const frozenAfterUsage = await prisma.payrollClose.findFirstOrThrow({
          where: { periodKey: "2026-09" },
        });
        assert.equal(
          payrollInputHash((frozenAfterUsage.state as unknown as typeof approved).calculation),
          frozenSeptember,
        );
      });
    } finally {
      mock.timers.reset();
      // Retain synthetic immutable evidence only inside the authorized disposable DB.
      await prisma.$disconnect();
    }
  },
);
