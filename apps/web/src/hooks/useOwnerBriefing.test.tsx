import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { useOwnerBriefing } from "./useOwnerBriefing";
import { queryKeys } from "@/constants/queryKeys";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({ get }));
beforeEach(() => vi.resetAllMocks());
const facts = {
  incomeToday: "0.00",
  completedSalePaid: "0.00",
  refundsToday: "0.00",
  netPaid: "0.00",
  salesToday: 0,
  averageTicket: "0.00",
  appointmentsToday: 0,
  newCustomersToday: 0,
  lowStockCount: 0,
  lowStockThreshold: 5,
  timeZone: "Asia/Singapore",
  from: "2026-10-23T16:00:00.000Z",
  to: "2026-10-24T16:00:00.000Z",
  asOf: "2026-10-23T17:00:00.000Z",
};
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
it("validates the read-only endpoint response and scopes cache by tenant and user", async () => {
  get.mockResolvedValue(facts);
  const { wrapper, client } = setup();
  const { result, rerender } = renderHook(({ tenantId }) => useOwnerBriefing(tenantId, "owner"), {
    wrapper,
    initialProps: { tenantId: "a" },
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(get).toHaveBeenCalledWith("/ai-assistant/owner-summary");
  expect(client.getQueryData(queryKeys.ownerAssistant.summary("a", "owner"))).toEqual(facts);
  rerender({ tenantId: "b" });
  await waitFor(() =>
    expect(client.getQueryData(queryKeys.ownerAssistant.summary("b", "owner"))).toEqual(facts),
  );
  expect(client.getQueryData(queryKeys.ownerAssistant.summary("b", "other"))).toBeUndefined();
});
it("rejects malformed facts instead of rendering invented defaults", async () => {
  get.mockResolvedValue({ ...facts, netPaid: "not-money" });
  const { result } = renderHook(() => useOwnerBriefing("a", "owner"), { wrapper: setup().wrapper });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.data).toBeUndefined();
  expect(get).toHaveBeenCalledOnce();
});
