import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { PAYROLL_DEFAULT_SETTINGS, type RefundPayrollPackage } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { createSale } from "./sale.service.js";
import { refundPayrollPackage } from "./payroll-package-refund.js";
import { authorizeStoredPayrollCarry } from "./payroll-close-authorizations.js";
import { loadAuthoritativePayrollCloseInputs } from "./payroll-close-loader.js";
import { openPayrollClose, payrollInputHash } from "./payroll-close-state.js";
import {
  approveStoredPayrollClose,
  calculateStoredPayrollClose,
  type PayrollCloseTransaction,
} from "./payroll-close-store.js";

type CloseEvidence = {
  authoritative: {
    prepaidSettlements: { id: string; holdingId: string; netCents: string }[];
    prepaidHistories: unknown[];
  };
  resolved: {
    cash: {
      status: string;
      cash: {
        salonCash: string;
        staff: { staffId: string; collection: string }[];
        refunds: { refunds: { netCents: string; outletId: string }[] } | null;
      } | null;
    };
  };
};

test(
  "CP-005 prepaid refund is inventoried once in its payroll month and invalidates stale calculations",
  {
    skip: process.env.RUN_CP005_ACCEPTANCE !== "true",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55485");
    assert.equal(url.pathname, "/payroll_close_test");
    const tenantId = `cp005-refund-month-${randomUUID()}`;
    const ownerId = `${tenantId}-owner`;
    const scope = <T>(fn: () => T) => runAsTenant(tenantId, fn, ownerId);
    try {
      await runAsPlatform(() =>
        prisma.tenant.create({
          data: {
            id: tenantId,
            slug: tenantId,
            name: "Synthetic refund month",
            status: "ACTIVE",
            gstEnabled: true,
          },
        }),
      );
      await scope(async () => {
        await prisma.user.create({
          data: {
            id: ownerId,
            tenantId,
            name: "Owner",
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
          data: { tenantId, name: "Refund outlet", slug: "refund" },
        });
        const customer = await prisma.customer.create({ data: { tenantId, name: "Refund buyer" } });
        const item = await prisma.package.create({
          data: {
            tenantId,
            name: "Five sessions",
            memberPrice: "545",
            nonmemberPrice: "545",
            sessionCount: 5,
            commissionSettings: {
              sale: { mode: "FOLLOW_PLAN" },
              redemption: { mode: "FOLLOW_PLAN" },
              minimumDepositPct: "0",
            },
          },
        });
        // Operational writers run on the real clock; only the opening approval is
        // backdated so it precedes the local month boundary.
        const parts = new Intl.DateTimeFormat("en", {
          timeZone: "Asia/Singapore",
          year: "numeric",
          month: "2-digit",
        }).formatToParts(new Date());
        const month = ["year", "month"]
          .map((key) => parts.find((part) => part.type === key)!.value)
          .join("-");
        const [year, number] = month.split("-").map(Number);
        mock.timers.enable({
          apis: ["Date"],
          now: new Date(Date.UTC(year, number - 1, 1) - 86400000),
        });
        await authorizeStoredPayrollCarry(
          "OPENING",
          month,
          0,
          {
            staff: [
              {
                staffId: ownerId,
                carryForward: [],
                fallbackCarryCommission: "0.0000000000",
              },
            ],
            evidence: { inventoryReference: "synthetic-reviewed-complete-opening" },
          },
          "Reviewed synthetic opening inventory",
        );
        mock.timers.reset();
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
        ] as [string, string, object][])
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
        const sellers = [{ staffId: ownerId, share: 10000 }];
        const buy = () =>
          runAtOutlet(outlet.id, () =>
            createSale({
              customerId: customer.id,
              lines: [
                { itemType: "PACKAGE", itemId: item.id, quantity: 1, attribution: { sellers } },
              ],
              payments: [{ method: "CASH", amount: 545 }],
              collection: {
                currency: "SGD",
                allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "54500" }],
              },
            }),
          );
        const cancel = (
          holding: { id: string; updatedAt: Date },
          reference: string,
          idempotencyKey = randomUUID(),
        ) => {
          const input: RefundPayrollPackage = {
            idempotencyKey,
            expectedUpdatedAt: holding.updatedAt.toISOString(),
            reason: "Customer cancelled the remaining sessions",
            adminFeeNetCents: "0",
            payoutGrossCents: "54500",
            payoutMethod: "CASH",
            settlement: { confirmed: true, reference },
          };
          return refundPayrollPackage(holding.id, input);
        };
        const loadInputs = (loader = loadAuthoritativePayrollCloseInputs) =>
          prisma.$transaction((tx: PayrollCloseTransaction) => loader(tx, openPayrollClose(month)));
        const firstBuy = await buy();
        const first = await prisma.customerPackageHolding.findFirstOrThrow({
          where: { saleLine: { saleId: firstBuy.id } },
        });
        const firstKey = randomUUID();
        const event = await cancel(first, "cash-refund-month-001", firstKey);
        const inputs = await loadInputs();
        const evidence = inputs.evidence as CloseEvidence;
        assert.equal(evidence.authoritative.prepaidSettlements.length, 1);
        assert.equal(evidence.authoritative.prepaidHistories.length, 1);
        assert.equal(evidence.resolved.cash.status, "CASH_EVIDENCE_READY");
        assert.equal(evidence.resolved.cash.cash!.salonCash, "0.0000");
        assert.deepEqual(
          evidence.resolved.cash.cash!.staff.map((row) => [row.staffId, row.collection]),
          [[ownerId, "0.0000"]],
        );
        assert.deepEqual(
          evidence.resolved.cash.cash!.refunds!.refunds.map((row) => row.netCents),
          ["50000"],
        );
        assert.equal(
          evidence.authoritative.prepaidSettlements[0].id,
          (
            await prisma.prepaidRefundSettlement.findFirstOrThrow({
              where: { holdingId: first.id },
            })
          ).id,
        );
        assert.equal(event.sourceKey, `package-refund:${firstKey}`);
        assert.equal(payrollInputHash(await loadInputs()), payrollInputHash(inputs));
        // A cancellation inside the open month must invalidate the older calculation.
        await calculateStoredPayrollClose(month, 0);
        const secondBuy = await buy();
        const second = await prisma.customerPackageHolding.findFirstOrThrow({
          where: { saleLine: { saleId: secondBuy.id } },
        });
        await cancel(second, "cash-refund-month-002");
        // A third, unreimbursed holding proves a legacy capture cannot borrow another's payout.
        const thirdBuy = await buy();
        const third = await prisma.customerPackageHolding.findFirstOrThrow({
          where: { saleLine: { saleId: thirdBuy.id } },
        });
        // Approval only after the salon-local month ends; the older calculation is stale.
        mock.timers.enable({
          apis: ["Date"],
          now: new Date(Date.UTC(year, number, 1) + 86400000),
        });
        await assert.rejects(
          () => approveStoredPayrollClose(month, 1, "Stale refund evidence must refuse"),
          /inputs changed/,
        );
        const recalculated = await calculateStoredPayrollClose(month, 1);
        const settled = recalculated.calculation!.inputs.evidence as CloseEvidence;
        assert.deepEqual(
          settled.resolved.cash.cash!.refunds!.refunds.map((row) => row.netCents).sort(),
          ["50000", "50000"],
        );
        // Three same-month sales (+1500) less two payouts (-1000): netted exactly once.
        assert.equal(settled.resolved.cash.cash!.salonCash, "500.0000");
        assert.equal(
          (
            await approveStoredPayrollClose(
              month,
              2,
              "Approved after both cancellations were inventoried",
            )
          ).status,
          "APPROVED",
        );
        // A capture without its append-only settlement can never be silently dropped.
        await prisma.payrollSourceEvent.create({
          data: {
            tenantId,
            sourceKey: `package-refund:legacy-${randomUUID()}`,
            sourceType: "PACKAGE_REFUND",
            sourceId: third.id,
            saleId: thirdBuy.id,
            outletId: outlet.id,
            actorId: ownerId,
            reason: "Synthetic legacy capture without settlement",
            occurredAt: new Date(`${month}-10T04:00:00.000Z`),
            evidence: { version: 1 },
            createdAt: new Date(`${month}-10T04:00:00.000Z`),
          },
        });
        await assert.rejects(() => loadInputs(), /PREPAID_SETTLEMENT_MISSING/);
      });
    } finally {
      mock.timers.reset();
      await prisma.$disconnect();
    }
  },
);
