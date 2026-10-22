import { z } from "zod";

import { AUTH_REALMS, GLOBAL_ROLES, PASSWORD_MIN_LENGTH, TENANT_STATUSES } from "../constants.js";
import { emailSchema } from "./common.js";

export const authRealmSchema = z.enum(AUTH_REALMS);

export const globalRoleSchema = z.enum(GLOBAL_ROLES);

/** Owner credentials: allow passphrases, but reject short and known demo passwords. */
export const adminPasswordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(200)
  .refine(
    (value) =>
      value.trim().length >= 12 &&
      !["admin12345", "password12345", "changeme12345"].includes(value.toLowerCase()),
    "Choose a password that is not a demo or common default.",
  );

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  /** Defaults to the web portal when the caller does not specify a surface. */
  realm: authRealmSchema.default("web"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshInput = z.infer<typeof refreshSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(200),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const authUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: emailSchema,
  globalRole: globalRoleSchema,
  /**
   * The tenant the session belongs to. Optional because the platform console's
   * sessions sit above every tenant and carry no tenant id.
   */
  tenantId: z.string().optional(),
});

export type AuthUser = z.infer<typeof authUserSchema>;

export const tenantStatusSchema = z.enum(TENANT_STATUSES);

export type TenantStatusValue = z.infer<typeof tenantStatusSchema>;

/** The salon a session belongs to, as the client needs to render it. */
export const authTenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: tenantStatusSchema,
});

export type AuthTenant = z.infer<typeof authTenantSchema>;

/**
 * One feature the tenant may use. Core modules have no expiry; an add-on carries
 * the `TenantModule.expiresAt` it was bought with, or null for "never".
 */
export const moduleEntitlementSchema = z.object({
  code: z.string(),
  name: z.string(),
  category: z.string(),
  isCore: z.boolean(),
  expiresAt: z.string().nullable(),
});

export type ModuleEntitlement = z.infer<typeof moduleEntitlementSchema>;

/**
 * `GET /api/auth/me`. The front end receives the tenant's effective entitlements
 * once per session and uses them to hide navigation; the server-side
 * `requireModule` guard remains the boundary, because hidden is not secured.
 */
export const authProfileSchema = z.object({
  user: authUserSchema,
  tenant: authTenantSchema,
  entitlements: z.array(moduleEntitlementSchema),
});

export type AuthProfile = z.infer<typeof authProfileSchema>;

export const authSessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Access-token lifetime in seconds, so the client can schedule a refresh. */
  expiresIn: z.number().int().positive(),
  user: authUserSchema,
});

export type AuthSession = z.infer<typeof authSessionSchema>;

export const twoFactorChallengeSchema = z.object({
  requiresTwoFactor: z.literal(true),
  challenge: z.string().min(32),
});
export type TwoFactorChallenge = z.infer<typeof twoFactorChallengeSchema>;
export const loginResultSchema = z.union([authSessionSchema, twoFactorChallengeSchema]);
export type LoginResult = z.infer<typeof loginResultSchema>;

/** Six-digit numeric one-time code sent by email. */
export const TWO_FACTOR_CODE_LENGTH = 6;

export const twoFactorVerifySchema = z.object({
  email: emailSchema,
  challenge: z.string().min(32).max(128),
  code: z.string().regex(/^\d{6}$/, "Enter the six-digit code."),
});

export type TwoFactorVerifyInput = z.infer<typeof twoFactorVerifySchema>;

export const twoFactorConfirmSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the six-digit code."),
});

export type TwoFactorConfirmInput = z.infer<typeof twoFactorConfirmSchema>;

export const forceSignOutSchema = z.object({
  userId: z.string().min(1),
});

export type ForceSignOutInput = z.infer<typeof forceSignOutSchema>;
