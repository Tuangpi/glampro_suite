import { useQuery } from "@tanstack/react-query";
import { ownerSummarySchema } from "@glampro_suite/shared";
import { queryKeys } from "@/constants/queryKeys";
import { get } from "@/lib/api";

/** Mounted only within the owner/manager and dashboard-entitlement boundary. */
export function useOwnerBriefing(tenantId: string, userId: string) {
  return useQuery({
    queryKey: queryKeys.ownerAssistant.summary(tenantId, userId),
    queryFn: async () =>
      ownerSummarySchema.parse(await get<unknown>("/ai-assistant/owner-summary")),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
