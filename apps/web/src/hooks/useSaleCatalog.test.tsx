import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { useSaleItems } from "./useSale";
import { useCartServices } from "./useServices";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({
  get,
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  getPaginated: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

it("sends page, category and size, and never displays another page's stale results", async () => {
  get.mockResolvedValueOnce({
    searchableKinds: ["SERVICE"],
    items: [{ id: "first" }],
    hasMore: true,
  });
  const { client, wrapper } = setup();
  const { result, rerender } = renderHook(
    ({ page }) => useSaleItems({ kind: "SERVICE", page, limit: 24 }),
    {
      initialProps: { page: 1 },
      wrapper,
    },
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(get).toHaveBeenCalledWith("/sales/items", {
    kind: "SERVICE",
    page: 1,
    limit: 24,
    search: undefined,
  });
  let resolve!: (value: unknown) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  rerender({ page: 2 });
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith("/sales/items", expect.objectContaining({ page: 2 })),
  );
  expect(result.current.data?.items).toEqual([]);
  expect(result.current.data?.searchableKinds).toEqual(["SERVICE"]);
  expect(result.current.isPlaceholderData).toBe(true);
  resolve({ searchableKinds: ["SERVICE"], items: [{ id: "second" }], hasMore: false });
  await waitFor(() => expect(result.current.data?.hasMore).toBe(false));
  client.clear();
});

it("loads unique cart services by ID beyond the first 200 and retains details when pages change", async () => {
  get.mockImplementation(async (path: string) => ({
    id: path.split("/").pop(),
    departmentId: "hair",
  }));
  const { client, wrapper } = setup();
  const { result, rerender } = renderHook(({ ids }) => useCartServices(ids), {
    initialProps: { ids: ["service-805", "service-805", "restored-service"] },
    wrapper,
  });
  await waitFor(() => expect(result.current.every((query) => query.isSuccess)).toBe(true));
  expect(result.current).toHaveLength(2);
  expect(get).toHaveBeenCalledWith("/services/service-805");
  expect(get).toHaveBeenCalledWith("/services/restored-service");
  expect(get.mock.calls.some(([path]) => path === "/services")).toBe(false);
  rerender({ ids: ["service-805"] });
  expect(result.current[0]?.data?.departmentId).toBe("hair");
  client.clear();
});
