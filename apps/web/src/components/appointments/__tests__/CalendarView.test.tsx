/**
 * The calendar grid — handoff screen 06.
 *
 * Rendered with its columns and rows passed in, exactly as the page does, so the
 * assertions are about what the grid *draws*: a column per performer plus an
 * Unassigned column, a block placed under its own staff head by its real time,
 * and the empty/read-only states. The block's position is checked through the
 * geometry module it shares, not through pixel-sniffing the DOM.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AppointmentSummary } from "@glampro_suite/shared";

import CalendarView, { type CalendarColumn } from "../CalendarView";
import { HOUR_HEIGHT } from "../calendar-geometry";

function booking(overrides: Partial<AppointmentSummary> = {}): AppointmentSummary {
  return {
    id: "appt-1",
    // 09:00–10:00 salon time (Asia/Singapore = UTC+8): 01:00–02:00 UTC.
    startsAt: "2026-10-09T01:00:00.000Z",
    endsAt: "2026-10-09T02:00:00.000Z",
    status: "SCHEDULED",
    durationMinutes: 60,
    comment: null,
    customerId: "customer-1",
    customerName: "Mina Customer",
    staffId: "staff-1",
    staffName: "Stella Stylist",
    serviceId: "service-1",
    serviceName: "Signature cut",
    serviceDepartmentId: null,
    services: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const COLUMNS: CalendarColumn[] = [
  { id: "staff-1", name: "Stella Stylist", role: "Stylist" },
  { id: null, name: "Unassigned" },
];

/** A date whose local hours line up with the fixture instants above. */
const DAY = new Date(2026, 9, 9, 12, 0, 0, 0);

describe("CalendarView", () => {
  it("renders a track per column with its own header", () => {
    const { container } = render(
      <CalendarView day={DAY} appointments={[booking()]} columns={COLUMNS} onEdit={vi.fn()} />,
    );

    expect(screen.getByText("Stella Stylist")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    // Two tracks: one per column, addressable by the staff id / "unassigned".
    expect(container.querySelector('[data-column="staff-1"]')).not.toBeNull();
    expect(container.querySelector('[data-column="unassigned"]')).not.toBeNull();
  });

  it("places a block under its performer's head, not just somewhere on the grid", () => {
    const { container } = render(
      <CalendarView day={DAY} appointments={[booking()]} columns={COLUMNS} onEdit={vi.fn()} />,
    );

    const track = container.querySelector('[data-column="staff-1"]');
    expect(within(track as HTMLElement).getByText("Mina Customer")).toBeInTheDocument();
  });

  it("draws the block at the height the geometry says, from its own times", () => {
    const { container } = render(
      <CalendarView
        day={DAY}
        // 09:00–10:00 local, one hour → HOUR_HEIGHT tall.
        appointments={[booking()]}
        columns={COLUMNS}
        onEdit={vi.fn()}
      />,
    );

    const block = container.querySelector('[data-column="staff-1"] button');
    expect(block).toHaveStyle({ height: `${HOUR_HEIGHT}px` });
  });

  it("shows the empty state when the day has nothing booked", () => {
    render(<CalendarView day={DAY} appointments={[]} columns={COLUMNS} onEdit={vi.fn()} />);
    expect(screen.getByText("Nothing booked that day")).toBeInTheDocument();
  });

  it("opens the editor through onEdit when a block is clicked", async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(<CalendarView day={DAY} appointments={[booking()]} columns={COLUMNS} onEdit={onEdit} />);

    await user.click(screen.getByRole("button", { name: /Mina Customer, Scheduled/ }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("keeps blocks inert for a read-only salon", () => {
    render(
      <CalendarView
        day={DAY}
        appointments={[booking()]}
        columns={COLUMNS}
        isReadOnly
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Mina Customer/ })).toBeDisabled();
  });

  it("shows a loading skeleton while pending", () => {
    render(
      <CalendarView day={DAY} appointments={[]} columns={COLUMNS} isPending onEdit={vi.fn()} />,
    );
    expect(screen.queryByText("Mina Customer")).not.toBeInTheDocument();
  });
});

/**
 * Drag-to-reschedule (slice 6c).
 *
 * The gesture is HTML5 drag-and-drop: the block is a drag source carrying its
 * id, each track a drop target. These tests drive the raw events with a stub
 * `dataTransfer` and a stubbed track geometry, and assert the *payload* the grid
 * hands to `onReschedule` — the same fields a real PATCH sends. Whether the move
 * is allowed (clash, department) is the server's call, not asserted here.
 *
 * jsdom's `fireEvent` does not populate `MouseEvent.clientY` on drag events (it
 * is a read-only getter the event map leaves undefined), so the drop is
 * dispatched by hand with `clientY` and `dataTransfer` defined onto a plain
 * `Event`. That is the one accommodation jsdom forces; the handler itself reads
 * a normal `event.clientY` and `event.dataTransfer`.
 */
describe("CalendarView drag-to-reschedule", () => {
  const dragColumns: CalendarColumn[] = [
    { id: "staff-1", name: "Stella Stylist" },
    { id: "staff-2", name: "Nia Nailist" },
    { id: null, name: "Unassigned" },
  ];

  /**
   * A block on staff-1's column. Its start is built in **local** time (the grid
   * places blocks by local hours), so a drop at the matching offset reads as
   * "same time, new performer" whatever the runner's timezone.
   */
  const dragged = booking({
    id: "appt-drag",
    // 10:00 salon time (Asia/Singapore = UTC+8): 02:00 UTC.
    startsAt: "2026-10-09T02:00:00.000Z",
    endsAt: new Date(2026, 9, 9, 11, 0).toISOString(),
    staffId: "staff-1",
    staffName: "Stella Stylist",
  });

  function stubTrackTop(track: HTMLElement, top: number) {
    // jsdom has no layout, so the drop's pointer offset is pinned by hand: the
    // handler reads `getBoundingClientRect().top`, which we fix to a known value.
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      top,
      bottom: top + 800,
      left: 0,
      right: 200,
      width: 200,
      height: 800,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect);
  }

  /** A minimal DataTransfer stub: an in-memory string map. */
  function dataTransfer() {
    const store: Record<string, string> = {};
    return {
      setData: (key: string, value: string) => {
        store[key] = value;
      },
      getData: (key: string) => store[key] ?? "",
      effectAllowed: "none",
      dropEffect: "none",
    };
  }

  /** Fire `drop` on `target` carrying `clientY` and `dataTransfer`. */
  function drop(target: Element, clientY: number, transfer: ReturnType<typeof dataTransfer>) {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clientY", { value: clientY, configurable: true });
    Object.defineProperty(event, "dataTransfer", { value: transfer, configurable: true });
    target.dispatchEvent(event);
  }

  it("moves a block down its own column to a new time", () => {
    const onReschedule = vi.fn();
    const { container } = render(
      <CalendarView
        day={DAY}
        appointments={[dragged]}
        columns={dragColumns}
        onEdit={vi.fn()}
        onReschedule={onReschedule}
      />,
    );

    const block = container.querySelector('[data-column="staff-1"] button');
    const track = container.querySelector('[data-column="staff-1"]');
    if (!block || !track) throw new Error("Expected a block on its track.");
    stubTrackTop(track as HTMLElement, 0);

    // Three hours below the 08:00 top (HOUR_HEIGHT px/hour) → 11:00 local.
    const transfer = dataTransfer();
    fireEvent.dragStart(block, { dataTransfer: transfer });
    drop(track, 3 * HOUR_HEIGHT, transfer);

    expect(onReschedule).toHaveBeenCalledTimes(1);
    const [id, input] = onReschedule.mock.calls[0];
    expect(id).toBe("appt-drag");
    // 11:00 salon time = 03:00 UTC; compare the instant, not host-local getters.
    expect(input.startsAt).toBe("2026-10-09T03:00:00.000Z");
    expect(input.staffId).toBeUndefined();
  });

  it("reassigns a block when dropped in another performer's column", () => {
    const onReschedule = vi.fn();
    const { container } = render(
      <CalendarView
        day={DAY}
        appointments={[dragged]}
        columns={dragColumns}
        onEdit={vi.fn()}
        onReschedule={onReschedule}
      />,
    );

    const block = container.querySelector('[data-column="staff-1"] button');
    const target = container.querySelector('[data-column="staff-2"]');
    if (!block || !target) throw new Error("Expected a block and a second column.");
    stubTrackTop(target as HTMLElement, 0);

    // Dropped at the same 10:00 (two hours in) but on staff-2's track.
    const transfer = dataTransfer();
    fireEvent.dragStart(block, { dataTransfer: transfer });
    drop(target, 2 * HOUR_HEIGHT, transfer);

    expect(onReschedule).toHaveBeenCalledTimes(1);
    const [, input] = onReschedule.mock.calls[0];
    expect(input.staffId).toBe("staff-2");
    expect(input.startsAt).toBeUndefined();
  });

  it("does not reschedule for a read-only salon", () => {
    const onReschedule = vi.fn();
    const { container } = render(
      <CalendarView
        day={DAY}
        appointments={[dragged]}
        columns={dragColumns}
        isReadOnly
        onEdit={vi.fn()}
        onReschedule={onReschedule}
      />,
    );

    const track = container.querySelector('[data-column="staff-1"]');
    const transfer = dataTransfer();
    transfer.setData("text/plain", "appt-drag");
    drop(track as HTMLElement, 5 * HOUR_HEIGHT, transfer);

    expect(onReschedule).not.toHaveBeenCalled();
  });
});
