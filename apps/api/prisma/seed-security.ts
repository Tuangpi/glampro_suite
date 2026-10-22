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
    return {
      email,
      name: environment.ADMIN_NAME?.trim() || "Glampro Administrator",
      password: environment.ADMIN_PASSWORD!,
      globalRole: "SUPER_ADMIN" as const,
    };
  }
  return {
    email: environment.ADMIN_EMAIL ?? "superadmin@gmail.com",
    name: environment.ADMIN_NAME ?? "Glampro Administrator",
    password: environment.ADMIN_PASSWORD ?? "admin12345",
    globalRole: "SUPER_ADMIN" as const,
  };
}
