import type { ModuleCode, SaleItemKind } from "@glampro_suite/shared";

/**
 * Which module each kind belongs to. A kind is searchable when its module is
 * effective for the caller's salon.
 *
 * `VALUE_PACKAGE` rides the `packages` add-on rather than a module of its own:
 * `MODULE_CODES` has no value-package code, and prepaid credit is bought and sold
 * exactly like a bundle of sessions, so a salon either has both or neither. Giving it
 * a fifteenth code would mean an entitlement nobody's contract mentions.
 */
export const SALE_KIND_MODULE: Readonly<Record<SaleItemKind, ModuleCode>> = {
  SERVICE: "catalogue",
  PRODUCT: "catalogue",
  PACKAGE: "packages",
  VALUE_PACKAGE: "packages",
  GIFT_CARD: "giftCards",
};
