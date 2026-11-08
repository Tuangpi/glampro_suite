# Staff commission settings

## Individual changes

Open **Staff → select a person → Commissions**. Default rates are the primary
editor. Each commission type distinguishes:

- **Unconfigured:** no staff-default publication exists. Existing service rates
  retain the legacy staff fallback; other types use the existing resolver defaults.
- **Use company default:** publishes explicit inheritance, including opting a
  service out of its legacy staff fallback.
- **Custom rate:** publishes a percentage; zero explicitly earns nothing.

Only edited types are published together, using the existing revision-checked
bulk publisher. A reason is required; an empty effective date means now, and a
provided date uses the browser's time zone. Displayed current rates exclude
scheduled changes. Item, package and department overrides still take precedence;
base rates are not a guaranteed pay-plan award.

**Exceptions & history** is secondary and holds the existing override editor,
current/scheduled rules, item preview and publication history. Staff-default
editing stays in the primary editor. Drafts survive profile section switches.
Save each form before leaving the profile.

## Shared configuration and team reviews

**Settings → Team & commissions** opens **Company rules**. **Rate overview**
compares the team's base defaults read-only, with staff names linking to their
Commissions section. **Bulk edit rates** explicitly enables the existing matrix
publisher. Publish or reload/discard the draft before searching, paging or exiting
bulk-edit mode. Existing `?team=rates` links remain supported.

Owner/manager commission permissions and suspended-salon read-only behavior are
unchanged. This UI does not activate earnings, change historical snapshots,
introduce rate templates or alter pay-plan policy.

## Pay-plan owner verification

Owners must enable their own email two-factor authentication to access pay plans.
When required, Pay plans shows a setup card linking to **Privacy & security →
Account security**, not a generic loading error. Turn on **Email verification code
at sign-in** and confirm the emailed six-digit code. The switch stays off until
confirmation succeeds; actual email delivery requires SMTP configuration.

Entering security settings from that setup link provides **Back to Pay plans**
once verification is enabled. Plans reload using the refreshed account state.
Other request failures retain their error details and Retry plans action. The API
identifies this specific security requirement with `OWNER_TWO_FACTOR_REQUIRED`
(HTTP 403); generic permission failures do not offer two-factor setup.
