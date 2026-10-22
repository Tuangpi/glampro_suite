import "dotenv/config";

/**
 * Environment access.
 *
 * `DATABASE_URL` and `JWT_SECRET` are required: booting without them would
 * produce a running-but-broken API, so the process fails fast instead.
 * Everything else has a development-safe default.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. Copy apps/api/.env.example to apps/api/.env (or set it in .env.docker) and try again.`,
    );
  }
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function csv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export const nodeEnv = process.env.NODE_ENV ?? "development";
export const isProduction = nodeEnv === "production";
export const isTest = nodeEnv === "test";

export const env = {
  nodeEnv,
  isProduction,
  isTest,
  port: optionalNumber("PORT", 9000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  /** Defaults to the access secret + "-refresh" so single-secret setups still work. */
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? `${process.env.JWT_SECRET}-refresh`,
  corsOrigins: csv("CORS_ORIGINS", ["http://localhost:5173"]),
  logLevel: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  /** Absolute or repo-relative directory for user uploads. */
  uploadsDir: process.env.UPLOADS_DIR ?? "uploads",
  /**
   * Outbound mail (2FA codes and emailed receipts, TK2610-0010).
   *
   * `host` being unset is the development/test path: `lib/email.ts` keeps the
   * message off the network without logging its body. In production the same absence is
   * refused rather than silently dropping a customer's receipt.
   */
  smtp: {
    host: process.env.SMTP_HOST?.trim() || null,
    port: optionalNumber("SMTP_PORT", 587),
    /** Implicit TLS (usually port 465). Port 587 upgrades with STARTTLS instead. */
    secure: (process.env.SMTP_SECURE ?? "").trim().toLowerCase() === "true",
    user: process.env.SMTP_USER?.trim() || null,
    password: process.env.SMTP_PASSWORD ?? null,
  },
  /** The `From:` on every message. Override in production with a real mailbox. */
  mailFrom: process.env.MAIL_FROM?.trim() || "Glampro Suite <no-reply@glampro.local>",
} as const;
