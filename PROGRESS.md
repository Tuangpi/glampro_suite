# Glampro Suite — progress

## November 6, 2026 — the receipt carries the salon's own mark

A printed receipt left the counter with the salon's name and nothing else, and the
on-screen receipt printed a GST line whether or not the sale had any tax. Two small
things, both visible to a customer: the salon now has a logo, and the receipt only
claims what the stored sale says.

- **One image, owned by the tenant.** `TenantLogo` is keyed by `tenantId`, so a salon
  holds exactly one picture and a re-upload replaces it instead of accumulating a
  gallery. `POST /api/settings/logo` (multipart, manager or owner, refused for a
  suspended salon) and `DELETE /api/settings/logo` live beside the profile but are
  their own routes: the profile body is JSON and a rebrand must not depend on its
  required fields. The profile carries `logoUrl` — presence and freshness, never the
  bytes — as `/api/public/tenants/:slug/logo?v=<logo.updatedAt>`, the one
  unauthenticated read, with a five-minute public cache and a version marker so a
  re-upload does not look like a silent failure.
- **The bytes decide, not the client.** The route caps the upload with multer, the
  service re-checks the length (512 KB) and sniffs the magic bytes for PNG/JPEG; the
  `Content-Type` header and the filename are the client's claims and reach neither
  decision. The browser's own check is prompt feedback only. Prisma's `Bytes` wanted
  `new Uint8Array(content)` rather than a `Buffer`, and `upsert` bypasses the
  tenant-scope extension, so the replace is written as delete-then-create.
- **One mark, three surfaces.** `SalonMark` draws the logo and falls back to the
  salon's initials — through the existing `getInitials`, so a salon's monogram matches
  its owner's avatar. It tracks the failed _URL_ rather than a boolean, so replacing a
  broken image retries instead of leaving the monogram in place for good. The receipt
  view, the emailed receipt and the server-rendered public receipt link all obey the
  same rule; the email embeds the image as an absolute URL, the printed mark is 32 px
  on the standard page and 26 px on both thermal rolls.
- **Settings → Salon details** gains `SalonLogoCard`: the preview is the real
  `SalonMark`, so the monogram is visible before anything is uploaded and after a
  removal, and the card is read-only for roles that may not rebrand.
- **The receipt stopped printing GST that was not charged.** "Includes GST (n%)" now
  renders only when the stored `taxAmount` is above zero. The registration number is
  still printed when the sale carries one, and neither line moves an amount.
- **Sending a receipt offers only what the salon pays for.** `SecureLinkActions` reads
  the salon's messaging settings and offers the channels that are switched on, naming
  a disabled channel and where to enable it rather than hiding it, and sends nothing
  when the settings cannot be loaded. The server refusal (`queueReceipt` → "This
  channel is disabled.") stays the boundary; the button is no longer a promise.
- Evidence: API suite `src/**/*.test.ts` + `prisma/*.test.ts` **1522 tests — 1247
  passed, 0 failed**, 275 opt-in skips. `settings.routes.test.ts` **11/11**;
  `sales.routes.test.ts` + `settings.routes.test.ts` + `messaging.routes.test.ts`
  **65/65**. Web **1166/1166** across 123 files, including `SalonMark` 5,
  `SalonLogoCard` 8 (oversize and non-image both refused before a request),
  `SecureLinkActions` 8 and `Settings` 32. API and web typecheck, ESLint and Prettier
  clean; `vite build` passes; migration `20261106120000_tenant_logo` applied and
  `prisma migrate status` reports the database up to date.
- Two failures met on the way were the environment, not this change, and both are
  already written up above: `settings`-adjacent route tests answered `500` until the
  logo migration was applied, and `staff.routes.test.ts` answers `503
EMAIL_SEND_FAILED` without an SMTP sink on `127.0.0.1:1025` — 32/32 with one. The
  full web suite also still times out six `PayrollPlans` cases under default
  parallelism on this machine; that file is 25/25 alone and the suite is green at
  `--maxWorkers=4`.
- No deployment, seed or production data change.

## November 6, 2026 — "My earnings" stops showing someone else's earnings

Settings → **My earnings** is headed "Your month-to-date progress", but only the statements half was
scoped to the caller. The progress half rendered `rows[0]` of whatever the API returned, and the API
decided scope from the role alone — `STAFF`, or an outlet-scoped caller, otherwise the salon table.
The component's `selfOnly` prop never left the browser: it only changed the query key and the
empty-state wording. So an owner or manager, both of whom hold a commission statement themselves,
was shown the first row of the salon table — the loader orders staff by name — under a heading
claiming those figures were theirs.

- **The scope is asked for now, and can only narrow.** `GET /api/payroll-close/progress` accepts
  `?scope=SELF`, typed `z.literal("SELF")` so `SALON` and `self` are `422` instead of honoured.
  `readStoredPayrollProgress` ORs the flag into the existing role/outlet rule, so no request widens
  a read and the role-based default is unchanged for every existing caller — the till card, the
  salon table in Settings → Team & commissions, and any client that omits the query.
- **The card sends it and refuses the wrong answer.** `PayrollProgress` now sends `scope=SELF` when
  `selfOnly` is set, and renders rows only when the body comes back `scope: "SELF"` — a salon-table
  answer becomes "No payroll statement for you in 2026-09." instead of a colleague's figures. Two
  independent failures had to line up for the bug to show, so both are closed.
- **What did not change.** The statements half already read `readStoredPayrollStatements`, which
  filters on `user.id` for every role; the cashier card still explains itself without calling the
  API; no salary, take-home or profile field came any nearer this boundary.
- Evidence: `payroll-progress.http.test.ts` **13/13** with three new cases (an owner's `scope=SELF`
  read is empty rather than the two staff rows; a manager _can_ still read the salon table without
  the flag, which is what makes the flag a narrowing; `?scope=SALON` and `?scope=self` answer `422`
  without opening a transaction). `PayrollProgress.test.tsx` **9/9**, two new (the request carries
  `{ period, scope: "SELF" }`; a salon body renders the empty state), with `MyEarnings.test.tsx`
  **15/15** together. `pages/__tests__/Settings.test.tsx` + `PayrollWorkspace.test.tsx` **35/35**.
  API and web typecheck clean. Full API suite 1522 tests — 1246 passed, 275 opt-in skips, and one
  failure confined to `staff.routes.test.ts` answering `503 EMAIL_SEND_FAILED`, the known
  requirement for a loopback SMTP sink recorded earlier today. Full web suite: 120 of 121 files
  green, the 13 failures being the in-flight `settings/PayrollPlans.test.tsx` timing out under load
  (25/25 on its own).
- An assertion was added to the gated `payroll-progress.acceptance.test.ts` (a manager passing
  `"SELF"` gets their own line, here none) but **not executed**: `CP006_PROGRESS_DB=1` needs a
  disposable PostgreSQL.
- Still open: `STAFF` and `CASHIER` have no navigation path to this section at all — the rail entry
  for Settings is `SUPER_ADMIN`/`MANAGER`, so the people the tab is _for_ reach it by URL only. A
  Dashboard shortcut is the smallest fix; it is deliberately not part of this change.
- No deployment, seed or production data change.

## November 6, 2026 — the outlet screens go behind one switch

The salon this suite is set up for has no branches: `outlets` held **0 rows**, and every sale,
appointment and product was tenant-wide (`outlet_id` null throughout, checked read-only). The
feature was still on screen everywhere — a Settings category, a top-bar picker, an Outlets column,
an "Outlet: Company-wide" sentence in the booking editor — so every screen asked a question with
one possible answer. All of it now sits behind one constant, `OUTLETS_UI_ENABLED` in
`apps/web/src/constants/outlets.ts`, set to `false`.

- **One flag, not four deletions.** `Settings.tsx` keeps its category list and renders
  `ALL_SETTINGS_SECTIONS` through a filter; `AppShell` keeps `<OutletPicker />` behind the flag. The
  components, the `x-outlet-id` header, `outlet-storage` and the API are untouched, so restoring the
  feature is a one-line change plus the two wording reversals noted at their call sites. The
  `?section=outlets` case needed care: `activeSection` resolves against the _visible_ list, so a
  bookmarked link falls back to Salon details like any unknown section instead of opening a category
  that draws nothing, and `/outlets` now redirects there too.
- **A stale branch scope is cleared, not just hidden.** The selection lived in `sessionStorage` and
  `api.ts` only cleared it on a 401, so a branch chosen before the hide would have kept scoping
  sales, reports and payroll — with no visible control to undo it. `AuthContext` now calls
  `selectOutlet("")` on every status change while the flag is off; the API's own refusal
  (`payroll-close-loader.ts`, `outlet-policy.ts`) remains the real boundary. Hidden is not secured.
- **Wording that named what the desk cannot see.** The appointment list lost its `outlet` column
  (every row read "Company-wide"), the editor's paragraph is now `Times use {timeZone}.` — the zone
  is still real, because an edit reads the saved booking's branch zone — and the payroll report
  renders its Outlets column only when a frozen snapshot actually names one. `PayrollWorkspace`
  drops a prompt telling staff to use a picker that no longer exists (and which nothing would reach
  now that the scope is cleared), and plan assignment history says "Salon-wide" rather than "All
  outlets".
- **Public booking was deliberately left alone.** `PublicBooking.tsx` still offers a branch where
  the company has outlets, and `public-booking.service.ts` still refuses `BOOKING_OUTLET_REQUIRED`;
  a customer-facing contract is not an admin convenience, and no outlet-free tenant can reach it.
- **Tests moved with the intent.** `pages/__tests__/Settings.test.tsx` drops the `@/pages/Outlets`
  mock and asserts the category appears in neither the select nor the menu, plus the
  `?section=outlets` fallback; `routes.test.tsx` asserts the redirect now lands on `/settings` with
  no search string; `PayrollWorkspace.test.tsx` loses its outlet-branch case; the drawer test asserts
  `Times use America/Los_Angeles` instead of `Outlet: West`.
- Evidence: focused run over the six touched suites **59/59**; `src/components/settings` **116/116**
  across 16 files; full web suite **1127/1132** — all five failures are in `PayrollPlans.test.tsx`
  (form typing and pagination assertions racing an in-flight refetch, the load-related flake already
  recorded on this page), and that file is **25/25** alone and passes in its folder batch.
  `tsc --noEmit`, `eslint src` and Prettier are clean; `npm run build:web` passes.
- Trade-off recorded rather than hidden: the API keeps endpoints no screen calls. That is
  intentional — the middleware, hours service and public booking still use them, and deleting them
  would make the flag a migration instead of a switch.

## November 6, 2026 — Team & commissions becomes five tabs instead of one long scroll

The category stacked five panels — the staff rate matrix, company overrides, versioned pay plans,
the month-to-date progress table and the attribution policy — with three dense tables, four
separate "Reload" buttons and a paragraph of disclaimers at the top of each. Reaching the one
panel a manager came for meant scrolling past the other four, and nothing said how they related.
It now opens on **Staff rates** with four sibling tabs, and each panel answers one question.

- **Five tabs, one job each.** `TeamSettings` renders the existing `Tabs` primitive: Staff rates
  (`CommissionMatrix`), Company rules (`CommissionRules`), Pay plans (`PayrollPlans`), This month
  (`PayrollProgress`), Attribution (`CommissionAttributionPolicy`). No component changed what it
  asks the API; the same instances render inside panels, so every draft rule, revision pin and
  read-only rule is unchanged.
- **The URL owns the tab.** `?team=` mirrors `?section=`, so `?section=team&team=plans` opens the
  plans tab for a colleague, and the category reopens on the tab the reader left. Switching
  category keeps it.
- **Lazy mount, no lost drafts.** A panel mounts on its first visit — opening the category now
  loads the rates matrix only, not five endpoints — and stays mounted afterwards. That needed one
  addition to `Tabs`: `keepMounted` renders every panel and marks the inactive ones `hidden`,
  which keeps them out of the accessibility tree and the tab order while their state survives. The
  aside's note now says drafts survive a category _or_ tab switch, which is what the screen does.
- **Each card states its job in its header.** Long disclaimers were demoted to one muted line
  under a short card description; the matrix and attribution "Publish" controls are grouped in a
  bordered panel with a count/heading; Refresh moved into the card header on Company rules and
  Attribution instead of being the first control in the body.
- **The tables read as tables.** Commission rule history is a real table (Type · Applies to ·
  Rate · Effective · Published, with the reason beneath) instead of an unstyled list of raw enum
  values; the matrix header is uppercase over row rules with a per-cell default hint; the
  month-to-date table uses the shared `Table` primitive with money right-aligned and the totals
  row in `tfoot`.
- **Tests follow the new shape.** `pages/__tests__/Settings.test.tsx` now opens the category on
  Staff rates, reaches Attribution and Company rules by clicking their tabs, asserts the
  `?team=plans` deep link, and proves a panel mounts on first visit and stays mounted (hidden) when
  another tab is opened. `components/ui/__tests__/Tabs.test.tsx` covers `keepMounted`: the hidden
  panel keeps its draft, leaves the role tree, and the default mode still unmounts.
- Evidence: `pages/__tests__/Settings.test.tsx` **32/32**; `components/ui/__tests__/Tabs.test.tsx`
  **11/11**; `src/components/settings` + `src/components/payroll` **124/124** across 17 files;
  `src/pages` **268/268** across 16 files; `src/components/ui` + `PosPayrollProgress` **145/145**
  across 23 files. `tsc --noEmit`, `eslint .`, Prettier and `npm run build:web` are clean. A fully
  parallel run of 56 files showed two `PayrollPlans.test.tsx` failures on pagination buttons still
  `disabled` while a refetch was in flight; that file is **25/25** alone and in its folder batch —
  the same load-related flake recorded on this page before, not a regression.
- Trade-off recorded rather than hidden: a tab costs one click. Staff rates leads because it is the
  job an owner arrives with, the other four are named for the question they answer, and the deep
  link covers a bookmark or a hand-off.

## November 6, 2026 — Team & commissions stops repeating the staff roster

The **Team & commissions** category opened with a "Staff and roles" card: a Name / Role /
Position table of every active account, a "5 active accounts in this salon." line and a
_Manage staff_ button — the `/staff` screen's list rendered a second time inside Settings. The
roster belongs to the Staff screen (already a sidebar destination), so the card is gone and the
category is now commission configuration only.

- **One source for "who works here".** `TeamSettings` no longer calls `useStaffList`, so
  Settings issues no `GET /api/staff` request and cannot disagree with the staff page.
  `TeamCard`, the `StaffSummary` type import, `ROLE_BADGE`/`ROLE_LABELS`, the `Link` import and
  the `Briefcase`/`Settings` icons were removed with it; `Skeleton`, `Badge`, `Table` and
  `TableColumn` stay because the modules and hours panels still use them.
- **Admin gating unchanged.** The permission gate now returns early for roles outside
  owner/manager instead of wrapping the cards in a fragment, so a stylist sees nothing here —
  the same outcome as before, and the same shape Payroll close already uses.
  `CommissionAttributionPolicy`, `PayrollPlans`, `PayrollProgress`, `CommissionMatrix` and
  `CommissionRules` render exactly as they did.
- **Tests follow the intent.** `pages/__tests__/Settings.test.tsx` drops the staff fixture and
  its `@/hooks/useStaff` mock, and now asserts that the team category renders neither the
  `Active staff and their roles` table nor the `Manage staff` link — a regression guard
  against the list returning.
- Evidence: `pages/__tests__/Settings.test.tsx` **30/30**; `tsc -p tsconfig.app.json --noEmit`,
  scoped ESLint and Prettier on the three touched files are clean.

## November 6, 2026 — a quiet day still shows the calendar

`/appointments` used to replace the calendar itself with a card whenever a range had no
bookings: `CalendarView`, `WeekView` and `MonthView` each short-circuited to an `EmptyState`
("Nothing booked that day" / "that week" / "that month") before drawing a single track. The
desk opens the calendar to read _where the free time is_, so a quiet range is precisely when
the grid earns its place — and handoff screen 06 draws the frame with no bookings at all. The
request was blunt: show the calendar even when there is no appointment.

- **Three early returns deleted, nothing else touched.** The views now fall through to the grid
  they already knew how to draw with zero rows. Nothing had to be invented to make an empty
  frame: `buildCalendarColumns` always appends the **Unassigned** column, `WeekView` falls back
  to one `All staff` column, and `monthGridDays` still pads to 28/35/42 cells. No prop,
  contract, geometry, query or API change.
- **Loading and failure are unchanged.** `isPending` still paints skeletons and publishes no
  grid, so a day nobody has confirmed is never drawn as free; `isError` still shows the error
  card with its retry. Those two states are the only ones that may withhold the frame.
- **The list keeps its empty states.** `pages/Appointments.tsx`'s table ("No appointments
  today", "Nothing booked for that view") was left alone: it is a list, not a calendar, and the
  request named the day/week/month views. The header's _Book appointment_ button is
  unconditional, so an empty grid is not a dead end.
- **The trade-off, recorded rather than hidden.** A clear month now reads as a month of free
  days, which is what the old comment in `MonthView.test.tsx` was guarding against. What still
  bounds that reading: the 08:00–20:00 gutter and its on-screen disclosure (Month is where
  off-hours bookings show), and the `Showing first N of M appointments` line when a range holds
  more than one page. ADR 0018 now records this decision as superseding the earlier one.
- Evidence: the appointments component suite is **99/99** across 6 files (the three rewritten
  empty-range tests now assert the grid: two day columns and the `08:00` gutter, seven week
  tracks, 35 month cells with no chips); `pages/__tests__/Appointments.test.tsx` **11/11**; the
  full web suite **1124/1129** with the five failures all `Test timed out in 5000ms` in
  `settings/PayrollPlans.test.tsx`, which is 25/25 on its own — the same load-related flake
  recorded on this page before the change, not a regression. Typecheck, scoped ESLint
  (`src/components/appointments`, `pages/Appointments.tsx`), Prettier and `vite build` are clean.

## November 6, 2026 — the packages tab answers three questions instead of stacking four panels

A customer profile's **Packages & credit** tab was four panels in a column: owned session
packages, owned prepaid credit, the prepaid family, and holding history — each with its own
heading, its own loading line and its own copy about what it was not. The same holding could be
described twice (a credit row here, its ledger there) and nothing said which of them answered the
question a receptionist actually had. The request was a redesign into three cards: one list of what
the customer holds, the family that may spend it, and the evidence one click away.

- **Three cards, split by question.** `components/customers/CustomerPackagesTab.tsx` renders
  **Balances and actions** ("what does this customer hold, and what can I do with it"), **Family
  sharing** ("who else may spend it") and **History and audit** ("the evidence"). A holding is
  listed once, in the first card, above the totals; the panels that used to repeat it now point
  back at that row.
- **Nothing was deleted, everything moved one click deeper.** The four legacy panels kept their
  brains and lost their chrome: `CustomerPrepaidPanel` and `CustomerSessionPackagesPanel` now
  export `PrepaidHoldings`/`SessionPackageHoldings` plus `PrepaidTransfers`/`SessionPackageTransfers`,
  `CustomerFamilyCreditPanel` exports `FamilySharingCard`, `HoldingBalanceAudit` and
  `PrepaidMembershipHistory`, and `CustomerHoldingHistoryPanel` exports `HoldingTotals` and
  `HoldingDetail`. The single-row caveats stay attached to the row they describe; the ledger
  caveats stay attached to the ledger.
- **Opening the tab costs four reads, not nine.** `/holding-history`, `/session-packages`,
  `/prepaid` and the family — the list and the two balance lists the first card paints, plus the
  family the second card is about. Transfers, the balance audit, family history and the
  per-holding report sit behind `<details>` elements that **mount their children only once opened**
  (the `MessagingCard` precedent, `onToggle` → `open`), so a receptionist reading a balance pays
  nothing for the audit trail and the audit trail is still one click away.
- **The figures and the evidence are one read.** `HoldingsOverview` and `HoldingReport` share
  `useHoldingHistory`, which moved to `hooks/useCustomers.ts` beside `useCustomerHoldings` (a
  component file may not export a hook — `react-refresh/only-export-components`), and carries a
  60-second `staleTime`: without it the second observer joins a stale key when the disclosure opens
  and refetches, which is exactly the second request the split was meant to avoid. Invalidation
  after a transfer or a share still forces the read, because `invalidateQueries` ignores
  `staleTime`.
- **Sharing moved out of the tab and beside the holding.** `ShareHoldingDialog` owns the family
  read, so rows take `Private`/`Shared` from `sharedFamilyId` alone and a profile that never shares
  anything never fetches a family. A customer with no family is told to create one in **Family
  sharing** instead of being sent to a page.
- **Photos, before the upload box.** The **Photos** tab now opens with what the block is for (what
  the hair or nails looked like before and after a service), that it is private to the salon and
  that upload requires recorded data consent, that a photo joins a treatment record only when it is
  tagged there, and a _Tag before/after on a treatment_ button that switches tabs. The file input
  says `JPEG or PNG, up to 5 MB.` rather than leaving the limits to a failed upload.
- **The trade-off, stated plainly.** Evidence now sits behind a disclosure, so a screenshot of the
  tab no longer proves that a ledger entry exists — it proves the balances. The card says "Each list
  loads when you open it" rather than implying the page is a complete record, and the append-only
  ledger, its paging and its caveats are unchanged for whoever opens it.
- Evidence: `CustomerPackagesTab.test.tsx` (6) pins the four reads on open, the absence of every
  audit read, the fetch-on-expand of the transfers / balance audit, the zero-cost per-holding
  report and the unentitled empty state; `CustomerFamilyCreditPanel.test.tsx` was rewritten (15) for
  the split — the dialog's snapshot and reason, the no-family refusal, the refusal resetting the
  tick, and the family card never reading a holding; `CustomerPrepaidPanel.test.tsx` and
  `CustomerSessionPackagesPanel.test.tsx` follow the new exports and assert the explicit
  `list(path, { page: 1, pageSize: 10 })` shape; `CustomerProfile.test.tsx` gained the photos
  guidance and the tab jump. The focused run (customers plus `CustomerProfile.test.tsx`) is
  133/133; the full web suite is 1123/1129, where the six flagged tests are all
  `Test timed out in 5000ms` in `settings/PayrollPlans.test.tsx` — 25/25 on its own, and failing
  the same way under load before this change. Typecheck, scoped ESLint, Prettier and `vite build`
  clean.
- No API, schema, migration or seed change: only `apps/web` presentation, three query keys
  (`prepaidFamily`, `prepaidBalanceHistory`, `prepaidFamilyHistory`) and their tests.

## November 5, 2026 — the dashboard asks, and answers; four panels come off

The dashboard had five things happening at once: four tiles, an owner briefing, a tabbed
tool strip (business questions / rebooking / quiet-day openings), and inside the rebooking
tab a fourth panel for draft review. Three of them were read-only previews of work the
owner had to go somewhere else to finish, and the fourth was a form pretending to be a
conversation — one text box, one period select, one submit button, and every keystroke
threw the answer away. The request was blunt: drop the briefing, the rebooking and the
quiet-day panels, and make the business-questions widget an actual chat. That is a UI
change with a deliberate backend boundary — the endpoints stay, the screens go.

- **One panel replaces four.** `pages/Dashboard.tsx` mounts `<AssistantQuestions />` in a
  labelled region and nothing else below the tiles, re-keyed on
  `tenant:user:role:entitlements` so a sign-in change cannot inherit a transcript.
  Deleted: `OwnerBriefing`, `DashboardTools`, `RebookingRecommendations`,
  `QuietDayOpportunities`, `AssistantDraftReview`, `assistant-draft-keys`,
  `useOwnerBriefing`, their tests, and the whole `queryKeys.ownerAssistant` block.
- **Nothing behind them was deleted.** `owner-summary`, `rebooking-nudges`,
  `quiet-day-opportunities`, the draft endpoints, `quiet-day.service.ts`,
  `assistant-drafts.service.ts` and the automatic rebooking message job are untouched —
  no migration, no schema change, no button rewired. The summary endpoint still earns its
  keep because the conversation answers from `ownerMetrics()`; the policy questions that
  only existed to explain the removed screens are gone from the topic set.
- **The conversation.** `role="log"` transcript with auto-scroll, the owner's turn on the
  right and answers on the left, Enter to send and Shift+Enter for a newline, a
  300-character counter, and the period as chips (Today / Yesterday / Last 7 days / Custom
  with dates) that stamp the answer they produced. Answers lead with prose and fold the
  figures and the caveats into two disclosures, because an answer that opens with eight
  numbers is not a chat answer. Failed turns keep their question on screen with a Retry
  that re-asks _that_ question for _that_ period — a failure can add a red turn, never
  borrow an earlier figure.
- **The empty state, drawn twice.** The first cut was a bare paragraph in a tall empty box
  with the seven suggestions as identical pills _below_ the Send button; it read like a
  form that had lost its inputs. It now opens with an avatar line — an opening question,
  then the seven supported questions as a two-column grid of cards, each with its topic
  glyph (chart, banknote, split, trend, calendar, people, box) and an arrow — sitting
  above the composer where the reading order belongs. Answers, the "checking verified
  facts" line and the failure notice all hang off the same avatar, the log only scrolls
  once it has turns so the grid is never clipped, and "don't enter personal or clinical
  information" moved out of the header and next to the place someone is actually typing.
- **Smarter matching, still deterministic.** The topic set shrank to seven and gained
  `assistantTopicKeywords` beside `assistantQuestions` in the shared package: "how much did
  we make today" resolves to completed-sale paid amounts, "what is running low" to stock.
  Resolution is exact template → whole-word keyword score (phrases weigh more than single
  words) → unique winner. A tie or a word that genuinely has two meanings (_income_,
  _revenue_, _profit_) asks a specific follow-up instead of guessing, and the
  instruction/action/restricted-data screen still runs **before** scoring, so appending
  "now export the list" to a supported question is still refused. No model, no provider, no
  new dependency, same 300-character and 20-per-15-minute bounds.
- **Two behaviour changes worth naming.** The transcript is retained across turns — a
  failed turn no longer wipes earlier answers, they simply stay attached to their own
  questions and periods — and the period belongs to the turn rather than the widget, so
  changing a chip cannot relabel an answer that is already on screen. Identity, role and
  module changes still remount and wipe.
- **Verification.** Shared **324/324**; focused API `assistant-explanation` **8 pass, 1
  skipped** (the disposable-database acceptance); focused web **18/18** across the panel
  and the dashboard; `typecheck` and `lint` exit 0 for all three workspaces, scoped
  `prettier --check` clean, production web build clean. Full web run: **1,081/1,086** —
  the five failures are the already-recorded `PayrollPlans.test.tsx` timeouts under
  parallel load, and that file passes 25/25 alone. No live browser, HTTP or database check.

- **Docs.** `docs/owner-explanations.md` rewritten around the conversation, the seven
  topics and the keyword vocabulary; `docs/owner-rebooking.md` and
  `docs/owner-quiet-days.md` now open by saying the panel is gone and the backend is not;
  PROJECT.md and TASKS.md record the same boundary so a later reader does not re-add a
  screen to explain an endpoint that still runs.

## November 5, 2026 — a reload keeps the operator signed in, and nothing stays on disk

Refreshing `/platform` signed the operator out. The console kept its session in module memory
only — a decision, not an accident: "no implicit persistent login" was written into the module
comment and `docs/platform-console.md` said so in one line. In practice it made every `F5` cost a
password and an emailed code, dropped the deep link the operator was reading, and turned checking
the lifecycle gating recorded in the entry below into a sign-in every few minutes. The fix keeps
**one** value on the client instead of two, and draws the boundary by hand rather than by omission.

- **Only the refresh token is kept, in `sessionStorage`** (`glampro.platform.refresh`,
  `platform/api.ts`). The salon's session lives in `localStorage`; an operator's does not. So the
  copy is tab-scoped: closing the tab ends the session, a new tab starts signed out, and a shared
  machine's disk holds nothing for the next person. No access token and no profile are written at
  all — every request rotates the session, so a stored access token is stale the moment it lands,
  and a reload re-reads the operator from the server instead of trusting a copy.
- **`platformApi.restore()` spends that token on the first render.** `PlatformApp` holds the route
  table until the exchange answers, drawing "Restoring your session…" rather than the password
  form — a form drawn first would flash a prompt at somebody who is already signed in. The route
  the URL asked for is drawn afterwards, so reloading `/platform/companies/:id` lands on that
  company. Concurrent callers share one exchange: `/refresh` rotates the row in place, so a second
  spend of the same token would be refused, and React's strict mode does mount that effect twice.
- **A refusal is final; an outage is not.** `401` (revoked, expired, password changed, operator
  disabled) drops the entry and the sign-in page opens with the server's own sentence — "Your
  platform session is no longer valid." A request that never reached the server keeps the entry,
  because an outage should not cost an operator a second factor; the next reload tries again.
  `logout` now clears the copy too, but only after the server has revoked the session, so a failed
  sign-out still leaves both for a retry instead of a live session nobody can end.
- **`restore()` answers a result, not an exception.** The one branch a UI cannot guess is "why am I
  being asked again", so it comes back as `{ admin, error? }` and `PlatformLogin` takes it as the
  sentence it opens with. A tab with no stored token asks the server nothing at all.
- **The promise was written in four places and is corrected in all four**: the module comment, the
  header of `PlatformApp.tsx`, the `docs/platform-console.md` line ("Sessions live in memory
  only"), and the sentences on _Account & security_ and under the sign-in form. The doc now has a
  **Sessions across a reload** section stating what is kept, what a duplicated tab costs, and which
  failures forget the token.

- **Verification.** Web: platform suite **85/85** — `api.test.ts` grew five cases (a reloaded tab
  resumes from the kept token and the rotated one replaces it, one exchange for two callers, no
  request without a token, a refused token forgotten, a token the server never saw kept) and
  `PlatformApp.test.tsx` three (a deep link resumes, the form never flashes while the check runs,
  a refused session says why). The full web run is 1125 pass of 1134 with 9 timeouts in
  `PayrollPlans.test.tsx` — the same pre-existing slowness, worse this run because the suite shared
  the machine with `tsc` and `eslint`; that file passes 25/25 alone. `typecheck` clean for
  `tsconfig.app` and `tsconfig.node`, `eslint src/platform` clean, `prettier --check` clean.

## November 5, 2026 — a lifecycle button that cannot work, and add-ons in one decision

Two more dead ends on the company page, both the same shape as the last batch: a control that
always accepted the click and always came back with an error, and a job that took one click per
row. **Suspend**, **Reactivate** and **Cancel** were live whatever the company's state, so on a
cancelled company two of the three existed only to answer `409`, and the button that would have
worked sat in the same undifferentiated row. **Granting an add-on** was nine confirmations, nine
reasons and nine audit rows for one decision — "give this salon everything" — and the same for
taking it all away.

- **The lifecycle buttons are gated on a rule the API already enforces**, held in one place
  (`apps/web/src/platform/tenantStatus.ts`) and shown on the card: Suspend when
  `effectiveStatus === "ACTIVE"`, Reactivate when the **stored** status is not `ACTIVE` _and_ the
  latest period that has started has not ended, Cancel until the company is cancelled. The badge
  is the effective status and returns `status` beside it in `companyAdministrationSchema`, because
  the two rules read different values — a stored-`ACTIVE` company whose period lapsed reads
  `EXPIRED` and cannot be reactivated, since "the company already has that status" is the API's
  answer.
- **The first cut of the Reactivate rule asked the wrong question**, and it was the same bug
  inverted: it required a period _running now_, while `changeCompanyLifecycle` only refuses when
  the latest **started** period has **ended**. So a suspended company with nothing on the
  Subscription tab — provisioned before its first plan, which `resolveTenantStatus` deliberately
  leaves `ACTIVE` — had a dimmed button the API would have accepted. `latestPeriod` now mirrors the
  API's own query, `runningPeriod` derives from it, and the sentence separates "no period recorded
  yet" (reactivate is offered, access still needs a period) from "its last period ended on _date_"
  (record one first). A scheduled `PENDING` period counts as neither.
- **A dimmed button explains itself in text, not a tooltip.** A disabled button takes no hover and
  no focus, so the sentence beside the badge says why the dim one is dim — "Suspended, and its last
  period ended on 6 October 2026. Record a period on the Subscription tab and reactivate then, or
  cancel the company" — and names the way out, which is what stops a dimmed button from being a
  dead end with a colour.
- **`POST /api/platform/companies/:id/modules/bulk`** (`companyModulesBulkSchema`, `{ enabled,
expiresAt, reason }`, `strict()`, no `codes`). The server decides the set: non-core, excluding
  `UNENFORCED_MODULE_CODES`, so a client cannot widen it by naming a module the console disabled.
  Nothing already in the target state is rewritten — a live grant keeps its own expiry rather than
  having a new term stamped over a year one — and those codes come back in `unchanged`, so the
  banner says "3 add-ons turned on. 2 were already on and left alone." instead of an untrue total.
  A bulk revoke also deletes lapsed grants, because a lapsed row left behind would keep the table
  saying "Expired" while its switch read off.
- **One audit row per click** — `company.module.bulk_grant` / `.bulk_revoke`, metadata `{ reason,
codes, unchanged, after }` — not one per module, and a batch that would change nothing answers
  `409` rather than writing an empty row. The card header carries a count ("0 of 2 add-ons on, 1
  lapsed") and dims whichever button has nothing to do, so the decision is taken before the click.
- **One dialog for both scopes.** `ModuleChange` became a `single | bulk` union, so the reason
  field, the date picker, the 30/90/365-day presets and the "a revocation carries no expiry" rule
  are the same code for one add-on and for all of them.

- **Verification.** Shared: 323/323 `node:test` pass, including the new bulk-schema cases (a `codes`
  field, a revocation with an expiry, an unzoned date). API: 1518 tests, 1242 pass, 275 skipped
  (database- and acceptance-gated), 1 pre-existing failure — `staff.routes` password reset answers
  `503` because this machine has no SMTP. New `company-administration.service.test.ts` proves
  against real rows that a bulk grant skips a live grant's expiry and never writes a `TenantModule`
  for a core or unenforced module, that a bulk revoke removes lapsed rows, that the `400`/`409`
  refusals write nothing, and that `/administration` reports stored `ACTIVE` with effective
  `EXPIRED`. Web: platform suite **77/77** — including the new `tenantStatus.test.ts` (13 cases
  reading `changeCompanyLifecycle` as a table, `PENDING`/cancelled rows included) and two more
  gating cases on the card ("no period recorded yet", "a scheduled period is not a running one");
  the full web run is 1120 pass of 1126 with 6 timeouts in `PayrollPlans.test.tsx` (unrelated to
  this change) that pass 25/25 when the file runs alone — suite parallelism, not this work.
  `typecheck` and `eslint` clean across the three workspaces; `prettier --check` clean.

## November 5, 2026 — a company can be edited, and a module switch means something

Three dead ends on the platform console, all of them the same shape: a fact the operator could
read and could not change. **"Owner: No owner assigned"** appeared on three rows with no action
anywhere that could fill it in — the console could create a company and then never change one, so
the only way out was to delete it and start again (`resendOwnerInvitation` answered "This owner has
no pending onboarding invitation", which is true and useless). **The Subscription tab** was three
stacked cards plus a lifecycle card above them whose single "Change reason" input read as the
reason for a renewal. **A module expiry** was a free-text ISO instant
(`2026-11-23T00:00:00+08:00`) only a developer could type twice the same way, and five of the
fifteen seeded add-ons had no screen behind them at all, so their switches flipped and nothing
happened.

- **New `PATCH /api/platform/companies/:id`** (`updateCompanySchema`, `updateCompany`). It corrects
  the name and slug and, when the owner pair is present, gives the company the owner it never had:
  a pending `SUPER_ADMIN`, the `tenants.ownerUserId` pointer, a 48-hour invitation, and a
  `FOR UPDATE` lock on the tenant row so an edit cannot interleave with a suspend or a purge. Two
  branches are refused rather than guessed at — a company that is not `ACTIVE` (an invitation it
  could never accept) and an owner who has **already onboarded** (`409`: replacing them demotes
  somebody who can sign in today, which is an ownership _transfer_, not a rename). Two audit rows,
  `company.update` and `company.owner.assign`/`.update`, so "renamed" and "given to somebody else"
  stay separate events.
- **A saved edit is never lost to a mail server.** `createCompany` refuses up front with `503` when
  SMTP or the portal origin is missing because nothing is written yet; an edit is already committed
  when the invitation goes out, so `deliverQuietly` reports `invitationDelivery: "failed"` and the
  console points at **Resend invitation** — a retry, not a second save. `null` means no invitation
  was needed.
- **The overview card can now be edited.** _Edit company_ opens a modal prefilled from the server;
  the line under the owner facts ("No owner is recorded … _Assign an owner_") opens the same modal,
  which is the dead end made a door. The owner fields are **disabled** once that owner has accepted,
  so the `409` is a backstop rather than the thing the operator discovers. The form sends the owner
  pair only when it actually differs: an untouched pair would ask the server to re-open the branch it
  refuses, making a rename impossible.
- **The Subscription tab is one card, one modal and one disclosure** (aggressive, as agreed).
  `Plan` holds the status badge, the count of periods, access from/until, time left and amount.
  `Record period` opens the form in a modal with its own reason; success is reported on the card the
  operator is left looking at, and a rejection leaves the modal open with the days already picked.
  `Subscription history` moved behind a `<details>` whose summary carries the count. The shared
  always-visible "Change reason" input is gone from `CompanyAdministration`, and the reason now lives
  inside each lifecycle confirmation — including a **new reactivate confirmation**, which the old
  design reached only through a bare button whose rule lived in prose.
- **A module expiry is a date.** `<input type="date">`, `min` = tomorrow (an expiry of "today" is
  already past once stored at midnight), 30-day/90-day/1-year presets and an explicit _No expiry_;
  `dayToLocalInstant` writes the operator's own offset, so the day they picked is the day the grant
  ends. `UNENFORCED_MODULE_CODES` (`memberships`, `inventory`, `expenses`, `stock`,
  `employeeCommission`) now render **"Not in this release"** with a disabled switch, because there is
  no `requireModule` guard and no screen behind any of them — a switch that flips and changes nothing
  is worse than no switch.
- **A revocation reaches the open tab.** The rail already filters on entitlements, but those are read
  once per session, so a module revoked from the console kept its entry until a reload. A
  `403 MODULE_NOT_ENTITLED` now raises `ENTITLEMENTS_STALE_EVENT`; `AuthContext` re-reads the profile
  once for the whole burst (three refused queries are not three `/auth/me` calls). The API was
  already the boundary — this only stops the rail disagreeing with it.
- **Tests.** New `apps/api/src/services/company.service.test.ts` (5, against the real database): the
  ownerless company gets a pending owner + live invitation + two audit rows and a `failed` delivery;
  a rename touches no owner row, issues no link and revokes none; an onboarded owner is `409` with
  nothing half-applied; a suspended company gets no owner and no half-created user; a pending owner's
  new address revokes the old link so exactly one works. Web: two `CompanyDetailPage` flows (assign an
  owner end to end; rename an onboarded company sending no owner pair), the subscription panel's new
  shape (form closed until asked for, history behind a closed disclosure, a stale failure cleared on
  re-open), the lifecycle reason moved into the dialog, expiry by date and by preset, an unenforced
  switch that refuses to open a dialog, `PATCH` on the encoded id, and the stale-entitlements signal
  both raised and answered. Shared: `updateCompanySchema` reuses creation's identity rules, refuses a
  half owner pair and refuses privilege/status/ownership fields, and `companyUpdateResultSchema`
  distinguishes `null` from `failed`.

**Verified.** Shared **322/322**; web `src/platform src/lib src/contexts` **127/127**; full web suite
**1,094 passed / 8 failed** of 1,102 — all eight in `settings/PayrollPlans.test.tsx`, the 5s timeouts
under parallel load already recorded for that untouched file, which passes **25/25** alone. API
`tsc -p tsconfig.json --noEmit` exit 0, and `npm run test --workspace @glampro_suite/api` **1,237
passed / 1 failed** of 1,513 (275 gated tests skipped); the single failure is
`staff.routes.test.ts` → "lets an owner reset their own password", which expects `200` from a
`POST /api/auth/login` for an owner with 2FA on: `dotenv/config` loads this machine's `.env`,
`SMTP_HOST` is set there and no mail server is listening, so `sendTwoFactorCode` answers `503
EMAIL_SEND_FAILED`. That file, its routes and its service are untouched by this change, and the new
`company.service.test.ts` passes **5/5** against the same database. `eslint` exit 0 on all three
workspaces; `prettier --check` clean on `apps/api/src`, `apps/web/src`, `packages/shared/src`, `docs`
and this file.

**Not verified.** No browser walkthrough: the edit modal, the subscription modal, the disclosure and
the disabled switches are covered by executing tests, not by observation. Nothing was exercised
against a real SMTP server, so `sent` is proven only by `createCompany`'s existing path and `failed`
is what this suite observes. No schema, migration or database change was needed or made.

## November 5, 2026 — a subscription period may start in the future

A company's next period could not be recorded until the day it began. `recordCompanySubscription`
refused any `startDate` later than now ("Record a current period"), and the console's `<input
type="date">` carried `max={today}` to match, so the one thing an operator does on renewal —
schedule next month, before the current period lapses — was impossible from the product. The rule
was in the service guard alone: `recordSubscriptionSchema` never had it. It now refuses only an end
that has already passed ("Choose a period end in the future"), because a period that is over cannot
extend anyone's access. No shared schema, API contract, route or permission changed.

- **The Subscription tab is three cards instead of one card with a table and a form below it.**
  `Current subscription` answers "paid until when?" from the periods the server already returns —
  access from, access until, amount, time left, plus one line naming the next period if one is
  recorded. `Record a subscription period` is the form, with its own reason field. `Subscription
history` is the flush table. The tab used to make an operator compare two ISO instants in a table
  and guess which row was live, and it borrowed the section's single "Change reason" input, so a
  renewal read as if the reason belonged to suspending the company.
- **The pickers cannot build a period the API refuses.** Start carries no `max` at all. End's `min`
  is the later of tomorrow (an end of "today" is already past once stored at midnight) and the day
  after the picked start, derived from the start field's own state — so the pair cannot be inverted
  before the request leaves the browser, and the schema still rejects an inverted pair for requests
  that do not come from this form.
- **A scheduled period still brings no access forward.** `resolveTenantStatus` counts only periods
  whose first day has arrived and reactivating still needs a _current_ period, so recording next
  month does not lift an `EXPIRED` company back to `ACTIVE` today. Rather than leaving a status badge
  that did not move to be interpreted, the summary says it where the operator meets it: "No period
  is running now. The next one starts 1 Dec 2026, in 30 days — a period brings no access forward
  until its first day."
- **The history renders days, not instants.** `23 Oct 2026 → 22 Nov 2026`, the amount formatted in
  its own currency, a `Current` badge on the running period and a `Scheduled` badge on one that has
  not started; statuses read as words (`Active`, `Cancelled`) rather than as the enum. The raw
  `2026-10-23T00:00:00+08:00` now belongs only to the API response and the audit payload.
- **The panel owns its request and its messages.** `platform/SubscriptionPanel.tsx` (398 lines)
  takes `{ companyId, effectiveStatus, subscriptions, onRecorded, onBusyChange? }` and holds its own
  busy, error, notice, reason and start-day state; `CompanyAdministration.tsx` fell from 652 to 556
  lines and kept only lifecycle and module access plus a `refresh()` that re-reads the company
  without touching the section's shared banner. A rejection is reported inside the card that caused
  it, the days stay typed, and the success notice appears only after the API accepted the period.
- **`SubscriptionPanel.test.tsx`, 6 tests.** A future start goes through end to end and the payload
  crosses the wire as `dayToLocalInstant`; the end's `min` follows the picked start; the summary
  reads the running period and names the scheduled one; a scheduled-only company is told the rule
  and keeps its own status; a reason of only spaces is refused without spending the dates; a `409`
  is reported in the form with the dates intact and no re-read. `CompanyAdministration.test.tsx` lost
  the record-flow assertions it no longer owns and kept one wiring test — recording through the
  mounted panel calls `onChange` and shows the panel's notice, not the section's.

**Verified.** `vitest run src/platform` **46/46** (6 new, 8 rewired); full web suite **1,085 passed /
6 failed** of 1,091 — all six in `settings/PayrollPlans.test.tsx`, the 5s timeouts under parallel
load already recorded for that untouched file, which passes **25/25** alone; `tsc -p
tsconfig.app.json --noEmit` and `tsc -p tsconfig.node.json --noEmit` (web) and `tsc -p tsconfig.json
--noEmit` (api) exit 0; `eslint` exit 0 on the four web files and the two API files; `prettier
--check` clean on all seven changed files.

**Not verified.** The gated acceptance test was not run: `SAAS04_ACCEPTANCE=1` needs a disposable
PostgreSQL on `127.0.0.1:55442`, nothing is listening there and this machine has no Docker, so the
converted assertions — a future start answering `201` and a passed end answering `400` — have never
executed. No live browser walkthrough either; the four panel states are covered by the executing
tests, not by observation.

## November 5, 2026 — the owner briefing becomes three lines of facts

The dashboard's _Owner briefing_ was the longest thing on the page and said the least: a subtitle,
a six-sentence prose summary, a **Suggested checks** grid of up to three cards, and a
"View briefing evidence" drawer holding eight metric definitions. Every number in it repeated the
four tiles printed directly above or the _Business questions_ tab below, and each card's advice
restated a count the tiles already showed. It is now a 134-line card: a money line, a mix line, at
most two check lines, one qualification and the collapsed reporting window — about 60 words of
visible text instead of nine sentences and three cards. No API, schema, permission or request
changed.

- **Three lines, and every figure is one the salon can act on.** `S$100.01 paid · S$5.25 refunded ·
S$94.76 net paid`, then `3 completed receipts · S$33.34 average · 2 new customers`. A zero day
  reads `No completed sales in this period · S$0.00 refunded · S$0.00 net paid` rather than three
  sentences explaining the same zero, and a one-receipt, one-customer, one-product period is
  singularized so the strip never says "1 receipts".
- **The checks are sentences, not cards.** Refunds get one line naming the thing that actually
  confuses an owner — that a refund can belong to an earlier day's sale — and low stock gets one
  line with the count and the tenant threshold. The appointments card is gone entirely: that number
  is already a tile, and nothing about it needs a next step. Each sentence keeps its link only when
  the module is entitled, so a dashboard-only salon reads the fact without a dead end.
- **What stayed, because it was load-bearing.** The `SUPER_ADMIN`/`MANAGER` plus `dashboard`
  gate, the `key={tenant.id}:{user.id}` remount, the 401/403 suppression of cached facts, the
  salon-timezone `stamp()`, the Refresh/Retry button, the loading, stale, refused and
  last-successful-snapshot copy, and the `<details>Reporting window` holding the exact from/to
  interval. `ownerMetrics()` and its three API consumers (`/reports/dashboard`, `/explain`,
  `/owner-summary`) were not touched.
- **The trade-off, recorded rather than hidden.** The drawer's eight definitions — what "paid"
  includes, why net paid can be negative, why average ticket divides by completed receipts, why
  appointments are not completed visits — are no longer on the dashboard, and they are not printed
  anywhere else either. Reports shows the figures with their own labels and filters and the
  _Business questions_ tab can explain them on request, so an owner who needs the exact wording asks
  there. The one sentence kept is the one that changes how a figure reads: paid amounts may include
  prepaid redemptions and are not cash-only takings or profit. "Suggested checks" had no empty state
  worth keeping either: a day with nothing to check now simply shows no check lines.
- **`OwnerBriefing.test.tsx` retargeted, 14 tests.** The drawer and card-grid assertions became:
  the exact money and mix text, both entitled links, no dialog and no send/approve/activate
  control, a one-product and one-receipt day singularizing, and a `<details>` that holds the interval
  and no `<dt>` definitions. The old "removes an open workspace" test is now "drops the figures when
  the role is revoked on rerender", which is the behaviour that actually matters once there is no
  workspace to remove. The unentitled case keeps the sentences and loses only the links; the empty
  period asserts no links at all.
- **Verified.** `OwnerBriefing.test.tsx` + `Dashboard.test.tsx` **23/23**; `tsc -p
tsconfig.app.json --noEmit` and `tsc -p tsconfig.node.json --noEmit` exit 0; `eslint .` exit 0;
  `prettier --write` then `--check` clean on both files; production web build (`vite build`) exit 0.
  Full web suite **1,078 passed / 7 failed** of 1,085 — the same `settings/PayrollPlans.test.tsx`
  five-second timeouts under parallel load already recorded, which pass **25/25** when run alone;
  the failing set changes between runs (4, then 7) and the file is untouched by this change.
- **Not verified.** No live browser walkthrough: the four panel states are covered by the executing
  tests (populated, zero day, loading, error/retry, plus stale and refused), not by observation, and
  no API or database call was made. That the eight drawer definitions are no longer printed anywhere
  in the product is a trade-off this change accepts deliberately, not something it checked.

## November 5, 2026 — the customer record is five sections, and the balance rail stops moving

`/customers/:id` was one undifferentiated column of ten stacked panels: identity, archival,
details, balances, prepaid ownership, session packages, holding history, two history tables,
treatments, photos. "Can she still use her package?" meant scrolling past the archive policy to
find out, and the answer to "who is this person" competed with eight other `<h3>`s. The page is
now a header plus five URL-addressable sections, with the balances pinned beside them. No API,
schema, permission or request count changed.

- **The header is a card, not three paragraphs.** Hero avatar, the name still in the page's
  `<h2>`, an `Archived` danger badge while archived, `tel:`/`mailto:` links instead of inert
  text, and the customer code as a neutral badge. `Edit profile and consent` keeps its exact
  label, its `actions` position and its read-only `disabled` state.
- **Five tabs, deep-linkable through `?tab=`.** _Overview_ (details and notes), _Packages &
  credit_ (the three ownership/transfer/audit panels, untouched), _History_ (visits and sales),
  _Treatments_, _Photos_. _Treatments_ and _Packages & credit_ name their add-on when the salon
  has not bought it, so an unentitled tab says which module is missing instead of opening blank.
  The kit `Tabs` renders only the active panel, so a section's queries no longer fire on first
  paint; the balance rail is the only thing fetched up front. The cost is recorded rather than
  hidden: a photo-upload draft and a history page number are dropped when you switch away.
- **Balances are a sticky rail from `xl`.** A `20rem` column, `sticky` at
  `calc(var(--sp-topbar-h) + 1.5rem)` and capped to the viewport, scrolling inside itself so a
  long balance list never runs off the bottom of the screen. It is DOM-first, so on a phone the
  summary still leads and the tabs follow; `xl:order-2` is what moves it into the rail.
- **Archival stopped being the second thing on the page.** It is a card under the balances, its
  danger button full width, its policy prose demoted to `text-sm text-ink-muted`. Every sentence
  of that prose and the whole confirm → evidence flow came over verbatim, including "Evidence and
  balances will not be erased" and the zero-button archived read-only state.
- **`Card` gained a `label` prop.** A `section` is only exposed as a `region` once it has a name,
  so `label` writes `aria-label` and lets a card be a landmark. Two tests pin both halves:
  labelled becomes a region, unlabelled stays a container.
- **Prose became descriptions, and the details grid says more with less.** Labelled values for
  address, date of birth, membership reference, branches, gender and the three card numbers — all
  fields the API already returned and the page never showed. History rows are one line plus a
  status badge, photo tiles are a grid with a quieter delete action, and every section renders
  skeleton rows or an `EmptyState` instead of "Loading…" and a shrug.
- **One new shared constant** (`constants/customers.ts`) holds the four gender words, because the
  profile now reads a stored `gender` back in the words the form offers — nobody typed
  `UNDISCLOSED`. `CustomerFormDrawer` imports the same list instead of keeping a second copy.
- **No assertion was deleted.** The six that moved with their section now open that tab first
  (`Package and credit balances` region → `Balances`, `VOID` and `Receipt #12` → _History_,
  photos and pagination → their tabs). New coverage: a section fetches nothing until it is opened,
  `?tab=history` deep links, `tel:`/`mailto:` hrefs, the header `Archived` badge, the gender/card
  read-back, and the empty balance rail.

Verification: focused `CustomerProfile`/`Card`/`CustomerArchivePanel`/`CustomerFormDrawer`/
`Customers` 50/50; full web suite 1083/1083 across 120 files, run with `--no-file-parallelism`
because this machine's 5s `testTimeout` fires on `userEvent`-heavy files when 120 of them share
the cores (a parallel run failed only timeouts in unrelated payroll, consent and payout files,
each of which passed alone). Web `typecheck`, `eslint`, changed-source `prettier --check` and the
production build pass. No authenticated browser visual review was possible here: the sticky rail,
the `20rem` rail width and the 44px row rhythm are asserted by class and by test, not seen.
Current task: None. Most recently completed: CUST-UX. Next: None selected.

## November 5, 2026 — the staff editor is a page, and each write owns its own button

Screen 09's edit surface was one 746-line drawer holding **five independent save scopes**:
profile, password reset, roster, payroll plans and commission rules. Only the profile had a
pinned footer button, so a payroll edit three scrolls down looked like it was saved by "Save
changes" — the drawer was lying about the API, which had always treated those as separate
writes. The fix is layout, not behaviour.

- **`/staff/:id` (`pages/StaffProfile.tsx`)** — the record behind a Settings-style rail:
  _Identity & profile_, _Login & security_, _Working hours_, _Payroll_, _Commission rules_.
  The rail is the Settings one reused verbatim: `?section=` deep links, a mobile `<select>`,
  a desktop `<nav aria-label="Staff sections">` with `aria-current`, and sections that mount
  on first visit then stay mounted while hidden, so switching a section does not throw away
  an unsaved draft. `payroll` and `commission` are not in the rail at all for someone who may
  not configure employment terms, rather than shown and then refused.
- **One card, one save.** `StaffIdentityForm` is the profile extraction — name, role,
  position, phone, dates, branches, one `Save changes`. `StaffAccessCard` splits the login
  facts into three commands: the POS PIN (set, or revoke as an explicit `posPin: null`), the
  password reset (`POST /api/staff/:id/password`, still its own endpoint), and an
  _Account status_ card that carries `disabled` on a button of its own. The email is text,
  because `updateStaffSchema` has no `email` field to post (ADR 0007).
- **No contract change.** `updateStaffSchema` was already partial, so the drawer's single
  PATCH becomes three small ones; nothing new was added to the API, the schema or the
  service. The role rules came over unchanged: a manager may still recover a
  `STAFF`/`CASHIER` password and never a peer manager's or an owner's, a POS PIN-only row
  still has no reset block, and payroll plans stay owner-writable while a manager reads them.
- **Create stays a drawer** (`StaffFormDrawer`, 746 → 471 lines). It is one short form with
  one save, it belongs beside the list it appends to, and the `staff` prop that used to
  switch it into edit mode is gone. Its "configure payroll after creation" tick now lands on
  `/staff/<id>?section=payroll` — a real URL, not a second half of the drawer.
- **`pages/Staff.tsx` is a list again.** `editing`, the `get<StaffDetail>` pre-fetch and the
  `key={id:open}` dance are gone; the row action navigates, and the name is a plain link to
  the record (the shape the customers list already uses). The drawer is keyed on the open
  state alone.
- **Keyed remount, kept honest.** Both new forms key on `staff.id`, so a refetch after one
  save cannot write a draft over a record it never loaded — what the drawer's `key` could
  not do for an edit.
- **Tests.** `StaffProfile.test.tsx` is new: 14 tests covering the start-date
  `expectedStartDate` comparison (including the baseline moving forward after a save, so a
  second change is not refused as a conflict with itself), the split PATCH for `disabled`
  and for `posPin: null`, the six-digit local check, the reset posting on its own endpoint,
  the mistyped confirmation, the PIN-only and manager-vs-manager rules, and the read-only
  rail for a stylist and a suspended salon. `Staff.test.tsx` keeps the list, the tiles, the
  filter, "who may write" and the create form (19 tests), now inside a `MemoryRouter`
  because the row action navigates; the payroll-continuation test asserts the destination
  instead of a mounted panel. Both files pass (**33/33** together), and the full web suite
  is **1,061 passed / 5 failed** of 1,066 — the same `settings/PayrollPlans.test.tsx`
  five-second timeouts under parallel load that were already recorded, and that file still
  passes **25/25** with `--testTimeout=30000`.

- **Verified.** `tsc -p tsconfig.app.json --noEmit` and `tsc -p tsconfig.json --noEmit`
  (api) exit 0; `eslint` on every changed file and `prettier --check` exit 0; the api and
  shared workspaces are untouched by this change.

## November 4, 2026 — Team & commissions no longer blanks out on a salon with no plans

`/settings?section=team` fell over to the cached-page boundary — "The screen failed to load" — for
any salon that had never created a payroll plan. The trigger was a single line in `PayrollPlans`:

```ts
const definition = draft?.planId === plan?.id ? draft!.definition : version?.definition;
```

With no plans, `data.plans` is empty, so `selected` stays `null` and `plan` is `undefined`; the
component then already picked "no plan", so `draft` is `null` too. Optional chaining on both sides
of the equality made `undefined === undefined` **true**, the conditional took the draft branch, and
`draft!.definition` threw on `null` — the `!` silenced the compiler exactly where the runtime had
nothing to read. So the crash lived on the **empty** state, not on a configured one, which is why a
freshly seeded tenant hit it and a demo tenant with a Hair sample did not.

- **The guard is the draft, not the comparison.** `draft && draft.planId === plan?.id` short-circuits
  before any field of the draft is read, so a null draft can only take the version branch regardless
  of what `plan?.id` is. The comment in the file records why the equality alone is not a guard.
- **Nothing else on the section was hiding behind it.** The adjacent `stale` flag already used
  `!!draft && …`, and the rendered empty state (0 active plans · 0 staff on a plan · N without a plan
  (flat fallback), disabled save/assign controls) was already correct — it simply never got to paint.
- **Regression test.** `PayrollPlans.test.tsx` gains "renders a salon with no plans yet instead of
  reading a definition off a null draft", mounting the real component against a `plans: []`
  configuration. Verified both ways: reverted to the old line it fails with
  `TypeError: Cannot read properties of null (reading 'definition')` (1 failed / 24 skipped), and with
  the fix the file is **25/25**.
- **Live reproduction.** Headless Chrome (CDP, token injected straight into storage — no login flow)
  against the running dev servers now renders the whole section: staff list, attribution policy,
  versioned plans empty state, assignments, staff payroll settings, salary profile, month-to-date
  progress, commission matrix and company rules. No "Something went wrong", no page exception, and
  no 4xx/5xx response at all: the section now paints every panel it was already built to render.
- **Verification.** `src/components/settings` + `Settings.test.tsx` **146/146**; the full web suite
  **1,046 passed / 8 failed** of 1,054, the same eight already-recorded `PayrollPlans.test.tsx`
  five-second timeouts under parallel load (the file passes **25/25** alone, checked again after this
  change); `tsc -p tsconfig.app.json --noEmit`, `eslint` and `prettier --check` on the changed files
  exit 0.
- **Left alone, recorded instead.** The staff payroll form shows `joinDate: Invalid ISO date` for a
  staff member with no join date, because the write contract makes `joinDate` required and the form
  validates an empty string rather than relabelling it. That is a deliberate required-field contract
  (`settings.test.ts` asserts `joinDate: null` is rejected), so changing the wording or the rule is a
  product decision, not part of this crash fix.

## November 4, 2026 — consent is captured where the customer is created

Screen 07's Add drawer used to say "Save the customer first, then edit their record to capture
privacy and marketing choices." A salon that takes a walk-in by name alone therefore recorded
nothing — and downstream, "no consent on record" reads exactly like "the customer declined". The
drawer now captures the choice in the same sitting.

- **One endpoint, two requests.** The block is a controlled component with no button of its own
  (`CustomerConsentCapture.tsx`); `handleSubmit` posts the customer, then posts the choices to
  `POST /customers/:id/consent` — the same audited route, schema and guards the edit panel uses.
  Nothing about notice versions, revision conflicts or "marketing implies data" is re-implemented
  in the UI; the drawer only decides _whether_ to make the call.
- **`expectedRevision: 0` is not a guess.** The revision belongs to the record created a moment
  earlier, so no other writer can have touched it between the two calls.
- **Nothing ticked means no consent event at all.** The server treats `false → false` as a no-op,
  so the drawer skips the request rather than writing an audit row that records no decision.
- **Not atomic, and it says so.** If the consent call fails the customer still exists, so the
  toast reads "Customer added, but consent was not saved: …" and the new record is handed back to
  the page (`onCreated`); the existing `key` on the drawer remounts it in edit mode with the real
  consent panel one click away. It never closes as if the choice was stored.
- **No notice, no dead checkbox.** With nothing published, or while the notice is still loading,
  the boxes are disabled and the reason is spelled out; the customer is saved with no consent.
- **Two small contract moves.** `usePrivacyNotice(enabled = true)` lets the drawer skip the read in
  edit mode, where the panel owns it; `useRecordConsentForNewCustomer()` takes the id with the
  call because creation happens inside the submit handler. Channel (WhatsApp/SMS) consent stays in
  the edit drawer — it is per-channel and out of scope here.
- **Tests.** New `CustomerConsentCapture.test.tsx` **5/5** and `CustomerFormDrawer.test.tsx`
  **6/6**: no notice published, unreviewed grant refused before anything is sent, data-only and
  data+marketing grants, no-choice create, and the consent-fails-after-create path. The page test
  that renders this drawer needed a `useConsent` mock (**13/13**).
- **Verification.** Full web suite **1,045 passed / 8 failed** of 1,053 — all eight the
  already-recorded `PayrollPlans.test.tsx` five-second timeouts under parallel load, which passes
  **24/24** alone. `eslint`, `tsc -p tsconfig.app.json --noEmit` and `prettier --check` on the
  changed files: exit 0.
- **Not claimed.** No browser or visual review and no database access; the API, shared contracts
  and migrations are unmodified, so the consent endpoint itself was not re-exercised live.

## November 4, 2026 — the Renews column leaves the Features panel

`?section=features` drew four columns: **Module**, **Type**, **Access** and **Renews**. The last was
wrong twice over — by name and by audience.

- **`Renews` was never a renewal date.** The cell rendered `ModuleSummary.expiresAt`, which
  `listModules()` fills from the tenant's grant row: the instant a module's `TenantModule` lapses,
  or `null` for core and for an open-ended grant. Nothing in the product renews a grant — a
  platform operator grants, revokes or re-dates it in the console, and that screen calls the same
  field **Expires** (`CompanyAdministration.tsx`). A salon reading "Renews" would expect access to
  continue on that date; in fact access stops working on it.
- **A salon cannot act on it.** The card's own description says "Contact support to change your
  subscription", so the date was a deadline with no control attached. It also read `—` on every
  core module and every open-ended grant — most of the table, most of the time.
- **The answer the panel exists for is the badge.** `Access` already resolves to Core, Active or
  Not purchased through the same rule `requireModule` enforces, so the panel can still never
  disagree with the routes. The salon-facing expiry that _is_ actionable — the subscription's own
  end date — stays where it was, as **Subscription ends** in the salon profile's Account details.
- **The contract is untouched.** `moduleSummarySchema.expiresAt`, `GET /api/settings/modules`, the
  service, the platform console and the database all still carry the date; only this table stopped
  showing it. Deleting the field would have meant a schema/migration change for a read-only
  display decision.
- **Dead code went with it.** `useSalonFormatting()` was the only thing `ModulesCard` used it for,
  so that hook call left too; `ProfileCard` still formats dates and still imports the hook.
- **A guard, not a deletion.** `Settings.test.tsx` gained one test that reads the modules table
  through its caption and asserts the headers are exactly `Module`, `Type`, `Access` — no column
  can reappear under the old heading without failing.
- **Verification.** `Settings.test.tsx` **29/29**. Full web suite **1,035 passed, 7 failed** of
  1,042, all seven the already-recorded `PayrollPlans.test.tsx` 5-second timeouts under parallel
  load; that file passes **24/24** alone in 43 s (the same flake is recorded against unmodified
  `HEAD` in the entry below). `eslint`, `tsc -p tsconfig.app.json --noEmit` and `prettier --check`
  on the two changed files: exit 0.
- **Not claimed.** No browser or visual review. The API, shared contracts, platform console and
  database are unmodified, so nothing here re-exercises them.

## November 4, 2026 — the rooms-and-equipment card leaves Settings

"Booking & hours" held two cards and now holds one. **Rooms and equipment** described what a
booking can occupy — a name, a room-or-equipment kind, an active/inactive archive and the set of
services allowed to use it — and it was the only screen in the product that wrote any of it.

- **The card is gone; the rule is not.** `assignResources` in `appointment.service.ts` still gives
  every occupying line the first free room or machine from its service's eligible set, on every
  create, reschedule, series occurrence and public availability check. It still answers the
  `409 RESOURCE_UNAVAILABLE` conflict when that set is busy or archived. The `GET`, `POST` and
  `PATCH` routes under `/api/resources`, the `Resource` and `ServiceResource` tables, the shared
  contracts and the `Booked in {room}` read-out on the appointment drawer are untouched.
  `status: INACTIVE` is still an archive, and a line whose room is deleted still keeps its history
  (`onDelete: SetNull`).
- **The cost of hiding it, stated plainly.** Nothing in the product now creates a room, renames
  one, archives or reactivates one, or edits which services may use it — and the route has no
  `DELETE` by design, so archiving was the only off-switch. A service whose only linked rooms are
  already `INACTIVE` cannot be booked at all, and the 409 that tells the desk to "reactivate one
  or add another" now points at a screen that does not exist. That is the visible consequence of a
  UI-only removal, not an oversight.
- **The section keeps its id, its label and its neighbour.** `?section=booking` still resolves to
  Business hours, and the nav blurb reads "Opening hours that decide when the salon can take a
  booking" instead of advertising a control that is no longer rendered. The fragment that wrapped
  the two cards collapsed to the one that remains.
- **Dead code went with it.** `ResourcesCard` (279 lines), its five component tests, the
  `useResources` hooks and their three tests, and the `resources` entry in `queryKeys` were
  deleted rather than parked: once the mount went, nothing in `apps/web` imported them, and the
  eligibility-paging helper existed only to fill the card's checkbox list. `Settings.test.tsx`
  lost the `@/hooks/useResources` mock and its two "the card is visible" assertions, and gained a
  single guard that both removed cards cannot return — the shape the online-booking removal left
  behind.
- **Verification.** `Settings.test.tsx` **28/28**. Full web suite **1,034 passed, 7 failed** of
  1,041, all seven `PayrollPlans.test.tsx` 5-second timeouts under parallel load: the
  same file loses 8 of its 24 the same way on unmodified `HEAD` (a stashed-tree run measured 1,041
  passed, 8 failed of 1,049) and passes **24/24** alone in 42 s, so the flake is recorded rather
  than inherited. The total fell by exactly the eight tests deleted. `eslint`, both `tsc --noEmit`
  projects and `prettier --check` on `apps/web`: exit 0, and a grep for `ResourcesCard`,
  `useResources` and `queryKeys.resources` across `apps/web/src` returns nothing.
- **Not claimed.** No browser or visual review. The API, the public booking page, the database and
  the tenant columns are unmodified, so nothing here re-exercises them.

## November 4, 2026 — the online-booking card leaves Settings

"Booking & hours" held three cards and only two of them belonged there. The **Online booking**
card — an enable toggle plus deposit and no-show fee inputs — sat above the business hours that
give the section its name, and its values were the only ones on the page that no other part of
the salon app reads back.

- **The card is gone; the feature is not.** `onlineBookingEnabled`, `onlineDepositAmount` and
  `onlineNoShowFee` stay on the tenant, on `salonProfileSchema` and in the public booking
  contract: `public-booking.service.ts` still refuses to take a booking when the toggle is off
  and still stamps the stored deposit and no-show fee onto the appointment it creates. Only the
  UI is hidden — a salon already taking online bookings keeps taking them, at the same fees.
- **The cost of hiding it, stated plainly.** That toggle was the only control in the product
  for turning public booking on or off. The stored value now decides, and no screen edits it.
  That is the visible consequence of a UI-only removal, not an oversight.
- **`ProfileCard` lost its second mode.** It was one component with a `booking` flag that
  swapped the title, the description, the entire form body, the submit payload, the button label
  and the read-only sentence. With the booking card removed the flag could only ever be `false`,
  so the branch is deleted rather than left dead — one component, one purpose, and a payload that
  sends exactly the four profile keys the form shows.
- **The section keeps its id, its label and its neighbours.** `?section=booking` still resolves
  to Business hours and Rooms and equipment, and the nav blurb now reads "Opening hours and the
  rooms or equipment you book" instead of advertising a control that is no longer rendered.
- **Business hours are untouched, and they do generate slots.** `fitsOperatingHours` in
  `booking-hours.service.ts` gates public availability and the public booking write through
  `withinHours` (the whole service must fit the day's window, on the existing 30-minute grid
  anchored at opening, with real minute boundaries across DST), and internal create/reschedule
  through `assertOutletBookingHours`. An outlet that never overrode its week inherits the company
  hours this card saves. Company-wide internal bookings with no outlet selected stay deliberately
  permissive, as `docs/outlet-booking-hours.md` already records.
- **Verification.** `Settings.test.tsx` **28/28** — the three online-booking tests became one
  guard that the card cannot return, and the draft-preservation test now round-trips a
  business-hours edit instead of a deposit amount. `prettier --check`, `eslint` and `tsc --noEmit`
  on `apps/web`: exit 0. Full web suite **1,040 passed, 9 failed**, all nine in
  `PayrollPlans.test.tsx`, which this change does not touch and which fails the same two
  `basicSalary` pattern assertions when run alone — the payroll form work already uncommitted in
  the tree.
- **Not claimed.** No browser or visual review. The API, the public booking page and the tenant
  columns are unmodified, so nothing here re-exercises them.

## November 4, 2026 — platform-owned localisation, and plan end dates on both sides

Two screens answered "what does this salon's plan say?" badly. The salon's Settings page
offered **Salon timezone** and **Formatting locale** as editable text inputs — they are
platform decisions, and a typo there silently moved every date the salon sees. The
operator's directory showed a company's status but never when its plan ends, so
"is this account about to lapse?" was a question you answered by opening the company, then
the subscription screen.

- **The two localisation inputs are gone from Settings.** The fields still exist on the
  profile and still feed `SalonFormattingContext` and every server-side formatter; the form
  simply no longer renders or submits them. `updateSalonProfileSchema` already treats them
  as optional and the service writes `{ ...input }`, so an omitted key is left alone —
  a profile save can no longer reset a salon's formatting preferences, and the existing
  round-trip tests for the API stay green.
- **Account details now includes "Subscription ends".** Read-only, like the slug and
  status beside it: the latest `Subscription.endDate`, or `—` when no plan is recorded.
  "Account details" was the salon-side block on Settings — `/platform/account` holds only
  the operator's own credentials and no tenant data.
- **The directory shows the same date per row**, plus the same fact on the company page.
  Both read the latest plan exactly as `prepaid.service.ts` and the expiry check do, so the
  console, the salon and `resolveTenantStatus` cannot disagree about when a plan lapses.
  "No plan recorded" is a sentence rather than an em dash, because in a table it is the
  answer an operator needs before selling one.
- **Four tiles above the directory**: All companies, Active, Suspended, Ending in 30 days.
  They are computed by the API — `listCompanies` grew a `$transaction` with the existing
  page and count plus a `groupBy(["status"])` and one count for `expiringSoon` — so a
  company created mid-request cannot appear in a tile but not in a page. They count the
  whole directory and never narrow with the search box: the first tile is labelled "All
  companies" while the card title keeps reporting the filtered count.
- **`expiringSoon` means what it says**: a live company whose **latest** end date falls in
  the next 30 days, expressed as `subscriptions.some(endDate in window)` **and not**
  `subscriptions.some(endDate after window)`. A company already past its last end date has
  lapsed, not is expiring, and `resolveTenantStatus` is what turns that into `EXPIRED`.
  Suspended companies are likewise not "ending in 30 days".
- **Contracts.** `salonProfileSchema` and `companySummarySchema` (and therefore
  `companyDetailSchema`) gained `subscriptionEndsAt: string | null`; a new
  `companyDirectoryStatsSchema { total, active, suspended, expiringSoon }` is carried on
  `companyListSchema.stats`. The field is required, not optional, so a screen cannot
  silently render a blank date — every fixture had to be updated, which is the point.
- **The tiles reuse `StatTile`** (`role="group"`, `aria-label="Company directory overview"`)
  instead of a fourth bespoke stat box, and the warning tone is amber because a suspension
  is an operator action that needs an answer — unlike a disabled staff account, which is
  just a state.
- **Verification.** Shared **312/312** (`npm run test --workspace @glampro_suite/shared`).
  Web: `Settings.test.tsx` **29/29**, `Companies.test.tsx` **8/8**, `platform/api.test.ts`
  **5/5**; full web suite **1,042 passed, 8 failed**, all eight `PayrollPlans.test.tsx`
  timeouts under parallel load — that file alone is **24/24**, the same pre-existing flake
  recorded below. API: `settings.routes.test.ts` **9/9** (now seeds two plans and asserts
  the later one, that a salon without a plan reports `null`, and that a `PATCH` carrying
  `subscriptionEndsAt` is a 422) and `companies.acceptance.test.ts` **1/1** against a
  throwaway PostgreSQL on port 55441 created for the run — it now creates a plan ending in
  10 days and asserts both the row's date and that `expiringSoon` rose by exactly one.
  `lint` and `prettier --check`:
  exit 0 for `apps/web` and `packages/shared`; the api workspace fails only on the unused
  `HttpError` import left by the local 2FA debug hack in `auth.service.ts`, which is not
  part of this work and was reinstated byte-identical after the route tests were run
  against its committed form.
- **Not claimed.** No browser or visual review: the checks are type, lint, unit tests and
  HTTP-level route tests. `glampro_test` was several migrations behind, so it was brought
  to head with `prisma migrate deploy` before the route suites could run.

## November 4, 2026 — the platform console rebuilt on the design system, with real routes

The operator console was the last screen family on hand-written CSS — `platform/style.css`,
544 lines, with its own purple (`#58378b` against the token's `#6144E4`), its own font
stack (`system-ui` instead of Plus Jakarta) and its own buttons. It also faked routing:
`PlatformApp` compared `useLocation().pathname` to the one path it could draw and
`Navigate`d whenever they disagreed, so a company had no URL, and "Account & security"
opened as a panel _inside_ the company list — an operator changing their password was
one scroll away from a company's delete button.

- **Real routes.** `PlatformApp.tsx` is now a route table: `/platform/login`, `/platform`,
  `/platform/companies/new`, `/platform/companies/:id`, `/platform/account`. An unknown
  path under `/platform` falls back to the directory; an unauthenticated one goes to
  sign-in. The session is still state, never storage — the reload guarantee in
  `docs/platform-console.md` is unchanged and asserted by a test that reads
  `localStorage`/`sessionStorage` after sign-in.
- **Split pages, not one growing file.** `Companies.tsx` (441 lines, directory + create +
  detail + purge in one component) became `CompaniesPage.tsx`, `CreateCompanyPage.tsx`
  and `CompanyDetailPage.tsx`; `AccountSecurity.tsx` became `Account.tsx`. The chrome
  moved into `PlatformShell.tsx`, sign-in into `PlatformLogin.tsx` — the salon `Login`
  layout, reusing the same `BrandMark`, which is now `components/ui/BrandMark.tsx` rather
  than a copy.
- **Module access is switches, not two selects.** The old form asked for a module _and_
  a separate grant/revoke choice, with an ISO timestamp typed by hand: two ways to pair
  the wrong module with the wrong action, and no view of current state while doing it.
  It is now one switch per module in a `Table`. Core rows are checked and disabled;
  a lapsed grant (`enabled: true, entitled: false`) reads off with an `Expired <date>`
  badge instead of looking like a plain gap.
- **New `components/ui/Switch.tsx`** (with `__tests__/Switch.test.tsx`): `role="switch"`,
  `aria-checked`, native Space/Enter, a 44px row and an accessible name from its label.
  `loading` keeps the server's position and refuses input, so a rejected change cannot
  leave a switch showing a state that was never saved.
- **Every toggle still needs a reason.** `companyModuleSchema` requires one, so a switch
  opens a confirmation with the reason field (and an optional expiry only when granting)
  and reports a failure _inside_ that dialog — an alert behind the overlay is not an
  alert. Same pattern for suspend/cancel, and for the purge.
- **The purge is a modal, not a `<details>`.** The danger zone is a card with one button;
  the confirmation requires a reason and the slug typed back and stays disabled until
  both are right. A `409` keeps the dialog open with the reason still typed.
- **Kept on purpose:** `DetailTabs` stays hand-rolled (the kit `Tabs` unmounts inactive
  panels, which would wipe a half-typed change reason), with the tab ids and
  `aria-controls` unchanged.
- **Verification.** `src/platform` 38/38 (was 24), `Switch.test.tsx` 6/6. Web
  `tsc --noEmit`, ESLint, Prettier `--check`: exit 0. `npm run build`: exit 0, and
  `PlatformApp-*.js` is 43.6 kB in its own chunk. Full web suite: **1,035 passed, 6
  failed**, all six `PayrollPlans.test.tsx` `Test timed out in 5000ms` under parallel
  load; that file alone is **24/24** — pre-existing, unrelated to this work.
- **Not claimed.** No API or shared change in this slice, so those suites were not
  re-run. Browser/visual review of the ported screens was not performed: the checks
  above are type, lint, build and jsdom only. `style.css` is deleted; nothing else on
  disk referenced it.

## November 4, 2026 — a committed security regression in platform operator sign-in, fixed

The CP-007 re-verification earlier today reverted a laptop debug hack in
`apps/api/src/services/auth.service.ts`. **The same hack existed in a second file and was still
committed.** `apps/api/src/services/platform-auth.service.ts` printed the platform operator's MFA
code with `console.log` and had the `sendTwoFactorCode` call and its `EMAIL_SEND_FAILED` branch
commented out, so operator sign-in never emailed anything and wrote the second factor to the log
stream. It arrived on October 26 in `c897b052` — a commit titled _"docs: plan staff commission
extension"_ — and was live on `master` and `origin/master`.

- **Both stated contracts were false while it was live.** `lib/email.ts` documents that a
  verification code is "never returned to callers or written to application logs", and
  `PROJECT.md` (SAAS-02) says platform login requires real SMTP configuration. Because the
  `try`/`catch` was gone, a refused SMTP connection also stopped clearing the challenge and
  stopped returning the actionable `503 EMAIL_SEND_FAILED`.
- **No gate could see it.** The file compiles, ESLint and Prettier are clean (every remaining
  import is still used by the `EMAIL_NOT_CONFIGURED` refusal), and the ungated
  `services/platform-auth.test.ts` only covers that refusal. The suite that does cover delivery is
  opt-in — and it **could not pass**: `routes/platform-auth.acceptance.test.ts` reads the code out
  of the captured SMTP message and asserts the 503 with a cleared `loginCodeHash`.
- **Fix, one source file.** `platform-auth.service.ts` restores `try { await
sendTwoFactorCode(...) } catch { updateMany(clear this challenge); throw 503 EMAIL_SEND_FAILED }`,
  deletes the `console.log`, and re-adds the import. The restored shape matches the salon login in
  `auth.service.ts`, not the older `throw error;` form that the gated assertions reject.
- **Tripwire.** New ungated `apps/api/src/services/platform-auth-delivery.test.ts` (mocked
  `nodemailer.createTransport`, replaced Prisma delegates, captured `console.log`): the mail must
  carry the six-digit code, the stored `loginCodeHash` must be the hash of that exact
  challenge/code, **no log line may contain the code**, and `ECONNREFUSED` must produce
  `503 EMAIL_SEND_FAILED` with exactly that challenge cleared. Both cases fail against the pre-fix
  source, so it is a real tripwire.
- **Verification.** Targeted `platform-auth.test.ts` + the new file `4/4`, exit 0. API
  `tsc --noEmit`, ESLint on both files, Prettier `--check`, `git diff --check`: exit 0. Full
  ungated API suite (fresh disposable PostgreSQL 18 cluster
  `/tmp/saas02-pg-Wbxof4` at `127.0.0.1:55440/api_default_run`, 70 migrations, UTC):
  **1,488 tests — 1,213 pass, 0 fail, 275 skipped**, log `/tmp/api-default-verify3.log`. Gated
  `SAAS02_ACCEPTANCE=1` against `127.0.0.1:55440/saas02_acceptance` (66 migrations):
  **1/1 pass**, with the run's own log showing `Email sent … transport: smtp` and no code in any
  line; the same suite on the pre-fix file is **0/1 fail**, so the fix is demonstrably
  load-bearing.
- **Not claimed.** The web suite, the mounted-Chrome acceptance and the gated payroll acceptance
  were not re-run — no web or payroll source changed. The application database
  (`localhost:5432/glampro_suite`) was never connected to; every run used the disposable cluster,
  which was stopped afterwards with its data directory left under `/tmp`. Nothing was pushed.
- **SEC-01 stays deferred by owner decision**, as recorded in `docs/commission_payroll/PROGRESS.md`:
  the payroll-economics immutability trigger legitimately refuses that suite's `tenant.deleteMany`
  teardown, and choosing a test-only bypass is a separate decision.

## November 4, 2026 — CP-006 DONE for local acceptance: browser acceptance in mounted Chrome

CP-006's last open item, browser acceptance of the payroll reporting surfaces, now runs as an
opt-in suite instead of a manual checklist: **10/10 subcases, exit 0, twice** in headless
Chrome against the real API, the real Vite app and a disposable PostgreSQL 18 cluster.
Local supported scope only: no release, no earnings activation, no schema, application-database,
production, activation, commit or push work.

- New opt-in `apps/api/src/services/payroll-reports-browser.acceptance.test.ts`
  (`RUN_CP006_BROWSER_ACCEPTANCE=true`). The owner approves 2026-09 through Settings → Payroll
  close, approves the carry month 2026-10, and leaves the open month `CALCULATED` — the
  "previous close or authorized opening required" refusal is satisfied, not bypassed.
- Proven in the mounted app: the frozen period report and its `Source` drill-down; `Salary`/
  `Take home` in the statements table but never in the report; all three exports downloaded from
  the UI with bytes verified in-page (`PK\x03\x04`, `%PDF`, BOM + CRLF ledger, one row per frozen
  line, and a `?staffId=` ledger of exactly one row); a manager reading the report with no salary
  column and 403 on export/approve; a staff member's **estimated** month-to-date card plus only
  their own two approved statements and the eleven-field projection with no identity or salary;
  a cashier refused with an explanation; the till showing only the seller's own progress; and a
  customer profile rendering a real value-package purchase's holding history.
- Disclosed, not claimed: no human opened the workbook in a spreadsheet application or printed
  the payslip PDF here. Session bootstrap is a synthetic signed token against the real
  `/auth/me`, so this is not login/2FA/refresh acceptance, and MTD remains the last stored
  calculation, leaving the CP-007 `<500 ms` budget untested.
- Verification: API typecheck, ESLint and Prettier on the new file exit 0; without the flag the
  suite reports `1 skipped` and exits 0, so the ordinary API run is unchanged. Log
  `/tmp/cp006-browser.log`; details in `docs/commission_payroll/BROWSER_ACCEPTANCE.md`,
  `TASKS.md` and `PROGRESS.md`.

## November 3, 2026 — CP-003A DONE: evidence matrix, money cases, browser money acceptance

CP-003A's three open checklist items are closed on the disposable
`55485/payroll_close_test` cluster, and the browser work found and fixed a live
client-side defect. Local supported scope only: no release, no earnings activation,
no migration, dependency change, commit or push.

- New opt-in `apps/api/src/services/payroll-historical-preview-evidence.acceptance.test.ts`
  (`RUN_CP003A_PREVIEW_ACCEPTANCE=true`, **8/8**). One injected capture turns an
  otherwise payable month into `UNAVAILABLE` with `impact: null` and exactly one
  blocker per family (`SOURCE_WORKFLOW_NOT_LOADED`, `PREPAID_SETTLEMENT_MISSING`,
  `SOURCE_EVIDENCE_INVALID`) while configuration blockers stay empty. An authorized
  empty month is `AVAILABLE` at `0.00` and the identical month without opening
  evidence refuses by name; a zero-rate plan returns evidence-backed `0.00` rows.
  Money cases deep-equal the posted statements and input hash: fractional fixed units
  (`0.5000`), same-month refund (`0.0000`), prior-month refund carried as `-1.0000`
  units / `-100.0000` base, outlet pooling across two branches (`200.0000`), an
  outlet-context refusal, and a disabled staff member whose posted money is unchanged.
- New opt-in `apps/api/src/services/payroll-preview-money-browser.acceptance.test.ts`
  (`RUN_CP003A_BROWSER_ACCEPTANCE=true`, **6/6**) drives authenticated Chrome against
  four real sales: `S$40.00` salon total with four `S$10.00` rows and the live
  money-source label; a server-side revision bump leaves no money in the panel; the
  reloaded revision shows version 2 at `S$50.00` / `+S$10.00`; permission loss and a
  blocked request both clear the money and recover; a calculated month renders the
  frozen-close money source at the same posted total.
- Defect fixed: the web impact schema required a numeric `calculationVersion` while
  the API sends the calculator label `"cp-005-v2"`, so **every** `AVAILABLE` preview
  failed client validation and the page showed "Unable to check historical inputs.
  [expected number …]". CP-003's Chrome suite never caught it because those months
  were always `UNAVAILABLE`. `apps/web/src/components/settings/payroll-impact.ts` now
  binds the string the API sends, and the three web fixtures use `"cp-005-v2"`.
- `apps/api/src/test-support/payroll-close-fixture.ts` gained an opt-in `periodKey`
  (default `2026-09`, unchanged behaviour) that derives the audited setup date and the
  mid-month activity date, so browser acceptance can use the real
  last-completed-month window instead of mocking `Date` in the process that also
  drives `Browser.wait`.

Verification: CP-003A API acceptance **8/8** plus the original preview acceptance
**1/1**, Chrome money acceptance **6/6**, CP-003 configuration/lifecycle **7/7**,
CP-003 Chrome configuration acceptance **18/18**, all sixteen gated CP-005 API suites
**216/216 with no skips**, CP-005 Chrome suite **10/10**, API and web typecheck exit
0, focused web unit tests **37/37**, ESLint and Prettier clean on every touched file.
The `55485` cluster was stopped again with its data retained; `55473` was left as
found. Docs updated: `docs/commission_payroll/TASKS.md` (CP-003A DONE),
`docs/commission_payroll/PROGRESS.md`, `docs/commission_payroll/HISTORICAL_INPUTS.md`.

## November 3, 2026 — CP-003A preview and CP-003/CP-005 acceptance re-verification

Re-ran the opt-in payroll acceptance suites against the two disposable PostgreSQL
clusters. CP-003A historical preview acceptance **1/1**, CP-003 configuration plus
concurrent lifecycle acceptance **7/7**, CP-003 authenticated Chrome acceptance
**18/18**, all sixteen gated CP-005 API suites **216/216** and the CP-005 Chrome suite
**10/10** pass with no skips; API typecheck exits 0. No application code changed; two
opt-in fixtures were made deterministic.

- The Chrome fixture seeded only the `staff` module, so the staff drawer's department
  picker (`/api/departments`, guarded by `catalogue` in `departments.routes.ts`)
  refused with `MODULE_UNKNOWN` and rendered "no departments yet". Both rows are core
  in `prisma/seed.ts`, so the fixture now upserts `catalogue` beside `staff`.
- `payroll-close-loader.acceptance.test.ts` stamped the package transfer with the
  database clock and then mocked fixed November midnights for the recipient draws, so
  once the wall clock passed `2026-11-03T00:00Z` the ownership verifier refused a draw
  that sorted before its own transfer (`PACKAGE_OWNERSHIP_UNCONFIRMED`). The mocked
  recipient instants now start at or after the transfer and rise monotonically.
  `verifyPayrollPackageOwnership` is unchanged — the identical rows pass as soon as the
  draw follows the transfer.

CP-003A remains **IN PROGRESS**: the missing-versus-authoritative-zero evidence matrix,
the refund/reversal, fractional fixed-unit, negative-balance and outlet-scoped money
cases, and authenticated browser acceptance of the monetary states are still open
checklist items. Prettier, ESLint and API typecheck pass on the touched files; the
CP-003 Chrome run rewrote only disposable fixture tenants, and the `55485` cluster is
stopped again with its data retained (restart with
`pg_ctl -D /tmp/cp005-preview-pg -o "-p 55485 -k /tmp -c timezone=UTC" start`). The
pre-existing `55473` cluster was left as found.

## November 2, 2026 — CP-005 M5 final local acceptance

**M1–M5 / CP-005 DONE for local supported scope, not release/cutover.**
Completed mounted manager draft/adjustment and real receipt stale-source flows,
owner complete opening/debt write-off/stale authorization repair, independent
five-method/two-stage money matrix and 50-staff/1,000-real-receipt/five-plan timing.
Chrome **10/10** and final focused **56/56**; enabled payroll regression **641 tests:
634 passed, 0 failed, 7 separately gated skips**; full API **1,388 tests: 1,131
passed, 0 failed, 257 opt-in skips**; web **981/981**; shared **305/305**. Workspace
lint, typecheck and shared/API/web builds pass. Removed repeated collection
history/sale queries while preserving complete-history exact-cent tax reconciliation.
Final monthly samples **7,265.8 / 8,057.3 / 8,086.4 ms**, all <10 seconds; not MTD
or throughput acceptance. Commands, samples and the initial failed attempts:
`docs/commission_payroll/APPLICATION_CLOSE_ACCEPTANCE.md` and
`docs/commission_payroll/PROGRESS.md`.

CP-003A, CP-006 MTD/exports/reports/self-service UI and CP-007 release/cutover remain
separately gated. Only identity-verified disposable PostgreSQL was written. No
schema/migration/dependency, production DB, provider payment, deployment, activation,
commit or push changes. Older M5-open checkpoints below are historical.

## November 2, 2026 — CP-005 M4 DONE; M5 IN PROGRESS

Mounted `/api/payroll-close` in the real application and Settings → Payroll close.
Owner/manager actions use authenticated salon-wide scope; manager/self-service
responses omit salary and raw input inventories. Cashiers cannot read statements.
Frozen reads, reasoned adjustments/approval and separate actual payout confirmation
pass real HTTP and Chrome acceptance. No funds are transferred or earnings activated.

Verification: mounted HTTP/state/projection **14/14**, Chrome **8/8**, full API **1,386
tests: 1,130 passed, 0 failed, 256 explicit opt-in skips**, full web **981/981**,
enabled CP-005 payroll acceptance **204 tests: 201 passed, 0 failed, 3 separately
gated CP004 skips**. API/web typecheck, lint and builds pass. Measured real HTTP
calculation for 50 staff/50 cash receipts **1,154.2 ms**; not an MTD benchmark.

M5 is not accepted: remaining manager/carry mounted browser flows and broader
plan-volume performance/final money review are explicitly tracked in
`docs/commission_payroll/APPLICATION_CLOSE_ACCEPTANCE.md`. CP-003A/006/007 and
production release remain separately gated. Only the verified disposable DB was
written. Initial mock/immutable fixture cleanup failures and CPU-loaded web timeouts
were resolved and complete reruns passed; no assertions/constraints disabled.

## November 2, 2026 — CP-005 M3 DONE

M1–M3 DONE; CP-005 remains IN PROGRESS, M4/M5 TODO. Real opening/settlement,
published plan/assignment, checkout and default-loader calculate/approve acceptance
passes **17/17**. Exact cross-period base/unit/fallback debt, stable keys/new
versions, explicit mapping/write-off, fallback/plan switches, departed staff and
four PostgreSQL-blocking approval orderings reconcile. Fixed persisted plan
version projection and prospective approved-plan-month configuration guards.

Broader payroll/prepaid/sale-service regression **274 tests, 271 passed, 0 failed,
0 cancelled, 3 separately gated CP004 lifecycle skips**; payroll units **430/430**,
shared **305/305**, API typecheck/build/full lint and affected formatting pass.
Details and earlier unsuccessful attempts:
`docs/commission_payroll/{PROGRESS,CLOSE_ACCEPTANCE}.md`, `/tmp/m3-*`.
Fresh identity-verified disposable PostgreSQL `/tmp/cp005-m3-apyc3kkj` only;
69 migrations replayed there. No application DB/schema/dependency changes,
mounting, activation, provider payments, deployment, commit or push.

## November 2, 2026 — CP-005 M2 DONE

Completed next-open-period correction handling across supported ordinary/prepaid
whole-sale voids and all refund families, preserving actual settlement/restoration
dates and frozen approved history. Independent lifecycle posting evidence and a
separate commission projection prevent deferred commission from moving cash.

Final M2 acceptance **55/55**, payroll unit checks **430/430**, related lifecycle
regression **128/128**; broader acceptance/sale **121 tests: 115 passed, 0 failed,
6 separately gated skips**. API types, shared/API build, affected lint/format and
whitespace checks pass. Details, initial failed attempts and execution boundaries:
`docs/commission_payroll/{PROGRESS,CLOSE_ACCEPTANCE}.md`, `/tmp/m2-lifecycle-*`.
M1/M2 DONE; CP-005 remains IN PROGRESS, M3–M5 TODO. Only the identity-verified
disposable DB was used; no application DB/schema/dependency, mounting, activation,
deployment, commit or push changes. Older M2-open entries below are historical.

## November 2, 2026 — M2 session-only void posting checkpoint

CP-005 M2 remains IN PROGRESS. Session-only void reversals now honor approved
periods with frozen historical posting evidence, independent VOID inventory and
preserved restoration occurrence. Deterministic approval-first/void-first DB races,
retry uniqueness, stale approval, corrupted posting refusal and next-month approval
are covered. Related regression **131/131**, final expanded M2 checks **3/3**,
focused expiry/race rerun **7/7**, unit checks **36/36** pass; API types,
shared/API build, affected lint and diff checks pass. Evidence `/tmp/m2-*`;
details and remaining whole-sale/refund families in
`docs/commission_payroll/PROGRESS.md`. Only the identity-checked disposable DB was
used. No schema/migration, application DB, mounting, activation or deployment.

## November 2, 2026 — M1-19 DONE; M1 complete

Final gate review accepts **19 DONE, 0 IN PROGRESS, 0 TODO; CP-005 M1 DONE** for
its documented supported scope and policy refusals. CP-005 remains IN PROGRESS;
next is M2 next-open-period corrections beyond session attribution, then M3–M5.

Reproduced and fixed the older sale-service fixture purge failure using fresh
per-suite tenant identities and retained immutable receipts; added deletion-refusal
regression without changing production constraints. Focused **58/58** and final
integrated payroll/prepaid/HTTP plus sale-service **699 tests: 690 passed, 0 failed,
9 separately gated skips**, exit 0. Shared **305/305**, full web **977/977** with one
worker, workspace lint/typechecks, full build, formatting and diff checks pass.

Delivered commission demo/reference artifacts are explicit formatting exclusions,
unchanged. Initial failed parallel web/reference-format runs and exact suite
boundaries are recorded in commission-payroll CLOSE_ACCEPTANCE/PROGRESS;
evidence `/tmp/m119-*`. No enabled CP-005 acceptance skipped. Only the verified
disposable DB was written; no production code/schema/dependency changes, mounting,
activation, deployment, commit or push. Earlier M1-open notes below are historical.

## November 2, 2026 — M1-18 DONE

Added 31 deterministic real-DB prepaid race cases covering membership/consent,
family spending, restoration/purchase void, invalid-payout rollback, duplicate
voids and calculate/approve orderings. Every ordering proves PostgreSQL blocking;
checks include exact money/journals, stale refusal, persisted approval and frozen
history. Existing production locks/writers are unchanged.

Focused **31/31 twice**; consolidated payroll/prepaid/HTTP **641 tests, 632 passed,
0 failed, 9 separately gated skips**. API typecheck, full API lint, affected
formatting, shared/API build and diff checks pass. Evidence: commission-payroll
PROGRESS/CLOSE_ACCEPTANCE and `/tmp/m118-*`. Only the verified disposable database
was written. No production code/schema/dependency change, activation or deployment.

**18 DONE, 0 IN PROGRESS, 1 TODO (M1-19); overall M1 OPEN.** Next: final M1-19
review, including the older immutable-economics sale-service cleanup failure,
which was not included in the passing regression and remains unresolved.

## November 2, 2026 — M1-17 DONE

Expanded shared-original owner/member credit-spend acceptance to 24 real-writer
same/cross-month × active/expired-before/expired-after restoration ×
NO_MOVEMENT/full RETURNED purchase-void cases. Exact credit/cash/bases, 272
independent corrupt-read refusals, stale drafts, persisted approval and immutable
original/current history are verified. No production code or schema changes.

Focused **24/24**; consolidated payroll/prepaid/HTTP **610 tests, 601 passed,
0 failed, 9 separately gated skips**; independent HTTP **62/62**. API typecheck,
affected lint/formatting and shared/API build pass. Evidence and corrected initial
fixture/environment runs: `docs/commission_payroll/PROGRESS.md` and
`/tmp/m117-expanded-*`. All DB writes targeted the verified disposable cluster.
The older sale-service immutable-economics cleanup failure was not rerun/resolved.

**17 DONE, 0 IN PROGRESS, 2 TODO (M1-18/19); overall M1 OPEN.** Next: M1-18 races,
then M1-19 final gate review. No deployment, activation, commit or push.

## November 2, 2026 — M1-16 DONE

- Completed session-plus-cash and credit-funded PACKAGE/VALUE_PACKAGE purchase
  void reconciliation and same/cross-month real-writer monthly acceptance.
- User-approved purchase-only credit conversion excludes VP_SPEND commission;
  exact external cash and original-holding restoration remain independently required.
- Verification: 19/19 focused; payroll/prepaid/HTTP regression **577 tests,
  571 passed, 0 failed, 6 gated skips**. API typecheck, affected lint/format,
  shared/API build and diff checks pass. Logs: `/tmp/m116-policy-*`.
- Separate sale-service regression reproduced the older immutable sale-economics
  cleanup-hook failure; unresolved, with no protections disabled.
- **16 DONE, 1 IN PROGRESS (M1-17), 2 TODO (18/19); overall M1 remains OPEN.**
  This supersedes the earlier same-day blocker/status checkpoints below.

## November 2, 2026 — M1-16 session/cash acceptance and purchase policy blocker

- Verification: 11/11 focused; 569 payroll/prepaid/HTTP tests, 563 passed,
  0 failed, 6 gated skips. API types, affected lint/format and shared/API build pass.

- Accepted two same/cross-month session-plus-cash RETURNED void cases, without
  value credit: exact external money, restored sessions, corruption refusal,
  rollback, stale drafts and immutable monthly approvals.
- Credit-funded purchase-only checkout has no service performers for VP_SPEND.
  Real-writer regression proves missing attribution and safe restoration/refusal,
  not acceptance. An explicit earnings/attribution policy is needed to finish.
- M1-16 remains IN PROGRESS; M1-17 and overall M1 remain open. See the newest
  commission/payroll progress and acceptance checkpoint for details.

## November 2, 2026 — M1-16 FOC purchase companion follow-up

- M1-16 is IN PROGRESS, not TODO. Added four same/cross-month FOC-service
  purchase companion cases, with/without a zero external tender. FOC list-price
  commission evidence is reconciled independently from zero companion cash.
- Exact external returns, rollback, missing evidence refusals, stale drafts and
  immutable monthly approvals are covered. Credit-funded purchases and
  session-plus-cash without value credit remain unaccepted. M1-16/17 and M1 stay
  open. Details: `docs/commission_payroll/PROGRESS.md` and `CLOSE_ACCEPTANCE.md`.
- Verification: focused 47/47; payroll/prepaid/HTTP regression 566 tests,
  560 passed, 0 failed, 6 gated skips. API types, affected lint/formatting and
  shared/API build pass. Logs: `/tmp/m116-foc-regression-final.{log,exit}`.

## CP-005-M1-16 follow-up — zero-product and zero-tender companions

Six additional real-writer same/cross-month returned purchase-void cases pass:
zero-priced product, zero external tender, and both together. Zero products keep
SALE_LINE/reversal evidence without creating cash; zero tenders retain their rows
without requiring collection receipts. FOC services remain a separate open shape.
Current payroll/prepaid/HTTP regression: **528 tests, 522 passed, 0 failed, 6 gated
skips**. Focused returned-void/helpers **43/43**, API typecheck, affected ESLint and
shared/API builds pass. M1-16/M1-17 remain IN PROGRESS; M1-18/19 and overall M1 remain
open. Credit-funded purchases and session-plus-cash without value credit remain
unaccepted. See the commission/payroll progress and acceptance matrix for scope.

## CP-005-M1-16 bounded returned-void implementation — November 2, 2026

User approved external-money-only returns with original-holding prepaid restoration,
no prepaid cash-out and unchanged ordinary money-sale refund rules. M1-16 is now
IN PROGRESS alongside M1-17: **15 DONE, 2 IN PROGRESS (16/17), 2 TODO (18/19)**.
Added mixed purchase/service/product and credit/session-credit returned-void loading,
separate cash-seller attribution, session restoration integration and till external-
money totals. Twelve new real-writer same/cross-month cases pass with 48 corrupt-read
refusals, exact cash, stale rejection, persisted approval and immutable prior history.
Final payroll/prepaid/HTTP regression: **522 tests, 516 passed, 0 failed, 6 gated skips**.
Till tests **59/59**; API/web typechecks, affected ESLint and shared/API/web builds pass.
An additional combined run including the older sale-service DB suite fails its
cleanup hook against the immutable sale-economics trigger; this is not a passing
combined run, and no trigger/test protection was disabled.
Credit-funded purchases, session-plus-cash without value credit and zero/FOC
companions remain unaccepted; M1-16/M1-17/M1 stay open. M1-18 was not started.
Only the verified disposable database was used; no schema/dependency change,
application-DB operation, provider transfer, activation, commit, push or deployment.
Evidence and remaining gates: commission/payroll progress and acceptance matrix.

## CP-005-M1-17 integrated acceptance — November 2, 2026

Continued M1-17 without starting M1-16. Four new disposable-DB cases verify credit
shared during the original owner/member spend, restoration, and money-funded
purchase NO_MOVEMENT/full RETURNED through exact monthly calculation, 32 corrupt-read
refusals, stale rejection, persisted approval and frozen history after membership
departure. Added an explicit lifecycle matrix separating accepted paths from helper
checks and required unaccepted M1-16 combinations. Added four real-writer ordinary
service/product plus FOC and zero-tender same/cross-month refund cases, 20
corruption refusals, stale rejection and immutable approved history. M1-17 remains
IN PROGRESS; status is 15 DONE, 17 IN PROGRESS, 16/18/19 TODO. M1 remains open.
Final consolidated payroll/prepaid/HTTP regression: 504 tests, 498 passed, zero
failures, six separately gated
CP-003/CP-004/browser skips; supplementary prepaid settlement/monthly/HTTP 17/17;
API typecheck, affected ESLint and shared/API build pass. Only verified disposable
PostgreSQL at `127.0.0.1:55485/payroll_close_test` was used. No production-code,
schema, application-DB, activation, mounting, commit, push or deployment changes.
Details: `docs/commission_payroll/PROGRESS.md` and `CLOSE_ACCEPTANCE.md`.

## CP-005 prepaid refund HTTP workflow — October 30, 2026

CP-005 IN PROGRESS, M1 open. The manager-confirmed prepaid refund flow now has
HTTP-level acceptance instead of service-only coverage: the existing
`POST /sales/package-holdings/:id/refund` and
`POST /sales/value-package-holdings/:id/refund` routes (auth, sales/packages
modules, writable tenant, manager/owner roles) were driven end to end through the
real router, zod schema and refund service with replaced persistence seams. One
confirmed cancellation writes exactly one append-only settlement row (salon scope,
source key, holding/sale/line, actor/role, reference, zero net/tax/gross, 54500
cents cancelled gross, frozen request plus operational hash) next to one refund
event. Identical retry replays the stored event with no second settlement, journal
row or holding update; a changed reference, an altered journal reference and
altered frozen money evidence all refuse 409; an outlet-scoped session refuses 403
salon-wide; STAFF/CASHIER refuse 403 before any transaction; a disabled session
401s and a foreign outlet 404s before persistence; malformed confirmations are
refused 422. Confirmation stays optional on purpose: a refund without it remains a
legacy capture and cannot be confirmed retroactively (409), so the close loader
keeps refusing it as `PREPAID_SETTLEMENT_MISSING`. Making confirmation mandatory
for every prepaid payout is an owner business decision and was not changed
silently. Refund suite 116/116 with zero skips; API typecheck, ESLint and Prettier
clean; no web checks, schema/migration change, application DB work, activation,
deployment or push. Logs
`/tmp/cp005v-{http-settlement,refund-suite,tsc2,eslint2,prettier3}.log`. Remaining
M1: mixed session/credit usage, spend-sale instalments, full-credit paid lines
without allocation evidence and the remaining void gates.

## CP-005 prepaid refund settlement inventory — October 30, 2026

CP-005 IN PROGRESS, M1 open, no M2 work. Prepaid package/value-package refunds are
now loaded from their own append-only settlement row, validated against the
pre-cancellation holding replay, original sale-line allocations/outstanding debt and
frozen refund request, instead of trusting the capture event. The monthly loader
inventories settlements before tenant/inventory work: duplicate holding or operation
key, a stored row disagreeing with the replayed holding, a moved historical original
capture, a refund capture outside its settlement month and a month capture without a
settlement all fail closed. Settled refunds are external cash outflows with frozen
original deposit/allocation/award lineage and no repeated sale or commission source.
New opt-in DB acceptance covers buy→refund→month load, stale approval rejection,
recalculation with two payouts and remaining 500.0000 salon cash, approval, and a
legacy capture refusing `PREPAID_SETTLEMENT_MISSING`. Selected close API 332/332,
zero skips, including five isolated DB suites; the three directly touched suites
44/44; API typecheck, ESLint and Prettier clean. Refund captures predating
settlements now fail closed; prepaid refund HTTP workflows, close API/UI mounting,
corrections, plan-switch/performance and browser acceptance remain open. No web
checks, schema/migration change or activation; slice committed locally as
`6faab1e` and not pushed. Post-commit local re-verification (disposable cluster
stopped, so opt-in DB suites skipped): selected close tests 321 passed / 5 skipped
/ 0 failed, API typecheck, ESLint, Prettier and git whitespace clean. Logs
`/tmp/cp005v-{close-suite,tsc,eslint,prettier}.log`. Details in
`docs/commission_payroll/CLOSE_ACCEPTANCE.md`.

## CP-005 current checkpoint — October 30, 2026

CP-005 IN PROGRESS, M1 open. Owner approved prospective manager-confirmed prepaid
payout/cancellation evidence and a migration on new disposable DB only. Implemented
append-only tenant-scoped settlement journal, both prepaid refund writers and strict
retry/authorization verification. Real SQL acceptance covers session/credit payouts,
partial debt cancellation, concurrent retries, rollback and immutability. Combined
API/SQL 371/371, shared 302/302, API types/build and targeted workspace lint pass.
Monthly refund loading still fail-closed pending full settlement/holding-history
reconciliation; mixed usage/instalments and M2–M5 remain. No provider payment,
application DB migration/repair, activation, commit/push/deployment. Resume details,
safe disposable connection/guard and logs in docs/commission_payroll/PROGRESS.md.

## CP-005 isolated continuation — October 30, 2026

Owner approved only new disposable database work following the incident review.
New identity-verified PostgreSQL cluster on loopback 55485 has all migrations;
runner blocks application database endpoints and disables dotenv loading. Added
durable cross-month refund/16 corruption/stale-approval regressions, historical
expiry/ten corruption cases, and real full-credit and confirmed credit restoration
through persisted monthly approval. Close regression 311/311, no skips; API types
and targeted lint/format pass. Broader sale tests passed 57 cases but suite cleanup
failed on immutable payroll economics; not a clean pass. CP-005 remains BLOCKED:
required prepaid refunds need an approved independent settled-payout operational
workflow; mixed usage/instalments remain unfinished. M2–M5 untouched. No application
DB repair, activation, commit, push or deployment. See commission payroll handoff.

## STOP — CP-005 database test targeting incident — October 30, 2026

Owner-approved read-only review confirms the target was application database
`glampro_suite` at localhost:5432. Neither review transaction could write; both
verified READ ONLY and rolled back. None of 41 statically identified candidate
fixture tenant IDs remain; total tenants: three. Shared module upserts are retained
by test design; no pre-run baseline exists to establish actual catalogue changes
or rule out other effects. No cleanup, migration or recovery performed. CP-005
remains BLOCKED pending safe continuation approval. Read-only review logs are in
`/tmp/cp005-incident-{readonly,fixtures-readonly}.log`.

CP-005 is BLOCKED pending owner review. The broad API suite reloaded configured
DATABASE_URL via dotenv despite launching with that variable unset. Real database
fixture writes/cleanup ran; target identity and full effects are unverified. No
runner remains active. No migration/reset/seed/recovery was run; do not run them
to address the missing `sale_lines.payrollEconomics` failure. Actual suite result:
1013 passed, 59 failed, seven cancelled, 45 skipped (1124 tests), exit 1. Log:
`/tmp/cp005-completion-api.log`. Further execution paused for an explicit safe
continuation decision; details in commission payroll PROGRESS.md.

## Commission payroll cross-month refund verification — October 30, 2026

CP-005-M1 stays IN PROGRESS; M2 untouched. In-memory SERVICE/PRODUCT plus FOC
refunds with a zero tender pass full September original-month and October
reversal-month loading, 16 monthly capture corruption refusals, stale approval
and frozen pure-state checks. Existing API 76/76 and API typecheck pass. No
production-code fix needed. Real-writer/persisted approval/browser acceptance and
repository tests remain deferred. No DB/schema/activation/deployment/commit/push.
See the commission payroll handoff for evidence and remaining M1 lifecycle gaps.

## Commission payroll zero-tender refund loading — October 30, 2026

CP-005-M1 stays IN PROGRESS; M2 untouched. Full-upfront ordinary refunds now
validate zero money tenders without requiring fabricated collection lots; strictly
positive tenders still reconcile exactly. Sale/line scope and collection chronology
also verify. Existing API 68/68, API types/build, shared build and targeted lint/
formatting pass. Service/product plus FOC monthly, cross-month helper, corruption
and pure-state stale-approval smoke passes. New repository tests and real-writer
DB/browser acceptance remain deferred; prepaid/instalment writer gates unchanged.
No DB/schema/activation/deployment/commit/push. Next: remaining supported M1 gaps.

## Commission payroll mixed-credit monthly verification — October 30, 2026

CP-005-M1 stays IN PROGRESS; M2 untouched. Four in-memory service/product and
same/prior-month purchase variants pass full September monthly loading and pure
approval-state checks. External-only cash, zero credit-line bases, FOC and spend
activity verify. All 88 corruption checks and eight stale approvals refuse.
Existing API 111/111 and 45 helper checks rerun successfully; API types pass.
No production-code changes needed. Real-writer DB/browser, persisted approval
acceptance and new repository tests stay deferred; no reversal-month claim.
No DB/schema/activation/deployment/commit/push. Next: remaining supported M1 gaps.

## Commission payroll mixed credit line funding — October 30, 2026

CP-005-M1 stays IN PROGRESS; M2 untouched. Prospective mixed cash/credit checkout
freezes complete funding inventory so paid ordinary lines with no external
allocation can reconcile zero external bases. No legacy inference or credit cash.
Existing API 111/111, API types and 45 temporary helper/source-base checks pass.
New-path monthly/approval integration is now verified in memory above; repository tests and
real-writer DB/browser acceptance stay deferred. All prior lifecycle blocks remain.
No DB/schema/activation/deployment/commit/push. See the commission payroll handoff.

## Commission payroll mixed paid/FOC refund history — October 30, 2026

CP-005-M1 stays IN PROGRESS; M2 untouched. Full upfront money-funded ordinary
refunds now reconcile FOC services alongside paid service/products, verifying
frozen list-price bases/activity and exact reversals with zero FOC cash. Existing
API 95/95, types/lint/API/shared builds and in-memory same-month monthly/cross-month
helper, corruption and stale-approval checks pass. Prepaid/later-funded refunds and
prior purchase lifecycle blocks remain; new repository tests and real-writer
DB/browser acceptance stay deferred. No DB/schema/activation/deployment changes.
See docs/commission_payroll/PROGRESS.md for remaining M1 work.

## Commission payroll withdrawn credit sharing history — October 30, 2026

CP-005-M1 stays IN PROGRESS; M2 untouched. Unused/untransferred credit purchase
NO_MOVEMENT voids reconcile prior sharing through complete owner membership and
consent replay, requiring private removal. Frozen membership evidence invalidates
stale approval. Existing API 77/77, types/lint/API/shared builds, six in-memory
membership/funding combinations and earlier purchase-void smoke reruns pass.
Expired credit, uses/transfers and later funding remain blocked; new repository
tests and real-writer DB/browser acceptance remain deferred. No DB/schema/activation/
deployment changes. See docs/commission_payroll/PROGRESS.md for remaining M1 work.

## Commission payroll credit purchase expiry-edit history — October 30, 2026

CP-005-M1 stays IN PROGRESS; M2 untouched. Unused/untransferred credit purchase
NO_MOVEMENT voids replay audited expiry edits before exact removal; final expiry
must remain valid at void time. Expired credit, uses/transfers and later funding
stay blocked. Existing API 77/77, types/lint/API/shared builds, six in-memory
history/funding combinations and prior purchase-void smoke reruns pass. New tests
and real-writer DB/browser acceptance remain deferred; no DB/schema/activation/
deployment changes. See docs/commission_payroll/PROGRESS.md for remaining M1 work.

## Commission payroll expired session purchase voids — October 30, 2026

CP-005-M1 stays IN PROGRESS; M2 untouched. Unused/untransferred expired session
purchase NO_MOVEMENT voids now reconcile the exact expiry bucket-transfer pair,
original grant/final removal and state before monthly loading. Funding/policy and
payroll reversals remain independently verified; credit expiry stays gated.
Selected API 87/87, types/lint/API/shared builds and actual valuation-writer
in-memory same/cross-month, full/partial funding, corrupt evidence and stale approval
checks pass. No real-writer DB/browser acceptance or new repository tests; no
DB/schema/activation/deployment changes. See docs/commission_payroll/PROGRESS.md.

## Commission payroll partial upfront purchase voids — October 30, 2026

CP-005-M1 stays IN PROGRESS; M2 untouched. Partial upfront external funding now
reconciles checkout paid/total/status, surviving tenders/collections, captured
package deposit policies and exact reversals for the existing NO_MOVEMENT path.
Later outstanding-payment sources remain gated; writer restrictions are unchanged.
Selected API 87/87, types/lint/API/shared builds and in-memory full/30%-upfront
session/credit monthly plus cross-month helper smoke pass. New repository coverage
and real-writer DB/browser acceptance remain deferred. No DB/schema/activation/
deployment changes. See docs/commission_payroll/PROGRESS.md for remaining M1 work.

## Commission payroll mixed purchase voids — October 30, 2026

CP-005-M1 stays IN PROGRESS; M2 untouched. Mixed service/product/FOC and package
purchase NO_MOVEMENT voids now reconcile ordinary/purchase originals, complete
cash collections and exact reversals, reusing historical ordinary economics checks.
Existing API 103/103, API types/lint and API/shared builds pass. In-memory same/cross-
month monthly, fixed/excluded policies, differing cash seller/performer, corruption
and stale approval smoke pass. No new repository tests or real-writer acceptance.
Remaining partial funding and prepaid lifecycle gaps are recorded in
`docs/commission_payroll/PROGRESS.md`; no DB/schema/activation/deployment changes.

## Commission payroll purchase-void reconciliation — October 30, 2026

CP-005-M1 remains IN PROGRESS; M2 not started. Narrow purchase-only full-upfront
NO_MOVEMENT voids now reconcile preserved snapshots with independent credit balance
or session valuation journals, collections and exact reversals before monthly loading.
Selected existing API 103/103, types/lint/API/shared builds and in-memory same-month
monthly/cross-month helper smoke pass. Mixed/used/transferred/expired and outstanding-
funded purchase voids, remaining lifecycle gaps and real-writer DB/browser acceptance
remain open. No new repository tests or DB/schema/activation/deployment changes.
Detailed current state: `docs/commission_payroll/PROGRESS.md`.

## Commission payroll purchase-void evidence — October 30, 2026

CP-005-M1 remains IN PROGRESS. Confirmed prospective purchase voids preserve holdings
before deletion and bind their snapshot hash to cash confirmation. Snapshot verifier
and package/value round-trip smoke pass; existing API regressions 173/173, types/lint
and API/shared builds pass. Monthly purchase-void loading remains blocked pending
independent grant/removal or valuation evidence plus collection/reversal integration.
No new tests, DB access, migration or activation. See detailed current state in
`docs/commission_payroll/PROGRESS.md` for exact unfinished M1 integration.

## Commission payroll ordinary voids — October 30, 2026

CP-005-M1 remains IN PROGRESS. Ordinary service/product-only NO_MOVEMENT voids now
load through monthly inventory/cash using explicit manager audit confirmation and
exact original/reversal evidence. Existing cash stays unchanged. Selected API
regressions 173/173, types/lint and same/cross-month smoke pass. No new tests or DB
acceptance; purchase/prepaid/mixed/returned-money voids remain gated. Next investigate
purchase-void deleted-holding evidence. See `docs/commission_payroll/PROGRESS.md`.

## Commission payroll refund attribution — October 30, 2026

CP-005-M1 remains IN PROGRESS. Ordinary refunds now separate original commission
performers from verified cash sellers and retain per-collection split residuals.
Selected regressions 173/173, API types/lint and in-memory attribution smoke pass.
No new tests; transactional acceptance is deferred. Next resume unsupported voids,
prepaid payout evidence and remaining mixed usage/instalments. See detailed current
state in `docs/commission_payroll/PROGRESS.md`; no M2 advancement or activation.

## Commission payroll refund continuation — October 30, 2026

CP-005-M1 remains IN PROGRESS. Full upfront money-funded ordinary refunds now load
with independent payouts, complete collection/line evidence and exact reversals.
Selected API regressions 173/173, API types/lint and in-memory same/cross-month
cash/base smoke pass. New tests and DB/browser acceptance deferred. Differing service
seller/performer attribution, FOC/prepaid/instalment refunds and unsupported voids
remain gated. See `docs/commission_payroll/PROGRESS.md` for remaining M1 work.

## Commission payroll expiry continuation — October 30, 2026

CP-005-M1 remains IN PROGRESS. Explicit expiry journal replay feeds historical spend
and restoration validation; other rows must preserve effective expiry and ambiguous
chronology refuses. No expiry writer/UI, schema or activation change. Selected API
regressions 150/150, API typecheck and targeted lint pass; new coverage and DB/browser
acceptance are deferred. See `docs/commission_payroll/PROGRESS.md` for unfinished work.

## Current State

- **CP-005 IN PROGRESS — delivery cadence updated October 30, 2026.** Latest
  completed task CP-004. None of the five remaining delivery milestones is done.
  Resume **CP-005-M1 authoritative lifecycle loading** as a coordinated pass, not
  another per-helper handoff. Supported credit monthly loading, private transfers
  and historical sharing/membership/consent are implemented/tested. Prospective
  confirmed credit voids and full-credit funding now have sale/month implementation,
  not transactional acceptance. Refunds/other voids, expiry, mixed usage, instalments
  and deferred verification keep M1 open. Then source corrections, carry/plan
  switches, application integration and final acceptance remain.
- Read the short Current State in
  `/home/tuangpi/Documents/Aridient/Glampros/glampro_suite/docs/commission_payroll/PROGRESS.md`
  and milestone gates in
  `/home/tuangpi/Documents/Aridient/Glampros/glampro_suite/docs/commission_payroll/TASKS.md`.
  Continue within M1 until verified completion or a genuine blocker/user instruction/
  session limit. No automatic start of the next milestone. Latest checks: selected
  API 150/150, shared sales 45/45, web Sale 56/56; API/web builds/types and targeted
  lint pass; new seams pass an in-memory smoke only. No activation,
  deployment, commit or push.

## Latest continuation — prospective cash and full-credit integration

- **CP-005-M1 remains IN PROGRESS.** Explicit optional manager NO_MOVEMENT void
  confirmation flows from the unchecked UI checkbox to transactional audit evidence.
  Credit sale/month loading now reconciles operational hashes and exact restorations/
  reversals; original collected cash stays in its collection month. New full-credit
  checkout freezes funding evidence so zero ordinary cash bases are independently
  verifiable. Legacy missing evidence/other unsupported lifecycle still refuse.
- Existing API 150/150, shared sale contracts 45/45, web Sale 56/56; API/web types,
  API build and targeted lint pass. New tests and DB/browser acceptance deferred;
  no live readiness claim. Resume remaining M1 refunds/voids, expiry, mixed usage,
  instalments and acceptance, as detailed in commission-payroll Current State.
  No DB/schema/activation/deployment/commit/push.

## Previous continuation — restoration holding-loader integration

- **CP-005-M1 remains IN PROGRESS.** User approved implementation-first development,
  deferring new test writing. Existing restoration verifier now runs in full holding
  loading; independent ledger replay supports restored credit and later re-spends.
  Sale/month VOID gates remain closed: required independent cash-disposition evidence
  is absent from current operational writers. Resolve that persistence contract next.
- API typecheck, targeted lint, formatting/whitespace and 62 existing non-DB tests
  pass. DB/browser/new integration coverage deferred; old blanket-refusal acceptance
  assertions need revision. No DB/schema, activation, deployment, commit or push.
  See commission-payroll Current State for exact remainder; M1 is not complete.

## Previous continuation — restoration evidence verifier

- **CP-005-M1 remains IN PROGRESS.** Added a non-activating supplied-record seam
  for credit restoration: operational void, reverted redemption, database RESTORE
  balance and exact historical payroll reversal must agree. Not yet wired into
  authoritative loaders; existing unsupported-path gates remain unchanged.
- Focused regression 30/30, zero skips; API typecheck/lint/build and changed-code
  formatting pass. No database/web acceptance. Resume chronological restoration
  loading, sale/month integration and real-writer acceptance; exact remainder in
  the commission-payroll PROGRESS.md. No DB/schema/deployment/commit/push.

## Previous implementation — historical sharing lifecycle

- **CP-005-M1 IN PROGRESS, October 30, 2026.** Independent consent/membership
  replay now supports historical shared-credit monthly loading, explicit revocation,
  leave/rejoin and original purchase ratios. Consent-only changes invalidate drafts;
  later membership/consent changes preserve approvals. Six corruption checks and
  rejected-spend rollback verified. Selected close API 316/316, shared 302/302;
  API build/typecheck/lint pass. No web checks. Logs `/tmp/cp005-sharing-*`.
- Session limit interrupted M1, not a milestone completion. Resume coordinated
  restoration/refund/void loading, then expiry, mixed session/credit usage, spend-sale
  instalments and full-credit paid-line allocation. Exact handoff is in the CP
  PROGRESS.md above. No application DB/schema, activation, deployment, commit or push.

## Previous checkpoint — private credit ownership transfers

- **CP-005 private credit ownership transfers, October 30, 2026:** IN PROGRESS;
  latest completed CP-004, CP-003A/CP-006 untouched. Independent grant/spend/transfer
  replay resolves spend-time owners with exact transfer audits, preserved original
  purchase ratios/sellers and no fresh cash. Real transfer/recipient-spend/round-trip,
  stale-approval and eight corruption/refusal checks preserve drafts/frozen history.
  Selected close API 298/298 (five isolated DB suites), shared 302/302; API types/
  lint/build/format/whitespace pass. No web checks. Disposable PostgreSQL stopped,
  fixtures retained. Next shared-credit membership/consent reconciliation, then
  refund/void loading. Unsupported paths still refuse; UI/router stay unmounted.
  No application DB/schema, activation, deployment, commit or push. Logs
  `/tmp/cp005-transfer-*`; authoritative handoff in
  `/home/tuangpi/Documents/Aridient/Glampros/glampro_suite/docs/commission_payroll/PROGRESS.md`.

## Previous checkpoint — private credit monthly integration

- **CP-005 private credit monthly integration, October 30, 2026:** IN PROGRESS;
  latest completed CP-004; CP-003A/CP-006 untouched. Monthly private-credit receipts
  now reconcile independent sale/payment/redemption/capture/collection inventories,
  purchase-ratio spend bases, external-net ordinary bases and frozen FOC economics.
  Verified credit tenders add no fresh cash. Sale/holding evidence freezes with inputs;
  same-catalogue multi-holding spends reconcile. Real monthly acceptance includes 15
  inventory refusals, reload/stale approval, frozen history and empty next month.
  Selected close API 294/294 (five isolated DB suites), shared 302/302; API types/
  lint/build pass. No web checks. Disposable PostgreSQL stopped, fixtures retained.
  Next private-credit transfer/sharing lifecycle, then refund/void loading; unsupported
  paths still refuse. Router/screen unmounted; no application DB/schema, activation,
  deployment, commit or push. Logs `/tmp/cp005-month-*`; authoritative handoff in
  `/home/tuangpi/Documents/Aridient/Glampros/glampro_suite/docs/commission_payroll/PROGRESS.md`.

## Previous checkpoint — monthly prepaid lock prerequisite

- **CP-005 monthly prepaid lock prerequisite, October 30, 2026:** IN PROGRESS;
  latest completed CP-004; CP-003A/CP-006 untouched. Outer calculate/approve and
  direct authoritative loader take prepaid before tenant. Regression tests and
  PostgreSQL contention barriers verify ordering/re-entry without close/audit writes.
  Selected close API 293/293, zero failures/skips (four isolated DB suites); API
  types/lint/build pass. No web checks. Monthly prepaid gate stays closed: next
  integrate private credit sale allocation into month inventories/frozen evidence
  with no-fresh-cash/stale-approval checks. Remaining lifecycle/performance/mounting
  acceptance unchanged. Disposable PostgreSQL stopped, fixtures retained. No
  application DB/schema, activation, deployment, commit or push. Logs
  `/tmp/cp005-lock-*`; see authoritative commission-payroll handoff.

## Previous checkpoint — private credit sale allocation

- **CP-005 private credit sale allocation, October 30, 2026:** IN PROGRESS;
  latest completed CP-004; CP-003A/CP-006 untouched. Internal sale-wide reconciliation
  matches complete private holding histories, external payments/GST/cash sellers and
  frozen ordinary/FOC economics. Mixed and two-holding real checkout, reload and
  corruption/refusal checks pass; credit tenders never count as fresh cash. Selected
  API 377 passed, one opt-in CP-004 SQL suite skipped; shared 302/302; API types/lint/
  build/format/whitespace pass. No web changes/checks. Disposable PostgreSQL stopped,
  fixtures retained. Monthly gate stays closed: next integrate month/frozen evidence
  and fix outer close lock order to prepaid-before-tenant. Lifecycle, plan-switch/
  performance and mounted-app/browser acceptance remain. No application DB/schema
  changes, activation, deployment, commit or push. Logs `/tmp/cp005-value-sale-*`.

## Previous checkpoint — private credit holding history

- **CP-005 private credit holding history, October 30, 2026:** IN PROGRESS;
  latest completed CP-004. Internal loader independently reconciles private credit
  purchases/collections, balance ledger, spend operations/tenders, ratio/splits and
  historical STORED_CREDIT_SPEND rates. Real checkout residual/reload/refusal checks
  pass. Monthly prepaid allocation, transfers/sharing/refunds/voids remain gated;
  close screen/router still unmounted. Selected API 377 passed, one opt-in CP-004
  SQL lifecycle suite skipped; shared 302/302; API types/lint/build pass. Disposable
  PostgreSQL stopped, fixtures retained. No web changes/checks this continuation,
  application DB/schema changes, activation, deployment, commit or push.
  Logs `/tmp/cp005-value-*`; next sale-level ordinary/prepaid/no-cash reconciliation.

## Previous checkpoint — owner carry authorization and repair

- **CP-005 owner carry authorization/repair, October 30, 2026:** IN PROGRESS;
  latest completed CP-004. Owner controls now support reviewed opening inventory,
  exact component disposition/fallback debt and stale authorization repair. Read API
  exposes staff inventory/revisions/balance hashes while calculation remains
  fail-closed. Selected API 306/306 plus expanded real HTTP/DB carry acceptance 1/1,
  selected web 40/40, shared 302/302; API/web types/lint/build pass. Close screen and
  router remain unmounted pending prepaid-credit/refund/void loading and full
  application/browser/reconciliation/performance acceptance. CP-003A/CP-006 untouched;
  no application DB/schema, activation, deployment, commit or push. Logs
  `/tmp/cp005-carry-*`; see authoritative commission-payroll handoff.

## Previous checkpoint — restored sessions, partial FOC and close groundwork

- **CP-005 restored sessions/partial FOC/close groundwork, October 30, 2026:**
  IN PROGRESS; latest completed CP-004, CP-003A/CP-006 untouched. Audited restoration,
  original ordinal reuse, exact latest-source monthly reversal with zero cash and
  uncovered-unit FOC reconciliation pass isolated writer/reload/refusal/frozen-history
  checks. Added close router and management screen, **both deliberately unmounted**.
  Prepaid-credit spending/refund/void loaders, opening/settlement UI, mounting and full
  HTTP/browser/reconciliation/race/performance acceptance remain. Selected API 306/306
  (three isolated DB suites, seven mocked-persistence HTTP tests, zero skips), shared
  302/302, selected web 40/40; API/web types/lint/build pass. No application DB/schema,
  production activation/deployment/commit/push. Logs `/tmp/cp005-complete-*`.
  Formatting/whitespace pass; disposable PostgreSQL stopped cleanly, fixtures retained.
  See `/home/tuangpi/Documents/Aridient/Glampros/glampro_suite/docs/commission_payroll/PROGRESS.md`.

## Previous checkpoint — monthly correction reconciliation

- **CP-005 monthly correction reconciliation, October 30, 2026:** IN PROGRESS;
  latest completed CP-004. Complete operational correction inventory and verified
  chains now feed monthly revision-key matching, exact prior-source lineage and
  independently reconciled no-cash reversals. Two same-month corrections/reload,
  six corruption refusals and a third next-month correction pass; saved draft/audit
  and approved September/October/February calculations remain unchanged on refusal
  or later correction. Selected API 277/277 (three isolated DB suites, zero skips),
  shared 302/302; API types/build/lint pass. Internal verified correction path only;
  voids, credit lifecycle, partial package FOC and close API/UI/full acceptance remain
  blocked/open. CP-003A/CP-006 untouched. No application DB/schema changes,
  activation, deployment, commit or push. Logs `/tmp/cp005-monthly-*`.
  Formatting/whitespace pass; disposable cluster stopped cleanly, fixtures retained.

## Previous checkpoint — redemption correction-chain history

- **CP-005 redemption correction-chain history, October 30, 2026:** IN PROGRESS;
  latest completed CP-004. Complete holding revisions/replacement sources/exact
  prior reversals verify actor/reason/request hash, original coverage/ordinals/value
  and historical rates. New corrections retain original request ordering; legacy
  missing evidence refuses. Real two-correction/retry/reload acceptance preserves
  sessions and prior approved months; four corruptions refuse. Selected API 276/276
  (three isolated DB suites, zero skips), shared 302/302; API types/build/lint pass.
  Monthly correction gate retained, no close written. Next: monthly correction
  inventory/no-cash wiring, session voids and remaining lifecycle/API/UI acceptance.
  CP-003A/CP-006 untouched; no application DB/schema/activation/deployment/commit/push.
  Formatting/whitespace pass; isolated cluster stopped cleanly, fixtures retained.

## Previous checkpoint — manager-override reconciliation

- **CP-005 manager-override reconciliation, October 30, 2026:** IN PROGRESS;
  latest completed CP-004. Sale-bound PIN approval freezes historical role, actor,
  reason and paid/used quantities; complete holding audit inventory reconciles each
  unpaid draw once. Legacy-unbound/missing/duplicate/mismatched approvals refuse.
  Real PIN writer and monthly reload retain original session base and deposit-only
  cash; six corruptions preserve draft/audit, prior approvals unchanged. Selected
  API 272/272 (three isolated DB suites, zero skips), shared 302/302; API types/build/
  lint pass. Missing prior temporary cluster recreated in isolation, migrations
  replayed with dotenv disabled. Next: reversals/corrections, credit lifecycle,
  partial FOC and close API/UI/acceptance. CP-003A/CP-006 untouched; CP-005 not DONE.
  No application DB/schema changes, activation/deployment/commit/push. See CP handoff.
  Formatting/whitespace pass; disposable cluster stopped cleanly, fixtures retained.

## Previous checkpoint — session-package transfer reconciliation

- **CP-005 session-package transfer reconciliation, October 29, 2026:** IN PROGRESS;
  latest completed CP-004. Append-only transfer/draw history replays original-buyer
  ownership, quantity/expiry continuity and owner-at-draw. Purchase value/sellers
  preserved. Real transfer writer, recipient draws and monthly reload pass; six
  corrupted histories refuse without draft/audit changes; prior approvals unchanged.
  Selected API 269/269 (three DB suites, zero skips), shared 302/302; API types/build/
  lint pass. Next: manager overrides and remaining lifecycle/acceptance, partial FOC,
  prepaid-credit spending and close API/UI. CP-005 not DONE; CP-003A/CP-006 untouched.
  No application DB/schema changes, activation/deployment/commit/push. See CP handoff.
  Formatting/whitespace pass; disposable cluster stopped cleanly, synthetic fixtures retained.

## Previous checkpoint — package tender reconciliation

- **CP-005 package tender reconciliation, October 29, 2026:** IN PROGRESS; latest
  completed CP-004. Complete sale-level PACKAGE tender inventory matches verified
  draws/coverage with exact POS residual cents; matched tenders add no fresh cash.
  Monthly payment completeness and frozen tender evidence added. Isolated draft/
  reload and six tender corruption refusals preserve draft/audit and prior approvals.
  Selected API 265/265 (three DB suites, zero skips), shared 302/302; API types/build/
  lint pass. Next: remaining lifecycle integration/acceptance, partial package FOC,
  prepaid-credit spending and close API/UI; gates retained. CP-003A/CP-006 untouched;
  CP-005 not DONE. No application DB/schema changes, activation/deployment/commit/push.
  Formatting/whitespace pass; disposable cluster stopped cleanly, synthetic fixtures retained.

## Previous checkpoint — monthly redemption integration

- **CP-005 monthly redemption integration, October 29, 2026:** IN PROGRESS;
  latest completed CP-004. Internal monthly loader now reconciles usage sales across
  holdings, verifies exact current-month operational/capture inventory, includes
  current redemption bases and scales ordinary services to uncovered units only.
  Isolated November draft/reload verifies three draws, one uncovered service and
  current cash only. Missing captures/double-counting/overclaims fail closed; approved
  September/October remain unchanged. Selected API 260/260 (three DB tests, zero
  skips), shared 302/302; API types/build/lint pass. Unsupported lifecycle, partial
  package FOC and prepaid tenders remain blocked. Disposable cluster stopped;
  formatting/whitespace checks pass. Next: lifecycle/tender integration
  and acceptance; CP-003A/CP-006 untouched, CP-005 not DONE. No application DB/schema
  changes, activation/deployment/commit/push. See feature PROGRESS.

## Previous checkpoint — multi-holding DB acceptance

- **CP-005 multi-holding DB acceptance, October 29, 2026:** IN PROGRESS;
  latest completed CP-004. Real independent package purchases, collection captures,
  draws and redemption captures now prove shared-line coverage and remaining units,
  missing-capture refusal, and aggregate overclaim refusal despite independently
  valid holding histories. Fresh persisted reloads agree. Blocked November close
  leaves no draft/audit rows; approved September/October calculations unchanged.
  Selected API 260/260 (three DB tests, zero skips), shared 302/302; API types/build/
  lint pass. Old disposable cluster was missing; recreated isolated cluster and
  applied repository migrations with dotenv disabled. No application DB access or
  application schema changes. Cluster stopped; synthetic fixtures retained. Next:
  monthly integration/uncovered-service bases;
  gates retained. CP-003A/CP-006 untouched; CP-005 not DONE. See feature PROGRESS.

## Previous checkpoint — cross-holding coverage

- **CP-005 cross-holding coverage, October 29, 2026:** IN PROGRESS; latest
  completed CP-004. Added authenticated server-owned usage-sale inventory with
  complete holding-history replay, capture/record equality and cumulative service
  coverage bounds. Two valid holdings cannot jointly overclaim a sale line. Selected
  API tests **260/260, zero skips** including three isolated DB tests; shared 302/302;
  API types/build/lint pass. Real draw/capture coverage survives persisted reload;
  approved September stays unchanged. Multi-holding coverage is unit-tested; DB
  multi-holding and monthly integration remain next. Monthly gates retained. No
  application DB/schema/backfill/activation/deployment/commit/push. Disposable cluster
  stopped; synthetic fixtures retained. CP-003A/CP-006 untouched; CP-005 not DONE.

## Previous checkpoint — server-owned holding history

- **CP-005 server-owned holding history, October 29, 2026:** IN PROGRESS;
  latest completed CP-004. Independent transaction loader reconciles original
  purchase, full holding draws, receipts/payments/debt, GST, historical rates and
  paid-session/ordinal inventory; unsupported lifecycle paths fail closed. Fixed
  JSONB key-order snapshot hash replay without rewriting history. Selected tests
  **256/256, zero skips**, including three isolated DB tests; shared 302/302;
  API build/types/lint pass. Disposable cluster stopped, synthetic fixtures retained.
  No application DB/schema/backfill/activation/deployment/commit/push. Next: cross-
  holding coverage and monthly redemption wiring; transfer/override/reversal paths,
  credit spending/refunds/voids, corrections and close API/UI remain. Default monthly
  gate retained; CP-003A/CP-006 untouched. CP-005 not DONE; see feature PROGRESS.

## Previous checkpoint — supplied holding reconciliation

- **CP-005 supplied holding reconciliation, October 29, 2026:** IN PROGRESS;
  latest completed CP-004. Added original coverage-rule replay, exact capture keys,
  supplied paid-session chronology, original ordinal/remaining inventory and
  aggregate service coverage reconciliation. Selected tests 249 pass/three DB-gated
  skips, shared 302/302; API types/lint/build and whitespace checks pass. No database
  operations, schema/backfill/activation/deployment/commit/push. Default redemption
  loading remains blocked until independent inventory/payment, transfer, override
  and reversal reconciliation. Credit spending/refunds/voids, source corrections,
  close API/UI and full acceptance remain. CP-003A/CP-006 untouched; CP-005 not DONE.
  See feature PROGRESS for evidence and next steps.

## Previous checkpoint — redemption evidence foundation

- **CP-005 redemption evidence foundation, October 29, 2026:** IN PROGRESS;
  latest completed CP-004. Added original-session economics/ordinal, performer,
  coverage, hash, policy/fixed-award and historical redemption-rate verification.
  Supplied-record only: default redemption loading stays blocked until complete
  paid-session/override/transfer/lifecycle/coverage reconciliation. Focused 248 pass,
  three DB-gated skips; shared 302/302; API types/build/lint pass. No DB access,
  schema/backfill/activation/deployment/commit/push. Next: reconcile authoritative
  redemption inventory/history, wire loader and isolated acceptance; remaining
  credit spending/refunds/voids/corrections/close API/UI still pending. CP-003A/CP-006
  untouched. See feature PROGRESS for exact scope; CP-005 not DONE.

## Previous checkpoint — cross-month package history

- **CP-005 cross-month package history checkpoint, October 29, 2026:** IN PROGRESS;
  latest completed CP-004. Historical sale/outstanding payments and captures are
  verification-only; current-month net cash/bases only, no repeated units/awards.
  Original purchase/deposit, tax, identities, historical rates and source envelopes
  reconcile. Focused close plus context 245/245 (zero skips, three isolated DB tests),
  selected regressions 49/49, shared 302/302; API types/build/lint passed.
  September frozen snapshot survives October balance receipt; stale draft rejected,
  recalculated October approved under explicit post-month test clock. No schema/
  backfill/application DB/activation/deployment/commit/push. Disposable DB stopped.
  Next: usage/credit spending/refund/void, corrections, close API/UI/full acceptance.
  CP-003A/CP-006 untouched; CP-005 not DONE. See feature PROGRESS for limitations.

## Previous checkpoint — same-month outstanding packages

- **CP-005 same-month outstanding package checkpoint, October 29, 2026:** IN PROGRESS;
  latest completed CP-004. Package balance receipts now support independently
  inventoried outstanding payments after an original sale-payment deposit. Explicit
  tenant/customer/sale/debt identity and receipt amount/time reconciliation required;
  net cash only, no repeated units/fixed award. Cross-month remains blocked.
  Focused plus tenancy **271/271**, zero skips (three isolated DB tests); related
  regressions **133/133**; shared **302/302**; API types/build/lint passed.
  No schema change/backfill/application DB access/activation/deployment/commit/push.
  Disposable DB stopped, fixtures retained. Next: cross-month package history,
  usage/credit spending/refund/void, corrections and close API/UI/full acceptance.
  CP-003A/CP-006 untouched; CP-005 not DONE.

## Previous checkpoint — same-month package instalments

- **CP-005 same-month package instalment checkpoint, October 29, 2026:** IN PROGRESS;
  latest completed CP-004. Default loader supports same-month settled SALE_PAYMENT
  package deposits and subsequent receipts. Original minimum deposit rounds up;
  each receipt contributes only collected net; units/fixed award appear once.
  Complete matching inventory, ordered history, original policy/rates and tax replay
  are required. Cross-month/outstanding-payment package receipts remain blocked.
  Focused plus tenancy **267/267**, zero skips (three isolated DB tests); related
  regressions **129/129**; shared **302/302**; API types/build/lint passed.
  No schema change/backfill/application DB access/activation/deployment/commit/push.
  Disposable DB stopped, fixtures retained. Next: historical/outstanding package
  collections, usage/credit spending/refund/void, corrections and close API/UI/full
  acceptance. CP-003A/CP-006 untouched; CP-005 not DONE.

## Previous checkpoint — full package purchase

- **CP-005 full package-purchase checkpoint, October 29, 2026:** IN PROGRESS;
  latest completed CP-004. Default loader supports fully collected single-receipt
  package purchases using immutable original grant/economics/settings, seller
  splits and historical PACKAGE_SALE rates. FOLLOW_PLAN/EXCLUDE/FIXED verified;
  fixed award is once per sale line, not multiplied by units. Partial/multiple/
  missing collections, redemptions, refunds and voids remain blocked. Focused plus
  tenancy **265/265**, zero skips (three isolated DB tests); related regressions
  including loader **127/127**; shared **302/302**; API types/build/lint passed.
  Handoffs/acceptance updated. No schema change/backfill/application DB access/
  activation/deployment/commit/push. Disposable DB stopped, fixtures retained.
  Next: package deposit/instalment loading, usage/credit spending/refund/void,
  source corrections and close API/UI/full acceptance. CP-003A/CP-006 untouched.

## Previous checkpoint — value-purchase collections

- **CP-005 value-purchase collection checkpoint, October 29, 2026:** IN PROGRESS;
  latest completed CP-004. Default loader now reconciles value-package purchases
  and external instalments against original immutable holding snapshots, seller
  shares, net cash/tax and historical stored-credit sale rates. Bonus credit is not
  cash; units occur only on first collection. Missing/mismatched evidence and
  ambiguous collection order fail closed. Focused plus tenancy **260/260**, zero
  skips (three isolated DB tests); related regressions including loader **122/122**;
  shared **302/302**; API types/build/lint passed. See feature handoff and acceptance
  notes. Package purchases/usage/credit spending/refund/void/source corrections/
  close API/UI/full acceptance remain pending. No schema change/backfill/application
  DB access/activation/deployment/commit/push. Authorized disposable DB stopped,
  data retained. CP-003A/CP-006 untouched; CP-005 not DONE.

## Previous checkpoint — FOC operational economics

- **CP-005 FOC operational-economics checkpoint, October 29, 2026:** IN PROGRESS;
  latest completed CP-004. Independent immutable checkout sale-line economics now
  support full FOC list-price activity, exact performer splits and historical FOC
  rates with zero cash in the default loader. Missing/tampered evidence, mixed
  usage/prepaid and unsupported reversals block close. Focused plus tenancy
  **241/241**, zero skips (three isolated DB tests), regressions **78/78**, shared
  **302/302**; API types/build/lint and Prisma validation passed. Broad DB-dependent
  sale suite could not run on unreachable URL; not run against retained DB cleanup.
  See feature handoff and `docs/commission_payroll/CLOSE_ACCEPTANCE.md`. Continue
  CP-005 package/usage/prepaid/refund/void loading, source-base corrections, close
  API/UI/full acceptance. New migration only on authorized disposable DB, stopped
  with data retained; no legacy backfill/application DB access/activation/deployment/
  commit/push. CP-003A/CP-006 untouched; CP-005 not DONE.

## Previous checkpoint — ordinary rate provenance

- **CP-005 ordinary rate-provenance checkpoint, October 29, 2026:** IN PROGRESS;
  latest completed CP-004. Source writer freezes per-staff fallback selection,
  legacy rate and item/category/time; ordinary loader replays immutable independent
  rule inventory at capture time. Missing/mismatched provenance fails closed;
  current staff rates and later-published rules cannot rewrite captured decisions.
  Focused plus tenancy **236/236**, zero skips (three isolated DB tests), related
  regressions **78/78**, shared **302/302**; API types/build/lint passed. See feature
  handoff and `docs/commission_payroll/CLOSE_ACCEPTANCE.md`. Continue CP-005 remaining
  package/usage/prepaid/FOC/refund/void loading, source-base corrections and close
  API/UI/full acceptance. Old captures lacking provenance deliberately unavailable;
  no backfill/migration/activation. Disposable cluster stopped, data retained.
  No application DB access, deployment, commit or push. CP-003A/CP-006 untouched.

## Previous checkpoint — persisted carry authorization

- **CP-005 persisted carry authorization checkpoint, October 29, 2026:** IN PROGRESS;
  latest completed CP-004. Internal verified-owner opening/settlement persistence
  now feeds the authoritative loader. Immutable server-stamped hash/revision audits,
  full staff opening inventory, future-boundary/first-close checks, exact settlements,
  stale-balance rejection and explicit reauthorization tested. Focused **223/223**
  plus tenancy **4/4** (**227/227**, zero skips, three isolated DB acceptance tests);
  shared **302/302**; API typecheck/build/lint passed. Migration applied only to the
  authorized disposable DB, then cluster stopped with data retained. No existing
  application DB access, activation, deployment, commit or push. See feature handoff
  and `docs/commission_payroll/CLOSE_ACCEPTANCE.md`. Continue CP-005 remaining
  operational loaders/provenance, source-base corrections, close API/UI and full
  acceptance. First-close future calculation tested, not end-of-month approval;
  owner-attested opening and write-off are not legacy debt reconstruction/cash repayment.
  CP-003A/CP-006 untouched; CP-005 not DONE.

## Previous checkpoint — authoritative ordinary inputs

- **CP-005 authoritative ordinary-input checkpoint, October 29, 2026:** IN PROGRESS;
  latest completed CP-004. Server-owned transactional loader now defaults internal
  calculation/approval; ordinary operational bases, attribution, recorded payments,
  exact GST/cash, historical configuration and verified prior carry reconcile.
  Complete independent inventories detect missing captures. Unsupported package/
  prepaid/usage/FOC/refund/void/correction evidence fails closed; no inferred opening
  zero. Focused **221/221**, zero skips (both isolated DB tests), shared **302/302**,
  API typecheck/build/lint pass. See `docs/commission_payroll/CLOSE_ACCEPTANCE.md`
  and feature handoff for limits and logs. Continue CP-005 operational provenance/
  loaders and persisted authenticated opening/settlement, then source-base posting
  and close API/UI. CP-003A/CP-006 untouched; CP-005 not DONE. No migrations,
  existing DB access, activation, deployment, commit or push.

## Previous checkpoint history

- **CP-005 isolated persistence/scoped carry checkpoint, October 29, 2026:**
  IN PROGRESS; latest completed CP-004. User approved new isolated disposable DB
  implementation/migrations/acceptance only. Fresh loopback cluster 55485, DB
  `payroll_close_test`; no existing/production DB access, activation or deployment.
  Internal locked frozen-close store/atomic immutable audits, payout race protection,
  owner-only next-open-month monetary correction, audited supplied opening/carry
  settlement and scoped plan/fallback composition added. Version `cp-005-v2`.
  Focused 211/211 incl. isolated persistence acceptance; shared 302/302; existing UI
  regression 40/40; API build/types/lint, shared lint and web typecheck passed.
  Still missing authoritative loaders, persisted authenticated opening/settlement,
  source-base correction integration and monthly-close API/UI/full acceptance.
  See `docs/commission_payroll/CLOSE_ACCEPTANCE.md`. CP-005 is not DONE.

- **CP-005 first-close/approval-integrity checkpoint, October 29, 2026:** IN PROGRESS;
  latest completed CP-004. Explicit audited supplied opening inventory now composes
  a first close without inventing previous zero history. Preserves exact component/
  fallback debt and departed staff; conflicting, missing or unmapped evidence fails
  closed. Opening revisions reject stale approval. Approval replays draft outputs
  and rejects snapshot tampering or approval before calculation. Eleven added tests;
  focused 207/207, shared 298/298, API typecheck/lint/build passed. No DB operations,
  migrations, activation or deployment. User requested continuation to CP-005 DONE;
  mandatory persistence/race/transactional/API/UI acceptance remains blocked by the
  DB pause. Need explicit decision before isolated disposable DB work; production
  remains unauthorized. See commission-payroll handoff for remaining scope.

- **CP-005 ordinary returned-void checkpoint, October 29, 2026:** IN PROGRESS;
  CP-004 latest completed. Supplied independent settled payouts/full original
  external-cash allocations now reconcile service/product returned voids as well
  as collection voids. Validates sale-line identity, complete supplied inventory,
  staff splits, exact reversals and current collection sale/type/outlet/shares.
  Net subtracts once; same-month cash nets to zero. Frozen revisions reject stale
  approval and retain departed debt. Ten added tests; focused 196/196, API
  typecheck/lint/build passed. Suite covers payroll-close, preview inputs,
  correction-period and package-void tests. No DB operations or activation.
  Next: cancelled-settlement evidence and trusted-loader design; partial/uncertain
  returns, carry/scoped composition/persistence/corrections/API/UI remain pending.

- **CP-005 returned-cash collection-void checkpoint, October 29, 2026:** IN PROGRESS;
  CP-004 latest completed. Independent settled payouts/original allocations support
  full package/value-package collection returns, net/GST/staff reconciliation and
  same-month zero netting. Frozen revisions reject stale approval; departed debt
  retained. Nine new tests; focused 192/192, API typecheck/lint/build and format/
  whitespace pass. Supplied records only; ordinary returned/cancelled-settlement
  void cash, trusted loaders, carry/scoped composition/persistence/API/UI remain.
  All DB operations paused; no DB access, migrations, activation or deployment.
  See commission-payroll handoff for limitations and remaining acceptance.

- **CP-005 no-cash sale-void checkpoint, October 29, 2026:** IN PROGRESS;
  CP-004 latest completed. Independent NO_MOVEMENT disposition reconciles complete
  supplied sale-line/collection reversals without erasing original collected cash.
  Frozen revisions reject stale approval; departed debt preserved. Ten new tests;
  focused 183/183, API typecheck/lint/build and format/whitespace pass. Supplied
  records only; returned/uncertain void cash, trusted loaders, carry/settlement,
  scoped composition, persistence/locks/corrections/API/UI remain. All DB operations
  paused; no DB access, migrations, activation or deployment. See CP handoff.

- **CP-005 ordinary-sale refund checkpoint, October 29, 2026:** IN PROGRESS;
  CP-004 latest completed. Full service/product refund cash reconciles independent
  payout tenders/GST/net, original line allocations/sellers and exact reversals.
  Frozen settlement revisions reject stale approval; departed staff/debt retained.
  Thirteen new tests; focused 173/173, API typecheck/lint/build, format/whitespace
  pass. Supplied records only; collection/void cash, authoritative loaders,
  carry/settlement, scoped composition, persistence/locks/corrections/API/UI remain.
  All DB operations paused; no DB access, migrations, activation or deployment.
  See commission-payroll handoff for remaining acceptance and limitations.

- **CP-005 non-cash reversal checkpoint, October 29, 2026:** IN PROGRESS;
  CP-004 latest completed. Independent zero-money operational evidence permits
  exact redemption/value-spend/session-correction reversals without changing cash.
  Frozen revisions reject stale approval; departed staff/debt preserved. Ten new
  tests; focused 160/160, API typecheck/lint/build and format/whitespace pass.
  Supplied-record validation only; sale cash reversal reconciliation, authoritative
  loaders, settlement/scoped composition, persistence/locks/corrections/API/UI remain.
  All DB operations paused; no DB access, migrations, activation or deployment.
  See commission-payroll handoff for details and remaining acceptance.

- **CP-005 refund cash checkpoint, October 29, 2026:** IN PROGRESS; CP-004 latest
  completed. Non-DB package/value-package payout and original allocation/seller
  reconciliation subtracts net refunds from staff/outlet cash, preserving negative
  totals and departed staff. Frozen payout revisions reject stale approval.
  Twelve new tests; focused 150/150, API typecheck/lint/build pass. Supplied-record
  validation only; generic reversal cash, authoritative loaders, carry/settlement,
  scoped composition, persistence/locks/corrections/API/UI acceptance remain.
  All DB operations paused; no DB access, migrations, activation or deployment.
  See commission-payroll handoff for limitations and remaining acceptance.

- **CP-005 SUM_INDIVIDUAL checkpoint, October 29, 2026:** IN PROGRESS; CP-004
  latest completed. Added exact group-base population resolver and composer
  reconciliation using selected rule/assignment scope, including departed and
  different-plan staff. Frozen population evidence rejects stale approval.
  Supplied-record validation only; refund cash reconciliation, authoritative
  loaders, carry settlement, persistence/locks/corrections/API/UI acceptance remain.
  All DB operations paused; no DB access, migrations, activation or deployment.
  See commission-payroll handoff for actual checks and next steps.
  Focused 138/138, API typecheck/lint/build, formatting and whitespace pass.

- **CP-005 cash-metric checkpoint, October 29, 2026:** IN PROGRESS; CP-004 latest
  completed. Non-DB collection attribution now derives staff and salon/outlet net
  cash totals, reconciles caller metric assertions and supplies statement collection
  denominators. Includes collection-only departed staff and stale attribution checks.
  Fourteen new tests; focused 125/125, API typecheck/lint/build pass. Refund/reversal
  and SUM_INDIVIDUAL fail closed; trusted loading, persistence/locks, actual correction
  posting and API/UI/transactional acceptance remain. All DB operations still paused;
  no migrations, DB access, activation or deployment. See commission-payroll handoff.

- **CP-005 composition checkpoint, October 29, 2026:** IN PROGRESS; CP-004 latest
  completed. Added non-DB inventory/payment/collection reconciliation, next-open
  correction allocation and combined close-input evidence with required departed
  staff integration. Supplied-record validation only, not authoritative loaders,
  persisted closes, actual correction posting or API/UI acceptance. User explicitly
  retained all-database pause; mandatory real transactional acceptance is blocked.
  No DB operations, migrations, activation or deployment. Resume CP-005, not CP-006;
  detailed remaining scope and verification in commission-payroll handoff.
  Focused non-DB tests 111/111, shared 298/298; API typecheck/lint/build,
  formatting and whitespace checks pass. No database/browser acceptance run.

- **CP-005 legacy exclusion checkpoint, October 28, 2026:** non-DB resolver
  blocks overlapping legacy sale commissions, missing sale identity and unresolved
  reconciliation, without netting reversals or rewriting history. Focused tests
  75/75; API typecheck/lint/build pass. Supplied-record validation only, not
  authoritative inventory or disabling legacy payouts. CP-005 IN PROGRESS;
  inventory/collection/carry integration, corrections, persistence/locks/API/UI
  and transactional acceptance remain. No DB commands, migrations or activation.
  CP-004 latest completed; resume CP-005. See commission-payroll handoff.

- **CP-005 frozen carry checkpoint, October 28, 2026:** non-DB resolver checks
  immediately previous approved snapshots against replayed frozen inputs, retaining
  exact component/fallback debt and departed staff. Missing history is unavailable,
  not zero. Focused tests 67/67; API typecheck/lint/build pass. CP-005 IN PROGRESS;
  authoritative inventory/collection/carry loading, opening carry policy, required-staff
  integration, corrections, persistence/locks/API/UI and transactional acceptance remain.
  No DB commands, migrations, routes or activation. CP-004 latest completed;
  resume CP-005; see commission-payroll handoff.

- **CP-005 source evidence checkpoint, October 28, 2026:** internal captured-source
  resolver validates month/date/outlet/currency/types, duplicate inputs and exact
  reversal lineage while preserving original history. Focused non-DB tests 57/57;
  API lint/typecheck/build pass. CP-005 remains IN PROGRESS: authoritative inventory,
  collection/carry, posting allocation, persistence/locking/API/UI and transactional
  acceptance remain. No DB commands, migrations, routes or activation. Resume CP-005;
  see commission-payroll handoff. CP-004 remains latest completed task.

- **CP-005 configuration checkpoint, October 28, 2026:** internal historical
  profile/staff/settings and month-end plan resolver added, with complete selected
  audit evidence and fail-closed missing/ambiguous configuration. Focused non-DB
  configuration/close/preview/statement tests 42/42 pass; API lint/typecheck/build,
  formatting and whitespace checks pass. CP-005 stays IN PROGRESS;
  authoritative source/collection/carry loading, persistence/locking/corrections,
  API/UI and transactional acceptance remain. No DB commands or activation.
  See commission-payroll handoff; resume CP-005, not CP-003A/CP-006.

- **CP-005 IN PROGRESS, October 28, 2026:** non-activating exact-money statement
  assembly and pure monthly close transitions added. Shared tests 298/298;
  focused statement/close tests 18/18; API close/preview tests 17/17; shared/API
  typecheck/lint pass. Persistence, authoritative loaders, correction allocation,
  source locking, API/UI and transactional acceptance remain. No DB commands,
  migrations, activation or deployment. Resume CP-005; see detailed handoff in
  `docs/commission_payroll/PROGRESS.md`. CP-004 remains the latest completed task.

- **CP-004 DONE, October 28, 2026:** separately authorized isolated PostgreSQL
  acceptance passed 18/18 on three runs after fresh 63-migration replay; route/helper
  regression 210/210, shared 290/290, full serial web 963/963; API/web checks/builds
  pass. Disposable cluster stopped. No application/production DB access during this
  acceptance, no activation/deployment/commit/push. Current task None; next CP-005
  (not started); CP-003A follows CP-005. See commission-payroll completion handoff.
  Earlier incomplete checkpoints below are retained as history, not current status.

- **CP-004 consistency/void checkpoint, October 28, 2026:** detail and refund share
  source validation; preview blocks missing source/debt; new refund bases start
  EARNED rather than inheriting PAID. Expanded non-DB API 148/148, UI 57/57, shared
  290/290; API/web typecheck/lint and API build pass. Completion remains BLOCKED by
  mandatory real transactional/POS/rollback/race acceptance under the retained DB
  pause. CP-004 IN PROGRESS; no CP-005/CP-003A advance. See detailed handoff.

- **CP-004 collection ingestion seam, October 28, 2026:** 22 new in-memory
  integration tests; focused non-DB API 116/116, API typecheck/lint pass. Real
  collection/payroll capture/detail/refund services covered; no runtime changes.
  Payment recording endpoints/gateway settlement and SQL lifecycle/rollback/races
  remain unverified. CP-004 IN PROGRESS; DB pause holds; CP-005/CP-003A untouched.
  See commission-payroll handoff for remaining detail eligibility consistency work.

- **CP-004 value source evidence, October 28, 2026:** 21 new multi-collection/
  split-seller cases; focused non-DB API 94/94, API typecheck/lint/build pass. Positive
  refunds now reject missing/conflicting original seller rates rather than selecting
  a rate by query order. Mixed-tender ingestion and real DB lifecycle/race acceptance
  remain unverified. CP-004 IN PROGRESS; DB pause holds; CP-005/CP-003A untouched.
  See commission-payroll handoff for evidence and conservative refund limitation.

- **CP-004 HTTP boundaries, October 28, 2026:** 41 new real HTTP/router/auth/
  module/role/outlet/validation cases pass with in-memory persistence doubles;
  combined non-DB API 73/73, API typecheck/lint pass. No runtime changes or DB work.
  SQL isolation/rollback/race and broader source acceptance remain unverified.
  CP-004 IN PROGRESS; CP-005 unstarted; CP-003A TODO after CP-005. All DB work paused.
  See commission-payroll handoff for coverage and limits.

- **CP-004 value-refund UI, October 28, 2026:** customer-bound detail endpoint,
  exact read contract, prepaid economics/refund dialog with fee/GST preview, actual
  tender and confirmation implemented. Focused web 55/55, non-DB API 32/32, shared
  290/290; typechecks/lint/web build pass. Full web 958/959 (PayrollPlans timeout);
  isolated rerun 23/23. All DB work paused. CP-004 IN PROGRESS: real HTTP/transactional
  lifecycle/race acceptance remains. CP-005 unstarted; CP-003A TODO after CP-005.
  See commission-payroll handoff for evidence and remaining gates.

- **CP-004 value-refund service, October 28, 2026:** guarded endpoint, original
  source/usage/seller reconciliation, cancellation/retry evidence and post-refund
  collection/void guards implemented. Non-DB doubles 26/26; shared 287/287; API
  typecheck/lint/build pass. All DB work stays paused. CP-004 IN PROGRESS: UI and
  real HTTP/transactional lifecycle/race acceptance remain. CP-005 unstarted;
  CP-003A TODO after CP-005. See commission-payroll handoff.

- **CP-004 value-refund foundation, October 28, 2026:** exact original paid/credit
  refund arithmetic and purchase validation added with ten tests; shared 287/287,
  workspace typechecks/lint pass. Pure helper only: endpoint/UI and atomic lifecycle
  integration remain. All DB work stays paused, so mandatory race/rollback acceptance
  still blocks DONE. CP-004 IN PROGRESS; CP-005 unstarted; CP-003A TODO after CP-005.
  See commission-payroll handoff for remaining work and evidence.

- **CP-004 session-action UI, October 28, 2026:** strict refund amounts, stale
  correction-draft invalidation and revision-bound void retry keys; pending-write
  guard. Detail UI 27/27, full web 940/940, web typecheck/lint/build pass.
  All DB work remains paused. CP-004 IN PROGRESS; value-package refunds and real
  transactional lifecycle acceptance remain. CP-005 unstarted; CP-003A TODO after
  CP-005. See commission-payroll handoff.
- **CP-004 implementation increment, October 28, 2026:** implemented zero-payout
  cancellation, refund evidence validation/original fixed-award clawback, FOC list
  price capture and fixed-sale instalment guard. Shared 277/277, full web 921/921,
  non-DB PIN HTTP 6/6, typechecks/lint and API/web builds pass. All DB work remains
  paused; expanded lifecycle assertions unexecuted. CP-004 stays IN PROGRESS, with
  transactional/race acceptance and value-package refunds outstanding. CP-005 not
  started; CP-003A TODO after CP-005. See commission-payroll handoff.
- **CP-004 refund/economics review, October 28, 2026:** confirmed schema/service
  zero-payout rejection, selected-price/mixed-credit FOC gaps and missing refund
  ordinal/count reconciliation. Fixed-award quantity semantics remain unresolved.
  Shared 267/267, focused web 25/25, workspace typechecks/lint pass. Documentation
  only; all DB work stays paused. CP-004 remains IN PROGRESS; CP-003A TODO after
  CP-005. See `docs/commission_payroll/PROGRESS.md` for findings and acceptance gaps.
- **CP-004 PIN-budget fix, October 28, 2026:** authorized code increment makes
  non-PIN checkout bypass approval throttling. Non-DB HTTP tests 6/6, API typecheck
  and lint pass. DB work remains paused; CP-004 remains IN PROGRESS. CP-003A is
  TODO after CP-005. See commission-payroll handoff for scope and limitations.
- **CP-004 non-database review, October 28, 2026:** user keeps every database
  operation paused. Shared build/tests 267/267, focused web 25/25, workspace
  typechecks/lint pass. Static review identified PIN-budget and zero-payout refund
  gaps; quantity/FOC policy checks remain. Only tracking documents changed.
  CP-004 remains IN PROGRESS; see commission-payroll handoff for findings.
- **CP-004 STOP / safety incident, October 28, 2026:** an unscoped migration
  command applied 12 pending migrations to local application DB `glampro_suite`
  at `localhost:5432`. No automatic rollback. Owner review required before further
  database operations. Lifecycle code remains unfinished/unaccepted; no activation.
  See `/tmp/cp004-lifecycle-unsafe-migrate-notrun.log` (command DID run) and
  `docs/commission_payroll/PROGRESS.md`. Earlier no-application-write claims below
  are historical checkpoints, not claims about this session.

- **CP-004 IN PROGRESS — explicit package settings, October 28, 2026:** owner-only
  reasoned/stale-protected sale/redemption modes and minimum deposit settings,
  atomic audit, editor controls and immutable purchase-time copy implemented.
  No inferred defaults or legacy backfill. Disposable 60 migrations, shared 265/265,
  focused API 68/68, POS integration 1/1, web 30/30, typechecks/lint pass; DB stopped.
  Next: redemption economics/ordinals and deposit/paid-session/PIN gates, then
  remaining capture/refund/correction. Earnings inactive; CP-005 not started.
  See `docs/commission_payroll/PROGRESS.md` for handoff and verification logs.

- **CP-004 IN PROGRESS — purchase economics increment, October 28, 2026:** new
  package holdings atomically snapshot original purchase value, sessions, sellers
  and source IDs with database immutability. Four-decimal ordinal/session splits
  reconcile exactly; transfer/catalogue edits retain the original snapshot. Missing
  commission settings remain explicit; redemption integration and paid-session/PIN
  enforcement are not accepted. Disposable 59-migration replay, shared 262/262,
  focused API 68/68, collection integration 1/1 twice, web 23/23 and workspace
  typechecks/lint pass. Resume CP-004; no earnings activation or application DB writes.
  See [CP handoff](docs/commission_payroll/PROGRESS.md).

- **CP-004 IN PROGRESS — October 28, 2026:** atomic rate-free package collection
  snapshots added with original seller splits, four-decimal net bases and source/
  GST lineage. Unknown currency/sellers remains UNAVAILABLE/null. Disposable replay
  58 migrations, shared 257/257, collection integration 1/1 (repeated), focused API
  68/68 and web 23/23, workspace typechecks/lint pass. Remaining package settings,
  paid-session/PIN, other source and refund/correction workflows are not accepted.
  Resume CP-004; CP-005 not started. No application DB writes or earnings activation.
  See [CP handoff](docs/commission_payroll/PROGRESS.md).

- **CP-003 DONE — October 28, 2026 (configuration-only):** fresh disposable replay
  of all 58 migrations, root build, workspace typechecks/lint, shared 252/252, serial
  API 638 passed/35 gated skips/zero failures, Chrome 18/18 twice and web 910/910
  pass. Added acceptance evidence map. Historical monetary preview remains CP-003A;
  readiness stays unavailable/null and earnings inactive. Disposable DB stopped;
  existing changed application files preserved. No application DB operations,
  activation or deployment. Next ready: CP-004, not started. See
  [CP handoff](docs/commission_payroll/PROGRESS.md). Entries below are historical.

- **CP-003 scope split approved — October 28, 2026:** user chose configuration-only
  acceptance, conditional on safety without historical monetary preview. CP-003 is
  IN PROGRESS pending acceptance review, not DONE. Historical monetary integration/
  full-run equality is tracked in CP-003A after CP-004/CP-005 and remains a CP-007
  release gate. Focused input/timezone 22/22 and configuration/readiness web 45/45
  pass. Full DB/browser suites not rerun; configuration remains non-activating and
  historical impact null. No code edits or database operations in this revision.
  Next: finish CP-003 configuration acceptance; CP-004 not started. See
  [CP handoff](docs/commission_payroll/PROGRESS.md). Older entries below are history.

- **CP-003 BLOCKED — October 28, 2026:** resumption review confirms no established
  authoritative historical rate-free inputs, frozen opening carry or scoped group
  metrics. Focused historical-input tests 7/7 pass; full suites not rerun. Next:
  identify an authorized source satisfying the evidence contract or explicitly
  approve a scope/dependency revision. See
  [CP handoff](docs/commission_payroll/PROGRESS.md). No production code changes,
  database access or CP-004 work; previews remain unavailable and earnings inactive.

- **CP-003 remaining named browser gaps — October 27, 2026:** salary permissions/
  audit, stale salary/settings reload and atomic staff creation with scoped initial
  assignment pass in real Chrome/API/DB acceptance: 18/18 on two runs. Full serial
  API 638 passed/35 gated skips/zero failures; full web 910/910 with one worker;
  shared 252/252; API typecheck/lint/build and formatting/whitespace pass. Initial
  concurrent web run timed out; unchanged serial rerun passed. Disposable DB stopped.
  See [CP handoff](docs/commission_payroll/PROGRESS.md). CP-003 cannot be marked DONE:
  authoritative historical inputs and calculator/full-run impact equality remain
  blocked. CP-004 untouched; no earnings activation or application DB writes.

- **CP-003 browser assignment/settings — October 27, 2026:** Chrome/API tests
  cover coverage-required classification, audited join-date/assignment setup,
  salon settings failure/recovery and manager denial. Browser 15/15 on two runs;
  focused web 29/29, input/timezone 22/22, API typecheck/lint/build pass. See
  [CP handoff](docs/commission_payroll/PROGRESS.md). CP-003 IN PROGRESS;
  remaining browser gaps and authoritative monetary integration/equality open.
  CP-004 untouched; synthetic disposable writes only, no activation.

- **CP-003 browser plan lifecycle — October 27, 2026:** real Chrome acceptance
  now covers reason-required sample creation, saved-draft publication, immutable
  published history, duplicate/archive and manager write denial. Browser 11/11
  on two runs; focused web 29/29, input/timezone 22/22, API typecheck/lint/build
  pass. See [CP handoff](docs/commission_payroll/PROGRESS.md). CP-003 IN PROGRESS;
  staff/settings browser flows and authoritative monetary inputs/equality remain.
  CP-004 untouched; synthetic disposable writes only, no earnings activation.

- **CP-003 authenticated readiness browser acceptance — October 27, 2026:** real
  Chrome/web/API tests cover owner/company, manager/outlet denial, stale revisions,
  permission loss on retry and failure/recovery. Final browser 7/7 on two runs,
  focused web 29/29, input/timezone 22/22 and API typecheck/lint/build pass. See
  [CP handoff](docs/commission_payroll/PROGRESS.md) for scope and harness limits.
  CP-003 remains IN PROGRESS; monetary inputs/equality remain blocked. CP-004
  untouched. Disposable synthetic writes only; no application DB writes/activation.

- **CP-003 historical evidence contract — October 27, 2026:** documented the
  authoritative-input integration gate; existing records still do not establish
  complete historical monetary inputs. Invalid latest salon audit now returns an
  explicit blocker without older/current fallback, with salon/staff regression
  coverage. Focused input/timezone 22/22 and API typecheck/lint/build pass. See
  [CP handoff](docs/commission_payroll/PROGRESS.md). CP-003 remains IN PROGRESS;
  calculation/equality and browser acceptance remain open. CP-004 untouched;
  no database startup/writes or earnings activation.

- **CP-003 lifecycle concurrency — October 27, 2026:** disposable tests verify
  competing atomic creation, join-date/assignment ordering, classification/removal,
  repair/reactivation and same-revision settings. Concurrency suite 6/6 passed on
  three repeated runs; serial API 636 passed/34 gated skips/zero failures;
  API typecheck/lint/build pass. See
  [CP handoff](docs/commission_payroll/PROGRESS.md) for final regression and limits.
  CP-003 remains IN PROGRESS; CP-004 untouched. Test-only increment, no activation
  or application DB writes. Next: historical monetary inputs and browser acceptance.

- **CP-003 historical readiness UI — October 27, 2026:** company owners can request
  server-backed historical input readiness in plan settings. The panel explains
  month/audit evidence, disabled staff and missing inputs without inventing payout
  totals. Plan/revision changes, permissions, retries and refreshes hide stale results.
  Full web 910/910 (106 files), focused input/timezone 20/20 and web typecheck/lint/build pass; details in
  [CP handoff](docs/commission_payroll/PROGRESS.md). CP-003 IN PROGRESS; CP-004 untouched.
  No application DB writes or earnings activation.

- **CP-003 historical preview readiness — October 27, 2026:** owner/company read-only
  API resolves the last completed salon month, month-end assignments/published
  versions and pre-close audited settings. It explicitly returns UNAVAILABLE/null
  impact while complete monetary bases, frozen carry and group metrics are missing.
  Focused preview/timezone tests 20/20, API typecheck/lint and disposable lifecycle
  acceptance pass; see [CP handoff](docs/commission_payroll/PROGRESS.md).
  CP-003 remains IN PROGRESS; CP-004 untouched. No earnings or application DB writes.

- **CP-003 outlet assignment checkpoint — October 27, 2026:** company owners can
  assign scoped published plans, including atomic staff creation. Assignments
  snapshot validated outlet scope. Shared pooling separates eligible/fallback
  activity and rejects mixed-scope plan calculation; no earnings activation.
  CP-003 stays IN PROGRESS; CP-004 untouched. See
  [CP handoff](docs/commission_payroll/PROGRESS.md) for checks and limitations.
  Next: historical preview, lifecycle concurrency and authenticated browser acceptance.
  Verified shared 252/252, web 901/901, focused disposable API/HTTP 25/25;
  serial API 625 passed, 34 gated skips, zero failures. Build/lint/typechecks pass.
  Disposable cluster stopped; port 55474 inactive. No application DB writes.

- **CP-003 mandatory creation — October 27, 2026:** staff creation now requires
  owner-audited classification, join date and initial plan for commission earners.
  Owner-only POST/UI saves identity, branch links and payroll audit atomically;
  managers retain valid profile edits/suspension. Shared 248/248, web 900/900,
  focused disposable acceptance 25/25; serial API 625 passed, 34 gated skips,
  zero failures. Root build/lint and API/web typechecks pass. See
  [CP handoff](docs/commission_payroll/PROGRESS.md). CP-003 stays IN PROGRESS:
  outlet pooling, authoritative historical inputs and browser acceptance remain.
  CP-004 was not started; no application database writes or earnings activation.

- **CP-003 unclassified active-edit follow-up — October 27, 2026:** active staff
  edits/reactivation now require supported owner-audited classification under the
  tenant configuration lock. Suspension and disabled maintenance remain available.
  Focused disposable lifecycle/staff HTTP 23/23; API typecheck/lint/build pass.
  See the [CP handoff](docs/commission_payroll/PROGRESS.md) for full regression
  results. Mandatory creation, outlet pooling, historical inputs and authenticated
  browser acceptance remain open. CP-003 stays IN PROGRESS; CP-004 not started.

- **Commission & Payroll management — October 27, 2026:** first-priority workstream
  is now [CP](docs/commission_payroll/PROJECT.md), with
  [tasks](docs/commission_payroll/TASKS.md),
  [decisions](docs/commission_payroll/DECISIONS.md), and
  [current handoff](docs/commission_payroll/PROGRESS.md). CP-001 establishes the
  new management; CP-002 pure engine and fixtures are now DONE (36 new engine
  tests; shared 237/237, typecheck/lint/build pass). Next is CP-003, versioned
  plans, assignments and settings; it is IN PROGRESS with a partial configuration
  checkpoint. Structured stages/incentives/category filters/component ordering,
  selected-stage charts, settings/metadata forms, staff payroll workflow, keyed
  version comparison and audit paging added; build/typecheck/lint and disposable
  service/HTTP acceptance pass; latest join-date concurrency protection verified,
  full web 892/892 (104 files), shared 244/244 and staff HTTP 22/22. See the CP handoff for
  evidence and remaining acceptance work. Latest continuation adds optional atomic
  staff/department/initial-plan creation, verified web 896/896, shared 245/245,
  staff HTTP 22/22 and disposable acceptance; mandatory lifecycle enforcement
  remains incomplete. Latest safety follow-up enforces assignment/join-date ordering
  in both directions; disposable acceptance, API typecheck/lint and default API
  serial API regression (623 passed, 34 opt-in skips) pass. Parallel final run had
  two existing resource/sale transaction timeouts; see CP handoff. Resume CP-003, not CP-004.
  Latest continuation adds explicit owner-audited commission classification and
  current/ongoing plan coverage guards, without inferring from login roles. Shared
  246/246, full web 897/897, serial API 623 passed/34 gated skips, disposable lifecycle,
  root build, workspace typechecks and lint pass;
  mandatory create/edit lifecycle enforcement remains open. See CP handoff.
  Latest increment adds owner-only atomic classified creation: identity, department
  links, initial plan and classification audit save together; classified staff
  require join date and commission earners require current-month plan coverage.
  Shared 247/247, full web 898/898, serial API 623 passed/34 gated skips, root build,
  workspace typechecks and lint pass. Mandatory lifecycle integration is still open.
  Latest safety increment guards active classified profile edits/reactivation under
  the tenant configuration lock; invalid writes roll back while suspension remains
  available. Focused disposable lifecycle/staff HTTP 23/23, API typecheck/lint pass.
  Final serial API 623 passed/34 gated skips and API production build pass; web
  regression not rerun for this API-only increment. CP-003 remains IN PROGRESS.
  The old SC tracker is archived with original contents preserved and is no longer
  authoritative. Configuration API/UI and disposable migration only; no POS/earnings
  activation, application migration or deployment claimed.

- **Production seed correction complete — October 25, 2026:** production `ADMIN_*`
  initializes a `PlatformAdmin` and shared modules, without creating a salon or
  tenant users. Repeat runs preserve operator credentials/disabled status and refuse
  another email after initialization. Development demo behavior is unchanged;
  existing application data is not converted or removed. Focused pure tests 19/19,
  production and development acceptance tests on separate fresh temporary PostgreSQL
  databases, API typecheck/lint, formatting and whitespace checks pass. No application
  database seed, migration or deployment performed. Current task: None; next: None.

- **CART-UX compact-row follow-up DONE — October 25, 2026:** divided item rows
  replace nested cards; quantity/removal share a group, discount actions are quieter,
  staff selection retains accessible labels, and the header has a count badge.
  Larger checkout total; existing height, action order and sale behavior preserved.
  Full web 802/802 across 96 files, lint, typecheck/production build and changed-source
  formatting pass. Local `/sale` HTTP 200; authenticated browser visual review not
  performed. Unrelated working changes preserved. Current task: None. Next: None selected.

- **CART-UX layout follow-up complete — October 25, 2026:** Hold cart on the
  left and Take payment on the right in one compact 44px row, without icons.
  Cart increased to `max(36rem, 100dvh - 10rem)` on desktop and
  `min(90dvh, 46rem)` with a 24rem minimum on smaller screens. This adds item
  space while preserving scrolling and the non-shrinking footer; short screens
  may require page scrolling. Focused cart/sale 63/63, web lint, typecheck/build,
  formatting and whitespace checks pass. Browser visual review not performed.
  Current task: None. Next: None selected.

- **CART-UX DONE — October 25, 2026:** clearer item hierarchy, grouped 44px
  quantity controls, collapsible discount editor, separate removal/staff controls,
  full-width 52px payment/hold actions, clear-cart confirmation and stronger totals.
  Customer warning disappears after selection; wider XL cart retains existing height
  and mobile shortcut. Initial unchanged-search debounce no longer resets paging.
  Full web 800/800 across 96 files; web lint, typecheck/production build, source
  formatting and whitespace checks pass. Authenticated visual review not performed.
  Existing working changes preserved; no backend/database/dependencies/deployment.
  Current task: None. Most recently completed: CART-UX. Next: None selected.

- **Cart height follow-up complete — October 25, 2026:** increased desktop cart
  to `max(30rem, 100dvh - 14rem)` and smaller-screen height to `min(80dvh, 38rem)`
  with a 20rem minimum. Scrollable items and non-shrinking footer preserved.
  Focused sale tests 54/54, web typecheck/production build and formatting pass.
  Authenticated visual review not performed; short viewports may need page scrolling.
  Latest user-requested increment adds 32px on desktop; the same checks were rerun and pass.

- **SALE-CATALOG DONE — October 25, 2026:** responsive taller cart with centered
  empty state, scrollable lines and fixed footer; 24-item server-side category
  pages with search/tab resets; cart-service detail reads replace the truncated
  service catalog lookup. Tabs persist while stale sellable rows are hidden.
  Full web 791/791 (95 files), focused sale API 62/62, shared 188/188, workspace
  lint, API/web typecheck and production web build pass. Synthetic 805-item checks
  cover every kind; actual database paging regression passes. Browser visual review
  and production timing not performed. Existing staff-list ceiling remains 200.
  No migrations/dependencies/deployment; unrelated working changes preserved.
  Current task: None. Most recently completed: SALE-CATALOG. Next: None selected.

- **Outlet UI follow-up complete — October 25, 2026:** shared cards and status
  badges, compact add form, suspension confirmation, responsive hours controls,
  time-zone validation and isolated action feedback. Loading/empty/retry states
  added; top-bar selector, permissions and API contracts unchanged. Manual catalogue
  IDs retained because list requests carry selected-outlet context. Focused 40/40;
  full web 786/786 across 94 files; lint/typecheck/production build pass.
  Authenticated browser visual review not performed. Current task: None; next: None.

- **Outlet navigation follow-up complete — October 25, 2026:** moved management
  into Settings → Outlets with `/settings?section=outlets` deep linking and a
  replacement redirect from `/outlets`. Main rail entry removed; top-bar picker,
  outlet APIs and write permissions unchanged. Full web 776/776 across 94 files;
  web lint/typecheck/production build pass. Authenticated visual review not performed.
  Current task: None. No next task selected.

- **DASHBOARD-UX DONE — October 25, 2026:** compact greeting/salon-local date,
  permission-aware sale/appointment shortcuts, daily metric retry/loading states,
  responsive briefing checks and one assistant tool mounted at a time using shared
  keyboard-accessible tabs. Switching tools clears unsaved input; saved drafts persist.
  Full web 771/771 across 93 files; lint/typecheck/production build and changed-file
  formatting/whitespace checks pass. Local dashboard HTTP 200; authenticated visual
  browser review not performed. No backend/database/dependency changes.
  Current task: None. Most recently completed: DASHBOARD-UX. No next task selected.

- **REPORTS-UX DONE — October 24, 2026:** four focused report tabs, four primary
  metrics, salon-local presets, invalid-date guards and expandable valuation audit
  details. Full web 750/750; lint/typecheck/build pass. Authenticated visual browser
  review not performed. Current task: None; no next task auto-selected.

- **PLATFORM-UX DONE — October 24, 2026:** responsive wider operator workspace,
  company directory, separate onboarding view and overview/subscription/modules/activity
  tabs. Suspension/cancellation now require explicit confirmation. Full web 737/737,
  web lint/build/typecheck and platform formatting/whitespace checks pass.
  Authenticated visual browser review remains unperformed; local headless fetch did
  not establish a rendered management view. No API/database/authentication changes.
  Current task: None; next task not auto-selected. Prior work below is preserved.

- Current task: **None**. **MSG-01 DONE** — local SMTP receipt/owner verification,
  fake-provider approved SMS acceptance and truthful assistant-channel UI verified.
  **REG-01 DONE** — messaging suppression fixture and
  platform routing lazy-import timing fixed; full isolated API/web regressions pass.
  **VALUE-01 DONE** for approved local implementation on
  October 24, 2026; rollout remains unauthorized. User approved all seven valuation-policy
  points on October 24, 2026; policy version 1 and implementation plan recorded.
  Exact-cent core and immutable activation/purchase storage implemented and tested.
  Internal activation service and strict SGD confirmation contract now tested.
  Transactional purchase/redemption/void/transfer ledger and expiry helper now wired.
  Company-wide current report API now processes expiry and reconciles evidence.
  Report UI now displays separate active/expired/unvalued and unpaid disclosures.
  Public activation API/UI and expanded lifecycle acceptance now implemented/tested.
  Whole-set/voucher-exclusion/transfer-back/expired-restoration acceptance now passes.
  Reversal/transfer/purchase-void failure rollback and competing void acceptance pass.
  Synthetic 10k unpaid-sale / 500-expiry backlog checks now pass; production scale unverified.
  Migrations disposable-only.
  Most recently completed: **MSG-01**. Earlier **REG-01**, **VALUE-01** and **SESS-01**, whole remaining
  session-package transfer, same-company owner/manager controls and reversal safety.
  Earlier SESS-01 evidence: isolated HTTP acceptance 1/1; package-set/treatment-session acceptance
  2/2; full API 581 pass / 0 fail / 19 opt-in skips; web 716/716, shared 183/183;
  workspace build/typecheck/lint/format pass. All 49 migrations replayed on two
  disposable databases; temporary PostgreSQL stopped. No application migration.
  Next: no task auto-selected; the six-step local priority sequence is complete
  within approved scope. Real integrations/hardware and OA-07 operating inputs
  remain separate. Recorded repository regressions are resolved.
  Latest REG-01: API 592 pass / 0 fail / 24 opt-in skips; web 733/733; shared 187/187;
  build/typecheck/lint/format pass. MSG-01: focused API 59/59, acceptance 4/4,
  full web 734/734 and shared 187/187; build/typecheck/lint pass. #6 complete locally;
  authorized rollout/browser/target-load checks remain separate. Physical printing and rollout
  authorization remain separate; existing HOURS-02 working changes preserved.
- **OA-07 remains BLOCKED** on operational inputs, not acceptance. Outcome/local
  verification and synthetic recovery complete. All acceptance is user-confirmed;
  do not request again. Target/provider evidence and specific retention/security
  operating details remain missing. Recommended next: OA-07 once inputs are available.
- **OA-02** dashboard briefing/evidence workspace owner acceptance recorded.
  **TK2610-0028** multi-outlet disposable acceptance verified October 24.
  Company roles apply at every
  outlet; customers/credit/families and stock quantities remain shared tenant-wide.
- Earlier VERIFY-01: fake-provider HTTP and synthetic backup/restore verified;
  these are historical, not target-data recovery evidence or newly rerun here.
- Earlier outlet/assistant failures are superseded by the full isolated API pass.
  Application prepaid/treatment schema drift remains a separate rollout concern.
- No application migration, deployment, commit or push. Earlier VALUE-01 test run
  may have changed local test-namespaced fixtures; see the exact-cent checkpoint.
  Outlet owner acceptance is user-confirmed; rollout still requires authorized migrations.
- TK2610-0026 remains blocked/deferred. P2 is not entirely complete.
- SaaS onboarding still requires authorized migrations, configured SMTP and
  trusted SALON_PORTAL_ORIGIN; salon and platform login use web port 5173.

## October 24, 2026 — REPORTS-UX reporting workspace complete

- Reused existing accessible Tabs, Button, StatTile and Table components. Overview
  shows net revenue, amount paid, completed sales and refunds; secondary figures
  remain in a compact breakdown. Staff/payments, current balances/valuation and
  independently dated daily close have separate views.
- Added Today, Last 7 days, This month and Custom presets in the salon timezone;
  default is month-to-date. Invalid ranges/daily dates disable queries and hide
  stale figures. Daily close fetches only when selected. Customer balances still
  come from the overview API; an invalid range must be corrected on Overview.
- Kept active/expired/unvalued/unpaid disclosures and activation safeguards.
  Policy/actor/reconciliation evidence is expandable; no financial calculations,
  API contracts, database, permissions or dependencies changed.
- Verification: full web 750/750 across 92 files; lint and production build with
  TypeScript checks pass. Added coverage for timezone boundary presets, invalid
  input, keyboard tabs, on-demand close, audit expansion and stale-error values.
  Initial typecheck caught missing StatTile values and unsupported test options;
  corrected both before the final successful runs. Browser visual review not run.
- No migration, deployment, commit or push. Next: None for this approved cleanup.

## October 24, 2026 — MSG-01 local messaging and assistant verification complete

- Selected the next approved local deliverable after REG-01, not blocked OA-07.
  Reused SEC-01 capture-only SMTP, OA-05 fake sender and OA-06 read-only HTTP
  acceptance. No toolkit/provider connection, live customer, SMTP credentials,
  production change or channel expansion was needed.
- Extended SEC-01 acceptance with cashier-authenticated receipt HTTP requests:
  discounted/split payment sale, stored GST despite changed company settings,
  escaped HTML, unchanged source sale, refund receipt, invalid address/token with
  no send, and SMTP refusal yielding 503 EMAIL_SEND_FAILED. Existing owner/staff
  code enrollment/login/replay/revocation checks also passed through loopback SMTP.
  First fixture attempt lacked catalogue entitlement; corrected fixture and reran
  successfully, without changing production authorization.
- OA-05 acceptance verifies explicit approval, stale/concurrent edits, deduplication,
  exact SMS payload, consent/phone/role/tenant changes, retries, uncertain delivery,
  quota and append-only history. OA-06 verifies HTTP factual/refusal boundaries.
  UI regression explicitly pins SMS-only wording and gated WhatsApp/promotions.
- Verified: SEC-01/receipt 2/2; OA-05 1/1; OA-06 1/1; focused messaging/receipt/
  assistant API 59/59; focused UI 24/24; full web 734/734; shared 187/187.
  Workspace build, explicit typecheck and lint pass. No skips in executed focused
  acceptance/API/UI suites. Full API not rerun; REG-01 592/0/24 remains historical.
- All 51 migrations replayed on three fresh disposable databases using one
  temporary PostgreSQL cluster at each acceptance suite's required loopback port:
  oa05_acceptance 55443, sec01_acceptance 55439, oa06_acceptance 55444.
  Cluster stopped cleanly; all three ports report no response. Final scoped
  formatting and diff checks pass after formatting the new verification guide.
  Captured SMTP is memory-only, not forwarded. Provider payloads use fake sender.
  Added docs/local-messaging-verification.md for rerun commands and limits.
- Evidence: /tmp/msg01-{assistant,email,explanation,api-focused,web-focused,web-full,
  shared,build,typecheck,lint}.log and associated exit files; migration logs under
  /tmp/msg01-*. Temporary evidence is not durable release storage.
- No production implementation/dependency changes; existing regression/valuation
  working changes preserved. No application DB migration, real providers, browser
  walkthrough, deployment, commit or push. Hardware/live delivery and OA-07 inputs
  remain unverified. No next task started.

## October 24, 2026 — REG-01 messaging and portal regression fixes

- Messaging reproduced 24 pass / 1 fail on fresh disposable PostgreSQL. The worker
  correctly defers recently due rebooking during quiet hours before suppression;
  the old fixture assumed immediate processing and used a future completed visit.
  Fixtures now use a completed visit 90 days ago and a job two days overdue, so
  quiet-hour adjustment cannot leave it future-due. Exact job/status/reason/provider
  evidence and no-marketing-send assertions retained/strengthened. Added independent
  current marketing-opt-in withdrawal coverage with zero provider calls.
- Platform baseline passed focused/full (4/4 and 733/733); cold heading took 933 ms.
  Recorded Loading-only failure is consistent with cold lazy-module transform
  exceeding the default DOM timeout. Await real dynamic imports inside React act;
  no portal mock, weakened assertion or global timeout increase. Updated focused
  run passed even with 1188 ms cold import/render; three more 4/4 repeats pass.
- Verification: messaging 26/26; full web 733/733 (92 files); shared 187/187;
  sequential API 592 passed / 0 failed / 24 skipped. Workspace build, explicit
  typecheck, lint, formatting and final diff checks pass.
- Skip accounting: existing opt-in flags were not enabled for this regression run.
  Skipped coverage: outlet foundation/HTTP; valuation storage, activation service/
  HTTP, ledger, lifecycle and synthetic performance; assistant read-only HTTP,
  OA-05/OA-06; SEC-01; COMM-01; SAAS-02/03/04; package expiry/service-set;
  prepaid family/sharing/transfer; session transfer; treatment consent/disposal/
  session linking. Runner reports 24 skipped tests; 25 SKIP lines include the
  skipped valuation-storage suite. None is claimed newly accepted or rerun.
- All 51 migrations replayed on fresh disposable PostgreSQL 18, loopback 55451,
  database regression_two_test. Temporary cluster stopped; port no longer responds.
  Existing valuation working changes preserved. No production code, application
  DB/accounts, providers, migrations to application data, deployment, commit or push.
- Evidence: /tmp/regression-two-{api-baseline,api-focused,api-full,web-baseline,
  web-full-baseline,web-focused,web-full,web-repeat-1,web-repeat-2,web-repeat-3,
  shared,build,lint,format,typecheck,migrations,stop}.log. Temp logs are not durable
  release artifacts. No next task started; #6 remains a separate local deliverable.
- This clean regression supersedes VALUE-01's historical repository-failure notes;
  it does not change valuation rollout, manual browser or hardware limitations.

## October 24, 2026 — VALUE-01 local implementation complete

- User requested a definite finish rather than successive open-ended test increments.
  Rechecked the original TASKS.md completion check: approved policy recorded,
  isolated lifecycle reconciliation verified, and UI distinguishes valued sessions,
  unknown legacy holdings and separate monetary bases. These checks are met.
  VALUE-01 marked DONE for local implementation only; deployment was never authorized.
- Extended synthetic performance fixture adds 10,000 completed unpaid source sales
  (SGD 75 each), 500 expired grants and ten report reads. Verifies SGD 1,000,000
  active net, SGD 50,000 expired net, SGD 750,000 whole-source outstanding and
  exactly 51,500 movements on every refresh (expiry does not duplicate).
- Local loaded report samples: 7370/2824/1149/1109/1265/1084/1151/1177/1260/1459 ms;
  first includes expiry writes. Explicit post-GC heap readings: 47/52/58/63/68/74/
  79/79/79/79 MiB. Baseline 10k-holding reads 2964/2727/2643 ms; competing lock
  observed at 2871 ms. Other checks ran concurrently; timings are environment/load
  dependent. No latency or memory SLO asserted, no production readiness claim.
- Final focused acceptance 10/10; report/activation UI/hook 24/24; shared 187/187;
  workspace build and lint pass, API typecheck pass, format/diff checks pass.
  Full web and repeat: 732 passed / 1 failed, platform-login routing test remains
  on Loading instead of Operator sign in (App.test.tsx:33). Previous full API run
  and repeat: 590 passed / 1 messaging suppression failure / 24 opt-in skips.
  Full API not rerun here; neither full regression is claimed clean. No unrelated
  fixes, disabled checks or weakened assertions. Production code unchanged this increment.
- Follow-up limitations: manual browser walkthrough not performed (no installed
  browser automation dependency); target-hardware/sustained production load and
  authorized migration/rollout remain separate. No later-collection application
  service exists; do not invent that new feature as a valuation completion gate.
  Existing voucher eligibility preserved; package voucher attribution pure tests
  and mixed-sale exclusion integration are covered. No application DB access,
  live activation, migration, deployment, commit or push.
- Evidence: /tmp/value01-close-{performance,acceptance,web,web-retry,web-focused,
  shared,typecheck,lint,lint-all,build}.log. Used previously migrated disposable
  PostgreSQL 18 at port 55462. No new migration replay claimed. Next: None selected;
  known regressions and rollout verification remain documented, not auto-started.

## October 24, 2026 — VALUE-01 rollback and competing void acceptance (partial)

- Expanded existing disposable lifecycle test with tenant-scoped forced failures at
  RESTORE, TRANSFER_IN and PURCHASE_VOID. Deep before/after comparisons cover
  holding, immutable snapshot/movements, projection, sale rows, redemption markers,
  transfer history, outstanding debt, points, performance, commissions and tenant
  audit. Failures leave all compared evidence unchanged; retries reconcile.
- Transfer failure is injected on the second paired movement, after ownership and
  transfer event writes, verifying those and TRANSFER_OUT roll back atomically.
  Purchase-void failure preserves source debt and holding; retry deletes the holding
  while retaining immutable purchase evidence. No production code changes.
- Concurrent duplicate redemption voids create one RESTORE, restore three sessions
  once, retain the winning original reason/actor and ignore a later replacement
  reason. Purchase void versus redemption/transfer with concurrent report permits
  one state-changing winner and a coherent final report; cleanup also reconciles.
- Combined HTTP/ledger/lifecycle acceptance 10/10 passed on previously migrated
  disposable PostgreSQL 18, port 55462. API typecheck/lint/build passed. Verified
  failure trigger/function cleanup (both absent). Full API regression and repeat:
  590 passed / 1 failed / 24 opt-in skips. Existing messaging rebooking-suppression
  test at messaging.service.test.ts:295 expects ALREADY_REBOOKED but receives null;
  same failure reproduced with that messaging suite alone. Root cause unverified;
  not fixed or hidden under VALUE-01. This regression is not a clean pass.
  No web/shared source changes; their suites and the synthetic benchmark not rerun.
  Evidence: /tmp/value01-rollback-{lifecycle,acceptance,api-all,typecheck,lint,build}.log.
  Regression retry and isolated reproduction: /tmp/value01-rollback-api-retry.log
  and /tmp/value01-rollback-messaging.log. Repository format/diff checks passed.
- VALUE-01 remains IN PROGRESS. Next: expiry/debt-heavy reporting and sustained
  memory/lock-load checks, manual browser walkthrough. Prior synthetic measurements
  are not production readiness evidence. Later collection application workflow is
  still unavailable, not fabricated or newly added to scope. Messaging regression
  remains an additional verification issue. No application DB
  access/migration, live activation, deployment, commit or push.

## October 24, 2026 — VALUE-01 remaining lifecycle and synthetic scale (partial)

- Added disposable lifecycle acceptance for whole-service-set purchase/draw valuation,
  transfer back after recipient redemption, exact restoration to the current owner,
  original sale customers, forbidden purchase void despite transfer back, competing
  transfer/redemption/report, mixed-sale voucher exclusion and whole-source debt.
  Post-expiry redemption void restores exact original cents into EXPIRED only;
  retry is idempotent, expired draw/transfer refuse, permitted purchase void retains
  evidence. Combined ledger + HTTP + lifecycle acceptance: 6/6 passed.
- Corrected older forced-failure movement trigger to filter its fixture tenant:
  first parallel acceptance run exposed cross-fixture interference. No application
  logic or assertions weakened; combined parallel run then passed.
- Added opt-in storage-fixture benchmark at 1,000 holdings/5,000 movements and
  10,000 holdings/50,000 movements (grant plus two draw/restore pairs per holding).
  Three report samples: 112/108/83 ms and 580/550/561 ms respectively. Larger sample
  process heap before/after: 229/684 MiB, not isolated peak or retained memory.
  Competing prepaid-lock acquisition observed at 601 ms; scheduling-dependent.
  No performance SLO asserted and no application optimization made.
- Performance test passed, but is NOT production readiness evidence: synthetic
  no-expiry/no-debt fixtures bypass POS setup and original source-sale rows; no
  production concurrency, expired backlog, unpaid-sale fanout, sustained memory or
  target hardware measurement. Current all-evidence read still holds prepaid lock.
- Inspection verified vouchers apply only to SERVICE/PRODUCT, not PACKAGE;
  mixed-sale test confirms the package's immutable value is not reduced. Pure
  allocation already covers nonzero stored voucher attribution. No later receivable
  collection application service exists; end-to-end collection remains unavailable,
  not simulated as a successful workflow and not newly added to scope.
- Checks: full isolated API 591 pass / 0 fail / 24 opt-in skips; acceptance opt-ins
  6/6 and benchmark 1/1 run separately; API typecheck/lint/build and repository
  formatting/diff checks passed. No web or shared source changes, suites not rerun.
  Evidence: /tmp/value01-next-{lifecycle,acceptance,performance,api-all,typecheck,
  lint,build,format}.log. Reused previously migrated disposable PostgreSQL 18,
  port 55462; no migration replay or application database access this increment.
- VALUE-01 remains IN PROGRESS. Next: rollback on valuation failure during reversal/
  transfer, broader void races, expiry-heavy/unpaid-heavy memory and lock-load
  checks, manual browser walkthrough. Production performance and later collection
  workflow remain unverified. No application activation, migration, deployment,
  commit or push.

## October 24, 2026 — VALUE-01 lifecycle acceptance and activation controls (partial)

- Expanded disposable ledger acceptance: held carts excluded until completion;
  repeat completion creates one snapshot; discounted multi-unit purchase stores
  six sessions / SGD 180.00 net / 16.20 original tax / 196.20 gross. Part-payment
  is disclosed separately. Catalogue/session-count/GST-setting edits do not reprice
  snapshots; concurrent redemptions and a report serialize, and reverse-order voids
  restore exact original amounts. Existing transfer/expiry/corruption checks retained.
- Added POST /api/reports/package-valuation/activation using reports entitlement,
  enabled owner/manager role and writable-tenant middleware plus existing locked
  service checks. HTTP acceptance covers unauthenticated/unentitled/staff/unverified
  owner/suspended/disabled refusals, spoofed fields and bad confirmation, concurrent
  identical retries, conflicting reason, single tenant-filtered audit and isolation.
- Reports offers one-time SGD/policy-1 confirmation with required reason, explicit
  no-backfill/immutable/server-time disclosure, role/read-only gating and pending
  lockout. No automatic mutation retry; success/error invalidates current evidence.
  Activated reports display immutable actor/reason. Refresh failures still hide values.
- Verified: disposable acceptance 2/2; full API 591 pass / 0 fail / 22 opt-in skips
  (acceptance opt-ins tested separately); full web 733/733, shared 187/187; focused
  web 24/24 rerun after evidence display. Workspace typecheck/lint/build passed.
  Initial failures corrected: fixture DB role and snapshot field name; HTTP expects
  existing auth's 401 for owner without 2FA; audit counts require explicit tenantId.
  No production assertions or safeguards weakened.
- Evidence: /tmp/value01-{lifecycle,acceptance,api-all,web-all,web-focused,shared,
  typecheck,lint,build}.log. Reused previously migrated disposable PostgreSQL 18 at
  port 55462; no new migration replay claimed. No application DB access, application
  salon activation, migration, deployment, commit or push. Prior working changes kept.
- VALUE-01 remains IN PROGRESS. Remaining acceptance includes whole service sets,
  voucher-attributed discount integration, later receivable collection, transfer-back,
  post-expiry restoration and broader conflicting-action races. Large-tenant locked
  report performance and manual browser walkthrough remain unverified.

## October 24, 2026 — VALUE-01 report UI (partial)

- Added independent PackageValuationPanel on Reports, validated current-report hook
  and reports-prefixed query key. Existing sale invalidation also refreshes valuation.
- Company-wide/outlet-independent scope, separate snapshot timestamp, policy/currency/
  activation boundary, active and expired net/original-tax/gross, unvalued counts and
  unpaid whole-source-sale disclosures. No mixed-basis grand total or activation UI.
- Loading/inactive/error states never substitute zero. Failed refresh hides cached
  valuation while other report panels remain usable. Explicit refresh is available.
  Bigint whole-unit formatting preserves exact cents even above Number's safe range.
- Full web regression: 724/724 across 91 files. Focused report/hook 15/15; web
  typecheck/lint/production build and format/diff checks passed. Tests cover scope,
  separate values, incomplete legacy evidence, inactive/loading/error/refresh,
  large exact values, response validation and report-prefix invalidation.
- No browser/manual visual walkthrough performed. No database access or migration
  needed this increment. Earlier API 598/shared 187 results were not rerun here.
- Remaining: wider lifecycle/discount/tax/multi-unit acceptance, public activation
  controls and large-tenant performance verification. VALUE-01 stays IN PROGRESS.

## October 24, 2026 — VALUE-01 current report API (partial)

- Added authenticated reports-entitled GET /api/reports/package-valuation and shared
  contract. Current company-wide snapshot drops only outlet scope, samples database
  time after the prepaid lock and processes due expiry in the same transaction.
- Reconciles immutable movement amounts, quantities and signed ordinal boundaries
  per purchase/customer/bucket against projection and operational holdings. Fails
  closed with VALUATION_RECONCILIATION_FAILED; failed reports roll expiry back.
- Reports active/expired net, original tax and gross separately; unknown legacy
  active/expired counts remain unvalued. Known zero counts as valued. Discloses
  whole source-sale receivables once, without inventing mixed-sale cash allocation.
  Existing sales, GST, receivables and prepaid/gift totals are unchanged.
- Verified full isolated API: 598 passed / 0 failed / 20 opt-in skips; shared 187/187.
  API build/typecheck/lint and shared build/lint passed. Focused HTTP/lifecycle tests
  cover auth/entitlement, no activation/backfill, transferred owner, outlet-independent
  totals, exact ordinal corruption, repeat/concurrent reports and report expiry.
- Additional acceptance verifies expiry rollback on failed reconciliation and voiding
  an expired unused purchase. Corrected a test fixture that expired during grant
  instead of during report; final full regression rerun passed. Disposable cluster
  stopped after testing; log: /tmp/glampro-value01-ledger-evctm2fu/report-full-api-final.log.
- Remaining: report UI, public activation controls, wider discount/tax/multi-unit and
  concurrent lifecycle acceptance. Current implementation reads full tenant evidence
  under the prepaid lock; bounded large-tenant performance remains unverified.
- VALUE-01 remains IN PROGRESS. Disposable port 55462 only; no application migration,
  deployment, commit or push. Earlier local test-fixture disclosure remains above.

## October 24, 2026 — VALUE-01 transactional ledger (partial)

- Added migration 20261024220000_package_valuation_movements: tenant-bound mutable
  ordinal/ownership projection plus append-only signed bucket evidence with unique
  source keys, reconciled bigint net/tax/gross, stable ranges and system expiry actor.
- New package-valuation-ledger.ts writes immutable purchase snapshots and grants from
  completed sale holdings; redemptions, exact void restorations, paired transfers and
  purchase voids commit with existing POS transactions under prepaid lock order.
  Snapshot-less legacy holdings stay unvalued. Redemption restoration uses current
  valuation owner after transfer. Purchase void evidence survives holding deletion.
- Idempotent expiry helper moves remaining ordinals between active/expired buckets
  effective at original expiry, without staff attribution. It is NOT yet connected
  to a report transaction/job. No public activation controls or report changes yet.
- New isolated POS test covers unpaid contracted value, no legacy backfill, purchase
  retry, exact-cent redemption/restoration, transfer conservation/current-owner
  restoration, forbidden purchase void after transfer, allowed source deletion,
  immutable movement edits, repeated expiry and forced movement failure rolling back
  sale, snapshot and receipt counter. Expanded lifecycle/tax/discount races remain.
- All 51 migrations replayed on fresh disposable PostgreSQL 18 port 55462. Initial
  focused 20/20; final full API 597 passed / 0 failed / 20 opt-in skips (activation
  acceptance requires its separate port 55461; previously verified, not rerun here).
  Prisma validate/generate, API build/typecheck/lint, formatting/diff passed.
  Temporary cluster stopped. Logs: /tmp/glampro-value01-ledger-evctm2fu/
  {migrations-verified,api-tests-verified,stop}.log.
- Intermediate regression failures: fixture incorrectly declared packages core,
  polluting reused disposable DB; first correction patch landed in wrong fixture
  field. Corrected actual lines, checked typecheck, recreated disposable database
  and replayed migrations before final clean pass. No assertions weakened.
- Still IN PROGRESS. No application DB migration/access, deployment, commit or push.

## October 24, 2026 — VALUE-01 internal activation service (partial)

- Added shared strict activation contract and internal package-valuation.service.ts.
  Explicit policy 1 / SGD / confirmation / bounded reason only; rejects submitted
  actor, tenant, id and effective time. SGD is explicitly confirmed for future
  purchases, not inferred from billing currency or used to backfill older holdings.
  Arbitrary currency selection is excluded while POS display remains SGD-only.
- Activation service requires authenticated scope actor, rechecks enabled owner/
  manager (owner 2FA), tenant and subscription write status under shared prepaid →
  tenant → actor locks. Database UTC clock sampled after lock acquisition establishes
  activation boundary. Activation and audit commit together. Same actor/input retries
  return original evidence; conflicting confirmations reject without replacing it.
- Deliberately NOT exposed through routes/UI until atomic sale/ledger integration
  works. Exposing it now would let users activate a reporting boundary while sale
  grants are not recorded. No application salon activated and no legacy backfill.
- New isolated service test verifies permissions, scope spoofing, suspension/expired
  subscription, USD billing versus confirmed SGD purchase currency, retry/race,
  verified owner, shared POS lock, no backfill and rollback on forced audit failure.
  Shared tests 185/185; focused database/storage/allocation/tenancy 20/20; full isolated
  API 597 pass / 0 fail / 19 unrelated opt-in skips. All 50 migrations replayed on
  disposable PostgreSQL 18 at port 55461; stopped normally. API/shared build and lint,
  API typecheck, formatting and diff checks pass. No web files changed/tested here.
  Evidence: /tmp/glampro-value01-activation-1eykj5go/{migrations,focused,api-tests,stop}.log.
- Still IN PROGRESS: next implement movement evidence, purchase/redemption/void/
  transfer writes and expiry reconciliation; expose activation only once safe.
  No application migration, database access, deployment, commit or push this checkpoint.

## October 24, 2026 — VALUE-01 immutable purchase-storage foundation (partial)

- Added PackageValuationActivation and PackagePurchaseSnapshot with tenant scoping
  and migration 20261024210000_package_purchase_valuation. Activation explicitly
  records currency, policy version, actor, reason and boundary; no default currency,
  activation inserts or legacy backfill. New purchases will reference that evidence,
  not subscription billing currency. No salon has been activated by this work.
- Snapshots preserve original source ids without holding/customer/sale cascades,
  bigint net/tax/gross cents, quantity, original expiry and purchase/recording times.
  Database checks enforce reconciled nonnegative amounts, positive quantity,
  source uniqueness and matching tenant activation/currency/policy/recording boundary.
  Append-only triggers forbid updates/deletes except tenant-removal cascades.
- Added opt-in storage tests (PACKAGE_VALUATION_STORAGE_TEST=1) for cross-tenant
  references and reads, unscoped refusal, exact amounts, known zero, retry uniqueness,
  raw-SQL immutability, rollback and tenant cascade retention behavior. Test source
  ids intentionally need not have live source rows; future write service must validate
  tenant source provenance in the transaction before writing snapshots.
- Fresh PostgreSQL 18 replayed all 50 migrations at disposable port 55460. Focused
  storage/allocation/tenant registration 19/19; full isolated API 596 passed, zero
  failures, 19 unrelated opt-in skips. Prisma validate/generate, API typecheck/lint,
  build (including shared build), formatting and diff checks passed. Cluster stopped.
  Evidence: /tmp/glampro-value01-storage-oyx853tt/{migrations,focused,api-tests,stop}.log.
- Prisma schema-drift comparison exits 2 for older assistant/commission/prepaid/
  treatment tables' FK/index differences. Neither new valuation table appears in the
  diff. Unrelated pre-existing drift was not changed; schema-drift check is not a pass.
- Still IN PROGRESS: no activation API/workflow, sale grant/redemption/void wiring,
  movement ledger, expiry job or report changes yet. No application DB connected in
  this checkpoint, no application migration, deployment, commit or push.

## October 24, 2026 — VALUE-01 exact-cent allocation core (partial)

- Added apps/api/src/lib/package-valuation.ts and its test file. Strict exact decimal
  conversion to bigint, consideration after voucher only, independent net/tax
  allocation, compact one-based ordinal ranges, lowest-available draws and exact
  restoration. Rejects invalid/overlapping evidence instead of silently repairing it.
  No one-row-per-session expansion; input evidence is not mutated.
- Nine new tests cover approved examples, known-zero versus missing evidence,
  invalid amounts/ranges, tax rounding, out-of-order restoration, large grants and
  1,275 grant/draw/restoration conservation scenarios. Focused expiry/allocation
  14/14. API typecheck, lint and build (including shared build) passed.
- Full isolated API: 590 passed, 0 failed, 19 opt-in skips. All 49 existing migrations
  replayed on fresh PostgreSQL 18 at port 55459; no new migration. Disposable cluster
  stopped normally. Evidence: /tmp/glampro-value01-npdm241p/{migrations,api-tests,stop}.log.
- Initial full API invocation unintentionally used configured local database through
  dotenv; failed on existing missing services.interval. Test fixture setup/cleanup
  may have changed test-namespaced rows there; no migration ran against it. This was
  not an isolated run and is not claimed safe application-data verification. Later
  rerun explicitly used disposable DATABASE_URL. First disposable migration attempt
  refused a matching shadow URL; corrected to a separate disposable shadow database.
- Currency integration still unresolved: Sale has no currency field; web formatting
  hardcodes SGD and subscription currency is billing evidence only. Do not infer
  historical currency. Next: establish explicit purchase-currency source and add
  tenant-scoped immutable purchase/movement models and transactional integration.
- VALUE-01 remains IN PROGRESS. No report change, new schema, deployment, commit
  or push. These helpers are not yet wired into sales; monetary reporting is not ready.

## October 24, 2026 — VALUE-01 policy approved; implementation planned

- User explicitly approved the draft's seven points. Recorded policy version 1 in
  docs/package-valuation-policy-draft.md, retaining its path for existing references.
- Removed the policy blocker and started implementation planning. Inspected report
  API/contracts/UI, purchase grants, redemption and void paths. Purchase void deletes
  holdings, so valuation evidence must survive ordinary holding deletion. Redemption
  currently records counts, not exact-cent ordinal allocations.
- Plan: docs/package-valuation-implementation.md. Original-currency evidence must
  be verified before valuing existing holdings; subscription currency is not evidence
  of sale currency. No invented backfill or inferred cash allocation is authorized.
- This checkpoint changes documentation only. No functional tests rerun; no schema,
  migration, application behaviour, application database, deployment, commit or push.
  VALUE-01 is not DONE. Continue the same task before selecting another deliverable.

## October 24, 2026 — VALUE-01 initial assessment (superseded policy blocker)

- Selected #5 after SESS-01. Inspected saved decisions, package purchase snapshots
  and report API/UI. No approved monetary allocation policy found. Existing report
  explicitly labels unexpired session counts as operational, not full accounting
  valuation, and excludes session packages from monetary totals. Preserved this.
- Recorded VALUE-01 BLOCKED pending allocation, discounts/GST/rounding, unpaid
  purchases, redemption/void, expiry, transfer, legacy-data and reporting-period
  rules. No application code/schema changes or new functional test run claimed.
- Next: user supplies approved policy or explicitly defers #5 to select #6.
- User requested a concrete draft before implementation. Created
  docs/package-valuation-policy-draft.md with proposed rules and worked examples.
  No accounting-policy approval inferred. VALUE-01 remains BLOCKED on review;
  application behaviour unchanged. Draft includes unpaid purchases, stored-tax
  allocation, exact-cent restoration, expiry and incomplete legacy evidence.

## October 24, 2026 — SESS-01 complete: whole session-package transfer

- Added tenant-scoped append-only session transfer events and migration
  `20261024200000_session_package_transfer`; strict shared contracts, paginated
  holding/history routes, owner/manager transfer and customer-profile controls.
  Same-company active customers only; whole remaining holding, unchanged expiry,
  purchase line, quantity and rule snapshots. No partial transfers or monetary policy.
- Transfer shares POS advisory/holding lock order. Rechecks enabled actor/current
  role/owner verification, effective subscription/write state, archived customers,
  current ownership/version, positive valid balance and expiry inside transaction.
  Ownership/evidence commit atomically. Purchase void refused after any transfer,
  including return to buyer. Existing package purchase/redemption refund exclusions
  retained. Redemption void restores same holding under current owner once only.
- Kept original-customer treatment evidence linkable after ownership transfer,
  without exposing the old customer's visit to the recipient. Clinical/sale customer
  identities remain unchanged. Service-set purchase rules survive catalogue edits.
- Fresh replay of all 49 migrations on disposable PostgreSQL port 55448 database
  session_transfer_test, plus second fresh database package_expiry_test on 55440.
  New HTTP/database acceptance 1/1, no skips; existing package-set/treatment-session
  acceptance separately enabled 2/2, no skips. Covers permissions, cross-tenant
  refusal, stale/duplicate/racing writes, expiry/archive, reports, exact-source
  reversals, purchase-void race, service sets, treatment links, immutable evidence
  and forced audit-write failure rollback. Temporary cluster stopped normally.
- Final sequential API: 581 passed / 0 failed / 19 opt-in skips (three separately
  enabled above; remaining 16 are not newly verified). Web 716/716 in 90 files;
  focused transfer/profile 17/17, shared 183/183. Workspace build/typecheck/lint,
  formatting and diff checks pass. Existing pg concurrent-query deprecation remains.
- Initial new-test failures: cashier fixture lacked web-login email, history URL
  typo and report comparison included independent snapshot timestamp. Corrected
  fixtures/asserted balances separately; clean fresh replay final acceptance passes.
  No production/app data, providers, deployment, commit or push. UI verification is
  automated components, not interactive browser UAT. Existing outlet-hours edits
  preserved. Docs: docs/session-package-transfers.md; logs /tmp/glampro-sess01-*.
- Next: #5 requires approved allocation/discount/refund/expiry/transfer valuation
  policy; do not invent it. Alternatively select remaining #6 local messaging scope.

## October 24, 2026 — HOURS-02 complete: browser checks and heading correction

- Captured list requests/responses: October 24 Auckland window was correct, but
  heading showed October 25 because the already-local Date was formatted as an
  instant again. Earlier walkthrough then booked the following day. Fixed
  Appointments.tsx subtitles with date-only keys for day/week/month; no API/query
  or persisted booking behavior changed. Added two page regressions and corrected
  existing fixture/comparison host-timezone assumptions found by cross-zone tests.
- Ten browser assertions passed: top-bar switching/confirmation/persistence,
  correct heading, next-day series visibility, saved branch clock, closed-day
  reschedule refusal, valid reschedule/reload, branch filtering and consolidated
  branch editing. CDP stall was the unanswered confirmation dialog, not an app hang.
- Verified full web 706/706 across 89 files (two workers), page 11/11 under both
  Los Angeles and Auckland; web build/typecheck/lint and formatting pass. Initial
  default-worker full run had one unrelated lazy-route timeout; bounded-worker
  rerun passed unchanged. Prior public/API walkthrough evidence remains recorded.
- Evidence: /tmp/hours02-{investigate.log,finish-results.json,finish.log,
  web-tests-final.log,los-angeles.log,auckland.log,build.log,types.log,lint.log}.
  Application database/providers untouched; no dependencies, deployment, commit
  or push. No next development task selected; rollout authorization still required.

## October 24, 2026 — HOURS-02 disposable browser walkthrough partial (superseded)

- User selected disposable-only browser verification. Application database,
  accounts and real providers untouched. All 48 migrations replayed on fresh
  PostgreSQL 18 port 55447; local API/web and headless Chrome used synthetic data.
- Browser override/reset persistence, public branch selection/Auckland slots,
  successful booking and closed-day message passed. Branch editor timezone,
  closed-day refusal and three-occurrence creation passed. Public/live API runner
  completed 16 assertions including staff conflicts, hours enforcement, series
  identity, legacy edits/filtering and non-scheduling edits after hours changes.
- Still IN PROGRESS: top-bar switch and UI rescheduling need completion. Initial
  CDP navigation/switch stalled; fresh tab rendered. Branch list remained empty
  after current-local-day series creation/reload. Capture list ranges and responses
  before diagnosing; no source defect established or application fix attempted.
- Harness corrections: CORS for isolated origin, seed join fields, asynchronous
  slot waits, unique public emails and refreshed disposable access token. These
  are setup corrections, not product regressions. Logs/screenshots: /tmp/hours02-*.
- Temporary API/web/Chrome and stalled CDP runner stopped; disposable PostgreSQL
  stopped successfully. No application migration, deployment, dependencies, commit
  or push. Next: resume HOURS-02 investigation, not rollout or hardware acceptance.

## October 24, 2026 — HOURS-01 branch booking and hours complete locally

- Inspected company-hours service, outlet contracts/routes/UI, public-booking
  availability, appointment models/service and saved architecture decisions.
- User approved full enforcement after the previous branch-calendar exclusion was
  explained. Stored appointment outlet is fixed at creation (including series);
  null/legacy rows remain company-wide. Staff/resource conflicts and shifts stay shared.
- Added outlet full-week hours/reset UI/API, strict valid clock values, tenant-bound
  nullable appointment FK/index, public outlet selection and effective local hours,
  create/reschedule/reactivation checks, calendar/editor branch clock and message
  branch identity/time. Receipts/reports keep company formatting. Existing hours edits
  do not move bookings; comment/customer/status completion/cancellation stay possible.
- Files: shared outlet/settings/appointment schemas; API schema/migration,
  booking-hours/outlet/appointment/public-booking/settings/quiet-day/message-worker;
  web outlet editor, public booking, calendar/form and booking-formatting hook;
  regression tests; PROJECT.md and docs/outlet-booking-hours.md.
- Verified 48 migrations replayed on fresh disposable PostgreSQL 18 port 55446;
  full sequential API 581 passed / 0 failed / 18 opt-in skips; web 704/704 across
  89 files; shared 181/181. Workspace build/typecheck/lint/format and diff checks pass.
  Initial API run exposed a DST mock returning inconsistent tenant zones; fixture
  corrected without weakening assertions, then full suite rerun successfully.
- Disposable cluster stopped; application database/accounts/providers untouched.
  No dependencies, deployment, commit or push. Logs: /tmp/glampro-hours01-api.log,
  /tmp/hours01-{web,shared,build,types,lint-final,format-check}.log.
- Next: authorized application migration and browser branch-booking walkthrough;
  hardware receipts and OA-07 operational evidence remain separate. No next task started.

## October 24, 2026 — PRINT-01 thermal receipt layouts complete locally

- Standard default retained; selectable 80/58 mm previews reuse server-backed
  ReceiptView. Added stored GST registration, long-name wrapping, monochrome print
  styles and unrelated-content isolation without absolute positioning. Totals,
  tenders, tax, refunds/voids and email content calculations unchanged.
- Files: apps/web/src/components/sale/ReceiptView.tsx and ReceiptView.test.tsx,
  apps/web/src/styles/receipt-print.css, apps/web/src/index.css,
  docs/thermal-receipts.md; TASKS.md/PROGRESS.md preserve prior VERIFY-01 changes.
- Verified focused receipt/POS 52/52, full web 697/697 (87 files), web production
  build/typecheck and lint. Headless installed Chrome, compiled CSS and synthetic
  45-line receipts: standard/80/58 mm previews have no horizontal overflow; PDFs
  retain first/last lines, stored GST and refund details, exclude app chrome and
  controls. At 58 mm GST wraps but normalized PDF text retains its full value.
- Initial temporary fixture exporter used a Vite-transformed URL unsupported by
  node:fs; corrected to filesystem path and reran successfully. Temporary test
  removed. No dependency added, database/provider operation, deployment or commit.
- PDFs use Chrome default sheets, not configured thermal paper. Physical printer
  margins, feeds/cutting and readability remain unverified. Driver owns paper size;
  instructions request matching width, 100% scale and disabled headers/footers.
- Logs: /tmp/print01-{focused,build,lint,web}.log; HTML/PDF checks in
  /tmp/print01-{standard,80,58}.{html,pdf}. Temp artifacts are not durable evidence.
- Next: assess per-outlet hours as extension of TK2610-0007; not started.
  OA-07 operational gates and accepted accounting/transfer limitations unchanged.

## October 24, 2026 — VERIFY-01 local regression verification complete

- Fresh workspace build, typecheck, lint and root formatting checks all pass.
- Shared 179/179; web 693/693 across 86 files; full sequential API 576 passed,
  0 failed, 18 explicit opt-in acceptance skips. Existing route/service coverage
  exercises appointments, consent, receipts, package/prepaid redemption, split
  tenders, refund/void accounting, stock and tenant/role refusals.
- Replayed all 47 migrations on a new disposable PostgreSQL 18 cluster at loopback
  port 55445, database verify01_test. Cluster stopped successfully; application
  database, accounts and real providers untouched. No browser/printer walkthrough
  or separate opt-in acceptance rerun claimed. Existing user acceptance preserved.
- No regression reproduced and no application code changed. Only TASKS.md and
  PROGRESS.md updated. Test logs emitted non-failing PostgreSQL concurrent-query
  deprecation and npm unknown-config warnings; these are not test failures.
- Evidence: /tmp/glampro-verify01-{build,migrations,types,lint,shared,web,api,format}.log
  and matching exit files; /tmp/glampro-verify01-stop.log confirms shutdown.
  Temporary logs are not durable release evidence. No deployment, commit or push.
- Next local recommendation: dedicated thermal receipt layout and preview checks;
  hardware validation remains separate. OA-07 operational blockers unchanged.

## October 24, 2026 — MAINT-01 dependency security and health complete

- Fresh baseline: 20 affected packages (2 critical, 11 high, 7 moderate), seven
  formatting failures. Applied compatible audit fixes without --force; aligned
  Vitest/coverage minimums at ^4.1.12. Removed unused ExcelJS after repository-wide
  usage search, rather than downgrade ExcelJS or override UUID across major versions.
- Deduplicated dependencies to repair invalid fdir/picomatch peer resolution.
  Final npm ls --all exits 0; full and production-only npm audit both report **0**.
  Intermediate install summary said zero while fresh audit still found ExcelJS/UUID;
  final status is based on separate completed audit reports after removal/dedupe.
- Prettier-only changes in seven flagged files, verified byte-for-byte against
  formatted HEAD. No behavior or SQL migration edits; earlier OA-07 edits preserved.
- Checks: workspace build/typecheck/lint, root formatting and diff checks pass;
  web **693/693**, shared **179/179**, focused coverage smoke **10/10**. Full
  sequential API **576 passed / 0 failed / 18 opt-in skips** with all **47 migrations**
  replayed on fresh disposable PostgreSQL port 55444. Cluster stopped, port closed.
- Logs: /tmp/maint01-{build,types,lint,shared,web,api,coverage,format-final}.log;
  /tmp/maint01-audit-verified.json, /tmp/maint01-audit-prod-verified.json,
  /tmp/maint01-tree-verified.txt. Web tests emitted missing optional xclip/xsel notices
  but passed. Node 24.21.0; no application data, live provider or deployment changed.
- DONE locally. No commit/push or next task started. OA-07 and deferred PSG task
  remain blocked; this maintenance does not close operational release gates.

## October 24, 2026 — OA-07 resumed verification and operational handoff

- Refreshed full sequential API: **576 passed, 0 failed, 18 opt-in skips** against
  fresh disposable PostgreSQL; web **693/693**, shared **179/179**, workspace build
  and lint pass on Node 24.21.0. Initial API attempt used unreachable loopback and
  failed database-required suites; the isolated rerun passed without weakening tests.
- Replayed all **47 migrations**; live OA-05/OA-07 service/HTTP acceptance **1/1**
  with injected fake sender. Route-login email uses the existing JSON capture mock.
- Rehearsed custom-format pg_dump/pg_restore of synthetic fixtures into a separate
  disposable DB: 21 drafts, 65 events, 20 jobs; all table-content hashes, counts and
  trigger definitions match. Append-only UPDATE guard verified on source/restored DB.
  One existing booking CHECK deparses with equivalent AND parentheses after restore;
  raw constraint hashes differ and were reviewed, not reported identical.
- Corrected initial integrity query to use mapped SQL table names. No application
  DB/accounts or real provider accessed. Disposable cluster stopped cleanly; port
  55443 no longer listening. No deployment, commit or push.
- Expanded docs/owner-release-readiness.md with HOLD decision, gate/responsibility
  matrix, data-handling inventory, accepted-UAT clarification and recovery evidence.
  Preserved earlier acceptance edits. No application implementation change needed.
- Evidence: /tmp/oa07-resume-api-isolated.log, /tmp/oa07-resume-web.log,
  /tmp/oa07-resume-shared.log, /tmp/oa07-resume-build.log,
  /tmp/oa07-resume-lint.log, /tmp/oa07-resume-http.log,
  /tmp/oa07-resume-restored-guards.log. Temp evidence is not durable release storage.
- **BLOCKED:** missing target/operator/artifact/window/recovery objectives, specific
  retention/security operating record and real-provider/target recovery evidence.
  Acceptance is complete; do not request it again. Resume OA-07 when these inputs
  and separately scoped operational authorization are available. No next task started.

## October 24, 2026 — All required acceptance confirmed

- User confirmed all required acceptance is already complete, including outstanding
  owner UAT/sign-off requests and acceptance of disclosed scope and limitations.
  This supersedes historical pending-acceptance notes across the tracker.
- Acceptance is user-reported, not a new agent browser/test/provider verification.
  No specific new retention/security policy details were supplied. Operational work,
  provider evidence and blocked/deferred deliverables are not marked performed.
- Updated TASKS.md and docs/owner-release-readiness.md to separate accepted scope
  from unexecuted release work. No application code/data or deployment changed.
- Verification: documentation reviewed; no application tests needed for this
  tracking-only update. OA-07 remains IN PROGRESS for non-acceptance follow-ups.

## October 24, 2026 — OA-07 outcomes implemented; release gates remain

- Added shared validated outcome contract, read-only tenant-scoped draft outcome API
  and on-demand dashboard observations. Explicit queue-time half-open UTC window,
  capped at 30 elapsed days; current same-customer booking/receipt counts, not causal
  conversions, incremental revenue or uplift. Overlapping drafts cannot be summed.
- Provider acceptance/uncertainty never confirms delivery; unqueued drafts have null
  observations. Sales entitlement controls receipt reads. Reuses existing current
  owner/manager/active-tenant/module gates; explicit tenant predicates and no-store
  draft routes. Outcome cache keys include tenant/user; failed refresh hides facts.
- Added docs/owner-release-readiness.md: usage/cost/storage/distributed-rate limits,
  failure recovery, audit/capability privacy, retention/export/disposal decisions,
  realistic owner UAT and separately authorized rollout/recovery/provider evidence.
  No deletion policy or operational/legal compliance is invented. OA-07 stays open.
- Verified: full web **693/693** (86 files, two workers), shared **179/179**, focused
  API outcomes/explanations **13/13**, extended OA-05 live service/HTTP **1/1** with
  fake sender. Includes real same-customer booking/receipt observations, foreign
  tenant refusal, no-store and existing approval/quota/uncertain/retry regressions.
  Workspace build passed; final API/web typechecks, workspace lint, scoped formatting
  and diff checks pass. Full API suite not run. Disposable PostgreSQL stopped cleanly.
- Replayed all **47 existing migrations** on fresh disposable loopback 55443/oa05_acceptance;
  no new migration. Initial PostgreSQL startup failed on default socket permissions;
  used private temp socket directory, then clean fixture replay and acceptance pass.
  No application database, real provider, browser UAT, deployment, commit or push.
- Evidence: /tmp/oa07-http-final.log, /tmp/oa07-migrations-final.log,
  /tmp/oa07-api-final.log, /tmp/oa07-web-final.log, /tmp/oa07-shared.log,
  /tmp/oa07-build.log, /tmp/oa07-lint.log. Remaining: owner UAT/sign-off, named
  retention/security decisions, actual provider/cost and operational restore/recovery
  readiness evidence. No later task started.

## October 24, 2026 — OA-06 bounded explanations complete locally

- Added owner/manager dashboard Q&A and read-only `/ai-assistant/explain` POST.
  Nine fixed English questions use an exact normalized allowlist, not general NLP.
  Metric answers reuse ownerMetrics, with explicit salon-local period controls,
  half-open UTC window/timezone/as-of evidence, decimal strings and entitled links.
  Rebooking/quiet-day questions explain policy only and direct to existing panels.
- Strict shared request/response validation; ambiguous questions clarify, unsupported
  instructions/restricted-data/actions refuse, fact-source failure returns unavailable
  without cached facts/fabricated zeroes/internal errors. No arbitrary SQL, personal
  or clinical data, external language provider, migration, saved history or actions.
- 300-character question/3,000-character response, at most 31 custom calendar days,
  20 requests/company/user/15 minutes per process. In-memory quota is not distributed.
  No model spending. UI clears results on changed question/period or lost identity/
  role/modules, validates responses and never keeps prior facts after refusal/error.
- Verified: full web **688/688** (86 files, two workers), shared **177/177**, focused
  API **32/32**, disposable PostgreSQL/HTTP **1/1**. HTTP verifies real tenant-separated
  facts, role/module/disabled/closed-account refusals, strict bounds/injection refusal,
  no-store, independent rate budgets, no draft/message writes. Unit tests cover DST,
  exact windows/decimals/negative net/empty days and fact-source failures. Production
  build (API/web typechecks), workspace lint and scoped format/diff checks pass.
- Initial normalization test caught trailing-space handling; trimmed before stripping
  punctuation and reran. Initial parallel web typecheck preceded shared build; rerun
  after shared build and complete production build pass. No assertions weakened.
- Existing **47 migrations** replayed on fresh disposable loopback port 55444/database
  oa06_acceptance. No new migration/application DB access. No full API suite, browser
  UAT, real provider call, deployment, commit or push. Docs: docs/owner-explanations.md.
- Logs: /tmp/oa06-api-final.log, /tmp/oa06-http-final.log, /tmp/oa06-web-full.log,
  /tmp/oa06-shared-final.log, /tmp/oa06-build.log, /tmp/oa06-lint-final.log.
- OA-07 next ready; not started. Owner walkthrough, optional provider decision and
  multi-instance operational budgets remain separately gated.
- Cleanup: fixture tenant count is zero; disposable PostgreSQL cluster stopped.

## October 24, 2026 — OA-05 draft approvals and controlled SMS delivery complete locally

- Approved SMS-first; WhatsApp/promotions gated; manual retention review due after
  30 days with no automatic deletion; 20 assistant queue entries/company/local day.
- Added persisted versions, exact SMS body/sender/recipient preview, explicit approval
  and idempotent queue actions, unique draft/job relationship, stale/concurrent edit
  guards, append-only audit snapshots with paginated UI/API history and retention
  review reason/reviewer/next date. Edits invalidate approval. Queued content cannot
  be edited through these APIs. No new main navigation or external AI provider.
- Worker uses saved body unchanged, shares existing cross-channel contact history,
  rechecks actor/tenant/module/consent/destination/interval/booking/link/sender state,
  preserves uncertain outcomes and definite-rejection backoff without blind resends.
- Verified: full web **678/678** (85 files, two workers), shared **175/175**, focused
  API **25/25**, live messaging regressions **25/25**, OA-05 disposable PostgreSQL/HTTP
  acceptance **1/1**. Live acceptance covers edit races, duplicate queueing, exact
  provider payload, opt-out/phone/role/tenant changes, quota, retry/uncertainty,
  audit mutation refusal, retention review, pagination and HTTP auth/module refusal.
  Workspace lint and production build (including API/web typechecks) pass.
- All **47 migrations** replay from empty on a newly initialized disposable loopback
  cluster, port 55443. New migration `20261024120000_assistant_draft_approvals` only
  applied there. Application database/accounts untouched. No real provider calls,
  full API suite, browser owner UAT, deployment, commit or push claimed.
- Initial fixture type errors corrected; lint fast-refresh constant moved to its
  own module. Expanded HTTP test corrected to use a valid action body so it reaches
  tenant-state refusal, rather than failing schema validation. Checks rerun.
- Docs: docs/owner-draft-delivery.md. Logs: /tmp/oa05-acceptance-verified.log,
  /tmp/oa05-messaging-regression.log, /tmp/oa05-api-focused.log,
  /tmp/oa05-web-full-final.log, /tmp/oa05-shared-tests.log,
  /tmp/oa05-lint-final.log, /tmp/oa05-build-final.log.
- OA-06 is next ready; not started. Retention disposal/export and real-provider
  operational readiness remain OA-07/release gates, not silently approved here.
- Disposable cluster stopped after checks; pg_ctl confirms no server running.
  Final changed-file formatting and git whitespace checks pass.

## October 24, 2026 — OA-04 future quiet-day opportunities complete locally

- Added guarded read-only `/ai-assistant/quiet-day-opportunities` and dashboard
  workspace with explicit paginated service selection, retry/loading/qualified empty
  states, exact timezone/window/as-of evidence and partial-search warnings.
- Screens tomorrow through seven local days with <3 non-cancelled booking starts;
  uses shared public-booking context/hours and actual appointment checker. Returns
  at most one opening/day, checks at most ten staff and 120 staff/slot combinations.
  No utilisation/profit/demand inference or reservation. Existing historical promo
  API remains separate and backward compatible.
- No approved discretionary assistant discount ceiling: only regular-price/0%
  suggestions, enforced by shared contract; discount query fields refused. No
  voucher/offer/member/package changes or stacking, recipients, saved drafts,
  approval, activation, new main navigation, migration or outbound delivery.
- Verified: focused API **24/24** (including seven quiet-day checks for shift/break,
  conflict/resource exclusion, DST, fallback, bounds and failure propagation);
  shared **174/174**, full web **671/671** across 84 files (two workers), disposable
  HTTP **1/1**, public-booking regressions **17/17**. Actual suggested-slot booking,
  subsequent conflict and role/module/tenant refusal verified live on disposable DB.
  API/web production builds/typechecks and workspace lint pass. Initial unit run
  missed the salon-clock mock; corrected test fixture and reran, no production guard
  weakened. No full API suite or owner browser walkthrough claimed.
- Replayed existing 46 migrations on a fresh disposable loopback database at
  127.0.0.1:55440/package_expiry_test. Application DB/accounts unchanged. No provider
  called, commit, push or deployment. Documentation: docs/owner-quiet-days.md.
- Logs: /tmp/oa04-api-final.log, /tmp/oa04-http-final.log,
  /tmp/oa04-booking-regression.log, /tmp/oa04-web-full.log,
  /tmp/oa04-shared-tests.log, /tmp/oa04-api-build.log, /tmp/oa04-web-build.log,
  /tmp/oa04-lint.log. OA-05 is next ready and was not started.

## October 24, 2026 — OA-03 service-aware rebooking complete locally

- Replaced name heuristics, nonexistent counter access and unsafe merged/historical
  consent fallback. Nullable catalogue interval inherits existing Messaging company
  days; explicit range 1–365. Legacy query threshold remains a fallback override.
- Dashboard owner/manager workspace shows deterministic visit/interval/channel
  evidence, temporary editable drafts, unavailable/retry/empty states and role/module
  guards. No saved draft, approval, send, new main navigation or external AI.
- Current global choices, preferred enabled channel, exact destination and active
  customer required. Upcoming bookings and existing active/uncertain/same-visit/
  recent provider-accepted jobs suppress suggestions. Automatic queue shares interval
  resolution; locked dispatch rechecks current eligibility/latest visit/contact limit.
  Duplicate jobs verified to produce one accepted fake-provider submission.
- New migration replays with all **46 migrations** on disposable PostgreSQL at
  127.0.0.1:55440/package_expiry_test. Application DB unchanged. Real providers never
  called; messaging tests inject a fake sender. Docs: docs/owner-rebooking.md.
- Checks: focused API **17/17**, shared **173/173**, full web **661/661** with two
  workers, HTTP acceptance **1/1**, messaging **25/25**; API/web production builds,
  workspace lint and Prisma validation pass. Initial full web default-worker run:
  660 pass/1 operator-login timeout; isolated 4/4 and full rerun pass. Initial live
  suites interfered through global worker access when run together; sequential reruns
  pass. Corrected future-completed visit fixture and new test typing before final checks.
- Logs: /tmp/oa03-api-unit-final.log, /tmp/oa03-shared-final.log,
  /tmp/oa03-web-final.log, /tmp/oa03-http-final.log,
  /tmp/oa03-messaging-verified.log, /tmp/oa03-api-build-final.log,
  /tmp/oa03-web-build-final.log, /tmp/oa03-lint-final.log.
- No application rollout, owner browser walkthrough, real-provider delivery, commit
  or push. OA-04 is next ready; no next task started.

## October 24, 2026 — OA-02 owner acceptance recorded

- User confirmed the dashboard briefing/evidence walkthrough was completed and
  explicitly accepted OA-02. Marked OA-02 DONE; OA-03 remains TODO and is ready.
- Acceptance is user-reported, not an agent browser or live HTTP/database check.
  No new tests run for this tracking-only update; prior focused runner reported
  16/16 passing with terminal completion uncertainty disclosed below.
- Only task/progress records changed. No application code, accounts, database,
  deployment, commit or push changed. No next task started.

## October 24, 2026 — OA-02 owner acceptance follow-up

- Reviewed briefing component/hook and focused coverage. Vitest reports 16/16
  passing across briefing, hook and dashboard tests. Terminal completion status
  was not reliably captured; log: `/tmp/oa02-acceptance-20261024.log`.
- Local web port 5173 and API port 9000 returned HTTP 000 (connection failed).
  No authenticated browser walkthrough, live figure reconciliation or destination
  navigation was performed. Automated fixture checks are not owner acceptance.
- OA-02 remains IN PROGRESS pending owner walkthrough and explicit acceptance.
  OA-03 remains TODO and was not started. No application code, accounts,
  application database, deployment, commit or push changed.
- Acceptance handoff: owner/manager opens Dashboard → Owner briefing → View
  briefing evidence; checks the salon timezone/window and paid/refund/net/average
  definitions against source screens using the same period. Source links do not
  apply that period automatically. Confirm entitled links, refresh/retry and clear
  empty/stale/error states before explicitly accepting or reporting findings.

## October 24, 2026 — TK2610-0028 implementation complete

- Added validated x-outlet-id context after session/tenant validation. Foreign or
  missing outlets return 404; malformed selection 422; suspended selection 403.
  Existing company roles apply at all outlets; manager/super-admin management
  requires writable tenant. No per-user branch ACLs or warehouse quantities.
- Added outlet create/list/update and product/package availability assignment APIs,
  tenant-bound Product outlet FK migration, shared request/response contracts,
  browser management screen and tab-local active-outlet picker. Confirmed switching
  clears unsaved carts and reloads all query/component state. Management/auth
  requests omit selection for suspended-outlet recovery. Sign-out clears selection.
- Prisma central policy scopes catalogue reads to global + selected availability;
  sales and sale-linked ledgers/reports to selected branch. Creates snapshot the
  validated selection. Customer identity, holdings, family and stock remain shared.
  Tenant-wide reporting includes all branches and legacy null-attributed sales.
  Reused idempotency keys from a different selected branch return explicit 409.
- Shared guarded stock decrements, hold completion, void and refund restore verified
  live, including concurrent last-unit sale and restoration after reassignment.
  Report liability/customer/appointment metrics remain company-wide; report day
  timezone remains salon/report timezone. Detailed scope: docs/multi-outlet.md.
- All **45 migrations** replay successfully from empty disposable database
  outlet_replay_final at 127.0.0.1:55448. No compatibility patch in that replay.
  Broader API regression database outlet_test received disposable-only
  `services.interval INTEGER NOT NULL DEFAULT 60` to accommodate unrelated working
  schema drift, not an application migration or an outlet migration dependency.
- Checks: focused/live **23/23**; final sale/catalogue/packages/reports/auth/tenant
  API regressions **163/163**; web **653/653**; shared **171/171**; Prisma validation,
  web production build/typecheck, web/shared lint and focused API lint pass.
- Full API run: **547 passed / 1 failed / 16 opt-in skips**. Failure is the existing
  owner-assistant rebooking test (new unstubbed consent lookup to 127.0.0.1:1).
  API typecheck still has the same six errors only in ai-assistant.service.ts;
  API/root production build remains blocked. Unrelated edits preserved.
- Earlier first-pass test failures corrected: existing oversell precheck is HTTP
  400; Z totals are nested; Zod partial/default status required explicit omission
  handling; UI text selectors and navigation expectations updated. Fixed test module
  fixtures to preserve canonical core flags; final broader run has no module failure.
- Logs: /tmp/glampro-outlet-http.log, /tmp/glampro-outlet-final-regression.log,
  /tmp/glampro-outlet-final-replay.log, /tmp/glampro-outlet-api-disposable-tests.log,
  /tmp/glampro-outlet-web-tests.log, /tmp/glampro-outlet-shared-tests.log,
  /tmp/glampro-outlet-final-typecheck.log. pg emits a pre-existing concurrent-query
  deprecation warning on refund paths; tests pass without suppressing it.
- Application DB unchanged. No commit, deployment or browser walkthrough claimed.
  Next: OA-02 owner acceptance; outlet application rollout separately authorized.

## October 24, 2026 — TK2610-0028 disposable migration acceptance

- Replayed all 44 migrations successfully on a fresh local PostgreSQL instance
  at port 55448, database `outlet_test`. Application database unchanged.
- Added guarded opt-in `apps/api/prisma/outlet.acceptance.test.ts`. Raw SQL fixtures
  roll back; Prisma scoping fixtures are cleaned up. It verifies null/outlet-specific
  Customer/Package/Sale links, unchanged family IDs, tenant-local slug uniqueness,
  cross-tenant/missing outlet rejection, restricted deletion/reassignment,
  tenant-wide email uniqueness and runtime Prisma outlet tenant scoping.
- Focused/live checks: 14/14 pass, no skips. Corrected the test expectation for
  PostgreSQL's RESTRICT violation SQLSTATE to 23001 after the first run.
  Focused ESLint passed. API typecheck reports the same six pre-existing errors
  exclusively in ai-assistant.service.ts; new test has no reported type errors.
- Schema diff after replay has no outlet changes. Remaining drift concerns
  commission/prepaid/treatment constraints/index names and unrelated Service.interval.
  Logs: `/tmp/glampro-outlet-replay.log`, `/tmp/glampro-outlet-acceptance.log`,
  `/tmp/glampro-outlet-drift.log`, `/tmp/glampro-outlet-followup-typecheck.log`.
- TK2610-0028 remains IN PROGRESS. Next: authenticated outlet context and service/API
  coverage; branch permissions/stock/reporting remain unfinished. No app migration,
  deployment, commit or unrelated owner-assistant edits.

## October 24, 2026 — TK2610-0028 outlet foundation (IN PROGRESS)

- Fixed optional outlet relations on Customer/Package, added tenant-bound composite
  foreign keys for Customer/Package/Sale, tenant-local outlet slugs and lookup
  indexes. Registered Outlet in the Prisma tenant-scoping registry. Existing
  family grouping and tenant-wide customer email uniqueness remain unchanged.
- Generated `20261024090000_outlet_foundation` from schema-to-schema diff, excluding
  the pre-existing unrelated Service.interval change. No migration was applied to
  the application database; disposable database replay/sample data remain pending.
- Verified: Prisma validation/client generation; focused migration/registry tests
  7/7; focused ESLint and diff whitespace check. Formatted the new test.
- Workspace typecheck fails in pre-existing ai-assistant.service.ts changes;
  web/shared typechecks report no errors. Full tests: API 226 pass, 16 fail,
  302 cancelled, 14 skipped; database setup failures include missing Service.interval.
  Web 645 pass/1 routing failure; shared 170/170. Logs:
  `/tmp/glampro-outlet-typecheck.log`, `/tmp/glampro-outlet-tests.log`.
- Unrelated owner-assistant edits preserved. Next: disposable migration/sample-data
  verification, then authenticated outlet context/service coverage. Branch stock,
  permissions and consolidated reporting remain unfinished. No commit/deploy.

## October 23, 2026 — OA-02 acceptance follow-up

- Re-ran focused briefing component, hook and dashboard tests: 16/16 pass across
  three files. Log: `/tmp/oa02-walkthrough-focused.log`; exit status 0.
- Local web port 5173 and API port 9000 did not respond. No authenticated
  owner/manager walkthrough, live figure reconciliation or destination navigation
  was performed. Automated fixture checks are not owner acceptance.
- OA-02 remains IN PROGRESS pending the signed-in walkthrough and explicit
  acceptance. OA-03 remains TODO and was not started. No application code,
  accounts, database or deployment changed.

## October 23, 2026 — OA-02 briefing implemented; owner walkthrough pending

- Added owner/manager-only dashboard briefing and existing accessible drawer for
  evidence. No new route/nav item, database change, sending or activation. Facts
  include paid/refund/net/average, new customers, bookings and active-stock checks.
  Suggested checks are capped at three and filtered by destination entitlements.
- Hook validates the shared OA-01 schema, keys cache by tenant/user, refreshes every
  minute/on focus and supports manual retry. Role/module loss unmounts the workspace;
  401/403 hides cached facts. Non-auth refresh failure retains explicitly stale
  evidence. Existing dashboard tiles fetch independently, allowing partial availability.
- Evidence shows exact half-open interval, salon timezone, timestamp and metric
  definitions. Destination links are labelled source screens, not exact-record or
  prefiltered evidence; owners are told the reporting window is not applied there.
  No comparison, AI generation, legacy nudge/promo previews or capacity inference.
- Verified: focused 16/16; full web 646/646 across 80 files; web typecheck, workspace
  lint and production web build pass. Existing non-fatal npm unknown-config warning
  remains. Tests cover both privileged roles, other roles, missing entitlement/
  identity, role loss with open drawer, source links, empty/loading/error/retry,
  stale and refusal snapshots, schema validation and tenant/user cache separation.
- Remaining: owner walkthrough/acceptance, so OA-02 remains IN PROGRESS. No agent
  browser UAT, live HTTP/database checks, application database changes, messaging,
  deployment, commit or push. Logs: `/tmp/oa02-focused.log`,
  `/tmp/oa02-web-full.log`, `/tmp/oa02-types.log`, `/tmp/oa02-lint.log`,
  `/tmp/oa02-build.log`.
- Manual check: sign in as owner/manager; open dashboard briefing/evidence; verify
  figures/window/definitions and source destinations; refresh and close with Escape;
  check unavailable modules hide links and cashier/staff cannot see the briefing.
  After acceptance, next task is OA-03 service-aware rebooking, not automatic sending.

## October 23, 2026 — OA-01 owner-assistant metrics foundation complete

- Recorded approved OA-01–OA-07 scope. Preserved TK2610-0029's correctness history.
  Stopped after OA-01; no UI feature, approval workflow or messaging changes.
- Added shared owner summary schema/type with explicit completed-sale paid,
  refund/net amounts, receipt count, threshold, timezone, resolved half-open range
  and as-of evidence. Legacy assistant income remains pre-refund; dashboard income
  remains net. Money is not relabelled as cash-only receipts, revenue or profit.
- Extracted common owner metrics; dashboard and assistant now use the same decimal
  calculations, salon-local default day, inclusive explicit instant end boundaries,
  cancelled-booking exclusion and active-product tenant-threshold stock rule.
  Dashboard no longer counts inactive stock; default API day no longer uses server
  timezone. Existing route auth/module/role guards remain unchanged.
- Tests: shared 170/170; focused API service/tenant boundary/isolation 31 passed,
  0 failed, 1 live assistant acceptance skipped (fixture not enabled); dashboard
  UI 3/3. Includes reconciliation, refunds without receipts, empty sums, decimal
  averages, inclusive boundaries, DST and response contract validation. Shared
  build, API/web typechecks, workspace lint, API/web production builds, changed-code
  Prettier and diff checks pass. Initial typecheck/lint caught a refactor's unused
  helper; removed and reran successfully.
- Live PostgreSQL/HTTP, full API/web suites and browser UAT not run. No application
  database access, migration, mail, AI provider, deployment, commit or push.
  Logs: `/tmp/oa01-focused.log`, `/tmp/oa01-shared-tests.log`,
  `/tmp/oa01-web-tests.log`, `/tmp/oa01-api-types.log`, `/tmp/oa01-web-types.log`,
  `/tmp/oa01-lint.log`, `/tmp/oa01-api-build.log`, `/tmp/oa01-web-build.log`.
- Next ready task: OA-02. Later service-aware rebooking must share eligibility and
  deduplication with existing automatic rebooking jobs, not add a second sender.

## October 23, 2026 — COMM-01 advanced commissions complete locally

- Added company defaults and staff/type, department and item overrides, explicit
  zero/inheritance, prospective dates, immutable publication events and audit records.
  Tenant locks/revisions serialize policy publication with sale snapshots and reject
  stale writes. History paging does not truncate effective policy. Existing staff
  service rates remain the fallback until explicitly replaced/inherited.
- Settings and staff editor expose current/scheduled/history, search, rate preview,
  reason, effective time and refresh/retry. Read-only salons cannot publish. Staff
  PATCH no longer silently changes commission rates; unchanged old clients accepted.
- Sales snapshot zero decisions on lines without zero earnings entries; positive
  entries carry basis/line/rule/source. Refund adjustments preserve original values.
  Additive transactional migration; original rows are not backfilled/recalculated.
- Real HTTP/database acceptance covers permissions, two tenants, stale/concurrent
  publication, future dates, zero/inheritance, history pages, duplicate sale retries,
  tax/discount/product calculations, refunds, immutable rules and suspended writes.
  All 43 migrations replay; commission acceptance/resolver 5/5. Final sequential API
  541 passed / 0 failed / 14 opt-in skips; separate commission acceptance not skipped.
  Web 633/633; shared 168/168; root build, API/web typechecks, workspace lint,
  changed-file formatting and diff checks pass. Initial API run overlapped a
  schema/client update and failed; clean replay/regenerated-client rerun above
  supersedes it. Existing pg concurrent-query deprecation warning remains.
- UI verification is automated component coverage, not agent browser UAT; standing
  user acceptance applies. Schema replay was on a fresh disposable database; no
  rehearsal against a copy of the application dataset. Legacy calculation,
  idempotency, redemption and void/refund tests pass in the full API suite.
- No application migration, production changes, deployment, commit or push. Payment
  provider and multi-outlet work remain deferred. No new independent task started.

## October 23, 2026 — SAAS-04 subscriptions, lifecycle, entitlements and audit

- Added shared administration contracts, platform-only company administration/audit
  reads and manual subscription/lifecycle/module writes, plus controls in platform
  company details. Audit is company-specific, paginated, `company.*` events only.
- Current periods require decimal string amounts, explicit currency and reason;
  serialized company locks prevent overlaps. No payment collection/ledger change,
  future schedule, history editing, cap editing, deletion or impersonation.
- Lifecycle updates atomically audit, bump company/user versions, clear MFA codes
  and revoke company refresh tokens. Suspended users can sign in read-only; cancelled
  and expired blocked. Reactivation needs a current period when previous one lapsed;
  recording never changes stored lifecycle. New no-period provisioning stays active.
- Login/access/profile ignore pending/cancelled/not-started periods and expire at the
  exact paid-period end. Add-on expiry/grants enforced on existing sessions; core
  modules cannot change. Grant audit records actual entitlement id and before/after.
- Disposable PostgreSQL on 55442 replayed 42 migrations; real HTTP verifies platform
  auth, two-company isolation, concurrent overlap, session revocation/read-only policy,
  module expiry/revoke, renewal and audit-FK rollback including user/session writes.
  Fixture operator session; no fresh actual SMTP/MFA delivery or browser walkthrough.
- Full API sequential 537 passed / 0 failed / 13 opt-in skips; separate gated SAAS-04
  acceptance passed. Web 629/629; shared 167/167. Root build, workspace typecheck/lint,
  final web typecheck/lint, formatting and diff checks pass. Initial parallel web
  lazy-import timeout resolved by rerunning two workers without weakening assertions.
- No schema/new migrations, application account changes, deployment, commit or push.
  Initial API runner ended before completion; detached rerun completed successfully.
  All approved SaaS tasks locally complete. No next task started; rollout and existing
  unrelated migration drift remain separate concerns.

## October 23, 2026 — SAAS-05 integrated platform routes

- User approved replacing separate `apps/platform` with lazy-loaded screens in
  `apps/web/src/platform`. Operator login `/platform/login`, workspace `/platform`;
  unauthenticated platform paths redirect to operator login. Salon `/login` unchanged.
- Moved salon query/auth/toast/formatting providers into `apps/web/src/SalonApp.tsx`,
  outside platform routes. Platform CSS scoped to `.platform-portal`; company UI/API
  client and their tests moved byte-for-byte. Separate platform workspace/configs
  and root platform dev/build scripts removed; lockfile refreshed offline.
- Same frontend origin/build/server; backend realms, MFA, memory-only platform
  tokens and session authorization unchanged. ADR 0004 updated for approved design.
  API directory `npm run dev` remains API-only; root `npm run dev` starts all services.
- Checks: web 625/625, web lint, root build (shared/API/web TypeScript and Vite) pass.
  Focused API auth/security/guard/routes 40/40 pass. Disposable Vite on port 55173
  returned 200 for both logins, workspace and source modules; stopped afterward.
  Redirect/MFA/logout/provider isolation tested in components, not live browser
  or actual SMTP/account login. No migration, accounts, deployment, commit or push.
- Next ready: SAAS-04. No automatic continuation.

## October 23, 2026 — SAAS-03 company management and owner invitations

- Added platform-only company list/search/pagination/details/create/resend, separate
  authenticated middleware and portal company workflows. No customer business data
  is returned by platform company endpoints. Added public token-bound salon owner
  invitation page; not public registration.
- Transaction creates company, disabled owner, ownership, 48-hour hashed invitation
  and audit. Email sent after commit with explicit sent/failed result. Resend revokes
  previous links; accepted owners and accounts without onboarding history refused.
  Acceptance and resend lock the company; token claim, owner activation/password
  and audit atomic. Owner completes existing email MFA login after enrollment.
- Tokens use URL fragments in emailed links and request bodies for acceptance; not
  returned by platform APIs or audit. Strong password limits account for bcrypt's
  72-byte limit. Origin restricted to HTTPS or local loopback HTTP.
- Live gated acceptance: two-company isolation, owner/platform refusal, duplicate
  and audit-FK transaction rollback, malformed input, expired/replaced/replayed links,
  concurrent acceptance and post-commit SMTP failure all pass. Initial disposable
  test omitted the core customers module fixture; added fixture and rerun passed.
- Full sequential API 537 passed / 0 failed / 12 opt-in skips; web 609/609; shared
  164/164. Platform 9/9 including company UI/create/delivery-failure and background
  refresh/logout race. Workspace typecheck/lint/build pass after final code change.
- All 42 migrations applied only to isolated PostgreSQL with capture-only SMTP.
  No application data/account changes or deployment. Standing user acceptance is
  not an agent browser walkthrough. Prior unrelated drift remains untouched.
- Next ready: SAAS-04. Stopped after selected task; no commit/push.

## October 23, 2026 — SAAS-02 platform authentication and portal shell

- Added separate `apps/platform` React/Vite app, shared platform contracts and
  `/api/platform/auth` endpoints. Reused installed libraries; no new library choice.
  Root build now includes platform; salon dev workflow unchanged.
- Additive migration introduces platform realm, hashed password-bound MFA challenge
  fields and a separate PlatformSession table. Platform audience/realm/session checks
  prevent both-direction tenant/platform access; no blanket platform database scope.
- Mandatory email code has ten-minute expiry and five-attempt atomic budget;
  single-use challenge, atomic refresh rotation, absolute expiry and immediate
  logout revocation. Active status/token version checked on every request.
  Bootstrap creates only the first operator under advisory lock with audit and
  strong credentials; never automatic and never overwrites an account.
- Portal login/MFA/shell/logout and session check use memory-only tokens. Failed
  logout remains retryable instead of claiming successful server revocation.
- Checks: all 41 migrations replayed on isolated loopback PostgreSQL port 55440;
  opt-in real HTTP/capture-only SMTP acceptance passed (including concurrent MFA
  replay, code replacement/expiry/budget, refresh reuse, disable/version and realm
  refusal). Bootstrap first creation passed; repeat and weak credentials refused.
- Tests: API full sequential 537 passed / 0 failed / 11 opt-in skips; salon web
  606/606; shared 161/161; platform 5/5; focused auth 35/35. Workspace build,
  typecheck/lint passed. Initial mocked no-SMTP test allowed dotenv to restore SMTP;
  explicit empty override fixed isolation and rerun passed. Initial acceptance
  rerun hit a duplicate fixture; repeatable gated fixture setup corrected it.
- Schema diff exits 2 for unrelated existing prepaid/treatment constraints/index
  names after full migration replay; no platform-auth mismatch. No unrelated repair.
- No application migration, real-account bootstrap, deployment, commit or push.
  Standing acceptance applies, not an agent browser walkthrough. Operational setup
  and limitations are recorded in PROJECT.md. Next: SAAS-03; stop here.

## October 23, 2026 — SAAS-01 tenant boundary hardening

- Approved multi-company SaaS first; multi-outlet deferred. Added SAAS-01–04
  deliverables and corrected TK2610-0028's unsupported branch-completion claim.
- Tenant auth now rejects unsupported realms before user lookup and refuses a
  token whose tenant differs from the user's current tenant. Legacy tokens without
  a tenant claim still enter only the user's own company.
- Company-owner force-sign-out now requires writable tenant access. Its service
  requires tenant context, updates only a matching tenant user, and revokes their
  refresh tokens in the same transaction. Missing/foreign targets return identical
  404 responses without refresh-token changes. This is not a platform endpoint.
- Changed API middleware, auth route/service and added tenant-boundary tests.
  Focused auth/token/guard/security suites: 33 passed, zero failed/skipped, including
  seven new tests with mocked persistence. Shared build and API typecheck/lint pass;
  actual code diff reviewed and git diff whitespace check passed.
- No live database/HTTP test, migration, deployment, commit or push. Additional
  schema/status/module test/build command output was unreliable; not counted.
  Platform MFA/bootstrap, separate session model and restricted platform-plane
  data access must be addressed in SAAS-02 before company-management APIs.
- Next ready: SAAS-02. Stopped after the selected task per managed-task workflow.

## October 23, 2026 — TK2610-0026 deferred by user

- User cannot confirm company/customer information now and requested skipping.
  Task remains BLOCKED and is no longer the immediate next action.
- Resume only at user request; prior evidence checklist and blockers preserved.
  No submission, completion claim, P2 sign-off or next task started.
- Documentation-only update. Runtime tests not rerun because application code is
  unchanged.

## October 23, 2026 — TK2610-0026 official route and readiness review

- Retrieved official IMDA eligibility, Stage 2, document-list, references, Corppass,
  FAQ and Salon Management System category pages. Recorded sources and an evidence
  checklist in PROJECT.md; updated TK2610-0026 without marking it DONE.
- Published route is Vendor Management Portal, candidate category Personal Care
  Services / Salon Management System. This is not a customer grant application.
- Business eligibility, five genuine six-month customer references, operational
  documents, category compliance and submission acknowledgement remain unverified.
  No new code-level compliance audit or complete application pack claimed.
- Current Corppass guide names the SMEs Go Digital e-Service. Live access was not
  tested and must be confirmed by the company administrator.
- No external forms, login, surveys, declarations or submissions; no application
  code/database/account changes. Existing unrelated worktree changes preserved.
- Checks: Prettier check passed for all three tracking files; git diff whitespace
  check clean; tracking assertions confirm BLOCKED status and no submission claim.
  Initial case-sensitive assertion missed a wrapped sentence; corrected check passed.
  Runtime suites not rerun for this documentation-only review.
- Next owner input: legal entity/UEN and incorporation date; whether five qualifying
  local SME customers currently use this solution after at least six months.
  Keep confidential evidence outside git. No credentials requested.

## October 23, 2026 — Local rollout acceptance complete

- User confirmed the existing-owner login check is done. Combined with prior
  implementation/automated evidence, migration/checksum/guard/health checks and
  local SMTP verification, this closes TK2610-0025 and TK2610-0027 for local scope.
- Both external IDs are ready for the user to mark DONE. No external tracker edited.
  Production rollout, backup/restore rehearsal and historical pre/post-migration
  comparisons are not claimed. Earlier blockers below are superseded.
- Records-only update; no runtime suites rerun. Next open product task is
  TK2610-0026, blocked on official route, business evidence and authorized submission.
  TK2610-0003 remains IN PROGRESS; no automatic P2 phase sign-off or next task start.

## October 23, 2026 — Local SMTP setup and isolated owner-login acceptance

- Installed standalone Mailpit v1.32.0 under
  /home/tuangpi/.local/share/glampro-suite/mailpit/mailpit; download SHA-256 verified
  against GitHub release asset metadata. No application dependency added.
- Mailpit left running, SMTP 127.0.0.1:1025 and inbox 127.0.0.1:8025 only. No relay
  configuration or inherited MP_* settings; remote CSS/fonts and version checks
  disabled. Private inbox storage has 24-hour age retention. Not installed as an
  auto-start service. Restart command:
  `/home/tuangpi/.local/share/glampro-suite/mailpit/mailpit --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025 --database /home/tuangpi/.local/share/glampro-suite/mailpit/messages.db --disable-version-check --block-remote-css-and-fonts --max-age 24h`.
- Updated only SMTP settings in ignored apps/api/.env to loopback port 1025, no TLS
  or authentication. Existing sender and database settings preserved. Built app's
  actual sendMail transport delivered a non-secret synthetic message into Mailpit;
  confirmed through inbox API. No external delivery or owner-account changes.
- Existing SEC-01 acceptance passed 1/1, zero skips, on separately initialized
  loopback 55439/sec01_acceptance after all 40 migrations. Covers SMTP-delivered
  owner challenge/login, hash storage, replay refusal, forbidden owner disable,
  password policy/session revocation, staff enrollment/login/disable. This suite
  uses its own ephemeral capture SMTP, not Mailpit; checks are separate evidence.
- Fixture tenant count zero after test; disposable PostgreSQL stopped and pg_ctl
  status confirms no server. Mailpit remains available for the user's local login.
- Existing application-owner password unavailable: no guessing/reset/seeding and no
  claim of existing-account login. Parent rollout remains open only for that check.
  Full regression/build not rerun for local tooling/configuration and records only.
- Logs: /tmp/glampro-mailpit-delivery.log, /tmp/glampro-sec01-run.log (exit marker 0),
  /tmp/glampro-sec01-cleanup.log. No application DB writes, commit or push.

## October 23, 2026 — Local database rollout verification

- User authorized proceeding locally. Fresh target checks confirmed development,
  localhost:5432/glampro_suite and no other database sessions at inspection time.
- Unlike the earlier preflight, all 40 migrations are now completed. Prisma status
  reports up to date; all repository migration SHA-256 checksums match stored values.
  The agent did not apply migrations or infer who applied them.
- All seven expected retention/consent/prepaid evidence triggers are installed and
  enabled. Balance-event arithmetic violations: zero. This is not a historical
  pre/post-migration balance comparison or full ledger reconciliation.
- Workspace typecheck, lint and build passed (exit markers 0). Current built API
  served /health, /health/ready and /api/health with HTTP 200 on a temporary loopback
  port; server and Prisma pool closed after checks. No persistent service started.
- SMTP remains unset; owner 2FA delivery/login not tested or bypassed. No fixture
  writes, seeds, backup/restore, database migration, external mail, commit or push.
  Full regression suites were not rerun; earlier results remain historical.
- Evidence: /tmp/glampro-local-migration-status.log,
  /tmp/glampro-local-integrity.log, /tmp/glampro-local-health.log and
  /tmp/glampro-local-{typecheck,lint,build}.log. Parent rollout remains open for SMTP
  and owner-login verification; stale authorization/pending-migration blocker removed.

## October 23, 2026 — Local development rollout preflight (superseded)

- User selected local development. Read-only checks confirmed development mode,
  loopback localhost:5432 database glampro_suite, API configured port 9001,
  messaging disabled, upload directory present and SMTP unset. No API/web listeners
  or other connections to the target database observed at inspection time.
- Prisma status found 40 repository migrations and eight pending: package validity,
  treatment POS link, retention protection, consent history, prepaid transfer,
  service sets, family membership and sharing/balance ledger. Status exited 1 due
  to pending migrations; latest completed entry is family_sharing_fields.
- Earlier expiry/link application acceptance remains historical user-reported
  evidence, not this local target's state. Do not assume those migrations applied.
- Local preflight complete; execution BLOCKED pending explicit authorization for
  backup, isolated restore/migration rehearsal and target migration. No database
  mutation, backup, service startup or migration performed. Owner login additionally
  needs a local SMTP inbox; no auth bypass or code logging permitted.

## October 23, 2026 — Coordinated rollout checklist prepared

- Planning deliverable DONE under TK2610-0025/TK2610-0027; parent statuses remain
  IN PROGRESS/BLOCKED respectively. Added `docs/coordinated-rollout-checklist.md`;
  linked PROJECT/TASKS and corrected the treatment audit's superseded family-work note.
- Inspected manifests, Prisma CLI config, all six later retention/history/prepaid
  migration SQL files, health implementation and acceptance switches. Inventory is
  40 migrations, not verified application status. Readiness only runs SELECT 1.
- Checklist covers explicit target/action authorization, backup/restore rehearsal,
  all-pending migration review, old-writer suspension, coordinated artifacts,
  OPENING/consent/balance integrity comparisons, scoped checks, observation and
  evidence-preserving recovery. No deployment artifacts found; example Compose
  references are not an executable deployment procedure.
- Runtime suites not rerun for documentation-only changes. No application access,
  DB process, migration, deployment, external mail, disposal, commit or push.
- Verification: changed-document Prettier check and git diff whitespace check pass.
  Static reference check passes for nine named migrations, 40 migration directories,
  ten acceptance switches, absolute paths, npm scripts and unchecked rollout gates.
- Next: target/environment/operator and scoped authorization; stop at planning.

## October 23, 2026 — TK2610-0029 assistant correctness complete

- Reopened stale DONE; confirmed routes had no auth, default summary queried all
  history, average ticket divided by appointments, consent used OR, arbitrary old
  visits produced duplicate nudges, promo status filter targeted a date column and
  promo responses lacked approval metadata. Replaced those paths with scoped reads.
- Owner/manager-only routes use existing authentication, tenant/module guards and
  validation/error middleware. Date-only edges include full salon-local days;
  inclusive explicit instants preserved; default daily windows are half-open with
  tenant timezone/DST. Decimal average ticket divides by completed receipts. Active
  low-stock products use the tenant threshold; refunds remain separately reported.
- Nudges require PDPA AND marketing choices, active customers and nonblank email,
  latest completed visit, no future/in-progress booking; optional history filters
  apply after latest selection. No arbitrary 200-appointment cap or duplicate visits.
  Both nudge and promo HTTP responses always require approval, including empty lists.
- Promos fix the Prisma filter, use 30 complete local days by default and the existing
  below-three-bookings/day heuristic; active stocked products/services only. Stable
  draft IDs, next-day seven-day validity and explicit historical heuristic wording.
  No message, voucher/campaign writes or delivery added. No UI expansion.
- Focused 8/8, including real PostgreSQL/HTTP isolation, role/auth refusal, disabled
  user/expired tenant refusal, invalid/repeated/reversed queries, cancelled/no-show/
  recent/upcoming/archived/consent exclusion and no writes to messaging/vouchers.
  Unit coverage includes exact default windows, decimal average and 25-hour DST day.
- Full sequential API: 518 tests, 509 passed, 0 failed, 9 opt-in skips (unrelated
  SMTP/prepaid/treatment acceptance flags not enabled). Assistant acceptance enabled.
  Web 597/597, shared 157/157; workspace typecheck/lint/build pass. Final focused rerun
  8/8 after expired-account/future-validity assertions; final API typecheck/lint pass.
  Initial acceptance typecheck caught an inferred any[] fixture; fixed explicitly.
- Logs: `/tmp/tk29-api-full.log`, `/tmp/tk29-focused-final.log`,
  `/tmp/tk29-workspace-typecheck.log`, `/tmp/tk29-workspace-lint.log`,
  `/tmp/tk29-build.log`, `/tmp/tk29-web.log`, `/tmp/tk29-shared.log`.
  Existing disposable loopback 55440/package_expiry_test only, 40 completed migrations,
  no new migration. Fixture tenants zero and cluster stopped, pg_ctl confirms no
  server (`/tmp/tk29-cleanup.log`). No application DB access/deployment/external mail.
- TK2610-0029 is ready to mark DONE externally under standing user acceptance.
  No further task started; existing operational and P2 blockers remain.

## October 23, 2026 — TK2610-0027 implementation complete

- Completed explicit per-holding sharing, one pooled POS option, decimal-cent draws
  ordered expiry (null last)/purchase/ID, exact holding redemption rows/restoration,
  privacy of unshared holdings and owner exit/change sharing withdrawal. Shared
  holdings must be made private before whole-holding transfer. Legacy familyId
  values never grant access. Preserved each balance/expiry and liability accounting.
- Added authenticated request actor to tenant context (not client staff attribution),
  prepaid transaction lock shared by sale/hold completion/void/membership/sharing/
  transfer, and DB-trigger append-only balance evidence. Grants, spend, restores,
  removals, transfers, sharing and expiry edits recorded atomically. Existing holdings
  get OPENING snapshots, not fabricated purchase history. Natural expiry only affects
  eligibility, not balance. One same-salon lock favors correctness over throughput.
- Customer profile now includes membership/sharing controls, confirmations/reasons,
  stale-write guards, permission/read-only behavior, reload/error recovery and paginated
  membership/balance audit. POS explains shared allocation and revalidates on pay.
- Final full sequential API: 510 tests, 509 passed, 0 failed, 1 opt-in SEC-01 SMTP skip.
  Enabled expiry/service-set/family/sharing/transfer and all three treatment acceptance
  checks. Web 597/597 across 70 files; shared 157/157. Workspace typecheck/lint/build,
  changed-file formatting and diff checks pass. Logs `/tmp/tk27-complete-api-final.log`,
  `/tmp/tk27-complete-web-final.log`, `/tmp/tk27-complete-shared-final.log`.
- Earlier full API run found 2 tenant-context shape regressions (undefined actorId
  property); fixed preserving prior scope shape, added actor isolation coverage and
  reran the whole suite. Initial new checks caught void-result deserialization in
  advisory lock, test fixture amount typing and render-time Date.now; corrected,
  not suppressed. New acceptance also verifies rollback on injected audit failure,
  concurrent draws/revocation, stale snapshots, immutable evidence, transfer/void
  interactions, archived/expired exclusion and no private/shared double offering.
- Migration `20261023200000_prepaid_sharing_balance_ledger` applied only to approved
  disposable loopback 55440/package_expiry_test (40 completed migrations). Fixture
  tenants/injected triggers counted zero, cluster stopped; pg_ctl confirms no server.
  Cleanup `/tmp/tk27-complete-cleanup.log`. No app DB access, deployment, external
  mail, commit or push. Standing user acceptance applies, not an agent walkthrough.
- Implementation is finished. Parent BLOCKED only for unauthorized/unperformed
  coordinated application rollout; no further development slice planned under 0027.
  Next code candidate: verify/fix recorded 0029 assistant findings, not another 0027
  foundation. Earlier notes below are historical and superseded where inconsistent.

## October 23, 2026 — Explicit prepaid family membership foundation

- Separate tenant-scoped family/membership models; legacy familyId values do not
  authorize access. Owner/manager-only creation and join/change/leave endpoints
  require confirmation/reason and expected previous family. Customer locks serialize
  changes; recheck enabled actor, owner 2FA, tenant write state, customer archival
  and same-tenant target. Membership alone changes no balances or spending access.
- Append-only membership events commit atomically with changes. Database trigger
  rejects history update/delete except tenant removal. Paginated customer history.
  Migration `20261023180000_prepaid_family_membership` applied only to disposable
  loopback 55440/package_expiry_test (39 completed migrations).
- Shared 156/156; explicit family HTTP/database acceptance 1/1 and transfer acceptance
  1/1 pass. Covers isolation/permissions/entitlement, concurrent stale writes,
  private-credit preservation, archived/read-only refusal, immutable history and
  rollback on injected evidence failure. Initial test assertion used status instead
  of statusCode; corrected and rerun. Workspace typecheck, lint and production build
  pass; scoped formatting/diff checks pass.
- Full sequential API regression: 508 tests, 500 passed, 0 failed, 8 opt-in skips,
  exit 0 (`/tmp/family-api-full.log`). Family/transfer opt-in acceptance ran separately
  without skips. No web suite rerun; no web files changed. Fixture tenants and injected
  trigger counted zero; 39 completed disposable migrations, cluster stopped and
  pg_ctl confirms no server (`/tmp/family-final-cleanup.log`).
- No web UI, shared holding enrollment, pooled allocation, complete balance audit or
  rollout claimed. TK2610-0027 remains IN PROGRESS; do not close the external task.
  Next: per-holding sharing with membership/spend locking, exact-source reversals,
  full balance events and customer/POS UI. No application migration/deployment/commit.

## October 23, 2026 — Service-set redemption slice

- User reversed the service-set deferral and approved configurable quantities per
  required service ID. One complete set consumes one session; incomplete sets do
  not redeem; extras use other tenders. Matching spans cart lines in cart order,
  and package tenders allocate units in tender order without double coverage.
- Implemented explicit PER_UNIT/SERVICE_SET catalogue modes, quantity editor,
  manager/owner configuration guards, same-salon service validation and transactional
  catalogue updates. New purchases snapshot rules; legacy null snapshots retain
  per-unit catalogue coverage. A shared catalogue row lock serializes edits and
  purchase snapshots. Treatment eligibility reads snapshots, not edited templates.
- Shared integer-cent allocation prices matched units after discounts. Voucher
  previews now expose net line amounts; residual cents go to earliest units.
  Existing holding locks and reversal rows preserve exact consumed sessions.
- Verified shared 154/154; web 585/585; full API 502 passed, 0 failed, 5 opt-in
  skips. Explicit expiry, transfer and service-set acceptance: 3 passed, no skips.
  Workspace typecheck and lint passed. Logs: `/tmp/tk27-api-final.log`,
  `/tmp/tk27-web-final.log`, `/tmp/tk27-shared-test.log`,
  `/tmp/tk27-related-acceptance.log`. No agent browser walkthrough.
- Family pooling and complete prepaid balance audit are NOT implemented in this
  slice. An unfinished scaffold was removed, including its unapplied migration;
  legacy familyId semantics are unchanged. Parent task remains IN PROGRESS.
- Service-set migration applied only to disposable loopback PostgreSQL on port 55440. Application migration/deployment and commits were not performed.

- Production build passed (exit 0); changed-file formatting and diff checks passed.
  Disposable cluster stopped successfully after verification. Build and cleanup logs:
  `/tmp/tk27-final-build.log`, `/tmp/tk27-cleanup.log`.

## October 23, 2026 — Same-salon prepaid transfer foundation

- Transfer slice DONE; parent TK2610-0027 remains IN PROGRESS, not ready for external
  closure. User approved same-salon prepaid scope, manager/owner controls, preserved
  expiry and append-only audit. Family pooling and full balance audit remain next;
  cross-tenant and session-package transfers are excluded.
- Added shared strict request/response contracts; tenant-scoped PrepaidTransferEvent
  and migration `20261023120000_prepaid_transfer_history`; prepaid service and
  customer-owned holdings/history/transfer routes. Customer profile has paginated
  holdings/history, recipient search, reason and explicit confirmation, role/read-only
  guards, preserved failed drafts and cache refresh. No new dependencies.
- Holding row locks serialize transfer with spend/void; current owner and version,
  database actor permissions, salon write state, archived customers, expiry and
  positive balance rechecked. Legacy family holdings explicitly refused. Balance,
  expiry and purchase provenance unchanged. Transfer and evidence are atomic;
  history UPDATE/DELETE refused (parent tenant cascade remains possible). Snapshot
  IDs preserve evidence independently of customer/account/holding relations.
- Removed unused unsafe transferPackageCredit helper; no callers existed. Purchase
  void now refuses any granted credit with recorded transfer evidence, including
  returned holdings. Prior redemption void restores the same holding under its
  current owner. Audit covers transfers only, not all grants/draws/reversals.
- Verified disposable PostgreSQL migration deploy; transfer HTTP/service acceptance
  1/1, none skipped; full API 506 tests: 504 pass, 0 fail, 2 skips, exit 0. Incorrect
  TREATMENT_POS_ACCEPTANCE switch left session acceptance skipped in that run;
  reran with TREATMENT_SESSION_ACCEPTANCE=1: 1/1 passed, exit 0. SEC-01 SMTP was
  intentionally not run. Full web 583/583 (68 files), shared 151/151, workspace
  typecheck, root lint and production build passed. pg query concurrency
  deprecation warnings remain non-fatal. No agent browser walkthrough performed.
- Logs: `/tmp/prepaid-acceptance.log`, `/tmp/prepaid-api-full.log`,
  `/tmp/prepaid-treatment-session.log`, `/tmp/prepaid-web-full.log`,
  `/tmp/prepaid-shared.log`, `/tmp/prepaid-build.log`; matching exit files are zero.
- Application migration/deployment, real-record erasure, external mail and commit
  were not performed. Disposable loopback 55440/package_expiry_test has 37 completed
  migrations; transfer fixture tenants, transfer events and injected test triggers
  counted zero. Cluster stopped; pg_ctl confirms no server and port no longer
  listens. Cleanup log: `/tmp/prepaid-cleanup.log`. Changed-file formatting and
  diff checks passed. Standing user acceptance applies, not an agent walkthrough.

## October 22, 2026 — TK2610-0025 completion audit

- Audit deliverable DONE; parent remains IN PROGRESS. Added approved-feature/evidence
  matrix and coordinated migration/API/web rollout prerequisites in
  `docs/treatment-completion-audit.md`. No runtime code changed.
- Fresh full API run on approved disposable loopback 55440/package_expiry_test:
  505 tests, 406 passed, 98 failed, 1 skipped, 0 cancelled, exit 1. Treatment
  consent/disposal/POS and package-expiry acceptance passed; SEC-01 SMTP acceptance
  intentionally skipped. Prior full web/shared/typecheck/lint/build results not rerun.
- 97 route failures across appointments/catalogue/customers/packages/reports/resources/
  sales/settings align with inspected password-only owner-login helpers not completing
  mandatory 2FA. Do not relax production auth or switch fixture roles to evade it.
  One messaging rebooking failure expected ALREADY_REBOOKED but got null; cause unverified.
- Full log `/tmp/treatment-completion-api-rerun.log`; first interrupted attempt has no
  completion claim. Disposable migration inventory has 36 completed migrations;
  no application DB accessed. Fixture tenant count and injected trigger count zero;
  cluster stopped. Documentation Prettier and diff checks pass.
- Recommended next: repair route test authentication, then triage the messaging failure
  before rollout. Application migration/deployment/real erasure remain unauthorized.

## October 23, 2026 — Owner 2FA route-test repair DONE

- User selected authentication-helper repair and full regression rerun, with messaging
  failure reported separately. Added `apps/api/src/test-support/route-login.ts` and
  adopted it in eight affected route suites. Actual HTTP login and verification use
  in-memory delivered mail code capture through JSON transport; no DB code lookup,
  minted token, fixture role changes, production auth changes or external mail.
- Prior focused suites passed 110/110, none skipped. Fresh API typecheck, scoped
  ESLint and changed-code Prettier pass. Fresh full sequential API run: 505 tests,
  504 passed, 0 failed, 1 intentional SEC-01 skip, 0 cancelled, exit 0.
- Treatment consent/disposal/POS and package-expiry acceptance pass. Messaging
  ALREADY_REBOOKED test passes without messaging changes; earlier failure cause
  remains unverified. pg concurrent-query deprecation warnings remain non-fatal.
- Resumption found previous temporary logs/cluster missing; no completion inferred
  from that interrupted run. Recreated only the approved disposable loopback
  55440/package_expiry_test database and applied 36 migrations. Full log and exit:
  `/tmp/route-login-full.log`, `/tmp/route-login-full.exit`; migration/cleanup:
  `/tmp/route-login-migrations.log`, `/tmp/route-login-cleanup.log`.
- All fixture tenants and injected disposal triggers counted zero; cluster stopped.
  No application DB access, rollout, real erasure, external mail, commit or push.
- Earlier partial edit/typecheck left an unused catalogue envelope helper; removed it
  rather than suppressing noUnusedLocals. Final API typecheck passes.

## October 22, 2026 — Owner-authorized treatment disposal

- User selected one completed/cancelled treatment per owner (SUPER_ADMIN) action;
  implemented preview + reason + typed DISPOSE confirmation. Ten-minute signed
  preview binds owner/tenant/treatment and record/evidence/photo-link digest.
- Transaction rechecks current owner/2FA/enabled status, writable tenant, treatment
  status, hold, digest and expiry. Tenant/user/treatment/photo locks serialize
  conflicting changes. Ordinary deletion still blocks consent evidence.
- Removes only clinical record, consent chain/signatures and photo links. Preserves
  original customer photos (including shared gallery uses), customer, published
  form versions, appointments and POS/package records. No balance reversal.
- Minimal existing audit receipt records actor/time/reason/counts/treatment reference;
  UI warns against clinical/customer details in the retained reason. No copied notes,
  signatures, form answers or customer/photo IDs. Backup/export erasure excluded.
- PostgreSQL acceptance 3/3, none skipped: consent/status regression, new disposal
  boundaries/tamper/expiry/stale data/evidence/photos/duplicate submission, four
  hold races, audit-failure rollback and unchanged POS sale/redemption/holding.
  Shared 150/150; full web 576/576 (67 files); workspace typecheck, root lint,
  production build and git diff check pass.
  Initial render-time expiry lint failure fixed with effect timer/event-time check.
- Only approved loopback 55440/package_expiry_test fixtures used; cleanup completed,
  injected trigger/function removed and cluster stopped. No new migration, application
  DB, real-record erasure, deployment or commit. Full API suite and agent browser
  walkthrough not run; standing user acceptance applies. Parent remains IN PROGRESS.

## October 22, 2026 — Treatment-status consent gate

- Status-policy slice DONE; TK2610-0025 remains IN PROGRESS, not impossible or
  ready for external closure. User selected the recommended active-form gate.
- API create/update require current active-version grant on entering IN_PROGRESS
  or COMPLETED. Missing active form returns TREATMENT_ACTIVE_CONSENT_FORM_REQUIRED;
  absent/declined/withdrawn/old-version consent returns TREATMENT_CONSENT_REQUIRED.
  Create Scheduled first, capture consent, then transition. Changing type in a
  gated status checks the new type; same-status historical notes remain editable.
  Scheduling/cancellation remain available; withdrawal preserves treatment status,
  including completed records. Signature/correction/tenant rules remain unchanged.
- Tenant SHARE lock precedes treatment locks and conflicts with publishers' existing
  NO KEY UPDATE lock, covering first/new-version publication without lock-order
  cycles. Treatment locks serialize withdrawals with status writes. Tests permit
  either valid serial result, never bypass/rewrite evidence. POS remains sole
  balance owner; session/photo fixture creation changed to Scheduled accordingly.
- UI explains the workflow and preserves denied status/notes drafts; cancellation
  can be retried. No front-end-only security enforcement or new dependency.
- Verified: disposable PostgreSQL consent and POS/photo acceptance 2/2, none skipped;
  four withdrawal/status and four publication/status races, new-version gate,
  historical compatibility, completed withdrawal, tenant/auth/suspension/HTTP errors;
  focused form 11/11; full web 570/570 (66 files); workspace typecheck, root lint,
  production build passed. Existing pg deprecation warning remains. Full API suite
  and agent browser walkthrough not run; standing manual acceptance applies.
- Only approved loopback 55440/package_expiry_test used; fixtures cleaned and cluster
  stopped. No schema/migration, application DB, erasure, deployment or commit.
  Next: decide separate owner-authorized disposal scope, not perform real erasure.

## October 22, 2026 — Consent history pagination

- History pagination slice DONE; parent TK2610-0025 remains IN PROGRESS.
- Shared page/state contracts, validated API paging (20 default, 200 maximum),
  deterministic consentedAt/id ordering and repeatable-read metadata/current heads.
  Treatment detail caps its recent evidence preview at 20, with full history on
  the paged endpoint. API/web must roll out together for the page-envelope change.
- Existing drawer now uses accessible pagination, totals, page-keyed queries,
  retry/return-to-latest controls and independent current chain state for actions.
  Old-page annotations use the actual head/current consent, not an old decision.
  Changing treatment or page resets local history action drafts; errors retain
  drafts on the same page and existing stale-head checks still protect writes.
- Verified: PostgreSQL service/HTTP acceptance 1/1, none skipped (25 tied-time
  events, page coverage, detail cap, current-state consistency, validation/auth/
  tenant regressions); focused UI/hooks 34/34; full web 569/569 (66 files); shared
  149/149; workspace typecheck, root lint and production build passed. Existing
  pg concurrent-query deprecation warning remains. Initial acceptance used 101 as
  an invalid size; corrected to 201 to match the existing maximum of 200.
- Only approved disposable loopback 55440/package_expiry_test used; fixture tenants
  count zero after cleanup, cluster stopped. No schema/migration, application DB,
  erasure, deployment or commit. Full API suite/agent browser walkthrough not run;
  standing user-granted manual acceptance applies. Consent policy and disposal
  remain unresolved and unchanged; neither parent external task is ready to close.

## October 22, 2026 — Append-only consent history and configurable signatures

- W1/S2 implementation slice complete; parent TK2610-0025 remains IN PROGRESS.
  Events now distinguish grant, decline, withdrawal, re-consent and correction.
  Serialized treatment locks, expected previous-event IDs and unique chain links
  reject stale/concurrent writes. Earlier events remain unchanged. Withdrawal and
  manager annotations work against inactive versions; new grants/re-consent require
  an active version. Corrections reference same-treatment/form evidence, require a
  reason and current manager/owner database role, and cannot change consent state.
- UI provides confirmed history actions, annotation reasons/references, original
  wording, stale-history/read-only/role guards and preserved failed drafts. Signature
  requirement is set only by publishing a new form version. Drawn evidence is bounded
  JSON coordinate strokes stored as bytes and rendered as validated polylines;
  arbitrary HTML/SVG/images are refused. Required for grant/re-consent only, never
  decline/withdrawal. This is witnessed drawing capture, not verified identity or an
  external signing-provider integration. Existing versions default to no requirement.
- Added migration 20261022200000_treatment_consent_history; backfills original
  event kinds, removes one-event uniqueness, adds chain/reference constraints and
  database UPDATE guards for event evidence and form wording/signature policy.
  An initial disposable-only migration failure exposed the legacy truncated index
  name; corrected migration and recovered only its partial disposable additions.
  Successful deploy and acceptance rerun followed. No application database touched.
- Verified: PostgreSQL HTTP/service acceptance 1/1, none skipped; shared 149/149;
  final full web 565/565 (66 files), workspace typecheck, root lint and production
  build passed. Added pointer drawing/clear/read-only and safe signature rendering
  tests, history actions/role loss/stale draft tests, immutable-evidence checks,
  concurrent withdrawal and signature/re-consent regressions. Existing pg query
  concurrency deprecation warning remains. Full API suite and agent browser
  walkthrough not performed; standing user-granted manual acceptance applies.
- Disposable loopback 55440/package_expiry_test fixture cleanup verified and cluster
  stopped at handoff. No application migration, deployment, erasure or commit.
  Existing uncommitted changes preserved. Next: history pagination; treatment-status
  requirements and separate disposal authorization/policy remain unresolved.

## October 22, 2026 — Retention and archival management UI

- TK2610-0025 remains IN PROGRESS, not ready for external closure. Added a
  customer-scoped treatment retention drawer with current review/hold evidence,
  reviewer account/time, next review and reasons. Owner/manager writable-salon
  controls require explicit confirmation; hold release is warned separately.
  Staff/read-only users can view evidence. Detail loading/errors/customer mismatch
  block editing; refetch/mutation activity blocks submissions. Failed drafts survive.
- Review scheduling uses the salon timezone, not the browser zone; unchanged review
  timestamps preserve seconds/milliseconds. Editing details resets confirmation;
  record revisions/timezone changes remount the draft. Role/read-only changes remove
  the retention editor or archive confirmation. Held treatment deletion is disabled
  locally; existing server protection remains authoritative.
- Added customer-profile archival with mandatory reason, explicit confirmation,
  refusal/retry and returned archive actor/date/reason. Customer list supports
  Include archived customers and Archived labels. Hooks update detail caches and
  invalidate relevant list/detail queries. UI explains evidence preservation,
  no restoration/disposal, and that archival is not a universal booking/POS/mobile ban.
- Checks: initial focused web 53/53; final full web 556/556 (65 files), including
  added whitespace/held-delete checks. Workspace typecheck, root lint and full
  production build passed. Final scoped format/diff checks recorded at handoff.
- Frontend-only slice; no backend/schema edits this session, database access,
  application migration, erasure, deployment or commit. Existing uncommitted work
  preserved. No API/database acceptance rerun or agent browser walkthrough claimed;
  standing user-granted manual acceptance applies.
- Next: W1 append-only withdrawal/re-consent and manager correction annotations,
  followed by S2 per-form/version signatures. Separate owner-authorized disposal,
  history pagination and treatment-status consent policy remain unresolved.

## October 22, 2026 — Retention and archival backend protection

- TK2610-0025 remains IN PROGRESS. Added manager/owner-only, tenant-scoped,
  writable-account retention-review API with next review date, retention reason,
  authenticated reviewer/time and documented hold. Hold release requires a review;
  review never authorizes disposal. Ordinary clinical edits cannot change these fields.
- Holds block service deletion and database deletion/cascades, including records
  without consent. Consent event parent foreign keys now RESTRICT customer,
  treatment, form and tenant deletion. Existing capture/deletion serialization remains.
- Added explicit manager/owner customer archive API (there was no customer delete
  endpoint to convert). Archive preserves evidence/references and original archive
  actor/time/reason on retries. Default customer lists exclude archived rows;
  includeArchived=true permits discovery and direct detail/history reads remain.
  Archival is a list/lifecycle marker, not a universal booking/POS/mobile-access ban.
- Migration 20261022190000_treatment_retention_protection applied ONLY to approved
  disposable loopback 55440/package_expiry_test. No application migration, data
  erasure, deployment or commit. Initial cluster start omitted port options and
  failed to bind; rerun with explicit approved port succeeded. No default-port DB used.
- Verified disposable PostgreSQL HTTP/service acceptance 1/1, none skipped: review
  permissions/current-role checks, invalid holds, foreign tenant refusal, hold release,
  four hold/delete races, direct parent-delete protection, archival/evidence retention,
  archived-list filtering, suspended writes and existing cancelled-tenant access denial.
  Workspace typecheck/lint, shared 148/148, full web 530/530 (62 files), final
  consent UI 19/19, full production build, scoped Prettier and git diff check passed.
  Disposable cluster stopped after fixture cleanup. Existing pg concurrent-query
  deprecation warning remains.
- Remaining: review/archive UI; separate owner-authorized disposal workflow; review
  audit history if required; W1 append-only withdrawal/re-consent/corrections; S2
  signatures; history pagination/status policy. No full API suite or agent browser
  walkthrough claimed. Standing user-granted manual acceptance applies.

## October 22, 2026 — Consent publication permissions

- Implemented the first P1 slice under TK2610-0025: POST consent forms requires
  SUPER_ADMIN/MANAGER through existing authenticated server-side role middleware.
  Staff reads and grant/decline capture remain available within existing tenant,
  entitlement and writable-account boundaries. Correction permissions await W1.
- UI disables publication for other roles and removes an open editor after role
  loss. Updated explanatory wording to distinguish approved policies from pending
  implementation. Existing uncommitted treatment changes preserved.
- Checks: focused consent UI 19/19; full web 530/530 (62 files); workspace
  typecheck and lint exit 0. Disposable PostgreSQL consent HTTP/service acceptance
  1/1, none skipped: staff publication refusal without inserts, manager/owner
  publication, immediate database-role rechecks, staff capture and existing
  tenant/suspension/deletion-race regressions. Existing pg deprecation warning remains.
- Only approved loopback 55440/package_expiry_test used; matching fixture tenants
  count zero after cleanup, cluster stopped. No application database, schema change,
  migration, erasure, deployment, commit or agent browser walkthrough. Standing
  user-granted manual acceptance applies. Full API suite/build not run this slice.
- Next: R1/D1 retention review/holds and archival protection, then W1/S2 consent
  history and signatures. Parent remains IN PROGRESS, not ready for external closure.

## October 22, 2026 — Treatment consent policy selections approved

- User accepted the recommended R1 / D1 / P1 / W1 / S2 options. Full requirements
  recorded in PROJECT.md; remaining implementation/checks recorded in TASKS.md.
- Approved: manual retention review with review date/reason and retention holds;
  archive protected customers and disable closed tenants, with separate authorized
  erasure; managers publish forms/authorize correction annotations and treatment-access
  staff capture decisions; append-only withdrawal/re-consent/corrections; signatures
  configurable per form/version, required only for grant/re-consent when configured.
- No fixed retention duration or automatic purge approved. This is a product-policy
  decision, not legal sign-off, implementation or authorization to erase data.
- Documentation-only update; existing uncommitted application changes preserved.
  Runtime behavior and database cascades unchanged. No migration, deployment or commit.
  TK2610-0025 remains IN PROGRESS; not ready for external closure.

## October 22, 2026 — Treatment consent deletion protection

- User selected: block treatment deletion when consent evidence exists; leave other
  behavior unchanged. TK2610-0025 remains IN PROGRESS. This is not a complete
  retention policy or permission/signature/withdrawal decision.
- deleteTreatmentRecord now checks for any grant/decline evidence transactionally
  and returns 409 / TREATMENT_HAS_CONSENT_EVIDENCE. It takes the same tenant-scoped
  treatment-row lock as capture, preventing a successful capture from being lost
  through concurrent treatment deletion. No-evidence treatment deletion is unchanged.
- Consent drawer and deletion confirmation explain protection. Existing deletion
  error handling keeps a refusal visible. Preserved all prior uncommitted consent
  UI work. Customer/tenant deletion and database cascades remain unchanged; no
  archival, automatic retention or direct-database protection is claimed.
- Verification: isolated PostgreSQL consent service/HTTP acceptance 1/1, none
  skipped, with protection for grants and declines, evidence preservation, ordinary
  deletion, auth/tenant/suspended-write checks and four capture/delete races. Full
  web 527/527 (62 files), root lint and full production build passed. Initial build
  found an inference error in the added race test; explicit result typing fixed it.
  Final acceptance/lint/type/format/diff checks recorded at handoff.
- Reused approved disposable loopback 55440/package_expiry_test only; fixtures
  cleaned by acceptance. Existing pg concurrent-client deprecation warning remains.
  No application database access, migration, full API suite, deployment, commit or
  agent browser walkthrough. Standing user-granted manual acceptance applies.
  Logs: /tmp/glampro-consent-protection-{db,web,build,lint}.log.

## October 22, 2026 — Customer-profile treatment consent UI completed

- TK2610-0025 remains IN PROGRESS. Added a per-treatment consent drawer within the
  existing treatment-entitled customer profile. Fresh-detail/customer matching
  precedes form/history queries. Read-only salons can view forms and evidence but
  cannot publish or record decisions. Existing role/API boundaries are unchanged.
- New TreatmentConsent component previews active and inactive versions, publishes
  salon-wide active versions after draft preview and explicit confirmation, and
  leaves version allocation to the server. Editing wording resets draft preview;
  failed publication preserves the draft. Form hook accepts input without version.
- Grant/decline requires explicit confirmation against the displayed active form;
  authenticated server witness is authoritative. Existing one-decision-per-record/
  form rule is preserved. History-loading/errors and query refreshes block capture;
  changing the active form invalidates the displayed confirmation. Failed capture
  refreshes form eligibility and evidence before retry. Successful capture blocks
  another local decision even before evidence refetch completes.
- Evidence shows original form title/version/plain-text wording, salon-local time,
  witness account ID, evidence reference and signature availability. Missing wording
  is disclosed rather than substituted with current text. No signature UI or new
  withdrawal, correction, retention, access or treatment-status policy was added.
  Current deletion cascade is disclosed in the consent UI and delete confirmation.
- Verified: full web suite **526/526**, 62 files, none skipped; root lint exit 0;
  full production build exit 0 (shared, Prisma generation, API and web TypeScript,
  Vite). Initial focused run caught two ambiguous text queries in tests, corrected
  before the passing full runs. Added component/profile/cache tests cover explicit
  decisions, cancellation, versions, draft preview/publication/retry, original
  evidence, duplicates, read-only transitions, active-version changes, query
  failures and invalidation. Final format/diff checks recorded at handoff.
- Logs: /tmp/glampro-consent-ui-{web,build,lint-final}.log. No database acceptance
  rerun (backend unchanged), application database access, migration, deployment,
  commit or agent browser walkthrough. Standing user-granted manual acceptance
  applies; this does not close unresolved parent-task requirements.

## October 22, 2026 — Consent integrity/contracts completed

- TK2610-0025 stays IN PROGRESS; this completes only the backend/contracts slice
  selected after the audit. TK2610-0027 stays IN PROGRESS. Neither external ID is
  ready for closure. Existing uncommitted photo changes were preserved.
- Fixed active-form parameter schema and shared list-filter validation (including
  repeated/invalid filter refusal). Event requests no longer require/trust a client
  witness; JWT remains authoritative, and the URL owns the treatment ID. Non-null
  signature submissions now return validation errors rather than silently losing
  data. Signature capture is still not implemented; null remains compatible.
- Event creation checks tenant-scoped customer/record/form existence, matching
  customer and treatment type, and active-form eligibility within a transaction.
  Treatment and form row locks serialize clinical edits/publication against consent
  creation. Duplicate decisions return CONSENT_EVENT_EXISTS, including concurrent
  requests; existing one-decision-per-treatment/form policy is unchanged.
- Form version allocation, deactivation and insertion are atomic. A tenant-row
  FOR NO KEY UPDATE lock serializes publishers even for the first version without
  blocking tenant foreign-key checks during concurrent consent insertion. This is
  intentionally coarse per tenant; no new dependency or migration. Failed insertion
  rolls back deactivation. Version numbers remain server-assigned.
- Treatment detail and event responses preserve original form text/version with
  serialized timestamps; history has stable date/id ordering. Missing/foreign
  parent history returns 404. Form hooks now separate type/active filter caches.
- Added dedicated treatment-consent acceptance, shared schema and hook cache tests.
  Passed fresh: isolated PostgreSQL consent HTTP/service acceptance 1/1 and existing
  session/photo acceptance 1/1 (none skipped); full shared 146/146; full web 507/507;
  full production build, API typecheck and root lint. Final format/diff checks at
  handoff. Acceptance covers same/cross-tenant refusals, grants/declines, witness and
  URL spoofing, unsupported signatures, auth/entitlement/suspended-write boundaries,
  original evidence, concurrent first/later publication, duplicate decisions,
  publication-versus-recording and failed-publication rollback.
- Reused only approved disposable loopback 55440/package_expiry_test. Both acceptance
  fixtures cleaned (zero matching tenants); existing pg concurrent-query deprecation
  warning remains. Full API suite and browser walkthrough were not run. Manual
  acceptance is standing user-granted, not agent-executed. No application/production
  database changes, schema migration, deployment or commit.
- Remaining: consent profile UI, retention (deletion still cascades), narrower role
  permissions, repeat/withdrawal policy, history pagination and treatment-status
  consent requirements. Historical audit findings below are superseded only for the
  fixes above. No retention or clinical-policy changes are implied by this slice.
  Logs: /tmp/glampro-consent-{db-final,session,shared,web,build,api-types,lint}.log.

## October 22, 2026 — Treatment-consent/customer-profile audit

- Audit only; no application code or schema changes. Both TK2610-0025 and
  TK2610-0027 remain IN PROGRESS, not ready for external closure. Existing
  uncommitted photo-tagging changes were preserved. Prior acceptance is not
  evidence that the consent workflow below is implemented or verified.
- Confirmed foundation: four treatment models are tenant-scoped; consent routes
  require authentication/treatment entitlement and writes require a writable tenant.
  Event actor is taken from JWT, not the submitted actor. Form content has no API
  update/delete route; each version is a separate row. CustomerProfile mounts the
  treatment list only when entitled, but none of the four consent hooks has a UI
  caller. Profile privacy/photo consent is not a treatment-consent interface.
- High-priority integrity gaps (source inspection): recordTreatmentConsentEvent
  verifies record/form/customer existence separately, but not customer equality,
  treatment-type equality or active-form eligibility. A different customer in the
  same tenant or unrelated/inactive form can therefore be recorded. Cross-tenant
  lookup filtering exists; fresh consent-specific HTTP/DB isolation tests were not
  run. No grant/decline requirement gates treatment status changes.
- Retention gap: deleteTreatmentRecord hard-deletes; the event foreign key uses
  ON DELETE CASCADE, so deleting clinical documentation deletes consent evidence.
  Customer/form deletion also cascades. Append-only comments do not establish
  retention. All authenticated salon roles can publish forms, record consent and
  delete treatments under current routes; no narrower clinical role check exists.
  Resolve desired retention/access policy before implementing a migration.
- Executable contract probes confirmed four defects: active-form URL supplies
  treatmentType but idParamSchema requires id; treatmentRecordSchema omits and
  strips consentEvents despite the detail include; treatmentConsentEventSchema
  omits and strips included form title/content/version; request schema requires
  consentedById although the route uses JWT actor. Signature input is accepted but
  the service always stores/returns null (source inspection), not signature capture.
- Publication/race gaps (source inspection, not reproduced under concurrency):
  latest-version read, active-version deactivation and form insert are separate
  operations. An insert failure can leave no active form; concurrent publication
  can collide on the version unique key. Event precheck/insert also races; no P2002
  mapping provides a stable duplicate conflict. Unique treatment/form constraint
  prevents a second decision for that pair; no withdrawal/correction workflow exists.
- Client gaps: useConsentForms uses the same domain key for every type/active
  filter. Form list query uses unchecked casts; invalid/repeated filters have no
  shared validation. History is unpaginated; missing/foreign treatment IDs return
  an empty event list rather than checking parent existence. These need explicit
  contract choices and coverage, not inferred completion from passing older suites.
- Remediation order: (1) ownership/type/eligibility checks, route/request/response
  contracts and safe publication/duplicate handling with dedicated HTTP/DB tests;
  (2) resolve retention, permissions and repeated-decision policy; (3) profile form
  authoring/version preview, explicit grant/decline, original-form evidence history,
  filter-specific keys, read-only controls and retryable failures; (4) rerun relevant
  automated acceptance before reassessing parent readiness. No new task IDs added.
- Passed fresh: focused web 28/28 (CustomerProfile, CustomerTreatmentList,
  TreatmentRecordForm, TreatmentPhotoTagger); shared customer/session contracts
  19/19, none skipped; four temporary contract probes (exit 0). These confirm the
  existing adjacent UI and the reproduced contract defects, not consent acceptance.
  Profile tests mock the treatment child; no end-to-end consent coverage is claimed.
  Logs: /tmp/glampro-consent-audit-{web,shared,probes}.log; probe script remains
  outside the repository at /tmp/glampro-consent-audit-probes.ts.
- No database commands, migrations, browser walkthrough, full API suite, application
  deployment, commit or external tracker changes. Documentation checks recorded at
  handoff; user-granted manual acceptance does not close missing implementation.

## October 22, 2026 — Before/after photo-tagging integration completed

- Treatment history now opens a before/after drawer using fresh treatment details.
  Shared contracts retain photo metadata and list/detail/create/update serialize
  timestamps. Tagged photos remain visible independently of gallery pagination;
  one-before/one-after controls, read-only viewing and retryable load/mutation errors
  are wired. Private authenticated blobs are revoked on unmount.
- API rejects photos belonging to another customer, scopes removal to the URL
  treatment and maps duplicate-type races to 409. Removed unnecessary full photo
  byte fetch on tagging. Untagging and treatment deletion preserve original photos.
  Existing upload-consent and retained-photo rules are disclosed, not changed.
- Passed: full web 506/506, shared 143/143, expanded isolated PostgreSQL linkage/photo
  HTTP acceptance 1/1 with none skipped, final full production build, API/web
  typechecks and root lint. Six added UI tests; DB coverage includes customer/tenant
  refusal, duplicate races, retained metadata on edit, scoped untag, auth, suspended
  writes and original-photo preservation. Initial checks passed; final inspection
  caught create/update timestamp serialization, fixed and rerun successfully.
- Reused only approved disposable loopback 55440/package_expiry_test; tests clean
  fixtures. Existing pg concurrent-client deprecation warning remains. No full API
  suite or agent browser walkthrough; manual acceptance is standing user-granted.
  No migration, application database change, commit or deployment.
- Both external parents remain IN PROGRESS. Next is consent-workflow audit under
  TK2610-0025, not an assumption that historical consent work meets completion.
  Logs: /tmp/glampro-photo-{web-full,shared,db-final,build-final,lint}.log.

## October 22, 2026 — Usable POS redemption selector completed

- Added shared query/option contracts, read-only GET /api/treatments/redemptions
  before /:id, treatment query hook and TreatmentRedemptionPicker in the treatment
  form. Customer-scoped, stable paginated evidence shows receipt, salon-local date,
  package, covered service and whole-redemption quantity. New records get the
  service from their selection; edits are filtered to their immutable service.
- Filters require a matching customer holding/package, completed sale, covered
  service on that sale, unreversed redemption and no existing treatment link.
  Expired holdings remain valid historical evidence. No reservation or balance
  mutation; existing transactional save-time guards handle races and duplicate use.
- UI covers empty/loading/error/retry/pages, customer-reset selection, explicit
  unlink and preservation of current unavailable/reversed evidence. Historical
  quantities and unchanged timestamps remain preserved. Manual acceptance granted
  by standing user instruction; no agent browser walkthrough.
- Passed: isolated PostgreSQL sale/linkage/HTTP tests 56/56 (none skipped), full
  web 500/500, shared 143/143, production build and root lint. Added five UI tests,
  two shared contract tests and expanded DB acceptance for listing, paging,
  customer/tenant/service filtering, linkage/unlink/reversal, auth and entitlement.
  Initial HTTP fixture assumptions (seeded core module; validation status 422)
  corrected and rerun. Existing pg concurrent-client deprecation warning remains.
- Reused only approved disposable cluster at loopback 55440/package_expiry_test;
  fixtures cleaned by tests. No application DB migration, commit or deployment.
  Logs: /tmp/glampro-picker-{full,focused,db}.log. Photo-tagging is next; both
  parent external tasks remain IN PROGRESS.

## October 22, 2026 — Standing manual acceptance recorded

- User accepts manual tasks when agent work is complete. Recorded the standing
  acceptance rule in PROJECT.md and TASKS.md, preserving implementation, automated
  verification and operational evidence requirements.
- Recorded user-reported completion of treatment-link application migration,
  browser acceptance and privacy/access/consent review. Historical pending notes
  below are superseded by this update, not evidence of new agent-run checks.
- Documentation only; no application code, database or external tracker changes.

## October 22, 2026 — Customer-profile treatment workflow wired

- Mounted treatment history only after successful treatment-module entitlement lookup.
  Added create/edit drawers, confirmed selected-record deletion with failure/retry,
  server pagination, salon-local display and read-only write controls. Profile
  creation locks the selected customer. Unsupported edit reference fields are disabled.
  Removed the inert photo-tagging button; integration remains unfinished.
- Fixed date/time contract mismatch: accept UTC instants alongside legacy dates;
  form converts salon-local input to UTC and omits unchanged times from patches
  to preserve seconds and historical values. No balance service changes.
- Passed: focused web tests 17/17, full web 495/495, shared 141/141, full build
  (including API/web compilation) and API typecheck. Initial build exposed nullable
  API references incompatible with create input; explicit normalization fixed it.
  Scoped lint/format and final diff checks recorded with verification logs under
  `/tmp/glampro-treatment-ui-*`.
- No application database migration, live browser acceptance, commits or deployment.
  Parent task remains IN PROGRESS; redemption picker, photo-tagging wiring and broader
  clinical privacy/consent review remain, in addition to linkage rollout acceptance.

## October 22, 2026 — POS-owned treatment session linkage implemented

- User selected POS-only deductions. Added unique whole-redemption treatment link,
  derived quantity and holding, same-customer/tenant/service validation, reversal
  refusal and duplicate protection. No linking/editing/deleting balance mutation.
  Reversed evidence stays visible; unlinked historical quantities are preserved.
- Typed PATCH contract replaces the unsafe cast; explicit null clears notes/link.
  Form requests POS evidence instead of a deduction quantity. Fixed empty required
  customer-name blocker using an honest customer-reference input. List discloses
  POS-linked/reversed versus historical unverified quantities.
- Added forward migration `20261022160000_treatment_pos_redemption_link`; no backfill.
  Added shared/form tests and opt-in exact-target isolated DB acceptance covering
  ownership, service mismatch, duplicate/concurrent linking, quantity mismatch,
  reversal, cancellation/unlink/delete and historical preservation.
- Passed: DB sale/linkage 56/56; final isolated acceptance 1/1; shared 140/140;
  web 486/486; full build, API/web typechecks, scoped ESLint/Prettier, diff check.
  Concurrent test emits pg driver query-serialization deprecation warning; tests
  pass, no dependencies changed. Earlier form failures fixed, not suppressed.
- Migration verified only on disposable loopback 55440/package_expiry_test.
  Application migration/browser acceptance pending for this new linkage slice.
  No application/production DB writes, external mail, commits or deployment.
- Remaining: treatment-list action buttons are not wired, no redemption picker,
  broader aesthetics privacy/access claims still need review. Do not mark either
  full external TK2610-0025 or TK2610-0027 complete on this slice's evidence.

## October 22, 2026 — Expiry accepted; treatment-session follow-up scoped

- User explicitly confirmed application migration and browser checks are complete
  and accepted the expiry slice. This is user-reported verification, not an agent
  migration/application inspection or browser walkthrough. Expiry slice is DONE;
  full external TK2610-0025/0027 scope remains unfinished, not ready for closure.
- Read current treatment create/update, form, contracts, package relation and POS
  redemption paths. Treatment stores an editable quantity without decrementing a
  holding; form hint claims deduction. POS already consumes package sessions.
- Next bounded deliverable: treatment-session integration under TK2610-0025.
  Blocked on ownership policy: link treatments to existing POS redemptions versus
  independent treatment deduction. Must avoid consuming the same session twice;
  independent deduction also needs cancellation/edit/retry behavior defined.
- No runtime changes or new test runs in this handoff; code inspection and tracking
  validation only. Existing automated expiry results remain historical evidence.

## October 22, 2026 — Approved purchase-based package expiry implemented

- User approved optional validity days from completed purchase, existing holdings
  unchanged, no family-wide expiry changes. Exact 24-hour days; null never expires.
- Added nullable catalogue validity and bounded SQL checks in forward migration
  `20261022120000_package_validity_days`; shared contracts, session-package editor,
  owner/manager prepaid validity endpoint and holding expiry snapshots. Both direct
  and held-sale completion use completed `soldAt`; no holding backfill or write-off.
- Added pure boundary/validation tests, editor tests, real-DB purchase/held-cart
  regression and opt-in isolated endpoint acceptance. Acceptance verifies auth,
  role/module/suspension gates, foreign-tenant refusal, rule clearing, unchanged
  foreign rows and consistent spendable-holdings/liability exclusion of expiry.
- Passed: sale/package/customer services 80/80 (real DB); isolated endpoint 1/1;
  shared 139/139; web 483/483; full build, API/web typechecks, scoped lint/format and
  diff check. Initial test fixture typing/auth issues corrected before final pass.
- Broader package/report route run: 82/93 pass, 11 fail because old owner-login
  helpers do not complete mandatory SEC-01 2FA. Left unrelated suites unchanged.
  Root-invoked cross-workspace ESLint had config-root ambiguity; per-workspace
  scoped ESLint passed without config changes.
- Disposable loopback PostgreSQL cluster on 55440, `package_expiry_test`, migrated
  and tested only; fixture removed and cluster confirmed stopped. No application/production migration, external email, deployment
  or browser acceptance. TK2610-0025/0027 are not ready for external closure.
- Next: authorized application migration/browser acceptance for this slice, then
  separately scope remaining shared pool, transfer/audit and treatment consumption.

## October 22, 2026 — Package-expiry scope review

- Inspected the original product-review expiry requirements, shared/model structure,
  package grants, POS redemption, customer holdings, liability filtering and treatment
  creation. The source review names expiry but specifies no duration/start policy.
- POS already refuses stored expiry at `expiresAt <= usedAt`; spendable holdings and
  liability reads exclude expired rows. Session/prepaid purchase grants leave expiry
  unset, with no configurable validity rule. Treatment creation stores quantity but
  does not validate or consume a package holding. Family-pool redemption claimed in
  TK2610-0027 is absent from the current selected-holding redemption path.
- Withdrew unsupported task completion claims: TK2610-0025 IN PROGRESS;
  TK2610-0027 BLOCKED pending expiry policy. Neither external ID is ready to close.
- Proposed slice: optional per-package validity days from completed purchase, null
  means never expires, existing holdings unchanged, no family expiry propagation or
  write-off. No policy or runtime behavior changed pending confirmation.
- Verification: read-only code/source-document inspection and tracking diff review
  only; no runtime tests, database access, migrations or application changes.
- Preserved existing dirty tracking files and untracked authentication acceptance
  test. `rg` is unavailable; used targeted `grep`/file reads instead.

## October 22, 2026 — SEC-01 user acceptance and closure

- User explicitly confirmed "manual browser/user is accepted." SEC-01 marked DONE
  using the prior automated evidence and user-reported manual acceptance. No agent
  browser walkthrough, new test run, production rollout or account audit claimed.
- Prior checks: isolated DB/local SMTP acceptance 1/1, authentication regression
  38/38, Login/Settings UI 32/32, API typecheck and new-test lint/format passed.
- Production SMTP/account review and unrelated whole-API treatment lint failure
  remain disclosed. This closes SEC-01 only, not the P2 phase or grant task.
- Next: package-expiry work in TK2610-0025/TK2610-0027; not started this turn.

## October 22, 2026 — SEC-01 isolated database/SMTP acceptance

- Added opt-in apps/api/src/routes/auth-security.acceptance.test.ts. Requires
  SEC01_ACCEPTANCE=1 and asserts the exact disposable loopback database target
  before importing persistence. SMTP capture binds only loopback and never forwards;
  messages/codes stay in memory. No new dependencies or runtime behavior changes.
- Independent PostgreSQL 18 cluster initialized under a private temporary directory;
  all migrations applied to sec01_acceptance on port 55439. No application database
  reset, migration, seed or account changes. Test fixture removed; cluster stopped.
- Real database/SMTP acceptance 1/1; authentication regression 38/38 (no skips);
  Login/Settings UI 32/32. API typecheck, new-file lint/format and diff check pass.
- Verified mandatory owner email challenge, captured SMTP code, hash storage,
  single-use code, owner disable refusal, weak-password rejection, access/refresh
  revocation after password change and optional staff enrollment/login/disable.
- Remains IN PROGRESS for manual browser/user acceptance. Production provider
  delivery and account audit not performed; whole-API treatment lint issue remains.
- Next: manual acceptance decision for SEC-01; package expiry not started.

## October 22, 2026 — SEC-01 acceptance prerequisite check

Superseded prerequisite blocker: user subsequently approved isolated resources;
automated acceptance completed below. Earlier evidence is retained historically.

- Read-only, secret-safe configuration inspection found local application database
  `glampro_suite`, no TEST_DATABASE_URL and no SMTP_HOST. Did not use application
  data for tests or send external email. No migrations, seeding or account changes.
- Reran isolated mocked API/seed security tests: 15/15 pass, no skips. Focused
  Login/Settings UI tests: 32/32 pass. API/web typechecks and focused security API
  lint pass. These checks do not establish real-DB, SMTP or manual browser acceptance.
- SEC-01 marked BLOCKED pending approved disposable database and SMTP inbox.
  Package-expiry work remains next and was not started while this gate is blocked.

## October 22, 2026 — SEC-01 authentication implementation

- Added explicit challenge/session contracts, web verification and optional Settings
  enrollment. SUPER_ADMIN always verifies an email code; unenrolled legacy sessions
  cannot refresh/access protected routes. Owners cannot disable 2FA.
- Crypto-generated codes/challenges, purpose-bound hashes, conditional single-use
  consumption and pending-code invalidation on password change/forced sign-out.
  Removed code logging/return. No schema migration required.
- New/change owner passwords require 12 characters and reject defaults. Production
  seed validates explicit non-demo email/password before writes; NODE_ENV=production
  cannot select development crew. Existing accounts/passwords were not changed.
- Verified: full web 481/481, shared 136/136; API/web typechecks, production web build,
  web lint and changed API file lint pass. Focused API/seed security unit tests use
  mocked persistence/mail, not a database: final focused run 15/15 passed, no skips.
  Final diff whitespace check passed. Whole API lint has an unrelated existing
  no-explicit-any error at treatment.service.ts:174; intentionally untouched.
- No migrations, seeding, database tests, deployment, commits, real email or manual
  browser walkthrough performed. Full API integration suite not run because it can
  load the application DATABASE_URL; no disposable database was established here.
- SEC-01 stays IN PROGRESS pending real-DB and SMTP/browser acceptance. Production
  audit/disable of test accounts remains an explicit operator action, consistent
  with the earlier recorded decision to retain them. Coordinate web/API rollout;
  owners need accessible email and SMTP before enabling this release.

## October 20, 2026 — TK2610-0020 UAT acceptance and local migration status

- User accepted UAT and subsequently reported running `npx prisma migrate`. The exact migration subcommand was not supplied.
- Read-only workspace migration-status command reports PostgreSQL `glampro_suite`, public schema, `localhost:5432`, 28 migrations found and database up to date. Terminal integration did not provide a reliable exit status; the Prisma status output was captured. This is migration-history evidence, not a schema-drift check, production rollout or post-migration smoke test.
- No migration or activation was run by the agent. No new application tests were run for this documentation update. The simultaneous-request staff/resource race remains unchanged; TK2610-0020 stays IN PROGRESS pending resolution of its concurrency criterion.

## October 20, 2026 — TK2610-0020 Phase D rooms/equipment

- User explicitly selected **A — full slice**. Added tenant-scoped `Resource` and `ServiceResource`, shared contracts and migration `20261020200000_resources`; appointment lines expose nullable resource ID/name. One row per physical resource, unique tenant/name; deletion FK is SET NULL, management archives by status.
- Service links are an eligibility set: each occupying line selects **one** active free room/equipment in name/id order. No links means no resource required. Half-open overlap, all non-cancelled statuses occupy; per-line windows and per-occurrence checks. Later series resource conflicts skip/report rather than aborting the series.
- `/api/resources`: member GET list/detail; SUPER_ADMIN/MANAGER POST/PATCH with entitlement and writable-tenant checks. Resource `serviceIds` replaces eligibility; foreign service references refused. No separate service-resources endpoint or DELETE. Join rows are created at top level inside a transaction so tenant stamping runs (nested creates do not receive extension stamping).
- Settings card supports room/equipment creation, editing, archive and eligibility. All catalogue pages, including retired services, load before editing; later-page errors block edits rather than showing a partial set. Drawer displays booked resource names without manual selection.
- Added equipment/multi-line conflicts, notes-only and archived-history preservation, cancellation, reschedule/reassignment, reactivation refusal, tenant read/write/create stamping, foreign eligibility references, drawer display and catalogue-pagination/error tests. Existing Settings page mocks now cover the new card queries.
- Checks: focused resource service/routes/tenant isolation **35/35**; full API **463/464** (no skips), web **474/474** across 55 files, shared **130/130**. Only API failure: pre-existing messaging quiet-hours test, expected `ALREADY_REBOOKED`, actual null. An earlier API run overlapped Prisma generation and hit a missing generated module; the final run did not overlap generation and has no such failure.
- Workspace typechecks, lint and build passed; web typecheck/lint rerun after the catalogue fix passed. Touched-file Prettier, Prisma validation and `git diff --check` passed. Removed unrelated whole-schema formatting churn introduced by Prisma format.
- Database verification used only `glampro_tk0020_d` and newly created `glampro_tk0020_d_replay`. Fresh `migrate deploy`, zero-drift schema diff, validation and seed twice passed; replay DB had 13 appointments / 13 lines / 0 missing lines. Both disposable databases were dropped after checking for active sessions; catalog verification confirms neither remains. Final web production build also passed after the catalogue fix. No application database changes, commit or deployment. No browser UAT claimed.
- Residuals: concurrent overlap race unchanged (no EXCLUDE); existing lines without resources are not retroactively assigned; archive retains the resource relation/name, not a name snapshot (renaming changes the displayed name). Eligibility does not model simultaneous room-plus-equipment needs. Overall task remains IN PROGRESS for UAT/rollout and unresolved concurrency completion criterion.

## October 20, 2026 — TK2610-0020 Phase C recurring series

- Scope chosen by the user: Phase C first, then Phase D in the same session only
  if C landed clean. C landed; D was not started because it is a separate
  greenfield resource model and was not part of that authorization.
- Model: a series is the **rule only** — `AppointmentSeries` holds `intervalWeeks`
  (1–8) and `occurrences` (2–52); each occurrence is a normal `appointment` row
  carrying `seriesId` + `seriesIndex`, with its own lines, so every existing
  reader and the per-line clash rule work unchanged. The FK is `SET NULL` on
  delete: retiring a rule must never delete the bookings it produced.
- Step: `addWeeksInZone` moves the anchor by whole weeks and then corrects by how
  far the zone's own offset moved the wall clock (folded modulo a day, so a shift
  across local midnight is not read as a 23-hour error). Unit-tested in
  `wall-clock.test.ts` for both DST directions and the midnight case.
- Create semantics: the anchor is booked normally (a clash is a `409`, and a
  refused anchor writes no rule row); later occurrences are skipped, not fatal,
  on `APPOINTMENT_CLASH`/`STAFF_UNAVAILABLE`, and the response's `series` block
  reports `created` + `skipped[{ startsAt, reason }]`. Everything is written in a
  single transaction. `data` in the response is still the anchor booking, so no
  existing client changed shape.
- Exit: `POST /api/appointments/series/:id/cancel` cancels future `SCHEDULED`
  occurrences only (completed and no-show history is never rewritten) and returns
  `{ cancelled }`; a second call is a `0` no-op. Tenant scoping makes another
  salon's series a `404`.
- UI: the drawer gains a Repeat fieldset on create (weekly / 2 / 4 weeks, 2–26
  bookings), an "info" toast naming the dates it had to skip, and — on an
  occurrence — a "Part of a repeating series — every N weeks, booking X of Y"
  note with "Cancel the rest of the series".
- Also fixed (Phase B omission found by the full typecheck): two
  `calendar-geometry.test.ts` fixtures were missing the now-required `services`
  array.
- Verified on disposable PostgreSQL `glampro_tk0020_c` (dropped afterwards):
  migrations from empty, `migrate diff` empty, seed → 13 bookings / 13 lines;
  API 440/441 (the one failure is the quiet-hours/time-of-day flake above), web
  465/465, shared 122/122; API/web typecheck, workspace lint, touched-file
  Prettier, `prisma validate` and `git diff --check` clean.
- Known limits: a series is not editable as a whole (edit one occurrence, or stop
  the future ones); no "skip this date" exclusions; recurrence is weeks-only (no
  monthly/two-weekly-with-skip rules); each occurrence queues its own message
  jobs, so a long series queues many; the concurrent-overlap race and the missing
  Postgres `EXCLUDE` constraint are unchanged (ADR 0014); application DB not
  migrated, no commit, no deployment.

## October 20, 2026 — TK2610-0020 Phase B multi-service bookings

- User chose Phase B (multi-service lines) as the next slice. Design: a booking is an ordered chain of `AppointmentLine` rows rather than a join table with derived times, because the overlap rule can then ask Postgres which line collides without replaying durations, and a line keeps its window when a later one is removed.
- Schema/migration: `appointment_lines` (`id`, `tenantId`, `appointmentId`, `serviceId`, `staffId?`, `position`, `startsAt`, `endsAt`, `durationMinutes`), unique `(appointmentId, position)`, index `(tenantId, staffId, startsAt)`, check `endsAt > startsAt AND durationMinutes > 0 AND position >= 0`; migration `20261020155000_appointment_lines` backfills one line per existing booking with a deterministic id, falling back to the window length when `durationMinutes` was null (verified by re-running the SQL over a hand-seeded legacy row).
- Model compatibility: `Appointment.serviceId`/`staffId`/`durationMinutes` are line-0 mirrors and `endsAt` is the last line's end; `toSummary` reads line 0 and falls back to the flat columns for rows without lines, so the list, calendar, messages and receipts keep working unchanged.
- Service: `planLines` resolves each service, checks the performer against that line's service, chains windows from `startsAt`; `assertStaffFree` and `assertNoClash` run per line (with an appointment-window fallback for rows with no lines); `createMany`/`deleteMany` rewrite the chain only when it actually changed; `AppointmentLine` added to `TENANT_SCOPED_MODELS`.
- PATCH semantics: `services` replaces the chain, `serviceId` is the single-service form, both at once is a 422; a booking-level `staffId` move applies to line 0 only, and lines keep their own performer.
- UI: the drawer's single Service/Performer pair became an ordered list with "Add service"/"Remove", per-line performer filtering and a summed end-time preview; the first row keeps the old labels so the existing form tests still describe the same control.
- Checks run: appointment service suite 22/22, appointment routes 9/9, `prisma.test.ts` 4/4, tenant isolation now covers `AppointmentLine`; full API 429/429 and web 461/461 on `glampro_tk0020_b`; API/web typecheck; API/web lint; Prettier on every touched file; `prisma migrate deploy` from empty and `migrate diff` empty; `prisma db seed` twice → 13 bookings, 13 lines, 0 without lines. Disposable DB dropped; application DB untouched.
- Known gaps: true concurrent overlap still needs a Postgres `EXCLUDE` constraint (ADR 0014). No browser walkthrough claimed; the drawer was verified through its rendered tests only.

## October 20, 2026 — TK2610-0020 Phase A booking lifecycle

- Assessed before editing: multi-service, recurring series and rooms/equipment do not exist (one `Appointment.serviceId`, no series or resource model). Phase A therefore fixed lifecycle defects only and did not invent schema.
- Fixed: creating on an inactive service returns `SERVICE_INACTIVE` naming `serviceId`; PATCH keeps retired services editable because active status is required only when `serviceId` changes; rows created already `CANCELLED` skip roster and clash checks (parity with PATCH, ADR 0014 §3); clash messages quote the tenant's zone via new `lib/salon-clock.ts`, reused by staff availability; performer refusals carry `details[0].path = "staffId"` so the drawer marks Performer.
- Undocumented `191a1e3` behaviour (duration snapshot on reschedule, resize clash, status-reactivation clash) is now covered by regression cases, plus cancelled-create parity, salon-zone message, performer details and the route's inactive-service envelope.
- Checks: appointment service+routes 24/24, sale suite 54/54 alone, full API 422/422 on rerun (one unrelated sale flake on the first), web 460/460, typecheck/lint/Prettier/`prisma validate` clean. Disposable `glampro_tk0020_a`; application DB untouched.
- Not done: Phases B–D, Postgres exclusion constraint, commit, deployment.

## October 20, 2026 — TK2610-0021 code handoff

- User accepted UAT on October 20, 2026 for approved code/documentation scope. This is user-reported acceptance, not agent-observed UAT or verified live delivery. No application migration or activation authorized or performed by this acceptance.
- Implemented WhatsApp/SMS settings and channel consent UI, immutable channel evidence, one explicit preferred automatic channel and withdrawal propagation on phone/data/marketing changes. Twilio credentials stay operator-managed, never frontend settings.
- Added durable transactional booking jobs, independent worker with conditional claims and customer/booking locks, dispatch-time eligibility checks, stale-link/job invalidation, bounded rate-limit retries, uncertain-send/restart handling and monotonic signed callbacks. Explicit receipt channel selection is deduplicated; existing email receipt behavior unchanged.
- Added hashed expiring secure receipt and action links with revocation, attendance confirmation separate from lifecycle, customer cancellation confirmation/cutoff, minimal no-store/no-referrer public HTML, signed STOP and secure one-way-SMS unsubscribe links. Uncertain sends retain committed usable links.
- Added `docs/whatsapp-sms-integration.md`: secrets, origin/proxy/log redaction, salon-owned senders, WhatsApp sandbox/onboarding/template mappings, Singapore SMS registration, worker commands, consent/retention limitations, troubleshooting and explicit real-device activation checklist. Both channels and global worker disabled by default.
- Checks: 24 focused messaging tests; full API 415/415 no skips; web 459/459; shared 116/116. Workspace typecheck, lint and full build exit 0. All 25 migrations replayed to disposable PostgreSQL at port 55461, current status and empty DB/schema diff; built disabled-worker smoke check passed. API emits existing pg concurrency deprecation warnings. No application migration, real provider calls, browser/manual UAT or production verification.
- Remaining operations: authorized credential/sender/template setup, approved consent/retention policy, HTTPS/proxy redaction and test-handset live checklist. No automated retention purge or provider exactly-once promise. npm audit reports 12 findings (2 critical, 8 high, 2 moderate); Twilio and xmlbuilder are the only lockfile additions and are not among reported affected packages. No audit fix, commit, deploy or external tracking update.

## October 20, 2026 — TK2610-0019 closure

- Reproduced paid-commission deletion with new regression tests before fixing `reverseForVoid`. Paid records now retain amount/rate/payment date and require reconciliation; unpaid rows are removed in the same transaction. Report reconciliation includes VOID sales by void date without adding paid rows to earned totals.
- Added unpaid-only, paid-only and mixed regression cases covering concurrent/later void retries, exact paid-row preservation, report-date boundaries and earned-commission exclusion. Existing paid/unpaid refund regression still passes.
- Checks: sale suite 54/54; full API 391/391, none skipped; API typecheck, workspace lint and full build passed. Application tests used only disposable PostgreSQL.
- Applied only the two pending staff migrations using migrate deploy to configured development database localhost:5432/glampro_suite. All 24 migrations up to date; read-only checks verified completed migration history, nullable email, new commission/PIN column types/defaults/nullability and validated commission-rate range constraint. No reset/reseed or business-row changes by verification.
- User UAT accepted; completion checks met. TK2610-0019 DONE in local tracking; external task tracker unchanged. No new schema migration required for void fix. No commit, production migration or application deployment.

## October 20, 2026 — TK2610-0019 assessment and policy

- Existing staff profiles and recurring shift APIs are partial foundations. Roster UI, booking availability enforcement, commission accrual and email-free POS PIN access remain required. Shift PATCH and effective-date validation need correction.
- User selected configurable per-staff percentage commission on service revenue after discounts, excluding tax, credited to the line performer. Package purchases earn none; service redemptions earn on their allocated service value. Direct tips remain separate.
- Implementation defaults disclosed: authenticated-session POS-only PIN switching with no privilege elevation; no-roster staff retain unrestricted bookings, configured hours/breaks are enforced without manager override.
- Implemented staff roster editor in the staff drawer with all-page reads and later-page failure reporting, WORK/BREAK and effective-date edits; partial shift updates validate merged bounds and break coverage includes effective dates. No overnight shift row; split work across weekdays. Booking writes enforce configured roster in salon time (real-minute traversal handles DST); no-roster staff remain unrestricted. Disabled performers are refused.
- Commission rate defaults to zero and is editable by existing management routes/UI. Completion accrues per service line on net revenue minus snapshotted tax, rounded per line; ignores package purchases/products/tips, including service revenue paid through package/credit tender. Rates and amounts snapshot in EmployeeCommission; idempotent completion, unpaid refund adjustments and paid-refund reconciliation retained. No payroll/payout UI added.
- Email-free staff use nullable User.email, a random unusable web password and hashed six-digit PIN. Existing email logins preserved; PIN-only staff cannot obtain web sessions or management roles. PIN assertions bind tenant, operator and current bearer session; expire after 15 minutes/session renewal, reset/revocation/disable invalidates them. Sales consume assertions only for cashier identity, never line attribution or API privileges. Frontend keeps assertions only in memory and clears on sign-out. Verification limits ten failed attempts/IP per 15 minutes with process-local storage.
- Migrations: 20261020160000_staff_commission_rate (including SQL 0–100 constraint), 20261020170000_staff_pos_pin. Applied with the previous 22 migrations on a new isolated PostgreSQL cluster; no application DB access/change.
- Checks: shared 112/112, API 388/388, web 452/452, none skipped; workspace lint, API typecheck and full build passed. Los Angeles-host shift suite 21/21 and Auckland-host new UI suites 5/5 passed. Corrected an ambiguous pre-existing sale-test fixture lookup to its exact seeded email after full-suite evidence. Scoped formatting/diff review performed; no browser UAT claimed.
- User accepted UAT on October 20, 2026; no agent browser walkthrough claimed. The closure entry above supersedes the previously pending local migration rollout and paid-commission void review. Existing non-atomic booking/rota race unchanged. No commit/application deployment.

## October 20, 2026 — ESLint cleanup and TK2610-0018 closure

- User explicitly authorized removing suspicious appended code from all three workspace ESLint configs. Removed only the payload and its createRequire bootstrap; compared against HEAD to confirm every existing lint rule/configuration was preserved.
- Checks actually run: workspace lint passed for API/web/shared; node --check passed on all three configs; config formatting passed. Web lint still emits an npm unknown-config warning for --skipwarn, but exits successfully. No application tests rerun for config/documentation-only cleanup; earlier application verification is recorded below.
- User-reported calendar UAT was already accepted. Final lint blocker resolved; TK2610-0018 marked DONE. No commit, deployment or database changes. Next: TK2610-0019 assessment, not started.
- Cleanup is scoped, not proof of a clean environment. Payload provenance, prior execution impact and other possible affected files remain uninvestigated.

## October 20, 2026 — TK2610-0018 calendar extension

- User explicitly accepted UAT on October 20, 2026. This supersedes the pending-UAT notes below; acceptance is user-reported. Task is BLOCKED only on unsafe lint-config review/verification, not on calendar UAT. This update changed tracking documents only; no tests rerun or security cleanup authorized.
- Week now renders Monday-first day/staff tracks plus Unassigned, with quarter-hour drops. Month dates accept drops preserving salon-local start time and staff; padding rejects drops. Overflow expands to expose all bookings for edit/drag.
- Calendar/roster consume all pages before success; later-page failure surfaces an error. Calendar overlap reads include carry-in bookings without changing list semantics. Week/month occupy each intersected date; exact midnight ends do not occupy the next day. Day/week keep disclosed 08:00–20:00 gutters and share lane geometry.
- Reschedules preserve duration snapshots unless service changes; optimistic start/end move together and roll back on failure. Added shared overlap query flag, API integration coverage and web drag/data tests. ADR 0018 updated with user approval.
- Verified web 446, shared 107, API 380 with zero skips on a new isolated PostgreSQL cluster after applying the existing 22 migrations. API/web builds/typechecks passed; host-timezone regression tests passed. No browser UAT claimed.
- Security finding: pre-existing obfuscated code appended to all workspace ESLint configs; attempted web lint spawned unexpected clipboard errors and was stopped. Do not execute configs until reviewed. Left unrelated files untouched. Production/live DB unchanged; temporary test cluster used only for verification.

## Earlier session snapshots (historical; superseded by Current State)

- October 20 local rollout completed with explicit user approval: verified target
  localhost:5432/glampro_suite and exactly two pending migrations; applied
  `20261020120000_product_barcode` and `20261020140000_direct_staff_tips` using
  migrate deploy. All 22 migrations now up to date. No reset/reseed. Final web
  rerun 433/433; API 377/377 isolated DB, shared 107/107; lint/typecheck/build,
  scoped formatting and diff checks pass. Browser/scanner/tip UAT remains the
  acceptance gate for TK2610-0017; no commit/deployment and no 0018 work.
- October 20 tips continuation: user approved option 1 (direct-to-staff records,
  one recipient, separate full-return audit; salon collection disabled). Implemented
  additive migration, tenant-scoped API and receipt-side panel. API 377/377 with no
  skips on isolated PostgreSQL, web 433/433, shared 107/107; lint/typecheck pass.
  Production build and final diff review passed. Local salon DB unchanged; barcode and
  direct-tip migrations need approved rollout. Browser/scanner/tip UAT remains.
  TK2610-0017 IN PROGRESS; do not start 0018. No commit or deployment.
- October 20 continuation: barcode implementation is automated-test verified, but local rollout and physical-scanner/browser UAT remain. API 375/375 against an isolated temporary PostgreSQL cluster (none skipped), web 429/429, shared 104/104; root lint/typecheck/build pass. Root formatting still fails only on four unchanged API files. Local salon database is unchanged: `20261020120000_product_barcode` remains pending. Tips require explicit policy approval; TK2610-0017 stays IN PROGRESS. No commit/deployment/external tracker update.
- Current task: TK2610-0017 / P1-07 POS upgrades is **IN PROGRESS**. User accepted policy features and historical browsing/held-list pagination. Hold-create retry keys now persist across unchanged retries/reloads, with in-flight edit guards. User accepted current-catalogue pickup/safe replacement UAT on October 19. Backend reversal/receipt-retention hardening now passes automated checks. Barcode and tips remain; tip policy needs approval. Do not start TK2610-0018.
- Latest checks (October 19): API 371/371 (database enabled, none skipped), web 424/424, shared 101/101; root typecheck, lint and production build passed. Forward receipt-retention migration applied locally; 20 migrations up to date. Current continuation changes are uncommitted. No agent browser walkthrough or deployment. Logs: `/tmp/pos-integrity-*.log`.
- Most recently completed: TK2610-0016 customer profile. On October 19 the user explicitly confirmed testing and acceptance, and requested POS upgrades. Prior rollout and automated checks remain historical evidence; no agent browser walkthrough. Ready to mark Done externally. Existing uncommitted implementation changes preserved.
- Milestone verification (October 19): root production build, typecheck and workspace lint exit 0; web 392/392, shared 92/92 and pure demo-dataset 13/13 tests pass. Root formatting still fails on four unchanged API files. No database-backed API rerun or browser walkthrough; earlier API 339/339 is historical evidence. See the milestone handoff below for the readiness checklist and accepted demo limits.
- Most recent work: TK2610-0012 / P0-06 reports (commit `18c973f`) audited against its completion check and signed off after UAT. The Z-report draws the salon-local day, counts voids by `voidedAt`, splits collected from redeemed and carries the snapshotted GST. The overview returns sales-by-day, top items, service and staff totals with commission, tender subtotals and a liability snapshot that excludes expired/exhausted holdings. ADR 0010 conflict closed: `?threshold=` filters only while row badges use the stored tenant threshold, with a new row-flag test. Verified: API 339/339, web 392/392 across 43 files, API typecheck/ESLint/scoped Prettier and web typecheck pass. That ADR 0010 edit and a Prettier re-wrap of `report.service.ts` are uncommitted.
- Earlier: TK2610-0011 / P0-04 local payment methods and redemption. The four local rails are **recorded tenders** (`PAYNOW_SGQR`, `NETS`, `GRABPAY`, `ATOME`); `PACKAGE` and `PREPAID_CREDIT` are redemption tenders that carry a `holdingId`, draw the holding inside the sale transaction and are restored on void; `GET /api/customers/:id/holdings` feeds the payment sheet. Migration `20261019034125_local_payment_methods_and_redemption_holding` applied locally. ADR 0019 records both decisions (manual recording; credit is fungible). Committed as `c2274bc`.
- Earlier: TK2610-0010 / P0-02 receipts **DONE** — user UAT on October 19, 2026 accepted an email-only scope (WhatsApp deferred to TK2610-0021). `Sale.gstRegistrationNumber` snapshotted at completion; `POST /api/sales/:id/receipt/email` renders the stored receipt; the till has an "Email receipt" dialog.
- Earlier: SETUP-05 database verification and repair. Schema drift found (live DB missing `tenants.time_zone`/`locale` and `tenant_operating_hours` despite `_prisma_migrations` rows; P0-09's 2FA columns existed only in `schema.prisma`). Repaired additively via `npm run db:migrate`: applied pending `20261015210000_tenant_localisation`, `20261016151623_tenant_operating_hours`, and newly generated `20261018141510_user_two_factor_auth` (purely additive, reviewed). No reset/reseed. Backup: `backups/glampro_suite_2026-10-18.dump` (pg_dump); `backups/` gitignored; `.env` never committed.
- Environment facts: PostgreSQL at `localhost:5432`, db `glampro_suite`, shadow `glampro_shadow` also on 5432. Commented-out `SHADOW_DATABASE_URL` in `apps/api/.env` points at stale port 5433 (nothing listens) — use 5432 for shadow commands.
- Verification (SETUP-05, October 18): `prisma migrate status` → 12 migrations, up to date at that time (14 now, after GST and the sale GST-number snapshot); `prisma migrate diff` live-DB↔schema and migrations↔schema both empty (exit 0); 0 rolled-back migrations; API tests 308/308 passed then.
- One stale test fixed: `apps/api/src/routes/auth.routes.test.ts` replay case still asserted pre-P0-09 family revocation; now asserts ADR 0007 behavior (replay → 401 `SESSION_INVALIDATED`, rotated pair stays valid). Test-only change; service behavior unchanged. This was the blocker hiding behind the DB seed failure.
- P0-09 / TK2610-0005 remains DONE; its "integration tests blocked" caveat is now cleared.
- TK2610-0008 / P0-05 — DONE: user completed UAT and marked it done in the external system on October 19, 2026. Its Products.tsx/test changes are committed in 80bd83b (verified via git log; the earlier "uncommitted" note was stale).
- Earlier records report P0-07, P0-08, P0-03 and P1-09 Done. This consolidation does not independently revalidate their product behavior.

## Unresolved decisions and carried-forward findings

### October 20 — TK2610-0017 barcode continuation

- Existing nullable tenant-unique barcode migration, catalogue contracts/form and exact POS lookup retained. Leading zeroes survive; codes are trimmed/upper-cased. Blank/null clears, omitted update preserves; duplicates are scoped to the salon. Archived and foreign products cannot resolve as scan matches.
- Removed unused POS import. Added synchronous scan-submit guard and draft-version invalidation on cart/customer/hold/checkout/receipt/context changes and unmount, so delayed lookup results cannot edit a changed draft. Scans are explicit keyboard-wedge/manual code + Enter, not a camera integration or global keyboard listener. A concurrent scan is ignored while a lookup is pending; scans are not queued.
- Added shared normalisation/clearing/length coverage, catalogue duplicate/tenant/preserve/clear tests, exact/inactive/foreign barcode service tests, and browser repeated-scan/stock/near-match/delayed-response tests. Repaired existing barcode route tests: fixture writes need explicit platform scope, `dataOf` already unwraps the response, array comparisons need deep equality, and mixed name-search results are not all exact barcode matches.
- Verified: API 375/375 with no skips after all 21 migrations replayed in an isolated PostgreSQL 18 cluster on port 55439; cluster stopped after tests. Web 429/429, shared 104/104; root lint/typecheck/production build and git diff check pass. Root Prettier still reports the same four unchanged API files. Earlier whole-tree formatting noise in those files was removed only after comparing to formatted HEAD; unrelated work retained.
- Local salon migration status explicitly reports the barcode migration pending. Do not claim local rollout or browser acceptance. No local database migration/reset/reseed, commit, push or deploy. Logs: `/tmp/barcode-*.log`, `/tmp/glampro-barcode-db/`.
- Next: approve tip collection/allocation/tax/refund policy before implementation. Barcode UAT after rollout: save and clear a code; reject a duplicate; scan twice to increment one product; reject unknown/inactive/out-of-stock codes; verify leading zeroes and Enter from a physical scanner. TK2610-0017 remains IN PROGRESS; do not start TK2610-0018.

### October 19 — TK2610-0017 pickup accepted; backend reversal/receipt integrity

- User confirmed UAT acceptance for current-catalogue pickup/safe replacement and authorized continuation. This is user-reported acceptance, not an agent browser walkthrough.
- Void now reloads status/lines/points after taking the shared sale lock; waiting concurrent void retries return the first reversal receipt/audit without duplicate effects. Refund likewise uses post-lock lines, points, customer and total.
- Missing product on void/restocking refund and missing redeemed package/credit on void now fail the whole transaction instead of silently skipping restoration. Explicit no-restock refund remains valid under existing policy.
- Granting-sale void locks holdings before checking spent state. Package/credit redemption takes the corresponding holding lock before reading it; consume/delete races cannot both succeed. Outstanding row is locked before later-payment checks; there is currently no service writer for later outstanding payments, so no end-to-end collection race was claimed.
- Applied reviewed forward migration `20261019210000_receipt_parent_retention`: Sale customer/cashier and SaleLine performer deletion now RESTRICT rather than CASCADE. No rows deleted/backfilled. Route fixture cleanup explicitly removes fixture sales before staff. Account archival remains supported; hard deletion of linked parents is intentionally refused.
- Verified API 371/371 (DB enabled, no skips), web 424/424, shared 101/101; root typecheck/lint/build pass; Prisma validate/generate pass and migration status reports 20 up to date. New regressions cover concurrent void replay, missing-product rollback/no-restock refund, completed/void receipt parent deletion, and granting-sale reversal versus package/credit consumption. One new race-test fixture used the wrong seeded credit name; corrected and reran.
- Limits: receipt names remain live references, not immutable name snapshots. Whole-tenant erasure policy is not changed. Locks protect tested race paths but exhaustive multi-holding/deadlock/load testing is not claimed; transaction errors still roll back. No new backend browser UAT, production deploy, agent commit, reset or reseed.
- Keep TK2610-0017 IN PROGRESS. Next: barcode scanning; tips require a concrete policy proposal/approval. Do not start TK2610-0018.

### October 19 — TK2610-0017 current-catalogue pickup and safe replacement

- Added read-only `GET /api/sales/:id/resume` with a shared response contract. Exact kind/id readers reuse catalogue active/expiry checks and entitlement guards, return both current prices, and reject missing/non-held/foreign sales. Historical receipt/hold prices are not rewritten. No migration or stock/financial writes.
- Pickup preserves line order, quantities, staff and discount rates; member/customer changes now use current regular/member prices. Customer read and complete cart conversion succeed before replacing the draft.
- Existing draft/customer/resumed hold requires replacement confirmation. Cancel/failure keeps the draft. A synchronous in-flight guard blocks overlapping pickup/discard and cart/customer/payment actions; history opening is guarded during hold actions. Unmount/identity cleanup prevents late pickup from replacing a newer cart.
- Verified API 367/367 (database enabled, none skipped), web 424/424, shared 101/101; root typecheck/lint/production build pass. Coverage includes changed/member pricing, 10%/100% discounts, missing/inactive/unentitled items, non-held/foreign sales, exact lookup beyond limited search, no pickup ledger/counter/stock effects, confirmation/cancel/failure and late-response behavior.
- Initial tests exposed the old S$80 historical-price expectation versus correct S$70 member pricing, a wrong inactive-status fixture and an incorrect customer-button selector; corrected and reran without weakening behavior checks.
- Limits: pickup is not ownership, stock reservation, or a price guarantee. Concurrent changes after the read are still possible; completion remains authoritative. Reload restores the browser quote rather than continuously re-fetching it. No browser UAT, deployment, commit, reset or reseed. Existing uncommitted work preserved.
- Task remains IN PROGRESS. Next: backend reversal/receipt-retention integrity, then barcode/tips (tip policy still needs approval). Do not start TK2610-0018.

### October 19 — TK2610-0017 durable hold retry keys

- Confirmed API already stores tenant-scoped unique idempotency keys for HELD writes and returns the winner on duplicate requests. The browser previously omitted the key. `useHoldSale` now persists a UUID plus submitted-input fingerprint in the existing tenant/user draft before posting; unchanged retries reuse it after reload. Successful writes clear the attempt; a changed submitted cart gets a new key.
- In-flight holds disable customer/cart edits and other hold pickup/discard actions; catalogue add handlers ignore edits while pending. This prevents successful hold completion from clearing edits made during the request.
- Tests cover retry after lost response/reload, key rotation after success, fingerprint/identity isolation, pending edit/payment locks and database-backed concurrent/sequential replay with one hold, no receipt-counter change, no tenders and no performance/points/outstanding rows.
- Checks: focused UI/storage 44/44 and sales routes 48/48; full API 364/364, web 420/420, shared 101/101; typecheck/lint/build pass. An initial web run overlapped rebuilding shared output and failed imports; rerun after the build passed. No assertions weakened. No new browser walkthrough, schema migration, commit or deployment.
- Limits: this protects unchanged retries, not a changed cart after an uncertain response. Check the held list before submitting an edited cart as a new attempt. Key records are removed when a hold is discarded, so indefinite replay after discard is not guaranteed. Remaining resume repricing and backend reversal/receipt-retention concurrency are not declared verified or resolved.
- Next: current-catalogue resume pricing and safe pickup review within TK2610-0017; barcode/tip work follows. Manual fault-injection acceptance of this retry fix remains unperformed.

### October 19 — TK2610-0017 historical browsing and held-list pagination

- Sales listing now accepts optional `page`, returns `page`/`hasMore`, preserves default HELD and existing `limit`, and uses stable soldAt/id ordering. Previous/Next controls make older holds reachable. Offset pages are live views: concurrent writes can shift rows, not a frozen export.
- On-demand completed/voided history opens the stored receipt using existing email/print/refund/void UI. Back to cart preserves cart lines, customer and resumed-hold ID; history never pre-fills email from the unrelated active customer. Manager and writable-tenant gates remain on reversals; server guards remain authoritative.
- New tests cover pagination beyond the last page, equal-timestamp paging, foreign-tenant exclusion, cashier historical reads, invalid page input, status/page switching, receipt-open failure, reversal visibility and resumed-cart preservation through subsequent completion. API 363/363, web 417/417, shared 101/101; typecheck/lint/build, scoped formatting and git diff check passed after fixing new fixture typing/data requirements.
- User confirmed manual acceptance on October 19, 2026. This is user-reported acceptance, not an agent browser walkthrough. No schema migration, commit or deployment by the agent.
- Next: continue hold retry/repricing/integrity review, then barcode/tips; tip policy needs a concrete proposal before implementation. Keep TK2610-0017 IN PROGRESS.

### October 19 — TK2610-0017 approved policy implementation

- Added forward migration `20261019190000_pos_loyalty_refund_policy`; no historical recalculation or destructive reset. Loyalty input/result snapshots live on sale lines; payout evidence is nullable JSON on refunds for historical compatibility. Performance/commission adjustment markers and commission payment/reconciliation state are additive.
- Service and UI enforce actual positive cent-exact payout splits. Server refuses debt, redemption or grant sales. Original completed sales/tenders and consumed vouchers stand; refund transaction appends points/performance/unpaid-commission reversals once. Paid commissions are flagged, not recovered. Reporting recognizes reversal dates and separates gross/refunds/net and incoming/outgoing tenders.
- Verified all suites and build/type/lint/schema checks above. Added discounted/member/quantity flooring, zero-price, debt/tender independence, historical snapshots, eligibility refusal, exact split, paid commission and refund-period coverage; retained idempotency/concurrency tests. Browser test now submits actual split money methods.
- Limitations: pre-policy commission records have no paid evidence; reconcile actual historical payouts before operational use. No payment/reconciliation management UI introduced. Item/service rankings remain gross after-discount sales; overall/day/staff figures reflect refund-date reversals. Historical refund payouts remain unknown rather than fabricated.
- User accepted UAT for the delivered slice on October 19, 2026. This is user-reported acceptance, not an agent browser walkthrough. No additional runtime tests were run for this documentation-only update.
- Next: remaining TK2610-0017 POS scope only; UAT for the delivered slice is accepted. TK2610-0018 not started.

These are historical code-review findings, not fresh runtime reproductions. Verify
against current code when starting the related task. No policy is changed here.
Full decision context and evidence qualifications now live in `PROJECT.md`,
Architecture decisions (ADR 0002–0019), and Design integration (Design 1–7).

- ADR 0002: legacy-ID importer and repeat-run fixture verification are not implemented;
  do not infer migration readiness from schema support or seed-generated IDs.
- ADR 0003 / P1-05: customer email normalization is missing; blank input rejects
  rather than normalizes to NULL. Review case-fold collisions before data changes.
- ADR 0004: platform console is an unscheduled architecture direction, not an
  implemented app or an authorization to add a privileged surface.
- ADR 0008: old centered-card review conflicts with the documented October 8 split
  layout. Preserve later composition; inspect Login before claiming fidelity.
- ADR 0014 / P1-02: status-only cancelled reactivation bypasses clash checks;
  cancelled targets may be wrongly refused. Add regression checks for both paths.

| Related task          | Finding / decision needed                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-09; ADR 0007       | Replay behavior resolved: replay rejects without family revocation per ADR 0007, test aligned October 18; password change atomic; forced sign-out exists. Owner recovery/account-removal scope still open.                                                                                                                                                                                                                   |
| P0-06; ADR 0010       | **Resolved October 19, 2026:** `?threshold=` now filters only; each row's `lowStock` badge uses the stored tenant threshold, and `catalogue.service.test.ts` asserts the badge on a row that the override pulled into the list. Reintroducing one threshold for both would reopen this finding.                                                                                                                              |
| P0-02; ADR 0011       | Legacy unnumbered completed receipts have no established backfill guarantee. Held sales also have null numbers; a completed receipt's “number pending” copy must not promise an unsupported future allocation.                                                                                                                                                                                                               |
| P1-07; ADR 0017       | ADR says discounts reduce loyalty points; code/test award catalogue points × quantity. Resolve policy first. Performance totals are not cash collected or commission. Receipt disclosure can omit a positive rate rounded to zero money.                                                                                                                                                                                     |
| P1-07; ADR 0015       | Held-sale review found incomplete listing, stale/current-price mismatch, double-discount preview, lost hold identity after reload, cart replacement and duplicate drafts on uncertain-response retries without idempotency keys.                                                                                                                                                                                             |
| P1-07; ADR 0016       | Void reverses ledger state but does not refund payment. Concurrent replay, missing-product stock restoration, cascading receipt deletion, voided outstanding balances and stale report/customer caches need review; prior tests did not prove every ledger case.                                                                                                                                                             |
| P1-02; ADRs 0013/0014 | Decide duration snapshots versus catalogue refresh on every patch. Service-only and catalogue-driven resizing can bypass clash checks gated on startsAt/staffId. Department eligibility is rechecked, but server lookups do not enforce picker active-status filters; mismatches lack field detail. Till department narrowing is advisory. Review concurrent overlap enforcement; prior tests did not establish race safety. |
| P1-01; ADR 0018       | Day/week/month views exist. Review salon-zone boundaries against newer P0-08 changes; old browser-local findings may be superseded. Week drag/drop, crossing-midnight display and first-page truncation remain scope to assess; read-only presentation is not proof of edit authorization.                                                                                                                                   |
| P0-04 / P1-03 / P1-04 | P0-04's manual-recording decision is now recorded (ADR 0019): no provider onboarding is required for the four local rails, and the remaining provider question is settlement/reconciliation, not acceptance. Deposit/no-show policy, messaging provider and consent still need decisions before P1-03/P1-04.                                                                                                                 |

Detailed rationale and evidence limits are preserved in `PROJECT.md`. Documentation
audits marked Done did not resolve these product decisions or defects.

## External completion notices

Inform only; never edit the PDF or external task system. Based on preserved Done
evidence (not new product verification in this documentation task), these IDs were
already recorded complete and can be marked done externally if not already marked:

- TK2610-0004 / P0-07 — developer-copy cleanup.
- TK2610-0006 / P0-08 — localisation.
- TK2610-0007 / P0-03 — business hours.
- TK2610-0014 / P1-09 — performer-picker cleanup.

TK2610-0008 / P0-05 was signed off Done by the user on October 19, 2026 (UAT
accepted) and is already marked done externally. TK2610-0009 / P0-01,
TK2610-0010 / P0-02, TK2610-0011 / P0-04 and TK2610-0012 / P0-06 passed the user's
UAT check on October 19, 2026; mark them done externally if not already. TK2610-0010
was accepted on an **email-only** scope — WhatsApp e-receipt moves to TK2610-0021.
TK2610-0013 and Phase 1 (TK2610-0001) are ready to mark Done externally: on
October 19, 2026 the user explicitly confirmed P0 is done and ready, following the
milestone review and disclosed limits. No external task system was changed.
This approval does not sign off Phase 2 or final launch readiness.

## Recent handoffs

### October 19, 2026 — TK2610-0017 ADR 0020 continuation

- Finished voucher preview/apply/remove, tender retotaling and code submission.
  Checkout blocks during preview; payment state remounts when cart/customer changes.
- Added manager refund dialog with explicit stock choice and external-money notice.
  Browser and email receipts disclose vouchers/refunds and voucher-adjusted lines.
- Added shared/service/route/browser regressions. Refund retries are idempotent
  under contention, point reversal is append-only, and refund/void share a sale lock.
- Verified API 358/358, web 411/411, shared 99/99; root build, workspace typecheck
  and lint pass. Migration status reports 18 migrations, database up to date.
- Original ADR 0020 absent; added a clearly labeled reconstructed implementation
  record under docs. L2 allocation formula/columns remain deferred; earning still
  uses catalogue points × quantity. Refund debt/holding/report accounting needs
  policy. No browser UAT, commit, deploy, reset or reseed in this continuation.
- Task remains IN PROGRESS. Next: resolve L2 and refund accounting limits in ADR
  0020 before production acceptance; do not start TK2610-0018.

### October 19, 2026 — TK2610-0017 authorized browser bug-fix slice

- User chose verified held-cart/cache/receipt fixes first; vouchers, tips, refunds
  and loyalty changes remain blocked pending explicit policy.
- Added backward-compatible optional resumed hold ID to tenant/user browser draft;
  restored on page remount, cleared on completion/leave/discard. Re-parking a
  resumed cart no longer creates another held row. Existing server hold is not
  edited by Leave it held; local edits are still discarded by that explicit action.
- Rebuilt held line pre-discount preview from stored unit price and line discount
  divided by quantity; avoids applying the saved rate twice, including 100% off.
  Still a historical quote, not a guarantee of current catalogue price.
- Shared cache invalidation refreshes customer views (including holdings/history),
  reports and dashboard after completion/void without clearing another open cart
  on void. Voided receipt preserves paid history, suppresses active debt/change
  and explicitly says money refunds are handled separately.
- Web suite 408/408 across 46 files; web typecheck/lint exit 0. Added reload/hold,
  10%/100% discount, storage isolation, cache invalidation and voided short tender
  regressions. Fixed missing holdings fixture. Initial reload test needed to await
  async cart hydration; corrected and reran full suite. No weakened assertions.
- No schema/API changes, DB operations, browser UAT, commit or deployment. API
  tests not rerun for browser-only changes. Retry idempotency, complete held listing,
  current catalogue preview, backend reversal races/retention and financial policy
  remain; TK2610-0017 stays BLOCKED, not externally Done.

### October 19, 2026 — TK2610-0016 accepted; TK2610-0017 POS audit (BLOCKED)

- User confirmed customer profile UAT acceptance and authorized POS continuation.
  Marked TK2610-0016 DONE; no external tracker changed.
- Inspected source DOCX POS requirements, ADRs 0015–0017, Prisma sale models,
  shared sales contracts, sale service, POS screen/hooks, draft storage, receipt
  and test names. Existing discounts, terminal voids and desktop two-column cart
  do not satisfy missing vouchers/tips/barcode/refunds.
- Confirmed component-only resumed hold ID, no hold-create idempotency key,
  limit-only listing, narrow void cache refresh and voided Outstanding label.
  Catalogue points remain unchanged by discounts, conflicting with ADR 0017.
- Focused Vitest output: Sale 25/25 and draft storage 3/3, with undefined holdings
  query mock warning; terminal wrapper closed without confirming exit status.
  No API DB tests, browser walkthrough, database commands or application edits.
- Await explicit policy for loyalty formula, voucher scope, tip allocation/tax
  and refund scope/accounting. Do not silently equate void with refund or invent
  tax policy. Preserve all existing uncommitted work; do not start TK2610-0018.

### October 19, 2026 — Authorized development database reset and demo seed

- User confirmed local `glampro_suite` and standing permission to reset/reseed this
  development database whenever needed. Saved the bounded permission in PROJECT;
  production and other databases are not covered. Existing application work preserved.
- Verified local database/port, created custom-format backup and checked its archive
  listing: `backups/glampro_suite_pre_reset_2026-10-19T06-43-38.597Z.dump`.
  Archive listing was checked, not a restore rehearsal. Backup remains gitignored.
- Initial reset was blocked by Prisma's AI safety gate before data changes. User
  freshly confirmed the exact reset; rerun with that consent succeeded. Ran shared
  build/client generation, `npm run db:reset`, development `npm run db:seed`, and
  migration status. All exited 0; all 17 migrations applied; live schema diff empty.
- Fresh demo: 1 tenant, 6 users, 10 customers, 13 appointments, 10 sales; seed reports
  3 branches, 42 shifts, 12 services, 12 products, 2 packages, 1 value package and
  2 gift cards. Zero privacy notices, consent events and photos. No implicit consent;
  configure tenant notice and grant customer data consent to exercise photo uploads.
- Reset deliberately replaced prior development data and invalidated prior sessions;
  sign in again. No production access, commit or deployment. No full test-suite rerun
  or browser walkthrough in this operational follow-up. Prior implementation test
  results remain historical. TK2610-0016 rollout complete; browser/visual UAT remains.

### October 19, 2026 — TK2610-0016 customer profile implementation (IN PROGRESS)

- Added `/customers/:id`, linked from customer names, with contact/branch details,
  existing editable notes and consent, active holdings, paginated past appointments
  and completed/void purchase history. Future bookings/held carts excluded; statuses
  stay visible. Currency uses major-unit `formatPrice`, not cent-based `formatMoney`.
- Added tenant-scoped CustomerPhoto and additive migration
  `20261019130000_customer_photos`. Bytes live in PostgreSQL, not public `/uploads`.
  Authenticated tenant photo list/read; writable tenant upload/delete; upload requires
  current data consent, checked/locked in the insert transaction. Reads are no-store.
  JPEG/PNG signature checks, 5 MB cap, caption limit, explicit deletion confirmation.
  Original metadata remains; no transcoding, automatic purge or legal-compliance claim.
- Normalized shared request contracts, customer service and demo seed email writes:
  trim/lowercase, blank to NULL, tenant uniqueness and case-insensitive duplicate
  precheck. No existing-email rewrite/merge; existing collision audit still required
  before any future normalization migration. No importer/admin customer writer exists.
- Verified: API **351/351**, zero skipped, on a newly initialized local-only disposable
  PostgreSQL 18 cluster at port 55439; web **404/404** across 46 files; shared **96/96**.
  Root production build, typecheck and workspace lint pass. All 17 migrations deploy
  from empty disposable DB; Prisma datasource-to-schema diff empty. Root format check
  still reports four unchanged API files (auth routes, catalogue route tests, auth
  service, settings service). No clean aggregate verify claim.
- New tests cover tenant/unauthenticated photo/history denial, consent withdrawal,
  suspended photo writes, private byte retrieval, malformed format refusal, deletion,
  history pagination/filtering, money scaling, profile editor/read-only UI, upload
  error handling and email normalization/tenant uniqueness. Existing tests retained.
- Remaining: normal local migration rollout and browser/visual walkthrough (customer
  name → profile; notes edit/reload; history pages; balances; grant data consent;
  upload/view/delete a photo; withdraw consent and verify upload refusal). No salon
  DB migration/reset/seed, outbound messages, commit, deployment or external update.
  TK2610-0016 is not ready to mark Done externally. Resume it before TK2610-0017.

### October 19, 2026 — TK2610-0015 local migration and UAT closeout (DONE)

- User explicitly accepted UAT and requested migration. Working tree clean at
  start; reviewed the only pending migration, `20261019120000_customer_consent`.
- Confirmed target is local PostgreSQL `localhost:5432`, database `glampro_suite`.
  Custom-format pre-migration backup created and `pg_restore --list` verified:
  `backups/glampro_suite_pre_consent_2026-10-19T06-01-54-775Z.dump` (gitignored).
  Initial version-specific pg_dump attempt failed; migration was stopped until
  system pg_dump successfully produced the verified archive. No restore test run.
- `npm run db:migrate` applied only the reviewed additive consent migration,
  exit 0. `npm run db:migrate:status`: all 16 applied, exit 0. Live datasource-to-
  schema Prisma diff: no difference, exit 0. No reset, seed or data rewrite.
- Read-only before/after checks: existing row counts unchanged across 36 tables;
  10 customers, all consent false/revision zero; zero notices and consent events.
  No invented notice wording or implicit opt-in. No messages sent.
- No application edits or service restart; full suites were not rerun against the
  existing database. Prior disposable-DB API 347/347, web 399/399, shared 95/95
  remain implementation evidence; this closeout verifies migration, not browser UI.
- TK2610-0015 ready to mark Done externally; user manages external tracker.
  Next ready task: TK2610-0016 / P1-05 Customer profile page; not started here.

### October 19, 2026 — TK2610-0015 implementation (IN PROGRESS; local rollout/UAT remaining)

- User accepted tenant-configured wording/version with grants disabled until
  configured. Managers publish immutable versions in Settings; no supplied default
  legal text or automatic opt-in. Ordinary customer creation/edit does not change
  consent; save a new customer, reopen Edit, and use the separate consent controls.
- Added shared consent contracts/tests, PrivacyNotice and CustomerConsentEvent
  models, default-false customer fields and additive migration
  `20261019120000_customer_consent`. Both new models are tenant-scoped.
- Customer editor shows current wording, separate data/optional marketing choices,
  presentation acknowledgement, paginated history and reload/error states. Grants
  require the current notice; withdrawals remain possible without it. Data-consent
  withdrawal also clears marketing. No signature/self-service proof is implied:
  this is staff-recorded consent with server time and staff id.
- Consent changes and audit events commit atomically; expected revisions prevent
  lost withdrawals/concurrent overwrite. Published wording cannot be edited or
  reused; old wording remains linked in audit history. Staff ids survive deletion.
  Evidence follows customer/tenant deletion; no automatic retention purge exists.
- Added `requireMarketingConsent` for future dispatch consumers and tested refusal
  before opt-in/after withdrawal. No promotional sender currently exists, so no
  real marketing-delivery enforcement is claimed. Receipts and staff 2FA unchanged.
- Verification: disposable PostgreSQL 18 cluster under
  `/tmp/glampro-consent-pg.yHoeDa`, loopback port 55439, new `consent_test` and
  `consent_shadow` databases only. All migrations deploy; DB-to-schema diff empty.
  API 347/347 with 0 skipped, web 399/399 across 45 files, shared 95/95 pass.
  Root build, typecheck and lint exit 0. Tests cover HTTP roles/auth/read-only,
  tenant isolation, strict validation, notice versioning, stale grants, withdrawals,
  actor/time/history, concurrency, default choices and UI permission/error states.
- Root format check still fails on the same four unrelated API files recorded in
  the milestone review; no clean aggregate verify claim. Scoped formatting and
  `git diff --check` pass. Initial test failures (strict notice serialization and
  missing test-fixture module category) fixed and full suites rerun successfully.
- Existing salon database untouched: no reset, seed or migration applied there.
  No outgoing mail, deployment, commit, external status change or browser visual
  check. Existing low-stock/report changes preserved.
- Remaining: apply the reviewed migration through the normal local workflow,
  restart API, then UAT: before configuration grants disabled; publish approved
  separate texts/version as manager; create/edit customer; grant data only then
  marketing; reload; withdraw data and verify both false plus audit history; verify
  staff cannot publish notices. Keep task IN PROGRESS until rollout/UAT is accepted.
- Disposable cluster stopped after verification; its temporary files remain for
  inspection. No existing PostgreSQL instance was stopped or modified.
- Next after completion: TK2610-0016 / P1-05 customer profile page. Do not start it yet.

### October 19, 2026 — TK2610-0015 / P1-06 consent audit (BLOCKED)

- Inspected Customer Prisma model, shared create/update/response contracts,
  customer service/routes and tests, editor and screen tests, tenant context,
  email transport and callers, and the source DOCX requirement.
- No customer consent fields/history exist. Customer writes currently allow
  authenticated tenant members when writable; consent permissions need an explicit
  choice rather than a silent role-policy change. No marketing sender exists;
  current senders are transactional receipt email and staff 2FA.
- DOCX supplies the feature name, not approved privacy-notice text, evidence
  retention or withdrawal policy. Asked the user to choose a technical baseline
  versus providing approved policy before implementation.
- Proposed, not approved: separate data and marketing choices; no automatic opt-in;
  server timestamp, actor and notice version for grants/withdrawals; current-consent
  checks for future marketing consumers; transactional receipts kept separate.
  No automatic deletion or claim of legal compliance is inferred.
- No application edits, database commands, messages sent, or external task changes.
  Application tests were not rerun for this policy-only audit. Existing low-stock
  and report changes remain untouched. Resume this task after the policy decision;
  do not advance to another tracked task.

### October 19, 2026 — TK2610-0013 / P0 readiness review (DONE)

- Reviewed TASKS: TK2610-0004–0012 cover all nine P0 requirements and are recorded
  Done. The user previously accepted live Packages/Gift cards and the GST,
  receipt, payment and reports slices. Those earlier acceptances alone did not
  approve this milestone; October 20 is the original target, not automatic approval.
  The user subsequently explicitly confirmed "yes it's done and ready. please
  continue" on October 19, closing this milestone and the P0 phase gate with the
  disclosed limits retained. Specific walkthrough scenarios were not reported.
- Fresh checks: root `npm run build`, `npm run typecheck` and `npm run lint` exit 0; web 43 files /
  392 tests, shared 92 tests, and pure `prisma/seed-data.test.ts` 13 tests pass.
  The dataset checks cover references, clash windows, totals, tender arithmetic
  and stock, not live demo freshness or a repeat-run database seed.
- Root `format:check` reports the same four unchanged files:
  `apps/api/src/routes/auth.routes.ts`, `apps/api/src/routes/catalogue.routes.test.ts`,
  `apps/api/src/services/auth.service.ts`, `apps/api/src/services/settings.service.ts`.
  No clean aggregate `verify` claim. No unrelated formatting or application edits.
- Handoff checks: Prettier on TASKS/PROGRESS and `git diff --check` pass.
- No database reset, seed, migration, existing-data change, external task update,
  commit or deployment. Database-backed API tests were not rerun because this
  session has not established a disposable test database. The prior 339/339
  result is retained as historical evidence, not a fresh regression result.
- Seed inspection confirms demo grants for packages, giftCards and reports, but
  seed code does not establish today's live data. No live browser or email
  delivery verification was performed in this review.

#### Sales-demo walkthrough / explicit approval checklist

Use the intended demo tenant and synthetic customer data. Do not reset/reseed an
existing database merely to make the dashboard look fresh.

1. Log in with the intended demo role; confirm the correct salon, friendly copy,
   S$ amounts, DD/MM/YYYY dates, saved salon timezone and business hours.
2. Show populated Products/Services/Packages/Gift cards and available Reports.
   With an unentitled test tenant, confirm add-on Add controls are hidden and API
   refusal is friendly. Do not change a live tenant's entitlements for the demo.
3. Ring a service/product sale with a customer and performer; show the accepted
   GST setting and tax line. Record a local tender and a package/credit redemption
   using a suitable existing holding; verify the remaining balance and receipt.
4. Show receipt numbering and the email-receipt flow. Verify delivery only with
   an approved recipient and configured transport; UI success is not proof of
   inbox delivery. WhatsApp receipts are deferred to TK2610-0021.
5. Reconcile that sale with the salon-day Z-report and staff/service totals; show
   collected versus redeemed amounts and the liability snapshot. If demonstrating
   void, explain that ledger reversal is not a provider refund.
6. Review desktop/mobile presentation and any observed defects. Confirm the demo
   dataset is useful on the presentation date; relative seed dates do not refresh
   themselves. Record any waiver rather than treating untested steps as passed.

Demo limits: local rails are recorded tenders, not PSP processing/settlement;
package liability is sessions, not a monetary valuation; commission is reporting,
not the P1-08 rules engine; reports have no export/scheduled delivery yet. Known
P1 booking, held-sale and reversal findings remain in the unresolved section and
are not cleared by this milestone review.

- Result: user readiness approval recorded; TK2610-0013 and TK2610-0001 are DONE.
  Verification limitations and known P1 findings remain unchanged; sign-off does
  not turn unperformed checks into passing results or approve final launch.
- Next: TK2610-0015 / P1-06 PDPA consent and marketing opt-in (P1-09 is already
  Done). Not started in this milestone closeout, per the one-task handoff rule.

### October 19, 2026 — TK2610-0012 / P0-06 reports (DONE)

- Found `18c973f feat(reports): add Z-report, liability, and commission reporting` already
  committed, while the tracker still said "Not assessed". Audited it against the completion
  check instead of rebuilding it.
- Z-report: `salonDayBounds` gives the salon-local `[from, to)` day; voids come from
  `voidedAt` inside that day, so a sale rung up yesterday and voided today appears today;
  `collected` and `redeemed` are split by `isRedemptionPaymentMethod`; tax is the
  snapshotted `Sale.taxAmount`. Test fixtures assert the void (999.00) and outstanding
  (10.00) figures.
- Overview: staff rows fold `EmployeePerformance` plus `EmployeeCommission` (sale-linked
  or created in range for period commissions); services, items, days and tenders are
  folded from completed sales only; liability excludes expired and exhausted holdings
  and reports package sessions as a count.
- ADR 0010 closed in `apps/api/src/services/catalogue.service.ts`: `listProducts` keeps
  `filterThreshold` for `?lowStock=true` and uses `badgeThreshold` (the stored tenant
  threshold unless there is no override) for `toProduct`. `catalogue.service.test.ts`
  now asserts both rows of the override-widened page — `Aloha Shampoo` stays
  `lowStock: false` at 10 units where the salon threshold is 5.
- Checks run: API 339/339, web 392/392 across 43 files, API typecheck/ESLint/scoped
  Prettier, web typecheck — all exit 0. Reports screen tests 5/5 and reports endpoint
  tests 6/6.
- Two over-long lines in the committed `report.service.ts` also failed Prettier; they
  were re-wrapped (whitespace only). `format:check` still fails on the four files this
  task never touched, as recorded under TK2610-0011.
- Not committed: the ADR 0010 fix and its test, plus the `report.service.ts` re-wrap. Suggested commits: `fix: keep low-stock badges on the salon threshold when filtering (TK2610-0012)` and `style: format report service`.
- UAT (October 19, 2026): user reported UAT complete on `/reports`; no defects were reported and the exact scenarios exercised were not recorded. The task is now DONE locally; mark it done in the external system if not already.
- Next: TK2610-0013 — MILESTONE: P0 UAT and sales-demo readiness sign-off.

### October 19, 2026 — TK2610-0011 / P0-04 local payment methods + redemption (DONE, implementation)

- Decision (ADR 0019): local rails are **manually recorded** tenders, not a PSP integration.
  PayNow and SGQR share `PAYNOW_SGQR`; `NETS`, `GRABPAY` and `ATOME` have their own codes.
  A redemption is a **tender** (`PACKAGE`, `PREPAID_CREDIT`), never a discount, so totals,
  points and stylist credit stay what the catalogue says.
- Credit is **fungible** (user's answer): prepaid credit pays for any line up to its balance.
  A package covers only the services it lists, in cart order, one session per service unit.
- **Server-side draw.** `redeemPayments()` runs inside the sale transaction: re-reads the
  holding, recomputes coverage (`HOLDING_NOT_COVERED` when the amount disagrees), decreases
  with a `>=` guard (`HOLDING_INSUFFICIENT` on a race), and writes one `CustomerRedemption`
  naming the holding. `HOLDING_NOT_FOUND` (404), `HOLDING_EXPIRED` (409),
  `HOLDING_REQUIRES_CUSTOMER` / `REDEMPTION_EXCEEDS_TOTAL` (400). `reverseForVoid()` restores
  the sessions/credit and stamps `revertedAt` instead of deleting.
- **Schema.** `PaymentMethod` gained six values; `CustomerRedemption.holdingId` + index added
  by additive migration `20261019034125_local_payment_methods_and_redemption_holding`
  (applied locally, no reset).
- **API.** `GET /api/customers/:id/holdings` merges the two ledgers into one list of spendable
  rows (expired/exhausted omitted), each naming the tender that spends it.
- **Web.** Payment sheet offers all eleven tenders; a redemption row picks the holding and
  shows the amount read-only, computed by the same rule as the server. Receipt badges and the
  email receipt name every tender.
- Verification: `prisma migrate status` up to date (DB↔schema diff empty); API typecheck/ESLint/Prettier
  clean; web typecheck and production build pass; API 333/333 (6 new sale-service tests + 5 in the new
  `customers.routes.test.ts`) and web 391/391 across 43 files pass. No browser/E2E automation; the user's
  manual UAT covered the flow.
- User UAT (October 19, 2026): reported complete. The exact scenarios the user exercised were not
  recorded here; no defects were reported back.
- Committed as `c2274bc` with the suggested message.
- Next: TK2610-0012 / P0-06 reports.

### October 19, 2026 — TK2610-0011 / P0-04 UAT sign-off (DONE)

- User confirmed UAT complete on the till. Local payment methods and package/prepaid-credit redemption
  are accepted on the **manually recorded** scope in ADR 0019: no PSP, QR payload, webhook or settlement.
- Local tracker promoted to fully DONE. External task/PDF updates stay with the user.
- Note for the next session: `npm run format:check` fails on four files this task never touched
  (`auth.routes.ts`, `catalogue.routes.test.ts`, `auth.service.ts`, `settings.service.ts`) — pre-existing
  Prettier drift, deliberately left alone.

### October 19, 2026 — TK2610-0010 / P0-02 receipt UAT sign-off (DONE)

- User completed UAT and accepted an **email-only** scope. WhatsApp e-receipt is not
  implemented and moves to TK2610-0021 (P1-04), which still needs a provider, template
  and consent decision. No WhatsApp code was invented.
- **GST snapshot:** `Sale.gstRegistrationNumber` is written by `resolveCart` only while
  the salon's GST is enabled; additive migration
  `20261019120000_sale_gst_registration_number` applied to `glampro_suite`. Reprints keep
  the old number when the setting changes. Historical rows with tax fall back to the
  current salon number; zero-tax rows print none.
- **Email:** `receipt-email.service.ts` builds HTML + text from the stored `SaleDetail`
  (same source as the paper), escaping salon/line copy. `POST /:id/receipt/email` sits
  behind session auth, `requireModule("sales")`, `requireWritableTenant()` and a
  30/15min limiter; 409 for HELD carts, 503 on provider/configuration failure. Dev/test
  use nodemailer's JSON transport; production 503s when SMTP is unset. Sends are
  synchronous — no outbox, retry or delivery confirmation.
- **Web:** `useEmailSaleReceipt` mutation and `EmailReceiptDialog` (prefilled customer
  address, shared-schema validation, stays open with the destination after a send).
- Verification: migration applied; API typecheck + ESLint + Prettier clean; API 322/322 and web
  387/387 pass (new: `sales.routes.test.ts` 5, `receipt-email.service.test.ts` 5). The
  production build was not run this session.
- Changes uncommitted; suggested message
  `feat: snapshot GST number and email sale receipts (TK2610-0010)`.
- Next: TK2610-0011 / P0-04 local payment methods.

### October 19, 2026 — TK2610-0009 / P0-01 GST UAT sign-off (DONE)

- User completed the UAT check (GST settings, sale receipt, report figures) and the
  local tracker is promoted to DONE. External system/PDF updates stay with the user.
- Policy: Singapore GST 9%, inclusive of catalogue prices. Back-calculated per line
  (`lineTotal × 9 / 109`, half-up 2dp); sale tax is the sum of rounded lines. Rate and
  amount are stored on `Sale`/`SaleLine`. GST defaults off, so existing salons are
  unaffected.
- Shipped: shared constants/schemas, additive migration
  `20261019015129_gst_settings_and_sale_tax`, settings service pair guard (`gstEnabled`
  requires a number; a stored number survives a toggle-only PATCH), sale pricing and
  receipt mapping, report tax aggregation, Settings toggle + registration number,
  ReceiptView "Includes GST (9%)" row, Reports GST column and totals tile.
- Verification: migration applied; `build:shared`, shared/API/web typecheck and lint
  exit 0; shared 92/92, web 387/387, API 312/312 pass.
- Changes are uncommitted; suggested message
  `feat: add inclusive GST settings, receipts and reports (TK2610-0009)`.
- Next: TK2610-0010 / P0-02 receipts (thermal print + email/WhatsApp e-receipt with the
  GST number).

### October 19, 2026 — TK2610-0008 / P0-05 UAT sign-off (DONE)

- User confirmed UAT acceptance and marked TK2610-0008 Done in the external system;
  local tracker promoted Ready for UAT to DONE. External system/PDF updates stay
  with the user.
- Correction: the P0-05 `Products.tsx`/test changes previously recorded as
  uncommitted are committed in `80bd83b` (checked with `git log -- Products.tsx`).
- Tracker-only update; no code, tests or database touched this session.
- Next: TK2610-0009 / P0-01 GST settings, tax line on sales & tax reports.

### October 18, 2026 — SETUP-05 database environment (DONE)

- Verified environment: PostgreSQL on `localhost:5432` (only 5432 listening; the
  commented-out `SHADOW_DATABASE_URL` in `apps/api/.env` targets stale port 5433),
  db `glampro_suite`, shadow `glampro_shadow`, `.env` never committed to git.
- Two drift sources repaired, all additive via `npm run db:migrate`, no
  reset/reseed: applied pending `20261015210000_tenant_localisation` and
  `20261016151623_tenant_operating_hours` (live DB was missing `tenants.time_zone`
  / `locale` and `tenant_operating_hours` despite `_prisma_migrations` rows), then
  generated and applied `20261018141510_user_two_factor_auth` for P0-09's 2FA
  columns that existed only in `schema.prisma`.
- Backup before changes: `backups/glampro_suite_2026-10-18.dump` (pg_dump, ~125KB);
  `backups/` added to `.gitignore`.
- One pre-existing test failure surfaced once seed ran: the replay case in
  `apps/api/src/routes/auth.routes.test.ts` still asserted pre-P0-09 family
  revocation. Test updated to ADR 0007 behavior (replay 401 `SESSION_INVALIDATED`;
  rotated pair stays valid). Test-only — `auth.service.ts` unchanged.
- Checks: `prisma migrate status` → 12 migrations, up to date, 0 rolled back;
  `prisma migrate diff` live-DB↔schema and migrations↔schema both "No difference
  detected" (exit 0); API tests 308/308 pass (exit 0). Web/shared not rerun (not
  touched this session). Uncommitted work preserved; no commit/push.

### October 17, 2026 — DOCS-01 three-document migration (DONE)

- Corrected the initial partial consolidation to the clarified scope: only
  PROJECT/TASKS/PROGRESS are maintained project documents. No extra rule file or
  separate decision/design docs. Delivered design assets/README remain unchanged.
- Consolidated ADR 0002–0018 policies, rationale, tradeoffs, code references and
  evidence limits into PROJECT; Design 1–7 retains frame/token/icon/route/checklist
  and primitive-delta details. Workflow is in PROJECT; external notices restored.
- Added missing email, migration, login-layout and cancelled-booking findings.
  Product statuses stay unchanged. Source changes are reference comments only;
  verify token equivalence and preservation of existing uncommitted work.
- Verification: 29 PDF IDs, 24 exact DOCX task requirements and 37 prior statuses
  preserved. All 17 decision IDs and seven design sections have stable destinations;
  retired links removed and active PROJECT links/anchors resolve. Removed 20
  superseded files; docs now contains only DOCX/PDF. Delivered design README stays
  unchanged as an asset, not an additional maintained project document.
- All 66 edited source/schema files have equivalent non-comment contents (TS/TSX
  parse/printed AST comparison, CSS/Prisma comment-stripped comparison). All 287
  other snapshot files are unchanged, including original documents, design assets,
  existing Prisma tenant-scope fix and Products test changes.
- Checks run: web Login/Products/Card/navigation — 4 files, 56/56 tests passed;
  shared catalogue/sales — 53/53 tests passed; scoped Prettier and git diff --check
  passed. No full build/typecheck/API tests or database commands: application edits
  in this task are comments only. No commit/push. Test scripts and safety snapshots
  are outside the repository, not new management documents.

### October 17, 2026 — TK2610-0008 / P0-05 (historical)

- Recorded audit: package/gift-card CRUD, entitlement guards, demo seed grants and
  templates exist. Web Add button now hides for unentitled add-on tabs; read-only
  behavior remains disabled rather than hidden.
- Changed `apps/web/src/pages/Products.tsx` and its test file (still uncommitted).
- Recorded results: web 383/383 tests, web typecheck/lint/build passed. API 308/308
  and shared 87/87 were reused from the earlier baseline, not rerun in this slice.
- Status remains Ready for UAT; live demo entitlement/data verification is not
  established by reading the seed configuration alone.

### October 17, 2026 — SETUP-02 baseline (historical)

- Recorded isolated disposable PostgreSQL 18 migration deploys; no seed/reset or
  existing database use. Temporary cluster stopped after checks.
- Recorded API 308/308, web 381/381, shared 87/87, workspace lint/typecheck passing.
- Added `TenantOperatingHours` to tenant-scoped Prisma models; change remains in
  `apps/api/src/lib/prisma.ts` and is outside this documentation task.
- Full root verify was NOT clean: seven pre-existing formatting failures were
  reported. The old tracker overstated aggregate success. Individual passing
  checks above do not establish a successful `npm run verify`.

### October 17, 2026 — SETUP-06/07/08 decision reviews (historical)

- Recorded evidence reviews for ADRs 0002/0003/0006/0008 in commit `257eead`.
  Decision context is now consolidated in PROJECT. Open findings remain unresolved.

### October 22, 2026 — P2 completion evidence correction

- Supersedes the earlier Phase 3 closure note: no explicit P2 sign-off established.
  October 21 launch approval excluded P2; P0/P1 historical acceptance is preserved.
- TK2610-0003 is IN PROGRESS; TK2610-0026 is BLOCKED. No grant submission
  acknowledgement or prepared application pack established. Earlier official-source
  verification and September PSG/EDGE transition claims withdrawn as unsupported.
- Other P2 child statuses are historical records, not freshly verified workflow
  acceptance. Preserve rebrand's accepted code-only scope and external-clearance risk.
- Current root build and typecheck both exit 0. Root lint exits 1:
  apps/api/src/services/treatment.service.ts:174 no-explicit-any; web/shared lint pass.
  Fresh checks supersede earlier syntax-failure reports, not functional tests.
- AI assistant inspection: default owner summary has no daily date filter and promo
  response has no approval flag. Requires focused follow-up before accepting 0029.
- SEC-01 remains BLOCKED; its separate-resource approval requirement is unchanged.
  No database tests, migrations, seeding, mail, deployment or application edits.

### November 4, 2026 — staff password recovery (owner/manager reset)

- Gap closed: a forgotten staff password was unrecoverable. `PATCH /api/staff/:id` has
  no `password` by design (ADR 0007), `/api/auth/change-password` requires the current
  one, and no salon-facing reset existed. `POST /api/staff/:id/password` now sets a
  colleague's password for `SUPER_ADMIN` and `MANAGER`.
- Contract: `resetStaffPasswordSchema` in `packages/shared/src/schemas/staff.ts` —
  `password` only (no email, no role), floored at `PASSWORD_MIN_LENGTH`. The service
  applies `adminPasswordSchema` when the **target** is an owner, so the stricter policy
  is judged against the row, not the body.
- Service: `resetStaffPassword` hashes before the transaction, then in one transaction
  increments `tokenVersion`, clears any pending 2FA code, revokes the target's unrevoked
  refresh tokens and writes a `STAFF_PASSWORD_RESET` audit row carrying the target's
  role and no secret. Refusals: 404 cross-tenant/unknown id, 409 `NO_WEB_LOGIN` for a
  POS PIN-only row (no password exists), 403 `ROLE_NOT_PERMITTED` when a manager targets
  a manager or an owner (a credential write is a takeover primitive, not an edit).
- UI: the edit drawer gained a "Reset password" section with new/confirm inputs and its
  own button, disabled for read-only tenants and hidden for a manager whose target is a
  manager or an owner; a self-reset calls `signOut()` so the caller is not left holding
  a token the API no longer accepts. The profile form still has no password field.
- Evidence: shared 315/315 (3 new schema cases); `staff.routes.test.ts` 32/32 including
  8 new password-reset cases against PostgreSQL (old password rejected, new one accepted,
  pre-reset access token 401 `SESSION_INVALIDATED`, refresh token refused, audit row
  without the secret, manager/owner limits, 409/422/404 paths); web `Staff.test.tsx`
  25/25 (4 new reset cases). Full web run 1049/1058 — the 9 failures are the unrelated
  in-flight `settings/PayrollPlans.test.tsx` salary-profile work, untouched here. API and
  web typecheck, all three workspace lints and Prettier pass. Full API suite not re-run;
  only the staff route file. No migration, seed, deployment or production data change.
- Also removed an unused `HttpError` import from `auth.service.ts` that was failing
  `npm run typecheck` before this change.

### November 5, 2026 — two-factor authentication: per-account toggle and salon-wide policy

- Gap closed: `User.twoFactorEnabled` existed but a salon could not require it of
  anyone, and the account card could not be seen from Settings. Two answers now
  exist side by side: **this account** (`user.twoFactorEnabled` from `GET /auth/me`)
  and **everyone in the salon** (`Tenant.requireStaffTwoFactor` from
  `GET /settings/profile`).
- Schema: `Tenant.requireStaffTwoFactor Boolean @default(false)`, migration
  `20261105130000_tenant_staff_two_factor`, applied with `migrate deploy` and
  `prisma generate`. No backfill: absent policy is `false`.
- Shared contract: `authUserSchema.twoFactorEnabled`,
  `salonProfileSchema.requireStaffTwoFactor`, and `updateSalonSecuritySchema` /
  `UpdateSalonSecurityInput` (one explicit boolean; unknown fields refused).
- Enforcement rides the existing `assertTenantMaySignIn` call sites in
  `auth.service.ts` (`login`, `refresh`, `verifyTwoFactorForLogin`) via
  `twoFactorRequiredFor` / `loadStaffTwoFactorPolicy`, so no extra query is paid —
  the policy travels on the tenant row those paths already read. `SUPER_ADMIN` is
  excluded from the policy because an owner already verifies unconditionally.
  The gate is on **renewal, not revocation**: an access token issued before the
  policy keeps working until it expires; its refresh token is then refused with
  `401 TWO_FACTOR_REQUIRED` and the next sign-in is challenged.
  `disableTwoFactor` also refuses under the policy (`403 TWO_FACTOR_REQUIRED`), so
  a member cannot opt out of a rule the salon set.
- `PATCH /api/settings/security` (`requireRole("SUPER_ADMIN")`) →
  `updateSalonSecurityPolicy`: transactional, writes `STAFF_TWO_FACTOR_POLICY_CHANGED`
  with the actor in `metadata` (`audit_logs` has no `actorUserId`), and is a no-op
  that writes no audit row when the value is unchanged.
- Web: `TwoFactorCard` rewritten against the two sources (enable opens a code
  exchange, disable confirms, the switch is held on for a policy-bound member and
  for an owner), new `StaffSecurityPolicyCard` (owner-only in Settings → Privacy &
  security; turning it on is confirmed in a modal, turning it off applies at once),
  `AuthContext.refreshProfile()` so the card draws server state, and
  `useUpdateSalonSecurityPolicy()` replacing the cached profile with the response.
- Evidence: shared 320/320; full API suite `src/**/*.test.ts` + `prisma/*.test.ts`
  1503 tests — 1228 passed, 0 failed, 275 opt-in skips; web 1067/1073 (the 6
  failures are the unrelated in-flight `settings/PayrollPlans.test.tsx` work noted
  on November 4, and that file passes 25/25 on its own); API and web typecheck,
  `shared` typecheck, all three lints and Prettier pass. Focused additions:
  `auth-security.acceptance.test.ts` (pre-policy sign-in, live access token after
  the switch, `401 TWO_FACTOR_REQUIRED` on refresh, challenged fresh sign-in,
  `twoFactorEnabled: true` after verify, `403` on self-disable),
  `settings.routes.test.ts` (policy round-trip with audit), `auth.routes.test.ts`,
  `TwoFactorCard.test.tsx` (6), `StaffSecurityPolicyCard.test.tsx` (3),
  `Settings.test.tsx` (owner sees the card, manager does not), plus shared schema
  cases for the new fields.
- Two things worth recording. Restoring the delivery-failure branch in
  `loginWithTwoFactor` keeps the established `503 EMAIL_SEND_FAILED` code and
  message rather than inventing a new one — `apps/api/src/services/auth-security.test.ts`
  pins that contract, and sibling mail paths already use it. And the local
  development inbox on `127.0.0.1:1025` (from `apps/api/.env`) was not running
  during part of this session, which fails any route test that triggers a real
  send (`staff.routes.test.ts` owner sign-in returned that 503); a plain TCP SMTP
  sink on that port is enough to run them, and with it the file is 32/32.
- No deployment, seed or production data change.

### November 5, 2026 — owner two-factor is the owner's setting, not a forced gate

- The switch the owner sees is now the switch the server honours. `twoFactorRequiredFor`
  no longer forces `SUPER_ADMIN`: an owner answers an email code when they enrolled one
  themselves, and the salon's `requireStaffTwoFactor` policy binds staff only. The reason
  is the alternative read worse — an owner bound by the policy could never switch their own
  factor off, so the toggle would appear to save and the next sign-in would challenge
  anyway, which is indistinguishable from a broken setting.
- What the owner gives up by turning it off is not the gate but the writes that need a
  verified owner. Reads stay open to a password-only owner; money-moving and
  configuration writes re-read `users.twoFactorEnabled` at the point of use. Most of those
  guards already existed (`payroll-close-state.ts`, `payroll-close-loader.ts`,
  `payroll-close-store.ts`, `payroll-close-authorizations.ts`, the three payroll-close
  loaders, `payroll-close-sale-coverage.ts`, `payroll-close-value-sale.ts`,
  `payroll-configuration.service.ts`, `prepaid.service.ts`, `prepaid-refund-settlement.ts`,
  `prepaid-family.service.ts`, `package.service.ts`, `package-valuation.service.ts`,
  `session-transfer.service.ts`, `sale-void-cash.ts`, `treatment-disposal.service.ts`,
  `payroll-cutover.ts`) and were unreachable while the sign-in gate forced enrollment; they
  are the answer now and were left as they are. Two gaps were closed: a value-package
  refund (`payroll-value-package-refund.ts`) and publishing an attribution policy
  (`commission-attribution-policy.ts`) now refuse a password-only owner with `403` and
  "Only a verified salon owner …". Commission attribution policy reads stay open.
- Removed the sign-in gates that assumed the flag was always true: the owner-only refresh
  refusal in `auth.service.ts`, and the owner-only second-factor block in
  `middleware/auth.ts` (`twoFactorEnabled` stays on the principal because the writes read it
  from there). The staff-policy check on refresh now exempts the owner for the same reason
  sign-in does — otherwise the owner's session would die at the next renewal, which is the
  same broken-switch symptom one step later.
- `disableTwoFactor` is open to owners and still refuses staff while their salon requires it
  (the owner is exempt there too, or the one account able to change the policy would be
  trapped behind it); a missing user now answers `SESSION_INVALIDATED` instead of a
  database error.
- Web: `TwoFactorCard`'s owner switch is live (`checked={enrolled}`, held on only when the
  member is enrolled _and_ the salon policy binds them), the "Always on" badge is gone, and
  the owner copy says what turning it off costs — payroll close, prepaid settlements,
  package valuation and package transfers. `StaffSecurityPolicyCard`'s description now says
  the policy covers staff.
- Evidence: focused `auth-security.test.ts` 19/19 (owner opt-out, owner exempt from the
  policy at sign-in _and_ renewal, staff opt-out refused, staff renewal refused with
  `401 TWO_FACTOR_REQUIRED`, password-only owner login, staff still challenged);
  `payroll-value-package.http.test.ts` and `commission-attribution-policy.acceptance.test.ts`
  for the two new guards; `TwoFactorCard.test.tsx`; the opt-in SEC-01 acceptance 2/2 against
  a disposable PostgreSQL on `127.0.0.1:55439` and a loopback capture SMTP; full API suite
  `src/**/*.test.ts` + `prisma/*.test.ts` 1508 tests — 1233 passed, 0 failed, 275 opt-in
  skips; API and web typecheck, scoped API lint and Prettier clean. Web 1060/1074 with the
  14 failures confined to the unrelated in-flight `settings/PayrollPlans.test.tsx` under
  full-suite load — that file is 25/25 on its own, and the two-factor and Settings files are
  37/37 together.
- Two test-side repairs, both consequences of today's other work rather than of this change.
  SEC-01's teardown deleted the acceptance tenant with `tenant.deleteMany`, which the
  append-only guard added by the platform tenant purge migration now refuses once the
  receipt has frozen payroll economics on a sale line; the teardown sets the same
  transaction-local `glampro.purge_tenant` break-glass the operator purge uses, and the test
  now passes on repeat runs. The local development inbox on `127.0.0.1:1025` is still needed
  for any route test that sends mail: `staff.routes.test.ts` answers `503 EMAIL_SEND_FAILED`
  without a listener there and is 32/32 with a plain SMTP sink.
- Still open: `payroll-cutover.ts` and `treatment-disposal.service.ts` read the flag through
  their own actor lookup rather than the shared helper, and the payroll-close guards answer
  with terse messages ("Payroll input loading is not permitted.") that will now be the first
  thing a password-only owner sees. Neither is a correctness problem; both are worth a
  wording pass when payroll close is next touched.
- No deployment, seed or production data change.
