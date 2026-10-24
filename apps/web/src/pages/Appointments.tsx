/** Appointments: paged list and complete day/week/month occupancy reads.
 * Day/week drops change date, time and staff; month drops preserve time/staff.
 * Every write uses the shared editor or server-authorized appointment PATCH.
 */
import { useState } from "react";

import type { AppointmentDetail, AppointmentSummary } from "@glampro_suite/shared";

import AppointmentFormDrawer from "@/components/appointments/AppointmentFormDrawer";
import CalendarView, { type RescheduleInput } from "@/components/appointments/CalendarView";
import MonthView from "@/components/appointments/MonthView";
import WeekView from "@/components/appointments/WeekView";
import {
  addDays,
  buildCalendarColumns,
  dayKey,
  dayWindow,
  monthWindow,
  shiftMonth,
  startOfWeek,
  weekWindow,
  type CalendarColumn,
} from "@/components/appointments/calendar-geometry";
import { Calendar, ChevronLeft, Plus, Search } from "@/components/icons";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Select from "@/components/ui/Select";
import Skeleton from "@/components/ui/Skeleton";
import Table, { type TableColumn } from "@/components/ui/Table";
import { showToast } from "@/components/ui/toast-store";
import {
  APPOINTMENT_STATUS_BADGE,
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_OPTIONS,
  OPEN_APPOINTMENT_STATUSES,
} from "@/constants/appointments";
import { useAuth } from "@/contexts/AuthContext";
import { useBookingFormatting } from "@/hooks/useBookingFormatting";
import {
  CALENDAR_PAGE_SIZE,
  useAppointmentList,
  useCalendarAppointments,
  useCalendarStaff,
  useRescheduleAppointment,
  useUpdateAppointment,
} from "@/hooks/useAppointments";
import { get, getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { instantFromSalonDate, toSalonDate } from "@/lib/salon-time";

const PAGE_SIZE = 20;

/** The four views screen 06's toolbar draws, in the order the handoff draws them. */
const VIEW_OPTIONS = [
  { key: "list", label: "List" },
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
] as const;

type AppointmentView = (typeof VIEW_OPTIONS)[number]["key"];

/** Whether the list is showing the salon's own day. */
function isToday(day: Date, timeZone: string): boolean {
  return (
    dayKey(toSalonDate(day, timeZone) ?? day) ===
    dayKey(toSalonDate(new Date(), timeZone) ?? new Date())
  );
}

/**
 * The toolbar's subtitle: whichever **range** the view on screen is showing.
 *
 * The week is named by both of its edges, because "the week of the 14th" is a question
 * rather than an answer, and the month by its name, because a month has no edges to
 * misread. `formatDate` reads local calendar fields, which is the same clock the windows
 * and the grid are built from.
 */
function viewSubtitle(
  view: AppointmentView,
  day: Date,
  formatDate: (
    value: string | Date | null | undefined,
    options?: Intl.DateTimeFormatOptions,
  ) => string,
): string {
  if (view === "month") {
    return formatDate(day, { month: "long", year: "numeric" });
  }

  if (view === "week") {
    const first = startOfWeek(day);
    const last = addDays(first, 6);
    const from = formatDate(first, { day: "numeric", month: "short" });
    const to = formatDate(last, { day: "numeric", month: "short", year: "numeric" });
    return `${from} – ${to}`;
  }

  return formatDate(day, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Where a booking made from this view starts — in salon time.
 *
 * The desk books *into the view it is looking at*, so a new appointment lands on
 * the next half hour when that view is today, and at 09:00 on a day that is not —
 * "now" on yesterday's list would be a trap. Derived rather than kept in state:
 * the value is only read by the drawer's initialiser, and it has to be right at
 * the moment the desk opens the form, not whenever the day last changed.
 */
function bookingStart(day: Date, timeZone: string): string {
  const salonDay = toSalonDate(day, timeZone) ?? day;
  if (!isToday(day, timeZone)) {
    // 09:00 salon time on the anchor day.
    const start = new Date(
      salonDay.getFullYear(),
      salonDay.getMonth(),
      salonDay.getDate(),
      9,
      0,
      0,
      0,
    );
    return instantFromSalonDate(start, timeZone).toISOString();
  }

  const salonNow = toSalonDate(new Date(), timeZone) ?? new Date();
  const rounded = new Date(salonNow);
  rounded.setMinutes(salonNow.getMinutes() > 30 ? 60 : 30, 0, 0);
  return instantFromSalonDate(rounded, timeZone).toISOString();
}

export default function Appointments() {
  const { isReadOnly } = useAuth();
  const { formatDate, formatTime, timeZone, outletReady, outletError } = useBookingFormatting();

  const [day, setDay] = useState(() => new Date());
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<AppointmentDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // One book, four ways of asking for it (ADR 0018): the list and the day grid each read
  // the anchor day, the week the seven days that hold it, the month the calendar month.
  // `day` stays the anchor all four share, so switching view never moves the desk
  // somewhere it did not ask to be.
  const [view, setView] = useState<AppointmentView>("list");

  // Booking defaults come from `bookingStart(day)` at the moment the drawer opens
  // — see that function; there is no effect writing into state for it.

  const showList = view === "list";
  const showDay = view === "day";
  const showWeek = view === "week";
  const showMonth = view === "month";
  const stepUnit = showMonth ? "month" : showWeek ? "week" : "day";

  // The anchor day is read as salon-local wall clock: a desk in Los Angeles
  // looking at a Singapore salon sees Singapore's day, not its own.
  const salonDay = toSalonDate(day, timeZone) ?? day;

  const dayRange = dayWindow(day, timeZone);
  const weekRange = weekWindow(day, timeZone);
  const monthRange = monthWindow(day, timeZone);

  const { data, isPending, isError, error, isFetching, refetch } = useAppointmentList({
    page: 1,
    pageSize: PAGE_SIZE,
    from: dayRange.from,
    to: dayRange.to,
    status: (status || undefined) as AppointmentSummary["status"] | undefined,
  });

  // Each window is read only while its own view is on screen, so the list pays for no
  // calendar at all and the views the desk is not looking at pay for nothing either. All
  // three stay in the cache once fetched, so stepping to the week and back is instant.
  const dayCalendar = useCalendarAppointments(dayRange, showDay);
  const weekCalendar = useCalendarAppointments(weekRange, showWeek);
  const monthCalendar = useCalendarAppointments(monthRange, showMonth);

  /** The view on screen is the only one whose rows, pending and error state are drawn. */
  const calendar = showMonth ? monthCalendar : showWeek ? weekCalendar : dayCalendar;
  const calendarRows = calendar.data?.data ?? [];

  // Day and week share the complete active roster, plus booked archived staff.
  const staff = useCalendarStaff(showDay || showWeek);
  const gridColumns: CalendarColumn[] = buildCalendarColumns(
    calendarRows,
    (staff.data?.data ?? []).map((member) => ({
      id: member.id,
      name: member.name,
      role: member.position ?? undefined,
    })),
  );

  const update = useUpdateAppointment();
  const reschedule = useRescheduleAppointment();
  const rows = data?.data ?? [];
  const showingToday = isToday(day, timeZone);
  // Defensive disclosure: normal calendar reads load every page before succeeding.
  const truncated = !showList && (calendar.data?.total ?? 0) > calendarRows.length;

  /**
   * The arrow steps the unit the view on screen shows: a day in List and Day, a week in
   * Week, a month in Month — so "next" always means next of what is being looked at.
   */
  function stepBy(direction: 1 | -1) {
    // `shiftMonth` holds the day of the month where it exists (31 January + a month is 28
    // February, not 3 March) and `addDays` builds from calendar fields, so neither a short
    // month nor a DST night can walk the anchor somewhere the desk did not ask for.
    setDay((current) => {
      const wall = toSalonDate(current, timeZone) ?? current;
      const next = showMonth
        ? shiftMonth(wall, direction)
        : addDays(wall, showWeek ? 7 * direction : direction);
      next.setHours(12);
      return instantFromSalonDate(next, timeZone);
    });
  }

  function openCreate() {
    setEditing(null);
    setDrawerOpen(true);
  }

  /**
   * A drag on the grid. The move is optimistic (the block jumps under the
   * pointer); if the server refuses it — a clash (`409`, ADR 0014) or a
   * performer outside the service's department (ADR 0013) — the block snaps
   * back and the toast carries the server's own message.
   */
  function handleReschedule(id: string, input: RescheduleInput) {
    reschedule.mutate(
      { id, input },
      {
        onError: (error_) => showToast("error", getErrorMessage(error_)),
      },
    );
  }

  async function openEdit(appointment: AppointmentSummary) {
    // A list row is a summary and the form needs the whole record (finishedAt),
    // so opening the editor is a second read rather than a re-use of the row —
    // the same rule the customer screen keeps.
    setEditing(await get<AppointmentDetail>(`/appointments/${appointment.id}`));
    setDrawerOpen(true);
  }

  async function quickStatus(appointment: AppointmentSummary, next: "COMPLETED" | "CANCELLED") {
    try {
      await update.mutateAsync({ id: appointment.id, input: { status: next } });
      showToast(
        "success",
        next === "COMPLETED" ? "Appointment completed." : "Appointment cancelled.",
      );
    } catch (error_) {
      showToast("error", getErrorMessage(error_));
    }
  }

  const columns: TableColumn<AppointmentSummary>[] = [
    {
      key: "time",
      header: "Time",
      cell: (row) => (
        <div>
          <p className="font-bold text-ink">{formatTime(row.startsAt)}</p>
          <p className="text-xs text-ink-muted">
            {row.durationMinutes ? `${row.durationMinutes} min` : "—"}
          </p>
        </div>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      cell: (row) =>
        row.customerName ? (
          <span className="font-bold text-ink">{row.customerName}</span>
        ) : (
          <span className="text-ink-muted">Walk-in</span>
        ),
    },
    { key: "service", header: "Service", cell: (row) => row.serviceName ?? "—" },
    { key: "outlet", header: "Outlet", cell: (row) => row.outletName ?? "Company-wide" },
    { key: "staff", header: "Performer", cell: (row) => row.staffName ?? "Unassigned" },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <Badge variant={APPOINTMENT_STATUS_BADGE[row.status]}>
          {APPOINTMENT_STATUS_LABELS[row.status]}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) => (
        <div className="flex justify-end gap-1.5">
          {OPEN_APPOINTMENT_STATUSES.includes(row.status) ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={isReadOnly || update.isPending}
                onClick={() => void quickStatus(row, "COMPLETED")}
              >
                Complete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={isReadOnly || update.isPending}
                onClick={() => void quickStatus(row, "CANCELLED")}
              >
                Cancel
              </Button>
            </>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => void openEdit(row)}>
            Edit
          </Button>
        </div>
      ),
    },
  ];

  if (!outletReady)
    return (
      <p role={outletError ? "alert" : "status"}>
        {outletError
          ? "Outlet preferences could not be loaded. Reload or select another outlet."
          : "Loading outlet preferences…"}
      </p>
    );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl">Appointments</h2>
          <p className="mt-1 text-sm text-ink-muted">{viewSubtitle(view, salonDay, formatDate)}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-line bg-surface">
            <button
              type="button"
              aria-label={`Previous ${stepUnit}`}
              onClick={() => stepBy(-1)}
              className="flex h-control w-control items-center justify-center text-ink-body transition hover:bg-surface-muted"
            >
              <ChevronLeft aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setDay(new Date())}
              className={cn(
                "h-control px-3 text-sm font-medium transition",
                showingToday ? "text-purple" : "text-ink-body hover:bg-surface-muted",
              )}
            >
              Today
            </button>
            <button
              type="button"
              aria-label={`Next ${stepUnit}`}
              onClick={() => stepBy(1)}
              className="flex h-control w-control items-center justify-center text-ink-body transition hover:bg-surface-muted"
            >
              <ChevronLeft aria-hidden className="rotate-180" />
            </button>
          </div>

          {/* List | Day | Week | Month — the handoff's own Day/Week/Month switch (screen
              06), plus the list it also drew. The arrows above step whichever unit the
              pressed view shows, so the toggle is also what the arrows mean. */}
          <div className="flex items-center gap-1 rounded-md border border-line bg-surface p-0.5">
            {VIEW_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={view === option.key}
                onClick={() => setView(option.key)}
                className={cn(
                  "h-control rounded-sm px-3 text-sm font-medium transition",
                  view === option.key
                    ? "bg-purple-soft text-purple"
                    : "text-ink-body hover:bg-surface-muted",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {showList ? (
            <Select
              label="Status"
              hideLabel
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              options={APPOINTMENT_STATUS_OPTIONS}
              className="w-44"
            />
          ) : null}

          <Button onClick={openCreate} disabled={isReadOnly}>
            <Plus aria-hidden />
            Book appointment
          </Button>
        </div>
      </header>

      {/* Said out loud rather than silently truncated: a month drawn from one page has
          holes in it, and a hole in a calendar reads as free time. `total` comes from the
          envelope, so this is the response's own number rather than a second count. */}
      {truncated ? (
        <p
          role="status"
          className="rounded-card border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning"
        >
          Showing the first {calendarRows.length} of {calendar.data?.total ?? 0} appointments{" "}
          {showMonth ? "this month" : showWeek ? "this week" : "this day"} — a calendar read is at
          most {CALENDAR_PAGE_SIZE} at a time. Step to a smaller range, or use the list for the
          rest.
        </p>
      ) : null}

      {/* Each calendar explains its drag semantics and retains click-to-edit. */}
      {showWeek || showMonth ? (
        <p className="text-sm text-ink-muted">
          {isReadOnly
            ? "Read-only salon. Bookings cannot be changed."
            : showMonth
              ? "Drag a booking to another date to keep its salon-local time and staff. Open it to change the time or staff."
              : "Drag a booking between day and staff columns to change its date, time or staff. Open it for keyboard editing."}
        </p>
      ) : null}
      {showDay || showWeek ? (
        <p className="text-sm text-ink-muted">
          Time grids show 08:00–20:00 salon time. Use Month to see bookings outside these hours, or
          open a booking to edit it without dragging.
        </p>
      ) : null}

      {showList ? (
        <section
          aria-busy={isPending || isFetching}
          aria-label="Appointments for the selected day"
          className="rounded-card border border-line bg-surface"
        >
          <div className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
            <p className="text-sm text-ink-muted">
              {isPending
                ? "Loading appointments…"
                : `${data?.total ?? 0} ${data?.total === 1 ? "appointment" : "appointments"}`}
              {status
                ? ` · ${APPOINTMENT_STATUS_OPTIONS.find((option) => option.value === status)?.label}`
                : ""}
            </p>
          </div>

          {isPending ? (
            <div className="flex flex-col gap-3 p-5">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-11" />
              ))}
            </div>
          ) : isError ? (
            <EmptyState
              title="The book could not be loaded"
              description={getErrorMessage(error)}
              icon={<Calendar />}
              action={<Button onClick={() => void refetch()}>Try again</Button>}
            />
          ) : (
            <Table
              caption="Appointments for the selected day"
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              className="rounded-none border-0"
              empty={
                status || !showingToday ? (
                  <EmptyState
                    title="Nothing booked for that view"
                    description={
                      status
                        ? "No appointments match this status on the selected day."
                        : "The book is empty for this day. Move the date or book the first one."
                    }
                    icon={<Search />}
                    action={
                      <Button variant="secondary" onClick={() => setStatus("")}>
                        Clear filter
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    title="No appointments today"
                    description="Book the first appointment of the day and it will show up here."
                    icon={<Calendar />}
                    action={
                      <Button onClick={openCreate} disabled={isReadOnly}>
                        Book appointment
                      </Button>
                    }
                  />
                )
              }
            />
          )}
        </section>
      ) : showMonth ? (
        <MonthView
          day={day}
          appointments={calendarRows}
          isPending={calendar.isPending}
          isError={calendar.isError}
          errorMessage={calendar.error ? getErrorMessage(calendar.error) : undefined}
          isReadOnly={isReadOnly}
          onEdit={openEdit}
          onReschedule={handleReschedule}
          onRetry={() => void calendar.refetch()}
        />
      ) : showWeek ? (
        <WeekView
          day={day}
          columns={gridColumns}
          appointments={calendarRows}
          isPending={calendar.isPending || staff.isPending}
          isError={calendar.isError || staff.isError}
          errorMessage={
            calendar.error || staff.error
              ? getErrorMessage(calendar.error || staff.error)
              : undefined
          }
          isReadOnly={isReadOnly}
          onEdit={openEdit}
          onReschedule={handleReschedule}
          onRetry={() => {
            void calendar.refetch();
            void staff.refetch();
          }}
        />
      ) : (
        <CalendarView
          day={day}
          appointments={calendarRows}
          columns={gridColumns}
          isPending={calendar.isPending || staff.isPending}
          isError={calendar.isError || staff.isError}
          errorMessage={
            calendar.error || staff.error
              ? getErrorMessage(calendar.error || staff.error)
              : undefined
          }
          isReadOnly={isReadOnly}
          onEdit={openEdit}
          onReschedule={handleReschedule}
          onRetry={() => {
            void calendar.refetch();
            void staff.refetch();
          }}
        />
      )}

      <AppointmentFormDrawer
        // Remounting on open and on record change is what clears the form.
        key={`${editing?.id ?? "new"}:${drawerOpen}`}
        open={drawerOpen}
        appointment={editing}
        defaultStartsAt={bookingStart(day, timeZone)}
        bookingTimeZone={timeZone}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
