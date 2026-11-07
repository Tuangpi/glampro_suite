import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DepartmentSummary,
  SaveDepartmentInput,
  DepartmentDeletionImpact,
} from "@glampro_suite/shared";

import { queryKeys } from "@/constants/queryKeys";
import { del, get, patch, post } from "@/lib/api";

async function invalidateDepartments(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all(
    [
      queryKeys.departments.list().slice(0, 1),
      queryKeys.products.list().slice(0, 1),
      queryKeys.services.list().slice(0, 1),
      queryKeys.staff.list().slice(0, 1),
      queryKeys.customers.all(),
      queryKeys.appointments.all(),
      queryKeys.sale.items(),
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}

export function useDepartmentDeletionImpact(id: string | null) {
  return useQuery({
    queryKey: queryKeys.departments.deletionImpact(id ?? ""),
    queryFn: () => get<DepartmentDeletionImpact>(`/departments/${id}/deletion-impact`),
    enabled: id !== null,
    staleTime: 0,
  });
}

export function useDeleteDepartment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del<DepartmentDeletionImpact>(`/departments/${id}`),
    onSuccess: () => invalidateDepartments(queryClient),
  });
}

/**
 * Shared by management and all department pickers. Writes invalidate this cache.
 */
export function useDepartments(enabled = true) {
  return useQuery({
    queryKey: queryKeys.departments.list(),
    queryFn: () => get<DepartmentSummary[]>("/departments"),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

export function useSaveDepartment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: SaveDepartmentInput }) =>
      id
        ? patch<DepartmentSummary>(`/departments/${id}`, input)
        : post<DepartmentSummary>("/departments", input),
    onSuccess: () => invalidateDepartments(queryClient),
  });
}
