/**
 * The messaging settings sheet.
 *
 * Three questions, in the order an operator answers them: which channels are
 * on, when a message may go out, and what the customer agreed to. The consent
 * wording is a prerequisite the server enforces twice — a channel cannot be
 * switched on without it, and new wording cannot be published under an old
 * version — so the form says both before the save, and the server's own refusal
 * is shown verbatim when it disagrees (`apps/api/src/services/messaging.service.ts`).
 *
 * Nothing is submitted until something changed: the footer carries the only
 * Save, and it stays off while the draft matches the settings the server last
 * sent — the query's data, replaced by the save's own response.
 */
import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MessagingSettingsInput } from "@glampro_suite/shared";

import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Checkbox from "@/components/ui/Checkbox";
import Field, { CONTROL_CLASS } from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { showToast } from "@/components/ui/toast-store";
import { channelStatus, QUIET_HOUR_OPTIONS, quietHoursSummary } from "@/constants/messaging";
import { queryKeys } from "@/constants/queryKeys";
import { useAuth } from "@/contexts/AuthContext";
import { useMessagingSettings, useMessagingCapabilities } from "@/hooks/useMessaging";
import { getErrorMessage, getValidationDetails, put } from "@/lib/api";

type Errors = Partial<Record<keyof MessagingSettingsInput, string>>;

const SECTION_CLASS =
  "flex flex-col gap-3 border-t border-line-soft pt-4 first:border-t-0 first:pt-0";

const HINT_CLASS = "text-xs text-ink-muted";

/** Field-by-field equality — the draft is only "changed" when a value differs. */
function sameSettings(a: MessagingSettingsInput, b: MessagingSettingsInput): boolean {
  return (Object.keys(a) as (keyof MessagingSettingsInput)[]).every((key) => a[key] === b[key]);
}

/**
 * The rules, read off `messagingSettingsSchema` plus the two the service adds:
 * a channel needs consent wording, and new wording needs a new version. They are
 * checked here so the user is told in words rather than by a 409, but the same
 * values still go to the server, which stays the authority.
 */
function validateFields(draft: MessagingSettingsInput, saved: MessagingSettingsInput): Errors {
  const errors: Errors = {};
  const delivering = draft.whatsappEnabled || draft.smsEnabled;

  if (
    !Number.isInteger(draft.reminderHours) ||
    draft.reminderHours < 1 ||
    draft.reminderHours > 168
  )
    errors.reminderHours = "Choose 1 to 168 hours before the appointment.";

  if (
    !Number.isInteger(draft.rebookingDays) ||
    draft.rebookingDays < 1 ||
    draft.rebookingDays > 365
  )
    errors.rebookingDays = "Choose 1 to 365 days after the visit.";

  if (
    !Number.isInteger(draft.cancellationHours) ||
    draft.cancellationHours < 0 ||
    draft.cancellationHours > 168
  )
    errors.cancellationHours = "Choose 0 to 168 hours before the appointment.";

  if (draft.quietStart === draft.quietEnd) {
    const message = "The first quiet hour must differ from the last.";
    errors.quietStart = message;
    errors.quietEnd = message;
  }

  const version = draft.consentVersion.trim();
  const wordingChanged =
    draft.serviceConsentText.trim() !== saved.serviceConsentText.trim() ||
    draft.marketingConsentText.trim() !== saved.marketingConsentText.trim();
  const newVersion = "New wording needs a new version.";

  if (version.length > 100) errors.consentVersion = "Keep the version to 100 characters or fewer.";
  else if (!version) {
    if (delivering) errors.consentVersion = "Add a version before switching a channel on.";
    else if (wordingChanged) errors.consentVersion = newVersion;
  } else if (wordingChanged && version === saved.consentVersion.trim()) {
    errors.consentVersion = newVersion;
  }

  const tooLong = "Keep the wording to 10,000 characters or fewer.";
  const missing = "Add the wording customers agree to before switching a channel on.";

  if (draft.serviceConsentText.trim().length > 10000) errors.serviceConsentText = tooLong;
  else if (!draft.serviceConsentText.trim() && delivering) errors.serviceConsentText = missing;

  if (draft.marketingConsentText.trim().length > 10000) errors.marketingConsentText = tooLong;
  else if (!draft.marketingConsentText.trim() && delivering) errors.marketingConsentText = missing;

  return errors;
}

export default function MessagingSettingsPanel({ canEdit }: { canEdit: boolean }) {
  const query = useMessagingSettings();

  if (query.isPending)
    return (
      <Card title="WhatsApp and SMS">
        <p className="px-2 py-3 text-sm text-ink-muted">Loading messaging settings…</p>
      </Card>
    );

  if (query.isError)
    return (
      <Card title="WhatsApp and SMS">
        <div className="flex flex-col items-start gap-3 px-2 py-3">
          <p role="alert" className="text-sm text-danger">
            Messaging settings could not be loaded.
          </p>
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      </Card>
    );

  if (!query.data) return null;

  return <SettingsForm data={query.data} canEdit={canEdit} />;
}

function SettingsForm({ data, canEdit }: { data: MessagingSettingsInput; canEdit: boolean }) {
  const capabilities = useMessagingCapabilities();
  const { tenant } = useAuth();
  const client = useQueryClient();
  const formId = useId();

  const [draft, setDraft] = useState<MessagingSettingsInput>(data);
  const [showErrors, setShowErrors] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState("");

  const mutation = useMutation({
    mutationFn: (input: MessagingSettingsInput) =>
      put<MessagingSettingsInput>("/messaging/settings", input),
    onSuccess: (saved, submitted) => {
      // The cache becomes the new baseline, so "unchanged" follows the server
      // rather than the object this form happened to render first.
      client.setQueryData(queryKeys.messaging.settings(tenant?.id), saved);
      // Keep a keystroke that landed while the request was in flight; the server
      // trims what it stores, so re-seeding the draft is the honest comparison.
      setDraft((current) => (sameSettings(current, submitted) ? saved : current));
      setShowErrors(false);
      setFieldErrors({});
      setServerError("");
      showToast("success", "Messaging settings saved.");
    },
    onError: (cause) => {
      const details = getValidationDetails(cause) as Errors;
      if (Object.keys(details).length > 0) {
        setShowErrors(true);
        setFieldErrors(details);
        setServerError("");
        return;
      }
      setServerError(getErrorMessage(cause));
    },
  });

  const change = (patch: Partial<MessagingSettingsInput>) => {
    setDraft((current) => ({ ...current, ...patch }));
    // A server refusal describes the draft that was sent, so it stops being true
    // the moment the draft changes.
    setServerError("");
    setFieldErrors({});
  };

  const errors: Errors = showErrors
    ? { ...validateFields(draft, data), ...fieldErrors }
    : fieldErrors;

  const dirty = !sameSettings(draft, data);
  const status = channelStatus(draft.whatsappEnabled, draft.smsEnabled);
  const problem = Object.keys(errors).length > 0;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit) return;
    setShowErrors(true);
    setServerError("");
    setFieldErrors({});
    if (Object.keys(validateFields(draft, data)).length > 0) return;
    mutation.mutate(draft);
  };

  const discard = () => {
    setDraft(data);
    setShowErrors(false);
    setFieldErrors({});
    setServerError("");
  };

  return (
    <Card
      title="WhatsApp and SMS"
      description="Switch a channel on, then choose when customers hear from you."
      label="Messaging settings"
      actions={
        <Badge variant={status.variant} dot>
          {status.label}
        </Badge>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div aria-live="polite" className="min-w-0">
            {problem ? (
              <p role="alert" className="text-sm text-danger">
                Check the highlighted settings.
              </p>
            ) : serverError ? (
              <p role="alert" className="text-sm text-danger">
                {serverError}
              </p>
            ) : dirty ? (
              <p className="text-sm text-ink-muted">Unsaved changes</p>
            ) : mutation.isSuccess ? (
              <p role="status" className="text-sm text-ink-muted">
                Messaging settings saved.
              </p>
            ) : null}
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={!canEdit || !dirty || mutation.isPending}
              onClick={discard}
            >
              Discard changes
            </Button>
            <Button
              type="submit"
              form={formId}
              loading={mutation.isPending}
              disabled={!canEdit || !dirty}
            >
              Save messaging settings
            </Button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <fieldset
          disabled={!canEdit || mutation.isPending}
          className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0"
        >
          <legend className="sr-only">Messaging delivery settings</legend>

          {!canEdit ? (
            <p className="text-sm text-ink-muted">
              You can read these settings but not change them. Ask the owner or a manager.
            </p>
          ) : null}

          <section className={SECTION_CLASS}>
            <h4 className="text-sm font-bold text-ink">Delivery channels</h4>

            {capabilities.data?.whatsappAvailable ? (
              <Checkbox
                label="Send WhatsApp messages"
                hint="Confirmations, reminders, rebooking prompts and receipts in one thread."
                checked={draft.whatsappEnabled}
                onChange={(event) => change({ whatsappEnabled: event.target.checked })}
              />
            ) : (
              <p className={HINT_CLASS}>WhatsApp — Coming soon</p>
            )}
            {capabilities.data?.smsAvailable ? (
              <Checkbox
                label="Send SMS messages"
                hint="The same messages as a text — works on any phone, reads slower."
                checked={draft.smsEnabled}
                onChange={(event) => change({ smsEnabled: event.target.checked })}
              />
            ) : (
              <p className={HINT_CLASS}>SMS — Coming soon</p>
            )}

            <p className={HINT_CLASS}>
              A channel also needs a sender and template set up for this salon by the platform.
              Until then, switching it on is refused.
            </p>
          </section>

          <section className={SECTION_CLASS}>
            <h4 className="text-sm font-bold text-ink">Message timing</h4>

            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="Reminder"
                type="number"
                inputMode="numeric"
                min={1}
                max={168}
                value={draft.reminderHours}
                error={errors.reminderHours}
                hint="Hours before the appointment."
                trailing={<span className={HINT_CLASS}>hours before</span>}
                onChange={(event) => change({ reminderHours: Number(event.target.value) })}
              />
              <Input
                label="Rebooking prompt"
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={draft.rebookingDays}
                error={errors.rebookingDays}
                hint="Days after a visit. A service's own interval overrides it."
                trailing={<span className={HINT_CLASS}>days after</span>}
                onChange={(event) => change({ rebookingDays: Number(event.target.value) })}
              />
              <Input
                label="Cancellation notice"
                type="number"
                inputMode="numeric"
                min={0}
                max={168}
                value={draft.cancellationHours}
                error={errors.cancellationHours}
                hint="Hours of warning before a customer may cancel free."
                trailing={<span className={HINT_CLASS}>hours before</span>}
                onChange={(event) => change({ cancellationHours: Number(event.target.value) })}
              />
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-ink">Quiet hours</p>

              <div className="grid gap-4 sm:max-w-md sm:grid-cols-2">
                <Select
                  label="From"
                  options={QUIET_HOUR_OPTIONS}
                  value={String(draft.quietStart)}
                  error={errors.quietStart}
                  onChange={(event) => change({ quietStart: Number(event.target.value) })}
                />
                <Select
                  label="To"
                  options={QUIET_HOUR_OPTIONS}
                  value={String(draft.quietEnd)}
                  error={errors.quietEnd}
                  onChange={(event) => change({ quietEnd: Number(event.target.value) })}
                />
              </div>

              <p className={HINT_CLASS}>{quietHoursSummary(draft.quietStart, draft.quietEnd)}</p>
            </div>
          </section>

          <section className={SECTION_CLASS}>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-bold text-ink">Consent wording</h4>
              <Badge variant={data.consentVersion ? "neutral" : "warning"} dot>
                {data.consentVersion ? `Published as ${data.consentVersion}` : "Nothing published"}
              </Badge>
            </div>

            <p className={HINT_CLASS}>
              Customers accept this wording before they can be messaged. Change the words and the
              version together — the server refuses new wording under an old version.
            </p>

            <Input
              label="Consent version"
              value={draft.consentVersion}
              error={errors.consentVersion}
              hint="A date or a short label, e.g. 2026-11."
              maxLength={100}
              onChange={(event) => change({ consentVersion: event.target.value })}
            />

            <Field
              label="Appointment and receipt wording"
              error={errors.serviceConsentText}
              hint="Shown when a customer agrees to messages about their visits and receipts."
            >
              {({ controlId, describedBy }) => (
                <textarea
                  id={controlId}
                  rows={3}
                  maxLength={10000}
                  value={draft.serviceConsentText}
                  aria-invalid={errors.serviceConsentText ? true : undefined}
                  aria-describedby={describedBy}
                  className={`${CONTROL_CLASS} min-h-24 resize-y p-3`}
                  onChange={(event) => change({ serviceConsentText: event.target.value })}
                />
              )}
            </Field>

            <Field
              label="Marketing wording"
              error={errors.marketingConsentText}
              hint="The separate, optional agreement for offers. A customer may decline it."
            >
              {({ controlId, describedBy }) => (
                <textarea
                  id={controlId}
                  rows={3}
                  maxLength={10000}
                  value={draft.marketingConsentText}
                  aria-invalid={errors.marketingConsentText ? true : undefined}
                  aria-describedby={describedBy}
                  className={`${CONTROL_CLASS} min-h-24 resize-y p-3`}
                  onChange={(event) => change({ marketingConsentText: event.target.value })}
                />
              )}
            </Field>
          </section>
        </fieldset>
      </form>
    </Card>
  );
}
