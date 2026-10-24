# Future quiet-day opportunities — OA-04

Owner/manager Dashboard previews are read-only and require dashboard, appointments
and catalogue access. Select an active service; catalogue selection is paginated.
No new main navigation, migration, offer, recipient list, approval or sending action
is introduced. Existing `/slow-day-promos` is a separate historical-volume draft
API, retained for compatibility; it is not used as future availability evidence.

## Bounded deterministic screening

`GET /api/ai-assistant/quiet-day-opportunities?serviceId=…&days=7` accepts one service
and 1–7 future salon-local days, starting tomorrow. Arbitrary dates, tenant IDs and
discount parameters are rejected. A day qualifies for checking when fewer than
three non-cancelled appointments start that day. This is a disclosed screening
threshold, not a utilisation measure, demand prediction or business target.

The preview shares the public booking context/hours functions and calls the actual
appointment engine's read-only availability checker. It checks active service,
eligible enabled staff, configured shifts and breaks, half-open staff/appointment
conflicts, and linked room/equipment capacity. Closed or missing operating hours
produce no openings. Staff with no shift rows remain unrestricted under existing
booking policy. Missing service duration uses booking's existing 60-minute fallback.

Search visits real instants, preserving DST gaps/repeated hours, on booking's
30-minute local grid. It returns the earliest verified opening per qualifying day,
considering at most ten staff and 120 staff/slot checks per request. An eleventh
candidate is fetched only to detect truncation. Limits are reported explicitly.
No result does not mean all staff are busy or the company is full.

Appointments, staff/resources and operating hours remain company-wide under the
existing multi-outlet policy. There is no branch-specific capacity claim. Reads
are point-in-time, not a locked snapshot; nothing is reserved. Booking writes must
recheck availability under the existing calendar lock. Staff/resource data outside
configured booking rules, demand, margins and profit are not inferred.

## Non-discount actions and offer interactions

Recommend reviewing a regular-price appointment opening first. No discretionary
assistant discount ceiling is approved, so the preview's only permitted discount
is **0%**, enforced by the shared response contract. No voucher is issued or
stacked, and no membership price, package entitlement, manual discount or existing
offer is altered. This does not declare all services profitable or existing offers
compatible. Any discount expansion needs explicit policy and checkout interaction
tests; controlled campaign delivery remains OA-05 and requires supported offers
and provider templates. Existing legacy draft APIs do not authorize publication.

## Evidence and walkthrough

UI shows service/duration, salon timezone, exact half-open future window, as-of
timestamp, daily booking count, verified opening and partial-search limitations.
Loading and failed refreshes hide old results, with explicit retry; role/module
loss unmounts the workspace. Refresh before acting. No consent eligibility or
recipient selection is implied by an opening.

Owner walkthrough (not performed by the agent): select a service, compare an
opening to the appointment calendar, inspect limitations, retry a failed request,
and verify unavailable resources/shifts exclude openings. Do not contact customers
or enable a sender to complete this walkthrough. No application deployment or
database changes are authorized by this feature.
