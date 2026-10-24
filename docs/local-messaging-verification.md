# Local messaging and assistant verification

## Scope

MSG-01 verifies existing email and approved-SMS workflows without external
delivery. It does not activate a salon, migrate the application database, expand
assistant channels or authorize production credentials.

- Owner login/enrollment codes and receipts use an ephemeral capture-only SMTP
  server bound to `127.0.0.1`. It does not forward mail or log message bodies.
- The assistant acceptance injects a fake sender into `runMessageBatch`; it never
  calls the provider SDK to send a message.
- Assistant delivery remains SMS-only. WhatsApp and promotions remain gated.
  General appointment messaging supports separately configured channels; that does
  not imply assistant WhatsApp delivery is supported.

## Repeatable checks

From `/home/tuangpi/Documents/Aridient/Glampros/glampro_suite/apps/api`, run the
following only after provisioning **fresh disposable PostgreSQL databases** and
replaying migrations against each explicit URL. Never substitute the application
database. The acceptance files enforce these loopback ports/database names.
Run each suite in a separate process because environment/SMTP configuration is
cached at module import.

```sh
DATABASE_URL=postgresql://postgres@127.0.0.1:55439/sec01_acceptance \
  SEC01_ACCEPTANCE=1 node --import tsx --test src/routes/auth-security.acceptance.test.ts

DATABASE_URL=postgresql://postgres@127.0.0.1:55443/oa05_acceptance \
  RUN_OA05_ACCEPTANCE=true node --import tsx --test src/services/assistant-drafts.acceptance.test.ts

DATABASE_URL=postgresql://postgres@127.0.0.1:55444/oa06_acceptance \
  RUN_OA06_ACCEPTANCE=true node --import tsx --test src/routes/assistant-explanation.acceptance.test.ts
```

The SEC-01 test configures its own loopback SMTP host/port and test sender before
importing the application. Receipt requests are made through the actual HTTP route
as a cashier. It checks stored GST after company settings change, discount/split
tenders, HTML escaping, unchanged sale evidence, refunded receipt delivery,
invalid recipient/session rejection and `503 EMAIL_SEND_FAILED` after the local
SMTP capture is stopped. Owner verification also checks replay refusal and hashed
codes; capture contents remain in test memory only.

OA-05 checks explicit approval/queue separation, stale/concurrent edits, duplicate
queue requests, exact provider payload, consent/destination/actor/tenant changes,
bounded retry, uncertain-send refusal, company quota and immutable audit history.
OA-06 checks authenticated read-only explanations, tenant/role/module boundaries,
per-user limits and refusal behavior. Ordinary messaging tests additionally cover
competing workers, callback-state progression, opt-outs, quiet hours and signed
webhooks using synthetic inputs.

Stop the disposable PostgreSQL services after verification. Test captures and
temporary logs are not durable release evidence. Do not print OTPs, bearer links,
customer data or credentials into handoff notes.

## Limits

These are automated service/HTTP/component checks, not a browser walkthrough,
external mailbox delivery, provider sandbox certification or real handset test.
Provider acceptance is not delivery; provider-reported delivery is not reading or
conversion. Real delivery, production SMTP, retention/security operating details
and OA-07 target/recovery evidence remain separate operational work. No new
business/channel policy is inferred from these checks.
