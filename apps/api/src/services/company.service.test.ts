/**
 * `updateCompany` against the real database.
 *
 * The console could create a company and never change it, so a company whose
 * `ownerUserId` was never written read "No owner assigned" with no way out. Four
 * things about the repair can only be shown against a real database and real
 * foreign keys:
 *
 * - a company with no owner gets a pending SUPER_ADMIN, a live invitation and the
 *   `tenants.ownerUserId` pointer that makes it the owner;
 * - a rename alone touches no owner row and sends nothing;
 * - an owner who has **accepted** is refused with `409` rather than silently
 *   demoted — the row that proves it is the invitation's `acceptedAt`;
 * - a pending owner's new address revokes the old link instead of leaving two that
 *   both work.
 *
 * Skipped with a clear message when `DATABASE_URL` is absent, so `npm run verify`
 * still passes on a machine with no database running.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform } from "../lib/tenant-context.js";
import { updateCompany } from "./company.service.js";

const databaseUrl = process.env["DATABASE_URL"];

/** One company per state the endpoint branches on. */
const OWNERLESS = { id: "company-edit-ownerless", slug: "company-edit-ownerless" };
const PENDING = { id: "company-edit-pending", slug: "company-edit-pending" };
const ONBOARDED = { id: "company-edit-onboarded", slug: "company-edit-onboarded" };
const SUSPENDED = { id: "company-edit-suspended", slug: "company-edit-suspended" };
const TENANTS = [OWNERLESS, PENDING, ONBOARDED, SUSPENDED];
const IDS = TENANTS.map((tenant) => tenant.id);

const OPERATOR_ID = "company-edit-operator";

async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: IDS } } });
    // `tenants.ownerUserId` references `users` with RESTRICT, so the pointer goes
    // before the people it points at.
    await prisma.tenant.updateMany({ where: { id: { in: IDS } }, data: { ownerUserId: null } });
    await prisma.ownerInvitation.deleteMany({ where: { tenantId: { in: IDS } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: IDS } } });
    await prisma.tenant.deleteMany({ where: { id: { in: IDS } } });
    await prisma.platformAdmin.deleteMany({ where: { id: OPERATOR_ID } });
  });
}

async function seed(): Promise<void> {
  await purge();

  await runAsPlatform(async () => {
    await prisma.platformAdmin.create({
      data: {
        id: OPERATOR_ID,
        email: "operator@company-edit.test",
        name: "Operator",
        passwordHash: "not-a-real-hash",
        twoFactorEnabled: false,
      },
    });

    await prisma.tenant.create({
      data: { id: OWNERLESS.id, name: "Ownerless Salon", slug: OWNERLESS.slug },
    });
    await prisma.tenant.create({
      data: {
        id: SUSPENDED.id,
        name: "Suspended Salon",
        slug: SUSPENDED.slug,
        status: "SUSPENDED",
      },
    });

    // A pending owner with a live invitation, and one who has accepted theirs.
    for (const [tenant, accepted] of [
      [PENDING, false],
      [ONBOARDED, true],
    ] as const) {
      await prisma.tenant.create({
        data: { id: tenant.id, name: `Salon ${tenant.id}`, slug: tenant.slug },
      });
      const owner = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          name: "Original Owner",
          email: `owner-${tenant.id}@company-edit.test`,
          globalRole: "SUPER_ADMIN",
          disabled: !accepted,
          passwordHash: "not-a-real-hash",
        },
      });
      await prisma.tenant.update({ where: { id: tenant.id }, data: { ownerUserId: owner.id } });
      await prisma.ownerInvitation.create({
        data: {
          tenantId: tenant.id,
          userId: owner.id,
          tokenHash: `token-hash-${tenant.id}`,
          expiresAt: new Date(Date.now() + 60_000),
          acceptedAt: accepted ? new Date() : null,
        },
      });
    }
  });
}

/**
 * Run without a portal origin, so `invitationOrigin()` refuses and delivery is
 * reported as `failed`.
 *
 * That is the honest answer for a machine with no mail server — and it keeps the
 * suite from opening a connection to one, or from asserting on whether the
 * developer's `.env` happens to configure SMTP.
 */
async function withoutMail<T>(run: () => Promise<T>): Promise<T> {
  const origin = process.env["SALON_PORTAL_ORIGIN"];
  delete process.env["SALON_PORTAL_ORIGIN"];
  try {
    return await run();
  } finally {
    if (origin !== undefined) process.env["SALON_PORTAL_ORIGIN"] = origin;
  }
}

const auditOf = (tenantId: string) =>
  runAsPlatform(() =>
    prisma.auditLog.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } }),
  );

describe("company edits", { skip: databaseUrl ? false : "DATABASE_URL is not set" }, () => {
  beforeEach(seed);
  after(purge);

  it("gives an ownerless company a pending owner, a live invitation and two audit rows", async () => {
    const result = await withoutMail(() =>
      updateCompany(
        OWNERLESS.id,
        {
          name: "Renamed Salon",
          slug: OWNERLESS.slug,
          ownerName: "New Owner",
          ownerEmail: "new-owner@company-edit.test",
          reason: "Owner was never recorded",
        },
        OPERATOR_ID,
      ),
    );

    assert.equal(result.company.name, "Renamed Salon");
    assert.equal(result.company.owner?.name, "New Owner");
    // The write is committed; only the mail failed. A saved edit must never be
    // reported as an error the operator could "fix" by saving again.
    assert.equal(result.invitationDelivery, "failed");

    const created = await runAsPlatform(() =>
      prisma.user.findFirst({ where: { tenantId: OWNERLESS.id } }),
    );
    assert.ok(created, "the owner account was created");
    assert.equal(created.globalRole, "SUPER_ADMIN");
    assert.equal(
      created.disabled,
      true,
      "the owner cannot sign in until the invitation is accepted",
    );

    const invitations = await runAsPlatform(() =>
      prisma.ownerInvitation.findMany({ where: { tenantId: OWNERLESS.id } }),
    );
    assert.equal(invitations.length, 1);
    assert.equal(invitations[0].acceptedAt, null);
    assert.equal(invitations[0].userId, created.id);

    const actions = await auditOf(OWNERLESS.id);
    assert.deepEqual(
      actions.map((row) => row.action),
      ["company.update", "company.owner.assign"],
    );
    assert.match(JSON.stringify(actions[0].metadata), /Owner was never recorded/);
    assert.match(JSON.stringify(actions[0].metadata), /Ownerless Salon/);
  });

  it("renames without touching the owner row or sending an invitation", async () => {
    const result = await withoutMail(() =>
      updateCompany(
        PENDING.id,
        { name: "Salon Renamed", slug: `${PENDING.slug}-renamed`, reason: "Correcting the name" },
        OPERATOR_ID,
      ),
    );

    // No owner pair in the request means "keep the owner", so nothing was sent.
    assert.equal(result.invitationDelivery, null);
    assert.equal(result.company.owner?.name, "Original Owner");

    const invitations = await runAsPlatform(() =>
      prisma.ownerInvitation.findMany({ where: { tenantId: PENDING.id } }),
    );
    assert.equal(invitations.length, 1, "a rename issues no new link");
    assert.equal(invitations[0].revokedAt, null, "and revokes nothing");

    assert.deepEqual(
      (await auditOf(PENDING.id)).map((row) => row.action),
      ["company.update"],
    );
  });

  it("refuses to replace an owner who has already onboarded", async () => {
    await assert.rejects(
      withoutMail(() =>
        updateCompany(
          ONBOARDED.id,
          {
            name: "Salon onboarded",
            slug: ONBOARDED.slug,
            ownerName: "Somebody Else",
            ownerEmail: "somebody-else@company-edit.test",
            reason: "Handing the company over",
          },
          OPERATOR_ID,
        ),
      ),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 409 &&
        /transfer, not an edit/.test(error.message),
    );

    // Nothing moved: the working owner is still the owner and their account is
    // untouched — a 409 that had half-applied its change would be worse than none.
    const company = await runAsPlatform(() =>
      prisma.tenant.findUnique({ where: { id: ONBOARDED.id }, include: { owner: true } }),
    );
    assert.equal(company?.name, `Salon ${ONBOARDED.id}`);
    assert.equal(company?.owner?.email, `owner-${ONBOARDED.id}@company-edit.test`);
    assert.equal((await auditOf(ONBOARDED.id)).length, 0);
  });

  it("refuses to give an owner to a company that is not active", async () => {
    await assert.rejects(
      withoutMail(() =>
        updateCompany(
          SUSPENDED.id,
          {
            name: "Suspended Salon",
            slug: SUSPENDED.slug,
            ownerName: "New Owner",
            ownerEmail: "new-owner@company-edit.test",
            reason: "Hiring a manager",
          },
          OPERATOR_ID,
        ),
      ),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 409 &&
        /Reactivate this company/.test(error.message),
    );

    // An invitation nobody could accept is not minted, and no half-created user is
    // left behind: the whole edit rolled back, including the rename.
    assert.equal(
      await runAsPlatform(() => prisma.user.count({ where: { tenantId: SUSPENDED.id } })),
      0,
    );
    const company = await runAsPlatform(() =>
      prisma.tenant.findUnique({ where: { id: SUSPENDED.id } }),
    );
    assert.equal(company?.ownerUserId, null);
  });

  it("revokes the old link when a pending owner's address changes", async () => {
    const result = await withoutMail(() =>
      updateCompany(
        PENDING.id,
        {
          name: `Salon ${PENDING.id}`,
          slug: PENDING.slug,
          ownerName: "Original Owner",
          ownerEmail: "moved@company-edit.test",
          reason: "Owner changed email address",
        },
        OPERATOR_ID,
      ),
    );

    assert.equal(result.company.owner?.email, "moved@company-edit.test");
    assert.equal(result.invitationDelivery, "failed");

    const invitations = await runAsPlatform(() =>
      prisma.ownerInvitation.findMany({
        where: { tenantId: PENDING.id },
        orderBy: { createdAt: "asc" },
      }),
    );
    assert.equal(invitations.length, 2);
    // Two live links to one account would be two ways in; exactly one survives.
    assert.ok(invitations[0].revokedAt, "the superseded invitation is revoked");
    assert.equal(invitations[1].revokedAt, null);
    assert.equal(invitations[1].acceptedAt, null);

    assert.deepEqual(
      (await auditOf(PENDING.id)).map((row) => row.action),
      ["company.update", "company.owner.update"],
    );
  });
});
