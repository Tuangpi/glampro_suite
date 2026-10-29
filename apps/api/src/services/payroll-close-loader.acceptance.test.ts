import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PAYROLL_DEFAULT_SETTINGS } from "@glampro_suite/shared";
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
        const draft = await calculateStoredPayrollClose("2026-09", 0);
        const statement = draft.calculation!.statements.find((row) => row.staff.id === staffId)!;
        assert.equal(statement.inputs.collection, "100.0000");
        assert.equal(statement.payroll.takeHome, "2000.00");
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
          approveStoredPayrollClose("2026-09", 1, "Stale approval refused"),
          /inputs changed/,
        );
        assert.equal(await prisma.payrollCloseEvent.count({ where: { periodKey: "2026-09" } }), 1);
        const updated = await calculateStoredPayrollClose("2026-09", 1);
        assert.equal(
          updated.calculation!.statements.find((row) => row.staff.id === staffId)!.payroll.takeHome,
          "2100.00",
        );
        assert.equal(
          updated.calculation!.inputs.staff.find((row) => row.staff.id === staffId)!.calculation
            .lines[0].fallbackRatePct,
          "0",
        );
        const approved = await approveStoredPayrollClose(
          "2026-09",
          2,
          "Authoritative ordinary review",
        );
        assert.equal(approved.status, "APPROVED");
        assert.equal(payrollInputHash(approved.calculation), payrollInputHash(updated.calculation));
        await assert.rejects(calculateStoredPayrollClose("2026-09", 3), /immutable/);
      });
    } finally {
      // Retain synthetic immutable evidence only inside the authorized disposable DB.
      await prisma.$disconnect();
    }
  },
);
