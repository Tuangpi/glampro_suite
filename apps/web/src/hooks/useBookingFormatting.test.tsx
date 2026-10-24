import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { useBookingFormatting } from "./useBookingFormatting";
import { selectOutlet } from "@/lib/outlet-storage";
const get = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ get }));
function Consumer() {
  const { timeZone, outletReady, outletError } = useBookingFormatting();
  return <p>{outletReady ? timeZone : outletError ? "error" : "loading"}</p>;
}
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Consumer />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  selectOutlet("");
  get.mockReset();
});
it("loads the selected branch clock without changing company formatting", async () => {
  selectOutlet("west");
  get.mockResolvedValue([{ id: "west", timeZone: "America/Los_Angeles", locale: "en-US" }]);
  mount();
  expect(screen.getByText("loading")).toBeInTheDocument();
  expect(await screen.findByText("America/Los_Angeles")).toBeInTheDocument();
});
it("blocks branch booking when preferences fail instead of using the wrong clock", async () => {
  selectOutlet("west");
  get.mockRejectedValue(new Error("offline"));
  mount();
  expect(await screen.findByText("error")).toBeInTheDocument();
});
