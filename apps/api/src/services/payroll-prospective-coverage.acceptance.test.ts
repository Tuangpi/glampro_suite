import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import { PAYROLL_DEFAULT_SETTINGS } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import {
  authorizeStoredPayrollCarry,
  loadStoredPayrollCarry,
} from "./payroll-close-authorizations.js";
import { loadAuthoritativePayrollCloseInputs } from "./payroll-close-loader.js";
import { loadPayrollValueSaleAllocation } from "./payroll-close-value-sale.js";
import { openPayrollClose, payrollInputHash } from "./payroll-close-state.js";
import {
  approveStoredPayrollClose,
  calculateStoredPayrollClose,
  type PayrollCloseTransaction,
} from "./payroll-close-store.js";
import { createSale, voidSale } from "./sale.service.js";

/** Model the pre-contract read inventory without modifying immutable source rows.
 * Real checkout creates all independent purchases, tenders, spends and journals.
 * Removing only the prospective contract reproduces the legacy allocation gap;
 * no helper is allowed to reconstruct it from those surviving operational rows. */
function withoutLegacyFunding(tx: PayrollCloseTransaction, legacySaleId: string) {
  return new Proxy(tx, {
    get(target, key) {
      if (key !== "sale") return Reflect.get(target, key);
      return new Proxy(target.sale, {
        get(delegate, method) {
          if (method !== "findFirst") return Reflect.get(delegate, method);
          return async (args: Parameters<typeof delegate.findFirst>[0]) => {
            const row = await delegate.findFirst(args);
            if (!row || row.id !== legacySaleId || !("lines" in row)) return row;
            return {
              ...row,
              lines: (row.lines as { payrollEconomics: unknown }[]).map((line) => {
                const economics = { ...(line.payrollEconomics as Record<string, unknown>) };
                delete economics.fullCreditFunding;
                return { ...line, payrollEconomics: economics };
              }),
            };
          };
        },
      });
    },
  });
}

test(
  "CP-005-M1-15 prospective opening never repairs legacy funding or excludes later legacy activity",
  {
    skip: process.env.RUN_CP005_ACCEPTANCE !== "true",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55485");
    assert.equal(url.pathname, "/payroll_close_test");
    const [identity] = await prisma.$queryRaw<{ directory: string; timezone: string }[]>`
    SELECT current_setting('data_directory') AS directory, current_setting('TimeZone') AS timezone`;
    assert.match(identity.directory, /^\/tmp\/cp005-/);
    assert.equal(identity.timezone, "UTC");
    const tenantId = `cp005-prospective-${randomUUID()}`;
    const ownerId = randomUUID();
    await runAsPlatform(() =>
      prisma.tenant.create({
        data: {
          id: tenantId,
          slug: tenantId,
          name: "Prospective coverage",
          status: "ACTIVE",
          gstEnabled: true,
        },
      }),
    );
    try {
      await runAsTenant(
        tenantId,
        async () => {
          await prisma.user.create({
            data: {
              id: ownerId,
              tenantId,
              name: "Owner",
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
            data: { tenantId, name: "Outlet", slug: "coverage" },
          });
          const customer = await prisma.customer.create({ data: { tenantId, name: "Buyer" } });
          const service = await prisma.service.create({
            data: {
              tenantId,
              name: "Credit service",
              memberPrice: "109",
              nonmemberPrice: "109",
            },
          });
          const item = await prisma.valuePackage.create({
            data: {
              tenantId,
              name: "545 for 600",
              price: "545",
              credit: "600",
            },
          });
          const parts = new Intl.DateTimeFormat("en", {
            timeZone: "Asia/Singapore",
            year: "numeric",
            month: "2-digit",
          }).formatToParts(new Date());
          const legacyPeriod = ["year", "month"]
            .map((key) => parts.find((part) => part.type === key)!.value)
            .join("-");
          const [year, month] = legacyPeriod.split("-").map(Number);
          const period = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
          const shares = [{ staffId: ownerId, share: 10000 }];
          const purchase = await runAtOutlet(outlet.id, () =>
            createSale({
              customerId: customer.id,
              lines: [
                {
                  itemType: "VALUE_PACKAGE",
                  itemId: item.id,
                  quantity: 1,
                  attribution: { sellers: shares },
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
          const spend = (holdingId = holding.id) =>
            runAtOutlet(outlet.id, () =>
              createSale({
                customerId: customer.id,
                lines: [
                  {
                    itemType: "SERVICE",
                    itemId: service.id,
                    quantity: 1,
                    attribution: { sellers: shares, performers: shares },
                  },
                ],
                payments: [{ method: "PREPAID_CREDIT", holdingId, amount: 109 }],
                collection: { currency: "SGD", allocations: [] },
              }),
            );
          const legacy = await spend();
          // A separate independently purchased holding keeps future POS activity
          // separate from the legacy holding's database-timestamped restore journal.
          const futurePurchase = await runAtOutlet(outlet.id, () =>
            createSale({
              customerId: customer.id,
              lines: [
                {
                  itemType: "VALUE_PACKAGE",
                  itemId: item.id,
                  quantity: 1,
                  attribution: { sellers: shares },
                },
              ],
              payments: [{ method: "CASH", amount: 545 }],
              collection: {
                currency: "SGD",
                allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "54500" }],
              },
            }),
          );
          const futureHolding = await prisma.customerValuePackageHolding.findFirstOrThrow({
            where: { saleLine: { saleId: futurePurchase.id } },
          });
          const original = await prisma.saleLine.findMany({ where: { saleId: legacy.id } });
          const originalHash = payrollInputHash(JSON.parse(JSON.stringify(original)));
          const request = {
            staff: [
              { staffId: ownerId, carryForward: [], fallbackCarryCommission: "0.0000000000" },
            ],
            evidence: { inventoryReference: "Independent reviewed complete debt inventory" },
            coverage: {
              policy: "PROSPECTIVE_ONLY" as const,
              legacyHistory: "UNAVAILABLE" as const,
              inventoryReference: "Reviewed prospective cutover inventory",
            },
          };
          await assert.rejects(
            prisma.$transaction((tx) =>
              loadPayrollValueSaleAllocation(withoutLegacyFunding(tx, legacy.id), legacy.id),
            ),
            /VALUE_SALE_ALLOCATION_UNCONFIRMED/,
          );
          const opening = await authorizeStoredPayrollCarry(
            "OPENING",
            period,
            0,
            request,
            "Approve prospective-only boundary; legacy unavailable",
          );
          assert.equal(opening.coverage!.legacyHistory, "UNAVAILABLE");
          await assert.rejects(
            prisma.$transaction((tx) => loadStoredPayrollCarry(tx, tenantId, legacyPeriod)),
            /precedes.*opening/,
          );
          assert.equal(await prisma.payrollClose.count(), 0);
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
                payload,
                revision: 1,
                actorId: ownerId,
                reason: "Synthetic historical configuration",
                createdAt: new Date("2026-01-01"),
              },
            });
          mock.timers.enable({
            apis: ["Date"],
            now: new Date(new Date(opening.effectiveAt).getTime() + 86400000),
          });
          const prospective = await spend(futureHolding.id);
          const load = (
            tx: PayrollCloseTransaction,
            state: Parameters<typeof loadAuthoritativePayrollCloseInputs>[1],
          ) => loadAuthoritativePayrollCloseInputs(withoutLegacyFunding(tx, legacy.id), state);
          const inputs = await prisma.$transaction((tx) => load(tx, openPayrollClose(period)));
          assert.equal(inputs.staff[0].collection, "0.0000");
          assert.equal(
            (inputs.evidence as { authoritative: { prospectiveCoverage: { id: string } } })
              .authoritative.prospectiveCoverage.id,
            opening.id,
          );
          // An unavailable covered-month contract still refuses: the opening is not a waiver.
          await assert.rejects(
            prisma.$transaction((tx) =>
              loadAuthoritativePayrollCloseInputs(
                withoutLegacyFunding(tx, prospective.id),
                openPayrollClose(period),
              ),
            ),
            /VALUE_SALE_ALLOCATION_UNCONFIRMED/,
          );
          await calculateStoredPayrollClose(period, 0, load);
          mock.timers.reset();
          await authorizeStoredPayrollCarry(
            "OPENING",
            period,
            1,
            {
              ...request,
              coverage: {
                ...request.coverage,
                inventoryReference: "Revised independently reviewed cutover inventory",
              },
            },
            "Revise coverage evidence before effective boundary",
          );
          mock.timers.enable({ apis: ["Date"], now: new Date(inputs.endsAt) });
          await assert.rejects(
            approveStoredPayrollClose(period, 1, "Stale boundary revision", load),
          );
          await calculateStoredPayrollClose(period, 1, load);
          const approved = await approveStoredPayrollClose(
            period,
            2,
            "Approve evidenced prospective month only",
            load,
          );
          assert.equal(approved.status, "APPROVED");
          const frozenHash = payrollInputHash(approved);
          await assert.rejects(
            authorizeStoredPayrollCarry(
              "OPENING",
              period,
              2,
              request,
              "Cannot revise approved opening",
            ),
            /immutable/,
          );
          // Later activity against legacy usage must be inventoried, never hidden by cutover.
          mock.timers.tick(86400000);
          await voidSale(
            legacy.id,
            { reason: "Later restoration of legacy usage", cashDisposition: "NO_MOVEMENT" },
            ownerId,
          );
          const next = new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 7);
          await assert.rejects(
            calculateStoredPayrollClose(next, 0, load),
            /VALUE_SALE_ALLOCATION_UNCONFIRMED/,
          );
          assert.equal(await prisma.payrollClose.count({ where: { periodKey: next } }), 0);
          const stored = await prisma.payrollClose.findFirstOrThrow({
            where: { periodKey: period },
          });
          assert.equal(payrollInputHash(stored.state), frozenHash);
          assert.equal(
            payrollInputHash(
              JSON.parse(
                JSON.stringify(await prisma.saleLine.findMany({ where: { saleId: legacy.id } })),
              ),
            ),
            originalHash,
          );
          // The legacy sale remains unavailable even after prospective approval.
          await assert.rejects(
            prisma.$transaction((tx) =>
              loadPayrollValueSaleAllocation(withoutLegacyFunding(tx, legacy.id), legacy.id),
            ),
            /VALUE_SALE_ALLOCATION_UNCONFIRMED/,
          );
        },
        ownerId,
      );
    } finally {
      mock.timers.reset();
    }
  },
);
