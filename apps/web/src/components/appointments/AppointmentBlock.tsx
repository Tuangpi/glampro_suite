/**
 * One booking, drawn as a block.
 *
 * Extracted from the day grid when the week grid arrived: both draw the same
 * `AppointmentSummary` as a rounded, left-bordered, status-toned button placed by its own
 * times, and a second copy would be a second place for the block to change. What differs
 * between the two views is per-props, never per-component.
 *
 * A block is a button rather than a div with a handler: the desk reaches the editor by
 * keyboard as well as by mouse, and a clickable div that is not a button is how a screen
 * reader ends up with a silent grid. `isReadOnly` keeps it inert — a suspended salon sees
 * the day but cannot open the write path.
 */
import type { AppointmentSummary } from "@glampro_suite/shared";

import {
  APPOINTMENT_BLOCK_BACKGROUND,
  APPOINTMENT_BLOCK_BORDER,
  APPOINTMENT_BLOCK_TEXT,
  APPOINTMENT_BLOCK_TONE,
  APPOINTMENT_STATUS_LABELS,
} from "@/constants/appointments";
import { cn } from "@/lib/utils";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import type { LanePlacement } from "./calendar-geometry";

export interface AppointmentBlockProps {
  booking: AppointmentSummary;
  top: number;
  height: number;
  /** A suspended salon may look but not open the editor. */
  isReadOnly?: boolean;
  /**
   * Opt-in for writable day/week tracks. A grid that passes nothing gets a block
   * with no drag handle rather than one that grabs and then drops nothing.
   */
  draggable?: boolean;
  /** Where the block sits when another booking shares its column at the same time. */
  lane?: LanePlacement;
  /**
   * Adds the performer's name, for a grid with no staff columns (the week has seven day
   * columns instead, so "who" is not readable off the column head).
   */
  showStaff?: boolean;
  onEdit: (appointment: AppointmentSummary) => void;
}

/** Lane insets, in percentages, with a 2px gutter so two blocks never touch. */
function laneInsets(lane: LanePlacement): { left: string; width: string } {
  return {
    left: `calc(${(lane.lane / lane.lanes) * 100}% + 2px)`,
    width: `calc(${100 / lane.lanes}% - 4px)`,
  };
}

export default function AppointmentBlock({
  booking,
  top,
  height,
  isReadOnly = false,
  draggable = false,
  lane,
  showStaff = false,
  onEdit,
}: AppointmentBlockProps) {
  const { formatTime } = useSalonFormatting();
  const tone = APPOINTMENT_BLOCK_TONE[booking.status];
  const customer = booking.customerName ?? "Walk-in";
  const label = `${customer}, ${APPOINTMENT_STATUS_LABELS[booking.status]}`;
  // Below ~34px there is room for the name and nothing else, so the detail lines are
  // dropped rather than overflowing the block.
  const compact = height < 34;
  const canDrag = draggable && !isReadOnly;

  return (
    <button
      type="button"
      data-appointment={booking.id}
      title={label}
      aria-label={label}
      disabled={isReadOnly}
      onClick={() => onEdit(booking)}
      // A drag moves the block; a click (no drag) opens the editor. `draggable` is off
      // for a read-only salon, so a suspended desk cannot grab anything.
      draggable={canDrag}
      onDragStart={
        canDrag
          ? (event) => {
              // The id rides in the dataTransfer; the drop reads it back and the server
              // re-validates the move (clash + department), so nothing is trusted here.
              event.dataTransfer.setData("text/plain", booking.id);
              event.dataTransfer.effectAllowed = "move";
            }
          : undefined
      }
      style={lane ? { top, height, ...laneInsets(lane) } : { top, height, left: 6, right: 6 }}
      className={cn(
        "absolute overflow-hidden rounded-sm border-l-[3px] px-2 py-1 text-left shadow-[0_2px_6px_rgba(27,35,80,0.08)] transition",
        "hover:brightness-[0.97] disabled:hover:brightness-100",
        canDrag ? "cursor-grab active:cursor-grabbing" : "",
        APPOINTMENT_BLOCK_BORDER[tone],
        APPOINTMENT_BLOCK_BACKGROUND[tone],
      )}
    >
      <p className="truncate text-xs leading-tight font-extrabold text-ink">{customer}</p>
      {compact ? null : (
        <p
          className={cn(
            "mt-0.5 truncate text-2xs",
            showStaff ? "text-ink-muted" : APPOINTMENT_BLOCK_TEXT[tone],
          )}
        >
          {showStaff ? (booking.staffName ?? "Unassigned") : (booking.serviceName ?? "—")}
        </p>
      )}
      {compact ? null : (
        <p
          className={cn(
            "truncate text-2xs",
            showStaff ? APPOINTMENT_BLOCK_TEXT[tone] : "text-ink-muted",
          )}
        >
          {showStaff
            ? (booking.serviceName ?? "—")
            : `${formatTime(booking.startsAt)} – ${formatTime(booking.endsAt)}`}
        </p>
      )}
    </button>
  );
}
