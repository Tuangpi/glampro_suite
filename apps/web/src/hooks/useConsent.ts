import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ConfigurePrivacyNoticeInput,
  CustomerConsent,
  PrivacyNotice,
  RecordCustomerConsentInput,
} from "@glampro_suite/shared";
import { useAuth } from "@/contexts/AuthContext";
import { get, post } from "@/lib/api";

export function usePrivacyNotice() {
  const { tenant } = useAuth();
  return useQuery({
    queryKey: ["consent", tenant?.id, "notice"],
    queryFn: () => get<PrivacyNotice | null>("/settings/privacy-notice"),
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
