/** Read-only POS catalogue search; checkout and financial writes live in sale.service.ts. */
import {
  SALE_ITEM_KINDS,
  normalizeBarcode,
  saleItemSearchResultSchema,
  type SaleItem,
  type SaleItemKind,
  type SaleItemSearchQuery,
  type SaleItemSearchResult,
} from "@glampro_suite/shared";

import { moduleEntitlements } from "../lib/entitlements.js";
import { prisma } from "../lib/prisma.js";
import { resolveLowStockThreshold } from "./catalogue.service.js";
import { SALE_KIND_MODULE } from "./sale-item-policy.js";

/** A `Decimal(12,2)` on the wire is a string, so no cent is lost to a float. */
function money(value: { toFixed: (digits: number) => string }): string {
  return value.toFixed(2);
}

/**
 * The one search box matches the name.
 *
 * The catalogue's text box matches the name **or** the description because its own
 * placeholder says "Search items…"; the till's box is the cashier typing what the
 * customer asked for, so a description match would put a row on screen whose name the
 * cashier did not type. Nothing else is filtered: a kind's own columns do the rest.
 */
function nameWhere(search: string | undefined) {
  return search ? { name: { contains: search, mode: "insensitive" as const } } : {};
}

/**
 * `status: ACTIVE` everywhere it exists.
 *
 * The till sells what the salon still offers, so an archived product, service, bundle
 * or value package is not searchable — that is what archiving is for. `GiftCard` has
 * no status column, so a card template is always sellable; whether an **expired**
 * template should be too is a rule 5b.2 has to decide at the till, and inventing one
 * here would quietly hide a row the salon can see on screen 08.
 */

/** Sellable services. */
async function searchServices(
  search: string | undefined,
  limit: number,
  skip = 0,
): Promise<SaleItem[]> {
  const rows = await prisma.service.findMany({
    where: { ...nameWhere(search), status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      memberPrice: true,
      nonmemberPrice: true,
      points: true,
      durationMinutes: true,
    },
    // `id` breaks ties so the grid's order is stable when two services share a name.
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit,
    skip,
  });

  return rows.map((row) => ({
    kind: "SERVICE",
    id: row.id,
    name: row.name,
    price: money(row.nonmemberPrice),
    memberPrice: money(row.memberPrice),
    points: row.points,
    durationMinutes: row.durationMinutes,
  }));
}

/** Sellable products. `lowStock` is computed here, never in the browser (ADR 0010). */
async function searchProducts(
  search: string | undefined,
  limit: number,
  skip = 0,
): Promise<SaleItem[]> {
  const threshold = await resolveLowStockThreshold();

  const rows = await prisma.product.findMany({
    where: { ...nameWhere(search), status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      memberPrice: true,
      nonmemberPrice: true,
      quantity: true,
      points: true,
      barcode: true,
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit,
    skip,
  });

  return rows.map((row) => ({
    kind: "PRODUCT",
    id: row.id,
    name: row.name,
    price: money(row.nonmemberPrice),
    memberPrice: money(row.memberPrice),
    points: row.points,
    quantity: row.quantity,
    lowStock: row.quantity <= threshold,
    barcode: row.barcode,
  }));
}

/**
 * Sellable bundles. `serviceCount` is the relation's length rather than a second
 * read — the count the till draws and the count the catalogue tab draws then come
 * from the same query.
 */
async function searchPackages(
  search: string | undefined,
  limit: number,
  skip = 0,
): Promise<SaleItem[]> {
  const rows = await prisma.package.findMany({
    where: { ...nameWhere(search), status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      memberPrice: true,
      nonmemberPrice: true,
      sessionCount: true,
      services: { select: { id: true } },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit,
    skip,
  });

  return rows.map((row) => ({
    kind: "PACKAGE",
    id: row.id,
    name: row.name,
    price: money(row.nonmemberPrice),
    memberPrice: money(row.memberPrice),
    sessionCount: row.sessionCount,
    serviceCount: row.services.length,
  }));
}

/** Sellable prepaid credit. Legacy `valuepackages`. */
async function searchValuePackages(
  search: string | undefined,
  limit: number,
  skip = 0,
): Promise<SaleItem[]> {
  const rows = await prisma.valuePackage.findMany({
    where: { ...nameWhere(search), status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      price: true,
      credit: true,
      services: { select: { id: true } },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit,
    skip,
  });

  return rows.map((row) => ({
    kind: "VALUE_PACKAGE",
    id: row.id,
    name: row.name,
    price: money(row.price),
    // One price and no member/non-member pair, so there is nothing a member could be
    // charged instead — `null`, not a copy of `price`.
    memberPrice: null,
    credit: money(row.credit),
    serviceCount: row.services.length,
  }));
}

/** Sellable card templates. No status to filter on, and an absent expiry is "never". */
async function searchGiftCards(
  search: string | undefined,
  limit: number,
  skip = 0,
): Promise<SaleItem[]> {
  const rows = await prisma.giftCard.findMany({
    where: nameWhere(search),
    select: { id: true, name: true, value: true, expiresAt: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit,
    skip,
  });

  return rows.map((row) => ({
    kind: "GIFT_CARD",
    id: row.id,
    name: row.name,
    // The card's face value *is* what the customer pays for it; `GiftCard` has one
    // money column, so there is no second price to return.
    price: money(row.value),
    memberPrice: null,
    expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
  }));
}

/** The reader for one kind. The switch is exhaustive, so a new kind cannot be forgotten. */
function readKind(
  kind: SaleItemKind,
  search: string | undefined,
  limit: number,
  skip = 0,
): Promise<SaleItem[]> {
  switch (kind) {
    case "SERVICE":
      return searchServices(search, limit, skip);
    case "PRODUCT":
      return searchProducts(search, limit, skip);
    case "PACKAGE":
      return searchPackages(search, limit, skip);
    case "VALUE_PACKAGE":
      return searchValuePackages(search, limit, skip);
    case "GIFT_CARD":
      return searchGiftCards(search, limit, skip);
  }
}

/**
 * One list out of five catalogues, in one order.
 *
 * By name first, because that is what the cashier typed and what the other list screens
 * sort by. Two rows sharing a name are separated by the kind's place in
 * `SALE_ITEM_KINDS`, and `id` breaks the last tie, so the same search twice returns the
 * same list.
 */
function byNameThenKind(a: SaleItem, b: SaleItem): number {
  return (
    a.name.localeCompare(b.name) ||
    SALE_ITEM_KINDS.indexOf(a.kind) - SALE_ITEM_KINDS.indexOf(b.kind) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * The one product a barcode names, if this salon has one.
 *
 * **Exact and normalised, never a `contains`.** A barcode is a code, not a word:
 * a partial match would sell the wrong shampoo for a near-miss scan, so the
 * lookup is equality on the normalised value. The read runs inside the tenant
 * scope, so a barcode another salon uses resolves to nothing here rather than
 * to that salon's product.
 *
 * Archived products are excluded, because the till sells what the salon still
 * offers — the same rule `searchProducts` follows.
 */
async function findProductByBarcode(barcode: string): Promise<SaleItem | null> {
  const threshold = await resolveLowStockThreshold();

  const row = await prisma.product.findFirst({
    where: { barcode, status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      memberPrice: true,
      nonmemberPrice: true,
      quantity: true,
      points: true,
      barcode: true,
    },
  });

  if (!row) return null;

  return {
    kind: "PRODUCT",
    id: row.id,
    name: row.name,
    price: money(row.nonmemberPrice),
    memberPrice: money(row.memberPrice),
    points: row.points,
    quantity: row.quantity,
    lowStock: row.quantity <= threshold,
    barcode: row.barcode,
  };
}

/**
 * The POS item search — five kinds behind one box.
 *
 * One endpoint rather than the picker making five requests, because the cart treats the
 * kinds identically: `SaleLine` stores all five with a single discriminator. Five
 * requests would also fail five different ways for a salon with no add-ons.
 */
export async function searchSaleItems(query: SaleItemSearchQuery): Promise<SaleItemSearchResult> {
  const { entitled } = await moduleEntitlements();

  // The kinds this salon may sell. An add-on it has not bought is absent here and
  // contributes no rows — that absence is how the picker knows which tabs to draw.
  const searchableKinds = SALE_ITEM_KINDS.filter((kind) => entitled.has(SALE_KIND_MODULE[kind]));

  // `?kind=` narrows the rows only. `searchableKinds` stays the whole picture, or a
  // client switching tabs would watch its own capabilities shrink request by request.
  const requested = query.kind
    ? searchableKinds.filter((kind) => kind === query.kind)
    : searchableKinds;

  const groups = await Promise.all(
    requested.map((kind) =>
      readKind(kind, query.search, query.limit + 1, ((query.page ?? 1) - 1) * query.limit),
    ),
  );

  // A scanned or typed barcode resolves to **one** product, and it is always in
  // the answer.
  //
  // The search box and the scanner share one request, so the name search may
  // also have matched. The exact match is resolved separately and never dropped:
  // a product whose *name* does not contain the code would otherwise be
  // unfindable, which is the whole point of a barcode. The client picks it out
  // by comparing `barcode`, so it is found wherever the sort puts it.
  //
  // The product is only resolved when the salon may sell products at all, so an
  // add-on-less salon gains nothing.
  const normalizedBarcode = normalizeBarcode(query.barcode);
  const exact =
    normalizedBarcode !== null && searchableKinds.includes("PRODUCT")
      ? await findProductByBarcode(normalizedBarcode)
      : null;

  // Parsed once for the whole answer. Each reader names the columns of one kind, and
  // this is where a reader that left one out is caught rather than shipping it
  // (AGENTS.md rule 6).
  return saleItemSearchResultSchema.parse({
    searchableKinds,
    hasMore: groups.some((group) => group.length > query.limit),
    items: [
      ...(exact ? [exact] : []),
      // The exact match may also be a name match; it is listed once.
      ...groups
        .flatMap((group) => group.slice(0, query.limit))
        .filter((item) => !(exact && item.kind === exact.kind && item.id === exact.id)),
    ].sort(byNameThenKind),
  });
}
