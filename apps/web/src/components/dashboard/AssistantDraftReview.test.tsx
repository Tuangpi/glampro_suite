import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import AssistantDraftReview from "./AssistantDraftReview";

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/api", () => ({ get, post, patch }));
const draft = {
  id: "draft",
  customerId: "customer",
  appointmentId: "visit",
  channel: "SMS",
  destination: "+6591234567",
  message: "Rebook?",
  body: "Salon: Rebook? Unsubscribe: https://salon.example.test/token",
  sender: "Salon",
  version: 2,
  status: "DRAFT",
  reviewDueAt: "2026-11-23T00:00:00.000Z",
  job: null,
};
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AssistantDraftReview tenantId="salon" userId="manager" />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue({ drafts: [draft], nextCursor: null });
});
it("displays exact provider body and explicitly approves the displayed version", async () => {
  mount();
  await screen.findByText(draft.body);
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Approve version 2" }));
  expect(post).toHaveBeenCalledWith("/ai-assistant/drafts/draft/approve", { expectedVersion: 2 });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Approve version 2" })).not.toBeDisabled(),
  );
});
it("invalidates approval when editing and requires a new saved preview", async () => {
  get.mockResolvedValue({ drafts: [{ ...draft, status: "APPROVED" }], nextCursor: null });
  mount();
  fireEvent.change(await screen.findByRole("textbox", { name: "Edit saved message" }), {
    target: { value: "Changed" },
  });
  expect(screen.getByRole("button", { name: /Queue approved SMS/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Save new version/ }));
  expect(patch).toHaveBeenCalledWith("/ai-assistant/drafts/draft", {
    customerId: "customer",
    appointmentId: "visit",
    channel: "SMS",
    destination: "+6591234567",
    message: "Changed",
    expectedVersion: 2,
  });
  expect(post).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Edit saved message" })).not.toBeDisabled(),
  );
});
it("queues only after explicit action and shows failure without claiming a send", async () => {
  get.mockResolvedValue({ drafts: [{ ...draft, status: "APPROVED" }], nextCursor: null });
  post.mockRejectedValue(new Error("stale"));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Queue approved SMS/ }));
  await screen.findByRole("alert");
  expect(post).toHaveBeenCalledExactlyOnceWith("/ai-assistant/drafts/draft/queue", {
    expectedVersion: 2,
  });
  expect(screen.getByRole("alert")).toHaveTextContent("Nothing is confirmed sent");
});
it("shows uncertain outcome without resend controls", async () => {
  get.mockResolvedValue({
    drafts: [
      {
        ...draft,
        status: "QUEUED",
        job: { id: "job", status: "UNCERTAIN", errorCode: "PROVIDER_UNCERTAIN" },
      },
    ],
    nextCursor: null,
  });
  mount();
  await screen.findByText(/Queue outcome: UNCERTAIN/);
  expect(
    screen.queryByRole("button", { name: /queue|approve|retry|resend/i }),
  ).not.toBeInTheDocument();
});
it("supports paginated review and unavailable states", async () => {
  get
    .mockResolvedValueOnce({ drafts: [draft], nextCursor: "next" })
    .mockRejectedValueOnce(new Error("denied"));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Next page" }));
  await screen.findByText(/Saved drafts unavailable/);
  expect(get).toHaveBeenLastCalledWith("/ai-assistant/drafts", { cursor: "next" });
  expect(screen.queryByText(draft.body)).not.toBeInTheDocument();
});
