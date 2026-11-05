/**
 * `changeCompanyModules` and the stored-vs-effective status, against the real database.
 *
 * Three things here can only be shown with real rows and real foreign keys:
 *
 * - a bulk grant touches the add-ons that are off or lapsed and **not** the ones that
 *   are already running — the row that proves it is the untouched grant's `expiresAt`,
 *   which a naive upsert-for-every-module would have overwritten;
 * - core modules and `UNENFORCED_MODULE_CODES` never get a `TenantModule` row, even
 *   though a bulk request names no modules at all;
 * - one click writes **one** audit row, not one per module, and a request that would
 *   change nothing is refused instead of being logged as work.
 *
 * Skipped with a clear message when `DATABASE_URL` is absent, so `npm run verify` still
 * passes on a machine with no database running.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import { UNENFORCED_MODULE_CODES } from "@glampro_suite/shared";

import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { changeCompanyModules, companyAdministration } from "./company-administration.service.js";

const databaseUrl = process.env["DATABASE_URL"];

const COMPANY = { id: "company-bulk-company", slug: "company-bulk-company" };
const OPERATOR_ID = "company-bulk-operator";

const DAY = 24 * 60 * 60 * 1000;
/** A core module, and three add-ons: one on, one lapsed, one with no screen behind it. */
const CORE = "test-bulk-core";
const ADD_ON = "packages";
const LAPSED = "payroll";
const UNENFORCED = "inventory";

async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId: COMPANY.id } });
    await prisma.tenantModule.deleteMany({ where: { tenantId: COMPANY.id } });
    await prisma.subscription.deleteMany({ where: { tenantId: COMPANY.id } });
    await prisma.tenant.deleteMany({ where: { id: COMPANY.id } });
    await prisma.platformAdmin.deleteMany({ where: { id: OPERATOR_ID } });
    // Only the module this suite invented; the seeded catalogue stays untouched.
    await prisma.module.deleteMany({ where: { code: CORE } });
  });
}

/** The catalogue rows, created on demand so the suite does not depend on a seed run. */
async function catalogueIds(): Promise<Record<string, string>> {
  await runAsPlatform(async () => {
    await prisma.module.upsert({
      where: { code: CORE },
      update: { isCore: true },
      create: { code: CORE, name: "Bulk Core", category: "Test", isCore: true },
    });
    for (const code of [ADD_ON, LAPSED, UNENFORCED])
      await prisma.module.upsert({
        where: { code },
        update: { isCore: false },
        create: { code, name: code, category: "Test" },
      });
  });
  const rows = await runAsPlatform(() =>
    prisma.module.findMany({ where: { code: { in: [CORE, ADD_ON, LAPSED, UNENFORCED] } } }),
  );
  return Object.fromEntries(rows.map((row) => [row.code, row.id]));
}

async function seed(): Promise<void> {
  await purge();
  const ids = await catalogueIds();
  await runAsPlatform(async () => {
    await prisma.platformAdmin.create({
      data: {
        id: OPERATOR_ID,
        email: "operator@company-bulk.test",
        name: "Operator",
        passwordHash: "not-a-real-hash",
        twoFactorEnabled: false,
      },
    });
    await prisma.tenant.create({
      data: { id: COMPANY.id, name: "Bulk Salon", slug: COMPANY.slug },
    });
    // One period that has already ended: stored ACTIVE, expired in effect.
    await prisma.subscription.create({
      data: {
        tenantId: COMPANY.id,
        startDate: new Date(Date.now() - 60 * DAY),
        endDate: new Date(Date.now() - 30 * DAY),
        status: "EXPIRED",
        amount: "99.00",
        currency: "SGD",
      },
    });
  });
  await runAsTenant(COMPANY.id, async () => {
    // On with no expiry, and lapsed. The first must survive a bulk grant untouched.
    await prisma.tenantModule.create({
      data: { tenantId: COMPANY.id, moduleId: ids[ADD_ON]!, expiresAt: null },
    });
    await prisma.tenantModule.create({
      data: {
        tenantId: COMPANY.id,
        moduleId: ids[LAPSED]!,
        expiresAt: new Date(Date.now() - 30 * DAY),
      },
    });
  });
}

const grantsOf = () => runAsTenant(COMPANY.id, () => prisma.tenantModule.findMany());
const actionsOf = async () =>
  (
    await runAsPlatform(() =>
      prisma.auditLog.findMany({ where: { tenantId: COMPANY.id }, orderBy: { createdAt: "asc" } }),
    )
  ).map((row) => row.action);

const isStatus = (status: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === status;

describe(
  "company module bulk changes",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    beforeEach(seed);
    after(purge);

    it("grants what is off or lapsed and leaves a running grant's own expiry alone", async () => {
      assert.ok(
        (UNENFORCED_MODULE_CODES as readonly string[]).includes(UNENFORCED),
        "the fixture must name a module with no screen behind it",
      );
      const expiresAt = new Date(Date.now() + 365 * DAY);

      const result = await changeCompanyModules(
        COMPANY.id,
        { enabled: true, expiresAt: expiresAt.toISOString(), reason: "Annual renewal" },
        OPERATOR_ID,
      );

      assert.ok(result.changed.includes(LAPSED), "a lapsed add-on is granted again");
      assert.ok(!result.changed.includes(ADD_ON), "a live add-on is not rewritten");
      assert.ok(result.unchanged.includes(ADD_ON), "and it is reported as left alone");
      assert.ok(!result.changed.includes(UNENFORCED), "a module with no screen is skipped");
      assert.ok(!result.changed.includes(CORE), "core modules need no grant");

      const ids = await catalogueIds();
      const grants = await grantsOf();
      const grantOf = (code: string) => grants.find((row) => row.moduleId === ids[code]);
      assert.equal(grantOf(LAPSED)?.expiresAt?.toISOString(), expiresAt.toISOString());
      assert.equal(grantOf(ADD_ON)?.expiresAt, null, "the live grant kept the term it had");
      assert.equal(grantOf(UNENFORCED), undefined);
      assert.equal(grantOf(CORE), undefined);

      assert.deepEqual(await actionsOf(), ["company.module.bulk_grant"]);
    });

    it("revokes every grant, lapsed ones included, so the table and the switches agree", async () => {
      const result = await changeCompanyModules(
        COMPANY.id,
        { enabled: false, expiresAt: null, reason: "Contract ended" },
        OPERATOR_ID,
      );

      assert.deepEqual([...result.changed].sort(), [ADD_ON, LAPSED].sort());
      // The lapsed row goes too: left behind, its switch would read "off" while the
      // table still showed an expired grant.
      assert.equal((await grantsOf()).length, 0);
      assert.deepEqual(await actionsOf(), ["company.module.bulk_revoke"]);
    });

    it("refuses an expiry on a revocation and one that has already passed", async () => {
      await assert.rejects(
        () =>
          changeCompanyModules(
            COMPANY.id,
            {
              enabled: false,
              expiresAt: new Date(Date.now() + DAY).toISOString(),
              reason: "Contract ended",
            },
            OPERATOR_ID,
          ),
        isStatus(400),
      );
      await assert.rejects(
        () =>
          changeCompanyModules(
            COMPANY.id,
            {
              enabled: true,
              expiresAt: new Date(Date.now() - DAY).toISOString(),
              reason: "Annual renewal",
            },
            OPERATOR_ID,
          ),
        isStatus(400),
      );
      // Neither attempt wrote anything, so neither may be recorded as a change.
      assert.deepEqual(await actionsOf(), []);
    });

    it("refuses a batch that would change nothing instead of logging an empty one", async () => {
      await changeCompanyModules(
        COMPANY.id,
        { enabled: false, expiresAt: null, reason: "Contract ended" },
        OPERATOR_ID,
      );

      await assert.rejects(
        () =>
          changeCompanyModules(
            COMPANY.id,
            { enabled: false, expiresAt: null, reason: "Contract ended" },
            OPERATOR_ID,
          ),
        isStatus(409),
      );
      assert.deepEqual(await actionsOf(), ["company.module.bulk_revoke"]);
    });

    it("reports the stored status beside the effective one", async () => {
      const snapshot = await companyAdministration(COMPANY.id);

      // The column says ACTIVE; the lapsed period says EXPIRED. The console needs both:
      // the badge shows the second, and "Reactivate" would be refused because of the
      // first, so the buttons are gated on the pair rather than on either alone.
      assert.equal(snapshot.status, "ACTIVE");
      assert.equal(snapshot.effectiveStatus, "EXPIRED");
    });
  },
);
