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
    fireEvent.change(screen.getByLabelText("Item ID"), { target: { value: "product" } });
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
    await screen.findByText("Central");
    expect(screen.queryByRole("button", { name: "Create outlet" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument();
  });
  it("suspends an outlet without deleting historical rows", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Suspend" }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith("/outlets/central", { status: "SUSPENDED" }),
    );
  });
});
