import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { useConsentForms } from "./useTreatments";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({ get }));
beforeEach(() => vi.resetAllMocks());

it("keeps consent type and active filters in separate cache entries", async () => {
  get.mockImplementation((_path, filters) =>
    Promise.resolve([
      {
        id: `${filters.treatmentType}-${filters.isActive}`,
      },
    ]),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => ({
      activeLaser: useConsentForms("laser", true),
      retiredLaser: useConsentForms("laser", false),
      activePeel: useConsentForms("peel", true),
    }),
    { wrapper },
  );
  await waitFor(() => {
    expect(result.current.activeLaser.data).toEqual([{ id: "laser-true" }]);
    expect(result.current.retiredLaser.data).toEqual([{ id: "laser-false" }]);
    expect(result.current.activePeel.data).toEqual([{ id: "peel-true" }]);
  });
  expect(get).toHaveBeenCalledTimes(3);
  client.clear();
});
