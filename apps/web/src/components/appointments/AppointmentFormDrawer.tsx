/**
 * Book or edit an appointment — the form half of handoff screens 03/06.
 *
 * Three inputs are decided **here** rather than by the person filling the form
 * (`docs/mvp.md` → M2):
 *
 * 1. *Duration* comes from each service — the form shows the end time the server
 *    will compute (the summed `Service.durationMinutes` of the chain, starting
 *    at the chosen instant) but posts neither it nor the durations, so a
 *    two-hour block cannot be put on a one-hour service.
 * 2. *Who may perform a line* is filtered to **that line's** service department
 *    (`User.departments` ∩ `Service.departmentId`), the booking twin of M1's
 *    till picker — and the API refuses the rest anyway (ADR 0013).
 * 3. *The end time* on screen is a **preview**: the receipt of truth is the
 *    `endsAt` the create/update response returns.
 *
 * A booking is a chain of service lines (TK2610-0020 phase B): the rows are
 * submitted in order, line 1 starting where line 0 ends. A single row is the
 * single-service booking the salon mostly takes, and it is what the drawer opens
 * with.
 *
 * A **new** booking can also repeat (phase C): the desk picks a step and a count,
 * and the API writes the whole series in one request. The answer reports what it
 * managed, so a date that was already taken is named in the toast instead of
 * quietly missing from the book. Editing one occurrence edits that booking alone —
 * a series is a creation-time rule — while "Cancel the rest of the series" stops
 * the future ones.
 *
 * The three lists (services, customers, staff) are read once per open with a
 * large page rather than searched: a day-desk form picks from the salon's
 * whole book, and a second search box per select would be three requests a
 * screen the handoff drew as dropdowns does not need.
 */
import { useMemo, useState } from "react";
import SecureLinkActions from "@/components/ui/SecureLinkActions";

import type { AppointmentDetail, StaffSummary } from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import Drawer from "@/components/ui/Drawer";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { showToast } from "@/components/ui/toast-store";
import { useCustomerList } from "@/hooks/useCustomers";
import {
  useCreateAppointment,
  useUpdateAppointment,
  useCancelAppointmentSeries,
} from "@/hooks/useAppointments";
import { useServiceList } from "@/hooks/useServices";
import { useStaffList } from "@/hooks/useStaff";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { getErrorMessage, getValidationDetails } from "@/lib/api";
import { instantFromSalonDate, toSalonDate } from "@/lib/salon-time";
import { performerOptions } from "@/lib/performer-options";

const LIST_PAGE_SIZE = 200;

/** One service on the form, with the performer chosen for it. */
interface ServiceLineForm {
  serviceId: string;
  staffId: string;
}

interface FormState {
  /** Ordered chain of services; index 0 is the booking's primary service. */
  services: ServiceLineForm[];
  customerId: string;
  /** `datetime-local` value: `YYYY-MM-DDTHH:mm` in the salon's timezone. */
  startsAt: string;
  comment: string;
  /** Repeat this booking (creation only — an existing booking is edited alone). */
  repeat: boolean;
  /** Weeks between occurrences, as the select's string value. */
  intervalWeeks: string;
  /** Total bookings, this one included, as the number input's string value. */
  occurrences: string;
}

/** The empty booking: one blank service line, no customer, the moment it opened. */
function emptyForm(defaultStartsAt: string): FormState {
  return {
    services: [{ serviceId: "", staffId: "" }],
    customerId: "",
    startsAt: defaultStartsAt,
    comment: "",
    repeat: false,
    intervalWeeks: "1",
    // Four is the fortnightly-regular shape the salon mostly sells, and it keeps
    // an accidental tick from writing a year of bookings.
    occurrences: "4",
  };
}

/** "every week" / "every 2 weeks" — the phrase both the toast and the note use. */
function repeatLabel(intervalWeeks: number): string {
  return intervalWeeks === 1 ? "every week" : `every ${intervalWeeks} weeks`;
}

/**
 * The booking's own chain, or the single service it implies.
 *
 * A row written before service lines existed has no lines and no chain to show,
 * so it falls back to the flat columns — the same rule the API applies when it
 * reads one.
 */
function formFromAppointment(appointment: AppointmentDetail, timeZone: string): FormState {
  const services =
    appointment.services.length > 0
      ? appointment.services.map((line) => ({
          serviceId: line.serviceId,
          staffId: line.staffId ?? "",
        }))
      : [{ serviceId: appointment.serviceId ?? "", staffId: appointment.staffId ?? "" }];

  return {
    services,
    customerId: appointment.customerId ?? "",
    startsAt: toSalonInputValue(appointment.startsAt, timeZone),
    comment: appointment.comment ?? "",
    // A series is not edited from one occurrence, so these stay at "off".
    repeat: false,
    intervalWeeks: "1",
    occurrences: "4",
  };
}

/** ISO instant → the salon-local value `<input type="datetime-local">` reads and writes. */
function toSalonInputValue(iso: string, timeZone: string): string {
  const salon = toSalonDate(iso, timeZone);
  if (!salon) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${salon.getFullYear()}-${pad(salon.getMonth() + 1)}-${pad(salon.getDate())}T${pad(
    salon.getHours(),
  )}:${pad(salon.getMinutes())}`;
}

/** Salon-local `YYYY-MM-DDTHH:mm` input → the real instant the API expects. */
function toSalonInstant(value: string, timeZone: string): Date | null {
  // A `datetime-local` string carries no zone, so `new Date` reads its fields as
  // local — those fields *are* the salon wall clock the user typed. `instantFromSalonDate`
  // turns that salon wall clock back into the UTC instant to post.
  const start = new Date(value);
  if (Number.isNaN(start.getTime())) return null;
  return instantFromSalonDate(start, timeZone);
}

export interface AppointmentFormDrawerProps {
  open: boolean;
  /** `null` creates; a booking edits. */
  appointment: AppointmentDetail | null;
  /** Where a *new* booking starts — the day the list is showing, or now. */
  defaultStartsAt: string;
  onClose: () => void;
}

export default function AppointmentFormDrawer({
  open,
  appointment,
  defaultStartsAt,
  onClose,
}: AppointmentFormDrawerProps) {
  // Seeded once at mount; the page keys this component on record + open state,
  // so a cancelled edit cannot leak into the next one without an effect that
  // would render the form twice on every open.
  const { timeZone, formatDateTime } = useSalonFormatting();

  // Seeded once at mount; the page keys this component on record + open state,
  // so a cancelled edit cannot leak into the next one without an effect that
  // would render the form twice on every open.
  const [form, setForm] = useState<FormState>(() =>
    appointment
      ? formFromAppointment(appointment, timeZone)
      : emptyForm(toSalonInputValue(defaultStartsAt, timeZone)),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const services = useServiceList({ page: 1, pageSize: LIST_PAGE_SIZE, status: "ACTIVE" });
  const customers = useCustomerList({ page: 1, pageSize: LIST_PAGE_SIZE });
  const staff = useStaffList({ page: 1, pageSize: LIST_PAGE_SIZE, status: "active" });
  const createAppointment = useCreateAppointment();
  const updateAppointment = useUpdateAppointment();
  const cancelSeries = useCancelAppointmentSeries();
  const isSaving = createAppointment.isPending || updateAppointment.isPending;
  const isEditing = appointment !== null;

  const serviceRows = useMemo(() => services.data?.data ?? [], [services.data]);
  const customerRows = useMemo(() => customers.data?.data ?? [], [customers.data]);
  const staffRows = useMemo(() => staff.data?.data ?? [], [staff.data]);

  /**
   * The eligible performers for one line: everyone when the salon has not tied
   * that line's service to a branch, otherwise the staff whose branches include
   * it. A convenience over ADR 0013 — the API refuses the rest regardless.
   */
  function eligibleStaffFor(serviceId: string): StaffSummary[] {
    const service = serviceRows.find((entry) => entry.id === serviceId);
    if (!service || service.departmentId === null) return staffRows;
    return staffRows.filter((person) =>
      person.departments.some((link) => link.id === service.departmentId),
    );
  }

  /** The end time the server will compute — shown, never posted. */
  const previewEndsAt = useMemo(() => {
    if (form.startsAt === "") return null;
    const start = toSalonInstant(form.startsAt, timeZone);
    if (!start) return null;

    // The chain is summed in the order it will be performed, which is the order
    // the rows are in: line 1 starts where line 0 ends and so on.
    const chosen = form.services.filter((line) => line.serviceId !== "");
    const minutes = chosen.reduce((total, line) => {
      const service = serviceRows.find((entry) => entry.id === line.serviceId);
      return total + (service?.durationMinutes ?? 60);
    }, 0);
    if (chosen.length === 0) return null;

    const endSalon = toSalonDate(new Date(start.getTime() + minutes * 60_000), timeZone);
    if (!endSalon) return null;
    const pad = (value: number) => String(value).padStart(2, "0");
    const time = `${pad(endSalon.getHours())}:${pad(endSalon.getMinutes())}`;
    return { time, minutes, count: chosen.length };
  }, [form.services, form.startsAt, serviceRows, timeZone]);

  function setField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  /**
   * Sets one service line's field.
   *
   * Switching to a service whose branch the line's performer does not work in
   * must not leave a selection the API will refuse — clearing it here is the
   * same rule the server enforces, applied where the user can see it.
   */
  function setLine(index: number, field: keyof ServiceLineForm, value: string) {
    setForm((previous) => {
      const services = previous.services.map((line, position) => {
        if (position !== index) return line;
        const next = { ...line, [field]: value };
        if (field === "serviceId" && next.staffId !== "") {
          const eligible = eligibleStaffFor(value);
          if (!eligible.some((person) => person.id === next.staffId)) next.staffId = "";
        }
        return next;
      });
      return { ...previous, services };
    });
  }

  function addLine() {
    setForm((previous) => ({
      ...previous,
      services: [...previous.services, { serviceId: "", staffId: "" }],
    }));
  }

  function removeLine(index: number) {
    setForm((previous) => ({
      ...previous,
      services: previous.services.filter((_line, position) => position !== index),
    }));
  }

  /** The API prefixes paths with the request part; a form only knows field names. */
  const fieldError = (field: string): string | undefined =>
    fieldErrors[field] ?? fieldErrors[`body.${field}`];

  const servicesError = fieldErrors["services"] ?? fieldErrors["body.services"];
  const staffError = fieldError("staffId");
  /**
   * The repeat rule's fields are nested in the contract (`repeat.occurrences`), so
   * the server's path arrives with a dot; the form shows it once, under the count.
   */
  const repeatError =
    fieldErrors["repeat"] ??
    fieldErrors["repeat.occurrences"] ??
    fieldErrors["body.repeat.occurrences"];
  /**
   * With one line the performer error belongs on its own control. With a chain
   * the API's `staffId` path cannot say *which* line was refused, so it is shown
   * once for the section rather than guessed onto the wrong performer.
   */
  const chainError = form.services.length === 1 ? undefined : staffError;

  /**
   * Which lines go to the API: blanks are an unfinished thought, not a service.
   *
   * A line with no performer is sent without `staffId`, which is how the API
   * spells "unassigned" — the same value the single-service form always sent.
   */
  function chosenLines(): { serviceId: string; staffId?: string }[] {
    return form.services
      .filter((line) => line.serviceId !== "")
      .map((line) => (line.staffId === "" ? { serviceId: line.serviceId } : line));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);

    const lines = chosenLines();
    const localErrors: Record<string, string> = {};
    if (lines.length === 0) localErrors["services"] = "Pick at least one service";
    const start = toSalonInstant(form.startsAt, timeZone);
    if (form.startsAt === "" || !start) {
      localErrors["startsAt"] = "Start time is required";
    }
    // The API holds the real bounds (2–52 bookings, 1–8 weeks); the form only
    // refuses what a desk could never have meant, so the round trip is spared.
    const occurrences = Number(form.occurrences);
    if (form.repeat && (!Number.isInteger(occurrences) || occurrences < 2 || occurrences > 26)) {
      localErrors["repeat"] = "Repeat between 2 and 26 bookings";
    }
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    const startsAt = start!.toISOString();
    const customerId = form.customerId === "" ? undefined : form.customerId;
    const comment = form.comment.trim() === "" ? undefined : form.comment.trim();

    try {
      if (appointment) {
        await updateAppointment.mutateAsync({
          id: appointment.id,
          input: {
            // The chain replaces the booking's lines outright, the same way any
            // other PATCH field replaces its value.
            services: lines,
            startsAt,
            // Sent even when empty: on update the booking *replaces* the link,
            // so an empty value is how a customer is cleared.
            customerId: form.customerId === "" ? null : form.customerId,
            comment: comment ?? null,
          },
        });
        showToast("success", "Appointment updated.");
      } else {
        const created = await createAppointment.mutateAsync({
          services: lines,
          startsAt,
          ...(customerId ? { customerId } : {}),
          ...(comment ? { comment } : {}),
          ...(form.repeat
            ? {
                repeat: {
                  intervalWeeks: Number(form.intervalWeeks),
                  occurrences,
                },
              }
            : {}),
        });

        // A series is booked optimistically, so the answer says what it managed.
        // Saying "booked" while three of ten dates were refused would be a lie the
        // desk only discovers on the day.
        const series = created.series;
        if (!series) {
          showToast("success", "Appointment booked.");
        } else if (series.skipped.length === 0) {
          showToast(
            "success",
            `Booked ${series.created} appointments, ${repeatLabel(series.intervalWeeks)}.`,
          );
        } else {
          const dates = series.skipped.map((skip) => formatDateTime(skip.startsAt)).join(", ");
          showToast(
            "info",
            `Booked ${series.created} of ${series.occurrences}. Skipped ${dates} — book those by hand.`,
          );
        }
      }

      onClose();
    } catch (error) {
      const details = getValidationDetails(error);
      if (Object.keys(details).length > 0) {
        setFieldErrors(details);
        return;
      }
      setFormError(getErrorMessage(error));
    }
  }

  /**
   * Stops the series this booking belongs to.
   *
   * The server cancels only what has not happened yet, so this cannot rewrite a
   * completed visit; the count it returns is what the desk is told.
   */
  async function handleCancelSeries() {
    if (!appointment?.series) return;
    setFormError(null);
    try {
      const { cancelled } = await cancelSeries.mutateAsync(appointment.series.id);
      showToast(
        cancelled > 0 ? "success" : "info",
        cancelled > 0
          ? `Cancelled ${cancelled} upcoming booking${cancelled === 1 ? "" : "s"}.`
          : "Nothing left to cancel in this series.",
      );
      onClose();
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEditing ? "Edit appointment" : "Book appointment"}
      description={
        isEditing
          ? "Change the services, time or performers. The end time follows the services."
          : "Pick the services first — their lengths and the staff who may perform them come from them."
      }
      widthClassName="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" form="appointment-form" loading={isSaving}>
            {isEditing ? "Save changes" : "Book appointment"}
          </Button>
        </>
      }
    >
      <form
        id="appointment-form"
        onSubmit={handleSubmit}
        noValidate
        className="flex flex-col gap-4"
      >
        {formError ? (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-ink">Services</p>
            <Button size="sm" variant="secondary" onClick={addLine}>
              Add service
            </Button>
          </div>

          {form.services.map((line, index) => {
            const position = index + 1;
            // The first line keeps the bare label: one service is still the
            // common case, and its control should read exactly as it always did.
            const suffix = index === 0 ? "" : ` ${position}`;
            return (
              <div
                key={index}
                className="flex flex-col gap-2 rounded-md border border-line bg-surface-2/40 p-3"
              >
                <Select
                  label={`Service${suffix}`}
                  required
                  value={line.serviceId}
                  onChange={(event) => setLine(index, "serviceId", event.target.value)}
                  options={serviceRows.map((service) => ({
                    value: service.id,
                    label: service.durationMinutes
                      ? `${service.name} (${service.durationMinutes} min)`
                      : service.name,
                  }))}
                  disabled={services.isPending}
                />

                <Select
                  label={`Performer${suffix}`}
                  value={line.staffId}
                  onChange={(event) => setLine(index, "staffId", event.target.value)}
                  error={index === 0 ? staffError : undefined}
                  hint={
                    form.services.length === 1 && index === 0
                      ? "Who performs the service. Leave as Unassigned if nobody has claimed it yet."
                      : undefined
                  }
                  options={performerOptions(eligibleStaffFor(line.serviceId))}
                  disabled={staff.isPending}
                />

                {form.services.length > 1 ? (
                  <Button
                    size="sm"
                    variant="danger"
                    aria-label={`Remove service ${position}`}
                    onClick={() => removeLine(index)}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            );
          })}

          {servicesError ? (
            <p role="alert" className="text-sm text-danger">
              {servicesError}
            </p>
          ) : null}
          {chainError ? (
            <p role="alert" className="text-sm text-danger">
              {chainError}
            </p>
          ) : null}

          <p className="text-sm text-ink-muted">
            {previewEndsAt
              ? `${previewEndsAt.count} service${previewEndsAt.count === 1 ? "" : "s"} · ${
                  previewEndsAt.minutes
                } minutes — ends around ${previewEndsAt.time}.`
              : "Each service's length decides how long the booking runs."}
          </p>
        </div>

        <Input
          label="Starts at"
          type="datetime-local"
          required
          value={form.startsAt}
          onChange={(event) => setField("startsAt", event.target.value)}
          error={fieldError("startsAt")}
        />

        <Select
          label="Customer"
          value={form.customerId}
          onChange={(event) => setField("customerId", event.target.value)}
          error={fieldError("customerId")}
          hint="Leave as Walk-in if the salon has no record of them yet."
          options={customerRows.map((customer) => ({
            value: customer.id,
            label: customer.memberId ? `${customer.name} (member)` : customer.name,
          }))}
          disabled={customers.isPending}
        />

        <Input
          label="Comment"
          value={form.comment}
          onChange={(event) => setField("comment", event.target.value)}
          error={fieldError("comment")}
          hint="Anything the desk should know — preferences, patch tests, the usual."
          maxLength={2000}
        />

        {!isEditing ? (
          <fieldset className="flex flex-col gap-3 rounded-md border border-line p-3">
            <legend className="px-1 text-sm font-bold text-ink">Repeat</legend>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={form.repeat}
                onChange={(event) => setField("repeat", event.target.checked)}
              />
              Book this more than once
            </label>

            {form.repeat ? (
              <>
                <Select
                  label="Repeat every"
                  value={form.intervalWeeks}
                  onChange={(event) => setField("intervalWeeks", event.target.value)}
                  options={[
                    { value: "1", label: "Week" },
                    { value: "2", label: "2 weeks" },
                    { value: "4", label: "4 weeks" },
                  ]}
                />
                <Input
                  label="Number of bookings"
                  type="number"
                  min={2}
                  max={26}
                  value={form.occurrences}
                  onChange={(event) => setField("occurrences", event.target.value)}
                  error={repeatError}
                  hint="This booking included. A date that clashes with the book is skipped and reported rather than failing the rest."
                />
              </>
            ) : null}
          </fieldset>
        ) : null}
      </form>
      {appointment ? (
        <>
          <p>
            Customer attendance: {appointment.customerConfirmedAt ? "Confirmed" : "Not confirmed"}
          </p>
          {appointment.series ? (
            <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-2/40 p-3 text-sm text-ink-muted">
              <p>
                Part of a repeating series — {repeatLabel(appointment.series.intervalWeeks)},
                booking {appointment.series.index + 1} of {appointment.series.occurrences}.
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleCancelSeries()}
                loading={cancelSeries.isPending}
              >
                Cancel the rest of the series
              </Button>
            </div>
          ) : null}
          <SecureLinkActions key={appointment.id} resource="appointments" id={appointment.id} />
        </>
      ) : null}
    </Drawer>
  );
}
