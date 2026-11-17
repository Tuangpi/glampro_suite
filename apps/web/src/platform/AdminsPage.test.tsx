import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import AdminsPage from "./AdminsPage";
import { platformApi } from "./api";

vi.mock("./api", () => ({ platformApi: { admins: vi.fn(), createAdmin: vi.fn() } }));
const admin = {
  id: "operator",
  name: "Operator",
  email: "operator@example.test",
  status: "ACTIVE" as const,
  twoFactorEnabled: true,
  createdAt: "2026-11-17T00:00:00.000Z",
  lastLoginAt: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(platformApi.admins).mockResolvedValue({
    items: [admin],
    total: 1,
    page: 1,
    pageSize: 20,
  });
  vi.mocked(platformApi.createAdmin).mockResolvedValue({ ...admin, id: "new", name: "New admin" });
});
async function fillForm(confirmation = "unique-private-passphrase") {
  fireEvent.click(screen.getByRole("button", { name: "Add platform admin" }));
  for (const [label, value] of [
    ["Name", "New admin"],
    ["Email", "new@example.test"],
    ["Initial password", "unique-private-passphrase"],
    ["Confirm initial password", confirmation],
    ["Reason for granting access", "Support coverage"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create platform admin" }));
  });
}
it("lists admins and identifies the current operator without exposing secrets", async () => {
  render(<AdminsPage currentAdminId="operator" />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading admins");
  expect(await screen.findByText(admin.email)).toBeInTheDocument();
  expect(screen.getByText("You")).toBeInTheDocument();
  expect(screen.getByText("Never")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
});
it("creates an admin, clears secrets, and refreshes the directory", async () => {
  render(<AdminsPage currentAdminId="operator" />);
  await screen.findByText(admin.email);
  await fillForm();
  expect(await screen.findByText(/New admin was added/)).toBeInTheDocument();
  expect(platformApi.createAdmin).toHaveBeenCalledWith({
    name: "New admin",
    email: "new@example.test",
    password: "unique-private-passphrase",
    reason: "Support coverage",
  });
  await waitFor(() => expect(platformApi.admins).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Add platform admin" }));
  expect(screen.getByLabelText("Initial password")).toHaveValue("");
});
it("rejects mismatched confirmation without sending a request", async () => {
  render(<AdminsPage currentAdminId="operator" />);
  await fillForm("different-private-passphrase");
  expect(await screen.findByRole("alert")).toHaveTextContent("The two passwords do not match.");
  expect(platformApi.createAdmin).not.toHaveBeenCalled();
});
it("reports duplicate or failed creation and clears passwords while retaining non-secret fields", async () => {
  vi.mocked(platformApi.createAdmin).mockRejectedValue(new Error("Email already exists."));
  render(<AdminsPage currentAdminId="operator" />);
  await fillForm();
  expect(await screen.findByRole("alert")).toHaveTextContent("Email already exists.");
  expect(screen.getByLabelText("Initial password")).toHaveValue("");
  expect(screen.getByLabelText("Confirm initial password")).toHaveValue("");
  expect(screen.getByLabelText("Name")).toHaveValue("New admin");
});
it("allows retry after a directory error and searches with pagination reset", async () => {
  vi.mocked(platformApi.admins).mockRejectedValueOnce(new Error("Offline"));
  render(<AdminsPage currentAdminId="operator" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText(admin.email);
  vi.mocked(platformApi.admins).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  fireEvent.change(screen.getByLabelText("Search admins"), { target: { value: " missing " } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(await screen.findByText("No admins found.")).toBeInTheDocument();
  expect(platformApi.admins).toHaveBeenLastCalledWith(1, "missing");
});
it("paginates the directory and clears secrets when creation is cancelled", async () => {
  vi.mocked(platformApi.admins).mockResolvedValue({
    items: [admin],
    total: 21,
    page: 1,
    pageSize: 20,
  });
  render(<AdminsPage currentAdminId="operator" />);
  await screen.findByText(admin.email);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(platformApi.admins).toHaveBeenLastCalledWith(2, ""));
  await screen.findByText("Page 2");
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  await waitFor(() => expect(platformApi.admins).toHaveBeenLastCalledWith(1, ""));
  await screen.findByText("Page 1");
  fireEvent.click(screen.getByRole("button", { name: "Add platform admin" }));
  fireEvent.change(screen.getByLabelText("Initial password"), {
    target: { value: "private-passphrase" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Add platform admin" }));
  expect(screen.getByLabelText("Initial password")).toHaveValue("");
  expect(platformApi.createAdmin).not.toHaveBeenCalled();
});
