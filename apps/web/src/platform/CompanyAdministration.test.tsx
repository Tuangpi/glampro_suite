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
  },
}));

const administration = {
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
  ],
};

/** The same company after Packages was granted. */
const granted = {
  ...administration,
  modules: administration.modules.map((row) =>
    row.code === "packages" ? { ...row, enabled: true, entitled: true } : row,
  ),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(platformApi.administration).mockResolvedValue(administration);
  vi.mocked(platformApi.audit).mockResolvedValue({ items: [], total: 21, page: 1, pageSize: 20 });
});

it("requires a reason, changes lifecycle and refreshes company data and audit", async () => {
  const changed = vi.fn().mockResolvedValue(undefined);
  render(<CompanyAdministration id="company-a" onChange={changed} />);

  expect(await screen.findByRole("button", { name: "Suspend company" })).toBeDisabled();
  expect(platformApi.lifecycle).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("Change reason"), { target: { value: "Payment review" } });
  fireEvent.click(screen.getByRole("button", { name: "Suspend company" }));

  // The button only opens the confirmation; nothing is sent by opening it.
  const dialog = screen.getByRole("dialog", { name: "Suspend this company?" });
  expect(dialog).toHaveTextContent("Payment review");
  expect(platformApi.lifecycle).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Confirm suspension" }));
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

it("sends a grant with its optional expiry", async () => {
  vi.mocked(platformApi.changeModule).mockResolvedValue(undefined);
  render(<CompanyAdministration id="company-a" tab="modules" onChange={vi.fn()} />);

  fireEvent.click(await screen.findByRole("switch", { name: "Packages" }));
  const dialog = screen.getByRole("dialog", { name: "Turn on Packages?" });
  fireEvent.change(within(dialog).getByLabelText("Reason for change"), {
    target: { value: "Sold with the annual plan" },
  });
  fireEvent.change(within(dialog).getByLabelText("Expires at (optional)"), {
    target: { value: "2026-11-23T00:00:00+08:00" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm change" }));

  await waitFor(() =>
    expect(platformApi.changeModule).toHaveBeenCalledWith("company-a", {
      code: "packages",
      enabled: true,
      expiresAt: "2026-11-23T00:00:00+08:00",
      reason: "Sold with the annual plan",
    }),
  );
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
  await screen.findByLabelText("Change reason");
  fireEvent.change(screen.getByLabelText("Change reason"), {
    target: { value: "Closure requested" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel company" }));

  const dialog = screen.getByRole("dialog", { name: "Cancel this company?" });
  expect(dialog).toHaveTextContent("blocked from signing in");

  fireEvent.click(screen.getByRole("button", { name: "Keep current access" }));
  expect(screen.queryByRole("button", { name: "Confirm cancellation" })).not.toBeInTheDocument();
  expect(platformApi.lifecycle).not.toHaveBeenCalled();
});
