import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  useConsentEvents,
  useConsentForms,
  useCreateConsentForm,
  useRecordConsentEvent,
  useReviewTreatmentRetention,
} from "./useTreatments";
import { queryKeys } from "@/constants/queryKeys";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({ get, post }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isReadOnly: false }) }));
vi.mock("@/components/ui/toast-store", () => ({ showToast: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it("records retention reviews and refreshes treatment detail and list caches", async () => {
  const saved = { id: "t1", retentionHold: true };
  post.mockResolvedValue(saved);
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useReviewTreatmentRetention(), { wrapper });
  const input = {
    reviewAt: "2027-01-22T00:00:00.000Z",
    reason: "Follow-up",
    hold: true,
    holdReason: "Dispute",
  };
  await result.current.mutateAsync({ id: "t1", input });
  expect(post).toHaveBeenCalledWith("/treatments/t1/retention-review", input);
  expect(client.getQueryData(queryKeys.treatments.detail("t1"))).toEqual(saved);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.treatments.all() });
  client.clear();
});

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

it("refreshes evidence history and treatment details after recording a decision", async () => {
  get.mockResolvedValue([]);
  post.mockResolvedValue({ id: "e1" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => ({ history: useConsentEvents("t1"), record: useRecordConsentEvent() }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.history.isSuccess).toBe(true));
  const input = {
    treatmentRecordId: "t1",
    customerId: "c1",
    treatmentConsentFormId: "f1",
    consented: false,
  };
  await result.current.record.mutateAsync(input);
  expect(post).toHaveBeenCalledWith("/treatments/t1/consent", input);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.treatments.detail("t1") });
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  client.clear();
});

it("publishes without a client version and refreshes all form-filter caches", async () => {
  get.mockResolvedValue([]);
  post.mockResolvedValue({ id: "f2", version: 2 });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => ({
      all: useConsentForms("Facial"),
      active: useConsentForms("Facial", true),
      publish: useCreateConsentForm(),
    }),
    { wrapper },
  );
  await waitFor(() =>
    expect(result.current.all.isSuccess && result.current.active.isSuccess).toBe(true),
  );
  const input = { treatmentType: "Facial", title: "Care", content: "Wording", isActive: true };
  await result.current.publish.mutateAsync(input);
  expect(post).toHaveBeenCalledWith("/treatments/consent/forms", input);
  await waitFor(() => expect(get).toHaveBeenCalledTimes(4));
  client.clear();
});
