import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const answer = {
  status: "answered",
  mode: "deterministic",
  topic: "summary",
  answer: "Verified business answer.",
  evidence: facts,
  source: "owner-metrics",
  asOf: facts.asOf,
  limitations: ["No profit claim."],
  suggestions: [],
};
const mount = () =>
  render(
    <MemoryRouter>
      <AssistantQuestions />
    </MemoryRouter>,
  );
const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: "Explain using verified facts" }));
beforeEach(() => {
  vi.resetAllMocks();
  useAuth.mockReturnValue(profile());
  post.mockResolvedValue(answer);
});

it("does not fetch until asked and shows exact evidence with read-only source links", async () => {
  mount();
  expect(post).not.toHaveBeenCalled();
  submit();
  await screen.findByText("Verified business answer.");
  expect(post).toHaveBeenCalledExactlyOnceWith("/ai-assistant/explain", {
    question: assistantQuestions.summary,
    period: "today",
  });
  expect(screen.getByText(/2026-10-23T16:00:00.000Z/)).toHaveTextContent(
    "2026-10-24T16:00:00.000Z",
  );
  expect(screen.getByRole("link", { name: /Open reports/ })).toHaveAttribute("href", "/reports");
});
it("requires an explicit new answer when question or period changes", async () => {
  mount();
  submit();
  await screen.findByText(answer.answer);
  fireEvent.click(screen.getByRole("button", { name: assistantQuestions.average }));
  expect(screen.queryByText(answer.answer)).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("To date (inclusive)"), {
    target: { value: "2026-10-07" },
  });
  submit();
  await screen.findByText(answer.answer);
  expect(post).toHaveBeenLastCalledWith("/ai-assistant/explain", {
    question: assistantQuestions.average,
    period: "custom",
    from: "2026-10-01",
    to: "2026-10-07",
  });
});
it.each(["clarify", "unsupported", "unavailable"])(
  "renders %s without fabricated evidence",
  async (status) => {
    post.mockResolvedValue({
      ...answer,
      status,
      answer: "Choose a supported question or retry.",
      evidence: null,
      source: null,
    });
    mount();
    submit();
    await screen.findByText("Choose a supported question or retry.");
    expect(screen.queryByText("Reporting evidence and exact period")).not.toBeInTheDocument();
  },
);
it("hides previous facts on failure, malformed response and rate limit", async () => {
  mount();
  submit();
  await screen.findByText(answer.answer);
  post.mockRejectedValueOnce({ response: { status: 403 } });
  submit();
  await screen.findByRole("alert");
  expect(screen.queryByText(answer.answer)).not.toBeInTheDocument();
  post.mockResolvedValueOnce({ ...answer, mode: "external" });
  submit();
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Verified answer unavailable"),
  );
  post.mockRejectedValueOnce({ response: { status: 429 } });
  submit();
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Wait 15 minutes"));
});
it.each(["STAFF", "CASHIER"])("hides questions for %s", (role) => {
  useAuth.mockReturnValue(profile(role));
  mount();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
it("unmounts prior answers on identity, role or module changes", async () => {
  const view = mount();
  submit();
  await screen.findByText(answer.answer);
  useAuth.mockReturnValue(profile("MANAGER", "other"));
  view.rerender(
    <MemoryRouter>
      <AssistantQuestions />
    </MemoryRouter>,
  );
  expect(screen.queryByText(answer.answer)).not.toBeInTheDocument();
  useAuth.mockReturnValue(profile("MANAGER", "other", []));
  view.rerender(
    <MemoryRouter>
      <AssistantQuestions />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
it("does not offer policy questions or source links without module access", async () => {
  useAuth.mockReturnValue(profile("MANAGER", "salon", ["dashboard"]));
  mount();
  expect(
    screen.queryByRole("button", { name: assistantQuestions.rebooking }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: assistantQuestions.quietDays }),
  ).not.toBeInTheDocument();
  submit();
  await screen.findByText(answer.answer);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
