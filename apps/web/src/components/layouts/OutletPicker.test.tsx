import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import OutletPicker from "./OutletPicker";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({ get: mocks.get }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ tenant: { id: "tenant" } }) }));
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <OutletPicker />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  sessionStorage.clear();
  mocks.get.mockResolvedValue([
    { id: "central", name: "Central", status: "ACTIVE" },
    { id: "closed", name: "Closed", status: "SUSPENDED" },
  ]);
});
it("offers consolidated mode and active outlets only", async () => {
  mount();
  expect(await screen.findByRole("option", { name: "Central" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "All outlets / tenant-wide" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Closed" })).not.toBeInTheDocument();
});
it("does not change outlet or clear drafts when switching is cancelled", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  mount();
  const picker = await screen.findByRole("combobox", { name: "Active outlet" });
  fireEvent.change(picker, { target: { value: "central" } });
  expect(confirm).toHaveBeenCalled();
  expect(sessionStorage.getItem("glampro.outlet.v1")).toBeNull();
  confirm.mockRestore();
});
it("allows recovery from an outlet that has been suspended", async () => {
  sessionStorage.setItem("glampro.outlet.v1", "closed");
  mount();
  expect(
    await screen.findByRole("option", { name: "Unavailable outlet — select another" }),
  ).toBeInTheDocument();
});
