# WhatsApp and SMS — operator guide

Twilio delivery is operator-managed, **off by default**, and requires separate
approval for paid traffic. Installing code does not register senders or prove delivery.
Self-service onboarding is not implemented; unavailable channels show **Coming soon**.

## 1. Setup

1. Use a salon-owned/authorized sender and preferably separate Twilio accounts or
   subaccounts for unrelated salons. Account SID/token must match the sending account.
2. **WhatsApp:** start with a joined sandbox handset; complete production onboarding
   and obtain four approved Content Template SIDs. Sandbox may not support custom
   templates; never bypass template checks. All sends use ContentSid/ContentVariables.
3. **SMS:** verify country permissions/registration, authorized sender, destination
   restrictions, and budgets. For Singapore, recheck Twilio/SSIR/SGNIC requirements.
   Accepted API requests do not prove sender registration. Unicode/long SMS can cost
   multiple segments. One-way senders need the web unsubscribe option.
4. Provide the same database, origin, secrets, and switch to API and worker:

```dotenv
MESSAGING_ENABLED=false
MESSAGING_PUBLIC_ORIGIN=https://salon.example.com
```

Use a public HTTPS origin without path/query/credentials, serving the API at `/api`.
Local development may use localhost HTTP; provider callbacks still need reachable HTTPS.
Never derive links from an untrusted Host header.

Inject `MESSAGING_TENANTS_JSON` privately using this shape (not usable credentials):

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

Keys are exact internal tenant IDs, not slugs. Never expose tokens/config through
frontend variables, responses, logs, screenshots, or git. System readiness requires
the switch, origin, and tenant sender config (all four templates for WhatsApp).
Salon toggles cannot bypass it. Secure-link copying does not require delivery activation.

### WhatsApp template contract

Every template body needs all four positional variables:

| Variable | Value                                                                             |
| -------- | --------------------------------------------------------------------------------- |
| `{{1}}`  | Salon name                                                                        |
| `{{2}}`  | Salon-local booking time; `Receipt` for receipts; `Your next visit` for rebooking |
| `{{3}}`  | Secure booking/receipt URL; `Contact the salon` for rebooking                     |
| `{{4}}`  | Channel-unsubscribe URL                                                           |

Configure **CONFIRMATION**, **REMINDER**, **RECEIPT**, and **REBOOKING**.
Submit realistic, non-sensitive examples. Use actual approved categories; never
label marketing as utility. Do not put bearer links in shorteners or analytics.

### Database and worker

Review `20261020180000_messaging` and all pending migrations; back up and obtain
approval. Production uses the [CI/CD migration procedure](CI_CD.md#approved-migrations),
not an ad-hoc build/install on the VPS. The later channel-availability gate needs
no additional migration.

For local development from the repository root:

```sh
npm ci
npm run db:generate
npm run build
npm run worker:messaging --workspace @glampro_suite/api
```

The built worker entry is `npm run worker:messaging:prod --workspace @glampro_suite/api`.
It is separate from the API. For VPS enable/disable steps see
[CI/CD messaging](CI_CD.md#messaging-and-diagnostics).
Allow graceful batch draining; interrupted in-flight jobs become UNCERTAIN.
Switching off prevents new batches but cannot recall accepted messages. Drain/stop
workers before emergency credential changes. Disabled salon channels suppress queued sends.

## 2. Webhooks and privacy

Configure form-encoded **POST** endpoints:

```text
Inbound:
https://salon.example.com/api/messaging/webhooks/<tenant-id>/inbound
Status (set on each message):
https://salon.example.com/api/messaging/webhooks/<tenant-id>/status/<job-id>
```

- Preserve the exact public path/query signed by Twilio. Allow callbacks through
  proxy/WAF without user-session/JWT challenges. Never disable signature validation.
- The API verifies signature, sending account, URL, and form parameters.
- Redact/disable request-URI logging for `/api/public/messages/*` in proxy, APM,
  and error reporting. Links are bearer credentials; no analytics/third-party scripts.
- If using Advanced Opt-Out, configure its Messaging Service separately; this app
  sends direct `From`. Keep inbound webhooks working. Provider opt-out blocks need
  provider-supported opt-in; a staff checkbox cannot clear them. The app returns empty TwiML.

## 3. Salon settings and daily use

1. As owner/manager open **Settings → WhatsApp and SMS**.
2. Publish salon-approved versioned service/receipt wording and optional marketing
   wording. This is not legal sign-off; do not reuse generic marketing consent.
3. Enable configured channels only. There is no automatic fallback or dual broadcast.
4. Verify the customer's international-format phone number. Record data consent,
   each channel's service/marketing choices, and wording acknowledgement. Rebooking
   also needs marketing consent. Choose one preferred channel for booking messages.
5. Receipt sends use the saved sale customer, selected channel, and service consent;
   no arbitrary recipient. Failed settings loading blocks sends.

Phone changes withdraw channel permissions. Data-consent withdrawal removes all
channel permissions; marketing withdrawal removes channel marketing. Channel opt-out
withdraws both purposes for that channel and suppresses queued delivery. Dispatch
rechecks current number, consent, booking, and eligibility.

| Behavior          | Default / rule                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Confirmation      | New future SCHEDULED bookings and relevant edits                                                                           |
| Reminder          | 24 hours before; no extra reminder for bookings created within that window                                                 |
| Rebooking         | 28 days after completion; suppress if a future active booking exists                                                       |
| Quiet hours       | 20:00–09:00 salon IANA timezone; reminders move earlier, rebooking later; missed reminders skip                            |
| Booking links     | GET is inert; POST confirms attendance; cancellation requires confirmation, cutoff 2 hours before; no automatic fee/refund |
| Receipt links     | Read-only, expire after 30 days; stored amounts plus current void/refund state, no private notes/contacts                  |
| Unsubscribe links | GET is inert; POST withdraws channel; expires after one year; staff can record withdrawal                                  |

Timing settings snapshot at job creation; quiet hours recheck at processing.
No historical-booking backfill. Booking edits invalidate old links/confirmation.
Staff can revoke links. Anyone holding a valid link can view it; protect it.

## 4. Delivery and troubleshooting

| State                   | Operator action                                                   |
| ----------------------- | ----------------------------------------------------------------- |
| QUEUED / PROCESSING     | Await eligibility/worker processing; not delivery proof           |
| ACCEPTED / SENT         | Provider accepted/sent; not handset-delivery proof                |
| DELIVERED / READ        | Provider-reported delivery/read where available                   |
| SUPPRESSED / CANCELLED  | No automatic retry; inspect eligibility or withdrawal             |
| FAILED                  | Correct a definite rejection/config error, then manager may retry |
| UNDELIVERED / UNCERTAIN | Reconcile provider SID/job in Twilio; do not blindly resend       |

Only definite rate-limit rejection automatically retries with bounded backoff.
Timeouts/interruption may mean Twilio accepted the message. Exactly-once delivery
is not guaranteed. Duplicate/out-of-order callbacks do not regress delivered/read.
Receipt double-clicks reuse existing jobs. The UI cannot resend accepted, uncertain,
or undelivered messages. Never log message bodies, destinations, or tokens.

Jobs, destinations, links, and consent persist until tenant deletion; no automated
retention purge/export exists. Approve an access/retention policy before activation.
No bulk/AI campaigns, chat inbox, public rescheduling, or automatic cancellation fees.

## 5. Controlled activation checklist

- [ ] Approved target migrations/build, sender ownership/registration, country permissions, and budget verified.
- [ ] API/worker have matching private config, origin, and all approved template variables.
- [ ] Signed callbacks reachable unchanged; spoofed callbacks rejected; bearer-link logs redacted.
- [ ] Salon wording, verified destination, and per-purpose/channel consent recorded.
- [ ] Enable only authorized test salon/channels; then set `MESSAGING_ENABLED=true` for controlled checks.
- [ ] Receive WhatsApp and SMS separately on approved test handsets; process status callbacks.
- [ ] Check minimal links, inert GET, repeat confirmation, cancellation cutoff, and receipt void/refund state.
- [ ] Check edits invalidate jobs/links; no duplicate send; unsubscribe/STOP suppress queues.
- [ ] Check quiet hours, retries, rejected templates, and uncertain outcomes.
- [ ] Record real provider evidence separately from automated tests before broader approval.

## Official references

Reviewed October 20, 2026. Recheck provider/country requirements at activation.

- [WhatsApp notification templates](https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates)
- [WhatsApp Sandbox](https://www.twilio.com/docs/whatsapp/sandbox)
- [Secure webhooks](https://www.twilio.com/docs/usage/webhooks/webhooks-security)
- [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out)
- [Singapore SMS guidelines](https://www.twilio.com/en-us/guidelines/sg/sms)
- [Alphanumeric Sender IDs](https://www.twilio.com/docs/messaging/services/alphanumeric-sender-ids-in-messaging-services)
- [Messages API](https://www.twilio.com/docs/messaging/api/message-resource)
