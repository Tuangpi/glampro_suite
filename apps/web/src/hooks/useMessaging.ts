/**
 * Outbound messages — the settings that decide whether a channel may send.
 *
 * Shared between the Settings panel (which writes them) and the receipt's share
 * dialog (which reads them to decide what it may offer), so both read the key
 * `queryKeys.messaging.settings` and a save is visible to an open dialog.
 */
import { useQuery } from "@tanstack/react-query";
import type { MessagingSettingsInput, MessagingCapabilities } from "@glampro_suite/shared";

import { queryKeys } from "@/constants/queryKeys";
import { useAuth } from "@/contexts/AuthContext";
import { get } from "@/lib/api";

/**
 * Which channels are on, and the quiet hours they are on in.
 *
 * Also read by anyone who needs to know whether the salon *could* message — a
 * channel that is off refuses at the server too, so a button that would only
 * learn that from a 409 is a button that should be disabled instead.
 */
export function useMessagingSettings() {
  const { tenant } = useAuth();
  return useQuery({
    queryKey: queryKeys.messaging.settings(tenant?.id),
    queryFn: () => get<MessagingSettingsInput>("/messaging/settings"),
    staleTime: 60_000,
  });
}

/** System readiness is separate from the salon's delivery preferences. */
export function useMessagingCapabilities() {
  const { tenant } = useAuth();
  return useQuery({
    queryKey: ["messaging-capabilities", tenant?.id],
    queryFn: () => get<MessagingCapabilities>("/messaging/capabilities"),
    staleTime: 60_000,
  });
}
