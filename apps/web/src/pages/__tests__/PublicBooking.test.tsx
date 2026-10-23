import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PublicBooking from "@/pages/PublicBooking";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({
  default: mocks,
  getErrorMessage: () => "That time is no longer available.",
}));
const slot = "2099-06-15T02:00:00.000Z";
const config = {
  tenant: { name: "Booking Salon", slug: "salon", timeZone: "Asia/Singapore", locale: "en-SG" },
  depositAmount: 2000,
  noShowFee: 1000,
  services: [{ id: "facial", name: "Facial", durationMinutes: 60, price: "50.00" }],
  privacyNotice: {
    id: "notice-1",
    version: "v1",
    dataConsentText: "Use details only to arrange my appointment.",
  },
  hours: null,
};
function mount() {
  return render(
    <MemoryRouter initialEntries={["/book/salon"]}>
      <Routes>
        <Route path="/book/:slug" element={<PublicBooking />} />
      </Routes>
    </MemoryRouter>,
  );
}
async function selectDate(day = "2099-06-15") {
  const user = userEvent.setup();
  await screen.findByText("Booking Salon — Book online");
  await user.selectOptions(screen.getByLabelText("Service"), "facial");
  await user.clear(screen.getByLabelText("Date"));
  await user.type(screen.getByLabelText("Date"), day);
  await waitFor(() =>
    expect(mocks.get).toHaveBeenCalledWith("/public/booking/salon/availability", {
      params: { serviceId: "facial", date: day },
    }),
  );
  return user;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockImplementation(async (path: string) => ({
    data: { data: path.endsWith("availability") ? { slots: [slot] } : config },
  }));
  mocks.post.mockResolvedValue({
    data: { data: { message: "Booking created. No payment was collected online." } },
  });
});

describe("public booking", () => {
  it("shows actual consent wording, salon timezone and manual payment terms", async () => {
    mount();
    await screen.findByText(config.privacyNotice.dataConsentText);
    expect(
      screen.getByText(/All appointment times are shown in Asia\/Singapore/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Deposit required: SGD\s*20.00/)).toBeInTheDocument();
    expect(
      screen.getByText(/No payment is collected or automatically charged/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Book" })).toBeDisabled();
  });
  it("submits versioned consent only after all required selections and blocks repeat submission", async () => {
    mount();
    const user = await selectDate();
    const label = new Intl.DateTimeFormat("en-SG", {
      timeZone: "Asia/Singapore",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(slot));
    await screen.findByRole("option", { name: label });
    await user.selectOptions(screen.getByLabelText("Time slot"), slot);
    await user.type(screen.getByLabelText("Name"), "Visitor");
    await user.type(screen.getByLabelText("Phone"), "+6591234567");
    expect(screen.getByRole("button", { name: "Book" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Book" }));
    await screen.findByText("Booking created. No payment was collected online.");
    expect(mocks.post).toHaveBeenCalledWith("/public/booking/salon", {
      serviceId: "facial",
      startsAt: slot,
      customerName: "Visitor",
      customerPhone: "+6591234567",
      customerEmail: null,
      consentGiven: true,
      noticeId: "notice-1",
    });
    expect(screen.getByRole("button", { name: "Book" })).toBeDisabled();
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
  it("clears a selected slot immediately when the date changes", async () => {
    mount();
    const user = await selectDate();
    await waitFor(() =>
      expect(screen.getByLabelText("Time slot").querySelectorAll("option")).toHaveLength(2),
    );
    await user.selectOptions(screen.getByLabelText("Time slot"), slot);
    mocks.get.mockImplementation(() => new Promise(() => {}));
    await user.clear(screen.getByLabelText("Date"));
    await user.type(screen.getByLabelText("Date"), "2099-06-16");
    expect(screen.getByLabelText("Time slot")).toHaveValue("");
    expect(screen.queryByRole("option", { name: /10:00/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Book" })).toBeDisabled();
  });
  it("reports availability failures rather than silently claiming there are no slots", async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path.endsWith("availability")) throw new Error("offline");
      return { data: { data: config } };
    });
    mount();
    await selectDate();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Available times could not be loaded",
    );
    expect(screen.queryByText("No available times on this date.")).not.toBeInTheDocument();
  });
  it("disables booking if no privacy notice is published", async () => {
    mocks.get.mockResolvedValue({ data: { data: { ...config, privacyNotice: null } } });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("published privacy notice");
    expect(screen.getByRole("button", { name: "Book" })).toBeDisabled();
  });
  it("ignores an older availability response after the date changes", async () => {
    let resolveOld: (value: unknown) => void = () => {};
    mocks.get.mockImplementation((path: string, options?: { params: { date: string } }) => {
      if (!path.endsWith("availability")) return Promise.resolve({ data: { data: config } });
      if (options?.params.date === "2099-06-15") {
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      }
      return Promise.resolve({ data: { data: { slots: [] } } });
    });
    mount();
    const user = await selectDate();
    await user.clear(screen.getByLabelText("Date"));
    await user.type(screen.getByLabelText("Date"), "2099-06-16");
    await screen.findByText("No available times on this date.");
    resolveOld({ data: { data: { slots: [slot] } } });
    await waitFor(() =>
      expect(screen.getByLabelText("Time slot").querySelectorAll("option")).toHaveLength(1),
    );
    expect(screen.getByRole("button", { name: "Book" })).toBeDisabled();
  });
  it("clears a rejected slot and displays the server failure", async () => {
    mocks.post.mockRejectedValue(new Error("conflict"));
    mount();
    const user = await selectDate();
    await waitFor(() =>
      expect(screen.getByLabelText("Time slot").querySelectorAll("option")).toHaveLength(2),
    );
    await user.selectOptions(screen.getByLabelText("Time slot"), slot);
    await user.type(screen.getByLabelText("Name"), "Visitor");
    await user.type(screen.getByLabelText("Phone"), "+6591234567");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Book" }));
    await screen.findByText("That time is no longer available.");
    expect(screen.getByLabelText("Time slot")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Book" })).toBeDisabled();
  });
});
