# CP-008 local acceptance — November 7, 2026

## Scope

Spec v0.9 alignment only: read-only rules, conditional previews, attribution capture
and the five agreed reporting surfaces. This is not CP-007 release acceptance,
deployment, package-valuation activation or till-time earnings posting. The verified
month-end close remains authoritative. Approved payroll is not rewritten.

## N6/N7 supported POS matrix

| Path / edge                                                                                                     | Evidence                                                          |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| New line seller defaults to valid PIN identity/authenticated operator; never defaults therapist from cashier    | `useSale.attribution.test.ts`, existing till tests                |
| Appointment action, writable salon, cancelled/no-show excluded                                                  | `Appointments.test.tsx`, `appointment-sale.test.ts`               |
| Explicit booking load, current service prices and member/nonmember switching                                    | `appointment-sale.test.ts`, `Sale.test.tsx`                       |
| Separate therapist on each service; unassigned stays unknown; repeated services retain quantity                 | `appointment-sale.test.ts`                                        |
| Existing cart/customer/held draft cannot be overwritten                                                         | `Sale.test.tsx`                                                   |
| Failed reads, inactive services, selected-outlet mismatch and stale unmounted response                          | `appointment-sale.test.ts`, `Sale.test.tsx`                       |
| Legacy performer picker replaces/clears performer evidence, preserving sellers                                  | `useSale.attribution.test.ts`                                     |
| Split editor synchronizes single legacy staff identity; split/clear does not revive an old therapist            | `useSale.ts`, editor tests and payment attribution tests          |
| Local reload and held-cart rehydration retain explicit shares and discounts                                     | `appointment-sale.test.ts`, draft-storage tests                   |
| Payment cancel/reopen retains booking attribution                                                               | `Sale.test.tsx`; mounted Chrome cash case                         |
| Real hold → pickup → reload → cancel → cash completion preserves booked therapist                               | `payroll-reports-browser.acceptance.test.ts`                      |
| Package panel preselection and manual PACKAGE selection inherit covered therapist                               | `payment-attribution.test.tsx`                                    |
| Whole service set / multiple sessions retain identical split regardless of row order                            | `payment-attribution.test.tsx`                                    |
| Different/unassigned covered therapists require explicit whole-session choice, never price weighting            | `payment-attribution.test.tsx`, `coveredPerformers`               |
| Explicit tender edits and clear survive rerender/refused-payment retry; same attempt key retained               | `payment-attribution.test.tsx`                                    |
| Repeated holding tenders use each row's actual covered units/performers; duplicate ordinal estimate unavailable | `payment-attribution.test.tsx`, existing redemption preview tests |
| Prepaid/family credit remains credit tender, no fabricated session award                                        | `payment-attribution.test.tsx`, `family-credit-payment.test.tsx`  |
| Catalogue/member/GST/discount half-cent/FOC/package fixed/exclude/plan/fallback/category/outlet                 | `payroll-cart-preview.test.ts`, `payroll-till-preview.test.ts`    |
| Original purchase economics, residual next ordinals, funding, fixed quantity, expired/refunded/missing evidence | `payroll-redemption-preview.test.ts`                              |
| SELF-only amounts, tenant/role/customer ownership, no caller base/rate override                                 | preview API tests and real HTTP reporting acceptance              |

Company-wide till mode is retained while the existing outlet picker is disabled.
The handoff never selects an outlet implicitly; an explicitly selected conflicting
outlet is refused. The booking is read evidence, not an automatically completed or
paid appointment. Loading it again is a deliberate new cart operation, not an
appointment billing/deduplication contract.

Clearing a tender's explicit split does not change the covered cart lines. Existing
server attribution policy/fallback validation remains authoritative. Previewing or
editing attribution never reserves sessions or bypasses funding checks.

## Reporting and configuration

N4 retains one audited percentage writer and a read-only package drawer. N8 exposes
holdings/credit; N10 distinguishes recorded/missing signatures, including voids.
N11 carries plan-component commission columns and owner-only payroll/sales ratio;
N14 retains friendly value-package labels beside stored codes. Gift-card commission
is declined by the client. Historical November 6 limitations are superseded only by
implemented, tested increments recorded in the progress log.

Real HTTP acceptance covers approved-only cross-month reports, complete filtered
Excel, root lineage and scope guards, SELF paging across 501 same-date records, and
distinct operational utilisation. Utilisation is not net sales or an expiry ledger.
Credit-funded awards and incentives are not fabricated by conditional cash estimates.

## Execution evidence

Latest commands, actual totals, failures investigated, and disposable-database cleanup
are recorded in `PROGRESS.md`. Default test skips do not establish opt-in acceptance.
Browser fixtures create synthetic bookings/read history; holds, cash completion and
package redemption use the real mounted application and authoritative sale writers.
