import { useState } from "react";
import { createTreatmentConsentFormSchema } from "@glampro_suite/shared";
import type { TreatmentConsentForm } from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Pagination from "@/components/ui/Pagination";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import {
  useConsentEvents,
  useConsentForms,
  useCreateConsentForm,
  useRecordConsentEvent,
  useTreatment,
} from "@/hooks/useTreatments";
import { getErrorMessage } from "@/lib/api";
import ConsentHistoryActions from "./ConsentHistoryActions";
import ConsentSignature, { SignatureEvidence } from "./ConsentSignature";

export default function TreatmentConsent({
  customerId,
  recordId,
}: {
  customerId: string;
  recordId: string;
}) {
  const record = useTreatment(recordId);
  if (record.isError)
    return (
      <div role="alert">
        Treatment could not be loaded.{" "}
        <Button onClick={() => void record.refetch()}>Retry treatment</Button>
      </div>
    );
  if (record.isPending) return <p role="status">Loading treatment…</p>;
  if (!record.data || record.data.id !== recordId || record.data.customerId !== customerId)
    return <p role="alert">Treatment is unavailable for this customer.</p>;
  return (
    <ConsentPanel
      key={`${recordId}:${record.data.treatmentType}`}
      customerId={customerId}
      recordId={recordId}
      treatmentType={record.data.treatmentType}
    />
  );
}

function ConsentPanel({
  customerId,
  recordId,
  treatmentType,
}: {
  customerId: string;
  recordId: string;
  treatmentType: string;
}) {
  const { isReadOnly, user } = useAuth();
  const canPublish = user?.globalRole === "SUPER_ADMIN" || user?.globalRole === "MANAGER";
  const { formatDateTime } = useSalonFormatting();
  const forms = useConsentForms(treatmentType);
  const [page, setPage] = useState(1);
  const history = useConsentEvents(recordId, page);
  const decision = useRecordConsentEvent();
  const [authoring, setAuthoring] = useState(false);
  const [confirmation, setConfirmation] = useState<{ formId: string; consented: boolean } | null>(
    null,
  );
  const [savedFormIds, setSavedFormIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const active = forms.data?.find((form) => form.isActive && form.treatmentType === treatmentType);
  const hasDecision =
    active &&
    (savedFormIds.includes(active.id) ||
      history.data?.states.some((state) => state.treatmentConsentFormId === active.id));
  const busy = decision.isPending;
  const canDecide =
    !isReadOnly &&
    !busy &&
    !forms.isFetching &&
    !forms.isError &&
    !history.isFetching &&
    !history.isError &&
    history.data !== undefined &&
    active &&
    !hasDecision;

  async function recordDecision() {
    if (!canDecide || !confirmation || confirmation.formId !== active.id) return;
    if (confirmation.consented && active.signatureRequired && !signature) return;
    setError(null);
    try {
      await decision.mutateAsync({
        customerId,
        treatmentRecordId: recordId,
        treatmentConsentFormId: active.id,
        consented: confirmation.consented,
        ...(confirmation.consented && signature ? { signatureData: signature } : {}),
      });
      setSavedFormIds((ids) => [...ids, active.id]);
      setConfirmation(null);
    } catch (error) {
      setError(getErrorMessage(error));
      void forms.refetch();
      void history.refetch();
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Treatment consent workflow">
      <h3 className="font-bold">{treatmentType}</h3>
      <p className="text-sm text-ink-muted">
        Treatment consent is separate from data and marketing consent. Record the customer’s
        explicit decision after reviewing the exact form below. Later withdrawal, re-consent and
        manager correction annotations append evidence without replacing the original. Treatments
        with consent evidence cannot be deleted. Use the treatment list’s retention review action to
        manage reviews/holds and the customer profile to manage archival. Archival preserves
        evidence and does not authorize erasure. Only owners and managers can publish forms.
      </p>
      {isReadOnly ? (
        <p>This salon is read-only. Consent evidence and forms remain viewable.</p>
      ) : null}
      {forms.isPending ? <p role="status">Loading consent forms…</p> : null}
      {forms.isError ? (
        <div role="alert">
          Consent forms could not be loaded.{" "}
          <Button onClick={() => void forms.refetch()}>Retry forms</Button>
        </div>
      ) : null}
      {!forms.isPending && !forms.isError ? (
        <>
          {active ? (
            <FormPreview form={active} />
          ) : (
            <p>
              No active consent form for this treatment type. Publish a form before recording a
              decision.
            </p>
          )}
          {hasDecision ? (
            <p>
              A decision is already recorded for this form version. Use the history actions below
              for withdrawal, re-consent or manager annotations.
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              disabled={!canDecide}
              onClick={() => {
                setError(null);
                setSignature(null);
                setConfirmation({ formId: active!.id, consented: true });
              }}
            >
              Grant consent
            </Button>
            <Button
              variant="secondary"
              disabled={!canDecide}
              onClick={() => {
                setError(null);
                setConfirmation({ formId: active!.id, consented: false });
              }}
            >
              Decline consent
            </Button>
          </div>
          {confirmation && confirmation.formId === active?.id && !hasDecision ? (
            <div className="rounded-card border border-line p-3">
              <p>
                Confirm the customer {confirmation.consented ? "grants" : "declines"} consent to{" "}
                {active.title}, version {active.version}. Your authenticated account will be
                recorded as witness. This decision cannot be edited here.
              </p>
              {confirmation.consented && active.signatureRequired ? (
                <ConsentSignature key={active.id} disabled={!canDecide} onChange={setSignature} />
              ) : null}
              <Button
                disabled={
                  !canDecide || (confirmation.consented && !!active.signatureRequired && !signature)
                }
                onClick={() => void recordDecision()}
              >
                Confirm {confirmation.consented ? "grant" : "decline"}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>
                Cancel decision
              </Button>
            </div>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
          <details>
            <summary>Published form versions</summary>
            {forms.data?.length === 0 ? (
              <p>No published versions.</p>
            ) : (
              forms.data?.map((form) => (
                <details key={form.id}>
                  <summary>
                    {form.title} — version {form.version} ({form.isActive ? "active" : "inactive"})
                  </summary>
                  <FormPreview form={form} />
                </details>
              ))
            )}
          </details>
          <Button
            variant="secondary"
            disabled={!canPublish || isReadOnly || busy || forms.isFetching}
            onClick={() => setAuthoring(!authoring)}
          >
            {authoring ? "Close form editor" : "Publish new form version"}
          </Button>
          {!canPublish ? <p>Ask an owner or manager to publish a consent form.</p> : null}
          {authoring && canPublish && !isReadOnly ? (
            <ConsentFormEditor
              treatmentType={treatmentType}
              onPublished={() => {
                setAuthoring(false);
                setConfirmation(null);
              }}
            />
          ) : null}
        </>
      ) : null}
      <h3 className="font-bold">Consent evidence history</h3>
      {history.data && !history.isError ? (
        <ConsentHistoryActions
          key={page}
          events={history.data.data}
          states={history.data.states}
          forms={forms.data ?? []}
          customerId={customerId}
          recordId={recordId}
          blocked={
            busy ||
            !!history.isFetching ||
            !!forms.isFetching ||
            !!forms.isError ||
            forms.data === undefined
          }
        />
      ) : null}
      {history.isPending ? <p role="status">Loading consent evidence…</p> : null}
      {history.isError ? (
        <div role="alert">
          Consent evidence could not be loaded. Decisions are disabled until history is available.{" "}
          <Button onClick={() => void history.refetch()}>Retry evidence</Button>
        </div>
      ) : null}
      {!history.isPending && !history.isError && history.data?.total === 0 ? (
        <p>No consent decisions recorded.</p>
      ) : null}
      {!history.isError
        ? history.data?.data.map((event) => (
            <article key={event.id} className="rounded-card border border-line p-3">
              <h4 className="font-semibold">
                {event.eventType === "CORRECTION"
                  ? "Correction annotation"
                  : event.eventType === "WITHDRAWAL"
                    ? "Withdrawn"
                    : event.eventType === "RECONSENT"
                      ? "Re-consented"
                      : event.consented
                        ? "Granted"
                        : "Declined"}{" "}
                — {formatDateTime(event.consentedAt)}
              </h4>
              <p>Witness account: {event.consentedById}</p>
              <p>Evidence reference: {event.id}</p>
              {event.correctsEventId ? (
                <p>
                  Annotates evidence: {event.correctsEventId}. Reason: {event.reason}
                </p>
              ) : null}
              <p>
                {event.signatureData
                  ? "Signature evidence exists; signature display is not supported here."
                  : "No signature captured."}
              </p>
              {event.signatureData ? <SignatureEvidence value={event.signatureData} /> : null}
              {event.treatmentConsentForm ? (
                <FormPreview form={event.treatmentConsentForm} />
              ) : (
                <p role="alert">
                  Original form wording is unavailable. Form reference:{" "}
                  {event.treatmentConsentFormId}
                </p>
              )}
            </article>
          ))
        : null}
      {history.data && !history.isError && !history.isFetching ? (
        <>
          <p>
            {history.data.total} consent events. Page {page} of{" "}
            {Math.max(1, history.data.pageCount)}.
          </p>
          {history.data.data.length === 0 && history.data.total > 0 ? (
            <p>No evidence on this page.</p>
          ) : null}
          <Pagination
            page={page}
            pageCount={history.data.pageCount}
            onPageChange={setPage}
            label="Consent history pages"
          />
        </>
      ) : null}
      {page > 1 && (history.isError || history.isPending) ? (
        <Button onClick={() => setPage(1)}>Return to latest evidence</Button>
      ) : null}
    </section>
  );
}

function FormPreview({ form }: { form: TreatmentConsentForm }) {
  return (
    <section
      aria-label={`${form.title}, version ${form.version}`}
      className="rounded-card border border-line p-3"
    >
      <h4 className="font-semibold">
        {form.title} — version {form.version}
      </h4>
      <p className="whitespace-pre-wrap break-words">{form.content}</p>
      <p>
        {form.signatureRequired
          ? "Drawn customer signature required for grant/re-consent."
          : "Signature not required for this version."}
      </p>
    </section>
  );
}

function ConsentFormEditor({
  treatmentType,
  onPublished,
}: {
  treatmentType: string;
  onPublished: () => void;
}) {
  const { isReadOnly } = useAuth();
  const create = useCreateConsentForm();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [signatureRequired, setSignatureRequired] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = createTreatmentConsentFormSchema.safeParse({
    treatmentType,
    title,
    content,
    isActive: true,
  });
  async function publish() {
    if (isReadOnly || create.isPending || !preview || !parsed.success) return;
    setError(null);
    try {
      await create.mutateAsync({
        treatmentType: parsed.data.treatmentType,
        title: parsed.data.title,
        content: parsed.data.content,
        isActive: true,
        ...(signatureRequired ? { signatureRequired: true } : {}),
      });
      onPublished();
    } catch (error) {
      setError(getErrorMessage(error));
    }
  }
  return (
    <section
      className="flex flex-col gap-3 rounded-card border border-line p-3"
      aria-label="New consent form version"
    >
      <p>
        Publishing applies salon-wide to {treatmentType} and replaces its active form. Earlier
        versions and their recorded wording are unchanged. The server assigns the version number.
      </p>
      <Input
        label="Form title"
        value={title}
        maxLength={200}
        disabled={create.isPending || isReadOnly}
        onChange={(event) => {
          setTitle(event.target.value);
          setPreview(false);
        }}
      />
      <label className="flex flex-col gap-2">
        Form wording
        <textarea
          className="rounded-md border border-line p-3"
          rows={8}
          value={content}
          disabled={create.isPending || isReadOnly}
          onChange={(event) => {
            setContent(event.target.value);
            setPreview(false);
          }}
        />
      </label>
      <Button
        variant="secondary"
        disabled={!parsed.success || create.isPending || isReadOnly}
        onClick={() => setPreview(true)}
      >
        Preview new version
      </Button>
      <label>
        <input
          type="checkbox"
          checked={signatureRequired}
          disabled={create.isPending || isReadOnly}
          onChange={(event) => {
            setSignatureRequired(event.target.checked);
            setPreview(false);
          }}
        />{" "}
        Require drawn customer signature for grant/re-consent
      </label>
      {preview && parsed.success ? (
        <section aria-label="Draft form preview">
          <h4 className="font-semibold">{parsed.data.title}</h4>
          <p className="whitespace-pre-wrap break-words">{parsed.data.content}</p>
          <p>{signatureRequired ? "Signature required" : "Signature optional"}</p>
          <Button disabled={create.isPending || isReadOnly} onClick={() => void publish()}>
            Confirm publish version
          </Button>
        </section>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
