# WhatsApp and SMS integration — TK2610-0021

## Scope and activation boundary

The application supports Twilio WhatsApp and SMS, appointment confirmations with
customer confirm/cancel pages, scheduled reminders, rebooking prompts and secure
receipt links. Both channels and the worker are disabled by default. Installing
the code does **not** register senders, approve templates, create a Twilio account,
prove handset delivery or authorize paid traffic.

Repository root: `/home/tuangpi/Documents/Aridient/Glampros/glampro_suite`.
Commands below run from that directory unless stated otherwise. Do not paste
production secrets into chat, source control, screenshots or test fixtures.

## 1. Provision account and senders

Use a salon-owned customer-facing identity. Prefer separate Twilio accounts or
subaccounts per unrelated salon; the configured Account SID and Auth Token must
belong to the account actually sending messages and signing its callbacks. This
release uses direct `From` senders, not a Messaging Service SID. Use a dedicated
sender per salon; never silently pool unrelated salons behind one identity.

### WhatsApp

1. Start with Twilio's WhatsApp Sandbox and an explicitly joined test handset.
2. For production, complete Twilio/Meta business and WhatsApp sender onboarding.
   Ensure the salon owns or is authorized to use the business and number.
3. Create four Content Templates in the sending account. Obtain their `HX…`
   Content SIDs and approval for the intended WhatsApp categories/languages.
4. Configure the exact sender as `whatsapp:+<international number>`.
5. Do not assume sandbox templates can exercise this application's custom
   four-variable templates. If the sandbox does not allow the custom templates,
   use the automated test adapter for application checks and an approved test
   production sender for the full provider check. Do not remove template checks.

All WhatsApp sends use `ContentSid` and `ContentVariables`, even when a service
window is open. There is no arbitrary free-form-message bypass.

### SMS

1. Select a sender permitted for the destination country, enable that country's
   geo permissions and complete any required registration.
2. For Singapore, check the current Twilio Singapore SMS guidelines and SSIR/
   SGNIC requirements. Register the salon's sender with both the required registry
   and Twilio before live traffic. An API request accepting a sender string is
   not registration or a guarantee the sender will be preserved.
3. `smsFrom` is either a registered alphanumeric sender or a supported owned
   international-format phone number. It is not a WhatsApp-prefixed number.
4. Alphanumeric senders are one-way. Customers cannot reply STOP to them. Every
   message therefore includes an HTTPS unsubscribe link; do not remove it.
5. For reply-capable senders, configure the incoming-message webhook as well.
   The application recognizes STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT and
   `OptOutType=STOP`. START does not silently restore application consent.

Long SMS messages and Unicode can require multiple billable segments. Secure
links add length. Review provider pricing, budgets and destination restrictions
before activation; no pricing or free-delivery promise is made here.

## 2. Configure server-side environment

The same secrets and origin must be available to the API and messaging worker.

```dotenv
MESSAGING_ENABLED=false
MESSAGING_PUBLIC_ORIGIN=https://salon.example.com
```

`MESSAGING_PUBLIC_ORIGIN` must be the public HTTPS **origin**, without a path,
query, fragment or credentials. It must serve this API at `/api`. Local manual
development may use `http://localhost:<port>`; Twilio callbacks still need a
reachable HTTPS test origin. Never use a customer-controlled Host header to
construct these links.

Inject `MESSAGING_TENANTS_JSON` as one JSON string from your secret manager. The
following is a **configuration shape**, not usable credentials:

```json
{
  "exact-tenant-id": {
    "accountSid": "AC_REPLACE_WITH_SENDING_ACCOUNT_SID",
    "authToken": "REPLACE_WITH_SENDING_ACCOUNT_AUTH_TOKEN",
    "smsFrom": "RegisteredSalonName",
    "whatsappFrom": "whatsapp:+REPLACE_WITH_APPROVED_NUMBER",
    "templates": {
      "CONFIRMATION": "HX_REPLACE_WITH_APPROVED_CONTENT_SID",
      "REMINDER": "HX_REPLACE_WITH_APPROVED_CONTENT_SID",
      "REBOOKING": "HX_REPLACE_WITH_APPROVED_CONTENT_SID",
      "RECEIPT": "HX_REPLACE_WITH_APPROVED_CONTENT_SID"
    }
  }
}
```

Keys are exact internal tenant IDs, not slugs. Do not expose this JSON through
the SPA, settings responses or frontend environment variables. Missing channel
configuration prevents activation/sending; it never simulates delivery.

## 3. Template contract

Use text templates with **all four positional variables** in the body. Do not
put capability tokens in analytics or third-party link shorteners. Provide
realistic non-sensitive examples during template submission.

| Variable | Application value                                                                          |
| -------- | ------------------------------------------------------------------------------------------ |
| `{{1}}`  | Salon name                                                                                 |
| `{{2}}`  | Salon-local appointment date/time; `Receipt` for receipts; `Your next visit` for rebooking |
| `{{3}}`  | Secure booking/receipt URL; `Contact the salon` for rebooking                              |
| `{{4}}`  | Secure channel-unsubscribe URL                                                             |

Suggested bodies to submit for review (not a promise of provider approval):

- **CONFIRMATION / utility:** `{{1}}: Your appointment is booked for {{2}}. Confirm attendance or cancel here: {{3}}. Messaging choices: {{4}}.`
- **REMINDER / utility:** `{{1}}: Reminder for your appointment on {{2}}. Manage your booking: {{3}}. Messaging choices: {{4}}.`
- **RECEIPT / utility:** `{{1}}: Your {{2}} is available securely here: {{3}}. Messaging choices: {{4}}.`
- **REBOOKING / marketing:** `{{1}}: Ready for {{2}}? {{3}} to arrange another appointment. Unsubscribe: {{4}}.`

Use the actual approved categories, not utility to disguise marketing. No online
booking/deposit workflow is included: rebooking directs the customer to contact
the salon. These web pages are English in this release.

## 4. Apply migration and run services

Back up and verify the intended database before migrations. The new migration is
`apps/api/prisma/migrations/20261020180000_messaging/migration.sql`.

```sh
npm ci
npm run db:generate
npm run db:migrate
npm run build
```

Run the API using its existing process configuration. Run a separate worker
process with the same database, secrets, origin and activation switch:

```sh
# Development
npm run worker:messaging --workspace @glampro_suite/api

# Built production worker
npm run worker:messaging:prod --workspace @glampro_suite/api
```

The worker polls every ten seconds and supports multiple processes through
conditional claims. It drains its current batch on shutdown. Configure a process
manager with sufficient graceful-stop time (up to a batch of provider requests).
An interrupted in-flight lease becomes UNCERTAIN, not a blind resend.

No worker starts implicitly with the API. Keep `MESSAGING_ENABLED=false` until
the controlled delivery check. Turning it off stops new batches; it does not
recall already accepted provider messages. Stop/drain workers before emergency
credential changes. Disabling a salon's channel suppresses pending sends at
dispatch rather than creating a backlog to replay later.

## 5. Webhooks and reverse proxy

Configure form-encoded **POST** webhooks:

```text
Inbound SMS/WhatsApp:
https://salon.example.com/api/messaging/webhooks/<tenant-id>/inbound

Delivery status (set automatically on each message):
https://salon.example.com/api/messaging/webhooks/<tenant-id>/status/<job-id>
```

The API validates `X-Twilio-Signature`, the sending Account SID, the exact public
origin/path/query and every form parameter using the official Twilio SDK.
Unverified requests are refused. Do not disable validation for a proxy mismatch.
The proxy must preserve the external `/api/...` path and query string and must
not rewrite the URL Twilio signed. Keep callbacks HTTPS and do not put user
sessions or JWT authentication in their way. Do not let WAF/bot challenges block
Twilio. Monitor rate-limit/provider errors under expected traffic.

If using Twilio's optional Advanced Opt-Out, follow its Messaging Service setup
separately; this release sends with direct `From`. Ensure incoming traffic still
reaches the configured application webhook. The application returns empty TwiML,
not a second confirmation reply. Provider-level opt-out blocks must also be
cleared through the provider's supported flow after a genuine customer opt-in;
staff checking a box does not bypass provider blocks.

**Access logs:** redact or disable request-URI logging for
`/api/public/messages/*` in the reverse proxy, load balancer, APM and error
reporter. Tokens are bearer credentials. The API stores SHA-256 hashes, sets
no-store/no-referrer/noindex headers and redacts public paths in unhandled error
logs. Do not add third-party scripts or analytics to these pages.

## 6. Salon settings and consent

1. Sign in as owner/manager and open **Settings → WhatsApp and SMS**.
2. Publish approved versioned appointment/receipt and optional marketing channel
   wording. Changing wording requires a new version. This product workflow is
   not a legal-compliance determination.
3. Enable only configured channels. Both channels can be enabled; there is no
   automatic WhatsApp-to-SMS fallback or duplicate broadcast to both channels.
4. Save the customer's phone in unambiguous international form, e.g.
   `+6581234567`. No local-country inference or phone-ownership verification is
   performed. Staff must verify the destination with the customer.
5. Record the existing personal-data consent first. For rebooking, also record
   the existing optional marketing choice.
6. In the customer editor, record each channel's service and optional marketing
   choices, with explicit wording-presentation acknowledgement. Select **one**
   preferred channel for automatic booking messages.
7. Receipt messages use the explicitly selected channel and its service consent.
   The saved sale customer is required; no arbitrary phone recipient is accepted.

Phone changes withdraw channel permissions rather than transferring them to a
new destination. Data-consent withdrawal withdraws all channel permissions;
generic marketing withdrawal withdraws channel marketing only. Channel opt-out
withdraws both purposes for that channel, audits the event and suppresses queued
jobs. Dispatch rechecks current consent, number, booking and salon eligibility.

Suggested wording must be approved by the salon, including purposes, provider,
withdrawal contact and any applicable retention/transfers. Do not repurpose old
generic marketing consent as WhatsApp/SMS evidence.

## 7. Scheduling and secure-link behavior

- Confirmation is queued for a new future SCHEDULED booking and relevant edits.
- Reminder defaults to 24 hours before; bookings created within that window get
  no additional reminder. Cancellation/non-scheduled state suppresses old jobs.
- Rebooking defaults to 28 days after recorded completion, requires marketing
  permission and is suppressed if there is a future active booking.
- Quiet hours default to 20:00–09:00 in the salon's saved IANA timezone. Reminder
  due times move earlier; rebooking moves later. If a reminder's allowed window
  was missed, it is skipped rather than sent during quiet hours or after start.
- Timing values are snapshotted when jobs are created. Changes affect subsequent
  booking events; existing due times are not bulk-rewritten. Quiet-hour rules
  are evaluated at processing time. There is no historical-booking backfill on
  activation.
- Booking links show minimal details; GET never changes a booking. POST confirms
  attendance separately from booking lifecycle. Cancellation asks for a second
  confirmation and closes two hours before start by default; no fee/refund is
  triggered. Booking edits invalidate previous links and attendance confirmation.
- Receipt links expire after 30 days, remain read-only and show current void/
  refund markings with stored receipt amounts. They omit customer contacts,
  internal notes and unrelated history. Anyone holding a link can view it.
- Staff can create/copy links and revoke all existing links for a record. Copying
  does not require active delivery channels; the public origin is still required.
- Unsubscribe links expire after one year; GET is inert and POST withdraws that
  channel. Staff can record withdrawal directly if the customer cannot use it.

## 8. Delivery states and operations

| State                  | Meaning / action                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------- |
| PENDING / RETRY        | Waiting for eligible dispatch; not delivered                                       |
| SENDING                | Claimed for a bounded provider request                                             |
| ACCEPTED               | Twilio returned a message SID; not proof of delivery                               |
| SENT                   | Provider sent status; not necessarily handset delivery                             |
| DELIVERED / READ       | Provider-reported delivery/read where available                                    |
| SUPPRESSED / CANCELLED | Ineligible, obsolete, withdrawn or disabled; no automatic retry                    |
| FAILED                 | Definitely unaccepted or configuration failure; manager may retry after correction |
| UNDELIVERED            | Provider failure after acceptance; do not blindly resubmit                         |
| UNCERTAIN              | Timeout, worker interruption or ambiguous outcome; reconcile in Twilio first       |

Only definite rate-limit rejection is automatically retried, with bounded
backoff. Unknown network/server failures are uncertain because Twilio may have
accepted them. Exactly-once external delivery is **not** promised. Duplicate and
out-of-order callbacks do not regress delivered/read status.

Managers can inspect paged history and retry definitely failed jobs. Receipt
double-clicks return the existing job rather than dispatching another accepted
receipt. Uncertain/accepted/undelivered messages cannot be resent from this UI.
Use the job ID in callbacks and the provider SID in Twilio for reconciliation.
Application logs intentionally omit message bodies, destinations and tokens.

Jobs, destinations, links and consent evidence persist until tenant deletion;
there is no automated retention purge or export tool in this release. Set an
operator-approved retention/access policy before production. No bulk marketing,
AI campaigns, two-way chat inbox, automatic refund/cancellation fee or public
rescheduling is included.

## 9. Controlled activation checklist

- [ ] Migration applied to the intended environment and worker/API built.
- [ ] Public HTTPS origin and secret tenant configuration installed in both processes.
- [ ] Sender ownership, country registration, destination permission and spending limits verified.
- [ ] All four WhatsApp templates approved with the four-variable mapping above.
- [ ] Exact signed inbound/status webhook URLs reachable without URL rewrites.
- [ ] Proxy/APM public-link URL redaction verified.
- [ ] Salon wording, customer destination and per-purpose/channel choices recorded.
- [ ] Only test salon/channel enabled; `MESSAGING_ENABLED=true` only for controlled checks.
- [ ] WhatsApp and SMS separately received on authorized test handsets.
- [ ] Link opens correct minimal booking/receipt; opening does not mutate state.
- [ ] Confirm, repeat confirm, cancellation confirmation and cutoff verified.
- [ ] Rescheduling/cancellation invalidates old jobs/links; no duplicate worker send.
- [ ] One-way SMS unsubscribe and reply-capable STOP both withdraw queued delivery.
- [ ] Delivery callbacks update history; spoofed/replayed-invalid callbacks rejected.
- [ ] Quiet hours, retries, rejected templates and provider failure paths checked.
- [ ] Receipt shows stored amounts and void/refund state, without private notes.
- [ ] Record real provider evidence separately from automated test results.

## Official references

Reviewed October 20, 2026. Recheck provider/country requirements at activation.

- [WhatsApp notification templates](https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates)
- [WhatsApp Sandbox](https://www.twilio.com/docs/whatsapp/sandbox)
- [Secure webhooks](https://www.twilio.com/docs/usage/webhooks/webhooks-security)
- [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out)
- [Singapore SMS guidelines](https://www.twilio.com/en-us/guidelines/sg/sms)
- [Alphanumeric Sender IDs](https://www.twilio.com/docs/messaging/services/alphanumeric-sender-ids-in-messaging-services)
- [Messages API](https://www.twilio.com/docs/messaging/api/message-resource)
