import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

test(
  "assistant HTTP authorization, validation, isolation and read-only drafts",
  {
    skip: process.env.AI_ASSISTANT_ACCEPTANCE !== "1",
  },
  async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55440");
    assert.equal(url.pathname, "/package_expiry_test");
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "assistant-isolated-acceptance-secret";
    const { prisma } = await import("../lib/prisma.js");
    const { runAsPlatform } = await import("../lib/tenant-context.js");
    const { signAccessToken } = await import("../lib/tokens.js");
    const { createApp } = await import("../app.js");
    const { salonDayBounds } = await import("../lib/wall-clock.js");
    const ids = ["assistant-acceptance-a", "assistant-acceptance-b"];
    const purge = () =>
      runAsPlatform(() => prisma.tenant.deleteMany({ where: { id: { in: ids } } }));
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ai-assistant`;
    try {
      await purge();
      const fixture = await runAsPlatform(async () => {
        for (const id of ids)
          await prisma.tenant.create({
            data: { id, name: id, slug: id, timeZone: "Asia/Singapore" },
          });
        const users = [];
        for (const role of ["MANAGER", "STAFF", "SUPER_ADMIN"] as const)
          users.push(
            await prisma.user.create({
              data: {
                tenantId: ids[0]!,
                name: role,
                email: `${role}@assistant.test`,
                passwordHash: "unused",
                globalRole: role,
                twoFactorEnabled: role === "SUPER_ADMIN",
              },
            }),
          );
        const modules = [];
        for (const code of ["dashboard", "customers", "appointments", "catalogue"])
          modules.push(
            await prisma.module.upsert({
              where: { code },
              update: {},
              create: { code, name: code, category: "Test", isCore: false },
            }),
          );
        for (const module of modules)
          await prisma.tenantModule.create({ data: { tenantId: ids[0]!, moduleId: module.id } });
        const services: Array<{ id: string }> = [];
        for (const tenantId of ids)
          services.push(
            await prisma.service.create({
              data: {
                tenantId,
                name: `${tenantId} service`,
                memberPrice: 10,
                nonmemberPrice: 10,
                durationMinutes: 30,
              },
            }),
          );
        const now = new Date();
        const today = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Singapore",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(now);
        const bounds = salonDayBounds(today, "Asia/Singapore");
        for (const [tenantId, amount] of [
          [ids[0]!, "100.01"],
          [ids[1]!, "999.00"],
        ]) {
          await prisma.sale.create({
            data: {
              tenantId,
              status: "COMPLETED",
              soldAt: now,
              totalQuantity: 1,
              totalAmount: amount,
              paidAmount: amount,
            },
          });
        }
        for (const soldAt of [new Date(bounds.from.getTime() - 1), bounds.to])
          await prisma.sale.create({
            data: {
              tenantId: ids[0]!,
              status: "COMPLETED",
              soldAt,
              totalQuantity: 1,
              totalAmount: 500,
              paidAmount: 500,
            },
          });
        await prisma.sale.create({
          data: {
            tenantId: ids[0]!,
            status: "HELD",
            soldAt: now,
            totalQuantity: 1,
            totalAmount: 500,
            paidAmount: 500,
          },
        });
        const old = new Date(now.getTime() - 100 * 86_400_000);
        const recent = new Date(now.getTime() - 5 * 86_400_000);
        const appointment = (
          tenantId: string,
          customerId: string,
          startsAt: Date,
          status: "COMPLETED" | "SCHEDULED" | "NO_SHOW" | "CANCELLED" = "COMPLETED",
        ) =>
          prisma.appointment.create({
            data: {
              tenantId,
              customerId,
              serviceId: services[tenantId === ids[0] ? 0 : 1]!.id,
              startsAt,
              endsAt: new Date(startsAt.getTime() + 30 * 60_000),
              status,
            },
          });
        for (const kind of [
          "overdue",
          "pdpa-only",
          "marketing-only",
          "archived",
          "recent",
          "upcoming",
          "no-show",
          "cancelled",
          "no-email",
          "foreign",
        ]) {
          const tenantId = kind === "foreign" ? ids[1]! : ids[0]!;
          const customer = await prisma.customer.create({
            data: {
              tenantId,
              name: kind,
              email: kind === "no-email" ? null : `${kind}@assistant.test`,
              pdpaConsent: kind !== "marketing-only",
              marketingOptIn: kind !== "pdpa-only",
              archivedAt: kind === "archived" ? now : null,
            },
          });
          await appointment(
            tenantId,
            customer.id,
            old,
            kind === "no-show" ? "NO_SHOW" : kind === "cancelled" ? "CANCELLED" : "COMPLETED",
          );
          if (kind === "recent") await appointment(tenantId, customer.id, recent);
          if (kind === "upcoming")
            await appointment(
              tenantId,
              customer.id,
              new Date(now.getTime() + 86_400_000),
              "SCHEDULED",
            );
        }
        await prisma.product.create({
          data: {
            tenantId: ids[0]!,
            name: "Available cream",
            quantity: 2,
            memberPrice: 5,
            nonmemberPrice: 5,
          },
        });
        await prisma.product.create({
          data: {
            tenantId: ids[0]!,
            name: "Empty cream",
            quantity: 0,
            memberPrice: 5,
            nonmemberPrice: 5,
          },
        });
        return { users, old };
      });
      const token = (index: number) => {
        const user = fixture.users[index]!;
        return signAccessToken({
          id: user.id,
          email: user.email!,
          globalRole: user.globalRole,
          realm: "web",
          tenantId: ids[0]!,
          tokenVersion: user.tokenVersion,
        }).token;
      };
      const get = (path: string, bearer?: string) =>
        fetch(`${base}${path}`, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
      for (const path of ["/owner-summary", "/rebooking-nudges", "/slow-day-promos"]) {
        assert.equal((await get(path)).status, 401);
        assert.equal((await get(path, token(1))).status, 403);
        assert.equal((await get(path, token(2))).status, 200);
      }
      for (const path of [
        "/owner-summary?from=bad",
        "/owner-summary?from=2026-02-30",
        "/owner-summary?from=2026-10-24&to=2026-10-23",
        "/owner-summary?from=2026-10-23&from=2026-10-24",
        "/rebooking-nudges?daysThreshold=NaN",
        "/rebooking-nudges?daysThreshold=-1",
        "/slow-day-promos?discountPercentage=101",
        "/owner-summary?tenantId=foreign",
      ])
        assert.equal((await get(path, token(0))).status, 422, path);
      const summaryResponse = await get("/owner-summary", token(0));
      assert.equal(summaryResponse.status, 200);
      const summary = (await summaryResponse.json()) as {
        data: { incomeToday: string; averageTicket: string };
      };
      assert.equal(summary.data.incomeToday, "100.01");
      assert.equal(summary.data.averageTicket, "100.01");
      const nudgeResponse = await get("/rebooking-nudges", token(0));
      assert.equal(nudgeResponse.status, 200);
      const nudges = (await nudgeResponse.json()) as {
        data: Array<{ customerName: string }>;
        requiresApproval: boolean;
      };
      assert.equal(nudges.requiresApproval, true);
      assert.deepEqual(
        nudges.data.map((nudge) => nudge.customerName),
        ["overdue"],
      );
      // An old reporting window must not resurrect the recent customer's older visit.
      const oldEnd = new Date(fixture.old.getTime() + 86_400_000).toISOString();
      const historical = (await (
        await get(`/rebooking-nudges?to=${encodeURIComponent(oldEnd)}`, token(0))
      ).json()) as typeof nudges;
      assert.deepEqual(
        historical.data.map((nudge) => nudge.customerName),
        ["overdue"],
      );
      const before = await runAsPlatform(async () => [
        await prisma.messageJob.count(),
        await prisma.voucher.count(),
      ]);
      const promoResponse = await get("/slow-day-promos", token(0));
      assert.equal(promoResponse.status, 200);
      const promos = (await promoResponse.json()) as {
        data: Array<{ name: string; validFrom: string }>;
        requiresApproval: boolean;
      };
      assert.equal(promos.requiresApproval, true);
      assert.equal(promos.data.length, 2);
      const salonToday = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Singapore",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      assert.ok(promos.data.every((promo) => promo.validFrom > salonToday));
      assert.ok(
        promos.data.every(
          (promo) => !promo.name.includes("foreign") && !promo.name.includes("Empty"),
        ),
      );
      assert.deepEqual(
        await runAsPlatform(async () => [
          await prisma.messageJob.count(),
          await prisma.voucher.count(),
        ]),
        before,
      );
      // Disable a user: existing tokens must no longer access these endpoints.
      await runAsPlatform(() =>
        prisma.user.update({ where: { id: fixture.users[0]!.id }, data: { disabled: true } }),
      );
      assert.equal((await get("/owner-summary", token(0))).status, 401);
      await runAsPlatform(() =>
        prisma.tenant.update({ where: { id: ids[0]! }, data: { status: "EXPIRED" } }),
      );
      assert.equal((await get("/owner-summary", token(2))).status, 403);
    } finally {
      await purge();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await prisma.$disconnect();
    }
  },
);
