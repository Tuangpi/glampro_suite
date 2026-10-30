import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { PAYROLL_DEFAULT_SETTINGS } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { createSale } from "./sale.service.js";
import { commissionScopeKey } from "./commission-rules.js";
import { authorizeStoredPayrollCarry } from "./payroll-close-authorizations.js";
import { loadAuthoritativePayrollCloseInputs } from "./payroll-close-loader.js";
import { openPayrollClose, payrollInputHash } from "./payroll-close-state.js";
import {
  approveStoredPayrollClose,
  calculateStoredPayrollClose,
  readStoredPayrollStatement,
  type PayrollCloseTransaction,
} from "./payroll-close-store.js";

test(
  "CP-005 private credit monthly inventory, external-only cash and frozen approval",
  {
    skip: process.env.RUN_CP005_ACCEPTANCE !== "true",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55485");
    assert.equal(url.pathname, "/payroll_close_test");
    const tenantId = `cp005-month-${randomUUID()}`;
    const ownerId = `${tenantId}-owner`;
    const staffId = `${tenantId}-staff`;
    const scope = <T>(fn: () => T) => runAsTenant(tenantId, fn, ownerId);
    try {
      await runAsPlatform(() =>
        prisma.tenant.create({
          data: {
            id: tenantId,
            slug: tenantId,
            name: "Synthetic monthly credit",
            status: "ACTIVE",
            gstEnabled: true,
          },
        }),
      );
      await scope(async () => {
        for (const [id, globalRole] of [
          [ownerId, "SUPER_ADMIN"],
          [staffId, "STAFF"],
        ] as const)
          await prisma.user.create({
            data: {
              id,
              tenantId,
              name: id,
              email: `${id}@example.invalid`,
              passwordHash: "synthetic-unused",
              globalRole,
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
          data: { tenantId, name: "Credit outlet", slug: "credit" },
        });
        const customer = await prisma.customer.create({ data: { tenantId, name: "Credit buyer" } });
        const item = await prisma.valuePackage.create({
          data: { tenantId, name: "545 for 600", price: "545", credit: "600" },
        });
        const service = await prisma.service.create({
          data: { tenantId, name: "Credit service", memberPrice: "100", nonmemberPrice: "100" },
        });
        const product = await prisma.product.create({
          data: { tenantId, name: "Retail", memberPrice: "50", nonmemberPrice: "50", quantity: 20 },
        });
        const foc = await prisma.service.create({
          data: { tenantId, name: "FOC", memberPrice: "100", nonmemberPrice: "492" },
        });
        await prisma.commissionRule.create({
          data: {
            tenantId,
            itemKind: "STORED_CREDIT_SPEND",
            scope: "PACKAGE",
            scopeKey: commissionScopeKey(null, "STORED_CREDIT_SPEND", "PACKAGE", item.id),
            targetId: item.id,
            rate: "7",
            effectiveAt: new Date("2026-01-01"),
            createdAt: new Date("2026-01-01"),
            actorId: ownerId,
            reason: "Synthetic historical spend rate",
          },
        });
        // Opening approval precedes the local month boundary. Operational writers
        // run on the real clock so DB ledger and application audit times agree.
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
            staff: [ownerId, staffId].map((staffId) => ({
              staffId,
              carryForward: [],
              fallbackCarryCommission: "0.0000000000",
            })),
            evidence: { inventoryReference: "synthetic-reviewed-complete-opening" },
          },
          "Reviewed synthetic opening inventory",
        );
        mock.timers.reset();
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
        const performers = [
          { staffId: ownerId, share: 2500 },
          { staffId, share: 7500 },
        ];
        const buy = await runAtOutlet(outlet.id, () =>
          createSale({
            customerId: customer.id,
            lines: [
              { itemType: "VALUE_PACKAGE", itemId: item.id, quantity: 1, attribution: { sellers } },
            ],
            payments: [{ method: "CASH", amount: 545 }],
            collection: {
              currency: "SGD",
              allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "54500" }],
            },
          }),
        );
        const holding = await prisma.customerValuePackageHolding.findFirstOrThrow({
          where: { saleLine: { saleId: buy.id } },
        });
        const spend = (secondHoldingId?: string) =>
          runAtOutlet(outlet.id, () =>
            createSale({
              customerId: customer.id,
              lines: [
                {
                  itemType: "SERVICE",
                  itemId: service.id,
                  quantity: 1,
                  attribution: { performers, sellers },
                },
                { itemType: "PRODUCT", itemId: product.id, quantity: 1, attribution: { sellers } },
                {
                  itemType: "SERVICE",
                  itemId: foc.id,
                  quantity: 1,
                  discountPercent: 100,
                  attribution: { performers },
                },
              ],
              payments: [
                {
                  method: "PREPAID_CREDIT",
                  holdingId: holding.id,
                  amount: secondHoldingId ? 25 : 50,
                },
                ...(secondHoldingId
                  ? [{ method: "PREPAID_CREDIT" as const, holdingId: secondHoldingId, amount: 25 }]
                  : []),
                { method: "CASH", amount: 100 },
              ],
              collection: {
                currency: "SGD",
                allocations: [
                  { paymentIndex: secondHoldingId ? 2 : 1, linePosition: 0, grossCents: "7000" },
                  { paymentIndex: secondHoldingId ? 2 : 1, linePosition: 1, grossCents: "3000" },
                ],
              },
            }),
          );
        const mixed = await spend();
        const load = (tx?: PayrollCloseTransaction) =>
          tx
            ? loadAuthoritativePayrollCloseInputs(tx, openPayrollClose(month))
            : prisma.$transaction((tx) =>
                loadAuthoritativePayrollCloseInputs(tx, openPayrollClose(month)),
              );
        const inputs = await load();
        const lines = inputs.staff.flatMap((row) => row.calculation.lines);
        assert.deepEqual(
          lines
            .filter((row) => row.commissionType === "VP_SPEND")
            .map((row) => row.baseAmount)
            .sort(),
          ["10.4167", "31.2500"],
        );
        assert.equal(inputs.staff.find((row) => row.staff.id === ownerId)!.collection, "591.7400");
        assert.equal(inputs.staff.find((row) => row.staff.id === staffId)!.collection, "0.0000");
        assert.equal(payrollInputHash(await load()), payrollInputHash(inputs));
        const authoritative = (inputs.evidence as { authoritative: { valueSales: unknown[] } })
          .authoritative;
        assert.equal(authoritative.valueSales.length, 1);
        const totals = (type: string) =>
          lines
            .filter((row) => row.commissionType === type)
            .reduce((sum, row) => sum + BigInt(row.baseAmount.replace(".", "")), 0n);
        assert.equal(totals("SVC"), 642200n);
        assert.equal(totals("PRD"), 275200n);
        assert.equal(totals("FOC"), 4920000n);
        const draft = await calculateStoredPayrollClose(month, 0);
        const initialHash = payrollInputHash(draft.calculation);
        for (const model of [
          "sale",
          "salePayment",
          "customerRedemption",
          "payrollSourceEvent",
          "commissionCollection",
        ] as const) {
          for (const corruption of ["MISSING", "DUPLICATE", "FOREIGN"] as const) {
            await assert.rejects(
              prisma.$transaction((tx) =>
                load(
                  new Proxy(tx, {
                    get(target, property) {
                      if (property !== model) return Reflect.get(target, property);
                      return new Proxy(target[model], {
                        get(delegate, method) {
                          if (method !== "findMany") return Reflect.get(delegate, method);
                          return async (args: {
                            where?: {
                              saleId?: string;
                              occurredAt?: unknown;
                              createdAt?: unknown;
                              OR?: unknown;
                            };
                          }) => {
                            const rows = await (
                              delegate.findMany as (
                                args: unknown,
                              ) => Promise<{ id: string; saleId?: string; sourceType?: string }[]>
                            )(args);
                            // Corrupt only the independent month query, not the complete sale/holding histories.
                            if (
                              args.where?.saleId ||
                              (!args.where?.OR && !args.where?.occurredAt && !args.where?.createdAt)
                            )
                              return rows;
                            const affected = rows.filter((row) =>
                              model === "sale" ? row.id === mixed.id : row.saleId === mixed.id,
                            );
                            assert.ok(
                              affected.length,
                              `${model} month inventory must contain the receipt`,
                            );
                            if (corruption === "DUPLICATE") return [...rows, affected[0]];
                            if (corruption === "FOREIGN")
                              return rows.map((row) =>
                                affected.includes(row)
                                  ? { ...row, tenantId: "foreign-salon" }
                                  : row,
                              );
                            return rows.filter((row) =>
                              model === "sale" ? row.id !== mixed.id : row.saleId !== mixed.id,
                            );
                          };
                        },
                      });
                    },
                  }) as PayrollCloseTransaction,
                ),
              ),
              /UNAVAILABLE|UNCONFIRMED/,
            );
            assert.equal(
              payrollInputHash((await prisma.payrollClose.findFirstOrThrow()).state),
              payrollInputHash(draft),
            );
            assert.equal(await prisma.payrollCloseEvent.count(), 1);
          }
        }
        const secondBuy = await runAtOutlet(outlet.id, () =>
          createSale({
            customerId: customer.id,
            lines: [
              { itemType: "VALUE_PACKAGE", itemId: item.id, quantity: 1, attribution: { sellers } },
            ],
            payments: [{ method: "CASH", amount: 545 }],
            collection: {
              currency: "SGD",
              allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "54500" }],
            },
          }),
        );
        const secondHolding = await prisma.customerValuePackageHolding.findFirstOrThrow({
          where: { saleLine: { saleId: secondBuy.id } },
        });
        await spend(secondHolding.id);
        // Use a post-month clock only for close approval; operational evidence stays real.
        mock.timers.enable({ apis: ["Date"], now: new Date(Date.UTC(year, number, 2)) });
        await assert.rejects(
          approveStoredPayrollClose(month, 1, "Stale evidence must refuse"),
          /inputs changed/,
        );
        const updated = await calculateStoredPayrollClose(month, 1);
        assert.notEqual(payrollInputHash(updated.calculation), initialHash);
        assert.equal(
          updated.calculation!.inputs.staff.find((row) => row.staff.id === ownerId)!.collection,
          "1183.4800",
        );
        assert.equal(
          updated
            .calculation!.inputs.staff.flatMap((row) => row.calculation.lines)
            .filter((row) => row.commissionType === "VP_SPEND").length,
          6,
        );
        const approved = await approveStoredPayrollClose(
          month,
          2,
          "Reviewed complete private credit month",
        );
        const frozen = payrollInputHash(approved.calculation);
        const frozenStatement = payrollInputHash(await readStoredPayrollStatement(month, staffId));
        mock.timers.reset();
        await prisma.valuePackage.update({
          where: { id: item.id },
          data: { price: "1", credit: "999" },
        });
        await prisma.service.update({ where: { id: foc.id }, data: { nonmemberPrice: "999" } });
        await spend();
        assert.equal(
          payrollInputHash(
            (await prisma.payrollClose.findFirstOrThrow()).state as unknown as typeof approved,
          ),
          payrollInputHash(approved),
        );
        assert.equal(payrollInputHash(approved.calculation), frozen);
        assert.equal((await readStoredPayrollStatement(month, staffId)).staff.id, staffId);
        assert.equal(
          payrollInputHash(await readStoredPayrollStatement(month, staffId)),
          frozenStatement,
        );
        assert.equal(await prisma.employeeCommission.count(), 0);
        assert.equal(await prisma.payrollCloseEvent.count(), 3);
        const nextMonth = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
        mock.timers.enable({ apis: ["Date"], now: new Date(Date.UTC(year, number, 2)) });
        const next = await calculateStoredPayrollClose(nextMonth, 0);
        assert.ok(
          next.calculation!.inputs.staff.every(
            (row) => row.collection === "0.0000" && row.calculation.lines.length === 0,
          ),
        );
        assert.equal(
          payrollInputHash(
            (await prisma.payrollClose.findFirstOrThrow({ where: { periodKey: month } })).state,
          ),
          payrollInputHash(approved),
        );
      });
    } finally {
      mock.timers.reset();
      await prisma.$disconnect();
    }
  },
);
