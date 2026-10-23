import { z } from "zod";
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
});
export const platformSessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
  admin: platformAdminSchema,
});
export type PlatformLoginInput = z.infer<typeof platformLoginSchema>;
export type PlatformVerifyInput = z.infer<typeof platformVerifySchema>;
export type PlatformAdminProfile = z.infer<typeof platformAdminSchema>;
export type PlatformAuthSession = z.infer<typeof platformSessionSchema>;
