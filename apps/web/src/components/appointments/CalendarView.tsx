/**
 * The day calendar — handoff screen 06's grid, one day wide.
 *
 * One column per member of staff plus an **Unassigned** column, a time gutter
 * down the left, and every booking drawn as a block placed by its real
 * `startsAt`/`endsAt` through `calendar-geometry.ts`. There is no calendar
 * library and no new contract: the blocks are the same `AppointmentSummary`
 * rows the day list shows, so the two views are one fact asked twice.
 *
 * Three things the handoff drew that this does not, because the model has
 * nothing behind them: a shift or break block on the track (there is no rota
 * table — `EmployeeLeave` is the only half modelled, and it is not read here
 * yet), an availability hint on an empty slot, and click-to-book on one. The
 * grid is a **view** of the book, and the writes still go through the drawer
 * and, in slice 6c, a drag that posts a real PATCH.
 *
 * The colour, the frame and the block itself are shared with the other two
 * views: the palette is in `constants/appointments.ts`, the gutter and the hour
 * lines are in `calendar-geometry.ts`, and the block is `AppointmentBlock`.
 * Those views are `WeekView.tsx` (day/staff tracks with dragging) and
 * `MonthView.tsx` (a chip grid) — see ADR 0018 for why each is what it is.
 *
 * The colours are the handoff's own (a purple block, an amber in-progress
 * block, a green done block) mapped onto the project's tokens rather than the
 * file's literals — `tokens.css` is copied, never edited (`AGENTS.md` rule 2).
 */
import type { DragEvent } from "react";

import type { AppointmentSummary } from "@glampro_suite/shared";

import { Calendar } from "@/components/icons";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { cn, getInitials } from "@/lib/utils";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { toSalonDate } from "@/lib/salon-time";
import AppointmentBlock from "./AppointmentBlock";
import {
  DAY_HOURS,
  DAY_START_HOUR,
  HOUR_HEIGHT,
  HOUR_LINES,
  PX_PER_MINUTE,
  TRACK_HEIGHT,
  blockBox,
  blockMinutes,
  packLanes,
  dayKey,
  type CalendarColumn,
  gridTemplate,
  nowLineTop,
  rescheduleFields,
} from "./calendar-geometry";

export type { CalendarColumn };

/** The PATCH a drag produces — only the fields that actually moved. */
export type RescheduleInput = { startsAt?: string; staffId?: string | null };

export interface CalendarViewProps {
  day: Date;
  /** Already loaded for the day — the component owns no query of its own. */
  appointments: AppointmentSummary[];
  columns: CalendarColumn[];
  isPending?: boolean;
  isError?: boolean;
  errorMessage?: string;
  /** Disabled blocks: a suspended salon may look but not open the editor. */
  isReadOnly?: boolean;
  onEdit: (appointment: AppointmentSummary) => void;
  /** A drag that moved a block. Omitted fields mean "unchanged". */
  onReschedule?: (id: string, input: RescheduleInput) => void;
  onRetry?: () => void;
}

/** Which column a booking belongs in: its performer, or Unassigned. */
function columnOf(booking: AppointmentSummary): string | null {
  return booking.staffId ?? null;
}

/** A plain-text retry control, so this component needs no Button import cycle. */
function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="rounded-md bg-purple px-4 py-2 text-sm font-semibold text-white"
    >
      Try again
    </button>
  );
}

export default function CalendarView({
  day,
  appointments,
  columns,
  isPending = false,
  isError = false,
  errorMessage,
  isReadOnly = false,
  onEdit,
  onReschedule,
  onRetry,
}: CalendarViewProps) {
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
        title="The calendar could not be loaded"
        description={errorMessage ?? "The day's bookings are unavailable right now."}
        icon={<Calendar />}
        action={onRetry ? <RetryButton onRetry={onRetry} /> : undefined}
      />
    );
  }

  // Buckets keyed by column, filled once rather than filtered per track — a
  // day with 40 bookings and 6 columns is one pass, not six.
  const byColumn = new Map<string | null, AppointmentSummary[]>();
  for (const column of columns) byColumn.set(column.id, []);
  for (const booking of appointments) {
    const key = columnOf(booking);
    const bucket = byColumn.get(key);
    if (bucket) bucket.push(booking);
    else byColumn.set(key, [booking]);
  }

  // The anchor day and "today" are read as salon-local wall clock.
  const salonDay = toSalonDate(day, timeZone) ?? day;
  const salonToday = toSalonDate(new Date(), timeZone) ?? new Date();

  const showingToday = dayKey(salonDay) === dayKey(salonToday);

  if (appointments.length === 0) {
    return (
      <div className="p-5">
        <EmptyState
          title="Nothing booked that day"
          description="Move the date, or book the first appointment and it will appear on the grid."
          icon={<Calendar />}
        />
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full rounded-card overflow-auto border border-line bg-surface">
      <div style={{ minWidth: 68 + columns.length * 140 }}>
        {/* Staff header — a second grid with the same template, so a column head
          always sits exactly above its own track. */}
        <div
          className="grid border-b border-line-soft"
          style={{ gridTemplateColumns: gridTemplate(columns.length) }}
        >
          <div className="border-r border-line-soft" />
          {columns.map((column) => (
            <div
              key={column.id ?? "unassigned"}
              className="flex items-center gap-2.5 border-r border-line-soft px-3 py-3.5"
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-7.5 shrink-0 items-center justify-center rounded-pill text-2xs font-extrabold",
                  column.id === null ? "bg-surface-2 text-ink-muted" : "bg-navy text-white",
                )}
              >
                {column.id === null ? "?" : getInitials(column.name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-extrabold text-ink">
                  {column.name}
                </span>
                {column.role ? (
                  <span className="block truncate text-2xs text-ink-muted">{column.role}</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>

        <div className="max-h-[70vh] overflow-auto">
          <div
            className="grid"
            style={{ gridTemplateColumns: gridTemplate(columns.length) }}
            aria-label={`Calendar for ${day.toDateString()}`}
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

            {columns.map((column) => (
              <StaffTrack
                key={column.id ?? "unassigned"}
                column={column}
                day={salonDay}
                appointments={byColumn.get(column.id) ?? []}
                allAppointments={appointments}
                showingToday={showingToday}
                isReadOnly={isReadOnly}
                timeZone={timeZone}
                onEdit={onEdit}
                onReschedule={onReschedule}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One vertical track: the hour lines, the day's blocks for that performer, the
 * now-indicator when the track is today, and — when writable — it is a drop
 * target for a dragged block.
 *
 * A drop reads the dragged id, finds that booking in the **whole** day (it may
 * have come from another column), turns the pointer's offset into a snapped
 * start and this track's performer into a `staffId`, and hands the resulting
 * PATCH to `onReschedule`. The server then re-checks the clash and the
 * department rule (ADR 0014, ADR 0013); the grid never decides whether a move
 * is legal, only where it was dropped.
 */
function StaffTrack({
  column,
  day,
  appointments,
  allAppointments,
  showingToday,
  isReadOnly,
  onEdit,
  onReschedule,
  timeZone,
}: {
  column: CalendarColumn;
  day: Date;
  appointments: AppointmentSummary[];
  allAppointments: AppointmentSummary[];
  showingToday: boolean;
  isReadOnly: boolean;
  onEdit: (appointment: AppointmentSummary) => void;
  onReschedule?: (id: string, input: RescheduleInput) => void;
  timeZone: string;
}) {
  const salonNow = toSalonDate(new Date(), timeZone) ?? new Date();
  const nowTop = showingToday ? nowLineTop(salonNow, timeZone) : null;
  // `day` is what makes the placement truthful across views: a booking only gets a box
  // on a day it actually occupies (ADR 0018, decision 2).
  const placed = appointments
    .map((booking) => ({ booking, box: blockBox(booking, day, timeZone) }))
    .filter(
      (entry): entry is { booking: AppointmentSummary; box: { top: number; height: number } } =>
        entry.box !== null,
    );
  const lanes = packLanes(
    placed.flatMap(({ booking }) => {
      const span = blockMinutes(booking, day, timeZone);
      return span ? [{ id: booking.id, start: span.start, end: span.end }] : [];
    }),
  );

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (isReadOnly || !onReschedule) return;
    event.preventDefault();

    const id = event.dataTransfer.getData("text/plain");
    const booking = allAppointments.find((candidate) => candidate.id === id);
    if (!booking) return;

    // Pointer offset within the track, in minutes from the top of the day.
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetMinutes = (event.clientY - rect.top) / PX_PER_MINUTE;
    const input = rescheduleFields(booking, { day, offsetMinutes, staffId: column.id }, timeZone);
    // A drop that changed nothing posts nothing.
    if (Object.keys(input).length > 0) onReschedule(booking.id, input);
  }

  return (
    <div
      // Exposed so a test can assert a block rendered under its own staff head,
      // not merely that a block exists somewhere on the grid.
      data-column={column.id ?? "unassigned"}
      className="relative border-r border-line-soft"
      style={{ height: TRACK_HEIGHT, backgroundImage: HOUR_LINES }}
      onDragOver={isReadOnly ? undefined : (event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      {placed.map(({ booking, box }) => (
        <AppointmentBlock
          key={booking.id}
          booking={booking}
          top={box.top}
          height={box.height}
          lane={lanes.get(booking.id)}
          isReadOnly={isReadOnly}
          draggable
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
      {/* The day is exposed for assistive tech, since a grid of time blocks
          carries no other statement of which day it is drawing. */}
      <span className="sr-only">{day.toDateString()}</span>
    </div>
  );
}
