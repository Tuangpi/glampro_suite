import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/constants/queryKeys";
import {
  loadCalendarPages,
  useCalendarAppointments,
  useRescheduleAppointment,
} from "./useAppointments";

const { getPaginated, patch } = vi.hoisted(() => ({ getPaginated: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/api", () => ({ getPaginated, patch, get: vi.fn(), post: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

describe("calendar data", () => {
  it("loads every page, including more than 200 bookings or staff", async () => {
    getPaginated
      .mockResolvedValueOnce({ data: Array.from({ length: 200 }, (_, id) => ({ id })), total: 401 })
      .mockResolvedValueOnce({
        data: Array.from({ length: 200 }, (_, id) => ({ id: id + 200 })),
        total: 401,
      })
      .mockResolvedValueOnce({ data: [{ id: 400 }], total: 401 });
    const result = await loadCalendarPages("/appointments", { overlap: "true" });
    expect(result.data).toHaveLength(401);
    expect(getPaginated).toHaveBeenLastCalledWith("/appointments", {
      overlap: "true",
      page: 3,
      pageSize: 200,
    });
  });

  it("rejects failed or incomplete later pages rather than showing a partial book", async () => {
    getPaginated
      .mockResolvedValueOnce({ data: [{ id: 1 }], total: 2 })
      .mockResolvedValueOnce({ data: [], total: 2 });
    await expect(loadCalendarPages("/staff", { status: "active" })).rejects.toThrow(
      /changed while loading/,
    );
    getPaginated
      .mockResolvedValueOnce({ data: [{ id: 1 }], total: 2 })
      .mockRejectedValueOnce(new Error("Offline"));
    await expect(loadCalendarPages("/appointments", {})).rejects.toThrow("Offline");
  });

  it("does not display the previous window while the next one is loading", async () => {
    getPaginated
      .mockResolvedValueOnce({ data: [{ id: 1 }], total: 1 })
      .mockImplementation(() => new Promise(() => {}));
    const { wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ from }) => useCalendarAppointments({ from, to: "end" }),
      { initialProps: { from: "first" }, wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender({ from: "second" });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);
  });

  it("moves optimistic start and end together and rolls back a rejected move", async () => {
    const { client, wrapper } = setup();
    const key = queryKeys.appointments.calendar("from", "to");
    const page = {
      data: [
        {
          id: "a",
          startsAt: "2026-10-09T01:00:00.000Z",
          endsAt: "2026-10-09T02:00:00.000Z",
          staffId: "staff-a",
        },
      ],
      total: 1,
    };
    client.setQueryData(key, page);
    let reject!: (error: Error) => void;
    patch.mockImplementation(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    const { result } = renderHook(() => useRescheduleAppointment(), { wrapper });
    act(() =>
      result.current.mutate({
        id: "a",
        input: { startsAt: "2026-10-10T03:00:00.000Z", staffId: null },
      }),
    );
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(client.getQueryData<typeof page>(key)?.data[0]).toMatchObject({
      startsAt: "2026-10-10T03:00:00.000Z",
      endsAt: "2026-10-10T04:00:00.000Z",
      staffId: null,
    });
    await act(async () => reject(new Error("Clash")));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(key)).toEqual(page);
  });
});
