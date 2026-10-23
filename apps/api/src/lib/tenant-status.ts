import type { TenantStatus } from "@glampro_suite/shared";

/**
 * The status a tenant is *effectively* in, which is not always the one stored.
 *
 * `docs/saas/TENANCY.md` §3 requires sign-in to consider both the stored status and
 * the subscription's `endDate`, because a salon whose period lapsed is expired even
 * though nobody flipped the column. Stored `CANCELLED` and `SUSPENDED` are
 * deliberate operator actions and win outright; `ACTIVE` is the only value that can
 * be overridden, and only by a lapsed period.
 */
export function resolveTenantStatus(
  storedStatus: TenantStatus,
  latestSubscriptionEndDate: Date | null,
  now: Date = new Date(),
): TenantStatus {
  if (storedStatus === "CANCELLED") return "CANCELLED";
  if (storedStatus === "EXPIRED") return "EXPIRED";
  if (storedStatus === "SUSPENDED") return "SUSPENDED";

  // Stored ACTIVE: a lapsed subscription makes it expired in effect. A tenant with
  // no subscription rows at all is left ACTIVE, because provisioning may legitimately
  // precede the first plan (see the seed).
  if (latestSubscriptionEndDate !== null && latestSubscriptionEndDate <= now) {
    return "EXPIRED";
  }

  return "ACTIVE";
}

/**
 * Whether the status permits signing in at all.
 *
 * `SUSPENDED` is deliberately allowed: the spec has the owner read-only rather than
 * locked out, so the person who can settle the bill is the person who sees why.
 * Writes are refused separately — see `requireWritableTenant`.
 */
export function canSignIn(status: TenantStatus): boolean {
  return status === "ACTIVE" || status === "SUSPENDED";
}

/** Whether the status permits writing. */
export function canWrite(status: TenantStatus): boolean {
  return status === "ACTIVE";
}
