# Platform console

Use `/platform` to manage companies, subscriptions, and add-ons. Operators can
access all companies; salon logins cannot. Operator changes are audited.

## Sign in and secure your account

1. Open `/platform/login` and enter your operator email and password.
2. Enter the emailed code if email verification is enabled (the default).
3. Use `/platform/account` to change your password or verification setting.
4. Sign out when finished. Retry if sign-out fails.

- Missing SMTP blocks verified login with `503 EMAIL_NOT_CONFIGURED`. Restore SMTP;
  do not bypass authentication.
- After separate bootstrap/database approval, initialize the first operator with
  `SEED_MODE=production npm run db:seed` from the repository root. Existing credentials
  and verification settings are not reset. See [seeding](../development/demo-seeding.md).
- Passwords require 12+ characters and cannot be known demo passwords. Changing one
  revokes other sessions, not the current session.
- Enabling verification requires an emailed code; disabling it requires your password.
- Sessions survive reload within the tab. New tabs start signed out; duplicated
  tabs may invalidate each other's rotating session.

## Find, create, or edit a company

| Task                                    | Where                     |
| --------------------------------------- | ------------------------- |
| Search and check subscription end dates | `/platform`               |
| Create a company and invite its owner   | `/platform/companies/new` |
| Manage one company                      | `/platform/companies/:id` |

Directory totals cover all companies, not search results. **Ending in 30 days**
excludes expired companies. **No plan recorded** means no subscription exists.
Company creation needs working SMTP and the portal origin. Use a lowercase,
hyphenated slug such as `glampro-demo-salon`.

To edit:

1. Open the overview and select **Edit company**.
2. Change the name/slug and enter a reason.
3. To assign/correct a pending owner, supply both owner name and email.
4. Save. If invitation delivery fails, use **Resend invitation**, not another save.

Owner changes require an active company. Invitations expire after 48 hours;
changing a pending owner's email issues a new one. An accepted owner cannot be
replaced here: ownership transfer is a separate task. Unchanged owner fields
preserve the existing owner.

## Access and subscriptions

Lifecycle actions require a reason and retain data:

| Action     | Use                                                         |
| ---------- | ----------------------------------------------------------- |
| Suspend    | Stop access for an active company                           |
| Reactivate | Restore a non-active company when subscription rules permit |
| Cancel     | Cancel a company not already cancelled                      |

A lapsed subscription needs a new current period, not repeated reactivation.
An active company regains access with a valid current period. Reactivating a
company with no plan does not create subscription access.

1. Open **Subscription → Record period**.
2. Enter dates, amount, currency, and reason; save.
3. Check the plan summary and history.

Recording a period/payment does **not** charge money. End dates must be after the
start and in the future; overlapping periods are rejected. Future periods do not
provide early access. Dates use the operator's local offset and end at midnight
on the selected end day.

## Add-ons

1. Open **Module access** and toggle an available add-on.
2. Enter a reason and optional future expiry, or choose **No expiry**.
3. Confirm the saved state. Expired grants show as off.

- Core modules cannot be disabled; **Not in this release** modules cannot be enabled.
- **Turn all on/off** affects supported add-ons only.
- Bulk grant preserves existing active expiries; bulk revoke also clears lapsed grants.
- Backend access checks apply even if an open salon tab briefly shows an old menu.

## Delete a company — irreversible

Prefer suspend/cancel if records must remain.

1. Obtain explicit approval and arrange required backup/export first. Deletion
   creates no export or recovery copy.
2. Verify the company, open its deletion confirmation, and enter a reason.
3. Type the exact company slug and confirm permanent deletion.
4. Verify the returned result before reporting success.

**Removes:** tenant-scoped customers, appointments, sales/payments, payroll,
subscriptions, packages/prepaid, messaging, consent, and treatment records.
**Keeps:** platform audit evidence identifying the company, reason, and deleted row count.
The database purge and audit receipt are atomic: failure rolls them back together.

This is not a customer-erasure or retention-scheduling tool. Do not claim backup
or export copies are deleted. Required purge migrations must be applied first.

Maintenance: see `apps/api/src/services/company-purge.service.ts`. New tenant-scoped
models must enter `TENANT_PURGE_ORDER` in dependency order; reference audit tables
must stay out. Keep the purge bypass transaction-local and tenant-specific.
