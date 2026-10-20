import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import { expect, it, vi } from "vitest";

const { create, cancelSeries } = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({}),
  cancelSeries: vi.fn().mockResolvedValue({ cancelled: 2 }),
}));
vi.mock("@/hooks/useAppointments", () => ({
  useCreateAppointment: () => ({ mutateAsync: create, isPending: false }),
  useUpdateAppointment: () => ({ isPending: false }),
  useCancelAppointmentSeries: () => ({ mutateAsync: cancelSeries, isPending: false }),
}));
vi.mock("@/hooks/useCustomers", () => ({
  useCustomerList: () => ({ data: { data: [] }, isPending: false }),
}));
vi.mock("@/hooks/useServices", () => ({
  useServiceList: () => ({
    data: {
      data: [
        { id: "hair", name: "Cut", departmentId: "hair", durationMinutes: 30 },
        { id: "nails", name: "Manicure", departmentId: "nails", durationMinutes: 45 },
      ],
    },
    isPending: false,
  }),
}));
vi.mock("@/hooks/useStaff", () => ({
  useStaffList: () => {
    const sam = { id: "a", name: "Sam", email: "a@example.test", departments: [{ id: "hair" }] };
    return {
      data: {
        data: [
          sam,
          sam,
          { ...sam, id: "b", email: "b@example.test" },
          { ...sam, id: "nails", email: "nails@example.test", departments: [{ id: "nails" }] },
        ],
      },
      isPending: false,
    };
  },
}));

import AppointmentFormDrawer from "./AppointmentFormDrawer";
import { subscribeToToasts, type ToastMessage } from "@/components/ui/toast-store";

// The drawer's edit path also renders the secure-link buttons, which read the
// signed-in salon. They are not what this file is about, and stubbing them keeps
// the form under test rather than an auth provider.
vi.mock("@/components/ui/SecureLinkActions", () => ({ default: () => null }));

/** Every toast raised while `fn` runs, so a report can be asserted as the desk sees it. */
async function toastWhile(fn: () => Promise<void>): Promise<ToastMessage[]> {
  const toasts: ToastMessage[] = [];
  const unsubscribe = subscribeToToasts((toast) => toasts.push(toast));
  try {
    await fn();
  } finally {
    unsubscribe();
  }
  return toasts;
}

/** The detail the drawer edits: one occurrence of a fortnightly series. */
const SERIES_OCCURRENCE = {
  id: "appointment-1",
  startsAt: "2030-03-06T18:00:00.000Z",
  endsAt: "2030-03-06T18:30:00.000Z",
  status: "SCHEDULED" as const,
  durationMinutes: 30,
  comment: null,
  customerId: null,
  customerName: null,
  staffId: "b",
  staffName: "Sam",
  serviceId: "hair",
  serviceName: "Cut",
  serviceDepartmentId: "hair",
  services: [
    {
      serviceId: "hair",
      serviceName: "Cut",
      serviceDepartmentId: "hair",
      staffId: "b",
      staffName: "Sam",
      // The room the booking holds (phase D). Read-only on the form: the server
      // picks a free one on every write.
      resourceId: "room-1",
      resourceName: "Room 1",
      startsAt: "2030-03-06T18:00:00.000Z",
      endsAt: "2030-03-06T18:30:00.000Z",
      durationMinutes: 30,
    },
  ],
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
  finishedAt: null,
  customerConfirmedAt: null,
  series: { id: "series-1", intervalWeeks: 2, occurrences: 6, index: 2 },
};

/** A refusal shaped exactly as `middleware/errorHandler.ts` writes one. */
function refusal(details: { path: string; message: string }[], code: string): AxiosError {
  const response: AxiosResponse = {
    data: { statusCode: 400, message: "Bad Request", code, details },
    status: 400,
    statusText: "Bad Request",
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  return new AxiosError("Bad Request", "ERR_BAD_REQUEST", response.config, undefined, response);
}

it("offers distinct eligible performer identities and submits the selected account ID", async () => {
  const user = userEvent.setup();
  render(
    <AppointmentFormDrawer
      open
      appointment={null}
      defaultStartsAt="2026-10-20T10:00:00Z"
      onClose={vi.fn()}
    />,
  );
  await user.selectOptions(screen.getByRole("combobox", { name: "Service" }), "hair");
  const picker = screen.getByRole("combobox", { name: "Performer" });
  expect(within(picker).getAllByRole("option", { name: "Sam (a@example.test)" })).toHaveLength(1);
  expect(within(picker).queryByRole("option", { name: /nails@example/ })).not.toBeInTheDocument();
  await user.selectOptions(picker, "b");
  await user.click(screen.getByRole("button", { name: "Book appointment" }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ services: [{ serviceId: "hair", staffId: "b" }] }),
    ),
  );
});

it("adds a second service as a line and submits the chain in order", async () => {
  const user = userEvent.setup();
  render(
    <AppointmentFormDrawer
      open
      appointment={null}
      defaultStartsAt="2026-10-20T10:00:00Z"
      onClose={vi.fn()}
    />,
  );

  await user.selectOptions(screen.getByRole("combobox", { name: "Service" }), "hair");
  await user.selectOptions(screen.getByRole("combobox", { name: "Performer" }), "b");
  await user.click(screen.getByRole("button", { name: "Add service" }));

  await user.selectOptions(screen.getByRole("combobox", { name: "Service 2" }), "nails");
  const second = screen.getByRole("combobox", { name: "Performer 2" });
  // The second line's performers follow the *second* service's branch, so the
  // hair stylist is not offered for the manicure.
  expect(within(second).queryByRole("option", { name: /a@example/ })).not.toBeInTheDocument();
  await user.selectOptions(second, "nails");

  expect(screen.getByText(/2 services · 75 minutes/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Book appointment" }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        services: [
          { serviceId: "hair", staffId: "b" },
          { serviceId: "nails", staffId: "nails" },
        ],
      }),
    ),
  );
});

it("puts a refused performer on the Performer field instead of the banner", async () => {
  const user = userEvent.setup();
  const message = "That staff member is not in the service's department.";
  create.mockRejectedValueOnce(refusal([{ path: "staffId", message }], "STAFF_NOT_IN_DEPARTMENT"));

  render(
    <AppointmentFormDrawer
      open
      appointment={null}
      defaultStartsAt="2026-10-20T10:00:00Z"
      onClose={vi.fn()}
    />,
  );

  await user.selectOptions(screen.getByRole("combobox", { name: "Service" }), "hair");
  await user.click(screen.getByRole("button", { name: "Book appointment" }));

  // The server names `staffId`, and the drawer marks that control — the refusal
  // is about the performer, so it must not read as a failure of the whole form.
  await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
  const performer = screen.getByRole("combobox", { name: "Performer" });
  const describedBy = performer.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  expect(document.getElementById(describedBy ?? "")?.textContent).toBe(message);
  // One copy: a banner would repeat the same sentence above the form.
  expect(screen.getAllByText(message)).toHaveLength(1);
});

it("asks for a repeat and submits the step and the count", async () => {
  const user = userEvent.setup();
  create.mockResolvedValueOnce({
    data: {},
    series: { id: "series-1", intervalWeeks: 2, occurrences: 3, created: 3, skipped: [] },
  });

  render(
    <AppointmentFormDrawer
      open
      appointment={null}
      defaultStartsAt="2030-03-06T18:00:00Z"
      onClose={vi.fn()}
    />,
  );

  await user.selectOptions(screen.getByRole("combobox", { name: "Service" }), "hair");
  await user.click(screen.getByRole("checkbox", { name: "Book this more than once" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Repeat every" }), "2");
  const count = screen.getByRole("spinbutton", { name: "Number of bookings" });
  await user.clear(count);
  await user.type(count, "3");

  const toasts = await toastWhile(async () => {
    await user.click(screen.getByRole("button", { name: "Book appointment" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          services: [{ serviceId: "hair" }],
          repeat: { intervalWeeks: 2, occurrences: 3 },
        }),
      ),
    );
  });

  // The desk is told how many bookings it now has, not merely "booked".
  expect(toasts).toEqual([
    { id: expect.any(Number), kind: "success", message: "Booked 3 appointments, every 2 weeks." },
  ]);
});

it("refuses a repeat count no desk meant, without calling the API", async () => {
  const user = userEvent.setup();
  create.mockClear();

  render(
    <AppointmentFormDrawer
      open
      appointment={null}
      defaultStartsAt="2030-03-06T18:00:00Z"
      onClose={vi.fn()}
    />,
  );

  await user.selectOptions(screen.getByRole("combobox", { name: "Service" }), "hair");
  await user.click(screen.getByRole("checkbox", { name: "Book this more than once" }));
  const count = screen.getByRole("spinbutton", { name: "Number of bookings" });
  await user.clear(count);
  await user.type(count, "1");
  await user.click(screen.getByRole("button", { name: "Book appointment" }));

  expect(await screen.findByText("Repeat between 2 and 26 bookings")).toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
});

it("names the dates a series could not book instead of claiming success", async () => {
  const user = userEvent.setup();
  create.mockResolvedValueOnce({
    data: {},
    series: {
      id: "series-1",
      intervalWeeks: 1,
      occurrences: 3,
      created: 2,
      skipped: [{ startsAt: "2030-04-17T17:00:00.000Z", reason: "That time is already taken." }],
    },
  });

  render(
    <AppointmentFormDrawer
      open
      appointment={null}
      defaultStartsAt="2030-04-03T17:00:00Z"
      onClose={vi.fn()}
    />,
  );

  await user.selectOptions(screen.getByRole("combobox", { name: "Service" }), "hair");
  await user.click(screen.getByRole("checkbox", { name: "Book this more than once" }));

  const toasts = await toastWhile(async () => {
    await user.click(screen.getByRole("button", { name: "Book appointment" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
  });

  expect(toasts).toHaveLength(1);
  expect(toasts[0]?.kind).toBe("info");
  expect(toasts[0]?.message).toMatch(/Booked 2 of 3/);
  // The date the desk has to place by hand is in the sentence, not just a count.
  expect(toasts[0]?.message).toMatch(/Skipped .*2030/);
});

it("shows the occurrence's place in its series and can stop the rest of it", async () => {
  const user = userEvent.setup();
  cancelSeries.mockClear();

  render(
    <AppointmentFormDrawer
      open
      appointment={SERIES_OCCURRENCE}
      defaultStartsAt="2030-03-06T18:00:00Z"
      onClose={vi.fn()}
    />,
  );

  expect(
    screen.getByText("Part of a repeating series — every 2 weeks, booking 3 of 6."),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Cancel the rest of the series" }));

  await waitFor(() => expect(cancelSeries).toHaveBeenCalledWith("series-1"));
});

it("names the room the booking holds without offering to change it", async () => {
  render(
    <AppointmentFormDrawer
      open
      appointment={SERIES_OCCURRENCE}
      defaultStartsAt="2030-03-06T18:00:00Z"
      onClose={vi.fn()}
    />,
  );

  // A statement about the booking, not a control: the room is chosen from what is
  // free when the booking is written, so there is no room picker to find.
  expect(screen.getByText("Booked in Room 1.")).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: /room/i })).not.toBeInTheDocument();
});
