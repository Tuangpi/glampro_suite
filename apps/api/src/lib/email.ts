import { env } from "./env.js";
import { logger } from "./logger.js";

/**
 * Sends a one-time two-factor code to a user's email address.
 *
 * In development and test there is no SMTP provider configured, so the code is
 * written to the log (and returned) so the flow can be exercised end-to-end.
 * In production this must be wired to a real mail provider before 2FA is enabled
 * for any owner, otherwise users would be locked out.
 */
export async function sendTwoFactorCode(
  email: string,
  code: string,
): Promise<{ sent: true; code?: string }> {
  if (env.isProduction) {
    throw new Error(
      "Two-factor email sending is not configured in production. Set up an SMTP provider before enabling 2FA.",
    );
  }

  // Dev/test: log the code so it can be retrieved for testing, and return it so
  // integration tests can read it directly without parsing logs.
  logger.info(`Two-factor code for ${email}: ${code}`);
  return { sent: true, code };
}
