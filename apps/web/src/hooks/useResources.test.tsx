import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { useResourceServices } from "./useResources";

const { getPaginated } = vi.hoisted(() => ({ getPaginated: vi.fn() }));
vi.mock("@/lib/api", () => ({ getPaginated, get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

it("loads every eligibility page without excluding retired services", async () => {
  getPaginated
    .mockResolvedValueOnce({ data: Array.from({ length: 200 }, (_, id) => ({ id })), total: 201 })
    .mockResolvedValueOnce({ data: [{ id: "retired", status: "INACTIVE" }], total: 201 });
  const { result } = renderHook(() => useResourceServices(), { wrapper: setup() });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.data).toHaveLength(201);
  expect(getPaginated).toHaveBeenLastCalledWith("/services", { page: 2, pageSize: 200 });
});

it.each(["empty", "failed"])(
  "rejects a %s later page instead of exposing partial eligibility",
  async (kind) => {
    getPaginated.mockResolvedValueOnce({ data: [{ id: "first" }], total: 2 });
    if (kind === "empty") getPaginated.mockResolvedValueOnce({ data: [], total: 2 });
    else getPaginated.mockRejectedValueOnce(new Error("Offline"));
    const { result } = renderHook(() => useResourceServices(), { wrapper: setup() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  },
);
