import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChannelConsentInput, MessagingSettingsInput } from "@glampro_suite/shared";
import { get, post, getErrorMessage } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import Checkbox from "@/components/ui/Checkbox";
import Button from "@/components/ui/Button";

interface Choice {
  channel: "WHATSAPP" | "SMS";
  service: boolean;
  marketing: boolean;
  preferred: boolean;
  revision: number;
  destination: string;
}
interface Data {
  choices: Choice[];
  settings: MessagingSettingsInput;
}
export default function ChannelConsentPanel({ customerId }: { customerId: string }) {
  const { tenant } = useAuth();
  const query = useQuery({
    queryKey: ["channel-consent", tenant?.id, customerId],
    queryFn: () => get<Data>(`/messaging/customers/${customerId}`),
  });
  return (
    <section className="border p-3 space-y-3" aria-label="Messaging consent">
      <h3>WhatsApp / SMS choices</h3>
      <p>
        Save phone changes first. Use an international number starting with +. No permission is
        inherited when the number changes.
      </p>
      {query.isError ? (
        <p role="alert">Channel choices could not be loaded.</p>
      ) : query.data ? (
        <>
          <p>Notice {query.data.settings.consentVersion || "not configured"}</p>
          <p className="whitespace-pre-wrap">{query.data.settings.serviceConsentText}</p>
          <p className="whitespace-pre-wrap">{query.data.settings.marketingConsentText}</p>
          {(["WHATSAPP", "SMS"] as const).map((channel) => (
            <Editor
              key={`${channel}-${JSON.stringify(query.data)}`}
              customerId={customerId}
              channel={channel}
              choice={query.data!.choices.find((v) => v.channel === channel)}
              version={query.data!.settings.consentVersion}
            />
          ))}
        </>
      ) : (
        <p>Loading channel choices…</p>
      )}
    </section>
  );
}
function Editor({
  customerId,
  channel,
  choice,
  version,
}: {
  customerId: string;
  channel: "WHATSAPP" | "SMS";
  choice?: Choice;
  version: string;
}) {
  const { isReadOnly } = useAuth();
  const client = useQueryClient();
  const [draft, setDraft] = useState<ChannelConsentInput>({
    channel,
    service: choice?.service ?? false,
    marketing: choice?.marketing ?? false,
    preferred: choice?.preferred ?? false,
    expectedRevision: choice?.revision ?? 0,
    noticeVersion: version,
    presented: false,
  });
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: () => post(`/messaging/customers/${customerId}`, draft),
    onSuccess: () => client.invalidateQueries({ queryKey: ["channel-consent"] }),
    onError: (cause) => setError(getErrorMessage(cause)),
  });
  return (
    <fieldset disabled={isReadOnly || mutation.isPending} className="space-y-2 border p-2">
      <legend>{channel}</legend>
      <p>Recorded destination: {choice?.destination || "None"}</p>
      {(
        [
          ["service", "Appointment updates and requested receipts"],
          ["marketing", "Optional rebooking/marketing"],
          ["preferred", "Preferred automatic messaging channel"],
          [
            "presented",
            "I presented the current wording and recorded the customer's explicit choice",
          ],
        ] as const
      ).map(([key, label]) => (
        <Checkbox
          key={key}
          label={`${channel}: ${label}`}
          checked={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })}
        />
      ))}
      <Button
        type="button"
        disabled={(draft.service || draft.marketing) && (!draft.presented || !version)}
        onClick={() => mutation.mutate()}
      >
        Save {channel} choices
      </Button>
      {error ? <p role="alert">{error}</p> : null}
    </fieldset>
  );
}
