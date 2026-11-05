import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import { assistantQuestions } from "@glampro_suite/shared";
import AssistantQuestions from "./AssistantQuestions";

const { useAuth, post } = vi.hoisted(() => ({ useAuth: vi.fn(), post: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth }));
vi.mock("@/lib/api", () => ({ post }));
const profile = (
  role = "MANAGER",
  id = "salon",
  codes = ["dashboard", "reports", "customers", "appointments", "catalogue"],
) => ({
  user: { id: "manager", globalRole: role },
  tenant: { id },
  entitlements: codes.map((code) => ({ code })),
});
const facts = {
  incomeToday: "100.01",
  completedSalePaid: "100.01",
  refundsToday: "5.25",
  netPaid: "94.76",
  salesToday: 3,
  averageTicket: "33.34",
  appointmentsToday: 8,
  newCustomersToday: 2,
  lowStockCount: 1,
  lowStockThreshold: 4,
  timeZone: "Asia/Singapore",
  from: "2026-10-23T16:00:00.000Z",
  to: "2026-10-24T16:00:00.000Z",
  asOf: "2026-10-24T01:00:00.000Z",
};
const answered = (overrides = {}) => ({
  status: "answered",
  mode: "deterministic",
  topic: "summary",
  answer: "Verified business answer.",
  evidence: facts,
  source: "owner-metrics",
  asOf: facts.asOf,
  limitations: ["No profit claim."],
  suggestions: [],
  ...overrides,
});
const mount = () =>
  render(
    <MemoryRouter>
      <AssistantQuestions />
    </MemoryRouter>,
  );
const ask = (question: string, key: "Enter" | " " = "Enter", shiftKey = false) => {
  const box = screen.getByLabelText("Your question");
  fireEvent.change(box, { target: { value: question } });
  fireEvent.keyDown(box, { key, shiftKey });
};
beforeEach(() => {
  vi.resetAllMocks();
  useAuth.mockReturnValue(profile());
  post.mockResolvedValue(answered());
});

it("opens as a conversation: greeting, seven suggestions and no request yet", () => {
  mount();
  expect(post).not.toHaveBeenCalled();
  const log = screen.getByRole("log", { name: "Conversation" });
  expect(log).toHaveTextContent("What would you like to know?");
  // The suggestions are the first thing offered, above the composer, not after Send.
  expect(within(log).getByRole("list", { name: "Suggested questions" })).toBeInTheDocument();
  for (const text of Object.values(assistantQuestions)) {
    expect(within(log).getByRole("button", { name: text })).toBeInTheDocument();
  }
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  expect(screen.getByText("0/300 · Enter sends, Shift+Enter adds a line")).toBeInTheDocument();
  expect(screen.getByText("Do not enter personal or clinical information.")).toBeInTheDocument();
});

it("sends on Enter, keeps the question in the transcript and folds the evidence away", async () => {
  mount();
  ask("How much did we take today?");
  await screen.findByText("Verified business answer.");
  expect(post).toHaveBeenCalledExactlyOnceWith("/ai-assistant/explain", {
    question: "How much did we take today?",
    period: "today",
  });
  expect(screen.getByText("How much did we take today?")).toBeInTheDocument();
  expect(screen.getByText(/^Today, salon-local · as of /)).toBeInTheDocument();
  expect(screen.getByText("Show the figures and exact period")).toBeInTheDocument();
  expect(screen.getByText("What this answer can’t tell you")).toBeInTheDocument();
  expect(screen.getByText(/2026-10-23T16:00:00.000Z/)).toHaveTextContent(
    "2026-10-24T16:00:00.000Z",
  );
  expect(screen.getByRole("link", { name: /Open reports/ })).toHaveAttribute("href", "/reports");
  expect(screen.getByLabelText("Your question")).toHaveValue("");
  // The suggestion grid steps aside once the conversation has started.
  expect(
    screen.queryByRole("button", { name: assistantQuestions.summary }),
  ).not.toBeInTheDocument();
});

it("adds a line on Shift+Enter instead of sending", () => {
  mount();
  ask("How many bookings", "Enter", true);
  expect(post).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Your question")).toHaveValue("How many bookings");
});

it("sends a suggestion chip as the first question", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: assistantQuestions.average }));
  await screen.findByText("Verified business answer.");
  expect(post).toHaveBeenCalledWith("/ai-assistant/explain", {
    question: assistantQuestions.average,
    period: "today",
  });
});

it("stamps the custom range it sent, not the current chip", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Custom" }));
  fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("To date (inclusive)"), {
    target: { value: "2026-10-07" },
  });
  ask("Any refunds?");
  await screen.findByText("Verified business answer.");
  expect(post).toHaveBeenCalledWith("/ai-assistant/explain", {
    question: "Any refunds?",
    period: "custom",
    from: "2026-10-01",
    to: "2026-10-07",
  });
  expect(
    screen.getByText(/^Custom range 2026-10-01 to 2026-10-07, salon-local/),
  ).toBeInTheDocument();
});

it("keeps an earlier answer when a later turn fails, and retries that turn in place", async () => {
  mount();
  ask("How are we doing?");
  await screen.findByText("Verified business answer.");
  post.mockRejectedValueOnce({ response: { status: 403 } });
  ask("Any refunds?");
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Verified answer unavailable");
  // The failed turn never substitutes the earlier figures, but it does not erase them either.
  expect(screen.getByText("Verified business answer.")).toBeInTheDocument();
  expect(screen.getByText("How are we doing?")).toBeInTheDocument();
  expect(screen.getByText("Any refunds?")).toBeInTheDocument();
  post.mockResolvedValueOnce(answered({ answer: "Refunds answer." }));
  fireEvent.click(screen.getByRole("button", { name: "Retry question" }));
  await screen.findByText("Refunds answer.");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(post).toHaveBeenLastCalledWith("/ai-assistant/explain", {
    question: "Any refunds?",
    period: "today",
  });
});

it("reports the rate limit and a malformed response without inventing an answer", async () => {
  mount();
  post.mockRejectedValueOnce({ response: { status: 429 } });
  ask("How is the business doing?");
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Wait 15 minutes"));
  post.mockResolvedValueOnce({ ...answered(), mode: "external" });
  ask("How many bookings?");
  await waitFor(() =>
    expect(screen.getAllByRole("alert").at(-1)).toHaveTextContent("Verified answer unavailable"),
  );
  expect(screen.queryByText("Verified business answer.")).not.toBeInTheDocument();
});

it("does not offer source links the signed-in role cannot open", async () => {
  useAuth.mockReturnValue(profile("MANAGER", "salon", ["dashboard"]));
  post.mockResolvedValue(answered({ topic: "stock", answer: "Low stock answer." }));
  mount();
  ask("What is low stock?");
  await screen.findByText("Low stock answer.");
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it.each(["STAFF", "CASHIER"])("hides the conversation for %s", (role) => {
  useAuth.mockReturnValue(profile(role));
  mount();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

it("hides the conversation without the dashboard module", () => {
  useAuth.mockReturnValue(profile("MANAGER", "salon", ["reports"]));
  mount();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

it("wipes the transcript on an identity, role or module change", async () => {
  const view = mount();
  ask("How are we doing?");
  await screen.findByText("Verified business answer.");
  useAuth.mockReturnValue(profile("MANAGER", "other"));
  view.rerender(
    <MemoryRouter>
      <AssistantQuestions />
    </MemoryRouter>,
  );
  expect(screen.queryByText("Verified business answer.")).not.toBeInTheDocument();
  expect(screen.queryByText("How are we doing?")).not.toBeInTheDocument();
  useAuth.mockReturnValue(profile("MANAGER", "other", []));
  view.rerender(
    <MemoryRouter>
      <AssistantQuestions />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
