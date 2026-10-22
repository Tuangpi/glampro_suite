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
  usePreviewTreatmentDisposal,
  useDisposeTreatment,
} from "./useTreatments";
import { queryKeys } from "@/constants/queryKeys";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({ get, post }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isReadOnly: false }) }));
vi.mock("@/components/ui/toast-store", () => ({ showToast: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it("previews disposal without modifying caches and removes disposed detail/history while refreshing lists", async () => {
  const preview = { previewToken: "signed", treatmentRecordId: "t1" };
  get.mockResolvedValue(preview);
  post.mockResolvedValue({ receiptId: "receipt1" });
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  client.setQueryData(queryKeys.treatments.detail("t1"), { id: "t1", notes: "Private" });
  client.setQueryData([...queryKeys.treatments.detail("t1"), "consent", 1], {
    data: [{ id: "e1" }],
  });
  client.setQueryData(queryKeys.treatments.detail("t2"), { id: "t2" });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => ({ preview: usePreviewTreatmentDisposal(), dispose: useDisposeTreatment() }),
    { wrapper },
  );
  expect(await result.current.preview.mutateAsync("t1")).toEqual(preview);
  expect(get).toHaveBeenCalledWith("/treatments/t1/disposal-preview");
  expect(invalidate).not.toHaveBeenCalled();
  const input = { previewToken: "signed", reason: "Reviewed", confirmation: "DISPOSE" as const };
  await result.current.dispose.mutateAsync({ id: "t1", input });
  expect(post).toHaveBeenCalledWith("/treatments/t1/dispose", input);
  expect(client.getQueryData(queryKeys.treatments.detail("t1"))).toBeUndefined();
  expect(client.getQueryData([...queryKeys.treatments.detail("t1"), "consent", 1])).toBeUndefined();
  expect(client.getQueryData(queryKeys.treatments.detail("t2"))).toEqual({ id: "t2" });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.treatments.all() });
  client.clear();
});

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
  get.mockResolvedValue({ data: [], states: [], total: 0, page: 1, pageSize: 20, pageCount: 0 });
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

it("isolates consent pages and treatment IDs and invalidates all pages after a write", async () => {
  get.mockImplementation((_path, query) =>
    Promise.resolve({
      data: [{ id: `${_path}-${query.page}` }],
      states: [],
      total: 40,
      page: query.page,
      pageSize: query.pageSize,
      pageCount: 2,
    }),
  );
  post.mockResolvedValue({ id: "new" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => ({
      first: useConsentEvents("t1", 1),
      second: useConsentEvents("t1", 2),
      foreign: useConsentEvents("t2", 1),
      record: useRecordConsentEvent(),
    }),
    { wrapper },
  );
  await waitFor(() =>
    expect(
      result.current.first.isSuccess &&
        result.current.second.isSuccess &&
        result.current.foreign.isSuccess,
    ).toBe(true),
  );
  expect(result.current.first.data?.data).not.toEqual(result.current.second.data?.data);
  expect(get).toHaveBeenCalledWith("/treatments/t1/consent", { page: 2, pageSize: 20 });
  await result.current.record.mutateAsync({
    treatmentRecordId: "t1",
    treatmentConsentFormId: "f1",
    customerId: "c1",
    consented: false,
  });
  await waitFor(() => expect(get).toHaveBeenCalledTimes(5));
  client.clear();
});
