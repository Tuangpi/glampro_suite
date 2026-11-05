import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ConfigurePrivacyNoticeInput,
  CustomerConsent,
  PrivacyNotice,
  RecordCustomerConsentInput,
} from "@glampro_suite/shared";
import { useAuth } from "@/contexts/AuthContext";
import { get, post } from "@/lib/api";

/**
 * The notice this salon currently presents.
 *
 * `enabled` exists for the Add-customer drawer, which needs the notice only to
 * decide whether a grant can be recorded: on an existing record the consent
 * panel owns that read, so the drawer opts out instead of firing a request it
 * will not use. The key is shared, so both callers read one cache entry.
 */
export function usePrivacyNotice(enabled = true) {
  const { tenant } = useAuth();
  return useQuery({
    queryKey: ["consent", tenant?.id, "notice"],
    queryFn: () => get<PrivacyNotice | null>("/settings/privacy-notice"),
    enabled,
  });
}

export function useConfigurePrivacyNotice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ConfigurePrivacyNoticeInput) =>
      post<PrivacyNotice>("/settings/privacy-notice", input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["consent"] }),
  });
}

export function useCustomerConsent(id: string, page: number) {
  const { tenant } = useAuth();
  return useQuery({
    queryKey: ["consent", tenant?.id, id, page],
    queryFn: () => get<CustomerConsent>(`/customers/${id}/consent`, { page, pageSize: 10 }),
  });
}

export function useRecordCustomerConsent(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordCustomerConsentInput) =>
      post<CustomerConsent>(`/customers/${id}/consent`, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["consent"] }),
  });
}

/**
 * Records consent for a customer that was created in the same interaction.
 *
 * The id arrives with the call rather than at render time: creation happens
 * inside `handleSubmit`, so the drawer cannot pass it to a hook earlier. The
 * endpoint and its guards are the same ones the consent panel uses — a new
 * customer always starts at revision 0.
 */
export function useRecordConsentForNewCustomer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RecordCustomerConsentInput }) =>
      post<CustomerConsent>(`/customers/${id}/consent`, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["consent"] }),
  });
}
