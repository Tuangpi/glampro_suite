import { beforeEach, expect, it, vi } from "vitest";
import { loadAppointmentCart } from "@/lib/appointment-sale";
import { cartLinesFrom, toSaleLineInputs, lineUnitPrice } from "@/hooks/useSale";
import type { SaleDetail, ServiceSummary } from "@glampro_suite/shared";
import { readSaleDraft, setSaleDraftLines } from "@/lib/sale-draft-storage";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({ get }));
const services = [
  { id: "cut", name: "Cut", nonmemberPrice: "80.00", memberPrice: "70.00", status: "ACTIVE" },
  { id: "nails", name: "Nails", nonmemberPrice: "40.00", memberPrice: "35.00", status: "ACTIVE" },
] as ServiceSummary[];
const booking = {
  status: "COMPLETED",
  customerId: "customer",
  outletId: "outlet",
  staffId: "primary",
  services: [
    { serviceId: "cut", staffId: "therapist-a" },
    { serviceId: "nails", staffId: "therapist-b" },
  ],
};
beforeEach(() => {
  get.mockReset().mockImplementation(async (url: string) => {
    if (url.startsWith("/appointments/")) return booking;
    if (url === "/customers/customer") return { id: "customer", memberId: "member" };
    return services.find((row) => url === `/services/${row.id}`);
  });
});
it("loads current prices with distinct booked performers, not the cashier or primary therapist", async () => {
  const draft = await loadAppointmentCart("booking /1", "cashier");
  expect(get).toHaveBeenCalledWith("/appointments/booking%20%2F1");
  expect(draft.lines.map((row) => [row.itemId, row.staffId, row.price])).toEqual([
    ["cut", "therapist-a", "80.00"],
    ["nails", "therapist-b", "40.00"],
  ]);
  expect(lineUnitPrice(draft.lines[0]!, true)).toBe("70.00");
  expect(lineUnitPrice(draft.lines[0]!, false)).toBe("80.00");
  expect(toSaleLineInputs(draft.lines)[0]).toEqual({
    itemType: "SERVICE",
    itemId: "cut",
    quantity: 1,
    staffId: "therapist-a",
    attribution: {
      sellers: [{ staffId: "cashier", share: 10000 }],
      performers: [{ staffId: "therapist-a", share: 10000 }],
    },
  });
});
it("keeps unassigned services unknown and repeated booked services as exact quantities", async () => {
  get.mockImplementationOnce(async () => ({
    ...booking,
    customerId: null,
    services: [
      { serviceId: "cut", staffId: null },
      { serviceId: "cut", staffId: null },
    ],
  }));
  const { lines, customer } = await loadAppointmentCart("booking", "cashier");
  expect(customer).toBeNull();
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ quantity: 2, price: "80.00" });
  expect(lines[0]?.staffId).toBeUndefined();
  expect(lines[0]?.attribution?.performers).toBeUndefined();
});
it.each(["CANCELLED", "NO_SHOW"])(
  "refuses %s bookings before reading customers or prices",
  async (status) => {
    get.mockResolvedValueOnce({ ...booking, status });
    await expect(loadAppointmentCart("booking", "cashier")).rejects.toThrow("cannot be sent");
    expect(get).toHaveBeenCalledTimes(1);
  },
);
it("refuses unavailable services and propagates failed authoritative reads", async () => {
  get.mockImplementation(async (url: string) =>
    url.startsWith("/appointments/")
      ? booking
      : url.startsWith("/customers/")
        ? null
        : { ...services[0], status: "INACTIVE" },
  );
  await expect(loadAppointmentCart("booking", "cashier")).rejects.toThrow("no longer available");
  get.mockRejectedValueOnce(new Error("Access denied"));
  await expect(loadAppointmentCart("booking", "cashier")).rejects.toThrow("Access denied");
});
it("preserves edited splits through local reload and server hold rehydration at current prices", async () => {
  const draft = await loadAppointmentCart("booking", "cashier");
  const attribution = {
    sellers: [{ staffId: "seller", share: 10000 }],
    performers: [
      { staffId: "therapist-a", share: 2500 },
      { staffId: "therapist-b", share: 7500 },
    ],
  };
  const edited = [{ ...draft.lines[0]!, staffId: undefined, attribution, discountPercent: 10 }];
  setSaleDraftLines("appointment:cashier", edited);
  expect(readSaleDraft("appointment:cashier").lines).toEqual(edited);
  const held = {
    status: "HELD",
    lines: edited.map((line) => ({ ...line, discountPercent: "10" })),
  } as unknown as SaleDetail;
  const resumed = cartLinesFrom(held, [
    { ...services[0]!, kind: "SERVICE", price: "99.00", memberPrice: "90.00" },
  ]);
  expect(resumed[0]).toMatchObject({ attribution, discountPercent: 10, price: "99.00" });
  expect(toSaleLineInputs(resumed)[0]?.attribution).toEqual(attribution);
});
