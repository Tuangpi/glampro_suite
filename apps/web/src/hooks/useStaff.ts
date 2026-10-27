import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateStaffInput,
  GlobalRole,
  StaffDetail,
  StaffSummary,
  UpdateStaffInput,
} from "@glampro_suite/shared";

import { queryKeys } from "@/constants/queryKeys";
import type { StaffStatusFilter } from "@/constants/staff";
import { get, getPaginated, patch, post } from "@/lib/api";

export interface StaffListFilters {
  page: number;
  pageSize: number;
  search?: string;
  role?: GlobalRole;
  status?: StaffStatusFilter;
}

/** The same filters minus paging, for the counts the stat tiles read. */
export type StaffCountFilters = Omit<StaffListFilters, "page" | "pageSize">;

/**
 * One page of staff.
 *
 * `status` and `role` are only sent when they are a real filter. `all` is left out
 * rather than posted: `staffListQuerySchema` defaults to `"all"`, so sending it
 * would be a second way to say "no filter" — the same rule the catalogue's
 * `lowStock` flag follows.
 *
 * The filters object is the last element of the key, so `invalidateQueries` on
 * `queryKeys.staff.list()` matches every page, every search term and every filter,
 * which is what a create or an edit needs.
 */
export function useStaffList(filters: StaffListFilters, enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.staff.list(), filters],
    queryFn: () =>
      getPaginated<StaffSummary>("/staff", {
        page: filters.page,
        pageSize: filters.pageSize,
        search: filters.search || undefined,
        role: filters.role,
        status: filters.status === "all" ? undefined : filters.status,
      }),
    enabled,
    placeholderData: (previous) => previous,
  });
}

/**
 * A count over the salon's **whole** team rather than over a page of it.
 *
 * `pageSize: 1` because only `total` is read: the three tiles are aggregates the
 * server owns, because one page of rows in the browser can never answer "how many
 * accounts are disabled" (ADR 0010). The filters are the last element of the key, so
 * the Active tile and a search-filtered count are two entries rather than one that
 * answers the wrong question.
 */
export function useStaffCount(filters: StaffCountFilters = {}, enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.staff.count(), filters],
    queryFn: () =>
      getPaginated<StaffSummary>("/staff", {
        search: filters.search || undefined,
        role: filters.role,
        status: filters.status === "all" ? undefined : filters.status,
        pageSize: 1,
      }),
    enabled,
    staleTime: 60 * 1000,
  });
}

/** One staff member, for the editor's second read. */
export function useStaff(id: string | null) {
  return useQuery({
    queryKey: queryKeys.staff.detail(id ?? ""),
    queryFn: () => get<StaffDetail>(`/staff/${id}`),
    enabled: id !== null,
  });
}

export function useCreateStaff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateStaffInput) => post<StaffDetail>("/staff", input),
    onSuccess: () => {
      invalidateStaff(queryClient);
    },
  });
}

export function useUpdateStaff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateStaffInput }) =>
      patch<StaffDetail>(`/staff/${id}`, input),
    onSuccess: (_staff, variables) => {
      invalidateStaff(queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.staff.detail(variables.id) });
    },
  });
}

/**
 * A write moves the tiles as well as the table — disabling the last manager is
 * exactly the thing the Disabled tile is watching for — so the counts are
 * invalidated with the list rather than leaving a tile stale until a reload.
 */
function invalidateStaff(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: ["payroll-configuration"] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.staff.list() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.staff.count() });
}
