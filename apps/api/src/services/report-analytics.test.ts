import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reportAnalyticsSchema } from "@glampro_suite/shared";
import { buildReportAnalytics } from "./report-analytics.js";

const base = {
  from: new Date("2026-10-01T16:00:00Z"),
  to: new Date("2026-10-04T15:59:59.999Z"),
  timeZone: "Asia/Singapore",
  sales: [],
  lines: [],
  appointments: [],
  sessionsRedeemed: 0,
};
describe("business report analytics", () => {
  it("zero fills salon-local calendar days and accepts the output contract", () => {
    const result = buildReportAnalytics(base);
    assert.equal(result.granularity, "day");
    assert.deepEqual(
      result.timeline.map((row) => row.key),
      ["2026-10-02", "2026-10-03", "2026-10-04"],
    );
    assert.equal(result.timeline[1]?.revenue, "0.00");
    assert.equal(result.appointments.total, 0);
    assert.ok(reportAnalyticsSchema.safeParse(result).success);
  });
  it("aggregates all items beyond the legacy top ten using exact cents", () => {
    const date = new Date("2026-10-02T01:00:00Z");
    const result = buildReportAnalytics({
      ...base,
      sales: [{ soldAt: date, totalAmount: "0.30" }],
      lines: Array.from({ length: 12 }, (_, index) => ({
        itemType: "PRODUCT" as const,
        itemId: String(index),
        itemName: `Product ${index}`,
        quantity: 2,
        revenue: "0.10",
        soldAt: date,
      })),
    });
    assert.equal(result.items.length, 12);
    assert.equal(result.categories.find((row) => row.key === "products")?.quantity, 24);
    assert.equal(result.categories.find((row) => row.key === "products")?.revenue, "1.20");
    assert.equal(result.timeline[0]?.products, "1.20");
    assert.equal(result.salesAmount, "0.30");
  });
  it("counts statuses by booking start and keeps package purchases separate from redemptions", () => {
    const date = new Date("2026-10-02T01:00:00Z");
    const result = buildReportAnalytics({
      ...base,
      sessionsRedeemed: 7,
      appointments: ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"].map(
        (status) => ({
          startsAt: date,
          status: status as "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW",
        }),
      ),
      lines: [
        {
          itemType: "PACKAGE",
          itemId: "p",
          itemName: "Sessions",
          quantity: 1,
          revenue: "100.00",
          soldAt: date,
        },
        {
          itemType: "VALUE_PACKAGE",
          itemId: "v",
          itemName: "Credit",
          quantity: 1,
          revenue: "50.00",
          soldAt: date,
        },
        {
          itemType: "GIFT_CARD",
          itemId: "g",
          itemName: "Gift",
          quantity: 1,
          revenue: "25.00",
          soldAt: date,
        },
      ],
    });
    assert.deepEqual(result.appointments, {
      total: 5,
      scheduled: 1,
      inProgress: 1,
      completed: 1,
      cancelled: 1,
      noShow: 1,
    });
    assert.equal(result.categories.find((row) => row.key === "packages")?.revenue, "150.00");
    assert.equal(result.categories.find((row) => row.key === "other")?.revenue, "25.00");
    assert.equal(result.sessionsRedeemed, 7);
    assert.equal(result.timeline[0]?.cancelled, 1);
  });
  it("uses 25 distinct hourly buckets on a fall-back day and 23 on spring-forward", () => {
    const fall = buildReportAnalytics({
      ...base,
      timeZone: "America/New_York",
      from: new Date("2026-11-01T04:00:00Z"),
      to: new Date("2026-11-02T04:59:59.999Z"),
      sales: [
        { soldAt: new Date("2026-11-01T05:30:00Z"), totalAmount: "1.00" },
        { soldAt: new Date("2026-11-01T06:30:00Z"), totalAmount: "2.00" },
      ],
    });
    assert.equal(fall.granularity, "hour");
    assert.equal(fall.timeline.length, 25);
    assert.notEqual(fall.timeline[1]?.label, fall.timeline[2]?.label);
    assert.equal(fall.timeline[1]?.revenue, "1.00");
    assert.equal(fall.timeline[2]?.revenue, "2.00");
    const spring = buildReportAnalytics({
      ...base,
      timeZone: "America/New_York",
      from: new Date("2026-03-08T05:00:00Z"),
      to: new Date("2026-03-09T03:59:59.999Z"),
    });
    assert.equal(spring.timeline.length, 23);
  });
});
