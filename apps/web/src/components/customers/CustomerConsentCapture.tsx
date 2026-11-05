/**
 * Consent choices captured while a customer is being created.
 *
 * The edit drawer can save consent on its own because the customer already
 * exists; here nothing can be recorded until the record is created, so this is
 * a controlled block with no button of its own — the drawer's submit carries
 * these values into a second request after `POST /customers` returns an id.
 *
 * It deliberately mirrors `CustomerConsentPanel`: same heading, same labels,
 * same rule that marketing cannot be ticked without data consent. A new record
 * has no previous choice, so both boxes start unchecked and nothing is assumed.
 */
import type { PrivacyNotice } from "@glampro_suite/shared";
import Checkbox from "@/components/ui/Checkbox";

export interface ConsentCaptureValue {
  pdpaConsent: boolean;
  marketingOptIn: boolean;
  /** Staff confirmation that the notice was presented — required before a grant. */
  reviewed: boolean;
}

export interface CustomerConsentCaptureProps {
  notice: PrivacyNotice | null;
  value: ConsentCaptureValue;
  onChange: (next: ConsentCaptureValue) => void;
  /** While the notice is still being read, so "not published" is never guessed. */
  isLoading?: boolean;
  disabled?: boolean;
}

export default function CustomerConsentCapture({
  notice,
  value,
  onChange,
  isLoading = false,
  disabled = false,
}: CustomerConsentCaptureProps) {
  const blocked = disabled || notice === null;
  const granting = value.pdpaConsent || value.marketingOptIn;

  return (
    <section
      className="flex flex-col gap-3 rounded-card border border-line p-3"
      aria-label="Customer consent"
    >
      <h3 className="font-bold">Privacy and marketing choices</h3>

      {isLoading ? (
        <p className="text-sm text-ink-muted">Checking the privacy notice…</p>
      ) : notice ? (
        <div className="space-y-2 text-sm">
          <p className="font-bold">Notice version: {notice.version}</p>
          <p className="whitespace-pre-wrap">{notice.dataConsentText}</p>
          <p className="whitespace-pre-wrap">{notice.marketingConsentText}</p>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">
          Consent capture is disabled until a manager publishes a privacy notice in Settings. This
          customer will be saved with no consent on record.
        </p>
      )}

      <Checkbox
        label="Personal-data consent granted"
        checked={value.pdpaConsent}
        disabled={blocked || isLoading}
        onChange={(event) => {
          // The API refuses marketing without data consent, so the tick is
          // dropped here rather than rejected after the round trip.
          onChange({
            ...value,
            pdpaConsent: event.target.checked,
            marketingOptIn: event.target.checked ? value.marketingOptIn : false,
          });
        }}
      />
      <Checkbox
        label="Optional marketing opt-in"
        checked={value.marketingOptIn}
        disabled={blocked || isLoading || !value.pdpaConsent}
        onChange={(event) => onChange({ ...value, marketingOptIn: event.target.checked })}
        hint="Do not select without the customer's explicit choice. Receipts do not require marketing opt-in."
      />
      {granting ? (
        <Checkbox
          label="I presented this notice and recorded the customer's choices"
          checked={value.reviewed}
          disabled={disabled || isLoading}
          onChange={(event) => onChange({ ...value, reviewed: event.target.checked })}
        />
      ) : null}
    </section>
  );
}
