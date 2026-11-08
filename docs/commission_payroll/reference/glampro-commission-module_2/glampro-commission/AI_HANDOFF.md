# AI HANDOFF – Glampro Commission Module

> **Paste this file into ChatGPT (or any AI coding assistant) at the start of every session**, together with
> the files you want to change (or `docs/ALL_CODE.md`, which contains the whole codebase in one file).
> It tells the AI how the module is built and the rules it must not break.

---

## 1. What this module does (business summary)

Eurosense (a Glampro salon) pays staff commission on:

| Commission type (code) | When it is earned | Base amount | Who earns it |
|---|---|---|---|
| `SVC` cash service | service paid normally | net line amount (after discount, excl. GST) | Performed by |
| `PRD` product | product sold | net line amount (category kept, e.g. "Beauty") | Sold by |
| `PKG_SALE` package sale | **each payment collected** (deposit / instalment / full) | **cash collected** – negative on refund | Sold by (split) |
| `PKG_RED` on course / redemption | each session used | holding's **session value** = net price ÷ sessions (snapshot) | Performed by (split) |
| `FOC` complimentary service | FOC service done | service list price (the plan applies base %, e.g. 50%) | Performed by |
| `VP_SALE` / `VP_SPEND` value package | sold / credit spent | cash paid / credit × paid ÷ credit | Sold by / Performed by |

Every staff member is on a **commission plan** (e.g. *Hair Commission Scheme 2022*, *TP Mani & Pedi Scheme*).
A plan has **components** (e.g. "Cash Service & Package", "On course", "Product", "FOC"), **stages** by tenure
(e.g. *New staff* months 1–3) and **incentives** (group + individual target, personal target).

A component pools the month's base of its commission types and applies one **method**:

| Method | Rule | Example: bands 0–7,000 @5%, 7,000–15,000 @7%; base 8,985.50 |
|---|---|---|
| `FLAT` | base × rate | – |
| `TIER_WHOLE` | rate of the band reached × **whole** base ("retroactive") | 8,985.50 × 7% = **628.99** |
| `TIER_SLICE` | each band's rate on its own slice ("progressive") | 7,000 × 5% + 1,985.50 × 7% = **488.99** |
| `TIER_MIXED` | per band: `WHOLE` (from $1) or `SLICE` | depends on band settings |
| `FIXED_PER_UNIT` | fixed S$ × number of items | – |

Rates are decided at **month end** (because tiers depend on the monthly total). During the month the POS only writes
**base lines** (no rates) to the **Commission Base Ledger**.

Owner decisions (do not change without the owner): **D-1** package sale base = cash collected · **D-5** the plan
and plan version in force on the **last day of the month** apply to the whole month · **D-7** refund takes back only
the sale commission on the refunded part, redemption commission stays · **D-8** only paid-for sessions can be
redeemed (manager PIN override allowed and logged).

---

## 2. Architecture

```
React screens (frontend/src)                 Glampro POS / checkout (existing code)
        │  CommissionApi interface                       │ calls hooks after payment
        ▼                                                ▼
 HttpApi ──REST──► Express router (backend/src/api/app.ts) ──► Services (backend/src/services)
 DemoApi ─────────────── runs the same Services in the browser ──┘          │
                                                                            ▼
                                   Repository interface (backend/src/repo/types.ts)
                                      ├─ MemoryRepo (tests, demo)
                                      └─ PrismaRepo (PostgreSQL)
 Pure engine (shared/src) ◄── used by services AND by the settings screen's live calculator
```

- **shared/** – pure functions, no I/O. If a number is wrong, the bug is almost always here. 100 % unit-tested.
- **backend/services** – business workflows (permissions, validation, writing ledger lines, periods).
- **backend/repo** – storage only. Changing the database = change `prismaRepo.ts` only.
- **frontend** – screens only call `useApp().api.*` (interface in `frontend/src/api/client.ts`).

---

## 3. Golden rules (the AI must follow these)

1. **Money is never a JS `number`.** Use `Decimal` via `D()` from `shared/src/money.ts`. API/DB values are strings
   like `"1234.50"`. Rates are strings like `"7"` (= 7 %). Round with `money2()` (2 dp, half-up) only for final
   amounts; ledger base lines use `money4()`.
2. **The engine stays pure.** Nothing in `shared/` may import Node, Express, Prisma or React.
3. **The ledger is append-only.** Never update `baseAmount`. To correct: mark `REVERSED` (open period) or post a
   negative line in the next open period (approved period) – see `LedgerService.reverseLines()`.
4. **Approved periods are locked.** Any change that touches a locked month posts to the next open month.
5. **Snapshots.** Session value is fixed at purchase; period results store plan version, stage and band reached.
   Publishing a new plan version never changes past months.
6. **Effective dating.** Plan versions have `effectiveFrom`; assignments have `fromDate/toDate`.
7. **Every manual change needs a reason** and writes `repo.audit(...)`.
8. **Permissions** (SRS §4.11): only `SUPER_ADMIN` creates/publishes plans, approves periods, edits salaries;
   `MANAGER` can refund, void, correct staff, override, adjust; `STAFF` sees only their own data.
9. **Keep the `CommissionRepo` interface and `CommissionApi` interface in sync** when adding features
   (MemoryRepo + PrismaRepo, HttpApi + DemoApi).
10. **Add/adjust tests** in `shared/tests` (engine) or `backend/tests` (API) for every change; run `npm test`.

---

## 4. Integrating into Glampro

1. **Database** – run `backend/sql/001_commission_module.sql` (or Prisma migrate). Tables are prefixed `comm_`.
2. **Staff** – `comm_staff` mirrors Glampro staff (id, name, joinDate, active). Either keep it in sync when staff
   are created/edited, or change `PrismaRepo.listStaff/getStaff/saveStaff` to read Glampro's own staff table.
3. **Mount the API** in Glampro's Express app:
   ```ts
   import { createCommissionRouter } from './commission/backend/src/api/app';
   import { PrismaRepo } from './commission/backend/src/repo/prismaRepo';
   app.use('/api/commission', authMiddleware, createCommissionRouter(new PrismaRepo(prisma)));
   ```
   Replace `actorFrom()` in `api/app.ts` with Glampro's session (salonId, userId, role).
4. **Call the POS hooks** from Glampro's checkout **after payment succeeds** (same DB transaction if possible):

   | Glampro event | Call |
   |---|---|
   | Package sold (full or deposit) | `POST /holdings` (`ledger.purchasePackage`) with Glampro holding id, net price, sessions, sellers split, payNow |
   | Balance / instalment paid | `POST /holdings/:id/payments` |
   | Session used at checkout / appointment | `POST /holdings/:id/redeem` (409 `SESSION_NOT_PAID` → ask manager override) |
   | Cash service line paid / FOC | `POST /lines/service` (`foc: true` for FOC) |
   | Product line paid | `POST /lines/product` (send product category) |
   | Value package sold / spent | `POST /lines/value-package` |
   | Package refunded | `POST /holdings/:id/refund` |

5. **Screens** – copy the React components into Glampro's frontend and mount them on Glampro's routes
   (see comments in `frontend/src/App.tsx`). Use `HttpApi` with Glampro's auth instead of demo headers.
6. **Existing holdings** – backfill `comm_holding` (session value = net price ÷ sessions, cash collected = paid so far).

---

## 5. How to extend (recipes)

**Add a new calculation method**
1. Add it to `CalcMethod` and `CALC_METHOD_LABELS` in `shared/src/types.ts`.
2. Implement it in `calcComponent()` in `shared/src/engine/tier.ts` (return `working` lines for the UI).
3. Add validation in `engine/validate.ts`, the enum in `backend/src/api/schemas.ts`, a button in
   `CommissionSettingsPage.tsx` (method picker), and tests in `shared/tests/engine.test.ts`.

**Add a new commission type (e.g. `MEMBERSHIP_SALE`)**
1. `CommissionType` + `COMMISSION_TYPE_LABELS` in `shared/src/types.ts`; enum in `backend/src/api/schemas.ts`.
2. A `LedgerService` method that writes base lines for it, an API route, an `HttpApi`/`DemoApi` method.
3. Admins can then tick it under "Sales that count" in any component – no engine change needed.

**Change rounding / period length / tenure counting** → `money.ts`, `util.ts periodRange()`, `engine/stage.ts`.

**Export to Excel (.xlsx) instead of CSV** → add `exceljs` in backend and a new route next to `export.csv`.

---

## 6. Prompt templates for ChatGPT

- *"You are working on the Glampro commission module. Read AI_HANDOFF.md rules. Here are files X, Y. Task: … .
  Keep money as Decimal strings, keep the engine pure, update both MemoryRepo and PrismaRepo, and add a test."*
- *"Add a monthly minimum guarantee per staff (e.g. commission at least S$300). Put the rule in the plan definition
  (shared types + validate + period.ts), show it in CommissionSettingsPage, and add tests."*
- *"Glampro's staff table is `Staff(id, salonId, fullName, startDate, isActive)`. Change PrismaRepo staff methods to
  read from it instead of comm_staff."*

---

## 7. Tests and acceptance

`npm test` runs 33 tests. They reproduce the SRS cases, e.g.:

| Case | Expected |
|---|---|
| Alvin Sept 2026, Hair plan (FOC 50% rule) | commission 1,187.69 |
| Stella Sept 2026, TP plan | 1,971.62 + S$50 personal target |
| On course 8,985.50 whole / slice | 628.99 / 488.99 |
| Hair component 1 at 12,000 whole / slice / mixed | 1,200 / 600 / 1,000 |
| Band edges 4,000 / 4,000.01 / 6,000 / 6,000.01 | 0 / 160 / 240 / 480 |
| New staff (joined 10 Sep) Oct base 3,600 / Dec | 144.00 / 0.00 |
| Deposit 2,000 on S$5,000 × 5 sessions | 2 sessions redeemable, 3rd blocked (409) |
| Refund after 2 sessions | 2,900 refunded; sellers −1,450 each; redemption kept |
| Switch On course to by slice (impact) | Alvin −140.00 |

---

## 8. File map

```
shared/src/types.ts            domain types (read first)
shared/src/money.ts            Decimal helpers, split allocation
shared/src/engine/tier.ts      component calculator (all methods)
shared/src/engine/period.ts    month-end per staff, flat fallback
shared/src/engine/stage.ts     tenure month, stage, schedule
shared/src/engine/incentive.ts incentives
shared/src/engine/package.ts   session value, paid sessions, refund
shared/src/engine/validate.ts  plan validation, jump warnings
shared/src/engine/impact.ts    impact preview
shared/src/seed.ts             Eurosense plans
backend/src/repo/*             storage interface + memory + Prisma
backend/src/services/*         plan, ledger, period, staff services
backend/src/api/*              Express routes + zod schemas
backend/src/seed/demo.ts       demo data (Sept/Oct 2026)
backend/prisma/schema.prisma   DB schema; backend/sql/*.sql same as SQL
frontend/src/api/*             CommissionApi, HttpApi, DemoApi
frontend/src/pages|pos|customer screens; components/ UI kit, SplitEditor, Chart
```
