import { z } from "zod";
import { adminPasswordSchema, twoFactorChallengeSchema } from "./auth.js";
import { emailSchema } from "./common.js";

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
