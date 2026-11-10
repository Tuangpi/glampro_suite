// Administrator-authorized, one-time provisioning against an existing release.
// Credentials must come from root-only systemd EnvironmentFiles, never arguments.
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function provisionPlatformAdmin(
  { prisma, hashPassword, resolveSeedAdmin },
  environment,
) {
  if (environment.NODE_ENV !== "production") throw new Error("Production mode is required.");
  const admin = resolveSeedAdmin({ ...environment, SEED_MODE: "production" });
  const actorEmail = environment.AUTHORIZING_ADMIN_EMAIL?.trim();
  const reason = environment.ADMIN_CREATION_REASON?.trim();
  if (!actorEmail || !reason || reason.length > 2000) {
    throw new Error(
      "An authorizing administrator email and reason (1–2000 characters) are required.",
    );
  }
  const passwordHash = await hashPassword(admin.password);
  return prisma.$transaction(async (tx) => {
    // Share the bootstrap lock so concurrent provisioning cannot race bootstrap.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(26102302)::text`;
    const actor = await tx.platformAdmin.findUnique({ where: { email: actorEmail } });
    if (!actor || actor.status !== "ACTIVE") {
      throw new Error("Authorizing administrator must exist and be active.");
    }
    if (await tx.platformAdmin.findUnique({ where: { email: admin.email } })) {
      throw new Error("Administrator email already exists; no credentials changed.");
    }
    const created = await tx.platformAdmin.create({
      data: {
        email: admin.email,
        name: admin.name,
        passwordHash,
        status: "ACTIVE",
        twoFactorEnabled: true,
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        actorPlatformAdminId: actor.id,
        action: "platform.admin.create",
        targetType: "PlatformAdmin",
        targetId: created.id,
        metadata: { reason, source: "administrator-authorized-vps-command" },
      },
    });
    return created.id;
  });
}

async function main() {
  let prisma;
  try {
    const release = realpathSync(process.argv[2] || "");
    if (!/^\/opt\/glampro_suite\/releases\/v\d+\.\d+\.\d+$/.test(release)) {
      throw new Error("An absolute, versioned production release path is required.");
    }
    const load = (file) => import(pathToFileURL(resolve(release, "apps/api/dist", file)).href);
    const [{ prisma: client }, { hashPassword }, { resolveSeedAdmin }, { runAsPlatform }] =
      await Promise.all([
        load("src/lib/prisma.js"),
        load("src/lib/password.js"),
        load("prisma/seed-security.js"),
        load("src/lib/tenant-context.js"),
      ]);
    prisma = client;
    await runAsPlatform(() =>
      provisionPlatformAdmin({ prisma, hashPassword, resolveSeedAdmin }, process.env),
    );
    console.log("Platform administrator created; email verification remains enabled.");
  } catch {
    // Driver exceptions can contain connection details; never dump them or inputs.
    console.error(
      "Administrator creation failed. Check target, credentials policy, active authorizer, and duplicate email. No automatic retry.",
    );
    process.exitCode = 1;
  } finally {
    if (prisma) await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
