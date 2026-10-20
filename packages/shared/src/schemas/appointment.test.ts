import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appointmentDetailSchema,
  appointmentSeriesSummarySchema,
  appointmentSeriesReportSchema,
  createAppointmentSchema,
  MAX_APPOINTMENT_OCCURRENCES,
  updateAppointmentSchema,
} from "./appointment.js";

/** The smallest bookable body, so a case below varies only what it judges. */
const booking = {
  serviceId: "service-1",
  startsAt: "2030-03-06T18:00:00.000Z",
};

describe("appointment repeat contract", () => {
  it("defaults the step to weekly and accepts the documented bounds", () => {
    const weekly = createAppointmentSchema.parse({ ...booking, repeat: { occurrences: 4 } });
    assert.deepEqual(weekly.repeat, { intervalWeeks: 1, occurrences: 4 });

    const longest = createAppointmentSchema.safeParse({
      ...booking,
      repeat: { intervalWeeks: 8, occurrences: MAX_APPOINTMENT_OCCURRENCES },
    });
    assert.equal(longest.success, true);
  });

  it("refuses a series of one, a negative step and an absurd count", () => {
    for (const repeat of [
      { occurrences: 1 },
      { intervalWeeks: 0, occurrences: 4 },
      { intervalWeeks: 9, occurrences: 4 },
      { intervalWeeks: 1, occurrences: MAX_APPOINTMENT_OCCURRENCES + 1 },
      { intervalWeeks: 1, occurrences: 2.5 },
    ]) {
      assert.equal(
        createAppointmentSchema.safeParse({ ...booking, repeat }).success,
        false,
        `expected ${JSON.stringify(repeat)} to be refused`,
      );
    }
  });

  it("refuses a repeat on PATCH, because a series is a creation-time rule", () => {
    const result = updateAppointmentSchema.safeParse({
      startsAt: "2030-03-06T18:00:00.000Z",
      repeat: { intervalWeeks: 1, occurrences: 4 },
    });

    assert.equal(result.success, false);
    if (!result.success) assert.deepEqual(result.error.issues[0]?.path, ["repeat"]);
    // The same PATCH without it is fine: this is a guard, not a new requirement.
    assert.equal(updateAppointmentSchema.safeParse({ startsAt: booking.startsAt }).success, true);
  });
});

describe("appointment series shapes", () => {
  it("requires the rule and the place in it", () => {
    assert.equal(
      appointmentSeriesSummarySchema.safeParse({
        id: "series-1",
        intervalWeeks: 2,
        occurrences: 6,
        index: 2,
      }).success,
      true,
    );
    assert.equal(
      appointmentSeriesSummarySchema.safeParse({ id: "series-1", intervalWeeks: 2 }).success,
      false,
    );
  });

  it("carries the skips a create could not book", () => {
    const report = appointmentSeriesReportSchema.parse({
      id: "series-1",
      intervalWeeks: 1,
      occurrences: 3,
      created: 2,
      skipped: [{ startsAt: "2030-04-17T17:00:00.000Z", reason: "That time is already taken." }],
    });

    assert.equal(report.created, 2);
    assert.equal(report.skipped[0]?.startsAt, "2030-04-17T17:00:00.000Z");
  });

  it("is null on a one-off detail and present on an occurrence", () => {
    const detail = {
      id: "appointment-1",
      startsAt: booking.startsAt,
      endsAt: "2030-03-06T18:45:00.000Z",
      status: "SCHEDULED",
      durationMinutes: 45,
      comment: null,
      customerId: null,
      customerName: null,
      staffId: "staff-1",
      staffName: "Mira",
      serviceId: "service-1",
      serviceName: "Cut and finish",
      serviceDepartmentId: null,
      services: [],
      createdAt: booking.startsAt,
      updatedAt: booking.startsAt,
      finishedAt: null,
      series: null,
    };

    assert.equal(appointmentDetailSchema.safeParse(detail).success, true);
    assert.equal(
      appointmentDetailSchema.safeParse({
        ...detail,
        series: { id: "series-1", intervalWeeks: 2, occurrences: 6, index: 2 },
      }).success,
      true,
    );
    // The field is required: a client reading `series` must not have to guess
    // whether an absent key means "one-off" or "the server forgot to send it".
    const withoutSeries: Record<string, unknown> = { ...detail };
    delete withoutSeries["series"];
    assert.equal(appointmentDetailSchema.safeParse(withoutSeries).success, false);
  });
});
