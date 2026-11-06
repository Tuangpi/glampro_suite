/**
 * Settings data — handoff screen 11 (`/api/settings`).
 *
 * Profile, module grants and business hours. The staff roster is deliberately
 * **not** here: it belongs to the Staff screen, and Settings no longer
 * duplicates that list (one question, one answer — ADR 0010's shape).
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
import { del, get, patch, post } from "@/lib/api";

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

/**
 * Uploads the salon's logo and replaces whatever was there.
 *
 * Its own endpoint and its own mutation rather than a field on the profile form:
 * an image travels as multipart, while `PATCH /settings/profile` carries required
 * JSON that a rebrand has no business sending. The response is the whole profile,
 * so the same cache write as a rename keeps the receipt header and the Settings
 * card in step.
 */
export function useUploadSalonLogo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append("logo", file);
      return post<SalonProfile>("/settings/logo", body);
    },
    onSuccess: (profile) => {
      void queryClient.setQueryData(queryKeys.settings.general(), profile);
      void queryClient.setQueryData(queryKeys.settings.general(profile.id), profile);
    },
  });
}

/**
 * Removes the logo, falling back to the initials monogram.
 *
 * Deleting one that is not there succeeds — "no logo from now on" is the state
 * the salon is in either way — so the button does not need to know first.
 */
export function useDeleteSalonLogo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => del<SalonProfile>("/settings/logo"),
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
