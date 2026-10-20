import { useState } from "react";
import { post, del, getErrorMessage } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import Button from "@/components/ui/Button";

export default function SecureLinkActions({
  resource,
  id,
  receipt = false,
}: {
  resource: "sales" | "appointments";
  id: string;
  receipt?: boolean;
}) {
  const { isReadOnly } = useAuth();
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
      {receipt
        ? (["WHATSAPP", "SMS"] as const).map((channel) => (
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
              Send receipt by {channel === "WHATSAPP" ? "WhatsApp" : "SMS"}
            </Button>
          ))
        : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
