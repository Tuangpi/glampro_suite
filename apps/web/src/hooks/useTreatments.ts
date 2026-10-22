/**
 * Treatment records, before/after photos and treatment consent.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateTreatmentConsentEventInput,
  CreateTreatmentConsentFormInput,
  CreateTreatmentPhotoInput,
  CreateTreatmentRecordInput,
  TreatmentConsentEvent,
  TreatmentConsentForm,
  TreatmentPhoto,
  TreatmentRecord,
  TreatmentRecordListQuery,
} from "@glampro_suite/shared";

import { queryKeys } from "@/constants/queryKeys";
import { del, get, getErrorMessage, getPaginated, patch, post } from "@/lib/api";
import { showToast } from "@/components/ui/toast-store";
import { useAuth } from "@/contexts/AuthContext";

const PAGE_SIZE = 20;

export function useTreatmentList(filters: TreatmentRecordListQuery & { page: number; pageSize: number }) {
  return useQuery({
    queryKey: [...queryKeys.treatments.list(), filters],
    queryFn: () =>
      getPaginated<TreatmentRecord>("/treatments", {
        page: filters.page,
        pageSize: filters.pageSize,
        customerId: filters.customerId || undefined,
        treatmentType: filters.treatmentType || undefined,
        status: filters.status || undefined,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useTreatment(id: string | null) {
  return useQuery({
    queryKey: queryKeys.treatments.detail(id ?? ""),
    queryFn: () => get<TreatmentRecord>(`/treatments/${id}`),
    enabled: id !== null,
  });
}

export function useCreateTreatment() {
  const queryClient = useQueryClient();
  const { isReadOnly } = useAuth();

  return useMutation({
    mutationFn: (input: CreateTreatmentRecordInput) =>
      post<TreatmentRecord>("/treatments", input),
    onMutate: () => {
      if (isReadOnly) showToast("error", "This salon is suspended — changes are disabled.");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.treatments.all() });
      showToast("success", "Treatment record created.");
    },
    onError: (error) => {
      showToast("error", getErrorMessage(error));
    },
  });
}

export function useUpdateTreatment() {
  const queryClient = useQueryClient();
  const { isReadOnly } = useAuth();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<CreateTreatmentRecordInput> }) =>
      patch<TreatmentRecord>(`/treatments/${id}`, input),
    onMutate: () => {
      if (isReadOnly) showToast("error", "This salon is suspended — changes are disabled.");
    },
    onSuccess: (_record, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.treatments.all() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.treatments.detail(variables.id),
      });
      showToast("success", "Treatment record updated.");
    },
    onError: (error) => {
      showToast("error", getErrorMessage(error));
    },
  });
}

export function useDeleteTreatment() {
  const queryClient = useQueryClient();
  const { isReadOnly } = useAuth();

  return useMutation({
    mutationFn: (id: string) => del<void>(`/treatments/${id}`),
    onMutate: () => {
      if (isReadOnly) showToast("error", "This salon is suspended — changes are disabled.");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.treatments.all() });
      showToast("success", "Treatment record deleted.");
    },
    onError: (error) => {
      showToast("error", getErrorMessage(error));
    },
  });
}

export function useAddTreatmentPhoto() {
  const queryClient = useQueryClient();
  const { isReadOnly } = useAuth();

  return useMutation({
    mutationFn: (input: CreateTreatmentPhotoInput) =>
      post<TreatmentPhoto>(`/treatments/${input.treatmentRecordId}/photos`, input),
    onMutate: () => {
      if (isReadOnly) showToast("error", "This salon is suspended — changes are disabled.");
    },
    onSuccess: (_photo, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.treatments.detail(variables.treatmentRecordId),
      });
      showToast("success", "Photo tagged.");
    },
    onError: (error) => {
      showToast("error", getErrorMessage(error));
    },
  });
}

export function useRemoveTreatmentPhoto() {
  const queryClient = useQueryClient();
  const { isReadOnly } = useAuth();

  return useMutation({
    mutationFn: ({ recordId, photoId }: { recordId: string; photoId: string }) =>
      del<void>(`/treatments/${recordId}/photos/${photoId}`),
    onMutate: () => {
      if (isReadOnly) showToast("error", "This salon is suspended — changes are disabled.");
    },
    onSuccess: (_photo, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.treatments.detail(variables.recordId),
      });
      showToast("success", "Photo untagged.");
    },
    onError: (error) => {
      showToast("error", getErrorMessage(error));
    },
  });
}

export function useCustomerPhotos(customerId: string | null, page: number) {
  return useQuery({
    queryKey: [...queryKeys.customers.detail(customerId ?? ""), "photos", page],
    queryFn: () =>
      getPaginated<{ id: string; caption: string | null; createdAt: string }>(
        `/customers/${customerId}/photos`,
        { page, pageSize: PAGE_SIZE },
      ),
    enabled: customerId !== null,
  });
}

export function useConsentForms(treatmentType?: string, isActive?: boolean) {
  return useQuery({
    queryKey: queryKeys.treatments.all(),
    queryFn: () =>
      get<TreatmentConsentForm[]>("/treatments/consent/forms", {
        treatmentType,
        isActive: isActive === undefined ? undefined : isActive ? "true" : "false",
      }),
  });
}

export function useRecordConsentEvent() {
  const queryClient = useQueryClient();
  const { isReadOnly } = useAuth();

  return useMutation({
    mutationFn: (input: CreateTreatmentConsentEventInput) =>
      post<TreatmentConsentEvent>(`/treatments/${input.treatmentRecordId}/consent`, input),
    onMutate: () => {
      if (isReadOnly) showToast("error", "This salon is suspended — changes are disabled.");
    },
    onSuccess: (_event, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.treatments.detail(variables.treatmentRecordId),
      });
      showToast("success", "Consent recorded.");
    },
    onError: (error) => {
      showToast("error", getErrorMessage(error));
    },
  });
}

export function useConsentEvents(treatmentRecordId: string | null) {
  return useQuery({
    queryKey: [...queryKeys.treatments.detail(treatmentRecordId ?? ""), "consent"],
    queryFn: () => get<TreatmentConsentEvent[]>(`/treatments/${treatmentRecordId}/consent`),
    enabled: treatmentRecordId !== null,
  });
}

export function useCreateConsentForm() {
  const queryClient = useQueryClient();
  const { isReadOnly } = useAuth();

  return useMutation({
    mutationFn: (input: CreateTreatmentConsentFormInput) =>
      post<TreatmentConsentForm>("/treatments/consent/forms", input),
    onMutate: () => {
      if (isReadOnly) showToast("error", "This salon is suspended — changes are disabled.");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.treatments.all() });
      showToast("success", "Consent form created.");
    },
    onError: (error) => {
      showToast("error", getErrorMessage(error));
    },
  });
}