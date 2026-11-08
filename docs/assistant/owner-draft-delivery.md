# Owner draft approvals and controlled delivery — OA-05

## Approved boundary (October 24, 2026)

SMS-first, one explicit recipient per draft. WhatsApp and promotions cannot be
saved/approved/queued through this workflow. Existing WhatsApp automation is not
removed, but cannot consume assistant edits. No campaign activation or discount
policy is introduced. No external language provider is used.

Owner/manager dashboard users need dashboard, customers and appointments modules
and an active company. A configured SMS sender and public messaging origin are
required to construct an exact preview. Existing worker enablement is unchanged;
queueing never starts a worker or calls a provider from the HTTP request.

## Review workflow

1. Edit an eligible recommendation and explicitly save an SMS draft.
2. Review destination, channel, sender, version and exact body, including the
   unsubscribe URL. This saved body is sent unchanged by the SMS provider adapter.
3. Approve the displayed version. Approval alone creates no message job.
4. Explicitly queue the approved version. Reload to inspect its actual job status.

Saving an edit increments version and invalidates approval. Concurrent/stale edits
are refused. Queued drafts are immutable through these APIs. Duplicate queue
requests return the same draft; a unique draft/job relationship prevents duplicates.
Audit history is paginated and includes actor, action and content/version snapshots.
Audit events are database-enforced append-only, not application logs.

The same owner/manager may author and approve; no two-person separation policy was
requested. Current approver and queue actor role, company membership, disabled state
and token version are rechecked at dispatch. Changed credentials invalidate delivery
authorization. Current tenant/module/channel/customer/destination/consent, latest
visit, interval and upcoming-booking/contact checks also apply. Existing queue jobs
and automatic rebooking remain the single shared contact history across channels.

## Limits and retention

At most 20 assistant jobs can be queued per company per salon-local calendar day.
The tenant lock serializes quota checks, including concurrent queue requests.
Suppressed/failed/uncertain jobs still consume their original queue-day allocation;
retrying the same job does not allocate another entry. Existing customer contact
limits apply independently. This is a queue quota, not provider delivery-day timing.

Manual retention review is due 30 days after creation, with no automatic deletion.
Due drafts cannot be approved/queued/dispatched. The dashboard records a reason,
reviewer, timestamp and next review in 30 days. Reviewing unqueued records increments
version and invalidates approval; it does not approve content. Queued records retain
their state and evidence. There is no blanket approval for indefinite retention:
authorized disposal/export policy remains a release-readiness concern under OA-07.
Tenant deletion is restricted while draft/audit evidence exists.

The exact SMS body includes a capability-bearing unsubscribe URL. Authorized salon
owners/managers can see it in preview/audit; it must not be copied to analytics or
external AI context. Provider credentials are never stored in drafts/audit. Existing
unsubscribe links expire after 365 days; the 30-day delivery/review guard is shorter.

## Outcomes and retries

PENDING/RETRY/ACCEPTED are not delivery confirmations. Existing signed provider
callbacks advance actual outcomes. Definite 429 rejection uses the existing bounded
backoff with all eligibility checks repeated. An interrupted worker or ambiguous
provider result becomes UNCERTAIN; never blindly resubmit. The dashboard provides
no resend button for uncertain or accepted jobs. Existing manual failed-job retry
also cannot retry uncertain/accepted messages.

## Rollout and checks

Migration `20261024120000_assistant_draft_approvals` is additive. Apply it only through
authorized rollout before deploying API/worker code. Back up and review retention
constraints first. This task does not authorize application migration, real messages,
deployment or provider activation. Verification uses a fresh disposable loopback
PostgreSQL cluster on port 55443/database `oa05_acceptance`, with an injected fake
provider. Set `RUN_OA05_ACCEPTANCE=true` only against that exact target.

Owner UAT: save/edit/reload a draft, inspect exact preview, approve separately,
invalidate approval by editing, queue once, inspect outcome/audit, record retention
review and verify role/module refusal. Real-provider delivery and operational
retention/disposal readiness need separate authorization and evidence.
