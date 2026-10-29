import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PAYROLL_DEFAULT_SETTINGS } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant, runAtOutlet } from "../lib/tenant-context.js";
import {
  authorizeStoredPayrollCarry,
  loadStoredPayrollCarry,
} from "./payroll-close-authorizations.js";
import { payrollInputHash } from "./payroll-close-state.js";
import { calculateStoredPayrollClose } from "./payroll-close-store.js";

test(
  "CP-005 isolated owner opening/settlement authorization, revisions, isolation and immutable evidence",
  {
    skip: process.env.RUN_CP005_ACCEPTANCE !== "true",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55485");
    assert.equal(url.pathname, "/payroll_close_test");
    const tenantId = `cp005-carry-${randomUUID()}`;
    const ownerId = `${tenantId}-owner`;
    const managerId = `${tenantId}-manager`;
    const staffId = `${tenantId}-departed`;
    const unverifiedId = `${tenantId}-unverified`;
    const otherTenant = `${tenantId}-foreign`;
    const scope = <T>(fn: () => T, actor = ownerId) => runAsTenant(tenantId, fn, actor);
    const date = new Date();
    const period = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 2, 1))
      .toISOString()
      .slice(0, 7);
    const request = {
      staff: [ownerId, managerId, staffId, unverifiedId].map((id) => ({
        staffId: id,
        carryForward: [],
        fallbackCarryCommission: id === staffId ? "-12.1234567890" : "0.0000000000",
      })),
      evidence: { cutoverInventoryReference: "synthetic-complete-owner-attestation" },
    };
    const save = (revision = 0) =>
      authorizeStoredPayrollCarry(
        "OPENING",
        period,
        revision,
        request,
        "Reviewed complete opening inventory",
      );
    try {
      await runAsPlatform(async () => {
        for (const id of [tenantId, otherTenant])
          await prisma.tenant.create({
            data: { id, slug: id, name: "Synthetic carry acceptance", status: "ACTIVE" },
          });
      });
      await scope(async () => {
        for (const [id, role] of [
          [ownerId, "SUPER_ADMIN"],
          [managerId, "MANAGER"],
          [staffId, "STAFF"],
          [unverifiedId, "SUPER_ADMIN"],
        ] as const)
          await prisma.user.create({
            data: {
              id,
              tenantId,
              name: id,
              email: `${id}@example.test`,
              passwordHash: "synthetic-unused",
              globalRole: role,
              disabled: id === staffId,
              twoFactorEnabled: id !== unverifiedId,
            },
          });
        for (const id of [managerId, staffId, unverifiedId])
          await assert.rejects(
            scope(() => save(), id),
            /verified owner/,
          );
        await assert.rejects(
          runAtOutlet("outlet", () => save()),
          /salon-wide/,
        );
        await assert.rejects(
          runAsTenant(otherTenant, () => save(), ownerId),
          /verified owner/,
        );
        await assert.rejects(
          authorizeStoredPayrollCarry("OPENING", "2026-01", 0, request, "Cannot backdate approval"),
          /effective boundary/,
        );
        await assert.rejects(
          authorizeStoredPayrollCarry(
            "OPENING",
            period,
            0,
            { ...request, staff: request.staff.slice(1) },
            "Missing staff denied",
          ),
          /every salon staff/,
        );
        assert.equal(await prisma.payrollCarryAuthorization.count(), 0);
        const race = await Promise.allSettled([save(), save()]);
        assert.equal(race.filter((row) => row.status === "fulfilled").length, 1);
        assert.equal(race.filter((row) => row.status === "rejected").length, 1);
        const stored = await prisma.payrollCarryAuthorization.findFirstOrThrow();
        const opening = stored.payload as { approval: { actorId: string; at: string } };
        assert.equal(opening.approval.actorId, ownerId);
        assert.equal(opening.approval.at, stored.createdAt.toISOString());
        assert.equal(stored.payloadHash, payrollInputHash(stored.payload));
        await assert.rejects(
          prisma.payrollCarryAuthorization.update({
            where: { id: stored.id },
            data: { reason: "Tampered reason" },
          }),
          /immutable/,
        );
        await assert.rejects(
          prisma.payrollCarryAuthorization.delete({ where: { id: stored.id } }),
          /immutable/,
        );
        const loaded = await prisma.$transaction((tx) =>
          loadStoredPayrollCarry(tx, tenantId, period),
        );
        assert.deepEqual(loaded.resolved.requiredStaffIds, [staffId]);
        const balance = loaded.resolved.staff.find((row) => row.staffId === staffId)!;
        const settlement = {
          staffId,
          balanceHash: payrollInputHash(balance),
          components: [],
          fallbackWriteOff: { amount: balance.fallbackCarryCommission },
          evidence: { reference: "synthetic-write-off" },
        };
        await assert.rejects(
          authorizeStoredPayrollCarry(
            "SETTLEMENT",
            period,
            0,
            { ...settlement, balanceHash: "0".repeat(64) },
            "Reject stale balance",
          ),
          /balance changed/,
        );
        await assert.rejects(
          scope(
            () =>
              authorizeStoredPayrollCarry(
                "SETTLEMENT",
                period,
                0,
                settlement,
                "Manager denied writeoff",
              ),
            managerId,
          ),
          /verified owner/,
        );
        const settlements = await Promise.allSettled([
          authorizeStoredPayrollCarry(
            "SETTLEMENT",
            period,
            0,
            settlement,
            "Exact owner debt writeoff",
          ),
          authorizeStoredPayrollCarry(
            "SETTLEMENT",
            period,
            0,
            settlement,
            "Duplicate owner debt writeoff",
          ),
        ]);
        assert.equal(settlements.filter((row) => row.status === "fulfilled").length, 1);
        assert.equal(settlements.filter((row) => row.status === "rejected").length, 1);
        const settled = await prisma.$transaction((tx) =>
          loadStoredPayrollCarry(tx, tenantId, period),
        );
        assert.equal(settled.settlements[0].fallbackWriteOff!.amount, "-12.1234567890");
        // A later opening revision cannot silently retarget a prior settlement.
        request.staff.find((row) => row.staffId === staffId)!.fallbackCarryCommission =
          "-13.1234567890";
        await save(1);
        await assert.rejects(
          prisma.$transaction((tx) => loadStoredPayrollCarry(tx, tenantId, period)),
          /balance changed/,
        );
        await assert.rejects(calculateStoredPayrollClose(period, 0), /balance changed/);
        assert.equal(await prisma.payrollClose.count(), 0);
        const changedBalance = request.staff.find((row) => row.staffId === staffId)!;
        await authorizeStoredPayrollCarry(
          "SETTLEMENT",
          period,
          1,
          {
            ...settlement,
            balanceHash: payrollInputHash(changedBalance),
            fallbackWriteOff: { amount: changedBalance.fallbackCarryCommission },
          },
          "Reauthorize exact changed opening debt",
        );
        const repaired = await prisma.$transaction((tx) =>
          loadStoredPayrollCarry(tx, tenantId, period),
        );
        assert.equal(repaired.settlements[0].revision, 2);
        assert.equal(repaired.settlements[0].fallbackWriteOff!.amount, "-13.1234567890");
        for (const [kind, targetId, payload] of [
          ["SETTINGS", "company", PAYROLL_DEFAULT_SETTINGS],
          ...request.staff.flatMap((row) => [
            [
              "STAFF",
              row.staffId,
              { joinDate: "2020-01-01", stageEndOverride: null, commissionRole: "NON_COMMISSION" },
            ],
            [
              "PROFILE",
              row.staffId,
              { basicSalary: "0", fixedOvertime: "0", levy: "0", salesAlertPct: "50" },
            ],
          ]),
        ] as [string, string, object][])
          await prisma.payrollConfigurationEvent.create({
            data: {
              tenantId,
              kind,
              targetId,
              payload,
              revision: 1,
              actorId: ownerId,
              reason: "Synthetic first close configuration",
            },
          });
        const firstClose = await calculateStoredPayrollClose(period, 0);
        assert.equal(firstClose.status, "CALCULATED");
        const departed = firstClose.calculation!.statements.find(
          (row) => row.staff.id === staffId,
        )!;
        assert.equal(departed.staff.disabled, true);
        assert.equal(departed.result.fallbackCarryCommission, "0.0000000000");
        assert.equal(departed.payroll.takeHome, "0.00");
        await assert.rejects(
          authorizeStoredPayrollCarry(
            "OPENING",
            `${Number(period.slice(0, 4)) + 1}-01`,
            0,
            request,
            "Second opening denied",
          ),
          /first payroll close/,
        );
        await assert.rejects(
          prisma.$transaction((tx) => loadStoredPayrollCarry(tx, tenantId, "2026-01")),
          /precedes/,
        );
        assert.equal(
          await runAsTenant(otherTenant, () => prisma.payrollCarryAuthorization.count(), ownerId),
          0,
        );
      });
    } finally {
      await prisma.$disconnect();
    }
  },
);
