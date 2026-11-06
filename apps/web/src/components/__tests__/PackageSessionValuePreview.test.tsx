import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { formatting } = vi.hoisted(() => ({
  formatting: {
    gstEnabled: false,
    formatPrice: (value: string | number | null | undefined) => `S$${Number(value).toFixed(2)}`,
  },
}));
vi.mock("@/contexts/SalonFormattingContext", () => ({ useSalonFormatting: () => formatting }));

import PackageSessionValuePreview from "../catalogue/PackageSessionValuePreview";

beforeEach(() => {
  formatting.gstEnabled = false;
});

/** The card is a `<fieldset>` named by its legend; querying it once keeps the
 *  assertions on `toHaveTextContent`, which does not trip over ancestor nodes. */
function card(): HTMLElement {
  return screen.getByRole("group", { name: "What one session is worth" });
}

describe("package session value preview", () => {
  it("shows what each listed price is worth per session, GST backed out", () => {
    formatting.gstEnabled = true;
    render(
      <PackageSessionValuePreview
        sessions="5"
        memberPrice="100.00"
        nonmemberPrice="120.00"
        commission={null}
      />,
    );

    expect(card()).toHaveTextContent("Member price");
    expect(card()).toHaveTextContent("S$18.3480 a session");
    expect(card()).toHaveTextContent("S$22.0180 a session");
    // The price the figure came from, so the manager can check the arithmetic.
    expect(card()).toHaveTextContent("S$100.00 includes S$8.26 GST, so S$91.74 ÷ 5 sessions");
    expect(card()).toHaveTextContent("GST of 9% is backed out of the price");
  });

  it("treats the whole price as commissionable when the salon has no GST", () => {
    render(
      <PackageSessionValuePreview
        sessions="5"
        memberPrice="100.00"
        nonmemberPrice="120.00"
        commission={null}
      />,
    );

    expect(card()).toHaveTextContent("S$20.0000 a session");
    expect(card()).toHaveTextContent("not GST-registered");
  });

  it("says which sessions hold the leftover ten-thousandth", () => {
    render(
      <PackageSessionValuePreview
        sessions="7"
        memberPrice="100.00"
        nonmemberPrice=""
        commission={null}
      />,
    );

    expect(card()).toHaveTextContent("S$14.2857 a session");
    expect(card()).toHaveTextContent(
      "The earliest 1 session holds one extra S$0.0001 so the grant reconciles",
    );
    expect(screen.getByText("Enter a price")).toBeInTheDocument();
  });

  it("asks for the sessions it cannot divide by", () => {
    const { rerender } = render(
      <PackageSessionValuePreview
        sessions=""
        memberPrice="100.00"
        nonmemberPrice=""
        commission={null}
      />,
    );
    expect(card()).toHaveTextContent("Enter how many sessions the bundle holds");

    rerender(
      <PackageSessionValuePreview
        sessions="0"
        memberPrice="100.00"
        nonmemberPrice=""
        commission={null}
      />,
    );
    expect(card()).toHaveTextContent("A package with no sessions has no session value");
  });

  it("states what the settings on the form do without inventing a commission figure", () => {
    render(
      <PackageSessionValuePreview
        sessions="5"
        memberPrice="100.00"
        nonmemberPrice="120.00"
        commission={{
          saleMode: "FIXED",
          saleFixed: "5.25",
          redemptionMode: "EXCLUDE",
          redemptionFixed: "",
        }}
      />,
    );

    const preview = screen.getByLabelText("Commission preview");
    expect(preview).toHaveTextContent("A fixed S$5.25 for the sale, split between the sellers.");
    expect(preview).toHaveTextContent("No commission for the sessions used.");
  });

  it("says the plan applies until an explicit setting is saved", () => {
    render(
      <PackageSessionValuePreview
        sessions="5"
        memberPrice="100.00"
        nonmemberPrice="120.00"
        commission={{
          saleMode: "",
          saleFixed: "",
          redemptionMode: "FOLLOW_PLAN",
          redemptionFixed: "",
        }}
      />,
    );

    const preview = screen.getByLabelText("Commission preview");
    expect(preview).toHaveTextContent(
      "No explicit setting — the plan applies to new purchases until one is saved.",
    );
    expect(preview).toHaveTextContent("The plan's redemption rate, on the session value above.");
  });

  it("keeps commission settings out of a reader who cannot configure them", () => {
    render(
      <PackageSessionValuePreview
        sessions="5"
        memberPrice="100.00"
        nonmemberPrice="120.00"
        commission={null}
      />,
    );

    expect(screen.queryByLabelText("Commission preview")).not.toBeInTheDocument();
    expect(card()).toHaveTextContent("S$20.0000 a session");
  });
});
