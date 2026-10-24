import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SaleDetail } from "@glampro_suite/shared";
import ReceiptView from "./ReceiptView";

vi.mock("@/components/ui/SecureLinkActions", () => ({
  default: () => <button>Share receipt</button>,
}));

const sale: SaleDetail = {
  id: "sale-1",
  receiptNumber: 1042,
  status: "COMPLETED",
  paymentStatus: "PAID",
  soldAt: "2026-10-24T04:00:00.000Z",
  customerId: null,
  customerName: null,
  staffId: "owner",
  staffName: "Owner",
  note: "Customer note",
  voidedAt: null,
  voidReason: null,
  voidedByName: null,
  totalQuantity: 1,
  totalAmount: "80.00",
  paidAmount: "80.00",
  discountAmount: "10.00",
  taxAmount: "6.61",
  taxRate: "9.00",
  gstRegistrationNumber: "GST-SNAPSHOT-123",
  voucherCode: "WELCOME",
  voucherDiscountAmount: "5.00",
  refundedAt: null,
  refundAmount: null,
  refundReason: null,
  refundedByName: null,
  refundRestocked: null,
  refundPayouts: [],
  outstandingAmount: "0.00",
  pointsEarned: 5,
  lines: [
    {
      id: "line-1",
      itemType: "SERVICE",
      itemId: "service-1",
      itemName:
        "A very long treatment description that must wrap rather than disappear from the receipt",
      quantity: 1,
      unitPrice: "95.00",
      lineTotal: "85.00",
      discountPercent: "0.00",
      discountAmount: "10.00",
      voucherDiscountAmount: "5.00",
      netLineTotal: "80.00",
      taxAmount: "6.61",
      taxRate: "9.00",
      staffId: null,
      staffName: null,
    },
  ],
  payments: [
    { method: "CASH", amount: "30.00", sessionId: null },
    { method: "NETS", amount: "50.00", sessionId: null },
  ],
};

function draw(overrides: Partial<SaleDetail> = {}, historical = false) {
  return render(
    <ReceiptView
      sale={{ ...sale, ...overrides }}
      historical={historical}
      returnLabel={historical ? "Back to cart" : "New sale"}
      customerEmail={null}
      canVoid={false}
      canRefund={false}
      onVoid={vi.fn()}
      onRefund={vi.fn()}
      onNewSale={vi.fn()}
    />,
  );
}

describe("receipt paper layouts", () => {
  it("shows stored receipt context without announcing a new sale", () => {
    const { container } = draw({}, true);
    expect(screen.getByRole("heading", { name: "Receipt #1042" })).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.queryByText(/Sale rung up as/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to cart" })).toBeInTheDocument();
    expect(screen.getByText("Printer settings").closest("details")).not.toHaveAttribute("open");
    expect(container.querySelector(".receipt-print-root")?.querySelector("button")).toBeNull();
  });

  it("distinguishes outstanding payment from a completed transaction", () => {
    draw({ paidAmount: "30.00", outstandingAmount: "50.00", paymentStatus: "UNPAID" }, true);
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Outstanding balance")).toBeInTheDocument();
    expect(screen.queryByText("Paid")).not.toBeInTheDocument();
    expect(screen.getByText("Outstanding")).toBeInTheDocument();
  });

  it("does not show a new-sale success banner for a refund", () => {
    draw({ refundedAt: sale.soldAt, refundAmount: "80.00" });
    expect(screen.getByText("Refunded")).toBeInTheDocument();
    expect(screen.queryByText(/Sale rung up as/)).not.toBeInTheDocument();
    expect(screen.queryByText("Paid")).not.toBeInTheDocument();
  });

  it("opens sharing on demand and returns focus to its action", async () => {
    const user = userEvent.setup();
    draw({}, true);
    const share = screen.getByRole("button", { name: "Share receipt" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(share);
    expect(screen.getByRole("dialog", { name: "Share receipt" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(share).toHaveFocus();
  });

  it("defaults to standard and previews both thermal widths without changing receipt amounts", async () => {
    const user = userEvent.setup();
    const { container } = draw();
    const root = container.querySelector(".receipt-print-root")!;
    expect(root).toHaveAttribute("data-receipt-paper", "standard");
    const originalText = root.textContent;
    await user.click(screen.getByText("Printer settings"));
    for (const width of ["80", "58", "standard"]) {
      await user.selectOptions(screen.getByRole("combobox", { name: "Receipt paper" }), width);
      expect(root).toHaveAttribute("data-receipt-paper", width);
      expect(root.textContent).toBe(originalText);
    }
    expect(screen.getByText("GST registration no.: GST-SNAPSHOT-123")).toBeInTheDocument();
    expect(screen.getByText(sale.lines[0]!.itemName)).toHaveClass("receipt-item-name");
    expect(screen.getByText("Includes GST (9%)")).toBeInTheDocument();
    expect(screen.getByText("Voucher WELCOME")).toBeInTheDocument();
    expect(screen.getByText("Cash S$30.00")).toBeInTheDocument();
    expect(screen.getByText("NETS S$50.00")).toBeInTheDocument();
  });

  it("prints the selected layout through the browser and keeps controls outside printed content", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const user = userEvent.setup();
    const { container } = draw();
    await user.click(screen.getByText("Printer settings"));
    await user.selectOptions(screen.getByLabelText("Receipt paper"), "58");
    await user.click(screen.getByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".receipt-print-root")).toHaveAttribute(
      "data-receipt-paper",
      "58",
    );
    expect(screen.getByLabelText("Receipt paper").closest(".print\\:hidden")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Print" }).closest(".print\\:hidden")).not.toBeNull();
    print.mockRestore();
  });

  it("retains refund evidence and payout methods in the thermal receipt", async () => {
    const user = userEvent.setup();
    const { container } = draw({
      refundedAt: sale.soldAt,
      refundAmount: "80.00",
      refundReason: "Returned",
      refundedByName: "Manager",
      refundRestocked: false,
      refundPayouts: [{ method: "CASH", amount: "80.00" }],
    });
    await user.click(screen.getByText("Printer settings"));
    await user.selectOptions(screen.getByLabelText("Receipt paper"), "58");
    const printed = within(container.querySelector(".receipt-print-root") as HTMLElement);
    expect(printed.getByText("Returned")).toBeInTheDocument();
    expect(printed.getByText("Cash returned: S$80.00")).toBeInTheDocument();
  });

  it("retains void evidence and does not invent a missing GST registration number", () => {
    const { container } = draw({
      status: "VOID",
      voidedAt: sale.soldAt,
      voidReason: "Duplicate",
      voidedByName: "Manager",
      gstRegistrationNumber: null,
    });
    const printed = within(container.querySelector(".receipt-print-root") as HTMLElement);
    expect(printed.getByText("Void")).toBeInTheDocument();
    expect(printed.getByText("Duplicate")).toBeInTheDocument();
    expect(printed.queryByText(/GST registration no\./)).not.toBeInTheDocument();
  });
});
