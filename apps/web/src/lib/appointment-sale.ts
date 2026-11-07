import type { AppointmentDetail, CustomerDetail, ServiceSummary } from "@glampro_suite/shared";
import { addCartLine, type CartLine } from "@/hooks/useSale";
import { get } from "@/lib/api";
import { serviceSaleItem } from "@/lib/customer-holdings";

/** A booking supplies performers, never prices or permission to post earnings. */
export async function loadAppointmentCart(id: string, sellerId: string | undefined) {
  const appointment = await get<AppointmentDetail>(`/appointments/${encodeURIComponent(id)}`);
  if (!["SCHEDULED", "IN_PROGRESS", "COMPLETED"].includes(appointment.status))
    throw new Error("Cancelled or missed appointments cannot be sent to the till.");
  if (!appointment.services.length) throw new Error("This appointment has no available services.");
  const [customer, services] = await Promise.all([
    appointment.customerId
      ? get<CustomerDetail>(`/customers/${encodeURIComponent(appointment.customerId)}`)
      : Promise.resolve(null),
    Promise.all(
      appointment.services.map((line) =>
        get<ServiceSummary>(`/services/${encodeURIComponent(line.serviceId)}`),
      ),
    ),
  ]);
  let lines: CartLine[] = [];
  for (const [index, booked] of appointment.services.entries()) {
    const service = services[index]!;
    if (service.id !== booked.serviceId || service.status !== "ACTIVE")
      throw new Error("A booked service is no longer available. The cart was not changed.");
    // Read lines already resolve booking-level defaults. A null line is unassigned:
    // do not substitute the primary therapist or the till operator.
    const performer = booked.staffId ?? undefined;
    const next = addCartLine(lines, serviceSaleItem(service), performer, false, sellerId);
    lines = next.lines.map((line) => ({
      ...line,
      attribution:
        line.staffId || line.attribution?.sellers
          ? {
              ...line.attribution,
              ...(line.staffId ? { performers: [{ staffId: line.staffId, share: 10000 }] } : {}),
            }
          : undefined,
    }));
  }
  return { customer, lines, outletId: appointment.outletId };
}
