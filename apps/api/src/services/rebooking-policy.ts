/** Shared by assistant previews and automatic jobs. No reads, writes or delivery. */
export const REBOOKING_CONTACT_STATUSES = [
  "PENDING",
  "RETRY",
  "SENDING",
  "ACCEPTED",
  "SENT",
  "DELIVERED",
  "READ",
  "UNDELIVERED",
  "UNCERTAIN",
];

export function rebookingInterval(service: number | null | undefined, company = 28): number {
  return service ?? company;
}

export function rebookingChannel(
  customer: {
    archivedAt: Date | null;
    pdpaConsent: boolean;
    marketingOptIn: boolean;
    phone: string | null;
  },
  choices: Array<{ channel: string; destination: string; marketing: boolean; preferred: boolean }>,
  settings: { smsEnabled: boolean; whatsappEnabled: boolean },
): { channel: "SMS" | "WHATSAPP"; destination: string } | null {
  const phone = customer.phone?.replace(/[\s().-]/g, "") ?? "";
  if (
    customer.archivedAt ||
    !customer.pdpaConsent ||
    !customer.marketingOptIn ||
    !/^\+[1-9]\d{7,14}$/.test(phone)
  )
    return null;
  const preferred = choices.filter((choice) => choice.preferred);
  if (preferred.length !== 1) return null;
  const choice = preferred[0]!;
  if (!choice.marketing || choice.destination !== phone) return null;
  if (choice.channel === "SMS" && settings.smsEnabled)
    return { channel: "SMS", destination: phone };
  if (choice.channel === "WHATSAPP" && settings.whatsappEnabled)
    return { channel: "WHATSAPP", destination: phone };
  return null;
}
