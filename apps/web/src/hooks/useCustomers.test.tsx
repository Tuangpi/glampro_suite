import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { useArchiveCustomer, useCustomerList } from "./useCustomers";
import { queryKeys } from "@/constants/queryKeys";

const mocks = vi.hoisted(() => ({ post: vi.fn(), getPaginated: vi.fn() }));
vi.mock("@/lib/api", () => ({ post: mocks.post, getPaginated: mocks.getPaginated }));
beforeEach(() => vi.resetAllMocks());
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

it("separates archived inclusion in the query cache and sends the explicit API filter", async () => {
  mocks.getPaginated.mockResolvedValue({ data: [], pageCount: 0 });
  const { client, wrapper } = setup();
  const { result } = renderHook(
    () => ({
      active: useCustomerList({ page: 1, pageSize: 20 }),
      all: useCustomerList({ page: 1, pageSize: 20, includeArchived: true }),
    }),
    { wrapper },
  );
  await waitFor(() =>
    expect(result.current.active.isSuccess && result.current.all.isSuccess).toBe(true),
  );
  expect(mocks.getPaginated).toHaveBeenCalledWith("/customers", {
    page: 1,
    pageSize: 20,
    search: undefined,
    includeArchived: undefined,
  });
  expect(mocks.getPaginated).toHaveBeenCalledWith("/customers", {
    page: 1,
    pageSize: 20,
    search: undefined,
    includeArchived: "true",
  });
  client.clear();
});

it("archives the selected customer and refreshes all customer lists and detail", async () => {
  const saved = { id: "c1", archivedAt: "2026-10-22T01:00:00Z" };
  mocks.post.mockResolvedValue(saved);
  const { client, wrapper } = setup();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { result } = renderHook(() => useArchiveCustomer(), { wrapper });
  await result.current.mutateAsync({ id: "c1", input: { reason: "No further visits" } });
  expect(mocks.post).toHaveBeenCalledWith("/customers/c1/archive", { reason: "No further visits" });
  expect(client.getQueryData(queryKeys.customers.detail("c1"))).toEqual(saved);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.customers.list() });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.customers.detail("c1") });
  client.clear();
});

it("does not change cached customer evidence on archive refusal", async () => {
  mocks.post.mockRejectedValue(new Error("Refused"));
  const { client, wrapper } = setup();
  client.setQueryData(queryKeys.customers.detail("c1"), { id: "c1", archivedAt: null });
  const { result } = renderHook(() => useArchiveCustomer(), { wrapper });
  await expect(
    result.current.mutateAsync({ id: "c1", input: { reason: "Review" } }),
  ).rejects.toThrow("Refused");
  expect(client.getQueryData(queryKeys.customers.detail("c1"))).toEqual({
    id: "c1",
    archivedAt: null,
  });
  client.clear();
});
