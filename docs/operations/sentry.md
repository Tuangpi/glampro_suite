# Sentry error monitoring

Error-only monitoring is integrated in the web app, API and messaging worker.
No DSN means no initialization. Automated test startup never initializes it.
The AI assistant plugin is separate and has not been installed.

## Activate

1. Create a React project and a Node/Express project in your Sentry organization.
2. In the API/worker service environment, set `SENTRY_DSN` to the Node project DSN,
   `SENTRY_ENVIRONMENT=production`, and `SENTRY_RELEASE` to the deployed version tag.
3. Set GitHub repository variable `VITE_SENTRY_DSN` to the React project DSN.
   This is public browser configuration and is embedded during the release build;
   changing the VPS environment alone cannot change an already-built frontend.
4. Optional source-map uploads: set repository secret `SENTRY_AUTH_TOKEN` and
   variables `SENTRY_ORG`, `SENTRY_PROJECT_WEB`, `SENTRY_PROJECT_API` (project slugs).
   Use a least-privilege token permitted to upload release artifacts.
   Web maps are generated only for configured uploads and deleted afterward.
   API/shared maps are injected/uploaded before release packaging when configured.
   A configured upload failure fails the release rather than silently losing maps.
5. Follow the normal reviewed release process. No deployment is performed by this setup.

Local development uses the optional values in each app's `.env.example`. Keep
`SENTRY_AUTH_TOKEN` out of all `VITE_` variables, browser code and committed files.

## Scope and privacy

- Reports unexpected API errors, HTTP errors with status >=500, UI boundary
  errors, uncaught browser errors/rejections, fatal Node errors/rejections,
  unexpected worker batch failures and non-definite provider/job failures.
- Expected HTTP 4xx errors, validation errors and database unique conflicts are
  excluded. Existing responses, worker retry behavior and local logging remain.
- No replay, tracing, profiling, log forwarding or custom metrics. Default
  auto-instrumentation is disabled; only fatal/global error integrations are enabled.
- Outgoing error events use a shared allowlist. Request bodies, headers, cookies,
  user details, breadcrumbs, extra/context data, server name and raw exception
  messages are removed. Stack code-file locations remain; URL queries/fragments
  and non-code filenames are removed. Avoid placing private data in filenames,
  function names, release names or environment labels.
- Generic error text is intentional: inspect protected server logs for details.
  Grouping relies mainly on stack locations instead of private exception messages.
- Sentry still receives network-level information from the reporting connection;
  configure server-side scrubbing, IP retention, access and retention policies in
  Sentry before enabling it for real customers. Source-map uploads contain code.

## Verification

Automated tests cover event filtering/privacy and API/UI reporting without
contacting Sentry or an application database. After deployment to an approved
staging environment, configure its DSNs, trigger a temporary controlled UI/API
failure and verify each appears once with a readable stack and no customer data.
Verify a controlled worker failure separately. Do not leave public crash routes
or trigger real outbound messages just to test monitoring.

Live delivery, alerts and source-map uploads require account configuration and
are not proven by local tests. Existing handled API errors do not automatically
become browser events; API 5xx failures are reported on the server.
