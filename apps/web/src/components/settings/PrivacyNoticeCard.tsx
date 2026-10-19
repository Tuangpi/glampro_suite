import { useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import { useConfigurePrivacyNotice, usePrivacyNotice } from "@/hooks/useConsent";
import { getErrorMessage } from "@/lib/api";

export default function PrivacyNoticeCard({ canEdit }: { canEdit: boolean }) {
  const query = usePrivacyNotice();
  const mutation = useConfigurePrivacyNotice();
  const [version, setVersion] = useState("");
  const [dataText, setDataText] = useState<string | null>(null);
  const [marketingText, setMarketingText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const disabled = !canEdit || mutation.isPending || query.isPending || query.isError;
  async function publish(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await mutation.mutateAsync({
        version,
        dataConsentText: dataText ?? query.data?.dataConsentText ?? "",
        marketingConsentText: marketingText ?? query.data?.marketingConsentText ?? "",
      });
      setVersion("");
      setDataText(null);
      setMarketingText(null);
      setSaved(true);
    } catch (cause) {
      setError(getErrorMessage(cause));
    }
  }
  return (
    <Card
      title="Privacy notice and marketing consent"
      description="Publish your salon's approved wording before recording consent. Published versions cannot be edited or reused."
    >
      {query.isError ? <p role="alert">The privacy notice could not be loaded.</p> : null}
      <p className="mb-3 text-sm">
        {query.data
          ? `Current version: ${query.data.version}`
          : query.isPending
            ? "Loading notice…"
            : "No notice configured. Consent capture is disabled."}
      </p>
      <form onSubmit={publish} className="flex flex-col gap-3">
        <Input
          label="New notice version"
          value={version}
          onChange={(event) => setVersion(event.target.value)}
          maxLength={100}
          required
          disabled={disabled}
        />
        <label className="flex flex-col gap-1 text-sm">
          Personal-data consent notice
          <textarea
            className="min-h-32 rounded-md border border-line p-3"
            value={dataText ?? query.data?.dataConsentText ?? ""}
            onChange={(event) => setDataText(event.target.value)}
            required
            maxLength={10000}
            disabled={disabled}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Optional marketing consent notice
          <textarea
            className="min-h-32 rounded-md border border-line p-3"
            value={marketingText ?? query.data?.marketingConsentText ?? ""}
            onChange={(event) => setMarketingText(event.target.value)}
            required
            maxLength={10000}
            disabled={disabled}
          />
        </label>
        <p className="text-xs text-ink-muted">
          Use wording approved for your salon, including purposes and how customers withdraw
          consent. Publishing does not opt anyone in or prove legal compliance. Evidence is retained
          with the customer record; no automatic purge is configured.
        </p>
        {error ? (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        ) : null}
        {saved ? <p role="status">Privacy notice published.</p> : null}
        <Button type="submit" disabled={disabled}>
          Publish privacy notice
        </Button>
      </form>
    </Card>
  );
}
