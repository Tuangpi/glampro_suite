/**
 * Settings data — handoff screen 11 (`/api/settings`).
 *
 * Two reads and one write. The staff/roles summary is deliberately **not**
 * here: it is `useStaffList` reading the same `GET /api/staff` the staff screen
 * reads, because a second endpoint that summarised the team could disagree with
 * the team page, and one answer per question is the rule (ADR 0010's shape).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ModuleSummary,
  SalonOperatingHours,
  SalonProfile,
  UpdateSalonOperatingHoursInput,
  UpdateSalonProfileInput,
  UpdateSalonSecurityInput,
} from "@glampro_suite/shared";

import { queryKeys } from "@/constants/queryKeys";
import { get, patch } from "@/lib/api";

/** The salon's profile, including saved timezone and formatting locale. */
export function useSalonProfile(tenantId?: string) {
  return useQuery({
    queryKey: queryKeys.settings.general(tenantId),
    queryFn: () => get<SalonProfile>("/settings/profile"),
    staleTime: 60_000,
  });
}

/** The module catalogue joined to this salon's grants, read-only. */
export function useModules() {
  return useQuery({
    queryKey: queryKeys.settings.modules(),
    queryFn: () => get<ModuleSummary[]>("/settings/modules"),
    staleTime: 60_000,
  });
}

/**
 * Saves the salon's editable profile fields.
 *
 * The profile query is invalidated with the auth profile too: the shell's
 * header draws `tenant.name`, so a rename that left the top bar saying the old
 * name would look like it had not saved.
 */
export function useUpdateSalonProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateSalonProfileInput) => patch<SalonProfile>("/settings/profile", input),
    onSuccess: (profile) => {
      void queryClient.setQueryData(queryKeys.settings.general(), profile);
      void queryClient.setQueryData(queryKeys.settings.general(profile.id), profile);
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.profile() });
    },
  });
}

/**
 * Saves the salon's staff sign-in policy.
 *
 * The endpoint answers with the whole profile, so the cached profile is replaced
 * rather than refetched — `useSalonProfile` reads the same key, and the policy
 * card and the account-security card therefore see the new value on the same
 * render. The auth profile is untouched on purpose: the policy says who must
 * present a second factor, not whether this person has enrolled, so nothing in
 * `GET /auth/me` changes.
 */
export function useUpdateSalonSecurityPolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateSalonSecurityInput) =>
      patch<SalonProfile>("/settings/security", input),
    onSuccess: (profile) => {
      void queryClient.setQueryData(queryKeys.settings.general(), profile);
      void queryClient.setQueryData(queryKeys.settings.general(profile.id), profile);
    },
  });
}

/** The salon's published operating hours. */
export function useSalonOperatingHours() {
  return useQuery({
    queryKey: queryKeys.settings.businessHours(),
    queryFn: () => get<SalonOperatingHours>("/settings/hours"),
    staleTime: 60_000,
  });
}

/**
 * Saves the salon's operating hours. Only the days sent are changed; omitted
 * days keep their stored values. Invalidating the hours query after a write
 * keeps the read and the edit in sync.
 */
export function useUpdateSalonOperatingHours() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateSalonOperatingHoursInput) =>
      patch<SalonOperatingHours>("/settings/hours", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.businessHours() });
    },
  });
}
