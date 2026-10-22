import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateCustomerInput,
  CustomerDetail,
  CustomerHoldings,
  CustomerSummary,
  UpdateCustomerInput,
  ArchiveCustomerInput,
} from "@glampro_suite/shared";

import { queryKeys } from "@/constants/queryKeys";
import { get, getPaginated, patch, post } from "@/lib/api";

export interface CustomerListFilters {
  page: number;
  pageSize: number;
  search?: string;
  includeArchived?: boolean;
}

/**
 * One page of customers.
 *
 * The filters object is the last element of the key, so `invalidateQueries` on
 * `queryKeys.customers.list()` matches every page and every search term — which is
 * what a create or an edit needs, since it must refresh the list the user is
 * looking at even when they had filtered it.
 */
export function useCustomerList(filters: CustomerListFilters) {
  return useQuery({
    queryKey: [...queryKeys.customers.list(), filters],
    queryFn: () =>
      getPaginated<CustomerSummary>("/customers", {
        page: filters.page,
        pageSize: filters.pageSize,
        search: filters.search || undefined,
        includeArchived: filters.includeArchived ? "true" : undefined,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useCustomer(id: string | null) {
  return useQuery({
    queryKey: queryKeys.customers.detail(id ?? ""),
    queryFn: () => get<CustomerDetail>(`/customers/${id}`),
    enabled: id !== null,
  });
}

/**
 * What a customer can still spend — packages and prepaid credit (TK2610-0011).
 *
 * Only fetched once a customer is attached: a walk-in has no credit and the endpoint
 * needs an id. The payment sheet is the only caller, and it asks as it opens rather
 * than on every cart change, because the answer only matters at the tender step.
 */
export function useCustomerHoldings(customerId: string | null) {
  return useQuery({
    queryKey: queryKeys.customers.holdings(customerId ?? ""),
    queryFn: () => get<CustomerHoldings>(`/customers/${customerId}/holdings`),
    enabled: customerId !== null,
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateCustomerInput) => post<CustomerDetail>("/customers", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.customers.list() });
    },
  });
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCustomerInput }) =>
      patch<CustomerDetail>(`/customers/${id}`, input),
    onSuccess: (_customer, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.customers.list() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.customers.detail(variables.id),
      });
    },
  });
}

export function useArchiveCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ArchiveCustomerInput }) =>
      post<CustomerDetail>(`/customers/${id}/archive`, input),
    onSuccess: (customer, { id }) => {
      queryClient.setQueryData(queryKeys.customers.detail(id), customer);
      void queryClient.invalidateQueries({ queryKey: queryKeys.customers.list() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail(id) });
    },
  });
}
