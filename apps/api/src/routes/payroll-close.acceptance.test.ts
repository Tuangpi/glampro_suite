import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform } from "../lib/tenant-context.js";
import { signAccessToken } from "../lib/tokens.js";
import { payrollCloseFixture } from "../test-support/payroll-close-fixture.js";
import { payrollInputHash } from "../services/payroll-close-state.js";

test(
  "M4 mounted close HTTP lifecycle, salary isolation, rollback, stale revisions and separate payout",
  { skip: process.env.RUN_CP005_ACCEPTANCE !== "true", timeout: 60000 },
  async (t) => {
    const f = await payrollCloseFixture(50, true);
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/payroll-close/2026-09`;
    const token = (
      id: string,
      role: "SUPER_ADMIN" | "MANAGER" | "STAFF" | "CASHIER",
      tenantId = f.tenantId,
    ) =>
      signAccessToken({
        id,
        email: `${id}@example.test`,
        globalRole: role,
        tenantId,
        realm: "web",
        tokenVersion: 0,
      }).token;
    const owner = token(f.ownerId, "SUPER_ADMIN");
    const manager = token(f.managerId, "MANAGER");
    const request = (path = "", body?: unknown, bearer = owner) =>
      fetch(root + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    try {
      assert.equal(
        (await request("", undefined, token(f.ownerId, "SUPER_ADMIN", "foreign"))).status,
        401,
      );
      for (const [id, role] of [
        [f.staffId, "STAFF"],
        [f.cashierId, "CASHIER"],
      ] as const)
        assert.equal((await request("", undefined, token(id, role))).status, 403);
      assert.equal(
        (await request("/statement", undefined, token(f.cashierId, "CASHIER"))).status,
        403,
      );
      assert.equal((await request("/calculate", { expectedRevision: 0, inputs: [] })).status, 422);
      assert.equal(
        (await request("/approve", { expectedRevision: 0, reason: "Reviewed" }, manager)).status,
        403,
      );
      assert.equal(
        (await request("/payout", { expectedRevision: 0, reference: "TEST", reason: "Recorded" }))
          .status,
        409,
      );
      const started = performance.now();
      const calculated = await request("/calculate", { expectedRevision: 0 }, manager);
      const elapsed = performance.now() - started;
      assert.equal(calculated.status, 200, await calculated.clone().text());
      const draft = (await calculated.json()).data;
      assert.equal(draft.revision, 1);
      assert.equal(draft.calculation.statements.length, 50);
      assert.equal(draft.calculation.inputs, undefined);
      assert.equal(draft.calculation.statements[0].inputs, undefined);
      assert.equal(draft.calculation.statements[0].payroll.basicSalary, undefined);
      assert.equal(draft.calculation.statements[0].payroll.takeHome, undefined);
      assert.ok(
        elapsed < 10000,
        `50-staff authoritative HTTP calculation exceeded 10 seconds: ${elapsed.toFixed(1)}ms`,
      );
      t.diagnostic(
        `50-staff/50 real cash receipts calculation via real HTTP/default DB loader: ${elapsed.toFixed(1)}ms; not MTD or production-scale evidence`,
      );
      assert.equal(
        draft.calculation.statements.find(
          (row: { staff: { id: string } }) => row.staff.id === f.staffId,
        ).payroll.collection,
        "100.0000",
      );
      const addition = {
        expectedRevision: 1,
        adjustment: {
          id: "m4-addition",
          staffId: f.staffId,
          kind: "ADDITION",
          amount: "12.30",
          reason: "Reviewed manual addition",
        },
      };
      const before = await f.scope(() => prisma.payrollCloseEvent.count());
      assert.equal(
        (await request("/adjustments", { ...addition, expectedRevision: 0 }, manager)).status,
        409,
      );
      assert.equal(await f.scope(() => prisma.payrollCloseEvent.count()), before);
      assert.equal((await request("/adjustments", addition, manager)).status, 200);
      assert.equal(
        (await request("/approve", { expectedRevision: 2, reason: "Reviewed" })).status,
        409,
      );
      assert.equal((await request("/calculate", { expectedRevision: 2 }, manager)).status, 200);
      const approved = await request("/approve", {
        expectedRevision: 3,
        reason: "Reviewed final payroll",
      });
      assert.equal(approved.status, 200, await approved.clone().text());
      const frozen = (await approved.json()).data;
      assert.equal(frozen.payout, null);
      const statement = frozen.calculation.statements.find(
        (row: { staff: { id: string } }) => row.staff.id === f.staffId,
      );
      assert.equal(statement.payroll.commission, "10.00");
      assert.equal(statement.payroll.takeHome, "2022.30");
      assert.equal(statement.inputs, undefined);
      const self = await request("/statement", undefined, token(f.staffId, "STAFF"));
      assert.equal(self.status, 200);
      const own = (await self.json()).data;
      assert.equal(own.staff.id, f.staffId);
      assert.equal(own.payroll.basicSalary, undefined);
      assert.equal(own.inputs, undefined);
      assert.equal(
        (await request(`/statements/${f.ownerId}`, undefined, token(f.staffId, "STAFF"))).status,
        403,
      );
      const managerRead = (await (await request("", undefined, manager)).json()).data;
      assert.equal(managerRead.calculation.statements[0].payroll.takeHome, undefined);
      assert.equal((await request("/calculate", { expectedRevision: 4 })).status, 409);
      await runAsPlatform(() =>
        prisma.tenant.update({ where: { id: f.tenantId }, data: { status: "SUSPENDED" } }),
      );
      assert.equal(
        (
          await request("/payout", {
            expectedRevision: 4,
            reference: "TEST-BANK",
            reason: "Actual manual payment",
          })
        ).status,
        403,
      );
      assert.equal((await request()).status, 200);
      await runAsPlatform(() =>
        prisma.tenant.update({ where: { id: f.tenantId }, data: { status: "ACTIVE" } }),
      );
      const payout = await request("/payout", {
        expectedRevision: 4,
        reference: "TEST-BANK",
        reason: "Actual manual payment",
      });
      assert.equal(payout.status, 200);
      const paid = (await payout.json()).data;
      assert.equal(payrollInputHash(paid.calculation), payrollInputHash(frozen.calculation));
      assert.equal(paid.payout.reference, "TEST-BANK");
      assert.equal(
        (
          await request("/payout", {
            expectedRevision: 5,
            reference: "OTHER",
            reason: "Duplicate request",
          })
        ).status,
        409,
      );
      await f.scope(async () => {
        assert.equal(await prisma.payrollCloseEvent.count(), 5);
        assert.equal(await prisma.employeeCommission.count(), 0);
        assert.equal(await prisma.salePayment.count(), 50);
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.$disconnect();
    }
  },
);
