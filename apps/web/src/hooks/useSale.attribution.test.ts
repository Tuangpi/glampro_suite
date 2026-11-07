import { describe, expect, it } from "vitest";
import type { SaleItem } from "@glampro_suite/shared";
import { addCartLine, cartLineKey, setCartLineStaff } from "./useSale";

const item = {
  id: "service",
  kind: "SERVICE",
  name: "Treatment",
  price: "80.00",
  memberPrice: null,
} as SaleItem;

describe("new cart seller defaults", () => {
  it("defaults only the seller, never the performer", () => {
    const result = addCartLine([], item, undefined, false, "till-staff");
    expect(result.lines[0]?.attribution).toEqual({
      sellers: [{ staffId: "till-staff", share: 10000 }],
    });
    expect(result.lines[0]?.staffId).toBeUndefined();
  });

  it("preserves edited and cleared attribution as quantity grows", () => {
    const original = addCartLine([], item, undefined, false, "till-staff").lines;
    for (const attribution of [undefined, { sellers: [{ staffId: "other", share: 10000 }] }]) {
      const result = addCartLine(
        [{ ...original[0]!, attribution }],
        item,
        undefined,
        false,
        "new-till",
      );
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]?.quantity).toBe(2);
      expect(result.lines[0]?.attribution).toEqual(attribution);
    }
  });

  it("does not invent a seller when no till identity is supplied", () => {
    expect(addCartLine([], item, undefined, false).lines[0]?.attribution).toBeUndefined();
  });

  it("replaces or clears appointment performer evidence when the legacy picker is changed", () => {
    const original = {
      ...addCartLine([], item, "booked", false, "cashier").lines[0]!,
      attribution: {
        sellers: [{ staffId: "cashier", share: 10000 }],
        performers: [{ staffId: "booked", share: 10000 }],
      },
    };
    const edited = setCartLineStaff([original], cartLineKey(original), "replacement")[0]!;
    expect(edited.attribution).toEqual({
      sellers: original.attribution.sellers,
      performers: [{ staffId: "replacement", share: 10000 }],
    });
    const cleared = setCartLineStaff([edited], cartLineKey(edited), undefined)[0]!;
    expect(cleared.staffId).toBeUndefined();
    expect(cleared.attribution?.performers).toBeUndefined();
    expect(cleared.attribution?.sellers).toEqual(original.attribution.sellers);
    expect(
      setCartLineStaff(
        [{ ...original, attribution: undefined }],
        cartLineKey({ ...original, attribution: undefined }),
        undefined,
      )[0]?.attribution,
    ).toBeUndefined();
  });
});
