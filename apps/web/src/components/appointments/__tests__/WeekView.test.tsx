/**
 * The week calendar — handoff screen 06's Week toggle.
 *
 * Rendered with a week of rows passed in, exactly as the page does, so the assertions are
 * about what the week *draws*: seven Monday-first columns on the day grid's own scale,
 * each booking in the column of the **day it starts on** and in no other, overlapping
 * bookings side by side in lanes, and the read-only state the view is defined by
 * (ADR 0018). The straddle rule is checked by what is *absent*: a booking that crosses
 * midnight is drawn on neither of its days.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AppointmentSummary } from "@glampro_suite/shared";

import WeekView from "../WeekView";
import { HOUR_HEIGHT } from "../calendar-geometry";

/** Local-time helper: the grid reads local hours, so the fixtures must too. */
function at(day: number, hour: number, minute = 0): Date {
  return new Date(2026, 9, day, hour, minute, 0, 0);
}

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
    createdAt: at(1, 9).toISOString(),
    updatedAt: at(1, 9).toISOString(),
    ...overrides,
  };
}

/** 9 October 2026 is a Friday, so its week is Monday the 5th to Sunday the 11th. */
const WEEK = at(9, 12);

describe("WeekView", () => {
  it("draws seven Monday-first columns, and only the anchor's own week", () => {
    const { container } = render(
      <WeekView day={WEEK} appointments={[booking()]} onEdit={vi.fn()} />,
    );

    for (const date of ["05", "06", "07", "08", "09", "10", "11"]) {
      expect(container.querySelector(`[data-day="2026-10-${date}"]`)).not.toBeNull();
    }
    // The day before the Monday and the day after the Sunday are not paper here — the
    // week is exactly seven columns, unlike the month's padded grid.
    expect(container.querySelector('[data-day="2026-10-04"]')).toBeNull();
    expect(container.querySelector('[data-day="2026-10-12"]')).toBeNull();
    expect(container.querySelector('[aria-label^="Week of"]')).not.toBeNull();
  });

  it("anchors on the week a day falls in, not on the day itself", () => {
    // A Wednesday anchor draws the same Monday-first week as the Friday one.
    const { container } = render(
      <WeekView day={at(7, 12)} appointments={[booking()]} onEdit={vi.fn()} />,
    );

    expect(container.querySelector('[data-day="2026-10-05"]')).not.toBeNull();
    expect(container.querySelector('[data-day="2026-10-11"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-day]")).toHaveLength(7);
  });

  it("draws a booking in the column of the day it starts on, and nowhere else", () => {
    const { container } = render(
      <WeekView day={WEEK} appointments={[booking()]} onEdit={vi.fn()} />,
    );

    const friday = container.querySelector('[data-day="2026-10-09"]') as HTMLElement;
    expect(within(friday).getByText("Mina Customer")).toBeInTheDocument();
    // One block on the grid — not a copy in each of the seven columns.
    expect(container.querySelectorAll("[data-appointment]")).toHaveLength(1);
  });

  it("places the block by its own times on the day grid's scale", () => {
    const { container } = render(
      <WeekView day={WEEK} appointments={[booking()]} onEdit={vi.fn()} />,
    );

    // 09:00–10:00 is one hour below the 08:00 top and one hour tall.
    expect(container.querySelector("[data-appointment]")).toHaveStyle({
      top: `${HOUR_HEIGHT}px`,
      height: `${HOUR_HEIGHT}px`,
    });
  });

  it("draws a booking that crosses midnight on neither of its days", () => {
    // ADR 0018, decision 2: the gutter is 08:00–20:00, so 23:00 → 01:00 is un-drawable on
    // both. It is in the week's read — it starts inside the week — and on no day of it.
    const overnight = booking({
      id: "appt-overnight",
      startsAt: at(9, 23).toISOString(),
      endsAt: at(10, 1).toISOString(),
    });
    const { container } = render(
      <WeekView day={WEEK} appointments={[overnight]} onEdit={vi.fn()} />,
    );

    expect(container.querySelectorAll("[data-appointment]")).toHaveLength(0);
    expect(screen.queryByText("Mina Customer")).not.toBeInTheDocument();
    // The grid itself is still seven columns: the week is drawn, the block is not.
    expect(container.querySelectorAll("[data-day]")).toHaveLength(7);
  });

  it("divides a column between two bookings that start at the same time", () => {
    // The 6b rule only refuses a *new* double-booking for one performer, so two unassigned
    // 09:00 bookings are a real state — and both must stay readable.
    const { container } = render(
      <WeekView
        day={WEEK}
        appointments={[booking(), booking({ id: "appt-b", customerName: "Nadia Client" })]}
        onEdit={vi.fn()}
      />,
    );

    const friday = container.querySelector('[data-day="2026-10-09"]') as HTMLElement;
    const blocks = friday.querySelectorAll<HTMLElement>("[data-appointment]");
    expect(blocks).toHaveLength(2);
    // Lane 0 of 2 and lane 1 of 2: two different, non-empty lefts rather than one stack
    // drawn twice on top of itself.
    const lefts = [...blocks].map((block) => block.style.left);
    expect(lefts.filter((left) => left.length > 0)).toHaveLength(2);
    expect(new Set(lefts).size).toBe(2);
  });

  it("names the performer on the block, since a day column has no staff head", () => {
    render(<WeekView day={WEEK} appointments={[booking()]} onEdit={vi.fn()} />);

    expect(screen.getByText("Stella Stylist")).toBeInTheDocument();
    expect(screen.getByText("Signature cut")).toBeInTheDocument();
  });

  it("opens the drawer when a block is clicked", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const { container } = render(
      <WeekView day={WEEK} appointments={[booking()]} onEdit={onEdit} />,
    );

    const block = container.querySelector("[data-appointment]") as HTMLElement;
    await user.click(block);

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "appt-1" }));
  });

  it("never makes a block draggable — the week cannot move a booking", () => {
    const { container } = render(
      <WeekView day={WEEK} appointments={[booking()]} onEdit={vi.fn()} />,
    );

    // ADR 0018, decision 5: one gutter and one snapped slot are what make "which minute"
    // unambiguous, and the week has neither. The day grid is where a block moves.
    expect(container.querySelector("[data-appointment]")).toHaveAttribute("draggable", "false");
  });

  it("inerts the blocks for a suspended salon", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const { container } = render(
      <WeekView day={WEEK} appointments={[booking()]} isReadOnly onEdit={onEdit} />,
    );

    const block = container.querySelector("[data-appointment]") as HTMLElement;
    expect(block).toBeDisabled();
    await user.click(block);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("shows the empty state when the week has nothing booked", () => {
    render(<WeekView day={WEEK} appointments={[]} onEdit={vi.fn()} />);

    expect(screen.getByText("Nothing booked that week")).toBeInTheDocument();
  });

  it("draws skeletons, not an empty week, while the read is in flight", () => {
    const { container } = render(
      <WeekView day={WEEK} appointments={[]} isPending onEdit={vi.fn()} />,
    );

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText("Nothing booked that week")).not.toBeInTheDocument();
  });

  it("shows the API's own message and a retry when the week cannot be read", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <WeekView
        day={WEEK}
        appointments={[]}
        isError
        errorMessage="These bookings are unavailable."
        onRetry={onRetry}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByText("The week could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("These bookings are unavailable.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
