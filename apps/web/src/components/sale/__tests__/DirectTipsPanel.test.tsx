import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SaleDetail } from "@glampro_suite/shared";
import DirectTipsPanel from "../DirectTipsPanel";

const { get, post, state } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  state: { readOnly: false },
}));
vi.mock("@/lib/api", () => ({ get, post, getErrorMessage: () => "Connection failed" }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ tenant: { id: "tips-tenant" }, isReadOnly: state.readOnly }),
}));
const sale = { id: "sale-1", status: "COMPLETED", refundedAt: null } as SaleDetail;
const tip = {
  id: "tip-1",
  saleId: "sale-1",
  amount: "2.50",
  staffId: "staff-1",
  staffName: "Stylist",
  recordedByName: "Cashier",
  recordedAt: "2026-10-20T10:00:00Z",
  returnedAt: null,
  returnedByName: null,
  returnReason: null,
};
function mount(
  options: {
    canReturn?: boolean;
    sale?: SaleDetail;
    staff?: { id: string; name: string }[];
    staffLoading?: boolean;
    staffError?: boolean;
    onRetryStaff?: () => void;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DirectTipsPanel
        sale={options.sale ?? sale}
        staff={options.staff ?? [{ id: "staff-1", name: "Stylist" }]}
        staffLoading={options.staffLoading}
        staffError={options.staffError}
        onRetryStaff={options.onRetryStaff}
        canReturn={options.canReturn ?? false}
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  state.readOnly = false;
  get.mockResolvedValue({ items: [] });
});

describe("direct staff tip recording", () => {
  it("opens an empty, alphabetically sorted recipient selector and restores focus on cancel", async () => {
    const user = userEvent.setup();
    mount({
      staff: [
        { id: "z", name: "Zoe" },
        { id: "a", name: "Amara" },
      ],
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Add tip" })).toBeEnabled());
    const add = screen.getByRole("button", { name: "Add tip" });
    expect(screen.queryByLabelText("Tip recipient")).not.toBeInTheDocument();
    await user.click(add);
    const select = screen.getByLabelText("Tip recipient");
    expect(select).toHaveValue("");
    expect(Array.from((select as HTMLSelectElement).options).map((option) => option.text)).toEqual([
      "Select staff member",
      "Amara",
      "Zoe",
    ]);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(add).toHaveFocus();
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    { staffLoading: true, message: "Loading staff…" },
    { staffError: true, message: "Could not load staff. Try again before recording a tip." },
    { message: "No staff available to receive a tip." },
  ])("blocks tip recording when staff is unavailable: $message", async (state) => {
    const user = userEvent.setup();
    const retry = vi.fn();
    mount({ staff: [], ...state, onRetryStaff: retry });
    await waitFor(() => expect(screen.getByRole("button", { name: "Add tip" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Add tip" }));
    expect(screen.getByText(state.message)).toBeVisible();
    expect(screen.getByLabelText("Tip recipient")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Record direct-to-staff tip" })).toBeDisabled();
    if ("staffError" in state) {
      await user.click(screen.getByRole("button", { name: "Retry staff" }));
      expect(retry).toHaveBeenCalledOnce();
    }
  });

  it("shows recorded tip history without opening the add-tip form", async () => {
    get.mockResolvedValue({ items: [tip] });
    mount();
    expect(
      await screen.findByText("1 tip record · Separate from sale payments"),
    ).toBeInTheDocument();
    expect(screen.getByText("View tips").closest("details")).toHaveAttribute("open");
  });

  it("shows loading failures without requiring the details to be opened", async () => {
    get.mockRejectedValue(new Error("offline"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load tips");
    expect(screen.getByRole("button", { name: "Retry tip records" })).toBeVisible();
  });

  it("records only direct payment evidence and reuses the key after an uncertain failure", async () => {
    post.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ items: [tip] });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "Add tip" }));
    await user.selectOptions(screen.getByLabelText("Tip recipient"), "staff-1");
    await user.type(screen.getByLabelText("Direct tip amount"), "2.50");
    await user.click(screen.getByRole("button", { name: "Record direct-to-staff tip" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection failed");
    const first = post.mock.calls[0]![1];
    expect(first).toEqual({ staffId: "staff-1", amount: 2.5, idempotencyKey: expect.any(String) });
    await user.click(screen.getByRole("button", { name: "Record direct-to-staff tip" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]![1]).toEqual(first);
    expect(await screen.findByText(/recorded by Cashier/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("allows managers to record a separate full return even after the sale is voided", async () => {
    get.mockResolvedValue({ items: [tip] });
    post.mockResolvedValue({
      items: [
        {
          ...tip,
          returnedAt: "2026-10-20T11:00:00Z",
          returnedByName: "Manager",
          returnReason: "Returned directly",
        },
      ],
    });
    const user = userEvent.setup();
    mount({ canReturn: true, sale: { ...sale, status: "VOID" } });
    await user.type(await screen.findByLabelText("Tip return reason"), "Returned directly");
    await user.click(screen.getByRole("button", { name: /Record full tip return/ }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/sales/sale-1/direct-tips/tip-1/return", {
        reason: "Returned directly",
      }),
    );
    expect(await screen.findByText(/Returned in full/)).toHaveTextContent(
      "Manager: Returned directly",
    );
    expect(screen.queryByLabelText("Direct tip amount")).not.toBeInTheDocument();
  });

  it("hides all write controls for a suspended salon", async () => {
    state.readOnly = true;
    get.mockResolvedValue({ items: [tip] });
    mount({ canReturn: true });
    expect(await screen.findByText(/recorded by Cashier/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Direct tip amount")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Record full tip return/ }),
    ).not.toBeInTheDocument();
  });

  it("rejects fractional cents before posting", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "Add tip" }));
    await user.selectOptions(screen.getByLabelText("Tip recipient"), "staff-1");
    await user.type(screen.getByLabelText("Direct tip amount"), "0.001");
    await user.click(screen.getByRole("button", { name: "Record direct-to-staff tip" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at most two decimal places");
    expect(post).not.toHaveBeenCalled();
  });
});
