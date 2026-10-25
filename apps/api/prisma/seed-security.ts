import { adminPasswordSchema } from "@glampro_suite/shared";

/** Validate before any seed writes. Never print supplied credentials. */
export function resolveSeedAdmin(environment: NodeJS.ProcessEnv) {
  const production =
    environment.SEED_MODE === "production" || environment.NODE_ENV === "production";
  if (production) {
    const email = environment.ADMIN_EMAIL?.trim();
    if (
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      /@(?:glampro\.test|example\.(?:com|org)|.*\.test)$/i.test(email) ||
      ["superadmin@gmail.com", "admin@gmail.com"].includes(email.toLowerCase())
    ) {
      throw new Error("Production seeding requires an explicit, non-demo ADMIN_EMAIL.");
    }
    if (!adminPasswordSchema.safeParse(environment.ADMIN_PASSWORD).success) {
      throw new Error(
        "Production seeding requires a non-default ADMIN_PASSWORD of at least 12 characters.",
      );
    }
    if (Buffer.byteLength(environment.ADMIN_PASSWORD!, "utf8") > 72) {
      throw new Error("ADMIN_PASSWORD exceeds bcrypt's 72-byte limit.");
    }
    const name = environment.ADMIN_NAME?.trim() || "Glampro Administrator";
    if (name.length > 120) throw new Error("ADMIN_NAME must not exceed 120 characters.");
    return {
      email,
      name,
      password: environment.ADMIN_PASSWORD!,
    };
  }
  return {
    email: environment.ADMIN_EMAIL ?? "admin@gmail.com",
    name: environment.ADMIN_NAME ?? "Glampro Administrator",
    password: environment.ADMIN_PASSWORD ?? "admin12345",
    globalRole: "SUPER_ADMIN" as const,
  };
}
