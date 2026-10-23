/**
 * Dashboard data — handoff screen 05 (`GET /api/reports/dashboard`).
 *
 * One hook for one request: the four tiles share one reporting window (see
 * `report.ts`). The window is the salon's day in its configured timezone,
 * sent as explicit instants to agree with the server's default local-day policy.
 *
 * The window key is stable across renders because both edges are derived from
 * calendar midnight rather than from `Date.now()`, so a dashboard that re-renders
 * does not refetch itself; only the day turning over changes the key, which is
 * exactly when the answer would change.
 */
import { useQuery } from "@tanstack/react-query";
import type { DashboardSummary } from "@glampro_suite/shared";

import { queryKeys } from "@/constants/queryKeys";
import { get } from "@/lib/api";
import { instantFromSalonDate, toSalonDate } from "@/lib/salon-time";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

/**
 * The salon's day's edges as instants: midnight to the last millisecond, in the
 * salon's timezone — so "today's income" means the salon's today, not the desk's.
 * The window key is stable across renders because both edges are derived from
 * calendar midnight rather than from `Date.now()`, so a dashboard that re-renders
 * does not refetch itself; only the day turning over changes the key, which is
 * exactly when the answer would change.
 */
export function todayWindow(timeZone: string): { from: string; to: string } {
  const now = toSalonDate(new Date(), timeZone) ?? new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return {
    from: instantFromSalonDate(from, timeZone).toISOString(),
    to: instantFromSalonDate(to, timeZone).toISOString(),
  };
}

export function useDashboardSummary() {
  const { timeZone } = useSalonFormatting();
  const window = todayWindow(timeZone);

  return useQuery({
    queryKey: [...queryKeys.dashboard.summary(), window],
    queryFn: () => get<DashboardSummary>("/reports/dashboard", window),
    // The tiles are live numbers a salon glances at; a minute's staleness is
    // the right horizon — long enough that a dashboard left open does not hammer
    // the API, short enough that "today's income" is still today's.
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
