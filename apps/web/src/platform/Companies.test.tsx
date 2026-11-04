import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import CompaniesPage from "./CompaniesPage";
import CompanyDetailPage from "./CompanyDetailPage";
import CreateCompanyPage from "./CreateCompanyPage";
import { platformApi } from "./api";

vi.mock("./CompanyAdministration", () => ({ default: () => <p>Administration controls</p> }));
vi.mock("./api", () => ({
  platformApi: {
    companies: vi.fn(),
    company: vi.fn(),
    createCompany: vi.fn(),
    resendInvitation: vi.fn(),
    deleteCompany: vi.fn(),
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

/** The three company routes, so each page is reached the way an operator reaches it. */
function Harness({ path = "/platform" }: { path?: string }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/platform" element={<CompaniesPage />} />
        <Route path="/platform/companies/new" element={<CreateCompanyPage />} />
        <Route path="/platform/companies/:id" element={<CompanyDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

async function fillCreateForm(values: Record<string, string> = {}) {
  await screen.findByLabelText("Company name");
  for (const [label, value] of [
    ["Company name", values.name ?? "Salon A"],
    ["Company slug", values.slug ?? "salon-a"],
    ["Owner name", "Owner A"],
    ["Owner email", "owner@example.test"],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

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

it("loads searchable companies, opens one and resends a pending invitation", async () => {
  render(<Harness />);

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
  fireEvent.change(await screen.findByLabelText("Search companies"), {
    target: { value: "salon" },
  });
  await waitFor(() => expect(platformApi.companies).toHaveBeenLastCalledWith("salon", 1));
});

it("keeps the company name and the invitation apart when delivery fails", async () => {
  render(<Harness />);
  await screen.findByRole("button", { name: "Salon A" });

  fireEvent.click(screen.getByRole("button", { name: "Create company" }));
  vi.mocked(platformApi.createCompany).mockResolvedValue({ company, invitationDelivery: "failed" });
  await fillCreateForm();

  fireEvent.click(screen.getByRole("button", { name: "Create company and invite owner" }));
  await screen.findByText(/Company created, but invitation email failed/);
  expect(platformApi.createCompany).toHaveBeenCalledOnce();
  // Creation succeeded, so the form is gone and the resend offer is on the company page.
  expect(screen.queryByLabelText("Company name")).not.toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "Resend invitation" })).toBeInTheDocument();
});

it("displays create errors and preserves form values for correction", async () => {
  render(<Harness path="/platform/companies/new" />);
  vi.mocked(platformApi.createCompany).mockRejectedValue(new Error("Slug already used"));
  await fillCreateForm();

  fireEvent.click(screen.getByRole("button", { name: "Create company and invite owner" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Slug already used");
  expect(screen.getByLabelText("Company name")).toHaveValue("Salon A");
  expect(screen.getByLabelText("Company slug")).toHaveValue("salon-a");
});

it("keeps the tab panels mounted and moves between them with the arrow keys", async () => {
  render(<Harness path="/platform/companies/company-a" />);
  await screen.findByRole("article", { name: "Company details" });

  const overview = screen.getByRole("tab", { name: "Overview" });
  overview.focus();
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
  render(<Harness />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
  fireEvent.click(screen.getByRole("button", { name: "Refresh companies" }));
  await screen.findByRole("button", { name: "Salon A" });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("refuses to purge until the slug is typed back, then returns to the directory", async () => {
  render(<Harness />);
  fireEvent.click(await screen.findByRole("button", { name: "Salon A" }));
  await screen.findByRole("article", { name: "Company details" });

  fireEvent.click(screen.getByRole("button", { name: "Delete this company permanently" }));
  const remove = screen.getByRole("button", { name: "Delete company permanently" });
  expect(remove).toBeDisabled();

  // A reason alone is not enough: the slug is the last line of defence.
  fireEvent.change(screen.getByLabelText("Reason for deletion"), {
    target: { value: "Customer asked us to erase their data" },
  });
  expect(remove).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Type the slug to confirm"), {
    target: { value: "salon-b" },
  });
  expect(remove).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Type the slug to confirm"), {
    target: { value: "salon-a" },
  });
  expect(remove).toBeEnabled();

  vi.mocked(platformApi.deleteCompany).mockResolvedValue({
    purged: true,
    company: { id: company.id, name: company.name, slug: company.slug },
    deletedRows: 42,
  });
  fireEvent.click(remove);

  await screen.findByText(/Deleted Salon A: 42 rows removed/);
  expect(platformApi.deleteCompany).toHaveBeenCalledWith("company-a", {
    confirmSlug: "salon-a",
    reason: "Customer asked us to erase their data",
  });
  // The page is gone and the directory has been re-read without the company.
  expect(screen.queryByRole("article", { name: "Company details" })).not.toBeInTheDocument();
  await waitFor(() => expect(platformApi.companies).toHaveBeenCalledTimes(2));
});

it("keeps the company when the server rejects the purge", async () => {
  render(<Harness path="/platform/companies/company-a" />);
  await screen.findByRole("article", { name: "Company details" });

  fireEvent.click(screen.getByRole("button", { name: "Delete this company permanently" }));
  fireEvent.change(screen.getByLabelText("Reason for deletion"), {
    target: { value: "Customer asked us to erase their data" },
  });
  fireEvent.change(screen.getByLabelText("Type the slug to confirm"), {
    target: { value: "salon-a" },
  });
  vi.mocked(platformApi.deleteCompany).mockRejectedValue(
    new Error("Type salon-a to confirm this purge."),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete company permanently" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Type salon-a to confirm this purge.");
  // The company is untouched and the confirmation keeps what was typed.
  expect(screen.getByRole("article", { name: "Company details" })).toBeInTheDocument();
  expect(screen.getByLabelText("Reason for deletion")).toHaveValue(
    "Customer asked us to erase their data",
  );
});
