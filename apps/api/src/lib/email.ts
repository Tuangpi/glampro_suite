import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

import { env } from "./env.js";
import { HttpError } from "./http-error.js";
import { logger } from "./logger.js";

/** One message. HTML and text together: no client has to guess. */
export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SendMailResult {
  /** The provider's id, or `null` when the transport does not issue one. */
  messageId: string | null;
}

let cached: Transporter | null = null;

/** True when a real provider is configured (not the development JSON transport). */
export function isSmtpConfigured(): boolean {
  return env.smtp.host !== null;
}

function transport(): Transporter {
  if (cached) return cached;

  if (env.smtp.host) {
    const user = env.smtp.user;
    cached = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      // 465 is implicit TLS; 587 upgrades with STARTTLS. Letting the port decide keeps
      // a half-configured deployment working instead of timing out on a plain socket.
      secure: env.smtp.secure || env.smtp.port === 465,
      auth: user ? { user, pass: env.smtp.password ?? "" } : undefined,
    });
    return cached;
  }

  if (env.isProduction) {
    throw new HttpError(
      503,
      "Email is not configured. Set SMTP_HOST and MAIL_FROM before sending receipts.",
      { code: "EMAIL_NOT_CONFIGURED" },
    );
  }

  cached = nodemailer.createTransport({ jsonTransport: true });
  return cached;
}

/**
 * Sends one message and returns the provider's id.
 *
 * The recipient and subject are logged; the body is not. A provider failure is left to
 * the caller, which knows whether the operation is a resendable receipt or a login step.
 */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const info = await transport().sendMail({
    from: env.mailFrom,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });

  logger.info("Email sent", {
    to: input.to,
    subject: input.subject,
    messageId: info.messageId ?? null,
    transport: env.smtp.host ? "smtp" : "json",
  });

  return { messageId: info.messageId ?? null };
}

/**
 * Sends a one-time two-factor code to a user's email address.
 *
 * With SMTP configured the code never comes back in the response. Without it — the
 * development and test path — the code is logged and returned so the flow can be
 * exercised without a mailbox.
 */
export async function sendTwoFactorCode(
  email: string,
  code: string,
): Promise<{ sent: true; code?: string }> {
  await sendMail({
    to: email,
    subject: "Your Glampro verification code",
    text: `Your Glampro verification code is ${code}. It expires shortly. If you did not try to sign in, ignore this message.`,
    html: [
      "<p>Your Glampro verification code is:</p>",
      `<p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p>`,
      "<p>It expires shortly. If you did not try to sign in, ignore this message.</p>",
    ].join(""),
  });

  if (!isSmtpConfigured()) {
    logger.info(`Two-factor code for ${email}: ${code}`);
    return { sent: true, code };
  }

  return { sent: true };
}
