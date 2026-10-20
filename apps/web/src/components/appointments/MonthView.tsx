/** Month calendar: occupied dates, expandable booking chips and date-only dragging.
 * A drop preserves salon-local start time and staff. Padding is not a drop target.
 */
import type { AppointmentSummary } from "@glampro_suite/shared";
import { useState } from "react";
import type { RescheduleInput } from "./CalendarView";

import { Calendar } from "@/components/icons";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import {
  APPOINTMENT_BLOCK_BACKGROUND,
  APPOINTMENT_BLOCK_BORDER,
  APPOINTMENT_BLOCK_TEXT,
  APPOINTMENT_BLOCK_TONE,
  APPOINTMENT_STATUS_LABELS,
  CALENDAR_WEEKDAY_LABELS,
} from "@/constants/appointments";
import { cn } from "@/lib/utils";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { toSalonDate } from "@/lib/salon-time";
import {
  bookingsOnDays,
  monthRescheduleFields,
  dayKey,
  isSameDay,
  monthGridDays,
  startOfMonth,
} from "./calendar-geometry";

/**
 * Chips a cell draws before it counts the rest. Three fits a 96px cell with the date, and
 * past that the cell is a list rather than a calendar — the day grid is where a busy day is
 * meant to be read.
 */
const MAX_CHIPS_PER_DAY = 3;

export interface MonthViewProps {
  /** Any day inside the month to draw. */
  day: Date;
  /** Already loaded for the month — the component owns no query of its own. */
  appointments: AppointmentSummary[];
  isPending?: boolean;
  isError?: boolean;
  errorMessage?: string;
  /** A suspended salon may look but not open the editor. */
  isReadOnly?: boolean;
  onEdit: (appointment: AppointmentSummary) => void;
  onReschedule?: (id: string, input: RescheduleInput) => void;
  onRetry?: () => void;
}

export default function MonthView({
  day,
  appointments,
  isPending = false,
  isError = false,
  errorMessage,
  isReadOnly = false,
  onEdit,
  onReschedule,
  onRetry,
}: MonthViewProps) {
  const { timeZone, formatTime } = useSalonFormatting();
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
        title="The month could not be loaded"
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

  // The anchor day and "today" are read as salon-local wall clock.
  const salonDay = toSalonDate(day, timeZone) ?? day;
  const salonToday = toSalonDate(new Date(), timeZone) ?? new Date();

  const first = startOfMonth(salonDay);
  const cells = monthGridDays(salonDay);
  const byDay = bookingsOnDays(appointments, cells, timeZone);

  if (appointments.length === 0) {
    return (
      <div className="p-5">
        <EmptyState
          title="Nothing booked that month"
          description="Move the month, or book the first appointment and it will appear here."
          icon={<Calendar />}
        />
      </div>
    );
  }

  return (
    <div className="rounded-card overflow-hidden border border-line bg-surface">
      {/* Weekday heads, Monday first — the same first day `monthGridDays` pads to. */}
      <div className="grid grid-cols-7 border-b border-line-soft">
        {CALENDAR_WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="px-2 py-2 text-center text-2xs font-bold tracking-wide text-ink-muted uppercase"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7" aria-label={`Month of ${salonDay.toDateString()}`}>
        {cells.map((cell) => {
          const inMonth = cell.getMonth() === first.getMonth();
          return (
            <DayCell
              key={dayKey(cell)}
              day={cell}
              inMonth={inMonth}
              // A padded cell is calendar paper, not a loaded range: the month's read
              // cannot hold a booking that starts outside it, and drawing one anyway
              // would put a chip in a day whose edges nobody fetched (ADR 0018,
              // decision 6). Enforced here so a wider window in future cannot leak in.
              appointments={inMonth ? (byDay.get(dayKey(cell)) ?? []) : []}
              isToday={isSameDay(cell, salonToday)}
              isReadOnly={isReadOnly}
              onEdit={onEdit}
              onReschedule={onReschedule}
              allAppointments={appointments}
              timeZone={timeZone}
              formatTime={formatTime}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * One day of the month: its date, its chips, and a `+N more` count when the day is busier
 * than the cell can hold.
 *
 * A cell outside the month is drawn but handed no chips — its date is the calendar's
 * paper, not a loaded range (ADR 0018, decision 6). The parent decides that, so the rule
 * holds even if a caller in future loads a wider window than the month.
 */
function DayCell({
  day,
  inMonth,
  appointments,
  isToday,
  isReadOnly,
  onEdit,
  onReschedule,
  allAppointments,
  timeZone,
  formatTime,
}: {
  day: Date;
  inMonth: boolean;
  appointments: AppointmentSummary[];
  isToday: boolean;
  isReadOnly: boolean;
  onEdit: (appointment: AppointmentSummary) => void;
  onReschedule?: (id: string, input: RescheduleInput) => void;
  allAppointments: AppointmentSummary[];
  timeZone: string;
  formatTime: (value: string | Date | null | undefined) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? appointments : appointments.slice(0, MAX_CHIPS_PER_DAY);
  const hidden = appointments.length - shown.length;

  return (
    <div
      data-day={dayKey(day)}
      data-outside={inMonth ? undefined : "true"}
      onDragOver={
        !inMonth || isReadOnly || !onReschedule ? undefined : (event) => event.preventDefault()
      }
      onDrop={(event) => {
        if (!inMonth || isReadOnly || !onReschedule) return;
        event.preventDefault();
        const booking = allAppointments.find(
          (row) => row.id === event.dataTransfer.getData("text/plain"),
        );
        if (!booking) return;
        const input = monthRescheduleFields(booking, day, timeZone);
        if (Object.keys(input).length) onReschedule(booking.id, input);
      }}
      className={cn(
        "min-h-24 border-r border-b border-line-soft p-1.5",
        inMonth ? "bg-surface" : "bg-surface-2/40",
      )}
    >
      <span
        className={cn(
          "flex size-5 items-center justify-center rounded-pill text-2xs font-extrabold",
          isToday ? "bg-purple text-white" : inMonth ? "text-ink" : "text-ink-faint",
        )}
      >
        {day.getDate()}
      </span>

      <div className="mt-1 flex flex-col gap-0.5">
        {shown.map((booking) => {
          const tone = APPOINTMENT_BLOCK_TONE[booking.status];
          const customer = booking.customerName ?? "Walk-in";
          const label = `${formatTime(booking.startsAt)} ${customer}, ${
            APPOINTMENT_STATUS_LABELS[booking.status]
          }`;

          return (
            <button
              key={booking.id}
              type="button"
              data-appointment={booking.id}
              title={label}
              aria-label={label}
              disabled={isReadOnly}
              onClick={() => onEdit(booking)}
              draggable={!isReadOnly && Boolean(onReschedule)}
              onDragStart={(event) => {
                if (isReadOnly || !onReschedule) {
                  event.preventDefault();
                  return;
                }
                event.dataTransfer.setData("text/plain", booking.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              className={cn(
                "truncate rounded-sm border-l-[3px] px-1.5 py-0.5 text-left text-2xs font-semibold transition",
                "hover:brightness-[0.97] disabled:cursor-default disabled:hover:brightness-100",
                APPOINTMENT_BLOCK_BORDER[tone],
                APPOINTMENT_BLOCK_BACKGROUND[tone],
                APPOINTMENT_BLOCK_TEXT[tone],
              )}
            >
              {formatTime(booking.startsAt)} {customer}
            </button>
          );
        })}

        {hidden > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="px-1.5 text-left text-2xs font-semibold text-ink-muted"
          >
            +{hidden} more
          </button>
        ) : null}
      </div>
    </div>
  );
}
