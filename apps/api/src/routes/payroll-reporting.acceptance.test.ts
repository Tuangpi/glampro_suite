import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { mock } from "node:test";
import ExcelJS from "exceljs";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { runAsTenant } from "../lib/tenant-context.js";
import { signAccessToken } from "../lib/tokens.js";
import { payrollCloseFixture } from "../test-support/payroll-close-fixture.js";
import { payrollReportingFixture } from "../test-support/payroll-reporting-fixture.js";

test(
  "reporting continuation: real HTTP and PostgreSQL filters, exports, SELF scope and no posting",
  {
    skip: process.env.RUN_CP008_REPORTING_ACCEPTANCE !== "true",
    timeout: 60000,
  },
  async (t) => {
    const f = await payrollCloseFixture(4, true);
    const r = await payrollReportingFixture(f);
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const token = (id: string, globalRole: "SUPER_ADMIN" | "MANAGER" | "STAFF" | "CASHIER") =>
      signAccessToken({
        id,
        email: `${id}@example.test`,
        globalRole,
        tenantId: f.tenantId,
        realm: "web",
        tokenVersion: 0,
      }).token;
    const owner = token(f.ownerId, "SUPER_ADMIN"),
      manager = token(f.managerId, "MANAGER"),
      staff = token(f.staffId, "STAFF"),
      cashier = token(f.cashierId, "CASHIER");
    const request = (path: string, bearer = manager, body?: unknown, outlet?: string) =>
      fetch(root + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
          ...(outlet ? { "X-Outlet-Id": outlet } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const detail = "/payroll-close/commission-detail?period=2026-09";
    try {
      await t.test(
        "missing and calculated months are unavailable; draft export is refused",
        async () => {
          let response = await request(detail);
          assert.equal(response.status, 200);
          assert.equal((await response.json()).data.approved, false);
          response = await request("/payroll-close/2026-09/calculate", manager, {
            expectedRevision: 0,
          });
          assert.equal(response.status, 200, await response.clone().text());
          response = await request(detail);
          assert.equal(response.status, 200);
          assert.equal((await response.json()).data.approved, false);
          assert.equal(
            (await request("/payroll-close/commission-detail.xlsx?period=2026-09")).status,
            409,
          );
          response = await request("/payroll-close/2026-09/approve", owner, {
            expectedRevision: 1,
            reason: "Reviewed reporting acceptance",
          });
          assert.equal(response.status, 200, await response.clone().text());
        },
      );
      const recordedSessions = await r.seedSessions();
      await t.test(
        "large SELF session months cross database cursor batches without losing attribution",
        async () => {
          const source = await f.scope(() =>
            prisma.customerRedemption.findFirstOrThrow({ where: { id: recordedSessions[0]!.id } }),
          );
          const snapshot = await f.scope(() =>
            prisma.commissionRedemptionSnapshot.findFirstOrThrow({
              where: { redemptionId: source.id },
            }),
          );
          const ids = Array.from(
            { length: 501 },
            (_, index) => `cp008-large-${source.id}-${index.toString().padStart(4, "0")}`,
          );
          await f.scope(async () => {
            await prisma.customerRedemption.createMany({
              data: ids.map((id) => ({
                id,
                tenantId: f.tenantId,
                customerId: source.customerId,
                saleId: source.saleId,
                itemType: source.itemType,
                itemId: source.itemId,
                holdingId: source.holdingId,
                quantity: 1,
                usedAt: new Date("2026-08-25T00:00:00Z"),
                revertedAt: new Date("2026-08-26T00:00:00Z"),
              })),
            });
            await prisma.commissionRedemptionSnapshot.createMany({
              data: ids.map((id) => ({
                tenantId: f.tenantId,
                redemptionId: id,
                revision: 1,
                eventKey: id,
                eventHash: id,
                eventType: "CAPTURE",
                actorId: f.ownerId,
                reason: "Synthetic large-month read evidence",
                evidence: snapshot.evidence!,
              })),
            });
          });
          const response = await request(
            "/payroll-close/my-sessions?period=2026-08&page=21",
            staff,
          );
          assert.equal(response.status, 200, await response.clone().text());
          const data = (await response.json()).data;
          assert.equal(data.total, 501);
          assert.equal(data.pages, 21);
          assert.equal(data.rows.length, 1);
          assert.equal(data.rows[0].id, ids[500]);
          assert.equal(data.rows[0].status, "VOIDED");
          // Evidence is append-only. Keep these explicitly synthetic voided
          // prior-month rows until the disposable tenant fixture is cleaned up.
        },
      );
      await t.test(
        "approved cross-month detail is all-or-nothing and Excel retains month identity",
        async () => {
          const partial = await request(detail + "&throughPeriod=2026-10");
          const missing = (await partial.json()).data;
          assert.equal(missing.approved, false);
          assert.deepEqual(missing.unavailablePeriods, ["2026-10"]);
          assert.deepEqual(missing.rows, []);
          const calculated = await request("/payroll-close/2026-10/calculate", manager, {
            expectedRevision: 0,
          });
          assert.equal(calculated.status, 200, await calculated.clone().text());
          const approved = await request("/payroll-close/2026-10/approve", owner, {
            expectedRevision: 1,
            reason: "Reviewed empty carry month",
          });
          assert.equal(approved.status, 200, await approved.clone().text());
          const range = await request(detail + "&throughPeriod=2026-10&limit=1");
          const data = (await range.json()).data;
          assert.equal(data.approved, true);
          assert.ok(data.total > data.rows.length);
          const file = await request(
            "/payroll-close/commission-detail.xlsx?period=2026-09&throughPeriod=2026-10&limit=1&page=2",
          );
          assert.equal(file.status, 200);
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(await file.arrayBuffer());
          assert.equal(workbook.worksheets[0].rowCount, data.total + 2);
          assert.equal(workbook.worksheets[0].getRow(3).getCell(12).value, "2026-09");
        },
      );
      const inventory = () =>
        f.scope(async () => ({
          closes: await prisma.payrollClose.findMany({ orderBy: { id: "asc" } }),
          audits: await prisma.payrollCloseEvent.findMany({ orderBy: { id: "asc" } }),
          sources: await prisma.payrollSourceEvent.findMany({ orderBy: { id: "asc" } }),
          earnings: await prisma.employeeCommission.count(),
          redemptions: await prisma.customerRedemption.findMany({ orderBy: { id: "asc" } }),
          snapshots: await prisma.commissionRedemptionSnapshot.findMany({ orderBy: { id: "asc" } }),
          cutovers: await prisma.payrollCutover.count(),
          activations: await prisma.packageValuationActivation.count(),
        }));
      const before = await inventory();
      await t.test(
        "HTTP cart estimates use server prices, narrow staff responses and never post",
        async () => {
          mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-22T00:00:00Z") });
          try {
            const service = await f.scope(() => prisma.service.findFirstOrThrow());
            const input = {
              itemType: "SERVICE",
              itemId: service.id,
              quantity: 1,
              shares: [
                { staffId: f.staffId, share: 5000 },
                { staffId: f.managerId, share: 5000 },
              ],
            };
            const response = await request(
              "/payroll-close/cart-preview",
              staff,
              input,
              r.outlet.id,
            );
            assert.equal(response.status, 200, await response.clone().text());
            const data = (await response.json()).data;
            assert.equal(data.scope, "SELF");
            assert.equal(data.rows.length, 1);
            assert.equal(data.rows[0].staffId, f.staffId);
            assert.equal(data.basis, "HYPOTHETICAL_FULL_CASH");
            assert.equal(Number(data.baseAmount), 100);
            const redemptionInput = {
              holdingId: r.holding.id,
              customerId: r.customer.id,
              quantity: 1,
              shares: input.shares,
            };
            const session = await request(
              "/payroll-close/redemption-preview",
              staff,
              redemptionInput,
              r.outlet.id,
            );
            assert.equal(session.status, 200, await session.clone().text());
            const estimate = (await session.json()).data;
            assert.equal(estimate.scope, "SELF");
            assert.equal(estimate.rows.length, 1);
            assert.equal(estimate.rows[0].staffId, f.staffId);
            assert.equal(estimate.baseAmount, "25.0000");
            assert.equal(estimate.basis, "ORIGINAL_SESSION_SNAPSHOT");
            assert.equal(
              (await request("/payroll-close/redemption-preview", cashier, redemptionInput)).status,
              403,
            );
            assert.equal(
              (
                await request("/payroll-close/redemption-preview", manager, {
                  ...redemptionInput,
                  customerId: "foreign-customer",
                })
              ).status,
              404,
            );
            assert.equal(
              (
                await request("/payroll-close/redemption-preview", manager, {
                  ...redemptionInput,
                  baseAmount: "999",
                })
              ).status,
              422,
            );
            assert.equal(
              (
                await request("/payroll-close/cart-preview", manager, {
                  ...input,
                  baseAmount: "999",
                })
              ).status,
              422,
            );
            assert.equal(
              (await request("/payroll-close/cart-preview", cashier, input)).status,
              403,
            );
            assert.equal(
              (
                await request("/payroll-close/cart-preview", manager, {
                  ...input,
                  itemId: "foreign-item",
                })
              ).status,
              404,
            );
          } finally {
            mock.timers.reset();
          }
        },
      );
      await t.test(
        "approved frozen package bases filter and export consistently beyond page size",
        async () => {
          const filters = `&staffId=${f.staffId}&customerId=${r.customer.id}&packageId=${r.pkg.id}&commissionType=PKG_SALE&from=2026-09-15&to=2026-09-15&limit=1`;
          const response = await request(detail + filters);
          assert.equal(response.status, 200, await response.clone().text());
          const data = (await response.json()).data;
          assert.equal(data.approved, true);
          assert.equal(data.total, 1);
          assert.equal(data.rows[0].packageId, r.pkg.id);
          assert.equal(Number(data.rows[0].line.baseAmount), 100);
          assert.equal(JSON.stringify(data).includes("basicSalary"), false);
          const file = await request(
            "/payroll-close/commission-detail.xlsx?period=2026-09" + filters + "&page=2",
          );
          assert.equal(file.status, 200);
          assert.equal(file.headers.get("cache-control"), "no-store");
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(await file.arrayBuffer());
          assert.equal(workbook.worksheets.length, 1);
          assert.equal(workbook.worksheets[0]!.rowCount, 3);
          assert.equal(workbook.worksheets[0]!.getRow(3).getCell(10).value, r.pkg.id);
          const noMatch = await request(detail + `&packageId=${r.customer.id}`);
          assert.equal((await noMatch.json()).data.total, 0);
        },
      );
      await t.test(
        "sessions project the caller's latest evidence, including voids, not colleagues",
        async () => {
          const response = await request("/payroll-close/my-sessions?period=2026-09", staff);
          assert.equal(response.status, 200, await response.clone().text());
          const data = (await response.json()).data;
          assert.equal(data.scope, "SELF");
          assert.equal(data.total, 2);
          assert.deepEqual(
            data.rows.map((row: { status: string }) => row.status),
            ["VOIDED", "ACTIVE"],
          );
          const serialized = JSON.stringify(data);
          for (const secret of [
            f.managerId,
            r.customer.id,
            "synthetic-recorded-signature",
            "basicSalary",
          ])
            assert.equal(serialized.includes(secret), false);
          assert.equal(
            (
              await request(
                `/payroll-close/my-sessions?period=2026-09&staffId=${f.managerId}`,
                staff,
              )
            ).status,
            422,
          );
        },
      );
      await t.test(
        "utilisation keeps packs, active redeemed sessions and expired unused sessions separate",
        async () => {
          const response = await request("/reports/package-utilisation");
          assert.equal(response.status, 200, await response.clone().text());
          const row = (await response.json()).data.rows.find(
            (row: { id: string }) => row.id === r.pkg.id,
          );
          assert.equal(row.packsSold, 1);
          assert.equal(row.sessionsSold, 4);
          assert.equal(row.unavailableSoldLines, 0);
          assert.equal(row.sessionsRedeemed, 2);
          assert.equal(row.sessionsExpiredUnused, 1);
        },
      );
      await t.test(
        "per-holding liability uses original ordinals without activation or fabricated plan exposure",
        async () => {
          const response = await request("/reports/package-liability");
          assert.equal(response.status, 200, await response.clone().text());
          const row = (await response.json()).data.rows.find(
            (row: { holdingId: string }) => row.holdingId === r.holding.id,
          );
          assert.equal(row.sessionsRemaining, 1);
          assert.equal(row.remainingNet, "25.0000");
          assert.equal(row.expired, true);
          assert.equal(row.commissionExposure, null);
          assert.match(row.exposureReason, /Future performer/);
          for (const bearer of [staff, cashier]) {
            assert.equal((await request("/reports/package-liability", bearer)).status, 403);
          }
          assert.equal(
            (await request("/reports/package-liability", manager, undefined, r.outlet.id)).status,
            403,
          );
        },
      );
      await t.test(
        "database roles and company/tenant boundaries refuse elevated or cross-scope reads",
        async () => {
          for (const bearer of [staff, cashier]) {
            assert.equal((await request(detail, bearer)).status, 403);
            assert.equal((await request("/reports/package-utilisation", bearer)).status, 403);
          }
          assert.equal(
            (await request("/payroll-close/my-sessions?period=2026-09", cashier)).status,
            403,
          );
          assert.equal((await request(detail, manager, undefined, r.outlet.id)).status, 403);
          assert.equal(
            (await request("/reports/package-utilisation", manager, undefined, r.outlet.id)).status,
            403,
          );
          const foreign = await payrollCloseFixture(4, true);
          const foreignModule = await prisma.module.findUniqueOrThrow({
            where: { code: "reports" },
          });
          await runAsTenant(foreign.tenantId, () =>
            prisma.tenantModule.create({
              data: { tenantId: foreign.tenantId, moduleId: foreignModule.id },
            }),
          );
          const foreignManager = signAccessToken({
            id: foreign.managerId,
            email: "foreign@example.test",
            globalRole: "MANAGER",
            tenantId: foreign.tenantId,
            realm: "web",
            tokenVersion: 0,
          }).token;
          assert.equal((await (await request(detail, foreignManager)).json()).data.approved, false);
          const foreignUtilisation = await request("/reports/package-utilisation", foreignManager);
          assert.equal(foreignUtilisation.status, 200, await foreignUtilisation.clone().text());
          assert.deepEqual((await foreignUtilisation.json()).data.rows, []);
          await f.scope(() =>
            prisma.user.update({ where: { id: f.managerId }, data: { globalRole: "STAFF" } }),
          );
          try {
            assert.equal((await request(detail, manager)).status, 403);
            assert.equal((await request("/reports/package-utilisation", manager)).status, 403);
          } finally {
            await runAsTenant(f.tenantId, () =>
              prisma.user.update({ where: { id: f.managerId }, data: { globalRole: "MANAGER" } }),
            );
          }
        },
      );
      await t.test(
        "all reporting reads leave snapshots, earnings, source and session evidence unchanged",
        async () => {
          assert.deepEqual(await inventory(), before);
          assert.equal(before.earnings, 0);
          assert.equal(before.cutovers, 0);
          assert.equal(before.activations, 0);
        },
      );
    } finally {
      server.close();
      server.closeAllConnections();
    }
  },
);
