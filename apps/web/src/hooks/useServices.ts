import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CatalogStatusValue,
  CreateServiceInput,
  ServiceDetail,
  ServiceSummary,
  UpdateServiceInput,
} from "@glampro_suite/shared";

import { queryKeys } from "@/constants/queryKeys";
import { get, getPaginated, patch, post } from "@/lib/api";

export interface ServiceListFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: CatalogStatusValue;
  departmentId?: string;
}

/** The same filters minus paging, for the counts the tiles read. */
export type ServiceCountFilters = Omit<ServiceListFilters, "page" | "pageSize">;

/**
 * One page of services.
 *
 * The filters object is the last element of the key, so `invalidateQueries` on
 * `queryKeys.services.list()` matches every page and every search term — which is
 * what a create or an edit needs, since it must refresh the list the user is
 * looking at even when they had filtered it.
 *
 * There is no `lowStock` here and none is sent: a service is not stock —
 * `serviceSummarySchema` has no `quantity` and no `lowStock` — and the API ignores
 * the parameter rather than rejecting it, so the two catalogue tabs can share one
 * toolbar.
 */
export function useServiceList(filters: ServiceListFilters) {
  return useQuery({
    queryKey: [...queryKeys.services.list(), filters],
    queryFn: () =>
      getPaginated<ServiceSummary>("/services", {
        page: filters.page,
        pageSize: filters.pageSize,
        search: filters.search || undefined,
        status: filters.status || undefined,
        departmentId: filters.departmentId || undefined,
      }),
    placeholderData: (previous) => previous,
  });
}

/**
 * How many services the salon has, for the screen's "Total items" tile.
 *
 * `pageSize: 1` because only `total` is read: the tile is a server-side aggregate
 * over the whole catalogue, which a page of rows in the browser could never
 * compute — the same reason the products tiles are counts (ADR 0010).
 */
export function useServiceCount(filters: ServiceCountFilters = {}, enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.services.count(), filters],
    queryFn: () =>
      getPaginated<ServiceSummary>("/services", {
        search: filters.search || undefined,
        status: filters.status || undefined,
        departmentId: filters.departmentId || undefined,
        pageSize: 1,
      }),
    enabled,
    staleTime: 60 * 1000,
  });
}

/** One service, for the editor's second read. */
export function useService(id: string | null) {
  return useQuery({
    queryKey: queryKeys.services.detail(id ?? ""),
    queryFn: () => get<ServiceDetail>(`/services/${id}`),
    enabled: id !== null,
  });
}

/** Resolve only cart services, including those restored from a saved or held cart. */
export function useCartServices(ids: string[]) {
  return useQueries({
    queries: [...new Set(ids)].map((id) => ({
      queryKey: queryKeys.services.detail(id),
      queryFn: () => get<ServiceDetail>(`/services/${id}`),
    })),
  });
}

export function useCreateService() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateServiceInput) => post<ServiceDetail>("/services", input),
    onSuccess: () => {
      invalidateCatalogue(queryClient);
    },
  });
}

export function useUpdateService() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateServiceInput }) =>
      patch<ServiceDetail>(`/services/${id}`, input),
    onSuccess: (_service, variables) => {
      invalidateCatalogue(queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.services.detail(variables.id) });
    },
  });
}

/**
 * A write moves the tiles as well as the table — a service added or retired
 * changes "Total items" — so the counts are invalidated with the list rather than
 * leaving a tile stale until a reload.
 */
function invalidateCatalogue(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.services.list() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.services.count() });
}
