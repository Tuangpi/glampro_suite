import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CompanyAdministration as Administration } from "@glampro_suite/shared";
import { beforeEach, expect, it, vi } from "vitest";

import { dayToLocalInstant, formatDate, formatDateInputValue, formatPrice } from "@/lib/utils";
import { platformApi } from "./api";
import SubscriptionPanel from "./SubscriptionPanel";

vi.mock("./api", () => ({ platformApi: { recordSubscription: vi.fn() } }));

type Period = Administration["subscriptions"][number];

const DAY = 24 * 60 * 60 * 1000;

/** Days, never instants, in the assertions: the panel's job is to render days. */
function dayInput(offsetDays: number): string {
  return formatDateInputValue(new Date(Date.now() + offsetDays * DAY));
}

function period(changes: Partial<Period> = {}): Period {
  return {
    id: "period-1",
    startDate: new Date(Date.now() - 5 * DAY).toISOString(),
    endDate: new Date(Date.now() + 25 * DAY).toISOString(),
    status: "ACTIVE",
    amount: "99.00",
    currency: "SGD",
    createdAt: new Date(Date.now() - 5 * DAY).toISOString(),
    ...changes,
  };
}

/** The card a heading titles, so "Amount" can be the summary's or a table's. */
function card(title: string): HTMLElement {
  return screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;
}

/** The summary reads as label/value pairs; `dd` follows its `dt`. */
function fact(title: string, label: string): string {
  const term = within(card(title)).getByText(label);
  return term.nextElementSibling?.textContent ?? "";
}

function panel(
  subscriptions: Period[],
  effectiveStatus: Administration["effectiveStatus"] = "ACTIVE",
) {
  return (
    <SubscriptionPanel
      companyId="company-a"
      effectiveStatus={effectiveStatus}
      subscriptions={subscriptions}
      onRecorded={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(platformApi.recordSubscription).mockResolvedValue(undefined);
});

it("accepts a period that starts in the future", async () => {
  const onRecorded = vi.fn().mockResolvedValue(undefined);
  const onBusyChange = vi.fn();
  render(
    <SubscriptionPanel
      companyId="company-a"
      effectiveStatus="ACTIVE"
      subscriptions={[]}
      onRecorded={onRecorded}
      onBusyChange={onBusyChange}
    />,
  );

  // The picker no longer caps the start at today: scheduling the next period is
  // what an operator does on renewal, and the API accepts it.
  expect(screen.getByLabelText("Period start")).not.toHaveAttribute("max");

  const startDay = dayInput(5);
  const endDay = dayInput(35);
  fireEvent.change(screen.getByLabelText("Period start"), { target: { value: startDay } });
  // The end's earliest day follows the picked start, so it can never precede it.
  expect(screen.getByLabelText("Period end")).toHaveAttribute("min", dayInput(6));

  fireEvent.change(screen.getByLabelText("Period end"), { target: { value: endDay } });
  fireEvent.change(screen.getByLabelText("Subscription amount"), { target: { value: "120.00" } });
  fireEvent.change(screen.getByLabelText("Reason for this period"), {
    target: { value: "Scheduled renewal" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Record subscription" }));

  await waitFor(() => expect(onRecorded).toHaveBeenCalledOnce());
  expect(platformApi.recordSubscription).toHaveBeenCalledWith("company-a", {
    // The picked day crosses the wire as that day's midnight plus this machine's
    // offset, which is what the API's strict schema requires.
    startDate: dayToLocalInstant(startDay),
    endDate: dayToLocalInstant(endDay),
    amount: "120.00",
    currency: "SGD",
    reason: "Scheduled renewal",
  });

  // The operator's days are only spent once the server accepted them.
  expect(screen.getByRole("status")).toHaveTextContent("Subscription period recorded.");
  expect(screen.getByLabelText("Period start")).toHaveValue("");
  expect(screen.getByLabelText("Reason for this period")).toHaveValue("");

  // The section above owns the busy flag; the panel reports into it.
  expect(onBusyChange).toHaveBeenNthCalledWith(1, true);
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
});

it("summarises the running period and names the scheduled one", () => {
  const running = period();
  const scheduled = period({
    id: "period-2",
    startDate: new Date(Date.now() + 30 * DAY).toISOString(),
    endDate: new Date(Date.now() + 60 * DAY).toISOString(),
    amount: "149.00",
  });
  render(panel([running, scheduled]));

  const summary = "Current subscription";
  expect(fact(summary, "Access from")).toBe(formatDate(running.startDate));
  expect(fact(summary, "Access until")).toBe(formatDate(running.endDate));
  expect(fact(summary, "Amount")).toBe(formatPrice("99.00", "SGD"));
  expect(fact(summary, "Time left")).toBe("25 days");
  expect(
    screen.getByText(`Next period starts ${formatDate(scheduled.startDate)}, in 30 days.`),
  ).toBeInTheDocument();

  // The history renders days, marks the row that is running and never prints the
  // ISO instant the API stores.
  expect(screen.getAllByText(/→/)[0]).toHaveTextContent(
    `${formatDate(running.startDate)} → ${formatDate(running.endDate)}`,
  );
  expect(screen.getByText("Current")).toBeInTheDocument();
  expect(screen.getByText("Scheduled")).toBeInTheDocument();
  expect(screen.queryByText(running.endDate)).not.toBeInTheDocument();
});

it("explains a scheduled period instead of claiming access", () => {
  const scheduled = period({
    id: "period-2",
    startDate: new Date(Date.now() + 30 * DAY).toISOString(),
    endDate: new Date(Date.now() + 60 * DAY).toISOString(),
  });
  render(panel([scheduled], "EXPIRED"));

  expect(screen.getByText(/No period is running now/)).toBeInTheDocument();
  // The rule the reactivate button depends on, said where the operator meets it.
  expect(screen.getByText(/brings no access forward/)).toBeInTheDocument();
  expect(fact("Current subscription", "Access from")).toBe(formatDate(scheduled.startDate));
  // The status is the company's, not the scheduled period's.
  expect(screen.getByText("Expired")).toBeInTheDocument();
});

it("refuses a reason of only spaces without spending the picked days", async () => {
  render(panel([]));

  const startDay = dayInput(0);
  fireEvent.change(screen.getByLabelText("Period start"), { target: { value: startDay } });
  fireEvent.change(screen.getByLabelText("Period end"), { target: { value: dayInput(30) } });
  fireEvent.change(screen.getByLabelText("Subscription amount"), { target: { value: "99.00" } });
  fireEvent.change(screen.getByLabelText("Reason for this period"), { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: "Record subscription" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("at least 3 characters");
  expect(platformApi.recordSubscription).not.toHaveBeenCalled();
  // Retyping three fields to fix a reason is not work worth handing back.
  expect(screen.getByLabelText("Period start")).toHaveValue(startDay);
});

it("reports a rejection in the form and keeps the days to retry", async () => {
  vi.mocked(platformApi.recordSubscription).mockRejectedValue(
    new Error("This period overlaps an existing active subscription."),
  );
  const onRecorded = vi.fn();
  render(
    <SubscriptionPanel
      companyId="company-a"
      effectiveStatus="ACTIVE"
      subscriptions={[]}
      onRecorded={onRecorded}
    />,
  );

  const startDay = dayInput(0);
  fireEvent.change(screen.getByLabelText("Period start"), { target: { value: startDay } });
  fireEvent.change(screen.getByLabelText("Period end"), { target: { value: dayInput(30) } });
  fireEvent.change(screen.getByLabelText("Subscription amount"), { target: { value: "99.00" } });
  fireEvent.change(screen.getByLabelText("Reason for this period"), {
    target: { value: "Manual period" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Record subscription" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("overlaps an existing");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Period start")).toHaveValue(startDay);
  // Nothing was recorded, so there is nothing to re-read.
  expect(onRecorded).not.toHaveBeenCalled();
});

it("says what would fill an empty history", () => {
  render(panel([]));

  expect(screen.getByText(/Until one is added below/)).toBeInTheDocument();
  expect(screen.getByText("No subscription periods recorded.")).toBeInTheDocument();
});
