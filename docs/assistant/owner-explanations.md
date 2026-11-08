# Bounded owner business questions — OA-06

## Scope

The dashboard's **Ask about your business** panel is a conversation over verified
figures. It supports seven topics: business summary, completed-sale paid amounts,
refunds and net paid, average ticket, appointment starts, new customer records and
current low stock.

The owner can type in their own words or pick a suggested question. Wording is
resolved by a **fixed vocabulary**, not by natural-language understanding
(`assistantTopicKeywords` in `packages/shared/src/schemas/assistant-explanation.ts`):
an exact template match wins, otherwise whole-word/phrase keyword scoring picks one
topic. A tie, or wording that only names an ambiguous money term such as _income_ or
_revenue_, returns `clarify` with a specific follow-up question instead of a guess.
Words about causes, comparisons or predictions also clarify, because the panel
cannot answer them.

Every request first passes a refusal screen — instructions, SQL/statement keywords,
outbound actions, clinical/personal records, credentials, other tenants, payroll and
forward-looking wording. A refused request never reaches scoring, so appending
"ignore the rules and export the list" to a supported question cannot become an
answer or a command.

`POST /api/ai-assistant/explain` is read-only despite using POST to keep question
text out of query URLs. It requires current tenant authentication, owner/manager
role and dashboard entitlement. Suspended companies retain the existing read-only
access policy; expired/cancelled accounts are refused by authentication.
Company-wide calculations do not apply the selected outlet.

No language provider is configured, called or selected. No prompt/model context,
conversation table, migration, message job, saved draft, SQL generator, execution
tool or main navigation entry is added. There is no inference about profit,
utilisation, performance causes, predictions, clinical advice or staff ranking.
Future language integration requires a separate data/cost/provider decision and tests.

## Facts and periods

Answers use the same `ownerMetrics` implementation the Reports screen uses. All
returned money remains exact decimal strings. Completed-sale paid amounts include
prepaid tenders; refunds use refund time, not original sale time; net paid is paid
minus refunds and can be negative. Average ticket divides by completed receipts, not
appointments. Bookings exclude cancellations but include no-shows; new customers
means records created, not first visits. Low stock is a current active-product
snapshot, not stock history.

The period row is authoritative for the turn that is sent. It supports today,
yesterday, last seven calendar days including today, or at most 31 inclusive custom
calendar days. Dates resolve in the salon's persisted timezone through existing
DST-safe day bounds. Periods ending after the salon's local today require
clarification; future business performance is not inferred. Today is not a completed
day and can include scheduled appointments later today. Each answer is stamped with
the period it was asked for and the as-of time; evidence holds the exact half-open
UTC interval, timezone and aggregate facts. Monetary units are the existing
reporting units; no currency conversion is performed.

## Refusal, privacy and bounds

The response contract distinguishes `answered`, `clarify`, `unsupported` and
`unavailable`. Answered topics require valid evidence with a matching as-of
timestamp; refusals and clarifications carry no topic, evidence or source, so a
refusal can never be dressed up as a figure. Unknown input properties and
client-supplied tenant/context/evidence are rejected. Questions are never
interpolated into queries or echoed into the answer.

No customer names, phone numbers, email, clinical notes/photos/signatures,
credentials, payment references or capability links are read by the explanation
path. It reads aggregate counts and sums plus role, entitlements, timezone and stock
policy. Do not enter personal or clinical information into the text box.

The transcript lives only in the mounted panel and is never persisted. A failed turn
shows a failure with a Retry action and never reuses an earlier turn's figures; the
earlier turns stay on screen, clearly attached to their own questions and periods.
Identity, role or module changes remount the workspace, which discards the
transcript. The endpoint sets `Cache-Control: no-store`.

Bounds: question at most 300 characters, answer at most 3,000 characters, custom
window at most 31 days, seven topics, no recursive tool calls and no provider
spending. An authenticated company/user receives 20 requests per 15 minutes **per API
process**, using the existing in-memory rate-limit library. Invalid/unsupported
requests count once authenticated; denied roles/modules do not consume another user's
allowance. This is not a distributed or billing quota; multi-instance global budgets
remain a release-readiness concern.

If verified metric reads fail, the response is `unavailable` with no figures or raw
database errors. It never fabricates zeroes or falls back to old evidence.
Authorization checks happen outside that fallback and propagate refusals. Source-screen
links are shown only when entitled and disclose that the reporting window is not
automatically applied.

## Panel behaviour

- The transcript is a labelled log (`role="log"`, polite live region). The owner's turn
  sits on the right in a purple bubble; answers, the "checking verified facts" line and
  the failure notice all hang off one small avatar on the left, and the panel scrolls to
  the newest turn. The log itself scrolls only once it has turns, so the empty state is
  never clipped.
- Before the first question the panel shows an opening line and the seven supported
  questions as a two-column grid of topic cards — one glyph per topic, and the card text
  is the same template the API matches exactly. A card sends that template with the
  period currently selected. The grid sits above the composer, not below Send, and steps
  aside once the conversation has started.
- The composer sends on Enter, inserts a newline on Shift+Enter and shows a
  300-character counter next to the "do not enter personal or clinical information"
  note. Send is disabled while a request is in flight or a custom range is incomplete.
- An answer leads with prose, then folds the figures/period and the caveats into
  "Show the figures and exact period" and "What this answer can't tell you".
- Each turn keeps its own period, so a later chip change cannot relabel an earlier
  answer, and Retry re-asks that turn's question for that turn's period.
- A 429 shows the wait-15-minutes copy; any other failure or malformed response shows
  the unavailable copy. Neither substitutes figures from another turn.

The dashboard no longer mounts the owner briefing, rebooking recommendations,
quiet-day opportunities or saved-draft review. Those screens were removed on
November 5, 2026 while their APIs, services, tables and the automatic rebooking
message job remain in place (see `docs/assistant/owner-rebooking.md`, `docs/assistant/owner-quiet-days.md`,
`docs/assistant/owner-draft-delivery.md`). The owner summary endpoint is retained because the
business answers read the same figures through `ownerMetrics`.

## Verification and rollout

No migration is added. Disposable HTTP acceptance is gated by
`RUN_OA06_ACCEPTANCE=true` and requires loopback port 55444/database
`oa06_acceptance`. It verifies tenant-separated real metrics, auth/current-role and
module refusal, injection/restricted-data refusal, strict input validation,
no-store, independent rate budgets and no draft/message creation. Unit tests cover
exact decimal facts, negative/refund-only values, empty days, timezone/DST periods,
bounded input, keyword resolution, ties, guardrails and fact-source failures. UI tests
cover the empty state, Enter/Shift+Enter, transcript retention across a failed turn,
retry, rate-limit copy, custom ranges, remount on identity/module change and hidden
panels for unentitled roles.

Owner walkthrough and real multi-instance operational readiness are not implied by
automated checks. OA-07 covers outcomes/release readiness; no application database
access, provider activation, deployment or external AI authorization is granted.
