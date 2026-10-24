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

const outcome = {
  asOf: "2026-10-24T12:00:00.000Z",
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-10-24T12:00:00.000Z",
  windowDays: 30,
  jobStatus: "ACCEPTED",
  delivery: "not_confirmed",
  bookingsCreated: 2,
  completedSales: 1,
  salesVisible: true,
  limitations: [
    "Same-customer observations, not attributed conversions. Do not sum across drafts.",
  ],
};
it("loads observed activity only on request with window and attribution limits", async () => {
  get.mockImplementation(async (path: string) =>
    path.endsWith("/outcome") ? outcome : { drafts: [draft], nextCursor: null },
  );
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Toggle observed outcomes" }));
  await screen.findByText("Delivery not confirmed.");
  expect(screen.getByText(/Bookings created/)).toHaveTextContent("2");
  expect(screen.getByText(/Completed receipts/)).toHaveTextContent("1");
  expect(screen.getByText(/UTC observation window/)).toHaveTextContent(outcome.from);
  expect(screen.getByText(/not attributed conversions/)).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
it("hides prior observations after a failed refresh and offers read-only recovery", async () => {
  get
    .mockResolvedValueOnce({ drafts: [draft], nextCursor: null })
    .mockResolvedValueOnce(outcome)
    .mockRejectedValueOnce(new Error("source failed"));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Toggle observed outcomes" }));
  await screen.findByText(/Bookings created/);
  fireEvent.click(screen.getByRole("button", { name: "Reload observed outcomes" }));
  await screen.findByText(/Observed outcomes unavailable/);
  expect(screen.queryByText(/Bookings created/)).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
it("distinguishes unqueued drafts from zero observations", async () => {
  get.mockImplementation(async (path: string) =>
    path.endsWith("/outcome")
      ? {
          ...outcome,
          from: null,
          to: null,
          jobStatus: null,
          delivery: "not_queued",
          bookingsCreated: null,
          completedSales: null,
        }
      : { drafts: [draft], nextCursor: null },
  );
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Toggle observed outcomes" }));
  await screen.findByText("Not queued; no observation window.");
  expect(screen.queryByText(/Bookings created/)).not.toBeInTheDocument();
});

it("shows provider-reported delivery without claiming reading and hides unentitled sales", async () => {
  get.mockImplementation(async (path: string) =>
    path.endsWith("/outcome")
      ? {
          ...outcome,
          jobStatus: "DELIVERED",
          delivery: "provider_reported_delivered",
          salesVisible: false,
          completedSales: null,
        }
      : { drafts: [draft], nextCursor: null },
  );
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Toggle observed outcomes" }));
  await screen.findByText("Provider-reported delivery, not proof of reading or action.");
  expect(screen.getByText(/Completed receipts/)).toHaveTextContent("Sales module required");
});

it("rejects malformed observations rather than presenting unchecked figures", async () => {
  get.mockImplementation(async (path: string) =>
    path.endsWith("/outcome")
      ? { ...outcome, bookingsCreated: -1 }
      : { drafts: [draft], nextCursor: null },
  );
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Toggle observed outcomes" }));
  await screen.findByText(/Observed outcomes unavailable/);
  expect(screen.queryByText(/Bookings created/)).not.toBeInTheDocument();
});
