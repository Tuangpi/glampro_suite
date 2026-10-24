import { adminPasswordSchema } from "@glampro_suite/shared";
import { platformLoginSchema } from "@glampro_suite/shared";
import { prisma } from "./lib/prisma.js";
import { hashPassword } from "./lib/password.js";

// Production bootstrap CLI; never run on server startup. Development seeding
// creates its own demo operator separately. Supply secrets through
// a private environment, not command-line arguments or committed dotenv files.
try {
  const input = platformLoginSchema.parse({
    email: process.env.PLATFORM_ADMIN_EMAIL,
    password: process.env.PLATFORM_ADMIN_PASSWORD,
  });
  adminPasswordSchema.parse(input.password);
  if (Buffer.byteLength(input.password, "utf8") > 72)
    throw new Error("Password exceeds bcrypt's 72-byte limit.");
  const name = process.env.PLATFORM_ADMIN_NAME?.trim();
  if (!name || name.length > 120)
    throw new Error("Provide PLATFORM_ADMIN_NAME (1–120 characters).");
  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction(async (tx) => {
    // Serialize concurrent bootstrap attempts; this command creates only the first
    // operator, and never overwrites or re-enables existing accounts.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(26102302)::text`;
    if (await tx.platformAdmin.count())
      throw new Error("Platform already initialized; bootstrap refused.");
    const admin = await tx.platformAdmin.create({
      data: { email: input.email, name, passwordHash },
    });
    await tx.auditLog.create({
      data: {
        actorPlatformAdminId: admin.id,
        action: "platform.bootstrap",
        targetType: "PlatformAdmin",
        targetId: admin.id,
      },
    });
  });
  console.info("First platform administrator created. SMTP verification is required to sign in.");
} catch {
  // Validation errors must not dump supplied secret values.
  console.error(
    "Bootstrap failed. Check private credentials, migration status, and whether initialization already occurred.",
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
