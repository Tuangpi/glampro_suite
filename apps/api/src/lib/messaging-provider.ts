import twilio from "twilio";
import { HttpError } from "./http-error.js";

export type Channel = "WHATSAPP" | "SMS";
export type MessageKind = "CONFIRMATION" | "REMINDER" | "REBOOKING" | "RECEIPT";
export interface SenderConfig {
  accountSid: string;
  authToken: string;
  smsFrom?: string;
  whatsappFrom?: string;
  templates?: Partial<Record<MessageKind, string>>;
}

// Operator-managed secrets: never exposed through the settings API or stored in jobs.
export function senderConfig(tenantId: string): SenderConfig | null {
  const all: unknown = JSON.parse(process.env.MESSAGING_TENANTS_JSON || "{}");
  if (!all || typeof all !== "object") return null;
  const value = (all as Record<string, SenderConfig>)[tenantId];
  return value?.accountSid && value.authToken ? value : null;
}

export function publicOrigin(): string {
  const value = process.env.MESSAGING_PUBLIC_ORIGIN || "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(503, "Configure a public HTTPS messaging origin.", {
      code: "MESSAGING_NOT_CONFIGURED",
    });
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && url.hostname === "localhost"))
  ) {
    throw new HttpError(503, "Configure a public HTTPS messaging origin.", {
      code: "MESSAGING_NOT_CONFIGURED",
    });
  }
  return url.origin;
}

export interface ProviderInput {
  config: SenderConfig;
  channel: Channel;
  kind: MessageKind;
  destination: string;
  text: string;
  variables: Record<string, string>;
  callback: string;
}

export function assertSender(config: SenderConfig | null, channel: Channel, kind: MessageKind) {
  if (
    !config ||
    (channel === "SMS" ? !config.smsFrom : !config.whatsappFrom || !config.templates?.[kind])
  ) {
    throw new HttpError(503, "Configure this channel's sender and template first.", {
      code: "MESSAGING_NOT_CONFIGURED",
    });
  }
}

export async function sendProvider(input: ProviderInput): Promise<string> {
  assertSender(input.config, input.channel, input.kind);
  const client = twilio(input.config.accountSid, input.config.authToken, {
    autoRetry: false,
    timeout: 15000,
  });
  const message = await client.messages.create({
    to: input.channel === "WHATSAPP" ? `whatsapp:${input.destination}` : input.destination,
    from: input.channel === "WHATSAPP" ? input.config.whatsappFrom : input.config.smsFrom,
    statusCallback: input.callback,
    ...(input.channel === "WHATSAPP"
      ? {
          contentSid: input.config.templates?.[input.kind],
          contentVariables: JSON.stringify(input.variables),
        }
      : { body: input.text }),
  });
  return message.sid;
}

export function verifyWebhook(
  tenantId: string,
  signature: string,
  path: string,
  body: Record<string, string>,
) {
  const config = senderConfig(tenantId);
  return (
    !!config &&
    body.AccountSid === config.accountSid &&
    twilio.validateRequest(config.authToken, signature, `${publicOrigin()}${path}`, body)
  );
}
