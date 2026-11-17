import { z } from "zod";
import { adminPasswordSchema, twoFactorChallengeSchema } from "./auth.js";
import { emailSchema, paginationQuerySchema, searchQuerySchema } from "./common.js";

export const createPlatformAdminSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().pipe(emailSchema),
    password: adminPasswordSchema.refine(
      (value) => new TextEncoder().encode(value).length <= 72,
      "Password must be at most 72 UTF-8 bytes.",
    ),
    reason: z.string().trim().min(1, "Enter a reason for granting platform access.").max(2000),
  })
  .strict();

export const platformAdminListQuerySchema = paginationQuerySchema.extend(searchQuerySchema.shape);
export const platformAdminDirectoryEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  email: emailSchema,
  status: z.enum(["ACTIVE", "DISABLED"]),
  twoFactorEnabled: z.boolean(),
  createdAt: z.iso.datetime(),
  lastLoginAt: z.iso.datetime().nullable(),
});
export const platformAdminListSchema = z.object({
  items: z.array(platformAdminDirectoryEntrySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type CreatePlatformAdminInput = z.infer<typeof createPlatformAdminSchema>;
export type PlatformAdminListQuery = z.infer<typeof platformAdminListQuerySchema>;
export type PlatformAdminDirectoryEntry = z.infer<typeof platformAdminDirectoryEntrySchema>;
export type PlatformAdminList = z.infer<typeof platformAdminListSchema>;

export const platformLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export const platformVerifySchema = z.object({
  challenge: z.string().min(32).max(128),
  code: z.string().regex(/^\d{6}$/, "Enter the six-digit code."),
});
export const platformAdminSchema = z.object({
  id: z.string(),
  email: emailSchema,
  name: z.string(),
  /**
   * Email verification on sign-in. Always true for a new operator; an operator
   * may turn it off from Account & security, and the salon portal can never.
   */
  twoFactorEnabled: z.boolean(),
});
export const platformSessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
  admin: platformAdminSchema,
});
/**
 * Sign-in answers with a complete session when the operator turned email
 * verification off, and with a challenge when it is on. The union mirrors the
 * salon portal's `loginResultSchema` so both surfaces parse the same two shapes.
 */
export const platformLoginResultSchema = z.union([platformSessionSchema, twoFactorChallengeSchema]);
/** Operator password change. The new password follows the owner-strength rules. */
export const platformPasswordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: adminPasswordSchema,
  })
  .strict();
/** Turning email verification off re-proves the password that guards it. */
export const platformTwoFactorDisableSchema = z
  .object({ currentPassword: z.string().min(1).max(200) })
  .strict();
/**
 * Password change result. `revokedSessions` lets the console say what happened to
 * the operator's other sessions instead of guessing.
 */
export const platformPasswordChangeResultSchema = z.object({
  success: z.literal(true),
  revokedSessions: z.number().int().nonnegative(),
});
export type PlatformLoginInput = z.infer<typeof platformLoginSchema>;
export type PlatformVerifyInput = z.infer<typeof platformVerifySchema>;
export type PlatformAdminProfile = z.infer<typeof platformAdminSchema>;
export type PlatformAuthSession = z.infer<typeof platformSessionSchema>;
export type PlatformLoginResult = z.infer<typeof platformLoginResultSchema>;
export type PlatformPasswordChangeInput = z.infer<typeof platformPasswordChangeSchema>;
export type PlatformPasswordChangeResult = z.infer<typeof platformPasswordChangeResultSchema>;
export type PlatformTwoFactorDisableInput = z.infer<typeof platformTwoFactorDisableSchema>;
