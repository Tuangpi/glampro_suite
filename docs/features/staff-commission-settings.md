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

## Commission progress and Payroll close

**My earnings** is a read-only personal dashboard with **This month**, **Package
sessions**, and **Statement history**. It highlights estimated or approved commission
without showing an invented zero for uncalculated months. Calculation metadata and
commission activity use expandable details; payslip exclusions and recorded-session
limitations live under **About these figures**. Refresh only reloads saved results.

**Commission progress** (formerly **This month**) is a read-only projection of
the last stored Payroll close calculation, not another rule editor or live sales
total. An uncalculated month says **Not calculated**, without implying zero
earnings or showing a redundant missing-statement message. Saved draft results
say **Estimated**; approved results say **Frozen**.

**Settings → Payroll** groups **Commission progress** and **Monthly close** in
two lazily mounted tabs; visited tabs remain mounted to preserve close drafts.
Team & commissions contains earning configuration, not a duplicate progress view.
Existing `?section=payroll` bookmarks continue to open Monthly close.

Management progress links to Payroll close for the displayed month. Payroll close
opens valid `?period=YYYY-MM` links without calculating and links back to that
month's progress. These are in-app links so mounted Settings drafts survive.
`?section=payroll&payroll=close` selects close and
`?section=payroll&payroll=progress` selects progress. Old
`?section=team&team=progress` bookmarks redirect to Payroll progress, preserving
the month and other parameters.
Self-service progress does not offer management navigation.

**Refresh saved results** only reads stored output. Calculate/recalculate is an
explicit Payroll close action; later transactions require recalculation. Close
actions invalidate progress caches, including current-month and self-service
views. Neither navigation nor refresh approves, activates or pays payroll.

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

## Pay-plan workflow and status

Pay plans opens a compact list of names, draft/published/scheduled/archived status,
assignment counts and Edit/View, Assign staff and History actions. Create plan
opens sample-template creation or duplication, rather than leaving those controls
in every editor. Samples must be reviewed before publication.

Editing has three steps: **Details**, **Earning rules**, and **Review**. Uncommon
base/category/cap controls and tenure/incentive/order controls use disclosures
that summarize existing rules. Tier bands appear only for tiered methods; saved
values are preserved when hidden. Review shows a rule summary, effective date,
calculator and Save draft / Publish actions. Method comparisons are optional.
Technical JSON and archival actions live in Advanced tools. Version history,
configuration audit and historical impact each have separate views.

Settings no longer duplicates salary/employment forms: use **Staff → select a
person → Payroll**. Assign staff opens the bulk assignment controls only, and
unpublished or not-yet-effective-in-the-month plans cannot be submitted. Payroll
policies contains the connected join-cutoff and negative-base policies.

Company-wide minimum-deposit/refund-fee values, plan positions and raw outlet IDs
are removed from these editors, **not deleted from storage**. Saves retain their
original values and revision boundaries. Checkout continues to use the individual
package deposit; refunds use explicitly supplied administration fees. Existing
scope and financial policy remain unchanged.

Settings saves, publication, assignment and archival ask for an audit reason in
a confirmation dialog. Failed requests retain the reason and local draft. Editor
steps and auxiliary views keep drafts mounted; switching plans asks before
explicitly discarding unsaved metadata, rules or JSON. Saving policies does not
silently erase a separate rule draft. Staff-profile saves retain their own reason
field and salary/employment revision checks.

A compact activation status reads `/api/payroll-cutover`, not the configuration
endpoint's legacy `earningsActive: false` placeholder. It distinguishes not
activated, scheduled, active and rolled back using the salon's business month.
Failed or invalid responses remain **unavailable** with retry. Saving, publishing
or assigning does not activate payroll or send payment. Activation still requires
the existing owner-reviewed process.
