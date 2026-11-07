/**
 * What can be done with a record the customer has no login for: mint a bearer
 * link, revoke it, or send the receipt down a channel the salon pays for.
 *
 * The channel buttons are drawn from the salon's own settings, not from the
 * component's imagination: a channel that is off refuses at the server
 * (`queueReceipt` → "This channel is disabled."), so offering the button would
 * promise a send that cannot happen. When a channel is off the dialog says so and
 * says where to change it — a missing button with no reason is a support call.
 *
 * A receipt can only be messaged to a customer on file, so `canMessage` lets the
 * caller say that before the click; `unknown` leaves the decision to the server,
 * which is where the authoritative check lives either way.
 */
import { useState } from "react";

import Button from "@/components/ui/Button";
import { useAuth } from "@/contexts/AuthContext";
import { useMessagingSettings, useMessagingCapabilities } from "@/hooks/useMessaging";
import { post, del, getErrorMessage } from "@/lib/api";

/** The two channels the API's `messageChannelSchema` accepts, in offer order. */
const CHANNELS = ["WHATSAPP", "SMS"] as const;
type Channel = (typeof CHANNELS)[number];

const CHANNEL_LABEL: Record<Channel, string> = { WHATSAPP: "WhatsApp", SMS: "SMS" };
/** Which settings field switches each channel on (`messagingSettingsSchema`). */
const CHANNEL_ENABLED_KEY: Record<Channel, "whatsappEnabled" | "smsEnabled"> = {
  WHATSAPP: "whatsappEnabled",
  SMS: "smsEnabled",
};

export interface SecureLinkActionsProps {
  resource: "sales" | "appointments";
  id: string;
  /** Sending a receipt is a different act from sharing a booking link. */
  receipt?: boolean;
  /**
   * Whether the record may be messaged at all — a receipt needs a saved customer.
   * `undefined` means "the caller does not know", which is not the same as "no".
   */
  canMessage?: boolean;
  /** Why messaging is unavailable, in the customer's terms. */
  messageBlockedReason?: string;
}

export default function SecureLinkActions({
  resource,
  id,
  receipt = false,
  canMessage,
  messageBlockedReason = "Save the customer on this record first — a message needs somewhere to go.",
}: SecureLinkActionsProps) {
  const { isReadOnly } = useAuth();
  const settings = useMessagingSettings();
  const capabilities = useMessagingCapabilities();
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (cause) {
      setMessage(getErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  const base = `/messaging/${resource}/${id}`;
  return (
    <section
      className="space-y-2 print:hidden"
      aria-label={receipt ? "Secure receipt sharing" : "Customer booking actions"}
    >
      <Button
        type="button"
        disabled={busy || isReadOnly}
        onClick={() =>
          void act(async () => {
            const result = await post<{ url: string }>(`${base}/link`);
            setUrl(result.url);
          })
        }
      >
        Create secure {receipt ? "receipt" : "booking"} link
      </Button>
      <Button
        type="button"
        disabled={busy || isReadOnly}
        onClick={() =>
          void act(async () => {
            if (!window.confirm("Revoke all existing links for this record?")) return;
            await del(`${base}/link`);
            setUrl("");
            setMessage("Links revoked.");
          })
        }
      >
        Revoke existing links
      </Button>
      {url ? (
        <>
          <label>
            Anyone with this link can{" "}
            {receipt ? "view the receipt" : "confirm or cancel this booking"}.
            <input
              className="block w-full border p-2"
              aria-label="Secure sharing link"
              readOnly
              value={url}
            />
          </label>
          <Button
            type="button"
            onClick={() =>
              void act(async () => {
                await navigator.clipboard.writeText(url);
                setMessage("Link copied.");
              })
            }
          >
            Copy secure link
          </Button>
        </>
      ) : null}
      {receipt && (capabilities.data?.whatsappAvailable || capabilities.data?.smsAvailable) ? (
        <div className="space-y-2 border-t border-line-soft pt-3">
          <h3 className="text-sm font-bold text-ink">Send this receipt</h3>
          {canMessage === false ? (
            <p className="text-sm text-ink-muted">{messageBlockedReason}</p>
          ) : settings.isPending ? (
            <p className="text-sm text-ink-muted">Checking which channels are on…</p>
          ) : settings.isError ? (
            <p role="alert" className="text-sm text-danger">
              Channel settings could not be loaded, so nothing can be sent from here.
            </p>
          ) : (
            <>
              {CHANNELS.map((channel) =>
                !(channel === "SMS"
                  ? capabilities.data?.smsAvailable
                  : capabilities.data?.whatsappAvailable) ? null : settings.data[
                    CHANNEL_ENABLED_KEY[channel]
                  ] ? (
                  <Button
                    key={channel}
                    type="button"
                    disabled={busy || isReadOnly}
                    onClick={() =>
                      void act(async () => {
                        const result = await post<{ status: string }>(`${base}/send`, { channel });
                        setMessage(
                          `Receipt message status: ${result.status}. Queued does not mean delivered.`,
                        );
                      })
                    }
                  >
                    Send receipt by {CHANNEL_LABEL[channel]}
                  </Button>
                ) : (
                  <p key={channel} className="text-sm text-ink-muted">
                    {CHANNEL_LABEL[channel]} is off. Turn it on in Settings → Messages.
                  </p>
                ),
              )}
              <p className="text-xs text-ink-muted">
                The customer must have agreed to messages, and quiet hours still apply.
              </p>
            </>
          )}
        </div>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
