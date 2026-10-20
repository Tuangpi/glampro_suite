import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StaffRoster from "./StaffRoster";

const api = vi.hoisted(() => ({
  getPaginated: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  getErrorMessage: (error: Error) => error.message,
}));
vi.mock("@/lib/api", () => api);

function renderRoster() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StaffRoster staffId="staff-1" />
    </QueryClientProvider>,
  );
}

describe("staff roster editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getPaginated.mockResolvedValue({ data: [], pageCount: 1 });
    api.post.mockResolvedValue({});
  });
  it("loads every page before showing the roster", async () => {
    api.getPaginated
      .mockResolvedValueOnce({ data: [], pageCount: 2 })
      .mockResolvedValueOnce({ data: [], pageCount: 2 });
    renderRoster();
    await screen.findByText("No working hours configured.");
    expect(api.getPaginated).toHaveBeenCalledWith(
      "/shifts",
      expect.objectContaining({ page: 2, userId: "staff-1" }),
    );
  });
  it("creates a recurring work interval and refuses malformed minutes", async () => {
    const user = userEvent.setup();
    renderRoster();
    await screen.findByText("No working hours configured.");
    await user.click(screen.getByRole("button", { name: "Add working hours" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/shifts",
        expect.objectContaining({
          userId: "staff-1",
          dayOfWeek: 1,
          startsAtMinute: 540,
          endsAtMinute: 1080,
          kind: "WORK",
        }),
      ),
    );
    api.post.mockClear();
    await user.clear(screen.getByLabelText("Start time (HH:mm)"));
    await user.type(screen.getByLabelText("Start time (HH:mm)"), "09:99");
    await user.click(screen.getByRole("button", { name: "Add working hours" }));
    await screen.findByRole("alert");
    expect(api.post).not.toHaveBeenCalled();
  });
  it("surfaces a later-page failure rather than a partial success", async () => {
    api.getPaginated
      .mockResolvedValueOnce({ data: [], pageCount: 2 })
      .mockRejectedValueOnce(new Error("Later page failed"));
    renderRoster();
    await screen.findByText("Later page failed");
    expect(screen.queryByText("No working hours configured.")).not.toBeInTheDocument();
  });
});
