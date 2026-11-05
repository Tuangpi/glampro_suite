/**
 * What the console says about a company's access, in one place.
 *
 * Three screens ask the same two questions — "what is this company's status?" and
 * "may I do this to it?" — and they used to answer them separately:
 * `SubscriptionPanel` owned the badge colours for the status, and the lifecycle
 * buttons offered suspend, reactivate and cancel regardless of either, so two of
 * the three always answered `409`. The verbs are also *not* decided by one value:
 *
 * - **Suspend** is only meaningful for a company that is running now, which is
 *   `effectiveStatus === "ACTIVE"` — a stored `ACTIVE` company whose last period
 *   ended reads `EXPIRED`, and suspending something already closed says nothing.
 * - **Reactivate** is the opposite move, and it is decided by the **stored**
 *   status: `changeCompanyLifecycle` refuses it when the row already says `ACTIVE`
 *   ("The company already has that status"), and it refuses it when the latest
 *   period that has started has already ended — a reactivated company gets its
 *   access from the period, not from the button. A company with **no** period at
 *   all is not refused: provisioning may legitimately precede the first plan, and
 *   `resolveTenantStatus` leaves such a company `ACTIVE` for the same reason. So
 *   "suspended, nothing recorded yet" is reactivatable, and that has to be the
 *   button's answer too.
 * - **Cancel** is available until the company is cancelled.
 *
 * Every predicate below mirrors a rule the API already enforces, so a dimmed
 * button is never a request that would have worked.
 */
import type { CompanyAdministration } from "@glampro_suite/shared";

import type { BadgeVariant } from "@/components/ui/Badge";

export type TenantStatus = CompanyAdministration["effectiveStatus"];
export type Period = CompanyAdministration["subscriptions"][number];

/** One tone per meaning, so a colour never says two different things on a screen. */
export const TENANT_STATUS_TONE: Record<TenantStatus, BadgeVariant> = {
  ACTIVE: "success",
  SUSPENDED: "warning",
  EXPIRED: "danger",
  CANCELLED: "neutral",
};

/**
 * The enum as a word. `ACTIVE` in a badge is a database value read aloud; "Active"
 * is what the rest of the console's badges say ("Enabled", "Expired", "Core").
 */
export const TENANT_STATUS_LABEL: Record<TenantStatus, string> = {
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

/**
 * The period that counts, if any: the latest end among the ones that have started.
 *
 * This is `changeCompanyLifecycle`'s own query on the client — started
 * `ACTIVE`/`EXPIRED` periods only, latest `endDate` first — because whether a
 * reactivation is refused turns on *that* row having ended, which is not quite the
 * same question as "is one running right now" for a company with no periods at all.
 *
 * Scheduled (`PENDING`) and cancelled periods are not counted, and neither is one
 * whose first day has not arrived: a period brings no access forward until then.
 */
export function latestPeriod(rows: Period[], now: number): Period | undefined {
  return rows
    .filter((row) => row.status === "ACTIVE" || row.status === "EXPIRED")
    .filter((row) => new Date(row.startDate).getTime() <= now)
    .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime())[0];
}

/**
 * The period that is running now, if any: the latest one, while it has not ended.
 *
 * Access ends exactly at its `endDate`, so the latest row is the only one that can
 * be running — an earlier row that has not ended would have a later `endDate`.
 */
export function runningPeriod(rows: Period[], now: number): Period | undefined {
  const latest = latestPeriod(rows, now);
  return latest && new Date(latest.endDate).getTime() > now ? latest : undefined;
}

/** Takes the **effective** status: suspending a company that is not running is a no-op. */
export function canSuspend(effective: TenantStatus): boolean {
  return effective === "ACTIVE";
}

/**
 * Takes the **stored** status plus the periods — see the note at the top of the
 * file. `false` here means the API would answer `409` for one reason or another.
 *
 * Note what is *not* asked: "is a period running". A company with no period at all
 * can be reactivated (it is provisioned, not bought yet), and only a period that
 * has started and ended is a refusal. Asking for a running period instead dims the
 * button on a freshly provisioned company that the API would happily reactivate.
 */
export function canReactivate(stored: TenantStatus, rows: Period[], now: number): boolean {
  if (stored === "ACTIVE") return false;
  const latest = latestPeriod(rows, now);
  return latest === undefined || new Date(latest.endDate).getTime() > now;
}

/** Takes the **stored** status: a cancelled company cannot be cancelled again. */
export function canCancel(stored: TenantStatus): boolean {
  return stored !== "CANCELLED";
}
