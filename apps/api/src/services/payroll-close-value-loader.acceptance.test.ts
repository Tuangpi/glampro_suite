import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import { createSale, voidSale } from "./sale.service.js";
import { loadPayrollValueSpendHistory } from "./payroll-close-value-loader.js";
import { payrollInputHash, openPayrollClose } from "./payroll-close-state.js";
import { loadAuthoritativePayrollCloseInputs } from "./payroll-close-loader.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";
import { commissionScopeKey } from "./commission-rules.js";
import { Prisma } from "../../generated/prisma/client.js";

const hash = (value: unknown) =>
  payrollInputHash(
    JSON.parse(
      JSON.stringify(value, (_key, part: unknown) =>
        typeof part === "bigint" ? part.toString() : part,
      ),
    ),
  );

test(
  "CP-005 isolated value holding purchase/spend reconciliation and corruption refusal",
  { skip: process.env.RUN_CP005_ACCEPTANCE !== "true" },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55485");
    assert.equal(url.pathname, "/payroll_close_test");
    const tenantId = `cp005-spend-${randomUUID()}`;
    const ownerId = `${tenantId}-owner`;
    const staffId = `${tenantId}-staff`;
    const otherId = `${tenantId}-foreign`;
    const scope = <T>(fn: () => T, actor = ownerId) => runAsTenant(tenantId, fn, actor);
    try {
      await runAsPlatform(async () => {
        for (const id of [tenantId, otherId])
          await prisma.tenant.create({
            data: {
              id,
              slug: id,
              name: "Synthetic value history",
              status: "ACTIVE",
              gstEnabled: true,
            },
          });
      });
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
          data: { tenantId, name: "Synthetic outlet", slug: "value" },
        });
        const customer = await prisma.customer.create({ data: { tenantId, name: "Credit buyer" } });
        const item = await prisma.valuePackage.create({
          data: { tenantId, name: "545 for 600", price: "545", credit: "600" },
        });
        const service = await prisma.service.create({
          data: { tenantId, name: "Credit service", memberPrice: "100", nonmemberPrice: "100" },
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
        const buy = await runAtOutlet(outlet.id, () =>
          createSale({
            customerId: customer.id,
            lines: [
              {
                itemType: "VALUE_PACKAGE",
                itemId: item.id,
                quantity: 1,
                attribution: { sellers: [{ staffId: ownerId, share: 10000 }] },
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
          where: { saleLine: { saleId: buy.id } },
        });
        const load = () =>
          prisma.$transaction((tx) => loadPayrollValueSpendHistory(tx, holding.id));
        assert.equal((await load()).verified.length, 0);
        const spend = () =>
          runAtOutlet(outlet.id, () =>
            createSale({
              customerId: customer.id,
              lines: [
                {
                  itemType: "SERVICE",
                  itemId: service.id,
                  quantity: 1,
                  attribution: { performers: [{ staffId: staffId, share: 10000 }] },
                },
              ],
              payments: [{ method: "PREPAID_CREDIT", holdingId: holding.id, amount: 100 }],
              collection: { currency: "SGD", allocations: [] },
            }),
          );
        const usage = await spend();
        const first = await load();
        assert.equal(first.verified[0].baseAmount, "83.3333");
        assert.equal(first.evidence.holding.amountRemaining.toFixed(2), "500.00");
        assert.equal(hash(await load()), hash(first));
        await assert.rejects(scope(load, staffId), /not permitted/);
        await assert.rejects(runAtOutlet(outlet.id, load), /salon-wide/);
        await assert.rejects(runAsTenant(otherId, load, ownerId), /not permitted/);
        // Read-only result corruption: never rewrite immutable operational evidence.
        for (const model of [
          "prepaidBalanceEvent",
          "payrollSourceEvent",
          "commissionCollection",
          "salePayment",
          "customerRedemption",
        ] as const) {
          await assert.rejects(
            prisma.$transaction((tx) =>
              loadPayrollValueSpendHistory(
                new Proxy(tx, {
                  get(target, property) {
                    if (property !== model) return Reflect.get(target, property);
                    return new Proxy(target[model], {
                      get(delegate, method) {
                        if (method !== "findMany") return Reflect.get(delegate, method);
                        return async () => [];
                      },
                    });
                  },
                }) as PayrollCloseTransaction,
                holding.id,
              ),
            ),
          );
          assert.equal(hash(await load()), hash(first));
        }
        await spend();
        await spend();
        const three = await load();
        assert.deepEqual(
          three.verified.map((row) => row.baseAmount),
          ["83.3333", "83.3334", "83.3333"],
        );
        assert.equal(three.evidence.holding.amountRemaining.toFixed(2), "300.00");
        for (const corruption of [
          "BALANCE",
          "OPENING",
          "FOREIGN",
          "SHARING",
          "TRANSFER",
          "REFUND",
          "TENDER",
          "ORPHAN",
          "RATE",
        ] as const) {
          await assert.rejects(
            prisma.$transaction((tx) =>
              loadPayrollValueSpendHistory(
                new Proxy(tx, {
                  get(target, property) {
                    if (property === "prepaidBalanceEvent")
                      return new Proxy(target.prepaidBalanceEvent, {
                        get(delegate, method) {
                          if (method !== "findMany") return Reflect.get(delegate, method);
                          return async (args: Parameters<typeof delegate.findMany>[0]) => {
                            const rows = await delegate.findMany(args);
                            return rows.map((row) => ({
                              ...row,
                              ...(corruption === "BALANCE"
                                ? { amountAfter: new Prisma.Decimal("999") }
                                : {}),
                              ...(corruption === "OPENING" && row.kind === "GRANT"
                                ? { kind: "OPENING" }
                                : {}),
                              ...(corruption === "FOREIGN" ? { tenantId: otherId } : {}),
                              ...(corruption === "SHARING" ? { sharedFamilyId: "unverified" } : {}),
                            }));
                          };
                        },
                      });
                    if (property === "prepaidTransferEvent" && corruption === "TRANSFER")
                      return { findMany: async () => [{ id: "unverified" }] };
                    if (property === "saleRefund" && corruption === "REFUND")
                      return { findMany: async () => [{ id: "unverified" }] };
                    if (property === "commissionRule" && corruption === "RATE")
                      return { findMany: async () => [] };
                    if (property === "salePayment" && corruption === "TENDER")
                      return new Proxy(target.salePayment, {
                        get(delegate, method) {
                          if (method !== "findMany") return Reflect.get(delegate, method);
                          return async (args: Parameters<typeof delegate.findMany>[0]) =>
                            (await delegate.findMany(args)).map((row) =>
                              row.method === "PREPAID_CREDIT"
                                ? { ...row, amount: new Prisma.Decimal("99") }
                                : row,
                            );
                        },
                      });
                    if (property === "payrollSourceEvent" && corruption === "ORPHAN")
                      return new Proxy(target.payrollSourceEvent, {
                        get(delegate, method) {
                          if (method !== "findMany") return Reflect.get(delegate, method);
                          return async (args: Parameters<typeof delegate.findMany>[0]) => {
                            const rows = await delegate.findMany(args);
                            const source = rows.find((row) => row.sourceType === "VALUE_SPEND")!;
                            return [
                              ...rows,
                              {
                                ...source,
                                id: "orphan",
                                sourceId: "uninventoried",
                                sourceKey: "value-spend:uninventoried",
                              },
                            ];
                          };
                        },
                      });
                    return Reflect.get(target, property);
                  },
                }) as PayrollCloseTransaction,
                holding.id,
              ),
            ),
          );
          assert.equal(hash(await load()), hash(three));
        }
        await prisma.valuePackage.update({
          where: { id: item.id },
          data: { price: "1", credit: "999" },
        });
        assert.deepEqual((await load()).verified, three.verified);
        // Holding-level readiness must not accidentally enable monthly prepaid allocation.
        const parts = new Intl.DateTimeFormat("en", {
          timeZone: "Asia/Singapore",
          year: "numeric",
          month: "2-digit",
        }).formatToParts(new Date());
        const month = ["year", "month"]
          .map((key) => parts.find((part) => part.type === key)!.value)
          .join("-");
        await assert.rejects(
          prisma.$transaction((tx) =>
            loadAuthoritativePayrollCloseInputs(tx, openPayrollClose(month)),
          ),
          /REDEMPTION_WORKFLOW_NOT_LOADED/,
        );
        assert.equal(await prisma.payrollClose.count(), 0);
        assert.equal(await prisma.payrollCloseEvent.count(), 0);
        await voidSale(usage.id, { reason: "Synthetic unsupported restoration" }, ownerId);
        await assert.rejects(load(), /VALUE_SPEND_HISTORY_UNCONFIRMED/);
      });
    } finally {
      await prisma.$disconnect();
    }
  },
);
