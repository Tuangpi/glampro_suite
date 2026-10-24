# Owner rebooking recommendations — OA-03

OA-05 update (October 24): SMS drafts now support explicit saving, versioned review,
approval and controlled queueing. The read-only/temporary descriptions below record
the original OA-03 boundary. Current workflow/policy: `docs/owner-draft-delivery.md`.
WhatsApp and promotion delivery remain gated; recommendation preview itself does
not persist or send anything.

Dashboard recommendations are deterministic, read-only previews for owners and
managers with dashboard, customer and appointment access. There is no new main
navigation entry, approval endpoint, saved draft or sender. Edits exist only in
the mounted browser workspace and are discarded on refresh, role/identity changes
or navigation. OA-05 must define retention and versioned approvals before storage
or delivery is introduced.

## Intervals and evidence

- Catalogue → Services → edit → Rebooking interval (days): 1–365, blank inherits.
- Company fallback: existing Settings → Messaging → rebooking days; 28 if unset.
- No name-based or clinical interval inference. The legacy API `daysThreshold`
  parameter remains a fallback override only for services without an interval.
- Use the customer's latest completed appointment, never an older visit revived
  by a reporting filter. A customer becomes overdue after the configured number
  of salon-local calendar days. At most one recommendation per customer.
- Suggested tomorrow is a draft date, not an available slot or booking promise.
- The existing primary appointment service supplies the interval; multi-service
  optimization and per-service outreach are not added.

## Consent and duplicate-contact policy

Require an unarchived customer, current PDPA and marketing choices, a valid
international phone number, exactly one preferred SMS/WhatsApp channel, current
marketing permission for that exact normalized destination, and an enabled salon
channel. Never combine grants across channels, reuse historical consent events,
fall back to another channel or require email for phone-channel delivery.

An upcoming/in-progress booking ending after now suppresses recommendations.
An existing pending, retrying, sending or uncertain rebooking job owns outreach.
An accepted/sent/delivered/read/undelivered job for the same visit or updated within
the interval also suppresses it. Definite rejection, cancellation and suppression
do not consume the contact limit. Previewing/editing is not contact and creates no
counter or job. Limits apply across channels and outlets within the company.

Automatic jobs use the same explicit service/company interval at queue creation.
Already queued due dates are not silently recalculated after policy changes.
Dispatch rechecks current consent/destination, latest visit, upcoming bookings and
contact history under the existing customer lock. A duplicate eligible job can
produce only one accepted submission; uncertain outcomes are never blindly retried.
The automatic provider payload remains unchanged; edited assistant drafts cannot
reach it. Global/provider enablement is not changed by OA-03.

## Rollout and verification

Apply migration `20261024100000_service_rebooking_interval` before running the new
API. The old schema-only `Service.interval` scaffold had no migration. This
migration creates a nullable field, with existing rows inheriting company policy;
if a development database already has explicit values, it preserves them. Values
outside 1–365 require review before migration. No application migration is implied.

Owner walkthrough: configure a service override and clear it to inherit; inspect
an overdue, consenting customer without upcoming bookings or queued outreach;
edit the temporary draft; refresh; verify opted-out/changed-phone/queued customers
are excluded. Check role/module refusal and unavailable/retry states. No real
provider sending is required or authorized for this walkthrough.
