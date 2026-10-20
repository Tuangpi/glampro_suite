/**
 * Appointment data — handoff screens 03 and 06 (`/api/appointments`).
 *
 * No new contract: the list query, the detail, the write and its PATCH all
 * come from `@glampro_suite/shared`, so everything below is shaped by what
 * `schemas/appointment.ts` already says.
 *
 * The day view passes its window as instants (see `todayWindow` in
 * `useDashboard.ts` — the same edges the tiles count, so the list and the
 * "N appointments today" tile can never disagree about where the day ends).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AppointmentDetail,
  AppointmentListQuery,
  AppointmentSummary,
  StaffSummary,
  CreateAppointmentInput,
  PaginatedResponse,
  UpdateAppointmentInput,
} from "@glampro_suite/shared";

import type { RescheduleInput } from "@/components/appointments/CalendarView";
import { queryKeys } from "@/constants/queryKeys";
import { get, getPaginated, patch, post } from "@/lib/api";

/** Per-request ceiling. Calendar and roster loaders consume every page. */
export const CALENDAR_PAGE_SIZE = 200;

export interface AppointmentListFilters {
  page: number;
  pageSize: number;
  /** Day edges as instants. Omitted = the whole book. */
  from?: string;
  to?: string;
  status?: AppointmentListQuery["status"];
  search?: string;
}

/**
 * One page of bookings in a window.
 *
 * The filters object is the last element of the key, so `invalidateQueries` on
 * `queryKeys.appointments.list()` matches every window and every search — a
 * booking created for tomorrow must refresh the list the user is looking at
 * even when they had filtered to today.
 */
export function useAppointmentList(filters: AppointmentListFilters) {
  return useQuery({
    queryKey: [...queryKeys.appointments.list(), filters],
    queryFn: () =>
      getPaginated<AppointmentSummary>("/appointments", {
        page: filters.page,
        pageSize: filters.pageSize,
        from: filters.from,
        to: filters.to,
        status: filters.status,
        search: filters.search || undefined,
      }),
    placeholderData: (previous) => previous,
  });
}

/** One booking, for the editor's second read. */
export function useAppointment(id: string | null) {
  return useQuery({
    queryKey: queryKeys.appointments.detail(id ?? ""),
    queryFn: () => get<AppointmentDetail>(`/appointments/${id}`),
    enabled: id !== null,
  });
}

/**
 * The **whole day** for the calendar grid.
 *
 * The list view pages at 20 — fine for a scrollable table, wrong for a grid that
 * must show every block of the day at once. So the calendar reads the same
 * endpoint with the page-size ceiling, under its own key
 * (`queryKeys.appointments.calendar`) rather than sharing the list's paged
 * entry. Both are invalidated together on a write (see `invalidateAppointments`)
 * because a booking moves every window, not just the paged one.
 */
export async function loadCalendarPages<T>(
  url: string,
  filters: { from?: string; to?: string; overlap?: string; status?: string },
): Promise<PaginatedResponse<T>> {
  const first = await getPaginated<T>(url, { ...filters, page: 1, pageSize: CALENDAR_PAGE_SIZE });
  const data = [...first.data];
  for (let page = 2; data.length < first.total; page += 1) {
    const next = await getPaginated<T>(url, { ...filters, page, pageSize: CALENDAR_PAGE_SIZE });
    if (next.data.length === 0 || next.total !== first.total)
      throw new Error("The calendar changed while loading. Please try again.");
    data.push(...next.data);
  }
  return { ...first, data };
}

export function useCalendarStaff(enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.staff.list(), "calendar"],
    queryFn: () => loadCalendarPages<StaffSummary>("/staff", { status: "active" }),
    enabled,
  });
}

export function useCalendarAppointments(range: { from: string; to: string }, enabled = true) {
  return useQuery({
    queryKey: queryKeys.appointments.calendar(range.from, range.to),
    queryFn: () =>
      loadCalendarPages<AppointmentSummary>("/appointments", {
        from: range.from,
        to: range.to,
        overlap: "true",
      }),
    // The grid stays dormant until it is shown: the day list must not pay for
    // the calendar's whole-day read just because the screen also offers it.
    enabled,
  });
}

export function useCreateAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateAppointmentInput) => post<AppointmentDetail>("/appointments", input),
    onSuccess: () => {
      invalidateAppointments(queryClient);
    },
  });
}

export function useUpdateAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAppointmentInput }) =>
      patch<AppointmentDetail>(`/appointments/${id}`, input),
    onSuccess: () => {
      // `invalidateAppointments` clears the whole `["appointments"]` prefix,
      // which already includes this booking's `detail` entry.
      invalidateAppointments(queryClient);
    },
  });
}

/**
 * A drag on the calendar grid — a reschedule, posted as the same PATCH.
 *
 * The difference from `useUpdateAppointment` is **optimism**: a drag should move
 * the block under the pointer immediately, not wait for a round trip and then
 * snap back from the server. So the calendar's cached day is rewritten the
 * instant the drop lands, and rolled back if the server refuses — most often
 * the `409` a clash produces (ADR 0014), or a performer outside the service's
 * department (ADR 0013). Either way the toast carries the server's own message,
 * and the block returns to where it was.
 */
export function useRescheduleAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RescheduleInput }) =>
      patch<AppointmentDetail>(`/appointments/${id}`, input),

    onMutate: async ({ id, input }) => {
      // Cancel any in-flight refetch so it cannot overwrite the optimistic move.
      await queryClient.cancelQueries({ queryKey: queryKeys.appointments.all() });
      const previous = queryClient.getQueriesData<PaginatedResponse<AppointmentSummary>>({
        queryKey: queryKeys.appointments.calendarPrefix(),
      });

      queryClient.setQueriesData<PaginatedResponse<AppointmentSummary>>(
        { queryKey: queryKeys.appointments.calendarPrefix() },
        (page) =>
          page
            ? {
                ...page,
                data: page.data.map((booking) =>
                  booking.id === id
                    ? {
                        ...booking,
                        ...(input.startsAt !== undefined
                          ? {
                              startsAt: input.startsAt,
                              endsAt: new Date(
                                new Date(input.startsAt).getTime() +
                                  new Date(booking.endsAt).getTime() -
                                  new Date(booking.startsAt).getTime(),
                              ).toISOString(),
                            }
                          : {}),
                        ...(input.staffId !== undefined ? { staffId: input.staffId } : {}),
                      }
                    : booking,
                ),
              }
            : page,
      );

      return { previous };
    },

    onError: (_error, _variables, context) => {
      // Roll every calendar entry back to what it was before the drop.
      for (const [key, data] of context?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
    },

    onSettled: () => {
      // The server is the source of truth for `endsAt`, `durationMinutes` and
      // the denormalised names, so re-read rather than trust the optimistic row.
      invalidateAppointments(queryClient);
    },
  });
}

/**
 * A write moves every window, not just the one on screen: booking tomorrow
 * changes today's "upcoming" list, the calendar grid and the dashboard tile
 * alike, so the whole `["appointments"]` prefix is invalidated rather than one
 * page of it. That prefix covers `list`, `calendar` and `detail`, which is why
 * the mutation handlers no longer invalidate the detail entry separately.
 *
 * The dashboard summary goes with it — its appointments tile is the same
 * table counted differently (ADR 0010: one server-side answer per figure).
 */
function invalidateAppointments(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.summary() });
}
