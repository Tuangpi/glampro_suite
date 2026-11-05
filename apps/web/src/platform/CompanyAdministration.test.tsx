import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { dayToLocalInstant, formatDateInputValue } from "@/lib/utils";
import CompanyAdministration from "./CompanyAdministration";
import { platformApi } from "./api";

vi.mock("./api", () => ({
  platformApi: {
    administration: vi.fn(),
    audit: vi.fn(),
    lifecycle: vi.fn(),
    recordSubscription: vi.fn(),
    changeModule: vi.fn(),
    changeModules: vi.fn(),
  },
}));

const DAY = 24 * 60 * 60 * 1000;

/**
 * One recorded period, as the server writes it.
 *
 * The boundaries are day offsets from now so a test can say "running" or "ended a
 * month ago" without a hardcoded date that rots.
 */
function period(startDays: number, endDays: number) {
  return {
    id: `period-${startDays}-${endDays}`,
    startDate: new Date(Date.now() + startDays * DAY).toISOString(),
    endDate: new Date(Date.now() + endDays * DAY).toISOString(),
    status: "ACTIVE" as const,
    amount: "99.00",
    currency: "SGD",
    createdAt: new Date(Date.now() + startDays * DAY).toISOString(),
  };
}

const administration = {
  status: "ACTIVE" as const,
  effectiveStatus: "ACTIVE" as const,
  subscriptions: [],
  modules: [
    {
      code: "customers",
      name: "Customers",
      isCore: true,
      enabled: true,
      entitled: true,
      expiresAt: null,
    },
    {
      code: "packages",
      name: "Packages",
      isCore: false,
      enabled: false,
      entitled: false,
      expiresAt: null,
    },
    {
      code: "payroll",
      name: "Payroll",
      isCore: false,
      enabled: true,
      entitled: false,
      expiresAt: "2026-01-01T00:00:00.000Z",
    },
    // An add-on with no screen behind it: the console must not pretend a grant
    // does anything. See `UNENFORCED_MODULE_CODES`.
    {
      code: "inventory",
      name: "Inventory",
      isCore: false,
      enabled: false,
      entitled: false,
      expiresAt: null,
    },
  ],
};

/** The same company after Packages was granted. */
const granted = {
  ...administration,
  modules: administration.modules.map((row) =>
    row.code === "packages" ? { ...row, enabled: true, entitled: true } : row,
  ),
};

/** Every add-on already on: "Turn all on" has nothing left to grant. */
const allOn = {
  ...administration,
  modules: administration.modules.map((row) => ({
    ...row,
    enabled: true,
    entitled: true,
    expiresAt: null,
  })),
};

/** No add-on granted at all: "Turn all off" has nothing to remove. */
const nothingGranted = {
  ...administration,
  modules: administration.modules.map((row) =>
    row.isCore ? row : { ...row, enabled: false, entitled: false, expiresAt: null },
  ),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(platformApi.administration).mockResolvedValue(administration);
  vi.mocked(platformApi.audit).mockResolvedValue({ items: [], total: 21, page: 1, pageSize: 20 });
});

it("asks for a reason in the confirmation, changes lifecycle and refreshes company data and audit", async () => {
  const changed = vi.fn().mockResolvedValue(undefined);
  render(<CompanyAdministration id="company-a" onChange={changed} />);

  fireEvent.click(await screen.findByRole("button", { name: "Suspend company" }));

  // The button only opens the confirmation, and the confirmation is where the
  // reason lives: nothing is sent until one is typed and it is confirmed.
  const dialog = screen.getByRole("dialog", { name: "Suspend this company?" });
  expect(within(dialog).getByRole("button", { name: "Confirm suspension" })).toBeDisabled();
  expect(platformApi.lifecycle).not.toHaveBeenCalled();

  fireEvent.change(within(dialog).getByLabelText("Reason for change"), {
    target: { value: "Payment review" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm suspension" }));

  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(platformApi.lifecycle).toHaveBeenCalledWith("company-a", {
    action: "suspend",
    reason: "Payment review",
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(platformApi.audit).toHaveBeenCalledTimes(2));
});

it("mounts the subscription panel and re-reads the company when a period is recorded", async () => {
  vi.mocked(platformApi.recordSubscription).mockResolvedValue(undefined);
  const changed = vi.fn().mockResolvedValue(undefined);
  render(<CompanyAdministration id="company-a" onChange={changed} />);

  // Recording is behind the panel's one button now, not a permanently open form.
  fireEvent.click(await screen.findByRole("button", { name: "Record period" }));

  const planted = new Date();
  const startDay = formatDateInputValue(planted);
  const endDay = formatDateInputValue(new Date(planted.getTime() + 30 * 24 * 60 * 60 * 1000));
  for (const [label, value] of [
    ["Reason for this period", "Manual period"],
    ["Period start", startDay],
    ["Period end", endDay],
    ["Subscription amount", "99.00"],
  ])
    fireEvent.change(await screen.findByLabelText(label), { target: { value } });

  fireEvent.click(screen.getByRole("button", { name: "Record subscription" }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(platformApi.recordSubscription).toHaveBeenCalledWith(
    "company-a",
    expect.objectContaining({
      startDate: dayToLocalInstant(startDay),
      endDate: dayToLocalInstant(endDay),
      reason: "Manual period",
    }),
  );
  expect(platformApi.lifecycle).not.toHaveBeenCalled();

  // The panel reports its own outcome: the section's shared banner belongs to
  // lifecycle and module changes, and claiming one here would be a lie.
  expect(await screen.findByText("Subscription period recorded.")).toBeInTheDocument();
  expect(screen.queryByText("Change saved. Audit history will refresh.")).not.toBeInTheDocument();
});

it("shows module access as switches: core is fixed, a lapsed grant reads as off", async () => {
  render(<CompanyAdministration id="company-a" tab="modules" onChange={vi.fn()} />);

  const core = await screen.findByRole("switch", { name: "Customers" });
  expect(core).toBeDisabled();
  expect(core).toHaveAttribute("aria-checked", "true");

  // A grant that has lapsed is off and says so, rather than looking like a plain gap.
  expect(screen.getByRole("switch", { name: "Payroll" })).toHaveAttribute("aria-checked", "false");
  expect(screen.getByText("Expired")).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "Packages" })).toHaveAttribute("aria-checked", "false");
});

it("asks for a reason before granting a module and reports a rejection in the dialog", async () => {
  render(<CompanyAdministration id="company-a" tab="modules" onChange={vi.fn()} />);

  fireEvent.click(await screen.findByRole("switch", { name: "Packages" }));
  const dialog = screen.getByRole("dialog", { name: "Turn on Packages?" });
  const confirm = within(dialog).getByRole("button", { name: "Confirm change" });
  expect(confirm).toBeDisabled();
  expect(platformApi.changeModule).not.toHaveBeenCalled();

  fireEvent.change(within(dialog).getByLabelText("Reason for change"), {
    target: { value: "Purchased add-on" },
  });
  vi.mocked(platformApi.changeModule).mockRejectedValue(new Error("Audit unavailable"));
  fireEvent.click(confirm);

  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Audit unavailable");
  expect(within(dialog).getByLabelText("Reason for change")).toHaveValue("Purchased add-on");
  // Nothing was granted, so the switch has not moved.
  expect(screen.getByRole("switch", { name: "Packages" })).toHaveAttribute("aria-checked", "false");
});

it("sends a grant with the expiry day the picker holds", async () => {
  vi.mocked(platformApi.changeModule).mockResolvedValue(undefined);
  render(<CompanyAdministration id="company-a" tab="modules" onChange={vi.fn()} />);

  fireEvent.click(await screen.findByRole("switch", { name: "Packages" }));
  const dialog = screen.getByRole("dialog", { name: "Turn on Packages?" });
  fireEvent.change(within(dialog).getByLabelText("Reason for change"), {
    target: { value: "Sold with the annual plan" },
  });
  // A date, not a typed instant: the picker knows a day and the panel adds the
  // operator's own offset, so the evening before cannot be the day that is stored.
  fireEvent.change(within(dialog).getByLabelText("Expires at (optional)"), {
    target: { value: "2026-11-23" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm change" }));

  await waitFor(() =>
    expect(platformApi.changeModule).toHaveBeenCalledWith("company-a", {
      code: "packages",
      enabled: true,
      expiresAt: dayToLocalInstant("2026-11-23"),
      reason: "Sold with the annual plan",
    }),
  );
});

it("fills the expiry from a duration preset instead of counting months", async () => {
  render(<CompanyAdministration id="company-a" tab="modules" onChange={vi.fn()} />);

  fireEvent.click(await screen.findByRole("switch", { name: "Packages" }));
  const dialog = screen.getByRole("dialog", { name: "Turn on Packages?" });
  const field = within(dialog).getByLabelText("Expires at (optional)") as HTMLInputElement;
  // The earliest day offered is tomorrow: an expiry of "today" is already over.
  expect(field).toHaveAttribute(
    "min",
    formatDateInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
  );
  expect(field).toHaveValue("");

  fireEvent.click(within(dialog).getByRole("button", { name: "1 year" }));
  expect(field).toHaveValue(formatDateInputValue(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)));

  // And an explicit "no expiry" puts it back to empty.
  fireEvent.click(within(dialog).getByRole("button", { name: "No expiry" }));
  expect(field).toHaveValue("");
});

it("revokes a granted module without sending an expiry", async () => {
  vi.mocked(platformApi.administration).mockResolvedValue(granted);
  render(<CompanyAdministration id="company-a" tab="modules" onChange={vi.fn()} />);

  fireEvent.click(await screen.findByRole("switch", { name: "Packages" }));
  const dialog = screen.getByRole("dialog", { name: "Turn off Packages?" });
  // A revocation has nothing to expire, so the field is not offered at all.
  expect(within(dialog).queryByLabelText("Expires at (optional)")).not.toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText("Reason for change"), {
    target: { value: "Downgraded to the base plan" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm change" }));

  await waitFor(() =>
    expect(platformApi.changeModule).toHaveBeenCalledWith("company-a", {
      code: "packages",
      enabled: false,
      expiresAt: null,
      reason: "Downgraded to the base plan",
    }),
  );
});

it("pages the audit history with the shared pagination control", async () => {
  render(<CompanyAdministration id="company-a" tab="activity" onChange={vi.fn()} />);

  await screen.findByRole("heading", { name: "Company audit history" });
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(platformApi.audit).toHaveBeenLastCalledWith("company-a", 2));
});

it("lets the operator back out of cancellation without changing access", async () => {
  render(<CompanyAdministration id="company-a" onChange={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel company" }));

  const dialog = screen.getByRole("dialog", { name: "Cancel this company?" });
  expect(dialog).toHaveTextContent("blocked from signing in");

  fireEvent.click(within(dialog).getByRole("button", { name: "Keep current access" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(platformApi.lifecycle).not.toHaveBeenCalled();
});

it("does not pretend an add-on with no screens behind it can be granted", async () => {
  render(<CompanyAdministration id="company-a" tab="modules" onChange={vi.fn()} />);

  const inventory = await screen.findByRole("switch", { name: "Inventory" });
  expect(inventory).toBeDisabled();
  expect(screen.getByText("Not in this release")).toBeInTheDocument();
  expect(screen.getByText("Unavailable")).toBeInTheDocument();

  // Nothing happened, so there is no change to ask about, let alone send.
  fireEvent.click(inventory);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(platformApi.changeModule).not.toHaveBeenCalled();
});

/**
 * The three lifecycle verbs are gated on the company's state, and every case below is
 * a rule `changeCompanyLifecycle` already enforces: a live button that could only
 * answer `409` is a button that taught the operator nothing.
 */
it("dims suspension for a company whose last period has ended, and says why", async () => {
  vi.mocked(platformApi.administration).mockResolvedValue({
    ...administration,
    status: "ACTIVE",
    effectiveStatus: "EXPIRED",
    subscriptions: [period(-60, -30)],
  });
  render(<CompanyAdministration id="company-a" onChange={vi.fn()} />);

  expect(await screen.findByRole("button", { name: "Suspend company" })).toBeDisabled();
  // The record still says ACTIVE, so "Reactivate" answers "already has that status";
  // the way out is a new period or a cancellation.
  expect(screen.getByRole("button", { name: "Reactivate company" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel company" })).toBeEnabled();
  expect(screen.getByText(/the last period has ended/i)).toBeInTheDocument();
});

it("offers reactivation of a suspended company only while a period is running", async () => {
  vi.mocked(platformApi.administration).mockResolvedValue({
    ...administration,
    status: "SUSPENDED",
    effectiveStatus: "SUSPENDED",
    subscriptions: [period(-5, 25)],
  });
  render(<CompanyAdministration id="company-a" onChange={vi.fn()} />);

  expect(await screen.findByRole("button", { name: "Reactivate company" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Suspend company" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel company" })).toBeEnabled();
  // The status is on the card, beside the sentence that explains the gating — and
  // again on the Plan card, which is the same value read from the same place.
  expect(screen.getAllByText("Suspended")).toHaveLength(2);
});

it("keeps reactivation dimmed when the period has lapsed, because the API refuses it", async () => {
  vi.mocked(platformApi.administration).mockResolvedValue({
    ...administration,
    status: "SUSPENDED",
    effectiveStatus: "SUSPENDED",
    subscriptions: [period(-60, -30)],
  });
  render(<CompanyAdministration id="company-a" onChange={vi.fn()} />);

  expect(await screen.findByRole("button", { name: "Reactivate company" })).toBeDisabled();
  // The sentence names the date and the way out: a new period, or cancellation.
  expect(screen.getByText(/its last period ended on/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Suspend company" })).toBeDisabled();
});

/**
 * The other half of the same rule: `changeCompanyLifecycle` refuses a reactivation
 * on a period that has *started and ended*, not on the absence of one. A company
 * provisioned before its first plan is reactivatable, so dimming this button would
 * be the very bug the gating exists to fix — a button that would have worked.
 */
it("lets a suspended company with no period recorded yet be reactivated", async () => {
  vi.mocked(platformApi.administration).mockResolvedValue({
    ...administration,
    status: "SUSPENDED",
    effectiveStatus: "SUSPENDED",
    subscriptions: [],
  });
  render(<CompanyAdministration id="company-a" onChange={vi.fn()} />);

  expect(await screen.findByRole("button", { name: "Reactivate company" })).toBeEnabled();
  expect(screen.getByText(/no period recorded yet/i)).toBeInTheDocument();
  // Suspending is still the wrong verb for a company already suspended.
  expect(screen.getByRole("button", { name: "Suspend company" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel company" })).toBeEnabled();
});

it("does not let a period that has not started yet stand in for a running one", async () => {
  // A scheduled period brings no access forward, and the API counts only started
  // ones, so the ended period is still the latest that counts.
  vi.mocked(platformApi.administration).mockResolvedValue({
    ...administration,
    status: "SUSPENDED",
    effectiveStatus: "SUSPENDED",
    subscriptions: [period(-60, -30), { ...period(10, 40), status: "PENDING" as const }],
  });
  render(<CompanyAdministration id="company-a" onChange={vi.fn()} />);

  expect(await screen.findByRole("button", { name: "Reactivate company" })).toBeDisabled();
  expect(screen.getByText(/its last period ended on/i)).toBeInTheDocument();
});

it("does not offer to cancel a company that is already cancelled", async () => {
  vi.mocked(platformApi.administration).mockResolvedValue({
    ...administration,
    status: "CANCELLED",
    effectiveStatus: "CANCELLED",
    subscriptions: [period(-5, 25)],
  });
  render(<CompanyAdministration id="company-a" onChange={vi.fn()} />);

  expect(await screen.findByRole("button", { name: "Cancel company" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Suspend company" })).toBeDisabled();
  // A running period is what makes undoing the cancellation possible.
  expect(screen.getByRole("button", { name: "Reactivate company" })).toBeEnabled();
});

it("turns every add-on on with one reason and one expiry", async () => {
  vi.mocked(platformApi.changeModules).mockResolvedValue({
    changed: ["packages", "payroll"],
    unchanged: [],
  });
  const changed = vi.fn().mockResolvedValue(undefined);
  render(<CompanyAdministration id="company-a" tab="modules" onChange={changed} />);

  // The count comes before the table, so a bulk button is never a guess.
  expect(await screen.findByText("0 of 2 add-ons on, 1 lapsed.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Turn all on" }));

  const dialog = screen.getByRole("dialog", { name: "Turn on every add-on?" });
  fireEvent.change(within(dialog).getByLabelText("Reason for change"), {
    target: { value: "Annual renewal" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "1 year" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm change" }));

  const yearFromToday = dayToLocalInstant(formatDateInputValue(new Date(Date.now() + 365 * DAY)));
  await waitFor(() =>
    expect(platformApi.changeModules).toHaveBeenCalledWith("company-a", {
      enabled: true,
      expiresAt: yearFromToday,
      reason: "Annual renewal",
    }),
  );
  // One request, not one per module, and none of them the single-module endpoint.
  expect(platformApi.changeModule).not.toHaveBeenCalled();
  expect(await screen.findByRole("status")).toHaveTextContent("2 add-ons turned on.");
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
});

it("turns every granted add-on off, without sending an expiry", async () => {
  vi.mocked(platformApi.administration).mockResolvedValue(granted);
  vi.mocked(platformApi.changeModules).mockResolvedValue({
    changed: ["packages", "payroll"],
    unchanged: [],
  });
  render(<CompanyAdministration id="company-a" tab="modules" onChange={vi.fn()} />);

  fireEvent.click(await screen.findByRole("button", { name: "Turn all off" }));
  const dialog = screen.getByRole("dialog", { name: "Turn off every add-on?" });
  // A revocation has nothing to expire, so the picker is not offered at all.
  expect(within(dialog).queryByLabelText("Expires at (optional)")).not.toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText("Reason for change"), {
    target: { value: "Contract ended" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm change" }));

  await waitFor(() =>
    expect(platformApi.changeModules).toHaveBeenCalledWith("company-a", {
      enabled: false,
      expiresAt: null,
      reason: "Contract ended",
    }),
  );
});

it("reports what a bulk change left alone instead of counting it as moved", async () => {
  vi.mocked(platformApi.administration).mockResolvedValue(granted);
  // The server answers with what it actually changed: Packages was already on.
  vi.mocked(platformApi.changeModules).mockResolvedValue({
    changed: ["payroll"],
    unchanged: ["packages"],
  });
  render(<CompanyAdministration id="company-a" tab="modules" onChange={vi.fn()} />);

  fireEvent.click(await screen.findByRole("button", { name: "Turn all on" }));
  const dialog = screen.getByRole("dialog", { name: "Turn on every add-on?" });
  fireEvent.change(within(dialog).getByLabelText("Reason for change"), {
    target: { value: "Everything on" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm change" }));

  expect(await screen.findByRole("status")).toHaveTextContent(
    "1 add-on turned on. 1 was already on and left alone.",
  );
});

it("dims the bulk buttons that would change nothing", async () => {
  vi.mocked(platformApi.administration).mockResolvedValue(nothingGranted);
  render(<CompanyAdministration id="company-a" tab="modules" onChange={vi.fn()} />);

  // Nothing is granted, so "Turn all off" would be a request with no targets.
  expect(await screen.findByRole("button", { name: "Turn all off" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Turn all on" })).toBeEnabled();
  expect(screen.getByText("0 of 2 add-ons on.")).toBeInTheDocument();
});

it("dims Turn all on when every add-on is already on", async () => {
  vi.mocked(platformApi.administration).mockResolvedValue(allOn);
  render(<CompanyAdministration id="company-a" tab="modules" onChange={vi.fn()} />);

  expect(await screen.findByRole("button", { name: "Turn all on" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Turn all off" })).toBeEnabled();
  expect(screen.getByText("2 of 2 add-ons on.")).toBeInTheDocument();
});
