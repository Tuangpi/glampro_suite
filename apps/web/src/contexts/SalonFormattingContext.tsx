import { createContext, useContext, useMemo } from "react";

import { useAuth } from "@/contexts/AuthContext";
import PageLoading from "@/components/ui/PageLoading";
import { useSalonProfile } from "@/hooks/useSettings";
import { createSalonFormatters, DEFAULT_SALON_FORMATTING } from "@/lib/utils";

/**
 * The context value: bound formatters plus the salon's saved preferences, so
 * calendar, report and dashboard code can read the timezone without reaching for
 * a second context. Defaults are the standalone fallback, used by public routes
 * and by tests that render outside the provider.
 *
 * The salon's name and logo ride along for the same reason the timezone does:
 * a receipt header draws all three, and a second fetch of `GET /settings/profile`
 * on the till screen would be a second answer to one question.
 */
const DEFAULT_FORMATTING_VALUE = {
  ...createSalonFormatters(DEFAULT_SALON_FORMATTING),
  timeZone: DEFAULT_SALON_FORMATTING.timeZone,
  locale: DEFAULT_SALON_FORMATTING.locale,
  /** Empty outside the provider, which draws no salon block rather than a wrong one. */
  salonName: "",
  salonLogoUrl: null as string | null,
};

const SalonFormattingContext = createContext<
  ReturnType<typeof createSalonFormatters> & {
    timeZone: string;
    locale: string;
    salonName: string;
    salonLogoUrl: string | null;
  }
>(DEFAULT_FORMATTING_VALUE);

/** Public routes never fetch salon settings. A tenant change remounts the boundary. */
export function SalonFormattingProvider({ children }: { children: React.ReactNode }) {
  const { status, tenant } = useAuth();
  return status === "authenticated" && tenant ? (
    <AuthenticatedFormatting key={tenant.id} tenantId={tenant.id}>
      {children}
    </AuthenticatedFormatting>
  ) : (
    children
  );
}

function AuthenticatedFormatting({
  tenantId,
  children,
}: {
  tenantId: string;
  children: React.ReactNode;
}) {
  const profile = useSalonProfile(tenantId);
  const locale = profile.data?.locale ?? DEFAULT_SALON_FORMATTING.locale;
  const timeZone = profile.data?.timeZone ?? DEFAULT_SALON_FORMATTING.timeZone;
  const salonName = profile.data?.name ?? "";
  const salonLogoUrl = profile.data?.logoUrl ?? null;
  const formatters = useMemo(() => createSalonFormatters({ locale, timeZone }), [locale, timeZone]);
  const value = useMemo(
    () => ({ ...formatters, timeZone, locale, salonName, salonLogoUrl }),
    [formatters, timeZone, locale, salonName, salonLogoUrl],
  );

  if (!profile.data && profile.isPending) return <PageLoading label="Loading salon preferences…" />;
  if (!profile.data || profile.data.id !== tenantId) {
    return (
      <div role="alert">
        <p>Salon preferences could not be loaded.</p>
        <button type="button" onClick={() => void profile.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <SalonFormattingContext.Provider value={value}>{children}</SalonFormattingContext.Provider>
  );
}

export function useSalonFormatting() {
  return useContext(SalonFormattingContext);
}
