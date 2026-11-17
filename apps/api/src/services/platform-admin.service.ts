import {
  createPlatformAdminSchema,
  type CreatePlatformAdminInput,
  type PlatformAdminListQuery,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { conflict, unauthorized } from "../lib/http-error.js";
import { hashPassword } from "../lib/password.js";

// Explicit projection: never expose hashes, verification challenges, or session data.
const select = {
  id: true,
  name: true,
  email: true,
  status: true,
  twoFactorEnabled: true,
  createdAt: true,
  lastLoginAt: true,
} as const;

export async function listPlatformAdmins(query: PlatformAdminListQuery) {
  const where = query.search
    ? {
        OR: [
          { name: { contains: query.search, mode: "insensitive" as const } },
          { email: { contains: query.search, mode: "insensitive" as const } },
        ],
      }
    : {};
  const [items, total] = await prisma.$transaction([
    prisma.platformAdmin.findMany({
      where,
      select,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.platformAdmin.count({ where }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function createPlatformAdmin(actorId: string, input: CreatePlatformAdminInput) {
  const { name, email, password, reason } = createPlatformAdminSchema.parse(input);
  const passwordHash = await hashPassword(password);
  try {
    return await prisma.$transaction(async (tx) => {
      // Shared with bootstrap: serialize account creation and case-insensitive checks.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(26102302)::text`;
      const actor = await tx.platformAdmin.findUnique({
        where: { id: actorId },
        select: { status: true },
      });
      if (!actor || actor.status !== "ACTIVE") throw unauthorized();
      const duplicate = await tx.platformAdmin.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true },
      });
      if (duplicate) throw conflict("A platform admin with this email already exists.");
      const admin = await tx.platformAdmin.create({
        data: { name, email, passwordHash, status: "ACTIVE", twoFactorEnabled: true },
        select,
      });
      await tx.auditLog.create({
        data: {
          actorPlatformAdminId: actorId,
          action: "platform.admin.create",
          targetType: "PlatformAdmin",
          targetId: admin.id,
          metadata: { reason, source: "platform-console" },
        },
      });
      return admin;
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")
      throw conflict("A platform admin with this email already exists.");
    throw error;
  }
}
