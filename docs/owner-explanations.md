# Bounded owner explanations — OA-06

## Scope

The dashboard's **Ask about verified business facts** panel supports nine fixed
English question templates: business summary, completed-sale paid amounts, refunds
and net paid, average ticket, appointment starts, new customer records, current low
stock, rebooking eligibility policy and quiet-day screening policy. Choose a prompt
button or type the same supported phrase. Case, whitespace and trailing question
punctuation are normalized; there is no general natural-language interpretation.

`POST /api/ai-assistant/explain` is read-only despite using POST to keep question
text out of query URLs. It requires current tenant authentication, owner/manager
role and dashboard entitlement. Policy questions also require the underlying
customer/appointment or catalogue/appointment modules. Suspended companies retain
the existing read-only access policy; expired/cancelled accounts are refused by
authentication. Company-wide calculations do not apply the selected outlet.

No language provider is configured, called or selected. No prompt/model context,
conversation table, migration, message job, saved draft, SQL generator, execution
tool or main navigation entry is added. There is no inference about profit,
utilisation, performance causes, predictions, clinical advice or staff ranking.
There is no provider-failure simulation presented as evidence of a real provider
integration: deterministic explanations are the entire supported path. Future
language integration requires a separate data/cost/provider decision and tests.

## Facts and periods

Metric answers call the same `ownerMetrics` implementation as the briefing and
dashboard. All returned money remains exact decimal strings. Completed-sale paid
amounts include prepaid tenders; refunds use refund time, not original sale time;
net paid is paid minus refunds and can be negative. Average ticket divides by
completed receipts, not appointments. Bookings exclude cancellations but include
no-shows; new customers means records created, not first visits. Low stock is a
current active-product snapshot, not stock history.

The explicit period control is authoritative. It supports today, yesterday, last
seven calendar days including today, or at most 31 inclusive custom calendar days.
Dates resolve in the salon's persisted timezone through existing DST-safe day
bounds. Periods ending after the salon's local today require clarification; future
business performance is not inferred. Today is not a completed day and can include
scheduled appointments later today. Evidence includes the exact half-open UTC
interval, timezone, as-of timestamp and aggregate facts. Monetary units are the
existing reporting units; no currency conversion is performed.

Rebooking/quiet-day responses explain the existing policy only, with no recipient
records or availability search. They explicitly ignore the reporting period and
direct the owner to existing dashboard workspaces for fresh evidence. They cannot
save, approve, send, reserve a slot, activate offers or change discounts.

## Refusal, privacy and bounds

The response contract distinguishes `answered`, `clarify`, `unsupported` and
`unavailable`. Answered metrics require valid evidence with matching timestamps;
policy answers require their policy source, not fabricated metric evidence.
Ambiguous terms such as income or sales ask the owner to choose an explicit
question and period. Unknown questions, appended instructions, requests for
restricted records, SQL, execution or model/provider overrides are not interpreted.
Unknown input properties and client-supplied tenant/context/evidence are rejected.
Questions are never interpolated into queries or echoed into the answer.

No customer names, phone numbers, email, clinical notes/photos/signatures,
credentials, payment references or capability links are read by the explanation
path. It reads aggregate counts and sums plus role, entitlements, timezone and
stock policy. Do not enter personal or clinical information into the text box.
Question/answer history stays only in the mounted panel and is not persisted.
Changing question/period clears the prior result; identity/role/module changes
remount or hide the workspace. HTTP errors or invalid responses never retain
previous figures. The endpoint sets `Cache-Control: no-store`.

Bounds: question at most 300 characters, answer at most 3,000 characters, custom
window at most 31 days, nine question templates, no recursive tool calls and no
provider spending. An authenticated company/user receives 20 requests per 15
minutes **per API process**, using the existing in-memory rate-limit library.
Invalid/unsupported requests count once authenticated; denied roles/modules do not
consume another user's allowance. This is not a distributed or billing quota;
multi-instance global budgets remain a release-readiness concern. There is no
unbounded recipient/booking search. Aggregate queries still depend on database
size and normal database operational timeouts.

If verified metric reads fail, the response is `unavailable` with no figures or
raw database errors. It never fabricates zeroes or falls back to old evidence.
Authorization checks happen outside that fallback and propagate refusals. Because
there is no language provider, factual output cannot be lost to provider failure.
Source-screen links are shown only when entitled and disclose that the reporting
window is not automatically applied.

## Verification and rollout

No migration is added. Disposable HTTP acceptance is gated by
`RUN_OA06_ACCEPTANCE=true` and requires loopback port 55444/database
`oa06_acceptance`. It verifies tenant-separated real metrics, auth/current-role and
module refusal, injection/restricted-data refusal, strict input validation,
no-store, independent rate budgets and no draft/message creation. Unit tests cover
exact decimal facts, negative/refund-only values, empty days, timezone/DST periods,
bounded input, policy-only answers and fact-source failures. UI tests cover explicit
submit, evidence/period display, changes, refusals, errors and access loss.

Owner walkthrough and real multi-instance operational readiness are not implied by
automated checks. OA-07 covers outcomes/release readiness; no application database
access, provider activation, deployment or external AI authorization is granted.
