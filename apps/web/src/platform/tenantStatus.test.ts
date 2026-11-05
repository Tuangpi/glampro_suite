/**
 * The gating predicates are the console's copy of rules the API enforces, so they are
 * worth testing on their own: a bug here dims a button that would have worked, or
 * lights one that answers `409`.
 *
 * The cases below are `changeCompanyLifecycle`'s own branches, read as a table.
 */
import type { CompanyAdministration } from "@glampro_suite/shared";
import { describe, expect, it } from "vitest";

import { canCancel, canReactivate, canSuspend, latestPeriod, runningPeriod } from "./tenantStatus";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-05T09:00:00.000Z");
type SubscriptionStatus = CompanyAdministration["subscriptions"][number]["status"];

/** A recorded period as an offset in days from `NOW`, so no test depends on today. */
function period(startDays: number, endDays: number, status: SubscriptionStatus = "ACTIVE") {
  return {
    id: `${startDays}:${endDays}`,
    startDate: new Date(NOW + startDays * DAY).toISOString(),
    endDate: new Date(NOW + endDays * DAY).toISOString(),
    status,
    amount: "99.00",
    currency: "SGD",
    createdAt: new Date(NOW + startDays * DAY).toISOString(),
  };
}

describe("latestPeriod", () => {
  it("takes the field that has started, not the one that lasts longest overall", () => {
    // The scheduled year wins on endDate but has not begun, and the API's query
    // filters on `startDate`, so it is not the period a reactivation turns on.
    const rows = [period(-10, 5), period(30, 400, "PENDING")];
    expect(latestPeriod(rows, NOW)?.id).toBe("-10:5");
  });

  it("keeps a period that has ended, because ended is what the API refuses on", () => {
    expect(latestPeriod([period(-60, -30)], NOW)?.id).toBe("-60:-30");
  });

  it("ignores cancelled rows and a company with nothing recorded", () => {
    expect(latestPeriod([period(-10, 5, "CANCELLED")], NOW)).toBeUndefined();
    expect(latestPeriod([], NOW)).toBeUndefined();
  });
});

describe("runningPeriod", () => {
  it("is the latest period while it has not ended", () => {
    expect(runningPeriod([period(-10, 5)], NOW)?.id).toBe("-10:5");
  });

  it("is the row with the latest end when two periods overlap", () => {
    // An earlier row that has already ended cannot shadow the one still running.
    const rows = [period(-90, 3), period(-5, -1)];
    expect(runningPeriod(rows, NOW)?.id).toBe("-90:3");
  });
});

describe("canSuspend", () => {
  it("is offered only for a company that is running now", () => {
    expect(canSuspend("ACTIVE")).toBe(true);
    expect(canSuspend("EXPIRED")).toBe(false);
    expect(canSuspend("SUSPENDED")).toBe(false);
    expect(canSuspend("CANCELLED")).toBe(false);
  });
});

describe("canReactivate", () => {
  it("is refused when the row already says ACTIVE", () => {
    expect(canReactivate("ACTIVE", [period(-5, 25)], NOW)).toBe(false);
    expect(canReactivate("ACTIVE", [], NOW)).toBe(false);
  });

  it("is offered for a suspended company with a running period", () => {
    expect(canReactivate("SUSPENDED", [period(-5, 25)], NOW)).toBe(true);
  });

  it("is refused once the latest period has ended", () => {
    expect(canReactivate("SUSPENDED", [period(-60, -30)], NOW)).toBe(false);
    expect(canReactivate("CANCELLED", [period(-60, -30)], NOW)).toBe(false);
    expect(canReactivate("EXPIRED", [period(-60, -30)], NOW)).toBe(false);
  });

  it("is offered when no period has been recorded at all", () => {
    // Provisioning may precede the first plan: the API's query finds no row, so it
    // does not refuse, and the console must not dim the button either.
    expect(canReactivate("SUSPENDED", [], NOW)).toBe(true);
    expect(canReactivate("CANCELLED", [], NOW)).toBe(true);
    expect(canReactivate("EXPIRED", [], NOW)).toBe(true);
  });

  it("is offered when every recorded period is still scheduled", () => {
    expect(canReactivate("SUSPENDED", [period(10, 40, "PENDING")], NOW)).toBe(true);
  });

  it("is offered again once a new period is running behind the lapsed one", () => {
    expect(canReactivate("SUSPENDED", [period(-60, -30), period(-1, 29)], NOW)).toBe(true);
  });
});

describe("canCancel", () => {
  it("is available until the company is cancelled", () => {
    expect(canCancel("ACTIVE")).toBe(true);
    expect(canCancel("SUSPENDED")).toBe(true);
    expect(canCancel("EXPIRED")).toBe(true);
    expect(canCancel("CANCELLED")).toBe(false);
  });
});
