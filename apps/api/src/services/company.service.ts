import { randomBytes } from "node:crypto";
import type {
  CompanyListQuery,
  CreateCompanyInput,
  AcceptOwnerInvitationInput,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { conflict, HttpError, notFound, badRequest } from "../lib/http-error.js";
import { hashPassword } from "../lib/password.js";
import { createRefreshToken, hashRefreshToken } from "../lib/tokens.js";
import { isSmtpConfigured, sendMail } from "../lib/email.js";

const select = {
  id: true,
  name: true,
  slug: true,
  status: true,
  createdAt: true,
  owner: { select: { id: true, name: true, email: true, disabled: true } },
  // Only the latest plan's expiry is interesting to an operator; `endDate` is
  // the subscription's expiry (there is no separate renewal column) and every
  // other reader picks it the same way, so the console cannot disagree.
  subscriptions: { orderBy: { endDate: "desc" }, take: 1, select: { endDate: true } },
} as const;
/**
 * The row as the console reads it: instants as ISO strings, and the nested
 * subscription list flattened into the one field the UI shows.
 */
function publicCompany<T extends { createdAt: Date; subscriptions: { endDate: Date }[] }>(
  company: T,
) {
  const { subscriptions, ...rest } = company;
  return {
    ...rest,
    createdAt: company.createdAt.toISOString(),
    subscriptionEndsAt: subscriptions[0]?.endDate.toISOString() ?? null,
  };
}
function invitationOrigin() {
  const value = process.env.SALON_PORTAL_ORIGIN;
  if (!value) throw new HttpError(503, "Configure SALON_PORTAL_ORIGIN before onboarding.");
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
  ) {
    throw new HttpError(
      503,
      "SALON_PORTAL_ORIGIN must be an HTTPS origin (loopback HTTP allowed).",
    );
  }
  if (!isSmtpConfigured())
    throw new HttpError(503, "Configure SMTP before onboarding.", { code: "EMAIL_NOT_CONFIGURED" });
  return url.origin;
}
async function deliver(email: string, token: string, origin: string) {
  // Fragment avoids sending the secret to reverse proxies, access logs or Referer.
  const link = `${origin}/accept-invitation#${token}`;
  try {
    await sendMail({
      to: email,
      subject: "Set up your Glampro owner account",
      text: `You have been invited to manage a company on Glampro. Choose your password within 48 hours: ${link}\nIf unexpected, ignore this invitation.`,
      html: `<p>You have been invited to manage a company on Glampro.</p><p><a href="${link}">Choose your password</a> within 48 hours.</p><p>If unexpected, ignore this invitation.</p>`,
    });
    return "sent" as const;
  } catch {
    return "failed" as const;
  }
}
function rethrowDuplicate(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")
    throw conflict("The company slug or owner email is already in use.");
  throw error;
}
/**
 * `GET /api/platform/companies` — the directory, plus whole-directory totals.
 *
 * The tiles count the business, not the page: `search` and paging narrow
 * `items`/`total` only, while `stats` always describes every company. One
 * transaction keeps the rows and the numbers from the same snapshot, so a
 * company created mid-request cannot appear in a tile but not in a page.
 */
export async function listCompanies(query: CompanyListQuery) {
  const where = query.search
    ? {
        OR: [
          { name: { contains: query.search, mode: "insensitive" as const } },
          { slug: { contains: query.search, mode: "insensitive" as const } },
        ],
      }
    : {};
  const now = new Date();
  const expiringBy = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
  const [items, total, byStatus, expiringSoon] = await prisma.$transaction([
    prisma.tenant.findMany({
      where,
      select,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.tenant.count({ where }),
    prisma.tenant.groupBy({ by: ["status"], _count: { _all: true } }),
    // Live companies whose **latest** plan lapses inside the window: at least
    // one subscription ends in it, and none ends after it. A company already
    // past its last end date is lapsed, not expiring, so it is not counted.
    prisma.tenant.count({
      where: {
        status: "ACTIVE",
        subscriptions: { some: { endDate: { gt: now, lte: expiringBy } } },
        NOT: { subscriptions: { some: { endDate: { gt: expiringBy } } } },
      },
    }),
  ]);
  const countOf = (status: "ACTIVE" | "SUSPENDED") =>
    byStatus.find((row) => row.status === status)?._count._all ?? 0;
  return {
    items: items.map(publicCompany),
    total,
    page: query.page,
    pageSize: query.pageSize,
    stats: {
      total: byStatus.reduce((sum, row) => sum + row._count._all, 0),
      active: countOf("ACTIVE"),
      suspended: countOf("SUSPENDED"),
      expiringSoon,
    },
  };
}
export async function companyDetail(id: string) {
  const company = await prisma.tenant.findUnique({ where: { id }, select });
  if (!company) throw notFound("Company not found.");
  const invitation = await runAsTenant(id, () =>
    prisma.ownerInvitation.findFirst({
      where: { userId: company.owner?.id ?? "" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { expiresAt: true, acceptedAt: true, revokedAt: true },
    }),
  );
  return {
    ...publicCompany(company),
    invitation: invitation
      ? {
          expiresAt: invitation.expiresAt.toISOString(),
          acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
          revokedAt: invitation.revokedAt?.toISOString() ?? null,
        }
      : null,
  };
}
export async function createCompany(input: CreateCompanyInput, actorId: string) {
  const origin = invitationOrigin();
  const invitation = createRefreshToken();
  // An unknown random credential is not a default password; the account is also
  // disabled until its invitation is accepted. No raw password is retained.
  const passwordHash = await hashPassword(randomBytes(48).toString("base64url"));
  let id: string;
  try {
    id = await runAsPlatform(() =>
      prisma.$transaction(async (tx) => {
        const company = await tx.tenant.create({ data: { name: input.name, slug: input.slug } });
        const owner = await tx.user.create({
          data: {
            tenantId: company.id,
            name: input.ownerName,
            email: input.ownerEmail,
            globalRole: "SUPER_ADMIN",
            disabled: true,
            passwordHash,
          },
        });
        await tx.tenant.update({ where: { id: company.id }, data: { ownerUserId: owner.id } });
        await tx.ownerInvitation.create({
          data: {
            tenantId: company.id,
            userId: owner.id,
            tokenHash: invitation.tokenHash,
            expiresAt: new Date(Date.now() + 48 * 60 * 60_000),
          },
        });
        await tx.auditLog.create({
          data: {
            actorPlatformAdminId: actorId,
            tenantId: company.id,
            action: "company.create",
            targetType: "Tenant",
            targetId: company.id,
          },
        });
        return company.id;
      }),
    );
  } catch (error) {
    rethrowDuplicate(error);
  }
  const invitationDelivery = await deliver(input.ownerEmail, invitation.token, origin);
  return { company: await companyDetail(id), invitationDelivery };
}
export async function resendOwnerInvitation(id: string, actorId: string) {
  const origin = invitationOrigin();
  const token = createRefreshToken();
  const email = await runAsPlatform(() =>
    prisma.$transaction(async (tx) => {
      // Serialize resend/acceptance for this company, avoiding two live invitations.
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM tenants WHERE id = ${id} FOR UPDATE`;
      if (!rows.length) throw notFound("Company not found.");
      const company = await tx.tenant.findUniqueOrThrow({
        where: { id },
        include: { owner: true },
      });
      const owner = company.owner;
      if (!owner?.email || owner.tenantId !== id || !owner.disabled || company.status !== "ACTIVE")
        throw conflict("Only an active company with a pending owner can be invited.");
      if (
        await tx.ownerInvitation.count({
          where: { tenantId: id, userId: owner.id, acceptedAt: { not: null } },
        })
      )
        throw conflict("This owner has already completed onboarding.");
      if (!(await tx.ownerInvitation.count({ where: { tenantId: id, userId: owner.id } })))
        throw conflict("This owner has no pending onboarding invitation.");
      await tx.ownerInvitation.updateMany({
        where: { tenantId: id, userId: owner.id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.ownerInvitation.create({
        data: {
          tenantId: id,
          userId: owner.id,
          tokenHash: token.tokenHash,
          expiresAt: new Date(Date.now() + 48 * 60 * 60_000),
        },
      });
      await tx.auditLog.create({
        data: {
          actorPlatformAdminId: actorId,
          tenantId: id,
          action: "company.owner_invitation.resend",
          targetType: "Tenant",
          targetId: id,
        },
      });
      return owner.email;
    }),
  );
  return {
    company: await companyDetail(id),
    invitationDelivery: await deliver(email, token.token, origin),
  };
}
export async function acceptOwnerInvitation(input: AcceptOwnerInvitationInput) {
  const tokenHash = hashRefreshToken(input.token);
  const invitation = await runAsPlatform(() =>
    prisma.ownerInvitation.findUnique({ where: { tokenHash } }),
  );
  const invalid = () =>
    badRequest(
      "This invitation is invalid, expired or already used.",
      undefined,
      "INVITATION_INVALID",
    );
  if (
    !invitation ||
    invitation.acceptedAt ||
    invitation.revokedAt ||
    invitation.expiresAt <= new Date()
  )
    throw invalid();
  const passwordHash = await hashPassword(input.password);
  await runAsPlatform(() =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${invitation.tenantId} FOR UPDATE`;
      const company = await tx.tenant.findUnique({ where: { id: invitation.tenantId } });
      if (!company || company.ownerUserId !== invitation.userId || company.status !== "ACTIVE")
        throw invalid();
      const claimed = await tx.ownerInvitation.updateMany({
        where: {
          id: invitation.id,
          tokenHash,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw invalid();
      const user = await tx.user.updateMany({
        where: { id: invitation.userId, tenantId: invitation.tenantId, disabled: true },
        data: {
          passwordHash,
          disabled: false,
          disabledAt: null,
          tokenVersion: { increment: 1 },
          twoFactorEnabled: false,
          twoFactorCode: null,
          twoFactorCodeExpiresAt: null,
        },
      });
      if (user.count !== 1) throw invalid();
      await tx.refreshToken.updateMany({
        where: { userId: invitation.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          tenantId: invitation.tenantId,
          action: "company.owner_invitation.accept",
          targetType: "User",
          targetId: invitation.userId,
        },
      });
    }),
  );
  return { success: true as const };
}
