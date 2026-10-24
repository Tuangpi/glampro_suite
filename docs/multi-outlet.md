# Multi-outlet support — TK2610-0028

## Scope

One company remains one tenant. Outlets are optional operational locations within
that tenant, not independent tenants or authentication realms.

- Customers, their tenant-unique email identity, family grouping, package holdings,
  prepaid credit and gift-card balances remain shared company-wide.
- Products and package templates may have an optional outlet availability tag.
  Null means available everywhere. An outlet sees its own and tenant-wide items.
- Product `quantity` remains **one shared stock pool**, with guarded atomic sale
  decrements and transactional void/refund restoration. This is not per-location
  warehouse inventory, transfers, or separate quantities with consolidated sums.
- Sales snapshot the validated outlet. Branch sales, holds, payments, refunds,
  performance and sale-linked commissions are filtered to that outlet. Branch
  selection does not rewrite historical attribution. Legacy null-attributed sales
  appear in consolidated mode only.
- Existing company roles apply at all company outlets. Managers and company
  super-admins manage outlets; existing route roles and module entitlements still
  govern business actions. **There are no per-user branch allowlists.** A client
  cannot select a different tenant's outlet. Suspended outlets reject selection.
- Customer balances/liability, staff, appointments, treatment, and resource
  schedules remain company-wide. Reporting uses the existing salon/report time
  zone, not an automatic branch-local day. Sale-linked report metrics are
  branch-filtered; removing selection consolidates all outlets and legacy sales.

## API

Authenticated business requests may send `x-outlet-id`. Authentication first
resolves the tenant from the validated session, then checks the outlet in that
tenant and its active status. Malformed selection returns 422; missing/foreign
selection returns 404; suspended selection returns 403. Omission retains legacy
tenant-wide operation. Request body/query outlet IDs do not establish context.

- `GET /api/outlets`: company outlet list, all authenticated company roles.
- `POST /api/outlets`: manager/super-admin creation, writable company required.
- `PATCH /api/outlets/:id`: same guards; update metadata or suspend/reactivate.
- `POST /api/outlets/assign`: same guards; `{ kind: "PRODUCT" | "PACKAGE", id,
outletId: string | null }` changes availability, not stock or family membership.

No destructive outlet-delete API is exposed. Composite tenant/outlet foreign keys
protect Customer, Package, Product and Sale against cross-company links. Existing
references restrict outlet deletion/reassignment.

Tenant-unique sale idempotency keys reused in a different selected outlet return
409 `IDEMPOTENCY_OUTLET_MISMATCH`, without returning the other branch's receipt.

## Browser

The top-bar outlet picker offers active branches and `All outlets / tenant-wide`.
Selection is tab-local, revalidated by the server, and cleared on sign-out/session
failure. Switching asks before clearing the local unsaved cart, then reloads so
query/component state from the previous branch cannot survive. Held carts stay
at their original outlet. Authentication and outlet-management requests omit the
selection header so a suspended branch cannot prevent recovery.

Managers use `/outlets` to create, suspend/reactivate, and assign product/package
availability using an existing catalogue ID. The API also supports metadata edits.

## Migration and verification

Deploy both `20261024090000_outlet_foundation` and
`20261024100000_outlet_product_availability` through the normal authorized
migration process **before** running the updated application. Neither migration
is applied to the application database by this task. Existing records keep null
outlet links; no backfill or family/email rewrite occurs.

Live acceptance is opt-in with `OUTLET_ACCEPTANCE=1` and a dedicated disposable
database at `127.0.0.1:55448/outlet_test`. The guards reject other database targets.
Tests cover HTTP selection/roles, tenant isolation, shared identity/catalogue,
stock concurrency, idempotency, holds, void/refund restoration, branch and
consolidated reporting, and database reference integrity. See the task handoff
for actual run results and unrelated workspace blockers.
