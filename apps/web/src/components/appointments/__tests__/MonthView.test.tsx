/**
 * The month calendar — handoff screen 06's Month toggle, drawn as a chip grid.
 *
 * A month is not a scaled day, so the assertions are about what a *cell* carries: whole
 * Monday-first weeks padded with the neighbouring months' dates as paper, up to three chips
 * with a `+N more` count, a booking in the cell of the day it starts on — and never a chip
 * in a padded cell, whose edges nobody loaded (ADR 0018, decision 6). The view is read-only,
 * so a chip is a link to the drawer and nothing else.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AppointmentSummary } from "@glampro_suite/shared";

import MonthView from "../MonthView";

/** Local-time helper: chips read local times, so the fixtures must too. */
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

/**
 * 9 October 2026 is a Friday and the 1st is a Thursday, so the month's grid runs from
 * Monday 28 September to Sunday 1 November: 35 cells, 4 of them paper.
 */
const MONTH = at(9, 12);

describe("MonthView", () => {
  it("draws whole Monday-first weeks, with the neighbouring months as paper", () => {
    const { container } = render(
      <MonthView day={MONTH} appointments={[booking()]} onEdit={vi.fn()} />,
    );

    expect(container.querySelectorAll("[data-day]")).toHaveLength(35);
    expect(container.querySelector('[data-day="2026-09-28"]')).toHaveAttribute(
      "data-outside",
      "true",
    );
    expect(container.querySelector('[data-day="2026-11-01"]')).toHaveAttribute(
      "data-outside",
      "true",
    );
    // The month's own edges are not paper, and exactly four cells are.
    expect(container.querySelector('[data-day="2026-10-01"]')).not.toHaveAttribute("data-outside");
    expect(container.querySelector('[data-day="2026-10-31"]')).not.toHaveAttribute("data-outside");
    expect(container.querySelectorAll('[data-outside="true"]')).toHaveLength(4);
    expect(container.querySelector('[aria-label^="Month of"]')).not.toBeNull();
  });

  it("anchors on the month a day falls in, whatever the day is", () => {
    const { container } = render(
      <MonthView day={at(31, 12)} appointments={[booking()]} onEdit={vi.fn()} />,
    );

    // The last day of the month draws the same grid as the ninth.
    expect(container.querySelectorAll("[data-day]")).toHaveLength(35);
    expect(container.querySelector('[data-day="2026-09-28"]')).not.toBeNull();
    expect(container.querySelector('[data-day="2026-11-01"]')).not.toBeNull();
  });

  it("puts a booking in the cell of the day it starts on, and in no other", () => {
    const { container } = render(
      <MonthView day={MONTH} appointments={[booking()]} onEdit={vi.fn()} />,
    );

    const ninth = container.querySelector('[data-day="2026-10-09"]') as HTMLElement;
    expect(within(ninth).getByText(/Mina Customer/)).toBeInTheDocument();
    expect(container.querySelectorAll("[data-appointment]")).toHaveLength(1);
  });

  it("counts the chips a cell cannot hold", () => {
    // Three fits; the rest is a count, because a fourth chip makes the cell a list.
    const many = Array.from({ length: 5 }, (_, index) =>
      booking({ id: `appt-${index}`, customerName: `Client ${index}` }),
    );
    const { container } = render(<MonthView day={MONTH} appointments={many} onEdit={vi.fn()} />);

    const ninth = container.querySelector('[data-day="2026-10-09"]') as HTMLElement;
    expect(ninth.querySelectorAll("[data-appointment]")).toHaveLength(3);
    expect(within(ninth).getByText("+2 more")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-appointment]")).toHaveLength(3);
  });

  it("draws a booking under the day it starts on even when it runs past midnight", () => {
    // The straddle rule is the week's problem (it would need two columns); a chip is a
    // start time and a name, so the day it starts on is the whole answer.
    const overnight = booking({
      id: "appt-overnight",
      // 23:00–01:00 salon time (Asia/Singapore = UTC+8): starts 15:00 UTC Oct 9, ends 17:00 UTC Oct 9.
      startsAt: "2026-10-09T15:00:00.000Z",
      endsAt: "2026-10-09T17:00:00.000Z",
    });
    const { container } = render(
      <MonthView day={MONTH} appointments={[overnight]} onEdit={vi.fn()} />,
    );

    const ninth = container.querySelector('[data-day="2026-10-09"]') as HTMLElement;
    expect(ninth.querySelectorAll("[data-appointment]")).toHaveLength(1);
    expect(container.querySelector('[data-day="2026-10-10"]')).not.toBeNull();
  });

  it("never puts a chip in a padded cell, even when a row belongs to that date", () => {
    // The month's read cannot contain 30 September — it starts before the window — so this
    // row is a caller's mistake. The grid must still refuse to draw it: a chip in paper is
    // a booking from a day whose edges were never fetched (ADR 0018, decision 6).
    const september = booking({
      id: "appt-september",
      startsAt: new Date(2026, 8, 30, 10, 0, 0, 0).toISOString(),
      endsAt: new Date(2026, 8, 30, 11, 0, 0, 0).toISOString(),
    });
    const { container } = render(
      <MonthView day={MONTH} appointments={[september]} onEdit={vi.fn()} />,
    );

    const paper = container.querySelector('[data-day="2026-09-30"]') as HTMLElement;
    expect(paper.querySelectorAll("[data-appointment]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-appointment]")).toHaveLength(0);
    expect(screen.queryByText(/Mina Customer/)).not.toBeInTheDocument();
  });

  it("opens the drawer when a chip is clicked", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const { container } = render(
      <MonthView day={MONTH} appointments={[booking()]} onEdit={onEdit} />,
    );

    await user.click(container.querySelector("[data-appointment]") as HTMLElement);

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "appt-1" }));
  });

  it("inerts the chips for a suspended salon", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const { container } = render(
      <MonthView day={MONTH} appointments={[booking()]} isReadOnly onEdit={onEdit} />,
    );

    const chip = container.querySelector("[data-appointment]") as HTMLElement;
    expect(chip).toBeDisabled();
    await user.click(chip);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("shows the empty state, and no grid to misread, when the month is clear", () => {
    const { container } = render(<MonthView day={MONTH} appointments={[]} onEdit={vi.fn()} />);

    expect(screen.getByText("Nothing booked that month")).toBeInTheDocument();
    // No cells at all: an empty grid would read as an empty month's worth of free days.
    expect(container.querySelectorAll("[data-day]")).toHaveLength(0);
  });

  it("draws skeletons, not an empty month, while the read is in flight", () => {
    const { container } = render(
      <MonthView day={MONTH} appointments={[]} isPending onEdit={vi.fn()} />,
    );

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText("Nothing booked that month")).not.toBeInTheDocument();
  });

  it("shows the API's own message and a retry when the month cannot be read", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <MonthView
        day={MONTH}
        appointments={[]}
        isError
        errorMessage="These bookings are unavailable."
        onRetry={onRetry}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByText("The month could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("These bookings are unavailable.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
