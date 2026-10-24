# Outlet operating hours and booking

HOURS-01 extends the previously company-wide booking calendar. It does not
change shared customer/credit identity, stock, sale attribution or company roles.

## Configure and book

- Managers/owners: Outlets → Operating hours. Save a full week in the outlet's
  IANA time zone, or select **Use company hours** to remove the override.
- Inherited hours use the company's opening/closing clock values in the outlet's
  own time zone. A closed day is `null`. A complete all-closed week is an explicit
  override, not inheritance. No split shifts, overnight windows or holiday
  exceptions are introduced. Missing company hours means closed for branch and
  public booking.
- Staff: select an outlet in the top bar before creating its appointment.
  Calendar times use the selected outlet's zone. The editor uses the saved
  appointment's outlet zone even when opened from the consolidated calendar.
  Existing company-wide appointments use the company zone in the editor.
- No selected outlet means consolidated calendar reads and company-wide manual
  creation. These manual bookings retain the previous permissive hours behavior;
  the editor labels this distinction. Branch views include legacy/company-wide
  appointments as well as their own, never another branch's appointments.
- Public booking requires an active outlet selection whenever the company has
  outlets, including when all are suspended. Companies without outlets keep
  their existing public booking contract and company-hours enforcement.
- An appointment's outlet is fixed when created, including every recurring
  occurrence. Rescheduling does not silently transfer it to the current branch.
  No branch-transfer operation is provided. Existing appointments are not backfilled.

## Enforcement and compatibility

New and rescheduled branch bookings must fit the complete service chain inside
effective hours. Closing boundaries are half-open: finishing exactly at closing
is allowed; any overrun is refused. Public slots remain on the existing 30-minute
opening-relative grid. Real minute boundaries are checked through DST changes.

Recurring bookings step in the outlet's local zone, retaining staff/resource
checks and the existing later-occurrence skip report. Company-wide staff shifts
remain interpreted in the company zone. Staff and rooms/equipment remain shared
across outlets and conflict checks always include all branches and legacy rows.
No branch roster, warehouse or per-user branch allowlist is implied.

Changing hours/time zone does not move bookings or retroactively cancel them.
Comment/customer edits, cancellation and completion remain possible after hours
change. Moving/resizing a branch booking or reactivating a cancelled booking
rechecks its outlet. Company-wide legacy bookings stay company-wide on edits.

Transactional booking messages display the saved branch's local time, name and
zone. Messaging consent, quiet hours and provider policies remain company-wide.
Receipt and financial/report formatting remain unchanged. Quiet-day previews use
effective hours and local dates for the selected outlet, but their disclosed
booking-count heuristic remains company-wide.

## API and deployment

- `POST /api/outlets`, `PATCH /api/outlets/:id`: optional `operatingHours` is
  either `null` (inherit) or all seven lowercase weekday keys, each `null` or
  `{ "open": "09:00", "close": "18:00" }`. Omission preserves an existing value.
  Use valid 00:00–23:59 clock values and opening before closing.
- Outlet lists expose `operatingHours`. Existing manager/owner and writable-tenant
  guards apply to writes. Branch identity/ownership/status is validated server-side.
- Public config exposes active outlet IDs/names/time zones/locales. Availability
  queries and booking bodies accept `outletId`. Missing selection with configured
  outlets returns `BOOKING_OUTLET_REQUIRED`; foreign IDs are unavailable.
- Authenticated appointment creation uses validated `X-Outlet-Id`; responses carry
  `outletId`, `outletName` and `outletTimeZone`. The update contract does not transfer
  outlet identity. Foreign-tenant outlet references are also blocked by the database
  composite foreign key.
- Apply `20261024140000_outlet_booking_hours` before deploying the updated API.
  This adds nullable JSON hours to outlets and a nullable tenant-bound outlet
  reference/index to appointments. It does not modify existing rows' attribution.
  Migration must be explicitly authorized for the application environment.

Automated verification is not a production rollout or owner/browser acceptance.
