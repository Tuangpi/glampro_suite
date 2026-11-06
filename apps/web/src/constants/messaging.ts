/**
 * Message vocabulary — the words the settings form and the delivery history
 * share.
 *
 * Same reason `constants/appointments.ts` exists: a status cell, a badge tone
 * and a settings sentence must not each invent a name for `SUPPRESSED`. The
 * values are the strings the worker writes (`MessageJob.status`,
 * `MessageJob.errorCode`), which are `String` columns rather than enums, so the
 * lookups below fall back to the raw code instead of hiding a value a future
 * worker starts writing. See `apps/api/src/services/message-worker.ts`.
 */
import type { BadgeVariant } from "@/components/ui/Badge";

export const MESSAGE_KIND_LABELS = {
  CONFIRMATION: "Booking confirmation",
  REMINDER: "Appointment reminder",
  REBOOKING: "Rebooking prompt",
  RECEIPT: "Receipt link",
} as const;

export type MessageKindValue = keyof typeof MESSAGE_KIND_LABELS;

export function messageKindLabel(kind: string): string {
  return MESSAGE_KIND_LABELS[kind as MessageKindValue] ?? "Message";
}

/**
 * Delivery states, in the order a message moves through them. `SUPPRESSED` is
 * the worker's "we decided not to send", so its label says so rather than
 * reading as a failure — the reason line underneath carries the why.
 */
export const MESSAGE_STATUS_LABELS = {
  PENDING: "Queued",
  RETRY: "Retrying",
  SENDING: "Sending",
  ACCEPTED: "Accepted",
  SENT: "Sent",
  DELIVERED: "Delivered",
  READ: "Read",
  UNDELIVERED: "Not delivered",
  FAILED: "Failed",
  SUPPRESSED: "Not sent",
  UNCERTAIN: "Unconfirmed",
} as const;

export type MessageStatusValue = keyof typeof MESSAGE_STATUS_LABELS;

export const MESSAGE_STATUS_BADGE: Record<MessageStatusValue, BadgeVariant> = {
  PENDING: "neutral",
  RETRY: "warning",
  SENDING: "warning",
  ACCEPTED: "purple",
  SENT: "success",
  DELIVERED: "success",
  READ: "success",
  UNDELIVERED: "danger",
  FAILED: "danger",
  SUPPRESSED: "neutral",
  UNCERTAIN: "warning",
};

export function messageStatusLabel(status: string): string {
  return MESSAGE_STATUS_LABELS[status as MessageStatusValue] ?? "Unknown";
}

export function messageStatusBadge(status: string): BadgeVariant {
  return MESSAGE_STATUS_BADGE[status as MessageStatusValue] ?? "neutral";
}

/**
 * Why a message was not sent. The keys are the worker's `suppress()` reasons
 * plus the provider codes an operator is most likely to see; anything else is
 * shown as its raw code so a new reason is visible rather than swallowed.
 */
export const MESSAGE_REASON_LABELS: Record<string, string> = {
  TENANT_INELIGIBLE: "The salon cannot send messages right now.",
  CUSTOMER_INELIGIBLE: "This customer cannot be messaged.",
  CONSENT_REQUIRED: "No consent on file for this channel.",
  CHANNEL_DISABLED: "The channel is switched off.",
  BOOKING_CHANGED: "The booking changed before it went out.",
  LATER_VISIT: "The customer already has a later visit booked.",
  ALREADY_REBOOKED: "The customer already rebooked.",
  CONTACT_LIMIT: "Too many messages went out recently.",
  QUIET_HOURS_MISSED: "Quiet hours pushed it past the appointment.",
  ASSISTANT_DRAFT_CHANGED: "The approved draft changed.",
  ASSISTANT_UNSUBSCRIBE_CHANGED: "The customer's unsubscribe choice changed.",
  ASSISTANT_AUTHORIZATION_CHANGED: "The draft's approval changed.",
  ASSISTANT_INTERVAL_CHANGED: "The rebooking interval changed.",
  ASSISTANT_SENDER_CHANGED: "The sender configuration changed.",
  SALE_CHANGED: "The sale changed before the receipt went out.",
  OPTED_OUT: "The customer opted out.",
  "21610": "The customer replied STOP.",
};

export function messageReasonLabel(code: string | null): string {
  if (!code) return "";
  return MESSAGE_REASON_LABELS[code] ?? code;
}

/** A job stores no channel until delivery is attempted; then it is a choice. */
export function messageChannelLabel(channel: string | null): string {
  if (channel === "WHATSAPP") return "WhatsApp";
  if (channel === "SMS") return "SMS";
  return "Customer's choice";
}

const pad = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/** The quiet-hours pickers, 00:00–23:00 — the same range the schema allows. */
export const QUIET_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: pad(hour),
}));

/**
 * One sentence saying what the two quiet-hour picks add up to. The window wraps
 * past midnight whenever the end is earlier than the start (`20 → 9`), which is
 * the normal case and the one a pair of bare integers never explains.
 */
export function quietHoursSummary(start: number, end: number): string {
  if (start === end) return "Choose two different hours.";
  const from = pad(start);
  const to = pad(end);
  return start < end
    ? `Nothing sends between ${from} and ${to}. Anything due then waits until ${to}.`
    : `Nothing sends between ${from} and ${to} the next morning. Anything due then waits until ${to}.`;
}

/**
 * The badge on the settings card. Worded as which channels are switched on,
 * not as "sending is working": a channel can be on while the platform has no
 * sender for this salon yet, and the card must not claim otherwise.
 */
export function channelStatus(
  whatsappEnabled: boolean,
  smsEnabled: boolean,
): {
  label: string;
  variant: BadgeVariant;
} {
  if (whatsappEnabled && smsEnabled) return { label: "WhatsApp + SMS", variant: "success" };
  if (whatsappEnabled) return { label: "WhatsApp", variant: "purple" };
  if (smsEnabled) return { label: "SMS", variant: "purple" };
  return { label: "Off", variant: "neutral" };
}
