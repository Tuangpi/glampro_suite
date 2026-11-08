# Documentation

Start with the [repository README](../README.md). Read detailed guides only when
working on that feature; they are not a mandatory startup checklist.

## Project records

| Document                   | Purpose                                          |
| -------------------------- | ------------------------------------------------ |
| [Project](../PROJECT.md)   | Architecture, priorities, and safety constraints |
| [Tasks](../TASKS.md)       | Open work and links to detailed checklists       |
| [Progress](../PROGRESS.md) | Recent changes and verification boundaries       |

## Development

- [Demo seed and isolated test databases](development/demo-seeding.md)
- [Local messaging verification](development/local-messaging-verification.md)

## Operations

- [Platform console and company onboarding](operations/platform-console.md)
- [WhatsApp/SMS configuration and safety](operations/whatsapp-sms-integration.md)
- [Coordinated rollout and recovery checklist](operations/coordinated-rollout-checklist.md)
- [Treatment completion audit](operations/treatment-completion-audit.md)

## Salon features

- [Business reports and chart definitions](features/business-reports.md)
- [Departments](features/departments.md)
- [Multi-outlet support](features/multi-outlet.md)
- [Outlet hours and booking](features/outlet-booking-hours.md)
- [Thermal receipts](features/thermal-receipts.md)
- [POS vouchers and recorded refunds — ADR 0020](decisions/ADR-0020-pos-vouchers-refunds.md)
- [Whole remaining session-package transfers](features/session-package-transfers.md)
- [Session-package valuation policy](features/package-valuation-policy-draft.md) and
  [implementation evidence](features/package-valuation-implementation.md)

## Owner assistant

- [Rebooking recommendations](assistant/owner-rebooking.md)
- [Quiet-day opportunities](assistant/owner-quiet-days.md)
- [Draft approval and controlled delivery](assistant/owner-draft-delivery.md)
- [Bounded business questions](assistant/owner-explanations.md)
- [Outcomes and release readiness](assistant/owner-release-readiness.md)

## Commission and payroll

For configuration navigation, see [staff commission settings](features/staff-commission-settings.md).

Use the [commission/payroll index](commission_payroll/README.md) for requirements,
decisions, acceptance evidence, and the cutover runbook. Local acceptance is not
production activation or authorization to pay staff.

## History and supplied material

- [Archived root records, November 7, 2026](archive/2026-11-07/README.md) — full
  previous project, task, progress, ADR, and design history.
- [Superseded staff-commission project](archive/staff-commission/README.md).
- [Design handoff](../design/handoff/README.md) — supplied reference assets.
- [Commission source documents, demos, and reference implementation](commission_payroll/README.md#supplied-references)
  are separated from maintained application guides. Other supplied product reviews
  and schedules remain in their existing locations. Supplied material is not proof
  that application behavior is implemented or released.

## Keep it simple

- Keep root summaries short; link to one authoritative feature guide instead of
  repeating requirements and status in several places.
- Update an existing guide before adding another Markdown file.
- Keep dated test evidence in the relevant progress/acceptance record. Say what
  was actually run; old results are not a fresh verification.
- Preserve stable task/decision IDs and approved policy. Do not turn historical
  checkpoints into current instructions or erase unresolved limitations.
- Archive long handoff history rather than adding it to startup documents.
- Ownership: `PROJECT.md` owns architecture and safety; root `TASKS.md` owns
  cross-project work; feature checklists own their work and current status;
  `PROGRESS.md` and acceptance records own dated evidence. Link rather than copying.
- Put maintained guides in the existing topic folder. Commission `acceptance/`
  contains evidence, `history/` contains superseded handoffs, and `reference/`
  contains unchanged supplied assets. Do not add an index to every subfolder.
