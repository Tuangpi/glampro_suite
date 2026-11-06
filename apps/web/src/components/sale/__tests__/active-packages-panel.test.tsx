import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CustomerHolding, ServiceSummary } from "@glampro_suite/shared";

import ActivePackagesPanel from "../ActivePackagesPanel";

const mocks = vi.hoisted(() => ({
  holdings: vi.fn(),
  catalog: {} as Record<string, ServiceSummary | null>,
  servicesPending: false,
}));

vi.mock("@/hooks/useCustomers", () => ({ useCustomerHoldings: mocks.holdings }));
// Resolved from the ids the panel asks for, so the mapping under test is the real one.
vi.mock("@/hooks/useServices", () => ({
  useCartServices: (ids: string[]) =>
    ids.map((id) => ({ data: mocks.catalog[id] ?? null, isPending: mocks.servicesPending })),
}));
vi.mock("@/contexts/SalonFormattingContext", () => ({
  useSalonFormatting: () => ({
    formatPrice: (value: string | number) => `S$${Number(value).toFixed(2)}`,
    formatDate: (value: string) => value.slice(0, 10),
  }),
}));

function service(id: string, overrides: Partial<ServiceSummary> = {}): ServiceSummary {
  return {
    id,
    name: id,
    status: "ACTIVE",
    memberPrice: "45.00",
    nonmemberPrice: "50.00",
    points: 5,
    description: null,
    departmentId: null,
    departmentName: null,
    durationMinutes: 60,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function holding(overrides: Partial<CustomerHolding> & { id: string }): CustomerHolding {
  return {
    kind: "PACKAGE",
    name: "5-session cut",
    serviceIds: ["s1"],
    quantityRemaining: 3,
    amountRemaining: null,
    expiresAt: null,
    ...overrides,
  };
}

/** The `<li>` a row's name sits in, so each row's own controls can be read. */
function row(name: string): HTMLElement {
  const row = screen.getByText(name).closest("li");
  if (!row) throw new Error(`No row for ${name}`);
  return row;
}

function rows(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Packages and credit" })).getAllByRole("listitem");
}

beforeEach(() => {
  mocks.catalog = { s1: service("s1", { name: "Haircut" }) };
  mocks.servicesPending = false;
  mocks.holdings.mockReturnValue({ data: { holdings: [holding({ id: "h1" })] } });
});

describe("states", () => {
  it("asks for a customer rather than reading holdings for nobody", () => {
    mocks.holdings.mockReturnValue({ data: undefined, isPending: true });
    render(<ActivePackagesPanel customerId={null} disabled={false} onRedeem={vi.fn()} />);

    expect(
      screen.getByText("Attach a customer to see the packages and credit they can spend."),
    ).toBeInTheDocument();
    expect(mocks.holdings).toHaveBeenCalledWith(null);
  });

  it("says it is still reading the customer's holdings", () => {
    mocks.holdings.mockReturnValue({ data: undefined, isPending: true });
    render(<ActivePackagesPanel customerId="c1" disabled={false} onRedeem={vi.fn()} />);

    expect(screen.getByText("Reading what the customer holds…")).toBeInTheDocument();
  });

  it("offers a retry when the holdings call fails", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    mocks.holdings.mockReturnValue({
      data: undefined,
      isError: true,
      error: new Error("holdings unavailable"),
      refetch,
    });
    render(<ActivePackagesPanel customerId="c1" disabled={false} onRedeem={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("holdings unavailable");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("says so when the customer holds nothing", () => {
    mocks.holdings.mockReturnValue({ data: { holdings: [] } });
    render(<ActivePackagesPanel customerId="c1" disabled={false} onRedeem={vi.fn()} />);

    expect(screen.getByText("This customer holds no packages or credit.")).toBeInTheDocument();
  });
});

describe("ordering", () => {
  it("spends the soonest expiry first and puts no-expiry last", () => {
    mocks.holdings.mockReturnValue({
      data: {
        holdings: [
          holding({ id: "h-null", name: "Unlimited", expiresAt: null }),
          holding({ id: "h-late", name: "Later", expiresAt: "2027-06-01T00:00:00.000Z" }),
          holding({ id: "h-twin-b", name: "Twin B", expiresAt: "2027-01-01T00:00:00.000Z" }),
          holding({ id: "h-soon", name: "Soonest", expiresAt: "2026-12-31T00:00:00.000Z" }),
          holding({ id: "h-twin-a", name: "Twin A", expiresAt: "2027-01-01T00:00:00.000Z" }),
        ],
      },
    });
    render(<ActivePackagesPanel customerId="c1" disabled={false} onRedeem={vi.fn()} />);

    const names = rows().map((item) => item.querySelector("p")?.textContent);
    expect(names).toEqual(["Soonest", "Twin A", "Twin B", "Later", "Unlimited"]);
  });

  it("keeps packages above credit, each sorted by its own expiry", () => {
    mocks.holdings.mockReturnValue({
      data: {
        holdings: [
          holding({
            id: "c1",
            kind: "PREPAID_CREDIT",
            name: "Credit",
            serviceIds: [],
            quantityRemaining: 0,
            amountRemaining: "40.03",
          }),
          holding({ id: "h2", name: "Package", expiresAt: "2027-01-01T00:00:00.000Z" }),
        ],
      },
    });
    render(<ActivePackagesPanel customerId="c1" disabled={false} onRedeem={vi.fn()} />);

    const names = rows().map((item) => item.querySelector("p")?.textContent);
    expect(names).toEqual(["Package", "Credit"]);
  });
});

describe("a package row", () => {
  it("counts the sessions left without inventing a denominator", () => {
    mocks.holdings.mockReturnValue({
      data: { holdings: [holding({ id: "h1", quantityRemaining: 1 })] },
    });
    render(<ActivePackagesPanel customerId="c1" disabled={false} onRedeem={vi.fn()} />);

    expect(within(row("5-session cut")).getByText("1 session left")).toBeInTheDocument();
    expect(within(row("5-session cut")).getByText(/covers 1 service/)).toBeInTheDocument();
  });

  it("marks sessions the customer has not paid for", () => {
    mocks.holdings.mockReturnValue({
      data: { holdings: [holding({ id: "h1", quantityRemaining: 3, paidSessionsRemaining: 1 })] },
    });
    render(<ActivePackagesPanel customerId="c1" disabled={false} onRedeem={vi.fn()} />);

    expect(
      within(row("5-session cut")).getByText(/2 unpaid — a manager PIN is needed to redeem them/),
    ).toBeInTheDocument();
  });

  it("says when the purchase snapshot is missing rather than guessing", () => {
    mocks.holdings.mockReturnValue({
      data: { holdings: [holding({ id: "h1", paidSessionsRemaining: null })] },
    });
    render(<ActivePackagesPanel customerId="c1" disabled={false} onRedeem={vi.fn()} />);

    expect(
      within(row("5-session cut")).getByText("Payment evidence unavailable"),
    ).toBeInTheDocument();
  });

  it("states an outstanding package balance", () => {
    mocks.holdings.mockReturnValue({
      data: { holdings: [holding({ id: "h1", balanceDueCents: "300000" })] },
    });
    render(<ActivePackagesPanel customerId="c1" disabled={false} onRedeem={vi.fn()} />);

    expect(
      within(row("5-session cut")).getByText(
        "Balance due S$3000.00 — collecting it is a separate sale.",
      ),
    ).toBeInTheDocument();
  });

  it("offers nothing once every session is spent", () => {
    mocks.holdings.mockReturnValue({
      data: { holdings: [holding({ id: "h1", quantityRemaining: 0 })] },
    });
    render(<ActivePackagesPanel customerId="c1" disabled={false} onRedeem={vi.fn()} />);

    expect(within(row("5-session cut")).getByText("No sessions left")).toBeInTheDocument();
    expect(within(row("5-session cut")).getByText("Fully used")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Redeem 1" })).not.toBeInTheDocument();
  });

  it("refuses to redeem an expired package", () => {
    mocks.holdings.mockReturnValue({
      data: { holdings: [holding({ id: "h1", expiresAt: "2020-01-01T00:00:00.000Z" })] },
    });
    render(<ActivePackagesPanel customerId="c1" disabled={false} onRedeem={vi.fn()} />);

    expect(within(row("5-session cut")).getByText("Expired")).toBeInTheDocument();
    expect(within(row("5-session cut")).getByText(/Expires 2020-01-01/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Redeem 1" })).not.toBeInTheDocument();
  });

  it("refuses when none of its services is still sold", () => {
    mocks.catalog = { s1: service("s1", { name: "Haircut", status: "INACTIVE" }) };
    render(<ActivePackagesPanel customerId="c1" disabled={false} onRedeem={vi.fn()} />);

    expect(
      within(row("5-session cut")).getByText(
        "None of its services is on sale today, so it cannot be redeemed here.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Redeem 1" })).not.toBeInTheDocument();
  });

  it("waits for the covered services before offering a redemption", () => {
    mocks.catalog = {};
    mocks.servicesPending = true;
    render(<ActivePackagesPanel customerId="c1" disabled={false} onRedeem={vi.fn()} />);

    expect(
      within(row("5-session cut")).getByText("Resolving covered services…"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Redeem 1" })).not.toBeInTheDocument();
  });

  it("rings up a single-service package with one click", async () => {
    const user = userEvent.setup();
    const onRedeem = vi.fn();
    render(<ActivePackagesPanel customerId="c1" disabled={false} onRedeem={onRedeem} />);

    await user.click(screen.getByRole("button", { name: "Redeem 1" }));
    expect(onRedeem).toHaveBeenCalledWith(
      { method: "PACKAGE", holdingId: "h1" },
      {
        kind: "SERVICE",
        id: "s1",
        name: "Haircut",
        price: "50.00",
        memberPrice: "45.00",
        points: 5,
        durationMinutes: 60,
      },
    );
  });

  it("lets the cashier choose which covered service a multi-service package buys", async () => {
    const user = userEvent.setup();
    const onRedeem = vi.fn();
    mocks.catalog = {
      s1: service("s1", { name: "Haircut" }),
      s2: service("s2", { name: "Colour" }),
    };
    mocks.holdings.mockReturnValue({
      data: { holdings: [holding({ id: "h1", serviceIds: ["s1", "s2"] })] },
    });
    render(<ActivePackagesPanel customerId="c1" disabled={false} onRedeem={onRedeem} />);

    const picker = screen.getByLabelText("Service to redeem for 5-session cut");
    expect(picker).toHaveValue("s1");
    await user.selectOptions(picker, "s2");
    await user.click(screen.getByRole("button", { name: "Redeem 1" }));
    expect(onRedeem).toHaveBeenCalledWith(
      { method: "PACKAGE", holdingId: "h1" },
      expect.objectContaining({ kind: "SERVICE", id: "s2", name: "Colour" }),
    );
  });

  it("freezes the action while the till may not write", () => {
    render(<ActivePackagesPanel customerId="c1" disabled onRedeem={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Redeem 1" })).toBeDisabled();
  });
});

describe("a credit row", () => {
  it("pays with the balance the customer holds", async () => {
    const user = userEvent.setup();
    const onRedeem = vi.fn();
    mocks.holdings.mockReturnValue({
      data: {
        holdings: [
          holding({
            id: "v1",
            kind: "PREPAID_CREDIT",
            name: "Prepaid credit",
            serviceIds: [],
            quantityRemaining: 0,
            amountRemaining: "40.03",
          }),
        ],
      },
    });
    render(<ActivePackagesPanel customerId="c1" disabled={false} onRedeem={onRedeem} />);

    expect(within(row("Prepaid credit")).getByText("S$40.03 left")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pay with credit" }));
    // Credit adds no line — it pays whatever the cart already owes.
    expect(onRedeem).toHaveBeenCalledWith({ method: "PREPAID_CREDIT", holdingId: "v1" }, null);
  });

  it("offers nothing for credit that has expired", () => {
    mocks.holdings.mockReturnValue({
      data: {
        holdings: [
          holding({
            id: "v1",
            kind: "PREPAID_CREDIT",
            name: "Prepaid credit",
            serviceIds: [],
            quantityRemaining: 0,
            amountRemaining: "40.03",
            expiresAt: "2020-01-01T00:00:00.000Z",
          }),
        ],
      },
    });
    render(<ActivePackagesPanel customerId="c1" disabled={false} onRedeem={vi.fn()} />);

    expect(within(row("Prepaid credit")).getByText("Expired")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay with credit" })).not.toBeInTheDocument();
  });
});
