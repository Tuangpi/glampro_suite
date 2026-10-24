import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import RebookingRecommendations from "./RebookingRecommendations";

const { useAuth, get, post, patch } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth }));
vi.mock("@/lib/api", () => ({ get, post, patch }));
vi.mock("./AssistantDraftReview", () => ({ default: () => null, draftKey: ["saved-drafts"] }));
const profile = (role = "MANAGER", codes = ["dashboard", "customers", "appointments"]) => ({
  user: { id: "owner", globalRole: role },
  tenant: { id: "salon" },
  entitlements: codes.map((code) => ({ code })),
});
const nudge = {
  customerId: "customer",
  customerName: "Ava",
  email: "",
  appointmentId: "visit",
  lastServiceDate: "2026-07-02",
  serviceName: "Facial",
  suggestedRebookDate: "2026-10-25",
  daysSinceLastService: 114,
  serviceInterval: 45,
  intervalSource: "service",
  channel: "SMS",
  destination: "+6591234567",
  message: "Would you like to rebook?",
  draftId: "draft",
};
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RebookingRecommendations />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  useAuth.mockReturnValue(profile());
  get.mockResolvedValue([nudge]);
});

it.each(["SUPER_ADMIN", "MANAGER"])(
  "provides editable SMS drafts without implicit approval or sending for %s",
  async (role) => {
    useAuth.mockReturnValue(profile(role));
    mount();
    const draft = await screen.findByRole("textbox", { name: "Draft for Ava" });
    fireEvent.change(draft, { target: { value: "My edited draft" } });
    expect(draft).toHaveValue("My edited draft");
    expect(screen.getByText(/45-day interval \(service\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save SMS draft" })).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith("/ai-assistant/rebooking-nudges");
  },
);
it("saves explicit edited SMS content without approval or queueing", async () => {
  post.mockResolvedValue({ id: "saved" });
  mount();
  fireEvent.change(await screen.findByRole("textbox"), {
    target: { value: "My approved-for-review text" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save SMS draft" }));
  await screen.findByText(/Draft saved/);
  expect(post).toHaveBeenCalledExactlyOnceWith("/ai-assistant/drafts", {
    customerId: "customer",
    appointmentId: "visit",
    channel: "SMS",
    destination: "+6591234567",
    message: "My approved-for-review text",
  });
});
it("gates WhatsApp instead of substituting an SMS channel", async () => {
  get.mockResolvedValue([{ ...nudge, channel: "WHATSAPP" }]);
  mount();
  await screen.findByText(/WhatsApp approval and delivery are gated/);
  expect(screen.queryByRole("button", { name: "Save SMS draft" })).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
it.each(["STAFF", "CASHIER"])("does not request recommendations for %s", (role) => {
  useAuth.mockReturnValue(profile(role));
  mount();
  expect(get).not.toHaveBeenCalled();
});
it("does not request recommendations without all source entitlements", () => {
  useAuth.mockReturnValue(profile("MANAGER", ["dashboard"]));
  mount();
  expect(get).not.toHaveBeenCalled();
});
it("shows empty and error states, hides old drafts and allows retry", async () => {
  get
    .mockResolvedValueOnce([nudge])
    .mockRejectedValueOnce({ response: { status: 403 } })
    .mockResolvedValueOnce([]);
  mount();
  await screen.findByRole("textbox");
  fireEvent.click(screen.getByRole("button", { name: "Refresh recommendations" }));
  await screen.findByText(/Recommendations unavailable/);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh recommendations" }));
  await screen.findByText(/No eligible recommendations/);
});
it("removes open drafts on role loss", async () => {
  const view = mount();
  await screen.findByRole("textbox");
  useAuth.mockReturnValue(profile("STAFF"));
  view.rerender(<RebookingRecommendations />);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
it("rejects malformed responses instead of displaying them", async () => {
  get.mockResolvedValue([{ ...nudge, channel: "EMAIL" }]);
  mount();
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Recommendations unavailable"),
  );
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
