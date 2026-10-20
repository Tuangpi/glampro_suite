import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toSalonDate } from "@/lib/salon-time";

/** Read a UTC instant as salon-local wall clock (Asia/Singapore is the default salon TZ). */
function salonOf(iso: string): Date {
  return toSalonDate(new Date(iso), "Asia/Singapore")!;
}

const {
  useAppointmentList,
  useUpdateAppointment,
  useCalendarAppointments,
  useRescheduleAppointment,
  mutateAsync,
  get,
} = vi.hoisted(() => ({
  useAppointmentList: vi.fn(),
  useUpdateAppointment: vi.fn(),
  useCalendarAppointments: vi.fn(),
  useRescheduleAppointment: vi.fn(),
  mutateAsync: vi.fn(),
  get: vi.fn(),
}));
const { useCalendarStaff } = vi.hoisted(() => ({ useCalendarStaff: vi.fn() }));
const readOnly = vi.hoisted(() => ({ value: false }));

vi.mock("@/hooks/useAppointments", () => ({
  useCalendarStaff,
  useAppointmentList,
  useUpdateAppointment,
  useCalendarAppointments,
  useRescheduleAppointment,
  // The page names this ceiling in its truncation notice, so the mock has to carry the
  // module's own constant rather than a second guess at it.
  CALENDAR_PAGE_SIZE: 200,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isReadOnly: readOnly.value }) }));
vi.mock("@/lib/api", () => ({
  get,
  getErrorMessage: vi.fn(() => "Could not update appointment."),
}));
vi.mock("@/components/appointments/AppointmentFormDrawer", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Appointment form</div> : null,
}));

const { default: Appointments } = await import("@/pages/Appointments");

/** A local-time instant on the anchor day — the day grid draws the day on screen and no other. */
function dayAt(offsetDays: number, hour: number): { startsAt: string; endsAt: string } {
  const anchor = new Date();
  anchor.setDate(anchor.getDate() + offsetDays);
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), hour, 0, 0, 0);
  const end = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate(),
    hour + 1,
    0,
    0,
    0,
  );
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

/** One page, as the list hook returns it. */
function listPage(rows: unknown[], total = rows.length) {
  return {
    data: { data: rows, total, page: 1, pageSize: 20, pageCount: 1 },
    isPending: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  };
}

/** One page, as a calendar window hook returns it (`pageSize` is the calendar's ceiling). */
function calendarPage(rows: unknown[], total = rows.length) {
  return {
    data: { data: rows, total, page: 1, pageSize: 200, pageCount: 1 },
    isPending: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  };
}

/**
 * The calendar windows the page is reading *on the render now on screen*. The page asks for
 * three (day, week, month) every render and enables exactly one, so this both names the live
 * view and proves the other two stay dormant — and it looks at the latest three calls rather
 * than every call ever made, which would count the views already stepped away from.
 */
function enabledWindows(): { from: string; to: string }[] {
  const latest = useCalendarAppointments.mock.calls.slice(-3) as [
    { from: string; to: string },
    boolean,
  ][];
  return latest.filter(([, enabled]) => enabled === true).map(([range]) => range);
}

const ROW = {
  id: "appointment-1",
  startsAt: "2026-10-09T09:00:00.000Z",
  endsAt: "2026-10-09T10:00:00.000Z",
  durationMinutes: 60,
  status: "SCHEDULED",
  customerId: "customer-1",
  customerName: "Mina Customer",
  staffId: "staff-1",
  staffName: "Stella Stylist",
  serviceId: "service-1",
  serviceName: "Signature cut",
  services: [],
  comment: null,
  finishedAt: null,
};

beforeEach(() => {
  readOnly.value = false;
  mutateAsync.mockReset().mockResolvedValue({});
  get.mockReset().mockResolvedValue(ROW);
  useAppointmentList.mockReturnValue(listPage([ROW]));
  useUpdateAppointment.mockReturnValue({ mutateAsync, isPending: false });
  useRescheduleAppointment.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useCalendarAppointments.mockReturnValue(calendarPage([ROW]));
  useCalendarStaff.mockReturnValue({
    data: { data: [{ id: "staff-1", name: "Stella Stylist", position: "Stylist" }], total: 1 },
    isPending: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  });
});

describe("Appointments", () => {
  it("queries the browser day and renders the real booking", () => {
    render(<Appointments />);

    const filters = useAppointmentList.mock.calls[0]?.[0] as { from: string; to: string };
    const from = salonOf(filters.from);
    const to = salonOf(filters.to);
    expect(from.getHours()).toBe(0);
    expect(to.getHours()).toBe(23);
    expect(to.getMinutes()).toBe(59);
    expect(screen.getByText("Mina Customer")).toBeInTheDocument();
    expect(screen.getByText("Signature cut")).toBeInTheDocument();
    expect(screen.getByText("Stella Stylist")).toBeInTheDocument();
  });

  it("completes a booking through the update contract", async () => {
    const user = userEvent.setup();
    render(<Appointments />);
    await user.click(screen.getByRole("button", { name: "Complete" }));
    expect(mutateAsync).toHaveBeenCalledWith({
      id: "appointment-1",
      input: { status: "COMPLETED" },
    });
  });

  it("opens the create drawer and disables writes for a suspended salon", async () => {
    readOnly.value = true;
    const user = userEvent.setup();
    render(<Appointments />);

    expect(screen.getByRole("button", { name: "Book appointment" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Complete" })).toBeDisabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    readOnly.value = false;
    render(<Appointments />);
    const enabled = screen.getAllByRole("button", { name: "Book appointment" }).at(-1);
    if (!enabled) throw new Error("Expected an enabled booking button.");
    await user.click(enabled);
    expect(screen.getByRole("dialog")).toHaveTextContent("Appointment form");
  });

  it("switches to the day grid and reads the whole day only when shown", async () => {
    // The grid is date-aware: it draws the day on screen, so the fixture has to be on it.
    useCalendarAppointments.mockReturnValue(calendarPage([{ ...ROW, ...dayAt(0, 9) }]));

    const user = userEvent.setup();
    render(<Appointments />);

    // On the list view the grid's whole-day read and the roster stay dormant,
    // so opening /appointments does not pay for a view nobody asked for.
    expect(enabledWindows()).toHaveLength(0);
    expect(useCalendarStaff.mock.calls.at(-1)?.[0]).toBe(false);

    await user.click(screen.getByRole("button", { name: "Day" }));

    // The grid is now live — the only one of the three windows — and it draws the
    // roster's columns: "Unassigned" is a column head only the grid has, never the list.
    expect(enabledWindows()).toHaveLength(1);
    expect(useCalendarStaff.mock.calls.at(-1)?.[0]).toBe(true);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByText("Mina Customer")).toBeInTheDocument();
  });

  it("asks each view for its own window, and a switch never moves the anchor", async () => {
    const user = userEvent.setup();
    render(<Appointments />);

    // The list reads no calendar window at all: three calls, none of them live.
    expect(enabledWindows()).toHaveLength(0);
    const listWindow = useAppointmentList.mock.calls[0]?.[0] as { from: string; to: string };

    await user.click(screen.getByRole("button", { name: "Day" }));
    expect(enabledWindows()).toHaveLength(1);
    // One day: midnight to the last minute of the same date.
    const day = enabledWindows()[0];
    expect(salonOf(day!.from).getHours()).toBe(0);
    expect(salonOf(day!.to).getHours()).toBe(23);
    expect(salonOf(day!.to).getMinutes()).toBe(59);
    expect(salonOf(day!.from).toDateString()).toBe(salonOf(day!.to).toDateString());
    // The same edges the list read, because the switch moved nothing.
    expect(day).toEqual({ from: listWindow.from, to: listWindow.to });

    await user.click(screen.getByRole("button", { name: "Week" }));
    expect(enabledWindows()).toHaveLength(1);
    // Seven days, Monday midnight to a Sunday's last minute (ADR 0018: the week is
    // Monday-first, the same first day the month grid pads to).
    const weekFrom = salonOf(enabledWindows()[0]!.from);
    const weekTo = salonOf(enabledWindows()[0]!.to);
    expect(weekFrom.getDay()).toBe(1);
    expect(weekFrom.getHours()).toBe(0);
    expect(weekTo.getDay()).toBe(0);
    expect(weekTo.getHours()).toBe(23);
    expect(Math.round((Number(weekTo) - Number(weekFrom) + 1) / 86_400_000)).toBe(7);
    // The day on screen is inside the week being read, whatever day of the week it is.
    expect(Number(weekFrom) <= Date.now() && Date.now() <= Number(weekTo)).toBe(true);
    // Week staff columns need the complete roster, just like the day grid.
    expect(useCalendarStaff.mock.calls.at(-1)?.[0]).toBe(true);

    await user.click(screen.getByRole("button", { name: "Month" }));
    expect(enabledWindows()).toHaveLength(1);
    // The calendar month alone: the 1st at midnight to the last day's last minute.
    const monthFrom = salonOf(enabledWindows()[0]!.from);
    const monthTo = salonOf(enabledWindows()[0]!.to);
    expect(monthFrom.getDate()).toBe(1);
    expect(monthFrom.getHours()).toBe(0);
    expect(monthTo.getMonth()).toBe(monthFrom.getMonth());
    expect(monthTo.getDate()).toBe(
      new Date(monthFrom.getFullYear(), monthFrom.getMonth() + 1, 0).getDate(),
    );
    expect(monthTo.getHours()).toBe(23);
    expect(useCalendarStaff.mock.calls.at(-1)?.[0]).toBe(false);

    // And the day grid still asks for the same anchor day: nothing on the way moved it.
    await user.click(screen.getByRole("button", { name: "Day" }));
    expect(enabledWindows()[0]).toEqual(day);
  });

  it("steps the unit on screen — a day, a week, a month — never the day behind it", async () => {
    const user = userEvent.setup();
    render(<Appointments />);

    await user.click(screen.getByRole("button", { name: "Week" }));
    const weekBefore = new Date(enabledWindows()[0]!.from);
    await user.click(screen.getByRole("button", { name: "Next week" }));
    const weekAfter = salonOf(enabledWindows()[0]!.from);
    // Seven days, not one — and still a Monday.
    expect(Math.round((Number(weekAfter) - Number(weekBefore)) / 86_400_000)).toBe(7);
    expect(weekAfter.getDay()).toBe(1);

    await user.click(screen.getByRole("button", { name: "Month" }));
    const monthBefore = salonOf(enabledWindows()[0]!.from);
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    const monthAfter = salonOf(enabledWindows()[0]!.from);
    expect(monthAfter.getDate()).toBe(1);
    expect(monthAfter.getMonth()).toBe((monthBefore.getMonth() + 11) % 12);
  });

  it("draws only the anchor day's rows, never another day's", async () => {
    // The window's own row, on tomorrow — and the grid is drawing today. ADR 0018,
    // decision 2: a booking belongs to the day it starts on, and a block on a day the grid
    // is not showing would be a booking the desk cannot account for.
    const future = { ...ROW, ...dayAt(1, 9) };
    useAppointmentList.mockReturnValue(listPage([future]));
    useCalendarAppointments.mockReturnValue(calendarPage([future]));

    const user = userEvent.setup();
    render(<Appointments />);

    // The list draws what the window returned, whatever day it is on.
    expect(screen.getByText("Mina Customer")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Day" }));

    // The grid is drawn — its roster column heads are there — but the block is not.
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.queryByText("Mina Customer")).not.toBeInTheDocument();
  });

  it("says out loud when a window holds more than one page, and says which one", async () => {
    // Three pages of a month: 480 bookings, 200 loaded. A calendar drawn from one page has
    // holes in it, and a hole in a calendar reads as free time (ADR 0018, decision 7).
    useCalendarAppointments.mockReturnValue(calendarPage([ROW], 480));

    const user = userEvent.setup();
    render(<Appointments />);

    // The list's own paging is visible on screen, so it discloses nothing extra.
    expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Month" }));
    expect(
      screen.getByText(/Showing the first 1 of 480 appointments this month/),
    ).toBeInTheDocument();
    expect(screen.getByText(/at most 200 at a time/)).toBeInTheDocument();

    // The disclosure names the range on screen rather than the last one looked at.
    await user.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getByText(/480 appointments this week/)).toBeInTheDocument();
  });

  it("explains week and month dragging", async () => {
    const user = userEvent.setup();
    render(<Appointments />);

    await user.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getByText(/between day and staff columns/)).toBeInTheDocument();

    // The day grid is where a booking moves, so it carries no such notice — and the list
    // never did.
    await user.click(screen.getByRole("button", { name: "Day" }));
    expect(screen.queryByText(/Read-only view/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Month" }));
    expect(screen.getByText(/keep its salon-local time and staff/)).toBeInTheDocument();
  });
});
