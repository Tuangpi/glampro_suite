# Business reports

The Reports overview shows appointment counts, completed receipt sales, product
sales, service sales, and package sales. Today, Last 7 days, This month, and custom
dates share one salon-timezone range. A single calendar day uses hourly buckets;
longer ranges use daily buckets, including periods with no activity.

## Charts and details

- Sales trend: line chart with total, services, products, and packages controls.
- Sales mix: donut chart; gift cards are a separate category.
- Appointment activity: stacked bars for scheduled, in-progress, completed,
  cancelled, and no-show bookings, counted by booking start time/current status.
- Best sellers: horizontal bars ranked by sales amount or quantity, filtered by
  the selected product/service/package detail section.
- Detail tables expose chart figures without relying on chart tooltips.

Reports is one page without top-level tabs. Its detail controls cover Appointments,
Sales, Products, Services, and Packages. Detailed sales, Staff & payments, Customer
balances, and Daily close are no longer shown here. The underlying APIs, records,
hooks, and standalone operational components are retained; this change does not
relocate those screens or introduce new navigation elsewhere.

## API and financial meaning

`GET /api/reports/overview` retains its authentication, reports-module guard,
range validation, and existing response fields. The additive `analytics` field
contains `salesAmount`, `granularity`, appointment totals, `sessionsRedeemed`,
complete category totals, complete aggregated items, and a zero-filled timeline.
Money stays decimal strings; floating-point conversion is for chart rendering only.
Older responses without analytics show an unavailable state, not invented zeros.

- Sales charts count completed receipts after discounts and before refunds.
  They do not claim recognised accounting revenue. Refunds and net sales/paid
  amounts are separate figures using the existing reporting definitions.
- Service quantity means service lines sold, not completed treatments.
- Packages combine session packages and value packages; gift cards stay separate.
- Sessions redeemed count active, non-reverted package draws on completed sales
  by usage time. They are not added to package purchase sales.
- Appointment and redemption reads explicitly respect the selected outlet;
  other reads retain existing tenant/outlet scoping.

No migrations, activation, exports, or scheduled reporting are introduced.
