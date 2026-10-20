/**
 * Rooms and equipment — TK2610-0020 phase D (`/api/resources`).
 *
 * The list is not paginated, so there is one key and no filter object: the
 * settings card renders every room and the booking form reads the same set to
 * summarise what a booking will occupy. A write invalidates the one entry both
 * of them share.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CatalogStatusValue,
  CreateResourceInput,
  ResourceKindValue,
  ResourceSummary,
  UpdateResourceInput,
  ServiceSummary,
} from "@glampro_suite/shared";
import { MAX_PAGE_SIZE } from "@glampro_suite/shared";

import { queryKeys } from "@/constants/queryKeys";
import { get, getPaginated, patch, post } from "@/lib/api";

/** Read every page, including retired services whose existing links remain editable. */
export function useResourceServices() {
  return useQuery({
    queryKey: [...queryKeys.services.list(), "resource-eligibility"],
    queryFn: async () => {
      const data: ServiceSummary[] = [];
      let page = 1;
      for (;;) {
        const result = await getPaginated<ServiceSummary>("/services", {
          page,
          pageSize: MAX_PAGE_SIZE,
        });
        data.push(...result.data);
        if (data.length >= result.total) return { data };
        if (result.data.length === 0) throw new Error("The service list is incomplete.");
        page += 1;
      }
    },
  });
}

export interface ResourceListFilters {
  kind?: ResourceKindValue;
  status?: CatalogStatusValue;
  search?: string;
}

export function useResourceList(filters: ResourceListFilters = {}, enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.resources.list(), filters],
    queryFn: () =>
      get<ResourceSummary[]>("/resources", {
        kind: filters.kind || undefined,
        status: filters.status || undefined,
        search: filters.search || undefined,
      }),
    enabled,
  });
}

export function useCreateResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateResourceInput) => post<ResourceSummary>("/resources", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.resources.list() });
    },
  });
}

export function useUpdateResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateResourceInput }) =>
      patch<ResourceSummary>(`/resources/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.resources.list() });
    },
  });
}
