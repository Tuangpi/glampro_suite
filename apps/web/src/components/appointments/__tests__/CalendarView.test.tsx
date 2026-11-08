/** Day timeline: placement, editing, state handling and assignment-preserving drops. */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AppointmentSummary } from "@glampro_suite/shared";

import CalendarView from "../CalendarView";
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

/** A date whose local hours line up with the fixture instants above. */
const DAY = new Date(2026, 9, 9, 12, 0, 0, 0);

describe("CalendarView", () => {
  it("keeps the day timeline inside a width-constrained scroll panel", () => {
    const { container } = render(
      <CalendarView day={DAY} appointments={[booking()]} onEdit={vi.fn()} />,
    );

    const panel = container.firstElementChild;
    expect(panel).toHaveClass("min-w-0", "max-w-full", "overflow-auto");
    expect(panel?.firstElementChild).toHaveStyle({ minWidth: "208px" });
  });

  it("shows one date timeline without staff headers or names", () => {
    const { container } = render(
      <CalendarView
        day={DAY}
        appointments={[booking(), booking({ id: "unassigned", staffId: null })]}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.queryByText("Stella Stylist")).not.toBeInTheDocument();
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-day]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-appointment]")).toHaveLength(2);
    expect(
      within(container.querySelector("[data-day]") as HTMLElement).getAllByText("Signature cut"),
    ).toHaveLength(2);
  });

  it("draws the block at the height the geometry says, from its own times", () => {
    const { container } = render(
      <CalendarView
        day={DAY}
        // 09:00–10:00 local, one hour → HOUR_HEIGHT tall.
        appointments={[booking()]}
        onEdit={vi.fn()}
      />,
    );

    const block = container.querySelector('[data-day="2026-10-09"] button');
    expect(block).toHaveStyle({ height: `${HOUR_HEIGHT}px` });
  });

  it("draws the day grid even when nothing is booked", () => {
    const { container } = render(<CalendarView day={DAY} appointments={[]} onEdit={vi.fn()} />);

    // The frame *is* the day's opening hours, so a quiet day keeps its columns and
    // its gutter instead of being replaced by a card that hides where the free time is.
    expect(container.querySelector('[data-day="2026-10-09"]')).not.toBeNull();
    expect(screen.getByText("08:00")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-appointment]")).toHaveLength(0);
    expect(screen.queryByText("Nothing booked that day")).not.toBeInTheDocument();
  });

  it("opens the editor through onEdit when a block is clicked", async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(<CalendarView day={DAY} appointments={[booking()]} onEdit={onEdit} />);

    await user.click(screen.getByRole("button", { name: /Mina Customer, Scheduled/ }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("keeps blocks inert for a read-only salon", () => {
    render(<CalendarView day={DAY} appointments={[booking()]} isReadOnly onEdit={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Mina Customer/ })).toBeDisabled();
  });

  it("shows a loading skeleton while pending", () => {
    const { container } = render(
      <CalendarView day={DAY} appointments={[]} isPending onEdit={vi.fn()} />,
    );

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText("Mina Customer")).not.toBeInTheDocument();
    // A grid before the read lands would publish staff columns nobody has confirmed.
    expect(container.querySelectorAll("[data-column]")).toHaveLength(0);
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
  /** A 10:00 salon-time booking, independent of the test host timezone. */
  const dragged = booking({
    id: "appt-drag",
    // 10:00 salon time (Asia/Singapore = UTC+8): 02:00 UTC.
    startsAt: "2026-10-09T02:00:00.000Z",
    endsAt: "2026-10-09T03:00:00.000Z",
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
        onEdit={vi.fn()}
        onReschedule={onReschedule}
      />,
    );

    const block = container.querySelector('[data-day="2026-10-09"] button');
    const track = container.querySelector('[data-day="2026-10-09"]');
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

  it("ignores same-slot and unknown-record drops", () => {
    const onReschedule = vi.fn();
    const { container } = render(
      <CalendarView
        day={DAY}
        appointments={[dragged]}
        onEdit={vi.fn()}
        onReschedule={onReschedule}
      />,
    );
    const track = container.querySelector("[data-day]") as HTMLElement;
    stubTrackTop(track, 0);
    const transfer = dataTransfer();
    transfer.setData("text/plain", dragged.id);
    drop(track, 2 * HOUR_HEIGHT, transfer);
    transfer.setData("text/plain", "unknown");
    drop(track, 3 * HOUR_HEIGHT, transfer);
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("does not reschedule for a read-only salon", () => {
    const onReschedule = vi.fn();
    const { container } = render(
      <CalendarView
        day={DAY}
        appointments={[dragged]}
        isReadOnly
        onEdit={vi.fn()}
        onReschedule={onReschedule}
      />,
    );

    const track = container.querySelector('[data-day="2026-10-09"]');
    const transfer = dataTransfer();
    transfer.setData("text/plain", "appt-drag");
    drop(track as HTMLElement, 5 * HOUR_HEIGHT, transfer);

    expect(onReschedule).not.toHaveBeenCalled();
  });
});
