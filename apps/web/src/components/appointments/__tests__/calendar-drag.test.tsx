import { createEvent, fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppointmentSummary } from "@glampro_suite/shared";
import CalendarView from "../CalendarView";
import WeekView from "../WeekView";
import MonthView from "../MonthView";
import {
  bookingsOnDays,
  monthRescheduleFields,
  weekWindow,
  monthWindow,
} from "../calendar-geometry";

const booking: AppointmentSummary = {
  id: "booking",
  startsAt: "2026-10-09T01:00:00.000Z",
  endsAt: "2026-10-09T02:00:00.000Z",
  durationMinutes: 60,
  status: "SCHEDULED",
  comment: null,
  customerId: null,
  customerName: "Client",
  staffId: "staff-a",
  staffName: "Anna",
  serviceId: "service",
  serviceName: "Cut",
  serviceDepartmentId: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};
const columns = [
  { id: "staff-a", name: "Anna" },
  { id: "staff-b", name: "Bea" },
  { id: null, name: "Unassigned" },
];
const day = new Date("2026-10-09T04:00:00.000Z");
const transfer = (id = booking.id) => ({
  getData: () => id,
  setData: vi.fn(),
  effectAllowed: "move",
});
function drop(target: Element, clientY: number, id = booking.id) {
  const event = createEvent.drop(target, { dataTransfer: transfer(id) });
  Object.defineProperty(event, "clientY", { value: clientY });
  fireEvent(target, event);
}

describe("calendar dragging", () => {
  it("moves between week dates and staff using snapped salon time", () => {
    const onReschedule = vi.fn();
    const { container } = render(
      <WeekView
        day={day}
        appointments={[booking]}
        columns={columns}
        onEdit={vi.fn()}
        onReschedule={onReschedule}
      />,
    );
    const source = container.querySelector(
      '[data-day="2026-10-09"][data-column="staff-a"]',
    ) as HTMLElement;
    expect(within(source).getByRole("button")).toHaveAttribute("draggable", "true");
    const target = container.querySelector('[data-day="2026-10-10"][data-column="staff-b"]')!;
    drop(target, 144);
    expect(onReschedule).toHaveBeenCalledWith(booking.id, {
      startsAt: "2026-10-10T02:00:00.000Z",
      staffId: "staff-b",
    });
  });

  it("ignores unknown dragged records and same-slot week drops", () => {
    const onReschedule = vi.fn();
    const { container } = render(
      <WeekView
        day={day}
        appointments={[booking]}
        columns={columns}
        onEdit={vi.fn()}
        onReschedule={onReschedule}
      />,
    );
    const target = container.querySelector('[data-day="2026-10-09"][data-column="staff-a"]')!;
    drop(target, 72, "foreign");
    drop(target, 72);
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("moves month dates without changing time or staff, and ignores same-day/padding drops", () => {
    const onReschedule = vi.fn();
    const { container } = render(
      <MonthView day={day} appointments={[booking]} onEdit={vi.fn()} onReschedule={onReschedule} />,
    );
    expect(container.querySelector("[data-appointment]")).toHaveAttribute("draggable", "true");
    fireEvent.drop(container.querySelector('[data-day="2026-10-10"]')!, {
      dataTransfer: transfer(),
    });
    expect(onReschedule).toHaveBeenCalledWith(booking.id, { startsAt: "2026-10-10T01:00:00.000Z" });
    onReschedule.mockClear();
    fireEvent.drop(container.querySelector('[data-day="2026-10-09"]')!, {
      dataTransfer: transfer(),
    });
    fireEvent.drop(container.querySelector('[data-outside="true"]')!, { dataTransfer: transfer() });
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("disables week and month dragging for a suspended salon", () => {
    const onReschedule = vi.fn();
    const { container } = render(
      <>
        <WeekView
          day={day}
          appointments={[booking]}
          columns={columns}
          onEdit={vi.fn()}
          onReschedule={onReschedule}
          isReadOnly
        />
        <MonthView
          day={day}
          appointments={[booking]}
          onEdit={vi.fn()}
          onReschedule={onReschedule}
          isReadOnly
        />
      </>,
    );
    for (const block of container.querySelectorAll("[data-appointment]"))
      expect(block).toHaveAttribute("draggable", "false");
    for (const target of container.querySelectorAll('[data-day="2026-10-10"]'))
      fireEvent.drop(target, { dataTransfer: transfer(), clientY: 72 });
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("expands month overflow so every loaded booking can be opened or dragged", () => {
    const appointments = Array.from({ length: 5 }, (_, index) => ({
      ...booking,
      id: `booking-${index}`,
    }));
    const { container, getByRole } = render(
      <MonthView day={day} appointments={appointments} onEdit={vi.fn()} onReschedule={vi.fn()} />,
    );
    expect(container.querySelectorAll("[data-appointment]")).toHaveLength(3);
    fireEvent.click(getByRole("button", { name: "+2 more" }));
    expect(container.querySelectorAll("[data-appointment]")).toHaveLength(5);
  });

  it("draws overnight occupancy on both visible week spans and month dates", () => {
    const overnight = {
      ...booking,
      startsAt: "2026-10-09T11:00:00.000Z",
      endsAt: "2026-10-10T01:00:00.000Z",
    };
    const { container } = render(
      <WeekView day={day} appointments={[overnight]} columns={columns} onEdit={vi.fn()} />,
    );
    expect(container.querySelectorAll("[data-appointment]")).toHaveLength(2);
    const dates = [new Date(2026, 9, 9), new Date(2026, 9, 10)];
    expect(
      [...bookingsOnDays([overnight], dates, "Asia/Singapore").values()].map((rows) => rows.length),
    ).toEqual([1, 1]);
    const midnight = { ...overnight, endsAt: "2026-10-09T16:00:00.000Z" };
    expect(bookingsOnDays([midnight], dates, "Asia/Singapore").get("2026-10-10")).toEqual([]);
  });

  it("packs simultaneous unassigned day bookings into separate lanes", () => {
    const { container } = render(
      <CalendarView
        day={day}
        appointments={[
          { ...booking, staffId: null },
          { ...booking, id: "second", staffId: null },
        ]}
        columns={columns}
        onEdit={vi.fn()}
      />,
    );
    const blocks = container.querySelectorAll<HTMLElement>("[data-appointment]");
    expect(blocks[0]!.style.width).toBe("calc(50% - 4px)");
    expect(blocks[0]!.style.left).not.toBe(blocks[1]!.style.left);
  });

  it("uses the salon's week/month at an instant across local midnight", () => {
    const anchor = new Date("2026-10-31T18:00:00.000Z");
    expect(weekWindow(anchor, "Asia/Singapore").from).toBe("2026-10-25T16:00:00.000Z");
    expect(monthWindow(anchor, "Asia/Singapore").from).toBe("2026-10-31T16:00:00.000Z");
  });

  it("preserves month wall-clock time across a daylight-saving boundary", () => {
    const beforeDst = { ...booking, startsAt: "2026-03-07T17:00:00.000Z" };
    expect(monthRescheduleFields(beforeDst, new Date(2026, 2, 8), "America/Los_Angeles")).toEqual({
      startsAt: "2026-03-08T16:00:00.000Z",
    });
  });
});
