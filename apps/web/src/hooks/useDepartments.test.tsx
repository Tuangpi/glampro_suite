import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { queryKeys } from "@/constants/queryKeys";
import {
  useDepartments,
  useSaveDepartment,
  useDeleteDepartment,
  useDepartmentDeletionImpact,
} from "./useDepartments";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/api", () => api);
beforeEach(() => vi.resetAllMocks());

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

it("shares the picker list and supports disabling the management read", async () => {
  api.get.mockResolvedValue([{ id: "hair", name: "Hair" }]);
  const { client, wrapper } = setup();
  const { result, rerender } = renderHook(({ enabled }) => useDepartments(enabled), {
    wrapper,
    initialProps: { enabled: false },
  });
  expect(api.get).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(api.get).toHaveBeenCalledWith("/departments");
  expect(client.getQueryData(queryKeys.departments.list())).toEqual([{ id: "hair", name: "Hair" }]);
  client.clear();
});

it("creates and renames using the matching endpoint and refreshes affected labels", async () => {
  api.post.mockResolvedValue({ id: "hair", name: "Hair" });
  api.patch.mockResolvedValue({ id: "hair", name: "Beauty" });
  const { client, wrapper } = setup();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { result } = renderHook(() => useSaveDepartment(), { wrapper });
  await result.current.mutateAsync({ input: { name: "Hair" } });
  expect(api.post).toHaveBeenCalledWith("/departments", { name: "Hair" });
  await result.current.mutateAsync({ id: "hair", input: { name: "Beauty" } });
  expect(api.patch).toHaveBeenCalledWith("/departments/hair", { name: "Beauty" });
  for (const queryKey of [
    ["departments"],
    ["products"],
    ["services"],
    ["staff"],
    queryKeys.customers.all(),
  ]) {
    expect(invalidate).toHaveBeenCalledWith({ queryKey });
  }
  client.clear();
});

it("fetches fresh deletion impact and invalidates dependent records after deletion", async () => {
  api.get.mockResolvedValue({ id: "hair", commissionRules: 0 });
  api.del.mockResolvedValue({ id: "hair" });
  const { client, wrapper } = setup();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { result } = renderHook(
    () => ({ impact: useDepartmentDeletionImpact("hair"), remove: useDeleteDepartment() }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.impact.isSuccess).toBe(true));
  expect(api.get).toHaveBeenCalledWith("/departments/hair/deletion-impact");
  await result.current.remove.mutateAsync("hair");
  expect(api.del).toHaveBeenCalledWith("/departments/hair");
  for (const queryKey of [
    ["departments"],
    ["staff"],
    ["products"],
    ["services"],
    queryKeys.appointments.all(),
    queryKeys.sale.items(),
  ]) {
    expect(invalidate).toHaveBeenCalledWith({ queryKey });
  }
  client.clear();
});

it("does not invalidate cached data after a refused write", async () => {
  api.post.mockRejectedValue(new Error("Duplicate"));
  const { client, wrapper } = setup();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { result } = renderHook(() => useSaveDepartment(), { wrapper });
  await expect(result.current.mutateAsync({ input: { name: "Hair" } })).rejects.toThrow(
    "Duplicate",
  );
  expect(invalidate).not.toHaveBeenCalled();
  client.clear();
});
