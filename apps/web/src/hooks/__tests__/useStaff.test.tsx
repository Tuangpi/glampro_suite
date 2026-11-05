/**
 * `useStaff` — the detail query that must not blank the page it is opening.
 *
 * The bug this covers: clicking a name in the staff list navigated to `/staff/:id`,
 * where the page threw away everything it knew and showed one line of text until a
 * second request answered — for a record the list had already given it. The list row
 * and the detail record are the same schema, so the row is a valid first frame, and
 * `placeholderData` is what makes the query hand it over.
 *
 * The two cases that matter are therefore "arrived from the list" (a cached row exists
 * and the page paints immediately) and "arrived cold" (a bookmark, a refresh, a link in
 * a new tab — nothing cached, and the skeleton is the honest answer).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StaffSummary } from "@glampro_suite/shared";

import { queryKeys } from "@/constants/queryKeys";

const { get, getPaginated } = vi.hoisted(() => ({
  get: vi.fn(),
  getPaginated: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ get, getPaginated, patch: vi.fn(), post: vi.fn() }));

const { useStaff } = await import("@/hooks/useStaff");

/** A row that satisfies `StaffSummary`, optional fields left null. */
function staffRow(overrides: Partial<StaffSummary> = {}): StaffSummary {
  return {
    id: "u1",
    name: "Amara Okafor",
    email: "amara@salon.test",
    globalRole: "STAFF",
    phone: "555-0100",
    position: "Senior stylist",
    color: "#8B5CF6",
    avatar: null,
    commissionRate: "10.00",
    startDate: "2021-03-04",
    endDate: null,
    disabled: false,
    lastLoginAt: "2026-04-02T09:15:00.000Z",
    departments: [{ id: "d1", name: "Hair" }],
    createdAt: "2021-03-04T00:00:00.000Z",
    updatedAt: "2021-03-04T00:00:00.000Z",
    ...overrides,
  } as StaffSummary;
}

function client(): QueryClient {
  // No retries: an unanswered request is the point of the first test, not a failure.
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  get.mockReset();
  getPaginated.mockReset();
});

describe("useStaff", () => {
  it("paints the row the list already holds while the detail request is in flight", async () => {
    const queryClient = client();
    // The list page, filed under the key `useStaffList` uses: the base tuple plus the
    // filter object the page passed.
    queryClient.setQueryData([...queryKeys.staff.list(), { page: 1, pageSize: 20 }], {
      data: [staffRow()],
      total: 1,
      page: 1,
      pageSize: 20,
      pageCount: 1,
    });
    // A request that never answers: whatever the hook returns came from the cache.
    get.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useStaff("u1"), {
      wrapper: wrapperFor(queryClient),
    });

    expect(result.current.isPending).toBe(false);
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.name).toBe("Amara Okafor");
    expect(result.current.data?.departments).toEqual([{ id: "d1", name: "Hair" }]);
  });

  it("finds the row under a filtered list key, not only an unfiltered one", async () => {
    const queryClient = client();
    // A reader who searched first: the filters are the last element of the key, and the
    // hook cannot rebuild this object, so it matches on the prefix instead.
    queryClient.setQueryData(
      [...queryKeys.staff.list(), { page: 1, pageSize: 20, search: "amara" }],
      {
        data: [staffRow()],
        total: 1,
        page: 1,
        pageSize: 20,
        pageCount: 1,
      },
    );
    get.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useStaff("u1"), {
      wrapper: wrapperFor(queryClient),
    });

    expect(result.current.data?.name).toBe("Amara Okafor");
  });

  it("has nothing to show on a cold arrival, and fetches the record", async () => {
    const queryClient = client();
    get.mockResolvedValue(staffRow({ position: "Colourist" }));

    const { result } = renderHook(() => useStaff("u1"), {
      wrapper: wrapperFor(queryClient),
    });

    // No cached list, so the page draws its skeleton — the state the loading screen on
    // `/staff/:id` is for.
    expect(result.current.isPending).toBe(true);
    expect(result.current.data).toBeUndefined();

    await waitFor(() => expect(result.current.data?.position).toBe("Colourist"));
    expect(get).toHaveBeenCalledWith("/staff/u1");
  });

  it("does not ask for a record when the route has no id", () => {
    const queryClient = client();

    const { result } = renderHook(() => useStaff(null), {
      wrapper: wrapperFor(queryClient),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(get).not.toHaveBeenCalled();
  });
});
