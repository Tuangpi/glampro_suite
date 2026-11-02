import {
  orderedCorrectionWriters,
  assertLifecycleRollback,
  assertLifecycleCorruptionRefused,
} from "./payroll-lifecycle.test-helper.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { PAYROLL_DEFAULT_SETTINGS, type RefundPayrollPackage } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { createSale } from "./sale.service.js";
import { refundPayrollPackage } from "./payroll-package-refund.js";
import { refundPayrollValuePackage } from "./payroll-value-package-refund.js";
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

for (const kind of ["PACKAGE", "VALUE_PACKAGE"] as const)
  for (const mode of [
    "ordinary",
    "deferred",
    "source-approve",
    "approve-source",
    "source-calculate",
    "calculate-source",
  ] as const)
    test(
      `CP-005 ${kind} ${mode === "ordinary" ? "refund is inventoried once in its payroll month and invalidates stale calculations" : `M2 ${mode}`}`,
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
            const customer = await prisma.customer.create({
              data: { tenantId, name: "Refund buyer" },
            });
            const item =
              kind === "VALUE_PACKAGE"
                ? await prisma.valuePackage.create({
                    data: { tenantId, name: "545 for 600", price: "545", credit: "600" },
                  })
                : await prisma.package.create({
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
                {
                  joinDate: "2020-01-01",
                  stageEndOverride: null,
                  commissionRole: "NON_COMMISSION",
                },
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
                    { itemType: kind, itemId: item.id, quantity: 1, attribution: { sellers } },
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
              return kind === "VALUE_PACKAGE"
                ? refundPayrollValuePackage(holding.id, input)
                : refundPayrollPackage(holding.id, input);
            };
            const findHolding = (saleId: string) =>
              kind === "VALUE_PACKAGE"
                ? prisma.customerValuePackageHolding.findFirstOrThrow({
                    where: { saleLine: { saleId } },
                  })
                : prisma.customerPackageHolding.findFirstOrThrow({
                    where: { saleLine: { saleId } },
                  });
            const loadInputs = (loader = loadAuthoritativePayrollCloseInputs) =>
              prisma.$transaction((tx: PayrollCloseTransaction) =>
                loader(tx, openPayrollClose(month)),
              );
            const firstBuy = await buy();
            const first = await findHolding(firstBuy.id);
            if (mode !== "ordinary" && mode !== "deferred") {
              const draft = await calculateStoredPayrollClose(month, 0);
              mock.timers.enable({
                apis: ["Date"],
                now: new Date(draft.calculation!.inputs.endsAt),
              });
              const key = randomUUID();
              const source = () => cancel(first, "race-settlement", key);
              const close = () =>
                mode.includes("approve")
                  ? approveStoredPayrollClose(month, draft.revision, "Race refund approval")
                  : calculateStoredPayrollClose(month, draft.revision);
              const results = await orderedCorrectionWriters(
                mode.startsWith("source") ? source : close,
                mode.startsWith("source") ? close : source,
              );
              for (const [index, result] of results.entries())
                if (result.status === "rejected") {
                  assert.ok(mode === "source-approve" && index === 1);
                  assert.match(String(result.reason), /inputs changed/);
                }
              if (mode !== "approve-source") {
                const current = await prisma.payrollClose.findFirstOrThrow({
                  where: { periodKey: month },
                });
                const refreshed = await calculateStoredPayrollClose(month, current.revision);
                await approveStoredPayrollClose(
                  month,
                  refreshed.revision,
                  "Approve refreshed refund race evidence",
                );
              }
              const ended = await prisma.payrollClose.findFirstOrThrow({
                where: { periodKey: month },
              });
              if (mode === "approve-source") {
                assert.equal(ended.status, "APPROVED");
                assert.equal(
                  payrollInputHash((ended.state as unknown as typeof draft).calculation),
                  payrollInputHash(draft.calculation),
                );
              }
              const event = await source();
              assert.equal(
                await prisma.prepaidRefundSettlement.count({ where: { holdingId: first.id } }),
                1,
              );
              const next = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
              const upcoming = await prisma.$transaction((tx) =>
                loadAuthoritativePayrollCloseInputs(tx, openPayrollClose(next)),
              );
              assert.equal(upcoming.staff[0].collection, "-500.0000");
              assert.equal(
                upcoming.staff
                  .flatMap((row) => row.calculation.lines)
                  .filter((line) => line.id.startsWith(event.sourceKey)).length,
                1,
              );
              return;
            }
            if (mode === "deferred") {
              const prior = await calculateStoredPayrollClose(month, 0);
              mock.timers.enable({
                apis: ["Date"],
                now: new Date(prior.calculation!.inputs.endsAt),
              });
              await approveStoredPayrollClose(month, prior.revision, "Freeze purchase history");
              const frozen = payrollInputHash(
                (await prisma.payrollClose.findFirstOrThrow({ where: { periodKey: month } })).state,
              );
              mock.timers.reset();
              // A late correction may have operational occurrence inside an approved month.
              mock.timers.enable({
                apis: ["Date"],
                now: new Date(first.updatedAt.getTime() + 1000),
              });
              const key = randomUUID();
              await assertLifecycleRollback(
                () => cancel(first, "deferred-real-cash", key),
                tenantId,
              );
              const event = await cancel(first, "deferred-real-cash", key);
              await assertLifecycleCorruptionRefused(tenantId);
              assert.equal((await cancel(first, "deferred-real-cash", key)).id, event.id);
              await assert.rejects(
                cancel(first, "conflicting-reference", key),
                /different evidence/,
              );
              const settlement = await prisma.prepaidRefundSettlement.findFirstOrThrow({
                where: { holdingId: first.id },
              });
              assert.equal(settlement.occurredAt.getTime(), event.occurredAt.getTime());
              const operational = await loadInputs();
              assert.ok(
                operational.staff
                  .flatMap((row) => row.calculation.lines)
                  .every((line) => !line.id.startsWith(event.sourceKey)),
              );
              assert.equal(
                (operational.evidence as CloseEvidence).resolved.cash.cash!.salonCash,
                "0.0000",
              );
              const next = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
              const loadNext = () =>
                prisma.$transaction((tx: PayrollCloseTransaction) =>
                  loadAuthoritativePayrollCloseInputs(tx, openPayrollClose(next)),
                );
              const upcoming = await loadNext();
              const lines = upcoming.staff.flatMap((row) => row.calculation.lines);
              assert.equal(lines.length, 1);
              assert.equal(lines[0].baseAmount, "-500.0000");
              assert.equal(
                (upcoming.evidence as CloseEvidence).resolved.cash.cash!.salonCash,
                "0.0000",
              );
              assert.equal(upcoming.staff[0].collection, "0.0000");
              const audit = await prisma.auditLog.findFirstOrThrow({
                where: { tenantId, action: "payroll.lifecycle.posting" },
              });
              const metadata = audit.metadata as unknown as { posting: { postingAt: string } };
              const proxy = new Proxy(prisma, {
                get(target, property, receiver) {
                  if (property === "auditLog")
                    return new Proxy(target.auditLog, {
                      get(model, key, context) {
                        if (key === "findMany")
                          return async (args: Parameters<typeof model.findMany>[0]) =>
                            (await model.findMany(args)).map((row) =>
                              row.id === audit.id
                                ? {
                                    ...row,
                                    metadata: {
                                      ...metadata,
                                      posting: {
                                        ...metadata.posting,
                                        postingAt: event.occurredAt.toISOString(),
                                      },
                                    },
                                  }
                                : row,
                            );
                        return Reflect.get(model, key, context);
                      },
                    });
                  return Reflect.get(target, property, receiver);
                },
              });
              const { loadPayrollLifecyclePostings } =
                await import("./payroll-lifecycle-posting.js");
              await assert.rejects(
                loadPayrollLifecyclePostings(proxy as unknown as PayrollCloseTransaction, tenantId),
                /posting evidence/,
              );
              const draft = await calculateStoredPayrollClose(next, 0);
              mock.timers.reset();
              mock.timers.enable({
                apis: ["Date"],
                now: new Date(draft.calculation!.inputs.endsAt),
              });
              await approveStoredPayrollClose(
                next,
                draft.revision,
                "Approve deferred commission without duplicated cash",
              );
              assert.equal(
                payrollInputHash(
                  (await prisma.payrollClose.findFirstOrThrow({ where: { periodKey: month } }))
                    .state,
                ),
                frozen,
              );
              assert.equal(
                (
                  await prisma.prepaidRefundSettlement.findFirstOrThrow({
                    where: { holdingId: first.id },
                  })
                ).occurredAt.getTime(),
                event.occurredAt.getTime(),
              );
              return;
            }
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
            assert.equal(
              event.sourceKey,
              `${kind === "VALUE_PACKAGE" ? "value-package" : "package"}-refund:${firstKey}`,
            );
            assert.equal(payrollInputHash(await loadInputs()), payrollInputHash(inputs));
            // A cancellation inside the open month must invalidate the older calculation.
            await calculateStoredPayrollClose(month, 0);
            const secondBuy = await buy();
            const second = await findHolding(secondBuy.id);
            await cancel(second, "cash-refund-month-002");
            // A third, unreimbursed holding proves a legacy capture cannot borrow another's payout.
            const thirdBuy = await buy();
            const third = await findHolding(thirdBuy.id);
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
            const frozenHash = payrollInputHash(
              (await prisma.payrollClose.findFirstOrThrow()).state,
            );
            await prisma.payrollSourceEvent.create({
              data: {
                tenantId,
                sourceKey: `package-refund:legacy-${randomUUID()}`,
                sourceType: kind === "VALUE_PACKAGE" ? "VALUE_PACKAGE_REFUND" : "PACKAGE_REFUND",
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
            assert.equal(
              payrollInputHash((await prisma.payrollClose.findFirstOrThrow()).state),
              frozenHash,
            );
          });
        } finally {
          mock.timers.reset();
          await prisma.$disconnect();
        }
      },
    );
