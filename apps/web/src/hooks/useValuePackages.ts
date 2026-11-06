import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CatalogStatusValue,
  CreateValuePackageInput,
  UpdateValuePackageInput,
  ValuePackageDetail,
  ValuePackageSummary,
} from "@glampro_suite/shared";

import { queryKeys } from "@/constants/queryKeys";
import { get, getPaginated, patch, post } from "@/lib/api";

export interface ValuePackageListFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: CatalogStatusValue;
}

/**
 * One page of prepaid credit — handoff screen 08's fifth tab.
 *
 * `status` is sent, unlike the gift-card tab: a value package **has** the column, so
 * "retired only" is a question the toolbar can ask and the API can answer.
 */
export function useValuePackageList(filters: ValuePackageListFilters) {
  return useQuery({
    queryKey: [...queryKeys.valuePackages.list(), filters],
    queryFn: () =>
      getPaginated<ValuePackageSummary>("/value-packages", {
        page: filters.page,
        pageSize: filters.pageSize,
        search: filters.search || undefined,
        status: filters.status || undefined,
      }),
    placeholderData: (previous) => previous,
  });
}

/** One package, for the editor's second read. */
export function useValuePackage(id: string | null) {
  return useQuery({
    queryKey: queryKeys.valuePackages.detail(id ?? ""),
    queryFn: () => get<ValuePackageDetail>(`/value-packages/${id}`),
    enabled: id !== null,
  });
}

export function useCreateValuePackage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateValuePackageInput) =>
      post<ValuePackageDetail>("/value-packages", input),
    onSuccess: () => {
      invalidateValuePackages(queryClient);
    },
  });
}

/**
 * A partial update.
 *
 * The till searches value packages by name and by `status` (`sale.service.ts`), so
 * the cached lists are invalidated rather than patched in place: a renamed or retired
 * package must be gone from the next search, not after a reload.
 */
export function useUpdateValuePackage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateValuePackageInput }) =>
      patch<ValuePackageDetail>(`/value-packages/${id}`, input),
    onSuccess: (_package, variables) => {
      invalidateValuePackages(queryClient);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.valuePackages.detail(variables.id),
      });
    },
  });
}

function invalidateValuePackages(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.valuePackages.list() });
}
