import { describe, expect, it } from "vitest";
import type { SaleItem } from "@glampro_suite/shared";
import { addCartLine } from "./useSale";

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
});
