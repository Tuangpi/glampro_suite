# Glampro – Staff Commission Module

Commission plans with tiers and new-staff stages, package **sale** commission on **cash collected**, package **redemption** ("on course") commission per session, incentives, refunds/clawbacks and month-end payroll statements.

Built to **SRS v1.2 – Glampro Staff Commission Plans** (`docs/Glampro_SRS_Commission_Plans_v1.2.docx`).
**Developers using ChatGPT / an AI assistant: read `AI_HANDOFF.md` first** (and give it to the AI).

```
glampro-commission/
├─ shared/     Pure TypeScript commission engine (no DB, no framework) – used by backend AND frontend
├─ backend/    Node.js + TypeScript + Express REST API, services, Prisma/PostgreSQL schema, SQL DDL
├─ frontend/   React + TypeScript screens (Vite), Glampro look & feel, demo mode without a server
└─ docs/       SRS, screenshots, offline demo, ALL_CODE.md (whole codebase in one file for ChatGPT – regenerate with `npm run bundle`)
```

## Quick start (no database needed)

Requirements: Node.js 20+.

```bash
npm install                 # installs all three workspaces
npm test                    # 33 tests: engine (SRS test cases) + API
npm run typecheck           # runs `prisma generate` first (needed once for the Prisma types)
npm run dev:web             # UI demo at http://localhost:5173 (runs the real services in the browser)
npm run dev:api             # REST API at http://localhost:4100/api/commission (in-memory demo data)
```

To make the UI call the API instead of demo mode: `frontend/.env` → `VITE_API_URL=http://localhost:4100/api/commission`.

## With PostgreSQL

```bash
cd backend
cp .env.example .env        # set DATABASE_URL
npx prisma generate
npx prisma migrate dev --name commission_module   # or: psql -f sql/001_commission_module.sql
npm run seed                # optional: Eurosense demo data
npm run dev
```

All tables are prefixed `comm_` so they sit beside Glampro's existing tables.

## What is where

| Need | File |
|---|---|
| How % is calculated (flat, whole amount, by slice, mixed, cap, stages) | `shared/src/engine/tier.ts` |
| Month-end calculation for one staff member | `shared/src/engine/period.ts` |
| Stages from join date | `shared/src/engine/stage.ts` |
| Incentives (group + individual / personal target) | `shared/src/engine/incentive.ts` |
| Package maths: session value, paid sessions (D-8), refund amount (D-7) | `shared/src/engine/package.ts` |
| Plan validation + jump warnings | `shared/src/engine/validate.ts` |
| Eurosense Hair 2022 and TP Mani & Pedi plans | `shared/src/seed.ts` |
| POS hooks (package sale, payment, redeem, refund, service, product) | `backend/src/services/ledgerService.ts` |
| Plans, drafts, publish, impact preview | `backend/src/services/planService.ts` |
| Calculate / statement / approve / CSV | `backend/src/services/periodService.ts` |
| Staff plan assignment, overview | `backend/src/services/staffService.ts` |
| REST routes | `backend/src/api/app.ts` (validation in `schemas.ts`) |
| Database | `backend/prisma/schema.prisma`, `backend/sql/001_commission_module.sql` |
| Screens | `frontend/src/pages/*`, `frontend/src/pos/*`, `frontend/src/customer/*` |

## Screens (frontend)

| Screen (SRS ref) | Component |
|---|---|
| Settings › Commission settings – editor, calculator, comparison chart, impact preview, publish (C3–C5, C17–C20) | `pages/CommissionSettingsPage.tsx` |
| Commission plans list + staff month-to-date overview (C1, C2) | `pages/PlansOverviewPage.tsx` |
| Staff › Commission plan & payroll profile (C6, C7) | `pages/StaffCommissionPanel.tsx` |
| POS – sell package with Sold-by split & deposit; redeem with Performed-by; collect balance (C8–C11) | `pos/PosDemoPage.tsx` |
| Customer › package payments & session log, void, correct staff, refund (C16) | `customer/HoldingDetail.tsx` |
| Reports › Commission & payroll – summary, statement, adjustments, approve, CSV (C14, C15) | `pages/CommissionReportPage.tsx` |

Screenshots: `docs/screenshots/`. Click-through demo without installing anything: open `docs/Glampro_Commission_Demo.html` in Chrome.

## Owner decisions built in

- D-1 Package sale commission base = **cash collected** (deposit/instalment counted in the month received).
- D-2 Each staff member gets a **plan** on joining; rates vary by **stage** (e.g. first 3 months) and **tier**.
- D-4 Calculation method is a **setting per component**: Flat · Tier whole amount · Tier by slice · Tier mixed.
- D-7 Refund takes back **only the sale commission on the refunded part**; redemption commission stays.
- D-8 Customers can redeem **only sessions they have paid for** (manager PIN override, logged).
