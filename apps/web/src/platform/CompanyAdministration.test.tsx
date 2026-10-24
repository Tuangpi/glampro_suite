import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
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
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(platformApi.administration).mockResolvedValue({
    effectiveStatus: "ACTIVE",
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
    ],
  });
  vi.mocked(platformApi.audit).mockResolvedValue({ items: [], total: 21, page: 1, pageSize: 20 });
});
it("requires a reason, changes lifecycle and refreshes company data and audit", async () => {
  const changed = vi.fn().mockResolvedValue(undefined);
  render(<CompanyAdministration id="company-a" onChange={changed} />);
  fireEvent.click(await screen.findByRole("button", { name: "Suspend company" }));
  expect(screen.getByRole("button", { name: "Suspend company" })).toBeDisabled();
  expect(platformApi.lifecycle).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Change reason"), { target: { value: "Payment review" } });
  fireEvent.click(screen.getByRole("button", { name: "Suspend company" }));
  expect(platformApi.lifecycle).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm suspension" }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(platformApi.lifecycle).toHaveBeenCalledWith("company-a", {
    action: "suspend",
    reason: "Payment review",
  });
  await waitFor(() => expect(platformApi.audit).toHaveBeenCalledTimes(2));
});
it("records a decimal subscription without charging or silently reactivating", async () => {
  render(<CompanyAdministration id="company-a" onChange={vi.fn()} />);
  await screen.findByLabelText("Period start");
  for (const [label, value] of [
    ["Change reason", "Manual period"],
    ["Period start", "2026-10-01T00:00:00Z"],
    ["Period end", "2026-11-01T00:00:00Z"],
    ["Subscription amount", "99.00"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Record subscription" }));
  await waitFor(() =>
    expect(platformApi.recordSubscription).toHaveBeenCalledWith(
      "company-a",
      expect.objectContaining({ amount: "99.00", currency: "SGD" }),
    ),
  );
  expect(platformApi.lifecycle).not.toHaveBeenCalled();
});
it("limits module options to add-ons, reports failures and pages audit", async () => {
  const { rerender } = render(
    <CompanyAdministration id="company-a" tab="modules" onChange={vi.fn()} />,
  );
  await screen.findByLabelText("Add-on module");
  expect(screen.queryByRole("option", { name: "Customers" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Change reason"), {
    target: { value: "Purchased add-on" },
  });
  vi.mocked(platformApi.changeModule).mockRejectedValue(new Error("Audit unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Save add-on access" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Audit unavailable");
  expect(screen.getByLabelText("Change reason")).toHaveValue("Purchased add-on");
  rerender(<CompanyAdministration id="company-a" tab="activity" onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Next audit page" }));
  await waitFor(() => expect(platformApi.audit).toHaveBeenLastCalledWith("company-a", 2));
});

it("lets the operator back out of cancellation without changing access", async () => {
  render(<CompanyAdministration id="company-a" onChange={vi.fn()} />);
  await screen.findByLabelText("Change reason");
  fireEvent.change(screen.getByLabelText("Change reason"), {
    target: { value: "Closure requested" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel company" }));
  expect(screen.getByRole("group", { name: "Confirm company access change" })).toHaveTextContent(
    "blocked from signing in",
  );
  fireEvent.click(screen.getByRole("button", { name: "Keep current access" }));
  expect(screen.queryByRole("button", { name: "Confirm cancellation" })).not.toBeInTheDocument();
  expect(platformApi.lifecycle).not.toHaveBeenCalled();
});
