import { prisma } from "../lib/prisma.js";
import { mock } from "node:test";
import { runAtOutlet } from "../lib/tenant-context.js";
import type { payrollCloseFixture } from "./payroll-close-fixture.js";
import { createSale } from "../services/sale.service.js";

/** Real completed package purchase, plus explicitly synthetic historical session
 * evidence. No activation or posting is needed to exercise these read models. */
export async function payrollReportingFixture(f: Awaited<ReturnType<typeof payrollCloseFixture>>) {
  return f.scope(async () => {
    for (const code of ["catalogue", "packages", "sales", "customers", "reports"]) {
      const module = await prisma.module.upsert({
        where: { code },
        update: {},
        create: { code, name: code, category: "Core", isCore: true },
      });
      await prisma.tenantModule.createMany({
        data: [{ tenantId: f.tenantId, moduleId: module.id }],
        skipDuplicates: true,
      });
    }
    const customer = await prisma.customer.create({
      data: { tenantId: f.tenantId, name: "Reporting package buyer" },
    });
    const pkg = await prisma.package.create({
      data: {
        tenantId: f.tenantId,
        name: "Reporting four-session package",
        sessionCount: 4,
        memberPrice: "100",
        nonmemberPrice: "100",
        commissionSettings: {
          sale: { mode: "FOLLOW_PLAN" },
          redemption: { mode: "FOLLOW_PLAN" },
          minimumDepositPct: "0",
        },
      },
    });
    const outlet = await prisma.outlet.findFirstOrThrow();
    mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-15T00:00:00Z") });
    const sale = await (async () => {
      try {
        return await runAtOutlet(outlet.id, () =>
          createSale({
            customerId: customer.id,
            lines: [
              {
                itemType: "PACKAGE",
                itemId: pkg.id,
                quantity: 1,
                attribution: { sellers: [{ staffId: f.staffId, share: 10000 }] },
              },
            ],
            payments: [{ method: "CASH", amount: 100 }],
            collection: {
              currency: "SGD",
              allocations: [{ paymentIndex: 0, linePosition: 0, grossCents: "10000" }],
            },
          }),
        );
      } finally {
        mock.timers.reset();
      }
    })();
    const holding = await prisma.customerPackageHolding.findFirstOrThrow({
      where: { customerId: customer.id, packageId: pkg.id },
    });
    // Install only after close calculation/approval: these are deliberately
    // historical read fixtures, not fabricated inputs for the authoritative loader.
    const seedSessions = (period = "2026-09") =>
      f.scope(async () => {
        await prisma.customerPackageHolding.update({
          where: { id: holding.id },
          data: {
            quantityRemaining: 1,
            payrollAvailableOrdinals: [{ first: 4, last: 4 }],
            expiresAt: new Date("2026-10-01T00:00:00Z"),
          },
        });
        const sessions = [];
        for (const [index, staffId] of [f.staffId, f.managerId, f.staffId].entries()) {
          const row = await prisma.customerRedemption.create({
            data: {
              tenantId: f.tenantId,
              customerId: customer.id,
              saleId: sale.id,
              itemType: "PACKAGE",
              itemId: pkg.id,
              holdingId: holding.id,
              quantity: 1,
              usedAt: new Date(`${period}-${16 + index}T00:00:00Z`),
              revertedAt: index === 2 ? new Date(`${period}-20T00:00:00Z`) : null,
              signature: index === 0 ? "synthetic-recorded-signature" : null,
            },
          });
          const performers = [{ staffId, share: 10000 }];
          await prisma.commissionRedemptionSnapshot.create({
            data: {
              tenantId: f.tenantId,
              redemptionId: row.id,
              revision: 1,
              eventKey: `reporting-session:${row.id}`,
              eventHash: `synthetic:${row.id}`,
              eventType: "CAPTURE",
              actorId: f.ownerId,
              reason: "Synthetic historical reporting evidence",
              evidence: {
                version: 1,
                coverage: [
                  {
                    saleLineId: sale.lines[0]!.id,
                    serviceId: "synthetic-history-service",
                    quantity: 1,
                    performers,
                  },
                ],
                performers,
                attributionStatus: "EXPLICIT_TENDER",
                valuation: null,
                evaluatedAt: `${period}-18T00:00:00Z`,
                rates: [],
                postingStatus: "PENDING_RELEASE",
                previousSnapshotId: null,
              },
            },
          });
          sessions.push(row);
        }
        return sessions;
      });
    return { customer, pkg, sale, holding, seedSessions, outlet };
  });
}
