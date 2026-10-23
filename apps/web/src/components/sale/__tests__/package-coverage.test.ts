/**
 * The till's copy of the package-coverage rule (TK2610-0011).
 *
 * `redeemPayments` in `sale.service.ts` recomputes what a package covers and refuses a
 * tender whose amount differs, so this mirror has to agree exactly: a sheet that rounds
 * or orders differently would offer a payment the server then rejects. The server's own
 * suite covers the ledger side; these cases pin the arithmetic the browser shows.
 */
import { describe, expect, it } from "vitest";

import type { CustomerHolding } from "@glampro_suite/shared";

import { packageCoverage, type PaymentLine } from "@/lib/package-coverage";

/** A package holding with the fields the rule reads. */
function packageHolding(serviceIds: string[], quantityRemaining: number): CustomerHolding {
  return {
    id: "holding-1",
    kind: "PACKAGE",
    name: "Aloha Bundle",
    serviceIds,
    quantityRemaining,
    amountRemaining: null,
    expiresAt: null,
  };
}

function serviceLine(itemId: string, quantity: number, unitPriceCents: number): PaymentLine {
  return { itemType: "SERVICE", itemId, quantity, unitPriceCents };
}

describe("packageCoverage", () => {
  it("covers eligible service units in cart order, up to the sessions left", () => {
    const coverage = packageCoverage(packageHolding(["cut"], 2), [serviceLine("cut", 3, 5000)]);

    expect(coverage).toMatchObject({ cents: 10000, sessions: 2 });
  });

  it("skips lines the package does not list, and products entirely", () => {
    const coverage = packageCoverage(packageHolding(["cut"], 8), [
      serviceLine("colour", 1, 9500),
      { itemType: "PRODUCT", itemId: "cut", quantity: 2, unitPriceCents: 1500 },
      serviceLine("cut", 1, 5000),
    ]);

    // One haircut covered; the colour and the product are paid another way.
    expect(coverage).toMatchObject({ cents: 5000, sessions: 1 });
  });

  it("covers nothing when the cart holds no eligible service", () => {
    const coverage = packageCoverage(packageHolding(["cut"], 8), [serviceLine("colour", 1, 9500)]);

    // The sheet turns this into its "covers nothing in this cart" refusal.
    expect(coverage).toMatchObject({ cents: 0, sessions: 0 });
  });

  it("stops at the exhausted holding rather than promising a session it does not have", () => {
    const coverage = packageCoverage(packageHolding(["cut"], 0), [serviceLine("cut", 1, 5000)]);

    expect(coverage).toMatchObject({ cents: 0, sessions: 0 });
  });
});
