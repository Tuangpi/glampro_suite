import { describe, expect, it } from "vitest";

import type { CustomerSummary } from "@glampro_suite/shared";

import type { CartLine } from "@/hooks/useSale";
import {
  clearSaleDraft,
  holdAttemptKey,
  readSaleDraft,
  saleDraftIdentity,
  setSaleDraftCustomer,
  setSaleDraftLines,
  setSaleDraftHeldSale,
} from "@/lib/sale-draft-storage";

const LINE: CartLine = {
  itemType: "SERVICE",
  itemId: "service-1",
  name: "Root colour",
  quantity: 2,
  price: "80.00",
  memberPrice: "70.00",
  staffId: "staff-1",
};

const CUSTOMER: CustomerSummary = {
  id: "customer-1",
  code: null,
  name: "Mrs Loi",
  memberId: "M-88",
  email: "mrsloi88@gmail.com",
  phone: "9030 9386",
  gender: null,
  dateOfBirth: null,
  address: null,
  comment: null,
  createdAt: "2026-10-09T00:00:00.000Z",
  updatedAt: "2026-10-09T00:00:00.000Z",
};

describe("sale draft storage", () => {
  it("retains separate seller and performer splits without inferring the cashier", () => {
    const identity = saleDraftIdentity("attribution-tenant", "cashier");
    const attribution = {
      sellers: [{ staffId: "seller", share: 10000 }],
      performers: [{ staffId: "therapist", share: 10000 }],
    };
    setSaleDraftLines(identity, [{ ...LINE, attribution }]);
    expect(readSaleDraft(identity).lines[0]?.attribution).toEqual(attribution);
  });
  it("keeps hold retry keys durable and scoped to the submitted cart and identity", () => {
    const identity = saleDraftIdentity("retry-tenant", "retry-user");
    setSaleDraftLines(identity, [LINE]);
    const key = holdAttemptKey(identity, "cart-one");
    expect(holdAttemptKey(identity, "cart-one")).toBe(key);
    setSaleDraftCustomer(identity, CUSTOMER);
    expect(readSaleDraft(identity).holdAttempt?.key).toBe(key);
    expect(holdAttemptKey(identity, "cart-two")).not.toBe(key);
    expect(holdAttemptKey(saleDraftIdentity("other", "retry-user"), "cart-one")).not.toBe(key);
    clearSaleDraft(identity);
    expect(holdAttemptKey(identity, "cart-one")).not.toBe(key);
    expect(() => holdAttemptKey(null, "cart-one")).toThrow("Sign in");
  });
  it("preserves a resumed hold across edits and isolates it by identity", () => {
    const identity = saleDraftIdentity("hold-tenant", "hold-user");
    setSaleDraftHeldSale(identity, "sale-9");
    setSaleDraftLines(identity, [LINE]);
    setSaleDraftCustomer(identity, CUSTOMER);
    expect(readSaleDraft(identity).heldSaleId).toBe("sale-9");
    expect(readSaleDraft(saleDraftIdentity("other", "hold-user")).heldSaleId).toBeUndefined();
    clearSaleDraft(identity);
    expect(readSaleDraft(identity).heldSaleId).toBeUndefined();
  });
  it("keeps each tenant and user in a separate draft", () => {
    const first = saleDraftIdentity("tenant-1", "user-1");
    const second = saleDraftIdentity("tenant-1", "user-2");

    setSaleDraftLines(first, [LINE]);
    setSaleDraftCustomer(first, CUSTOMER);

    expect(readSaleDraft(first)).toEqual({ version: 1, lines: [LINE], customer: CUSTOMER });
    expect(readSaleDraft(second)).toEqual({ version: 1, lines: [], customer: null });
  });

  it("discards malformed or stale browser data instead of hydrating it", () => {
    const identity = saleDraftIdentity("tenant-1", "user-1");
    localStorage.setItem(`glampro.saleDraft.v1:${identity}`, '{"version":1,"lines":"bad"}');

    expect(readSaleDraft(identity)).toEqual({ version: 1, lines: [], customer: null });
    expect(localStorage.getItem(`glampro.saleDraft.v1:${identity}`)).toBeNull();
  });

  it("removes the key once the draft is empty", () => {
    const identity = saleDraftIdentity("tenant-1", "user-1");
    setSaleDraftLines(identity, [LINE]);

    clearSaleDraft(identity);

    expect(readSaleDraft(identity)).toEqual({ version: 1, lines: [], customer: null });
  });
});
