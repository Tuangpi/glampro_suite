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
function mount(options: { canReturn?: boolean; sale?: SaleDetail } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DirectTipsPanel
        sale={options.sale ?? sale}
        staff={[{ id: "staff-1", name: "Stylist" }]}
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
  it("records only direct payment evidence and reuses the key after an uncertain failure", async () => {
    post.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ items: [tip] });
    const user = userEvent.setup();
    mount();
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
    expect(screen.getByLabelText("Direct tip amount")).toHaveValue(null);
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
    await user.selectOptions(screen.getByLabelText("Tip recipient"), "staff-1");
    await user.type(screen.getByLabelText("Direct tip amount"), "0.001");
    await user.click(screen.getByRole("button", { name: "Record direct-to-staff tip" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at most two decimal places");
    expect(post).not.toHaveBeenCalled();
  });
});
