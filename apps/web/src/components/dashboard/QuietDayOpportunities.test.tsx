import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import QuietDayOpportunities from "./QuietDayOpportunities";

const { useAuth, useServiceList, get } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useServiceList: vi.fn(),
  get: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth }));
vi.mock("@/hooks/useServices", () => ({ useServiceList }));
vi.mock("@/lib/api", () => ({ get }));
const profile = (role = "MANAGER", codes = ["dashboard", "catalogue", "appointments"]) => ({
  user: { id: "owner", globalRole: role },
  tenant: { id: "salon" },
  entitlements: codes.map((code) => ({ code })),
});
const facts = {
  asOf: "2026-10-24T01:00:00.000Z",
  timeZone: "Asia/Singapore",
  from: "2026-10-24T16:00:00.000Z",
  to: "2026-10-31T16:00:00.000Z",
  serviceId: "service",
  serviceName: "Facial",
  durationMinutes: 60,
  lowBookingThreshold: 3,
  checkedSlots: 2,
  searchLimited: false,
  discountPercentage: 0,
  requiresApproval: true,
  limitations: ["Slots are not reserved.", "No offer is changed or stacked."],
  opportunities: [
    {
      date: "2026-10-25",
      bookingCount: 1,
      startsAt: "2026-10-25T01:00:00.000Z",
      endsAt: "2026-10-25T02:00:00.000Z",
      staffId: "staff",
      action: "Review this opening before offering a regular-price appointment.",
    },
  ],
};
const servicePage = () => ({
  data: { data: [{ id: "service", name: "Facial" }], total: 26 },
  isFetching: false,
  isError: false,
  refetch: vi.fn(),
});
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <QuietDayOpportunities />
    </QueryClientProvider>,
  );
}
function selectService() {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "service" } });
}
beforeEach(() => {
  vi.resetAllMocks();
  useAuth.mockReturnValue(profile());
  useServiceList.mockReturnValue(servicePage());
  get.mockResolvedValue(facts);
});

it.each(["SUPER_ADMIN", "MANAGER"])(
  "lets %s explicitly check regular-price openings with evidence",
  async (role) => {
    useAuth.mockReturnValue(profile(role));
    mount();
    expect(get).not.toHaveBeenCalled();
    selectService();
    await screen.findByText(/Facial · 60 minutes/);
    expect(get).toHaveBeenCalledWith("/ai-assistant/quiet-day-opportunities", {
      serviceId: "service",
    });
    expect(screen.getByText(/Slots are not reserved/)).toBeInTheDocument();
    expect(screen.getByText(/1 non-cancelled booking starts/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /send|approve|publish|activate/i }),
    ).not.toBeInTheDocument();
  },
);
it.each(["STAFF", "CASHIER"])("does not mount requests for %s", (role) => {
  useAuth.mockReturnValue(profile(role));
  mount();
  expect(useServiceList).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
});
it("requires all modules", () => {
  useAuth.mockReturnValue(profile("MANAGER", ["dashboard"]));
  mount();
  expect(useServiceList).not.toHaveBeenCalled();
});
it("hides cached suggestions on refusal and retries into a qualified empty state", async () => {
  get
    .mockResolvedValueOnce(facts)
    .mockRejectedValueOnce({ response: { status: 403 } })
    .mockResolvedValueOnce({ ...facts, opportunities: [], searchLimited: true });
  mount();
  selectService();
  await screen.findByText(/Facial · 60 minutes/);
  fireEvent.click(screen.getByRole("button", { name: "Refresh opening checks" }));
  await screen.findByText(/Opening checks unavailable/);
  expect(screen.queryByText(/Facial · 60 minutes/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh opening checks" }));
  await screen.findByText(/No verified openings/);
  expect(screen.getByText(/results are partial/)).toBeInTheDocument();
});
it("rejects discounted/malformed facts", async () => {
  get.mockResolvedValue({ ...facts, discountPercentage: 15 });
  mount();
  selectService();
  await screen.findByText(/Opening checks unavailable/);
});
it("clears selected facts when paging through services", async () => {
  mount();
  selectService();
  await screen.findByText(/Facial · 60 minutes/);
  fireEvent.click(screen.getByRole("button", { name: "Next services" }));
  expect(screen.queryByText(/Facial · 60 minutes/)).not.toBeInTheDocument();
  expect(useServiceList).toHaveBeenLastCalledWith({ page: 2, pageSize: 25, status: "ACTIVE" });
});
it("supports service-list retry independently", () => {
  const refetch = vi.fn();
  useServiceList.mockReturnValue({ ...servicePage(), isError: true, refetch });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Retry services" }));
  expect(refetch).toHaveBeenCalledOnce();
  expect(get).not.toHaveBeenCalled();
});
it("removes results on role loss", async () => {
  const view = mount();
  selectService();
  await screen.findByText(/Facial · 60 minutes/);
  useAuth.mockReturnValue(profile("STAFF"));
  view.rerender(<QuietDayOpportunities />);
  expect(screen.queryByText(/Facial · 60 minutes/)).not.toBeInTheDocument();
});
