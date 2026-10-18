import { z } from "zod";

import { AUTH_REALMS, GLOBAL_ROLES, PASSWORD_MIN_LENGTH, TENANT_STATUSES } from "../constants.js";
import { emailSchema } from "./common.js";

export const authRealmSchema = z.enum(AUTH_REALMS);

export const globalRoleSchema = z.enum(GLOBAL_ROLES);

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

/** Six-digit numeric one-time code sent by email. */
export const TWO_FACTOR_CODE_LENGTH = 6;

export const twoFactorVerifySchema = z.object({
  email: emailSchema,
  code: z.string().length(TWO_FACTOR_CODE_LENGTH),
});

export type TwoFactorVerifyInput = z.infer<typeof twoFactorVerifySchema>;

export const twoFactorConfirmSchema = z.object({
  code: z.string().length(TWO_FACTOR_CODE_LENGTH),
});

export type TwoFactorConfirmInput = z.infer<typeof twoFactorConfirmSchema>;

export const forceSignOutSchema = z.object({
  userId: z.string().min(1),
});

export type ForceSignOutInput = z.infer<typeof forceSignOutSchema>;
