# Commission & Payroll decisions

## Status and authority

Adopted for local implementation October 27, 2026 under the user's delegation to
use recommended decisions. These are policy/design decisions, not claims of
implemented behavior or production activation. Future conflicts must be recorded.

## SRS decisions and open points

### CP-004 isolated acceptance authorization (October 28, 2026)

- Owner explicitly authorized isolated disposable-database CP-004 acceptance only;
  application/production databases remain off-limits. Used fresh loopback 55476
  `/tmp` PostgreSQL cluster, explicit URL and disabled dotenv. No application DB
  repair, activation, deployment, commit or push is authorized. Earlier migration
  incident is not erased by successful disposable acceptance. Stop test cluster
  afterward. This is not blanket permission for future database work.

### CP-004 value-package refund arithmetic (October 28, 2026)

- Multi-collection safety: an aggregate seller refund base cannot represent
  conflicting historical fallback rates. Positive value-package payouts therefore
  require a recorded, numerically consistent rate per original seller across all
  collection sources. Missing/differing rates fail closed before writes; never use
  database result order or current rules to choose one. Equal decimal spellings
  are accepted. Zero-payout cancellation creates no negative bases and does not
  require equal rates. Supporting differing-rate refunds needs a separately defined
  rate-lot allocation policy, not arbitrary first-source selection. This limitation
  is not completion of multi-payment or transactional acceptance.
- Apply CP-D08 to original paid consideration, not promotional face credit. Used
  net value is the cumulative four-decimal VP_SPEND paid-to-credit ratio for credit
  consumed. Subtract that value and the approved net fee from collected net; floor
  at zero and round down only at the customer cent boundary, as for session refunds.
- Refund tax is proportional to original collected tax using half-up cent rounding.
  Original tax/collections must be independently source-validated by the future
  transaction service; the ratio snapshot alone does not prove collection or GST.
- Preserve earned VP_SPEND evidence. Cancel remaining face credit and uncollected
  original debt separately; neither is extra customer cash or a new commission base.
- Pure arithmetic/schema tests are not refund workflow acceptance. API/UI wiring,
  source lineage/collection reconciliation, locking, retry/conflicting retry,
  reversal-after-refund refusal and real rollback/race tests remain outstanding.
  All database work remains paused; no activation or deployment is authorized.

### CP-004 refund and source economics clarification (October 28, 2026)

- SRS section 4 package settings explicitly says fixed dollars **per sale**, versus
  redemption **per session**. Retain one sale award per source sale line, including
  quantity >1, once on its first collection. Quantity remains separate engine units.
  A later instalment never earns the award again, even if prior net was zero.
- Refund clawback uses the original captured fixed award, not current settings;
  prorate by refunded net / original purchase net at four-decimal precision. The
  existing one-refund-per-holding restriction caps total clawback at that award.
- CP-D08's zero floor permits reasoned cancellation of unused sessions with no
  payout. Require explicit `payoutGrossCents: "0"` and `payoutMethod: "NONE"`;
  positive amounts require actual tender. No cash movement/provider call is implied.
  Reconcile ordinals, original collections/sellers and outstanding debt atomically.
  Zero payout writes cancellation evidence, not zero-valued payable/clawback lines.
- OP-2 full list price is the source-time service nonmember catalogue price, captured
  independently of member pricing/discounts. FOC remains full-list-price activity
  beside credit-funded paid lines. Apply plan base/rate once in the engine; preserve
  explicit unavailable evidence rather than retroactively inventing list prices.
- This is local implementation policy, not transactional acceptance or permission
  to access any database. The existing DB pause and release gates remain in force.

### CP-004 prospective package configuration (October 28, 2026)

- Package sale and redemption each require explicit FOLLOW_PLAN, EXCLUDE or FIXED
  selection. Fixed amounts are exact decimal strings; minimum deposit is an explicit
  0–100% exact string. No mode, award or deposit is inferred for existing packages.
- Configuration is restricted to authenticated, enabled salon owners with existing
  two-factor verification, consistent with the payroll owner boundary. Updates
  require the package updatedAt token and a reason; before/after audit is atomic.
- Completed purchases copy settings under the existing package row lock. Later
  changes affect future purchases only. Legacy null holding snapshots remain null.
  Old economics snapshots without settings remain valid but explicitly incomplete.
- Settings capture is not earnings activation, fixed-award posting, deposit
  enforcement or paid-session acceptance. Those integrations remain CP-004 work.

### CP-003 configuration-only acceptance — approved October 28, 2026

- The user approved Option 2: accept configuration separately, provided it works
  safely without a historical monetary preview. This supersedes the earlier
  requirement to complete monetary preview integration within CP-003.
- CP-003 retains configuration persistence, published version immutability,
  assignments, profiles/settings, audit/authorization, sample-input calculator,
  comparison and read-only historical readiness. Missing evidence must return
  `UNAVAILABLE` with `impact: null`, never an estimated zero or legacy repricing.
- Move authoritative historical monetary integration and preview/full-run equality
  to CP-003A, dependent on CP-004 source capture and CP-005 frozen statements/carry.
  Historical monetary preview remains a must-have and a CP-007 release gate.
  Configuration readiness/inventory and sample calculations do not satisfy it.
- CP-003 is IN PROGRESS pending configuration-only acceptance review, not DONE by
  scope approval alone. CP-004 still depends on accepted CP-003 configuration;
  CP-005 depends on CP-004, and CP-003A follows CP-005 without a dependency cycle.
- Configuration must remain non-activating: no payroll earnings, payout changes,
  historical backfill or changes to approved statements. Production migration,
  activation and deployment require separate authorization. Do not start CP-004
  as part of this scope-revision task.

### CP-003 historical-preview evidence boundary (October 27, 2026)

- Last closed month means the last completed calendar month in the persisted salon
  timezone, not an assertion that a payroll statement is approved/frozen.
- Read-only readiness may resolve effective assignment/version configuration, with
  pre-close staff/salon audit evidence. Missing historical settings stay unavailable;
  never substitute current join dates, current catalogue values or assumed defaults.
- Existing collection candidates and rate-bearing legacy earnings do not establish
  complete rate-free bases, outlet/category/fixed-award evidence, frozen carry or
  authoritative group metrics. Return explicit UNAVAILABLE/null impact until those
  inputs can be proven. Counts are inventory only; no partial payout estimate.
- This boundary does not accept TC-25, enable earnings or start CP-004. Under the
  October 28 scope revision, monetary integration/full-run equality belong to
  CP-003A rather than CP-003 configuration acceptance.

| ID         | Adopted decision                                                                                                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1        | Package-sale base is actual collected net consideration, excluding GST, on each collection date; refunds are negative bases.                                                                                                                        |
| D-2        | Staff are assigned versioned plans with monthly tiers and tenure stages.                                                                                                                                                                            |
| D-3        | Redemption uses original purchase session economics, never current catalogue prices.                                                                                                                                                                |
| D-4 / OP-1 | Methods are component settings. Seed On course as whole-tier; allow effective-dated changes with impact preview.                                                                                                                                    |
| D-5        | Calendar-month assignment and published version effective on the last local day apply to the whole month.                                                                                                                                           |
| D-6        | No-plan staff use existing flat-rule precedence; no double payment alongside plan results.                                                                                                                                                          |
| D-7        | Refund negative sale base goes to original sellers; legitimately earned redemption commission remains. Voiding a session is a distinct reversal.                                                                                                    |
| D-8        | Only paid-for sessions may be redeemed; extra sessions require verified manager PIN authorization and audit reason. Never trust a client-supplied manager ID.                                                                                       |
| OP-2       | FOC base is full snapshotted list price; apply 50% base and 5% rate once in the Hair plan. A list price of 492 gives 12.30, not 24.60.                                                                                                              |
| OP-3       | Hair top band remains 25% above 25,000, without cap by default.                                                                                                                                                                                     |
| OP-4       | New-staff Hair stage is months 1–3; TP has one standard stage, not the Hair override.                                                                                                                                                               |
| OP-5       | Seed individual incentive metric is SVC + PKG_SALE + PRD; exclude redemption.                                                                                                                                                                       |
| OP-6       | Default group metric is salon-wide actual net cash collected within one tenant. Outlet scope remains configurable as required by FR-INC-04. This deliberately differs from the SRS proposed outlet default and follows the approved recommendation. |
| OP-7       | Seed VP_SALE with package sales and VP_SPEND with On course. Preserve paid-to-credit ratio snapshots through spends/transfers.                                                                                                                      |
| OP-8       | Join month counts as month 1 even after the 15th; delayed-month setting is off by default and remains configurable.                                                                                                                                 |
| OP-9       | Configurable defaults: minimum deposit 30%; refund administration fee SGD 100. Changes must not rewrite purchase evidence.                                                                                                                          |

## Integration decisions

| ID     | Adopted decision / acceptance consequence                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CP-D01 | New plans are authoritative after controlled prospective activation. Existing transaction-rate evidence remains historical/fallback evidence, not an additional payable result.                                                                                                                                                                                                                                                                   |
| CP-D02 | New base capture uses existing receipts, payments, users, holdings, transfer and valuation records. Do not deploy the demo's independently mutable staff/holding mirrors.                                                                                                                                                                                                                                                                         |
| CP-D03 | Existing exact-cent allocation is authoritative for operational purchase value. Store separate four-decimal commission unit snapshots where required. Paid-session checks compare exact values without epsilon; reconcile final-session/split residuals. A multi-service set consumes one defined package unit, not one unit per service line.                                                                                                    |
| CP-D04 | Cash means settled external monetary consideration, not notes-only. Card/electronic payments qualify. Package sessions, prepaid credit and gift-card redemption do not create fresh cash collection. Mixed receipts and GST require explicit source allocation. Unsupported/unsettled tender evidence is rejected, not guessed.                                                                                                                   |
| CP-D05 | Approved periods and complete payroll statements are immutable. Freeze base selection, plan/stage, profiles, adjustments, collection denominator, calculation version, carry-forward and totals. Record an input revision/hash and reject stale calculation approval.                                                                                                                                                                             |
| CP-D06 | Approval locks a statement; it does not assert money has been paid. Record payout confirmation separately with actor/time/reference; no bank integration is implied.                                                                                                                                                                                                                                                                              |
| CP-D07 | Include departed/disabled staff with period activity, carry-forward or amounts owed. Disable future attribution without erasing historical statements.                                                                                                                                                                                                                                                                                            |
| CP-D08 | Refund = max(0, collected net consideration minus used-session net value minus configured fee), subject to the approved package policy. Preserve original GST/tender accounting separately; never substitute a commission formula for the customer cash/GST refund ledger. Fixed sale awards are paid once; refunds proportionally claw back their original award against refunded net purchase consideration, cumulatively capped at that award. |
| CP-D09 | Negative bases carry to the same stable component key by default; write-off is configurable and audited. Component removal/plan switches require an explicit mapped carry balance or audited write-off, never silent loss.                                                                                                                                                                                                                        |
| CP-D10 | No automatic legacy-value invention or retrospective payroll rewrite. Cutover inventory must classify reliable, incomplete and already-paid evidence. Historical dates are not a go-live commitment.                                                                                                                                                                                                                                              |
| CP-D11 | Reuse current flat-rule hierarchy for no-plan staff, including staff/item/department/company behavior. Resolve fallback rate at source time and preserve evidence. Package fixed/excluded handling still applies without a plan.                                                                                                                                                                                                                  |
| CP-D12 | Payroll export/approval and salary-profile changes are salon SUPER_ADMIN-only; managers calculate and adjust with reasons. Follow SRS permission table rather than looser demo routes. Staff self-service is own-data-only.                                                                                                                                                                                                                       |
| CP-D13 | Implement real Excel summary + per-staff sheets and payslip PDF. CSV may be additional, not a substitute. Choose libraries only after checking existing dependencies and requirements.                                                                                                                                                                                                                                                            |
| CP-D14 | Ship specified manual payroll components only, not statutory payroll. No CPF, IR8A, GIRO, automatic leave calculation or legal-compliance claim.                                                                                                                                                                                                                                                                                                  |
| CP-D15 | Monthly boundaries are local start inclusive / next month start exclusive, avoiding end-of-day precision loss. Default SGD and Asia/Singapore; no mixed-currency totals.                                                                                                                                                                                                                                                                          |

## Known source discrepancies resolved

### CP-004 purchase session precision (October 28, 2026)

- New holdings capture original contracted net consideration, stored GST, original
  session grant, sellers and source IDs at completion, independently of activation
  of the operational exact-cent package-value ledger. Contract value is not cash
  collected; subsequent collections never rewrite the purchase snapshot.
- Commission session values allocate original net value in 0.0001 units. Store the
  per-session floor plus number of initial ordinals receiving one extra tick.
  Original ordinal ranges reconcile exactly to purchase net and split deterministically.
  Do not substitute operational cent-rounded values or current catalogue prices.
- These are economics-only facts, not complete payroll inputs: absent package
  commission settings, confirmed currency or sellers remain explicitly missing.
  No assumed FOLLOW_PLAN mode, paid-session approval, fallback, fixed award or
  earnings activation. Legacy holding snapshots stay null; ownership changes retain
  original purchaser/source/seller evidence.

### CP-003 outlet assignment and pooling contract (October 27, 2026)

- Retain one effective-dated plan timeline per staff member, selected on the last
  day of the payroll month. Plan outlet scope is eligibility, not a second independent
  staff assignment timeline. An empty outlet list means all outlets in the tenant;
  selected outlets pool together once for component tiers and monthly caps.
- New assignment events snapshot the plan's outlet IDs server-side. Legacy
  assignments without outlet IDs are company-wide: only company-wide plans were
  assignable before this change. Clients cannot submit assignment scope. Plan scope
  remains immutable metadata; duplicate a plan to change it. Existing closed rows
  and their scope are retained when replacing an assignment.
- Company-context owners may assign published scoped plans, including during atomic
  classified creation. All selected outlets must currently be active in the tenant.
  Outlet sessions still cannot mutate/read company-wide staff timelines or salary
  profiles. No assumption is made that department links identify outlets.
- Out-of-scope activity uses the existing source-time flat-rule fallback, not the
  scoped plan's tiers. Shared partitioning returns disjoint plan/fallback inputs
  without dropping activity; scoped calculation rejects unpartitioned out-of-scope
  lines. Missing active-line outlet evidence fails closed for a scoped plan.
- This continuation delivers assignment snapshots, selection UI and the pure
  pooling boundary contract. Combining plan/fallback results, keeping incentive
  metrics and carry balances correctly scoped, and frozen statement reconciliation
  remain CP-005 integration work. No new earnings path is enabled or paid twice.
  Authoritative historical preview and authenticated browser acceptance remain open.

### CP-003 mandatory classified creation (October 27, 2026)

- Every staff create request requires an explicit reasoned payroll classification
  and authoritative join date. Commission earners also require an initial published
  plan with current-month and ongoing coverage. The shared runtime schema and direct
  service entry point reject identity-only creation; the transactional helper also
  rejects absent classification. Identity, branch links and payroll audit save together.
- Classification remains owner-only. Staff POST is therefore salon SUPER_ADMIN-only,
  with existing owner verification and writable-tenant checks in the transaction.
  Managers retain profile-edit/suspension permissions but cannot create an
  unclassified identity or assign themselves classification-write privileges.
  The UI hides manager creation and explains that owner setup is required.
- This deliberately supersedes the earlier identity-only creation compatibility
  exception and manager POST behavior. No role, title or legacy rate implies a
  classification. Existing unclassified records are not automatically rewritten.
- Company-only initial plan restrictions remain until outlet pooling is implemented.
  This closes the staff endpoint's mandatory creation gap, not full FR-ASN or CP-003
  acceptance. Platform provisioning and unrelated authentication flows are unchanged.

### CP-003 unclassified active-edit enforcement (October 27, 2026)

- Active staff PATCH now fails closed when the latest audited commission
  classification is absent or unrecognized. Login role, position and legacy rate
  cannot substitute for owner-reviewed payroll setup. The error directs callers
  to the existing owner-only, reasoned payroll settings workflow.
- Suspension and maintenance while disabled remain possible. Reactivation requires
  an explicit supported classification, authoritative join date and, for commission
  earners, the existing current-month and ongoing plan coverage checks. Validate
  under the tenant configuration lock before identity or department-link writes.
- This supersedes the earlier unclassified **edit** compatibility exception only.
  Identity-only creation remains an open lifecycle gap; no automatic classification,
  historical rewrite, earnings activation or full FR-ASN-01 acceptance is claimed.
- HTTP fixtures explicitly record synthetic classification rather than infer it
  from roles. Immutable test audit is retained with uniquely named test tenants;
  cleanup does not disable triggers or delete configuration evidence.

### CP-003 classified staff edit/reactivation guard (October 27, 2026)

- General staff PATCH validates the latest audited payroll classification while
  holding the same tenant configuration lock as payroll writes. Active classified
  staff require an authoritative join date; commission earners also require
  current-month-end and open-ended plan coverage using the payroll validator.
- Reject inconsistent active edits before updating identity or department links.
  The caller cannot evade these guards through login-role, title or department
  changes, or by omitting date fields from PATCH.
- Disabling an account must remain available even when its payroll configuration
  is inconsistent. Disabled profiles may be maintained; reactivation requires
  valid classified configuration. Owner-only audited payroll repair/reclassification
  remains the recovery path; managers do not gain classification-write privileges.
- Legacy unclassified records still need explicit lifecycle/cutover work. This
  guard does not classify them automatically, activate earnings or establish full
  FR-ASN-01 acceptance.

### CP-003 atomic classified staff creation (October 27, 2026)

- Staff creation may supply a reasoned `payrollClassification`. It requires an
  authoritative join date; commission-earning classification also requires an
  initial assignment. Identity, department links, assignment and classification
  audit commit together using the existing owner-verified configuration lock.
- Reuse payroll settings validation inside that transaction, not a second service
  transaction after identity creation. A future-only plan fails current-month
  coverage and rolls back the whole creation. Non-commission classification may
  be created without a plan, but still requires join date, reason and owner access.
- This is the classified creation path, not a silent compatibility cutover.
  Identity-only creation remains unclassified, manager permissions are not expanded,
  and mandatory create/edit lifecycle enforcement is still open. Do not claim
  FR-ASN-01 accepted until those paths are integrated and verified.

### CP-003 explicit commission classification (October 27, 2026)

- Payroll commission classification is independent of `globalRole` (login
  permissions), free-text position and legacy flat commission rate. Do not infer
  eligibility from any of those fields. Owner-only reasoned STAFF configuration
  events hold `COMMISSION_EARNING` or `NON_COMMISSION` without a mirrored user row.
- Existing events without classification read as null: **Not classified — review
  required**, not an automatic exemption. Omitted classification preserves the
  previous audited value; explicit null/empty/unknown classifications are rejected.
- Marking staff commission earning requires their authoritative join date, an
  assignment covering the last day of the current salon-local payroll month and
  an open-ended assignment (no scheduled removal). Assignment removal is blocked
  while classified commission earning. Explicitly reclassify with a reason first.
- All comparisons and writes share the tenant configuration lock and revision
  checks. This policy applies to configuration only; it does not activate earnings,
  reprice historical activity or make classification an authentication permission.
- Mandatory create/edit classification and plan/join-date lifecycle enforcement
  remain open. This incremental workflow is not FR-ASN-01 acceptance. Future work
  must resolve legacy unclassified staff deliberately, not silently exempt them.

### CP-003 assignment/join-date consistency (October 27, 2026)

- An initial or replacement plan assignment cannot start before the authoritative
  staff join date. An audited join-date edit cannot move that date after any
  existing assignment start, including closed historical assignments.
- Validate both directions under the tenant configuration lock, before writing
  assignment history or staff settings audit. Rejected changes leave dates,
  timelines and audit revisions unchanged. This does not classify commission roles
  or satisfy mandatory plan/join-date enforcement for every staff lifecycle path.

### CP-003 atomic initial assignment (October 27, 2026)

- Add an optional `payrollAssignment` to staff creation: non-null plan, prospective
  assignment date, captured company assignment revision and audit reason. A join
  date is required when supplied. Identity, department links and assignment audit
  use one transaction under the existing tenant configuration lock; hashes are
  computed before locking. Reuse existing owner verification, company-only plan,
  publication, writable-tenant and locked-period checks. No earnings activation.
- Keep identity-only creation compatible. This incremental workflow is **not**
  acceptance of FR-ASN-01: mandatory join dates/commission-role plan enforcement
  and existing-staff lifecycle coverage remain open. No commission-earning role
  classification is inferred from authentication roles, departments or a flat rate.
- The owner UI explicitly opts into atomic assignment and retains failed form
  input. Assignment revisions refresh only by explicit reload/reselection, never
  by silently retrying a conflicting write. The existing post-create continuation
  remains available for additional settings and is separate from atomic creation.

### CP-003 employment-date concurrency (October 27, 2026)

- `User.startDate` remains the single authoritative join date. Payroll settings
  writes require both the captured payroll-event revision and `expectedJoinDate`
  (date or null); staff date writes require `expectedStartDate`. Compare while
  holding the same tenant configuration lock, not in a separate preflight read.
- A staff member with payroll settings or assignment history changes join date
  only through the owner-only reasoned payroll workflow. General staff PATCH may
  still update unrelated profile fields or repeat an unchanged date with a matching
  expectation. Missing comparisons fail closed; stale comparisons return conflict.
  This intentionally tightens date-write API compatibility; clients must reload
  and supply the captured date, never substitute the proposed date as expectation.
- This is configuration safety, not acceptance of immutable approved statements,
  required-plan staff creation, outlet assignment policy or historical preview.

### CP-002 arithmetic and fallback contract (October 27, 2026)

- Use dependency-free bigint rational arithmetic in the existing shared package;
  no floating-point monetary calculations. Pool/apply base percentage at four
  decimals and round component results half-up to two decimals.
- Fractional fixed-component units are already staff-split. Four-decimal allocation
  residuals use stable staff-ID order; negative splits exactly reverse positives.
  Value-package spend bases use differences of cumulative rounded ratio values.
- Exclusive tier gaps advance by 0.0001, not the reference engine's cent increment.
  Missing join dates fail closed for staged plans rather than inventing tenure.
- No-plan fallback consumes existing source-time resolved hierarchy rates. Its
  negative balance retains exact commission debt at ten decimals, not an unpriced
  base that could be repriced after a rate change. A switch to a plan with such debt
  fails until separately settled explicitly; CP-005 must preserve/audit settlement.
- Package fixed/excluded activity remains eligible for configured incentive metrics,
  while bypassing plan earnings. Fixed negative award lines are explicit clawbacks;
  fixed-unit component negative units carry to the next period by default.
- Group collection metrics are explicit same-period, metric-kind/scope inputs from
  the authoritative service, never inferred by summing commission bases.

- SRS historical Stella sample uses sales value: commission 1,971.62 + incentive 50.
  Under new collected-package base 8,688, commission is 1,931.84 and incentive 0.
  Keep both fixture scenarios separately labeled; do not force new policy to match
  old-sheet totals by reverting to sales value.
- Historical Alvin 1,199.99 assumes 492 is already the FOC half-base. Recommended
  fixture with 492 full list price totals 1,187.69. Do not halve twice.
- SRS contains GC_SALE, outlet scope, Excel/PDF and richer audit/report requirements
  absent or incomplete in reference code. Docs win; requirement gaps stay TODO.
- Reference approval marks bases PAID, uses active-only staff, and dynamically reads
  salary/collection for statements. Replace those behaviors per CP-D05–CP-D07.
- Reference generic fallback omits current hierarchical rules and package fixed
  handling. Port behavior deliberately, not the fallback function unchanged.
- Reference service writes are not a complete transaction/retry/tenant-security
  design. Existing production architecture wins on safety, not old commission policy.

No owner-policy question is currently blocking. Newly discovered safety-critical
or scope-changing conflicts must be documented, not treated as blanket permission
to modify production, erase history or expand statutory payroll scope.
