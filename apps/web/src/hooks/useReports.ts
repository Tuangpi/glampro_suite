/** Screen 10's range report — one request so every table shares one period. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActivatePackageValuationInput, ReportOverview, ZReport } from "@glampro_suite/shared";
import {
  activatePackageValuationSchema,
  packageValuationActivationSchema,
  packageValuationReportSchema,
} from "@glampro_suite/shared";

import { queryKeys } from "@/constants/queryKeys";
import { get, post } from "@/lib/api";

export interface ReportRange {
  from: string;
  to: string;
  timeZone: string;
}

/** One salon-local calendar date for the daily close. */
export interface ZReportParams {
  date: string;
  timeZone: string;
}

export function useReportOverview(range: ReportRange) {
  return useQuery({
    queryKey: [...queryKeys.reports.overview(), range],
    queryFn: () =>
      get<ReportOverview>("/reports/overview", {
        from: range.from,
        to: range.to,
        timeZone: range.timeZone,
      }),
    staleTime: 60_000,
  });
}

export function useZReport(params: ZReportParams) {
  return useQuery({
    queryKey: [...queryKeys.reports.zReport(), params],
    queryFn: () => get<ZReport>("/reports/z-report", { ...params }),
    staleTime: 60_000,
  });
}

/** Independent current company snapshot, never keyed by the sales date range. */
export function usePackageValuationReport() {
  return useQuery({
    queryKey: queryKeys.reports.packageValuation(),
    queryFn: async () =>
      packageValuationReportSchema.parse(await get<unknown>("/reports/package-valuation")),
    staleTime: 60_000,
  });
}

export function useActivatePackageValuation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: ActivatePackageValuationInput) =>
      packageValuationActivationSchema.parse(
        await post<unknown>(
          "/reports/package-valuation/activation",
          activatePackageValuationSchema.parse(input),
        ),
      ),
    // Never automatically retry a confirmation. Identical manual retries are safe.
    retry: false,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.reports.all() }),
    onError: () => client.invalidateQueries({ queryKey: queryKeys.reports.packageValuation() }),
  });
}
