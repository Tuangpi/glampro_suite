/**
 * The rota section of `/staff/:id`.
 *
 * What is worth asserting is the shape the rewrite exists for: the section opens as a
 * **list**, the form is revealed on demand, and a row is never deleted — it is retired
 * by dating its effective window, because a booking taken under last month's rota has to
 * keep meaning what it meant.
 *
 * The rest is the contract the API already had, moved rather than rewritten: minutes
 * past local midnight (24:00 included, which is why "Ends at midnight" is not a time
 * input), "ends after it starts" from `createShiftSchema` rather than a second copy of
 * the rule here, every page of `GET /shifts` loaded before anything is claimed, and
 * `canEdit` deciding whether the buttons exist at all.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShiftSummary } from "@glampro_suite/shared";

import StaffRoster from "./StaffRoster";

const api = vi.hoisted(() => ({
  getPaginated: vi.fn(),
  getValidationDetails: vi.fn(() => ({})),
  patch: vi.fn(),
  post: vi.fn(),
  getErrorMessage: (error: Error) => error.message,
}));
vi.mock("@/lib/api", () => api);

/** A rota row as `GET /shifts` returns one: Monday 09:00–18:00 unless overridden. */
function shift(overrides: Partial<ShiftSummary> = {}): ShiftSummary {
  return {
    id: "shift-1",
    userId: "staff-1",
    userName: "Ada Lovelace",
    dayOfWeek: 1,
    startsAtMinute: 540,
    endsAtMinute: 1080,
    kind: "WORK",
    effectiveFrom: null,
    effectiveTo: null,
    note: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderRoster({ canEdit = true }: { canEdit?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StaffRoster staffId="staff-1" canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

describe("staff roster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getPaginated.mockResolvedValue({ data: [], pageCount: 1 });
    api.post.mockResolvedValue({});
    api.patch.mockResolvedValue({});
  });

  it("loads every page before showing the roster", async () => {
    api.getPaginated
      .mockResolvedValueOnce({ data: [], pageCount: 2 })
      .mockResolvedValueOnce({ data: [], pageCount: 2 });
    renderRoster();
    await screen.findByText("No working hours yet");
    expect(api.getPaginated).toHaveBeenCalledWith(
      "/shifts",
      expect.objectContaining({ page: 2, userId: "staff-1" }),
    );
  });

  it("surfaces a later-page failure rather than a partial success", async () => {
    api.getPaginated
      .mockResolvedValueOnce({ data: [], pageCount: 2 })
      .mockRejectedValueOnce(new Error("Later page failed"));
    renderRoster();
    await screen.findByText("Later page failed");
    expect(screen.queryByText("No working hours yet")).not.toBeInTheDocument();
  });

  it("reads as a list: Monday-first days, breaks marked, windows dated", async () => {
    api.getPaginated.mockResolvedValue({
      data: [
        shift({ id: "wed", dayOfWeek: 3, startsAtMinute: 600, endsAtMinute: 1020 }),
        shift({ id: "lunch", startsAtMinute: 720, endsAtMinute: 780, kind: "BREAK" }),
        shift({ id: "mon" }),
        shift({
          id: "tue",
          dayOfWeek: 2,
          startsAtMinute: 480,
          endsAtMinute: 960,
          effectiveFrom: "2026-07-01",
          effectiveTo: "2026-12-31",
        }),
      ],
      pageCount: 1,
    });
    renderRoster();

    await screen.findByText("09:00 – 18:00");
    const days = screen.getAllByRole("heading", { level: 4 }).map((node) => node.textContent);
    expect(days).toEqual(["Monday", "Tuesday", "Wednesday"]);

    // Work first, then its break — reading order, not insertion order.
    const monday = screen.getByRole("heading", { level: 4, name: "Monday" }).parentElement!;
    expect(monday.textContent).toContain("09:00 – 18:00");
    expect(monday.textContent).toContain("12:00 – 13:00");
    expect(screen.getByText("Break")).toBeInTheDocument();

    // A dated window is shown on the row it bounds, and nowhere else.
    const tuesday = screen.getByRole("heading", { level: 4, name: "Tuesday" }).parentElement!;
    expect(tuesday.textContent).toMatch(/2026 – .*2026/);
    const wednesday = screen.getByRole("heading", { level: 4, name: "Wednesday" }).parentElement!;
    expect(wednesday.textContent).not.toContain("2026");
  });

  it("says what an empty rota means", async () => {
    renderRoster();
    await screen.findByText("No working hours yet");
    expect(
      screen.getByText(/With no rows here this person can be booked at any time/),
    ).toBeInTheDocument();
  });

  it("posts a recurring work interval built from the revealed form", async () => {
    const user = userEvent.setup();
    renderRoster();
    await screen.findByText("No working hours yet");

    // Nothing is editable until the form is asked for.
    expect(api.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Add working hours" }));
    await user.click(screen.getByRole("button", { name: "Save hours" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/shifts",
        expect.objectContaining({
          userId: "staff-1",
          dayOfWeek: 1,
          kind: "WORK",
          startsAtMinute: 540,
          endsAtMinute: 1080,
        }),
      ),
    );
    // The form closes once the write lands.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save hours" })).toBeNull());
  });

  it("expresses 24:00 through the midnight checkbox, not a time input", async () => {
    const user = userEvent.setup();
    renderRoster();
    await screen.findByText("No working hours yet");
    await user.click(screen.getByRole("button", { name: "Add working hours" }));

    await user.click(screen.getByLabelText("Ends at midnight"));
    expect(screen.getByLabelText("End time")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Save hours" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/shifts",
        expect.objectContaining({ startsAtMinute: 540, endsAtMinute: 1440 }),
      ),
    );
  });

  it("refuses an end at or before the start before it posts", async () => {
    const user = userEvent.setup();
    renderRoster();
    await screen.findByText("No working hours yet");
    await user.click(screen.getByRole("button", { name: "Add working hours" }));

    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "08:00" } });
    await user.click(screen.getByRole("button", { name: "Save hours" }));

    expect(await screen.findByText("A shift has to end after it starts.")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("reveals the editor above the rows it changes", async () => {
    api.getPaginated.mockResolvedValue({ data: [shift()], pageCount: 1 });
    const user = userEvent.setup();
    renderRoster();

    await user.click(await screen.findByRole("button", { name: "Edit Monday working hours" }));

    const editor = screen.getByRole("form", { name: "Edit working hours" });
    // Above the list, not below it: appended after a long rota the form sat behind a
    // scroll, and the field it had just revealed was the last thing on the page.
    expect(
      editor.compareDocumentPosition(screen.getByRole("list")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // Focus follows the form up, so the keyboard does not stay on a button now below it.
    expect(editor).toHaveFocus();
  });

  it("patches an existing row and never re-sends its owner", async () => {
    api.getPaginated.mockResolvedValue({ data: [shift()], pageCount: 1 });
    const user = userEvent.setup();
    renderRoster();

    await user.click(await screen.findByRole("button", { name: "Edit Monday working hours" }));
    const start = screen.getByLabelText("Start time");
    expect(start).toHaveValue("09:00");

    fireEvent.change(start, { target: { value: "10:00" } });
    await user.click(screen.getByRole("button", { name: "Save hours" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/shifts/shift-1",
        expect.objectContaining({ dayOfWeek: 1, kind: "WORK", startsAtMinute: 600 }),
      ),
    );
    // `PATCH /shifts/:id` cannot move a row between people, so it is not asked to.
    expect(api.patch.mock.calls[0]![1]).not.toHaveProperty("userId");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("ends a rota by dating its window rather than deleting the row", async () => {
    api.getPaginated.mockResolvedValue({ data: [shift()], pageCount: 1 });
    const user = userEvent.setup();
    renderRoster();

    await user.click(await screen.findByRole("button", { name: "Edit Monday working hours" }));
    await user.click(screen.getByRole("button", { name: "End after today" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/shifts/shift-1", {
        effectiveTo: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });

  it("shows a reader the rota with nothing to click", async () => {
    api.getPaginated.mockResolvedValue({ data: [shift()], pageCount: 1 });
    renderRoster({ canEdit: false });

    await screen.findByText("09:00 – 18:00");
    expect(screen.queryByRole("button", { name: "Add working hours" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save hours" })).toBeNull();
  });
});
