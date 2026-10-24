import { useQuery } from "@tanstack/react-query";
import type { OutletSummary } from "@glampro_suite/shared";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { get } from "@/lib/api";
import { getOutletId } from "@/lib/outlet-storage";
import { createSalonFormatters } from "@/lib/utils";

/** Only calendars use branch time; receipts/reports retain company formatting. */
export function useBookingFormatting() {
  const company = useSalonFormatting();
  const selectedId = getOutletId();
  const outlets = useQuery({
    queryKey: ["outlets"],
    queryFn: () => get<OutletSummary[]>("/outlets"),
    enabled: Boolean(selectedId),
  });
  const outlet = outlets.data?.find((row) => row.id === selectedId);
  const timeZone = outlet?.timeZone ?? company.timeZone;
  const locale = outlet?.locale ?? company.locale;
  return {
    ...createSalonFormatters({ timeZone, locale }),
    timeZone,
    locale,
    outletReady: !selectedId || Boolean(outlet),
    outletError: Boolean(selectedId) && (outlets.isError || (!outlets.isPending && !outlet)),
  };
}
