import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import OutletHoursEditor from "./OutletHoursEditor";

const patch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ patch }));
const outlet = {
  id: "east",
  name: "East",
  slug: "east",
  status: "ACTIVE",
  address: null,
  phone: null,
  timeZone: "Asia/Singapore",
  locale: "en-SG",
  operatingHours: null,
};
function mount() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <OutletHoursEditor outlet={outlet} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  patch.mockReset();
  patch.mockResolvedValue(outlet);
});
it("saves a full override, distinguishes closed days and resets inheritance", async () => {
  mount();
  fireEvent.click(screen.getByText("Edit hours — East"));
  fireEvent.click(screen.getByLabelText("Use company hours"));
  fireEvent.click(screen.getAllByLabelText("Open")[0]!);
  fireEvent.change(screen.getByLabelText("monday opens"), { target: { value: "10:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Save outlet hours" }));
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith("/outlets/east", {
      timeZone: "Asia/Singapore",
      operatingHours: {
        monday: { open: "10:00", close: "18:00" },
        tuesday: null,
        wednesday: null,
        thursday: null,
        friday: null,
        saturday: null,
        sunday: null,
      },
    }),
  );
  await screen.findByText("Outlet hours saved.");
  fireEvent.click(screen.getByLabelText("Use company hours"));
  fireEvent.click(screen.getByRole("button", { name: "Save outlet hours" }));
  await waitFor(() =>
    expect(patch).toHaveBeenLastCalledWith("/outlets/east", {
      timeZone: "Asia/Singapore",
      operatingHours: null,
    }),
  );
});
it("rejects reversed times and surfaces save failures", async () => {
  mount();
  fireEvent.click(screen.getByText("Edit hours — East"));
  fireEvent.click(screen.getByLabelText("Use company hours"));
  fireEvent.click(screen.getAllByLabelText("Open")[0]!);
  fireEvent.change(screen.getByLabelText("monday closes"), { target: { value: "08:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Save outlet hours" }));
  expect(screen.getByRole("alert")).toHaveTextContent("closing must be later");
  expect(patch).not.toHaveBeenCalled();
  patch.mockRejectedValue(new Error("offline"));
  fireEvent.change(screen.getByLabelText("monday closes"), { target: { value: "18:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Save outlet hours" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("could not be saved");
});
it("validates time zones before saving and clears saved feedback on edits", async () => {
  mount();
  fireEvent.click(screen.getByText("Edit hours — East"));
  fireEvent.change(screen.getByLabelText("East time zone"), { target: { value: "not-a-zone" } });
  fireEvent.click(screen.getByRole("button", { name: "Save outlet hours" }));
  expect(screen.getByLabelText("East time zone")).toHaveAttribute("aria-invalid", "true");
  expect(patch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("East time zone"), {
    target: { value: "Asia/Singapore" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save outlet hours" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Outlet hours saved.");
  fireEvent.click(screen.getByLabelText("Use company hours"));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
it("keeps custom hours while collapsing and reopening the editor", () => {
  mount();
  fireEvent.click(screen.getByText("Edit hours — East"));
  fireEvent.click(screen.getByLabelText("Use company hours"));
  fireEvent.click(screen.getAllByLabelText("Open")[0]!);
  fireEvent.change(screen.getByLabelText("monday opens"), { target: { value: "11:00" } });
  fireEvent.click(screen.getByText("Edit hours — East"));
  fireEvent.click(screen.getByText("Edit hours — East"));
  expect(screen.getByLabelText("monday opens")).toHaveValue("11:00");
});
