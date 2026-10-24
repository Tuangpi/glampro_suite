/** Week calendar: Monday-first day/staff tracks with quarter-hour drag targets.
 * Shared geometry clips overnight occupancy to each visible 08:00–20:00 span.
 * Overlapping blocks use lanes; all writes remain server-authorized.
 */
import type { AppointmentSummary } from "@glampro_suite/shared";
import type { RescheduleInput } from "./CalendarView";
import type { CalendarColumn } from "./calendar-geometry";

import { Calendar } from "@/components/icons";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { CALENDAR_WEEKDAY_LABELS } from "@/constants/appointments";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { cn } from "@/lib/utils";
import { toSalonDate } from "@/lib/salon-time";
import AppointmentBlock from "./AppointmentBlock";
import {
  DAY_HOURS,
  DAY_START_HOUR,
  HOUR_HEIGHT,
  HOUR_LINES,
  TRACK_HEIGHT,
  blockBox,
  blockMinutes,
  bookingsOnDays,
  dayKey,
  gridTemplate,
  isSameDay,
  nowLineTop,
  packLanes,
  rescheduleFields,
  PX_PER_MINUTE,
  weekDays,
} from "./calendar-geometry";

export interface WeekViewProps {
  /** Any day inside the week to draw — the week is the Monday-first one it falls in. */
  day: Date;
  /** Already loaded for the week — the component owns no query of its own. */
  appointments: AppointmentSummary[];
  columns?: CalendarColumn[];
  onReschedule?: (id: string, input: RescheduleInput) => void;
  isPending?: boolean;
  isError?: boolean;
  errorMessage?: string;
  /** A suspended salon may look but not open the editor. */
  isReadOnly?: boolean;
  onEdit: (appointment: AppointmentSummary) => void;
  onRetry?: () => void;
}

export default function WeekView({
  day,
  appointments,
  columns,
  onReschedule,
  isPending = false,
  isError = false,
  errorMessage,
  isReadOnly = false,
  onEdit,
  onRetry,
}: WeekViewProps) {
  const { timeZone } = useSalonFormatting();
  if (isPending) {
    return (
      <div className="flex flex-col gap-3 p-5" aria-busy="true">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-16" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        title="The week could not be loaded"
        description={errorMessage ?? "These bookings are unavailable right now."}
        icon={<Calendar />}
        action={
          onRetry ? (
            <Button onClick={onRetry} variant="secondary">
              Try again
            </Button>
          ) : undefined
        }
      />
    );
  }

  // The anchor day and "today" are read as salon-local wall clock: a desk in
  // Los Angeles looking at a Singapore salon sees Singapore's day, not its own.
  const salonDay = toSalonDate(day, timeZone) ?? day;
  const salonToday = toSalonDate(new Date(), timeZone) ?? new Date();

  const days = weekDays(salonDay);
  const byDay = bookingsOnDays(appointments, days, timeZone);
  const staffColumns = columns ?? [{ id: null, name: "All staff" }];
  const tracks = days.flatMap((date, index) =>
    staffColumns.map((staff) => ({ date, index, staff })),
  );

  if (appointments.length === 0) {
    return (
      <div className="p-5">
        <EmptyState
          title="Nothing booked that week"
          description="Move the week, or book the first appointment and it will appear on the grid."
          icon={<Calendar />}
        />
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full rounded-card overflow-auto border border-line bg-surface">
      <div style={{ minWidth: 68 + tracks.length * 140 }}>
        {/* Day heads — a second grid with the same template, so a head always sits exactly
          above its own column. `CALENDAR_WEEKDAY_LABELS` is Monday-first, the same first
          day `weekDays` returns. */}
        <div
          className="grid border-b border-line-soft"
          style={{ gridTemplateColumns: gridTemplate(tracks.length) }}
        >
          <div className="border-r border-line-soft" />
          {tracks.map(({ date: column, index, staff }) => (
            <div
              key={`${dayKey(column)}:${staff.id}`}
              className="flex flex-col items-center gap-1 border-r border-line-soft px-2 py-2.5"
            >
              <span className="text-2xs font-bold tracking-wide text-ink-muted uppercase">
                {CALENDAR_WEEKDAY_LABELS[index]}
              </span>
              <span
                aria-hidden
                className={cn(
                  "flex size-6 items-center justify-center rounded-pill text-xs font-extrabold",
                  isSameDay(column, salonToday) ? "bg-purple text-white" : "text-ink",
                )}
              >
                {column.getDate()}
              </span>
              <span className="text-xs font-semibold">{staff.name}</span>
            </div>
          ))}
        </div>

        <div className="max-h-[70vh] overflow-auto">
          <div
            className="grid"
            style={{ gridTemplateColumns: gridTemplate(tracks.length) }}
            aria-label={`Week of ${days[0]?.toDateString() ?? ""}`}
          >
            {/* Time gutter: hour labels, each centred on its own hour line. */}
            <div className="relative border-r border-line-soft" style={{ height: TRACK_HEIGHT }}>
              {DAY_HOURS.map((hour) => (
                <span
                  key={hour}
                  className="absolute inset-x-0 pr-2 text-right text-2xs font-bold text-ink-faint"
                  style={{
                    top: (hour - DAY_START_HOUR) * HOUR_HEIGHT,
                    transform: "translateY(-50%)",
                  }}
                >
                  {`${String(hour).padStart(2, "0")}:00`}
                </span>
              ))}
            </div>

            {tracks.map(({ date: column, staff }) => (
              <DayTrack
                key={`${dayKey(column)}:${staff.id}`}
                day={column}
                staffId={staff.id}
                appointments={(byDay.get(dayKey(column)) ?? []).filter(
                  (booking) => !columns || booking.staffId === staff.id,
                )}
                allAppointments={appointments}
                onReschedule={onReschedule}
                showingToday={isSameDay(column, salonToday)}
                isReadOnly={isReadOnly}
                timeZone={timeZone}
                onEdit={onEdit}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One day column: the hour lines, that day's blocks in their lanes, and the now-indicator
 * when the column is today.
 *
 * A writable track accepts a date/time/staff drop; the API checks eligibility and clashes.
 */
function DayTrack({
  day,
  staffId,
  allAppointments,
  onReschedule,
  appointments,
  showingToday,
  isReadOnly,
  onEdit,
  timeZone,
}: {
  day: Date;
  staffId: string | null;
  allAppointments: AppointmentSummary[];
  onReschedule?: (id: string, input: RescheduleInput) => void;
  appointments: AppointmentSummary[];
  showingToday: boolean;
  isReadOnly: boolean;
  onEdit: (appointment: AppointmentSummary) => void;
  timeZone: string;
}) {
  // `blockMinutes` answers "is this booking on this day at all?", which is what keeps the
  // week honest: a booking is drawn in its own column and in no other.
  const salonNow = toSalonDate(new Date(), timeZone) ?? new Date();
  const placed = appointments.flatMap((booking) => {
    const span = blockMinutes(booking, day, timeZone);
    const box = blockBox(booking, day, timeZone);
    return span === null || box === null ? [] : [{ booking, span, box }];
  });

  const lanes = packLanes(
    placed.map(({ booking, span }) => ({ id: booking.id, start: span.start, end: span.end })),
  );
  const nowTop = showingToday ? nowLineTop(salonNow, timeZone) : null;

  return (
    <div
      // Exposed so a test can assert a block rendered in its own day's column, not merely
      // that a block exists somewhere on the grid.
      data-day={dayKey(day)}
      data-column={staffId ?? "unassigned"}
      onDragOver={isReadOnly || !onReschedule ? undefined : (event) => event.preventDefault()}
      onDrop={(event) => {
        if (isReadOnly || !onReschedule) return;
        event.preventDefault();
        const booking = allAppointments.find(
          (row) => row.id === event.dataTransfer.getData("text/plain"),
        );
        if (!booking) return;
        const input = rescheduleFields(
          booking,
          {
            day,
            staffId,
            offsetMinutes:
              (event.clientY - event.currentTarget.getBoundingClientRect().top) / PX_PER_MINUTE,
          },
          timeZone,
        );
        if (Object.keys(input).length) onReschedule(booking.id, input);
      }}
      className="relative border-r border-line-soft"
      style={{ height: TRACK_HEIGHT, backgroundImage: HOUR_LINES }}
    >
      {placed.map(({ booking, box }) => (
        <AppointmentBlock
          key={booking.id}
          booking={booking}
          top={box.top}
          height={box.height}
          lane={lanes.get(booking.id)}
          showStaff
          draggable={Boolean(onReschedule)}
          isReadOnly={isReadOnly}
          onEdit={onEdit}
        />
      ))}

      {nowTop === null ? null : (
        <div
          data-testid="now-line"
          className="pointer-events-none absolute inset-x-0 z-3 h-0.5 bg-danger"
          style={{ top: nowTop }}
        />
      )}
      {/* The day is exposed for assistive tech, since a grid of time blocks carries no
          other statement of which day it is drawing. */}
      <span className="sr-only">{day.toDateString()}</span>
    </div>
  );
}
