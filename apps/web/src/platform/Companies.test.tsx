import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import Companies from "./Companies";
import { platformApi } from "./api";
vi.mock("./CompanyAdministration", () => ({ default: () => <p>Administration controls</p> }));

vi.mock("./api", () => ({
  platformApi: {
    companies: vi.fn(),
    company: vi.fn(),
    createCompany: vi.fn(),
    resendInvitation: vi.fn(),
  },
}));
const company = {
  id: "company-a",
  name: "Salon A",
  slug: "salon-a",
  status: "ACTIVE" as const,
  createdAt: new Date().toISOString(),
  owner: { id: "owner-a", name: "Owner A", email: "owner@example.test", disabled: true },
  invitation: {
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    acceptedAt: null,
    revokedAt: null,
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(platformApi.companies).mockResolvedValue({
    items: [company],
    total: 1,
    page: 1,
    pageSize: 20,
  });
  vi.mocked(platformApi.company).mockResolvedValue(company);
});
it("loads searchable companies, opens details and resends a pending invitation", async () => {
  render(<Companies />);
  fireEvent.click(await screen.findByRole("button", { name: "Salon A" }));
  expect(await screen.findByRole("article", { name: "Company details" })).toHaveTextContent(
    "owner@example.test",
  );
  vi.mocked(platformApi.resendInvitation).mockResolvedValue({
    company,
    invitationDelivery: "sent",
  });
  fireEvent.click(screen.getByRole("button", { name: "Resend invitation" }));
  await screen.findByText("New invitation sent. Previous links are invalid.");
  expect(platformApi.resendInvitation).toHaveBeenCalledWith("company-a");
  fireEvent.click(screen.getByRole("button", { name: /Back to companies/ }));
  fireEvent.change(screen.getByLabelText("Search companies"), { target: { value: "salon" } });
  await waitFor(() => expect(platformApi.companies).toHaveBeenLastCalledWith("salon", 1));
});
it("creates a company and distinguishes failed email delivery from failed creation", async () => {
  render(<Companies />);
  await screen.findByRole("button", { name: "Salon A" });
  fireEvent.click(screen.getByRole("button", { name: "+ Create company" }));
  vi.mocked(platformApi.createCompany).mockResolvedValue({ company, invitationDelivery: "failed" });
  for (const [label, value] of [
    ["Company name", "Salon A"],
    ["Company slug", "salon-a"],
    ["Owner name", "Owner A"],
    ["Owner email", "owner@example.test"],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Create company and invite owner" }));
  await screen.findByText(/Company created, but invitation email failed/);
  expect(platformApi.createCompany).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText("Company name")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Resend invitation" })).toBeInTheDocument();
});
it("displays create errors and preserves form values for correction", async () => {
  render(<Companies />);
  fireEvent.click(screen.getByRole("button", { name: "+ Create company" }));
  vi.mocked(platformApi.createCompany).mockRejectedValue(new Error("Slug already used"));
  for (const [label, value] of [
    ["Company name", "Salon A"],
    ["Company slug", "salon-a"],
    ["Owner name", "Owner A"],
    ["Owner email", "owner@example.test"],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Create company and invite owner" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Slug already used");
  expect(screen.getByLabelText("Company name")).toHaveValue("Salon A");
});

it("keeps creation separate from browsing and supports keyboard company tabs", async () => {
  render(<Companies />);
  expect(screen.queryByLabelText("Company name")).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Salon A" }));
  await screen.findByRole("article", { name: "Company details" });
  expect(screen.queryByLabelText("Search companies")).not.toBeInTheDocument();
  const overview = screen.getByRole("tab", { name: "Overview" });
  expect(overview).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(overview, { key: "ArrowRight" });
  expect(screen.getByRole("tab", { name: "Subscription" })).toHaveFocus();
  expect(screen.getByRole("tab", { name: "Subscription" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  fireEvent.keyDown(screen.getByRole("tab", { name: "Subscription" }), { key: "Home" });
  expect(overview).toHaveFocus();
  expect(screen.getByRole("tabpanel", { name: "Overview" })).toBeVisible();
});

it("shows list failures and allows retry without leaving the directory", async () => {
  vi.mocked(platformApi.companies).mockRejectedValueOnce(new Error("Connection lost"));
  render(<Companies />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
  fireEvent.click(screen.getByRole("button", { name: "Refresh companies" }));
  await screen.findByRole("button", { name: "Salon A" });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
