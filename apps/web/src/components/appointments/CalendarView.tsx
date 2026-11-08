/** Day calendar: one shared timeline with overlapping bookings in separate lanes.
 * Dragging changes time only; staff assignments remain in the appointment editor.
 * Placement, hour lines and lane packing share the week calendar's geometry.
 */
import type { DragEvent } from "react";

import type { AppointmentSummary } from "@glampro_suite/shared";

import { Calendar } from "@/components/icons";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
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
  gridTemplate,
  nowLineTop,
  rescheduleFields,
} from "./calendar-geometry";

/** The PATCH a drag produces — only the fields that actually moved. */
export type RescheduleInput = { startsAt?: string; staffId?: string | null };

export interface CalendarViewProps {
  day: Date;
  /** Already loaded for the day — the component owns no query of its own. */
  appointments: AppointmentSummary[];
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
  isPending = false,
  isError = false,
  errorMessage,
  isReadOnly = false,
  onEdit,
  onReschedule,
  onRetry,
}: CalendarViewProps) {
  const { timeZone, formatDate } = useSalonFormatting();
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

  // The anchor day and "today" are read as salon-local wall clock.
  const salonDay = toSalonDate(day, timeZone) ?? day;
  const salonToday = toSalonDate(new Date(), timeZone) ?? new Date();

  const showingToday = dayKey(salonDay) === dayKey(salonToday);

  // A quiet day still draws its frame: the grid is the desk's picture of the
  // day's opening hours, and an empty-state card would take the calendar away
  // exactly when someone wants to read where the free time is.
  return (
    <div className="min-w-0 max-w-full rounded-card overflow-auto border border-line bg-surface">
      <div style={{ minWidth: 208 }}>
        <div
          className="grid border-b border-line-soft"
          style={{ gridTemplateColumns: gridTemplate(1) }}
        >
          <div className="border-r border-line-soft" />
          <div className="px-3 py-3.5 text-sm font-extrabold text-ink">
            {formatDate(dayKey(salonDay), { weekday: "long", day: "numeric", month: "long" })}
          </div>
        </div>

        <div className="max-h-[70vh] overflow-auto">
          <div
            className="grid"
            style={{ gridTemplateColumns: gridTemplate(1) }}
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

            <DayTrack
              day={salonDay}
              appointments={appointments}
              showingToday={showingToday}
              isReadOnly={isReadOnly}
              timeZone={timeZone}
              onEdit={onEdit}
              onReschedule={onReschedule}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** One shared day track; drops preserve the booking's assigned staff. */
function DayTrack({
  day,
  appointments,
  showingToday,
  isReadOnly,
  onEdit,
  onReschedule,
  timeZone,
}: {
  day: Date;
  appointments: AppointmentSummary[];
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
    const booking = appointments.find((candidate) => candidate.id === id);
    if (!booking) return;

    // Pointer offset within the track, in minutes from the top of the day.
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetMinutes = (event.clientY - rect.top) / PX_PER_MINUTE;
    const input = rescheduleFields(
      booking,
      { day, offsetMinutes, staffId: booking.staffId },
      timeZone,
    );
    // A drop that changed nothing posts nothing.
    if (Object.keys(input).length > 0) onReschedule(booking.id, input);
  }

  return (
    <div
      data-day={dayKey(day)}
      className="relative border-r border-line-soft"
      style={{ height: TRACK_HEIGHT, backgroundImage: HOUR_LINES }}
      onDragOver={isReadOnly || !onReschedule ? undefined : (event) => event.preventDefault()}
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
          draggable={Boolean(onReschedule)}
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
