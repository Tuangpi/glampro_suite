import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Outlets from "./Outlets";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  role: "MANAGER",
  readOnly: false,
}));
vi.mock("@/lib/api", () => ({ get: mocks.get, post: mocks.post, patch: mocks.patch }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { globalRole: mocks.role }, isReadOnly: mocks.readOnly }),
}));

function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Outlets />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "MANAGER";
  mocks.readOnly = false;
  mocks.get.mockResolvedValue([
    { id: "central", name: "Central", slug: "central", status: "ACTIVE" },
  ]);
  mocks.post.mockResolvedValue({});
  mocks.patch.mockResolvedValue({});
});
describe("outlet administration", () => {
  it("lists outlets and creates with validated contract fields", async () => {
    mount();
    expect(await screen.findByText("Central", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add outlet" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "East" } });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "east" } });
    fireEvent.click(screen.getByRole("button", { name: "Create outlet" }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/outlets", { name: "East", slug: "east" }),
    );
  });
  it("uses null for tenant-wide availability, without changing stock", async () => {
    mount();
    await screen.findByText("Central", { selector: "strong" });
    fireEvent.change(screen.getByLabelText("Catalogue item ID"), { target: { value: "product" } });
    fireEvent.click(screen.getByRole("button", { name: "Save availability" }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/outlets/assign", {
        kind: "PRODUCT",
        id: "product",
        outletId: null,
      }),
    );
  });
  it("does not offer writes to staff or suspended tenants", async () => {
    mocks.role = "STAFF";
    mount();
    await screen.findByText("Central", { selector: "strong" });
    expect(screen.queryByRole("button", { name: "Create outlet" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument();
  });
  it("suspends an outlet without deleting historical rows", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Suspend" }));
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Suspend Central?" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Confirm suspension" }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith("/outlets/central", { status: "SUSPENDED" }),
    );
  });
  it("keeps outlet management read-only for suspended tenants", async () => {
    mocks.readOnly = true;
    mount();
    await screen.findByText("Central", { selector: "strong" });
    expect(screen.queryByRole("button", { name: "Create outlet" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save availability" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add outlet" })).not.toBeInTheDocument();
    expect(screen.queryByText("Edit hours — Central")).not.toBeInTheDocument();
  });
  it("validates creation fields and closes only after successful creation", async () => {
    mount();
    await screen.findByText("Central", { selector: "strong" });
    fireEvent.click(screen.getByRole("button", { name: "Add outlet" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "Invalid Slug" } });
    fireEvent.click(screen.getByRole("button", { name: "Create outlet" }));
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Slug")).toHaveAttribute("aria-invalid", "true");
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " East " } });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "east" } });
    fireEvent.click(screen.getByRole("button", { name: "Create outlet" }));
    expect(await screen.findByRole("status")).toHaveTextContent("East outlet created.");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledWith("/outlets", { name: "East", slug: "east" });
  });
  it("allows cancelling suspension without changing the outlet", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Suspend" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.patch).not.toHaveBeenCalled();
  });
  it("shows suspension errors in the confirmation and allows retry", async () => {
    mocks.patch.mockRejectedValueOnce(new Error("offline"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Suspend" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm suspension" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not suspend Central");
    fireEvent.click(screen.getByRole("button", { name: "Confirm suspension" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Central suspended.");
  });
  it("reactivates suspended outlets and shows their status", async () => {
    mocks.get.mockResolvedValue([
      { id: "east", name: "East", slug: "east", status: "SUSPENDED", timeZone: "Asia/Singapore" },
    ]);
    mount();
    expect(await screen.findByText("Suspended")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Reactivate" }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith("/outlets/east", { status: "ACTIVE" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("East reactivated.");
  });
  it("offers a useful empty state", async () => {
    mocks.get.mockResolvedValue([]);
    mount();
    expect(await screen.findByText("No outlets yet")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Add your first outlet" }));
    expect(screen.getByLabelText("Name")).toBeVisible();
  });
  it("shows loading and retries a failed outlet list", async () => {
    mocks.get.mockRejectedValueOnce(new Error("offline"));
    mount();
    expect(screen.getByLabelText("Loading outlets")).toHaveAttribute("aria-busy", "true");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load outlets");
    expect(screen.queryByRole("button", { name: "Save availability" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry outlets" }));
    expect(await screen.findByText("Central", { selector: "strong" })).toBeVisible();
  });
  it("isolates creation errors from catalogue availability feedback", async () => {
    mocks.post.mockRejectedValueOnce(new Error("duplicate"));
    mount();
    await screen.findByText("Central", { selector: "strong" });
    fireEvent.click(screen.getByRole("button", { name: "Add outlet" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "East" } });
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "east" } });
    fireEvent.click(screen.getByRole("button", { name: "Create outlet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not create the outlet");
    fireEvent.change(screen.getByLabelText("Catalogue item ID"), { target: { value: "product" } });
    fireEvent.click(screen.getByRole("button", { name: "Save availability" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Catalogue availability saved.");
    expect(screen.getByLabelText("Name")).toHaveValue("East");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not create the outlet");
  });
  it("validates catalogue IDs and assigns packages only to active outlets", async () => {
    mocks.get.mockResolvedValue([
      { id: "central", name: "Central", slug: "central", status: "ACTIVE" },
      { id: "east", name: "East", slug: "east", status: "SUSPENDED" },
    ]);
    mount();
    await screen.findByText("Central", { selector: "strong" });
    fireEvent.click(screen.getByRole("button", { name: "Save availability" }));
    expect(screen.getByLabelText("Catalogue item ID")).toHaveAttribute("aria-invalid", "true");
    expect(mocks.post).not.toHaveBeenCalled();
    expect(screen.queryByRole("option", { name: "East" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Item type"), { target: { value: "PACKAGE" } });
    fireEvent.change(screen.getByLabelText("Catalogue item ID"), {
      target: { value: " package " },
    });
    fireEvent.change(screen.getByLabelText("Available at"), { target: { value: "central" } });
    fireEvent.click(screen.getByRole("button", { name: "Save availability" }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/outlets/assign", {
        kind: "PACKAGE",
        id: "package",
        outletId: "central",
      }),
    );
  });
});
