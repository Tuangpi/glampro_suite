/**
 * Sales — handoff screens 01–02, `/api/sales`.
 *
 * Two halves of one flow live here. The **item search** the cashier types into before
 * anything is in the cart (Phase 5b.1), and the **write** that turns that cart into a
 * receipt (Phase 5b.2): the priced lines, the tenders, the ledgers it fills and the
 * receipt number the confirmation screen prints.
 *
 * The search is **entitlement aware**, and that is the interesting part. A route
 * guarded by an add-on refuses with `403 MODULE_NOT_ENTITLED`, which is right when the
 * whole route *is* the add-on. Here the add-on is one kind among five inside a core
 * feature, so a salon without it gets a shorter list rather than a refused request —
 * and the answer names the kinds it covers (`searchableKinds`) so the picker can draw
 * the tabs it can fill instead of an empty one. "You have none" and "you do not have
 * this" stay different statements, which is the rule the catalogue tabs already keep.
 *
 * The **write refuses** rather than omits, and that asymmetry is deliberate: the
 * search answers "what may I show", where a missing tab costs nothing, while the write
 * answers "may this salon sell that", where quietly dropping the line would sell a
 * haircut and lose a shampoo.
 *
 * Like every other service here, each function runs inside the tenant scope
 * `middleware/auth.ts` opened, so none of them takes a tenant id. Rows are serialised
 * **through** the shared Zod schemas, so a column added to a model and forgotten here
 * throws instead of reaching the browser outside its contract (AGENTS.md rule 6).
 */
import { resolveCommission } from "./commission-rules.js";
import { captureCollectionEvidence } from "./commission-collection-evidence.js";
import { lockCommissionConfiguration } from "./commission.service.js";
import {
  captureRedemptionCommission,
  voidRedemptionCommissionEvidence,
} from "./redemption-commission-evidence.js";
import { readCommissionAttributionPolicy } from "./commission-attribution-policy.js";
import {
  allocatePackage,
  capturePayrollPackagePurchase,
  GST_INCLUSIVE_DIVISOR_STRING,
  GST_RATE_DECIMAL_STRING,
  GST_RATE_PERCENT,
  MAX_RECEIPT_NUMBER,
  SALE_ITEM_KINDS,
  isRedemptionPaymentMethod,
  normalizeBarcode,
  saleDetailSchema,
  commissionAttributionSchema,
  saleItemSearchResultSchema,
  saleListSchema,
  resumeSaleSchema,
  voucherPreviewSchema,
  type CompleteSaleInput,
  type CreateSaleInput,
  type ModuleCode,
  type RefundSaleInput,
  type ResumeSale,
  type SaleDetail,
  type SaleItem,
  type SaleItemKind,
  type SaleItemSearchQuery,
  type SaleItemSearchResult,
  type SaleLineInput,
  type SaleList,
  type SaleListQuery,
  type SalePaymentInput,
  type SaleCollectionInput,
  type VoidSaleInput,
  type VoucherPreview,
  type VoucherPreviewInput,
} from "@glampro_suite/shared";

import { moduleEntitlements } from "../lib/entitlements.js";
import { assertHoldingLive, packageExpiry } from "../lib/package-expiry.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { currentScope, runAsTenant } from "../lib/tenant-context.js";
import { lockPrepaid, prepaidSaleContext } from "../lib/prepaid-lock.js";
import { resolveLowStockThreshold } from "./catalogue.service.js";
import { Prisma } from "../../generated/prisma/client.js";
import { holdingPackageRules } from "../lib/package-rules.js";
import { packagePurchaseValue } from "../lib/package-valuation.js";
import {
  recordPackagePurchase,
  recordPackageRedemption,
  restorePackageRedemption,
  voidPackagePurchase,
} from "./package-valuation-ledger.js";

/**
 * Which module each kind belongs to. A kind is searchable when its module is
 * effective for the caller's salon.
 *
 * `VALUE_PACKAGE` rides the `packages` add-on rather than a module of its own:
 * `MODULE_CODES` has no value-package code, and prepaid credit is bought and sold
 * exactly like a bundle of sessions, so a salon either has both or neither. Giving it
 * a fifteenth code would mean an entitlement nobody's contract mentions.
 */
const KIND_MODULE: Record<SaleItemKind, ModuleCode> = {
  SERVICE: "catalogue",
  PRODUCT: "catalogue",
  PACKAGE: "packages",
  VALUE_PACKAGE: "packages",
  GIFT_CARD: "giftCards",
};

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
  const searchableKinds = SALE_ITEM_KINDS.filter((kind) => entitled.has(KIND_MODULE[kind]));

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

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * The write (Phase 5b.2)
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A `Decimal(12,2)` on the wire is a string, so no cent is lost to a float. */
function amount(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

/**
 * GST helpers (TK2610-0009 / P0-01).
 *
 * Catalogue prices are GST-inclusive, so the component is backed out of the
 * line total: `lineTotal × rate / (100 + rate)`. Rounded to the cent on the
 * **line**, half-up, matching the discount rounding above — the sale total is
 * the sum of those rounded lines, never a recomputation from a rate.
 */
function gstRate(): Prisma.Decimal {
  return new Prisma.Decimal(GST_RATE_DECIMAL_STRING);
}

function gstForLine(lineTotal: Prisma.Decimal, enabled: boolean): Prisma.Decimal {
  if (!enabled) return new Prisma.Decimal(0);
  return lineTotal.mul(GST_RATE_PERCENT).div(GST_INCLUSIVE_DIVISOR_STRING).toDecimalPlaces(2);
}

/**
 * The tenant this write belongs to, from the verified scope.
 *
 * `currentScope()` rather than a parameter, because a tenant id must never arrive from
 * the request (`docs/saas/TENANCY.md`). A platform scope is refused outright:
 * importing history writes sales outside any single salon, and that is Phase 9's
 * problem with an explicit answer, not something to fall into by accident.
 */
function requireTenantScope(): string {
  const scope = currentScope();
  if (scope?.kind !== "tenant") {
    throw new Error(
      "A sale is written inside a tenant scope, and this write ran without one. " +
        "Wrap it in runAsTenant(): a platform scope would file the sale under no salon.",
    );
  }
  return scope.tenantId;
}

/**
 * A line that cannot be sold, named in the message.
 *
 * A 404 here would be a lie the cashier cannot act on — the row exists, it is simply
 * not for sale. The line index is in the details so the cart can mark that row.
 */
function notSellable(index: number, name: string, reason: string): never {
  const message = `${name} cannot be sold: ${reason}.`;
  throw badRequest(message, [{ path: `body.lines.${index}`, message }]);
}

/**
 * Every staff id the body names, checked against this salon.
 *
 * `staffId` arrives from the request — on the sale and per line — so it is checked
 * like every other id this write links to (the customer lookup, the catalogue rows in
 * `priceCart`): read back through the tenant scope, refused when the row is not
 * there. The scoped read cannot tell "no such person" from "somebody else's", and
 * must not — the answer is the same either way, and "forbidden" would confirm the id
 * exists somewhere.
 *
 * Without this, a bogus id is a foreign-key violation the cashier sees as a 500, and
 * another salon's stylist is a row that **does** exist, so the link would be written
 * and a foreign tenant's user credited for this sale's performance. A credit line is
 * money's paper trail; it does not cross salons.
 *
 * The path is per refusal, so the cart can mark the row that named a stranger rather
 * than failing with one undirected message.
 */
async function assertStaffExist(input: {
  staffId?: string;
  lines: SaleLineInput[];
}): Promise<void> {
  const ids = new Set<string>();
  if (input.staffId !== undefined) ids.add(input.staffId);
  for (const line of input.lines) {
    if (line.staffId !== undefined) ids.add(line.staffId);
  }
  if (ids.size === 0) return;

  const rows = await prisma.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true },
  });
  const known = new Set(rows.map((row) => row.id));
  if ([...ids].every((id) => known.has(id))) return;

  const message = "That staff member does not exist.";
  const details: { path: string; message: string }[] = [];
  if (input.staffId !== undefined && !known.has(input.staffId)) {
    details.push({ path: "body.staffId", message });
  }
  input.lines.forEach((line, index) => {
    if (line.staffId !== undefined && !known.has(line.staffId)) {
      details.push({ path: `body.lines.${index}.staffId`, message });
    }
  });
  throw badRequest(message, details);
}

/**
 * Which catalogue row a line points at, once resolved and priced.
 *
 * The price is **not** read from the request. It is computed here from the catalogue
 * and the customer, which is the whole point of the asymmetry the contract documents.
 */
interface ResolvedLine {
  validityDays?: number | null;
  itemType: SaleItemKind;
  itemId: string;
  itemName: string;
  unitPrice: Prisma.Decimal;
  /** Sessions, credit or card value one unit grants — the three granting kinds. */
  grant: Prisma.Decimal | number | null;
  /** The expiry an issued gift card inherits. */
  expiresAt: Date | null;
  points: number;
  /** Stock on hand, for the kinds that have stock. */
  stock: number | null;
}

/**
 * Picks the price for one line.
 *
 * The member/non-member pair is a **server** decision because it depends on the
 * customer attached to the sale, which the cashier can change after searching: a
 * customer carrying a membership reference (`Customer.memberId`) gets the member price,
 * a walk-in and an ordinary customer get the non-member one. The two money kinds hold
 * a single column and so have only one price.
 *
 * `memberId` being free text rather than a row is legacy's shape
 * (`customers.member_id`), and the rebuild keeps it that way, so "is a member" means
 * "carries a membership reference" and nothing more is invented.
 */
function priceLine(
  itemType: SaleItemKind,
  memberPrice: Prisma.Decimal,
  nonmemberPrice: Prisma.Decimal,
  isMember: boolean,
): Prisma.Decimal {
  switch (itemType) {
    case "SERVICE":
    case "PRODUCT":
    case "PACKAGE":
      return isMember ? memberPrice : nonmemberPrice;
    case "VALUE_PACKAGE":
    case "GIFT_CARD":
      return memberPrice;
  }
}

/**
 * Loads the catalogue rows for one kind, keyed by id.
 *
 * One query per kind rather than one per line, so a hundred-line cart is a handful of
 * round trips. Every query is tenant-scoped by the extension, so a foreign id is not
 * "another salon's row", it is **not found** — the same answer a search gives.
 */
async function loadKind(
  kind: SaleItemKind,
  lines: SaleLineInput[],
  isMember: boolean,
): Promise<Map<string, ResolvedLine>> {
  const ids = lines.map((line) => line.itemId);
  const rows = new Map<string, ResolvedLine>();
  const indexOf = (id: string) => lines.findIndex((line) => line.itemId === id);

  switch (kind) {
    case "SERVICE": {
      for (const row of await prisma.service.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          status: true,
          memberPrice: true,
          nonmemberPrice: true,
          points: true,
        },
      })) {
        if (row.status !== "ACTIVE") notSellable(indexOf(row.id), row.name, "it is archived");
        rows.set(row.id, {
          itemType: kind,
          itemId: row.id,
          itemName: row.name,
          unitPrice: priceLine(kind, row.memberPrice, row.nonmemberPrice, isMember),
          grant: null,
          expiresAt: null,
          points: row.points,
          stock: null,
        });
      }
      return rows;
    }

    case "PRODUCT": {
      for (const row of await prisma.product.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          status: true,
          memberPrice: true,
          nonmemberPrice: true,
          points: true,
          quantity: true,
        },
      })) {
        if (row.status !== "ACTIVE") notSellable(indexOf(row.id), row.name, "it is archived");
        rows.set(row.id, {
          itemType: kind,
          itemId: row.id,
          itemName: row.name,
          unitPrice: priceLine(kind, row.memberPrice, row.nonmemberPrice, isMember),
          grant: null,
          expiresAt: null,
          points: row.points,
          stock: row.quantity,
        });
      }
      return rows;
    }

    case "PACKAGE": {
      for (const row of await prisma.package.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          status: true,
          memberPrice: true,
          nonmemberPrice: true,
          sessionCount: true,
          validityDays: true,
        },
      })) {
        if (row.status !== "ACTIVE") notSellable(indexOf(row.id), row.name, "it is archived");
        rows.set(row.id, {
          itemType: kind,
          itemId: row.id,
          itemName: row.name,
          unitPrice: priceLine(kind, row.memberPrice, row.nonmemberPrice, isMember),
          // One unit grants its sessions, which is what a holding counts in.
          grant: row.sessionCount,
          validityDays: row.validityDays,
          expiresAt: null,
          points: 0,
          stock: null,
        });
      }
      return rows;
    }

    case "VALUE_PACKAGE": {
      for (const row of await prisma.valuePackage.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          status: true,
          price: true,
          credit: true,
          validityDays: true,
        },
      })) {
        if (row.status !== "ACTIVE") notSellable(indexOf(row.id), row.name, "it is archived");
        rows.set(row.id, {
          itemType: kind,
          itemId: row.id,
          itemName: row.name,
          unitPrice: row.price,
          // The credit granted, deliberately **not** the price paid: a salon can sell
          // credit at a discount, and a holding that recorded the price would be wrong.
          grant: row.credit,
          validityDays: row.validityDays,
          expiresAt: null,
          points: 0,
          stock: null,
        });
      }
      return rows;
    }

    case "GIFT_CARD": {
      const now = new Date();
      for (const row of await prisma.giftCard.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, value: true, expiresAt: true },
      })) {
        // The rule the search deliberately left to this slice: an expired template is
        // not sellable. The search still shows it — `GiftCard` has no status column, so
        // "expired" is not "archived" — and refusing here is what stops the two halves
        // of the till from disagreeing about what is for sale.
        if (row.expiresAt !== null && row.expiresAt <= now) {
          notSellable(indexOf(row.id), row.name, "the card has expired");
        }
        rows.set(row.id, {
          itemType: kind,
          itemId: row.id,
          itemName: row.name,
          // The card's face value is what the customer pays for it; one money column.
          unitPrice: row.value,
          grant: row.value,
          expiresAt: row.expiresAt,
          points: 0,
          stock: null,
        });
      }
      return rows;
    }
  }
}

/** The kinds that grant something to a customer, and so need one. */
const GRANTING_KINDS: ReadonlySet<SaleItemKind> = new Set<SaleItemKind>([
  "PACKAGE",
  "VALUE_PACKAGE",
  "GIFT_CARD",
]);

/** A line with its catalogue row resolved, priced and checked. */
interface PricedLine {
  input: SaleLineInput;
  item: ResolvedLine;
  /**
   * What one unit costs **after** the discount — the figure `SaleLine.unitPrice` holds,
   * which its own schema comment already describes as "after any discount".
   */
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  /** The rate the till asked for, as stored: `0.00` when nobody discounted the line. */
  discountPercent: Prisma.Decimal;
  /** The money that rate took off the whole line, for the receipt's `Discount` row. */
  discountAmount: Prisma.Decimal;
  /**
   * The voucher's share of this line (ADR 0020). Zero unless a code was applied, and
   * never on the same sale as a manual discount (D1).
   */
  voucherDiscountAmount: Prisma.Decimal;
  /** `lineTotal - voucherDiscountAmount`: what the line actually contributed. */
  netLineTotal: Prisma.Decimal;
  /** GST included in the net line total, backed out of the inclusive figure (TK2610-0009). */
  taxAmount: Prisma.Decimal;
  /** The GST rate applied, snapshotted at sale time; `0` when disabled. */
  taxRate: Prisma.Decimal;
}

/** L2/E1: per-line floor, snapshotted at completion, independent of tender. */
function loyaltyPoints(line: PricedLine): number {
  const original = line.lineTotal.plus(line.discountAmount);
  if (original.lessThanOrEqualTo(0) || line.netLineTotal.lessThanOrEqualTo(0)) return 0;
  return new Prisma.Decimal(line.item.points)
    .mul(line.input.quantity)
    .mul(line.netLineTotal)
    .div(original)
    .floor()
    .toNumber();
}

/**
 * Resolves every line in the cart against the catalogue and prices it.
 *
 * Three things happen here, all before anything is written:
 *
 * 1. **An unentitled kind is refused.** The search omits a kind the salon has not bought;
 *    the write refuses it. Posting a bundle to a salon without the `packages` add-on would
 *    otherwise create a holding nothing can ever spend.
 * 2. **A line whose row is gone** fails the whole write rather than quietly pricing at
 *    zero.
 * 3. **The discount becomes money**, from the catalogue's price and the rate the client
 *    asked for (ADR 0017). The rate rounds to the cent on the **unit** price, which is
 *    what keeps `lineTotal = unitPrice × quantity` true by construction and means two
 *    tills pricing one cart get the same pennies with no allocation step.
 */
async function priceCart(
  lines: SaleLineInput[],
  isMember: boolean,
  gstEnabled: boolean,
): Promise<PricedLine[]> {
  const { entitled } = await moduleEntitlements();

  const byKind = new Map<SaleItemKind, SaleLineInput[]>();
  for (const line of lines) {
    if (!entitled.has(KIND_MODULE[line.itemType])) {
      throw forbidden(
        `Your salon has not bought the ${KIND_MODULE[line.itemType]} module, so it cannot sell a ${line.itemType}.`,
        "MODULE_NOT_ENTITLED",
      );
    }
    const group = byKind.get(line.itemType);
    if (group) group.push(line);
    else byKind.set(line.itemType, [line]);
  }

  const loaded = new Map<string, ResolvedLine>();
  for (const [kind, group] of byKind) {
    for (const [id, row] of await loadKind(kind, group, isMember)) loaded.set(id, row);
  }

  return lines.map((line, index) => {
    const item = loaded.get(line.itemId);
    if (!item) {
      throw badRequest("One of the items in the cart no longer exists.", [
        { path: `body.lines.${index}.itemId`, message: "This item no longer exists." },
      ]);
    }

    // Stock is checked against the row read a moment ago, and the decrement happens in
    // the same transaction that writes the sale, so two tills selling the last bottle
    // cannot both succeed: the second finds nothing left to decrement.
    if (item.stock !== null && line.quantity > item.stock) {
      throw badRequest(`There are only ${item.stock} × ${item.itemName} in stock.`, [
        { path: `body.lines.${index}.quantity`, message: `Only ${item.stock} left in stock.` },
      ]);
    }

    // `toDecimalPlaces(2)` is banker-free half-up rounding, the same one the money
    // columns use. Applied to the unit price so the line's arithmetic is exact: the
    // discount and the stored totals cannot disagree by a cent.
    const discountPercent = new Prisma.Decimal(line.discountPercent ?? 0);
    const discountPerUnit = item.unitPrice.mul(discountPercent).div(100).toDecimalPlaces(2);
    const unitPrice = item.unitPrice.minus(discountPerUnit);
    const lineTotal = unitPrice.mul(line.quantity);
    // Inclusive GST is backed out of the discounted total, not added on top:
    // the customer pays `lineTotal` either way. Rounded per line so the
    // sale total is the sum of what each line recorded (TK2610-0009).
    const rate = gstEnabled ? gstRate() : new Prisma.Decimal(0);

    return {
      input: line,
      item,
      unitPrice,
      lineTotal,
      discountPercent,
      discountAmount: discountPerUnit.mul(line.quantity),
      voucherDiscountAmount: new Prisma.Decimal(0),
      netLineTotal: lineTotal,
      taxAmount: gstForLine(lineTotal, gstEnabled),
      taxRate: rate,
    };
  });
}

/**
 * The voucher's part of the cart, after it has been priced.
 *
 * `voucher` is the row as it stood when the code was quoted — enough to claim it inside
 * the write's transaction and to describe it on the preview. `discountAmount` and
 * `eligibleTotal` are the server's arithmetic, never the browser's.
 */
interface VoucherQuote {
  voucher: {
    id: string;
    code: string;
    description: string | null;
    discountType: "PERCENTAGE" | "FIXED";
    value: Prisma.Decimal;
    minSpend: Prisma.Decimal;
    maxRedemptions: number | null;
    endsAt: Date;
  };
  discountAmount: Prisma.Decimal;
  eligibleTotal: Prisma.Decimal;
}

/**
 * Only the things a voucher may reduce (ADR 0020).
 *
 * A package, value package or gift card grants credit rather than selling a service or
 * a product, so discounting one would discount money the customer can spend elsewhere.
 * The list is explicit rather than "everything except…" so a new kind has to be
 * considered before a voucher silently covers it.
 */
const VOUCHER_ELIGIBLE_KINDS: ReadonlySet<SaleItemKind> = new Set<SaleItemKind>([
  "SERVICE",
  "PRODUCT",
]);

/** One refusal shape, so every failed code points at the control that carried it. */
function voucherInvalid(message: string, code: string): never {
  throw badRequest(message, [{ path: "body.voucherCode", message }], code);
}

/**
 * Applies a published voucher to an already-priced cart.
 *
 * The amount is computed **here**, from the catalogue prices the sale will actually be
 * written with. The client only ever supplies the code, so a hand-edited request cannot
 * name a larger discount than the campaign allows.
 *
 * The discount is split across the eligible lines in proportion to their totals, and
 * the last line takes the rounding remainder. That keeps
 * `SUM(voucherDiscountAmount) === discountAmount` exactly, so the receipt's lines add
 * up to the sale total without a reconciliation row.
 */
async function applyVoucher(
  priced: PricedLine[],
  code: string,
  gstEnabled: boolean,
): Promise<{ priced: PricedLine[]; voucher: VoucherQuote }> {
  const voucher = await prisma.voucher.findFirst({
    where: { code: code.toUpperCase() },
    select: {
      id: true,
      code: true,
      description: true,
      discountType: true,
      value: true,
      startsAt: true,
      endsAt: true,
      minSpend: true,
      maxRedemptions: true,
      redeemedCount: true,
      isActive: true,
    },
  });

  if (!voucher) {
    voucherInvalid("That voucher code is not recognised.", "VOUCHER_NOT_FOUND");
  }
  if (!voucher.isActive) {
    voucherInvalid("That voucher is no longer available.", "VOUCHER_INACTIVE");
  }

  const now = new Date();
  if (voucher.startsAt.getTime() > now.getTime()) {
    voucherInvalid("That voucher is not available yet.", "VOUCHER_NOT_STARTED");
  }
  if (voucher.endsAt.getTime() < now.getTime()) {
    voucherInvalid("That voucher has expired.", "VOUCHER_EXPIRED");
  }
  if (voucher.maxRedemptions !== null && voucher.redeemedCount >= voucher.maxRedemptions) {
    voucherInvalid("That voucher has been fully redeemed.", "VOUCHER_REDEMPTION_LIMIT_REACHED");
  }

  const eligible = priced
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => VOUCHER_ELIGIBLE_KINDS.has(line.item.itemType));
  const eligibleTotal = eligible.reduce(
    (sum, { line }) => sum.plus(line.lineTotal),
    new Prisma.Decimal(0),
  );

  if (eligible.length === 0 || eligibleTotal.lessThanOrEqualTo(0)) {
    voucherInvalid(
      "This voucher does not apply to anything in the cart. It covers services and products only.",
      "VOUCHER_NOT_APPLICABLE",
    );
  }
  if (eligibleTotal.lessThan(voucher.minSpend)) {
    voucherInvalid(
      `This voucher needs at least ${voucher.minSpend.toFixed(2)} of services and products.`,
      "VOUCHER_MIN_SPEND_NOT_MET",
    );
  }

  const rawDiscount =
    voucher.discountType === "PERCENTAGE"
      ? eligibleTotal.mul(voucher.value).div(100)
      : voucher.value;
  const discountAmount = Prisma.Decimal.min(rawDiscount, eligibleTotal).toDecimalPlaces(2);
  if (discountAmount.lessThanOrEqualTo(0)) {
    voucherInvalid("This voucher is worth nothing on this cart.", "VOUCHER_NOT_APPLICABLE");
  }

  const next = priced.map((line) => ({ ...line }));
  let remaining = discountAmount;

  eligible.forEach(({ line, index }, position) => {
    const isLast = position === eligible.length - 1;
    let share = isLast
      ? remaining
      : discountAmount.mul(line.lineTotal).div(eligibleTotal).toDecimalPlaces(2);

    // Defensive caps: a rounding step must never take a line below zero, nor hand out
    // more than the voucher is worth.
    share = Prisma.Decimal.min(share, line.lineTotal, remaining);
    remaining = remaining.minus(share);

    const netLineTotal = line.lineTotal.minus(share);
    next[index] = {
      ...line,
      voucherDiscountAmount: share,
      netLineTotal,
      // GST is inclusive, so the reduction lowers the tax component too. Recomputed on
      // the net line rather than subtracted from the old tax, so rounding is consistent.
      taxAmount: gstForLine(netLineTotal, gstEnabled),
    };
  });

  return {
    priced: next,
    voucher: {
      voucher: {
        id: voucher.id,
        code: voucher.code,
        description: voucher.description,
        discountType: voucher.discountType,
        value: voucher.value,
        minSpend: voucher.minSpend,
        maxRedemptions: voucher.maxRedemptions,
        endsAt: voucher.endsAt,
      },
      discountAmount,
      eligibleTotal,
    },
  };
}

/**
 * The customer a cart is for, and its lines priced from the catalogue.
 *
 * Shared by the two writes that carry a whole cart — ringing it up and completing a
 * hold (ADR 0015) — because the rules are the same and have to stay the same: a
 * foreign customer is not found rather than forbidden, a granting line needs an owner,
 * every staff id is read back through the tenant scope, and the price comes from the
 * catalogue and never from the request. A second copy of this would be a second place
 * for the two writes to disagree.
 */
async function resolveCart(input: {
  customerId?: string;
  staffId?: string;
  lines: SaleLineInput[];
  voucherCode?: string;
}): Promise<{
  priced: PricedLine[];
  customerId: string | null;
  gstRegistrationNumber: string | null;
  voucher: VoucherQuote | null;
}> {
  // A foreign customer is not found rather than forbidden: the extension scopes the
  // lookup, so this cannot tell "no such customer" from "not yours", and must not.
  const customer = input.customerId
    ? await prisma.customer.findFirst({
        where: { id: input.customerId },
        select: { id: true, memberId: true },
      })
    : null;
  if (input.customerId && !customer) {
    throw notFound("That customer does not exist.", "CUSTOMER_NOT_FOUND");
  }

  // A granting line needs an owner, or the credit is issued to nobody. Refused before
  // anything is written rather than as a foreign-key surprise mid-transaction.
  if (!customer && input.lines.some((line) => GRANTING_KINDS.has(line.itemType))) {
    throw badRequest("A package, value package or gift card needs a customer.", [
      { path: "body.customerId", message: "Required to sell something that grants credit." },
    ]);
  }

  // Checked before anything is written, so a cart naming a stranger fails whole rather
  // than as a foreign-key violation mid-transaction — or, worse, as a link that lands.
  await assertStaffExist(input);

  // The salon's GST toggle (TK2610-0009): catalogue prices include GST when on,
  // and the toggle is read here — once per write — so every line in the cart
  // prices under the same flag.
  const tenant = await prisma.tenant.findUnique({
    where: { id: requireTenantScope() },
    select: { gstEnabled: true, gstRegistrationNumber: true },
  });

  // "Is a member" is the membership reference legacy kept as free text
  // (`customers.member_id`). There is no membership table to join, so the presence of
  // the reference is the whole rule — inventing a tier model is a product decision this
  // slice does not get to make.
  const priced = await priceCart(
    input.lines,
    customer?.memberId != null,
    tenant?.gstEnabled ?? false,
  );

  // A voucher is priced against the same lines the sale will be written with, and the
  // quote is kept so the write can claim it inside its transaction (ADR 0020).
  let finalPriced = priced;
  let voucher: VoucherQuote | null = null;
  if (input.voucherCode !== undefined) {
    // D1: the two kinds of reduction are exclusive. Refusing here — before the code is
    // priced — keeps the voucher's arithmetic off lines that already carry a discount,
    // and keeps the receipt from having to explain two reductions at once.
    if (priced.some((line) => line.discountPercent.greaterThan(0))) {
      voucherInvalid(
        "A voucher cannot be used with a manual line discount. Remove the discount before applying the code.",
        "VOUCHER_WITH_MANUAL_DISCOUNT",
      );
    }
    const applied = await applyVoucher(priced, input.voucherCode, tenant?.gstEnabled ?? false);
    finalPriced = applied.priced;
    voucher = applied.voucher;
  }

  return {
    priced: finalPriced,
    customerId: customer?.id ?? null,
    // The receipt's legal identity, snapshotted only while GST is charged: a number
    // beside a zero-tax sale would claim a tax invoice that was never issued.
    gstRegistrationNumber: tenant?.gstEnabled ? tenant.gstRegistrationNumber : null,
    voucher,
  };
}

/**
 * What a cart adds up to.
 *
 * `outstandingAmount` is a *positive* remainder: overpayment is change given, not a
 * negative debt, and a customer who hands over a hundred for eighty is not owed twenty.
 * It is computed for a hold as well, where it is the whole total — a hold has taken no
 * money — but nothing reads it there, because a hold writes no outstanding row.
 */
function totalsOf(priced: PricedLine[], payments: SalePaymentInput[]) {
  const totalQuantity = priced.reduce((sum, line) => sum + line.input.quantity, 0);
  const totalAmount = priced.reduce(
    (sum, line) => sum.plus(line.netLineTotal),
    new Prisma.Decimal(0),
  );
  // The sale's GST is the sum of the rounded line components — never a rate
  // applied to the total — so the receipt matches its lines to the cent.
  const taxAmount = priced.reduce((sum, line) => sum.plus(line.taxAmount), new Prisma.Decimal(0));
  const taxRate = priced.length > 0 ? priced[0]!.taxRate : new Prisma.Decimal(0);
  const paidAmount = payments.reduce(
    (sum, tender) => sum.plus(tender.amount),
    new Prisma.Decimal(0),
  );

  return {
    totalQuantity,
    totalAmount,
    taxAmount,
    taxRate,
    paidAmount,
    outstandingAmount: Prisma.Decimal.max(totalAmount.minus(paidAmount), 0),
    paymentStatus: (paidAmount.greaterThanOrEqualTo(totalAmount) ? "PAID" : "UNPAID") as
      "PAID" | "UNPAID",
  };
}

/**
 * Claims one redemption inside the transaction that writes the sale.
 *
 * The update is **count-guarded** on the voucher's own availability, exactly like the
 * stock decrement and the held-sale status check: two tills spending the last redemption
 * at the same instant cannot both succeed, because the loser's `updateMany` matches no
 * row and its whole sale rolls back. Checking `redeemedCount` in the service would leave
 * a window between the read and the write.
 *
 * `VoucherRedemption.saleId` is unique too, so a duplicate write for one sale is refused
 * by the database rather than by a convention.
 */
async function redeemVoucher(
  tx: SaleTransaction,
  tenantId: string,
  saleId: string,
  quote: VoucherQuote,
): Promise<void> {
  const now = new Date();
  const where: Prisma.VoucherWhereInput = {
    id: quote.voucher.id,
    isActive: true,
    startsAt: { lte: now },
    endsAt: { gte: now },
  };
  if (quote.voucher.maxRedemptions !== null) {
    where.redeemedCount = { lt: quote.voucher.maxRedemptions };
  }

  const claimed = await tx.voucher.updateMany({
    where,
    data: { redeemedCount: { increment: 1 } },
  });
  if (claimed.count === 0) {
    throw conflict(
      "That voucher has just been fully redeemed. Nothing has been charged.",
      "VOUCHER_REDEMPTION_LIMIT_REACHED",
    );
  }

  await tx.voucherRedemption.create({
    data: {
      tenantId,
      voucherId: quote.voucher.id,
      saleId,
      amount: quote.discountAmount,
    },
  });
}

/**
 * Writes the sale and everything that hangs off it, in one transaction.
 *
 * **All of it or none of it.** A sale whose receipt number was taken but whose lines
 * failed is a number the salon never printed and a customer who was charged nothing;
 * a line written without its holding is a package a customer paid for and cannot use.
 * The ledgers are part of the sale, not bookkeeping that follows it, so they live in
 * the same transaction as the sale row.
 *
 * The receipt number is allocated here, from the tenant's own counter (ADR 0011), by
 * an atomic increment. Two tills rung up at the same instant therefore take different
 * numbers, and a rolled-back write gives its number back rather than burning it.
 *
 * **A hold takes the other branch** (ADR 0015). The sale row is written `HELD` with a
 * `null` receipt number and its lines, and the transaction ends there: no counter, no
 * tenders, no `fillLedgers`. Parking a cart therefore burns no receipt number and moves
 * no stock, and the draft it leaves behind is the row `completeSale` later rings up.
 */
async function writeSale(
  tenantId: string,
  input: CreateSaleInput,
  priced: PricedLine[],
  customerId: string | null,
  gstRegistrationNumber: string | null,
  voucher: VoucherQuote | null,
): Promise<string> {
  const totals = totalsOf(priced, input.payments);
  const soldAt = new Date();
  // `hold` is optional in the contract, so `=== true` is the whole test: an absent flag
  // is an ordinary sale, which is what every caller before this slice sends.
  const hold = input.hold === true;

  return prisma.$transaction(async (tx) => {
    await lockPrepaid(tx, tenantId);
    if (hold) {
      const parked = await tx.sale.create({
        data: {
          tenantId,
          customerId,
          staffId: input.staffId ?? null,
          status: "HELD",
          totalQuantity: totals.totalQuantity,
          totalAmount: totals.totalAmount,
          taxAmount: totals.taxAmount,
          taxRate: totals.taxRate,
          // `UNPAID` is accurate — a hold has taken no money — and it is not a debt: an
          // outstanding row is only ever written by `fillLedgers`, which a hold never
          // reaches, and every report reads `status = COMPLETED` (ADR 0015 §4).
          paidAmount: new Prisma.Decimal(0),
          paymentStatus: "UNPAID",
          soldAt,
          note: input.note ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
        },
        select: { id: true },
      });

      await writeLines(tx, tenantId, parked.id, priced);
      return parked.id;
    }

    const { receiptCounter } = await tx.tenant.update({
      where: { id: tenantId },
      data: { receiptCounter: { increment: 1 } },
      select: { receiptCounter: true },
    });

    // The ceiling is a real `Int` bound, not decoration: a counter that reached it
    // would store a number the contract's `saleDetailSchema` refuses to parse, so the
    // write stops here with an explanation instead of writing an unreadable receipt.
    if (receiptCounter > MAX_RECEIPT_NUMBER) {
      throw conflict(
        "This salon has used every available receipt number. Please contact your provider.",
        "RECEIPT_NUMBER_EXHAUSTED",
      );
    }

    const sale = await tx.sale.create({
      data: {
        tenantId,
        customerId,
        staffId: input.staffId ?? null,
        // The till rings a sale up; `HELD` is for a quote the cashier has not confirmed.
        status: "COMPLETED",
        collectionCurrency: input.collection?.currency ?? null,
        totalQuantity: totals.totalQuantity,
        totalAmount: totals.totalAmount,
        taxAmount: totals.taxAmount,
        taxRate: totals.taxRate,
        gstRegistrationNumber,
        // `null` for the ordinary sale nobody vouchered. Snapshotted rather than joined,
        // so the receipt keeps explaining the lower total after the campaign is archived.
        voucherCode: voucher?.voucher.code ?? null,
        voucherDiscountAmount: voucher?.discountAmount ?? new Prisma.Decimal(0),
        paidAmount: totals.paidAmount,
        paymentStatus: totals.paymentStatus,
        soldAt,
        note: input.note ?? null,
        receiptNumber: receiptCounter,
        idempotencyKey: input.idempotencyKey ?? null,
      },
      select: { id: true },
    });

    await prepaidSaleContext(tx, sale.id);
    await writeLines(tx, tenantId, sale.id, priced);
    if (voucher !== null) {
      await redeemVoucher(tx, tenantId, sale.id, voucher);
    }
    await writePayments(tx, tenantId, sale.id, input.payments, input.collection);
    // After the tenders are written and before the ledgers are filled: the draw is
    // part of the sale, and a failure anywhere here rolls the whole receipt back.
    await redeemPayments(
      tx,
      tenantId,
      sale.id,
      customerId,
      priced,
      input.payments,
      totals.totalAmount,
    );

    await fillLedgers(
      tx,
      tenantId,
      sale.id,
      customerId,
      priced,
      totals.paymentStatus,
      totals.outstandingAmount,
      soldAt,
    );

    return sale.id;
  });
}

/**
 * One row per line, in cart order.
 *
 * `createMany` rather than a nested `create`: the Prisma extension merges `tenantId`
 * into the payload it is handed and cannot reach inside a nested write, which is why
 * every other service links with `deleteMany`/`createMany` too. The `position` is what
 * puts the lines back in cart order on the receipt.
 *
 * Shared with `completeSale`, which rewrites the lines of a hold it is ringing up: the
 * ordering rule is the same one, and it is worth writing once.
 */
async function writeLines(
  tx: SaleTransaction,
  tenantId: string,
  saleId: string,
  priced: PricedLine[],
): Promise<void> {
  const creditedIds = [
    ...new Set(
      priced.flatMap((line) =>
        [
          ...(line.input.attribution?.sellers ?? []),
          ...(line.input.attribution?.performers ?? []),
        ].map((credit) => credit.staffId),
      ),
    ),
  ];
  await lockCommissionConfiguration(tx, tenantId);
  const sale = await tx.sale.findFirst({ where: { id: saleId }, select: { status: true } });
  const policy = await readCommissionAttributionPolicy(tx);
  // Drafts may remain incomplete. Completion is authoritative, including held carts.
  if (sale?.status === "COMPLETED") {
    for (const line of priced) {
      if (policy.requireSellers && !line.input.attribution?.sellers)
        throw badRequest("Select sellers: seller attribution is required by salon policy.");
      if (
        policy.requireServicePerformers &&
        line.item.itemType === "SERVICE" &&
        !line.input.attribution?.performers
      )
        throw badRequest("Select performers: service attribution is required by salon policy.");
    }
  }
  if (creditedIds.length > 0) {
    // Recheck inside the write transaction. No platform/cashier attribution fallback.
    const credited = await tx.user.findMany({
      where: { id: { in: creditedIds }, disabled: false },
      select: { id: true },
    });
    if (credited.length !== creditedIds.length)
      throw badRequest("Credited staff must be enabled members of this salon.");
  }
  for (const line of priced) {
    if (line.input.attribution) commissionAttributionSchema.parse(line.input.attribution);
    if (line.input.attribution?.performers && line.item.itemType !== "SERVICE")
      throw badRequest("Performers may only be assigned to service lines.");
    if (line.input.attribution?.performers) {
      const service = await tx.service.findFirst({
        where: { id: line.item.itemId },
        select: { departmentId: true },
      });
      if (!service) throw badRequest("Attributed service is unavailable.");
      if (service.departmentId) {
        const eligible = await tx.user.findMany({
          where: {
            id: { in: line.input.attribution.performers.map((row) => row.staffId) },
            departments: { some: { departmentId: service.departmentId } },
          },
          select: { id: true },
        });
        if (eligible.length !== line.input.attribution.performers.length)
          throw badRequest("Performing therapists must belong to the service department.");
      }
    }
  }
  await tx.saleLine.createMany({
    data: priced.map((line, index) => ({
      tenantId,
      saleId,
      itemType: line.item.itemType,
      itemId: line.item.itemId,
      // Snapshotted at sale time, so archiving a service keeps the receipt readable.
      itemName: line.item.itemName,
      quantity: line.input.quantity,
      // After the discount, which is exactly what `SaleLine.unitPrice` documents itself
      // as holding — and `discountAmount` is the money that got it there (ADR 0017).
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      discountPercent: line.discountPercent,
      discountAmount: line.discountAmount,
      // The voucher's share is stored beside the manual discount, never instead of it:
      // D1 keeps the two off one sale, but the receipt still has to say which applied.
      voucherDiscountAmount: line.voucherDiscountAmount,
      loyaltyBasePoints: line.item.points * line.input.quantity,
      loyaltyOriginalAmount: line.lineTotal.plus(line.discountAmount),
      loyaltyNetAmount: line.netLineTotal,
      loyaltyAwardedPoints: loyaltyPoints(line),
      // Inclusive GST backed out of the line total at pricing time, with the
      // rate snapshotted alongside — a later rate change never rewrites this.
      taxAmount: line.taxAmount,
      taxRate: line.taxRate,
      staffId: line.input.staffId ?? null,
      attribution: line.input.attribution ?? Prisma.DbNull,
      position: index,
    })),
  });
}

/** One row per tender, so a split is two rows rather than a string no report can sum. */
async function writePayments(
  tx: SaleTransaction,
  tenantId: string,
  saleId: string,
  payments: SalePaymentInput[],
  collection?: SaleCollectionInput,
): Promise<void> {
  if (payments.length === 0) {
    if (collection) throw badRequest("Collection capture requires a positive money tender.");
    return;
  }

  if (collection) {
    const lines = await tx.saleLine.findMany({ where: { saleId }, orderBy: { position: "asc" } });
    const seen = new Set<string>();
    for (const allocation of collection.allocations) {
      const key = `${allocation.paymentIndex}:${allocation.linePosition}`;
      if (
        seen.has(key) ||
        !payments[allocation.paymentIndex] ||
        !lines.some((line) => line.position === allocation.linePosition)
      )
        throw badRequest(
          "Collection allocations require distinct valid tender and line positions.",
        );
      seen.add(key);
    }
    if (
      payments.some(
        (payment) => isRedemptionPaymentMethod(payment.method) || payment.sessionId !== undefined,
      )
    )
      throw badRequest(
        "Collection capture currently supports recorded money tenders without gateway sessions only.",
      );
    for (const [index, tender] of payments.entries()) {
      const allocated = collection.allocations
        .filter((row) => row.paymentIndex === index)
        .reduce((sum, row) => sum + BigInt(row.grossCents), 0n);
      if (allocated !== BigInt(new Prisma.Decimal(tender.amount).times(100).toFixed(0)))
        throw badRequest(
          "Each tender's explicit allocations must equal its recorded amount.",
          "COLLECTION_ALLOCATION_INVALID",
        );
      const payment = await tx.salePayment.create({
        data: { tenantId, saleId, method: tender.method, amount: tender.amount },
      });
      if (payment.amount.isZero()) {
        if (collection.allocations.some((row) => row.paymentIndex === index))
          throw badRequest("Zero tenders cannot have positive collection allocations.");
        continue;
      }
      try {
        await captureCollectionEvidence(tx, {
          eventKey: `checkout:${payment.id}`,
          sourceType: "SALE_PAYMENT",
          sourceId: payment.id,
          saleId,
          currency: collection.currency,
          reason: "Cashier confirmed checkout collection allocations",
          allocations: collection.allocations
            .filter((row) => row.paymentIndex === index)
            .map((row) => ({
              saleLineId: lines.find((line) => line.position === row.linePosition)!.id,
              grossCents: row.grossCents,
            })),
        });
      } catch (error) {
        if (error instanceof RangeError)
          throw badRequest(error.message, "COLLECTION_ALLOCATION_INVALID");
        throw error;
      }
    }
    return;
  }

  await tx.salePayment.createMany({
    data: payments.map((tender) => ({
      tenantId,
      saleId,
      method: tender.method,
      amount: tender.amount,
      sessionId: tender.sessionId ?? null,
    })),
  });
}

/**
 * Spends the credit a redemption tender names — TK2610-0011 / P0-04.
 *
 * **A redemption is a tender, not a discount.** The sale keeps its full total, the
 * lines keep the prices the catalogue charged, points are earned on what the service
 * was worth, and the receipt says what paid for it (`SalePayment.method`). Making it
 * a discount would have cheapened the line and taken the stylist's commission and the
 * customer's points down with it.
 *
 * What is spent is decided **here, from the ledgers**, not by the browser. The till
 * sends a `holdingId` and an amount; this recomputes what that holding actually
 * covers and refuses the sale if the two disagree. A browser cannot invent a package
 * balance, and the same rule makes the amount a hand-edited request posts either
 * exact or refused, never approximately right.
 *
 * A **session** covers one eligible service unit, in cart order, up to the sessions
 * the package has left. "Eligible" means a `SERVICE` line whose service the package
 * lists — the same links the salon drew when it built the package. A package that
 * bundles several services still spends one session per unit, so a package whose
 * "one use" is meant to be a *set* of services needs that semantic in its own model
 * (P2-03), not a guess here.
 *
 * Credit is **fungible**: it pays for any line, in any amount up to what is left.
 *
 * Every draw is count-guarded (`quantityRemaining/amountRemaining >= the draw`) so two
 * tills spending the last session at the same instant cannot both succeed — the losing
 * update matches no rows and its sale rolls back with it.
 */
async function redeemPayments(
  tx: SaleTransaction,
  tenantId: string,
  saleId: string,
  customerId: string | null,
  priced: PricedLine[],
  payments: SalePaymentInput[],
  totalAmount: Prisma.Decimal,
): Promise<void> {
  const redemptions = payments.filter((tender) => isRedemptionPaymentMethod(tender.method));
  if (redemptions.length === 0) return;

  // Credit belongs to a person, so a walk-in cart cannot spend any. The contract
  // already forces the customer on a cart that *grants* credit; this is the other end
  // of the same rule.
  if (customerId === null) {
    throw badRequest(
      "A package or credit tender needs a customer, because the credit belongs to somebody.",
      undefined,
      "HOLDING_REQUIRES_CUSTOMER",
    );
  }

  const redemptionTotal = redemptions.reduce(
    (sum, tender) => sum.plus(tender.amount),
    new Prisma.Decimal(0),
  );
  if (redemptionTotal.greaterThan(totalAmount)) {
    throw badRequest(
      "Package and credit tenders cannot pay more than the sale totals.",
      undefined,
      "REDEMPTION_EXCEEDS_TOTAL",
    );
  }

  const usedAt = new Date();
  // Publisher/period lock precedes holding locks on all commission-aware redemptions.
  await lockCommissionConfiguration(tx, tenantId);
  const allocated = priced.map(() => 0);
  for (const tender of redemptions) {
    // `salePaymentInputSchema` requires a holding on a redemption tender, and the
    // service only ever sees a parsed body, so the field is present here.
    const holdingId = tender.holdingId as string;
    if (tender.method === "PACKAGE") {
      await redeemPackage(
        tx,
        tenantId,
        saleId,
        customerId,
        priced,
        tender,
        holdingId,
        usedAt,
        allocated,
      );
    } else {
      await redeemCredit(tx, tenantId, saleId, customerId, tender, holdingId, usedAt);
    }
  }
}

/** One package tender: draws the sessions its covered units need. */
async function redeemPackage(
  tx: SaleTransaction,
  tenantId: string,
  saleId: string,
  customerId: string,
  priced: PricedLine[],
  tender: SalePaymentInput,
  holdingId: string,
  usedAt: Date,
  allocated: number[],
): Promise<void> {
  // Lock before reading: a granting-sale reversal must not validate an unspent
  // holding while this transaction is about to consume it.
  await tx.customerPackageHolding.updateMany({
    where: { id: holdingId, customerId },
    data: { quantityRemaining: { increment: 0 } },
  });
  const holding = await tx.customerPackageHolding.findFirst({
    where: { id: holdingId, customerId },
    select: {
      id: true,
      packageId: true,
      quantityRemaining: true,
      expiresAt: true,
      redemptionRules: true,
      package: { select: { name: true, services: { select: { serviceId: true } } } },
    },
  });
  // Another salon's holding is not "forbidden": the tenant scope means it simply is
  // not there, and the message says so without confirming that an id exists.
  if (!holding) {
    throw notFound(
      "That package is not this customer's, or it no longer exists.",
      "HOLDING_NOT_FOUND",
    );
  }

  const name = holding.package.name;
  assertHoldingLive(holding.expiresAt, name, usedAt);
  if (holding.quantityRemaining === 0) {
    throw conflict(`${name} has no sessions left.`, "HOLDING_INSUFFICIENT");
  }

  const allocation = allocatePackage(
    holdingPackageRules(holding.redemptionRules, holding.package.services),
    holding.quantityRemaining,
    priced.map((line) => ({
      itemType: line.item.itemType,
      itemId: line.item.itemId,
      quantity: line.input.quantity,
      totalCents: line.netLineTotal.mul(100).toNumber(),
    })),
    allocated,
  );
  const sessions = allocation.sessions;
  const covered = new Prisma.Decimal(allocation.cents).div(100);

  if (sessions === 0) {
    throw badRequest(
      `${name} does not cover anything in this cart.`,
      undefined,
      "HOLDING_NOT_COVERED",
    );
  }

  // The amount is checked rather than taken on trust: it is the client's statement of
  // what it thinks the package covers, and the price of a service can change between
  // the search and the post.
  if (!covered.equals(tender.amount)) {
    throw badRequest(
      `${name} covers ${covered.toFixed(2)} of this cart, not ${new Prisma.Decimal(
        tender.amount,
      ).toFixed(2)}. Take the payment again and the till will re-price it.`,
      undefined,
      "HOLDING_NOT_COVERED",
    );
  }
  const coveredLines = allocation.units
    .map((units, index) => ({
      position: index,
      quantity: units - (allocated[index] ?? 0),
    }))
    .filter((line) => line.quantity > 0);
  allocated.splice(0, allocated.length, ...allocation.units);

  const drawn = await tx.customerPackageHolding.updateMany({
    where: { id: holding.id, quantityRemaining: { gte: sessions } },
    data: { quantityRemaining: { decrement: sessions } },
  });
  if (drawn.count === 0) {
    throw conflict(
      `${name} has just been spent at another till. Nothing has been charged.`,
      "HOLDING_INSUFFICIENT",
    );
  }

  // `amount` stays null: a session is not money. What the package paid is on the
  // tender row, and this row is the ledger entry that says how many sessions went.
  const redemption = await tx.customerRedemption.create({
    data: {
      tenantId,
      customerId,
      saleId,
      itemType: "PACKAGE",
      itemId: holding.packageId,
      quantity: sessions,
      usedAt,
      holdingId: holding.id,
    },
  });
  await recordPackageRedemption(tx, holding.id, redemption.id, sessions);
  const storedLines = await tx.saleLine.findMany({
    where: { saleId },
    select: { id: true, position: true },
  });
  await captureRedemptionCommission(
    tx,
    redemption.id,
    coveredLines.map((coveredLine) => {
      const line = priced[coveredLine.position]!;
      const stored = storedLines.find((row) => row.position === coveredLine.position);
      if (!stored) throw new Error("Redemption covered sale line is missing.");
      return {
        saleLineId: stored.id,
        serviceId: line.item.itemId,
        quantity: coveredLine.quantity,
        performers: line.input.attribution?.performers ?? null,
      };
    }),
    tender.performers,
  );
}

/** One credit tender: draws money off a value-package holding. */
async function redeemCredit(
  tx: SaleTransaction,
  tenantId: string,
  saleId: string,
  customerId: string,
  tender: SalePaymentInput,
  holdingId: string,
  usedAt: Date,
): Promise<void> {
  if (holdingId.startsWith("family:")) {
    const familyId = holdingId.slice("family:".length);
    const membership = await tx.prepaidFamilyMember.findFirst({ where: { customerId, familyId } });
    const customer = await tx.customer.findFirst({ where: { id: customerId, archivedAt: null } });
    if (!membership || !customer)
      throw notFound("This family credit is not available to this customer.", "HOLDING_NOT_FOUND");
    const members = await tx.prepaidFamilyMember.findMany({
      where: { familyId },
      select: { customerId: true },
    });
    const holdings = await tx.customerValuePackageHolding.findMany({
      where: {
        sharedFamilyId: familyId,
        customerId: { in: members.map((row) => row.customerId) },
        customer: { archivedAt: null },
        amountRemaining: { gt: 0 },
        OR: [{ expiresAt: null }, { expiresAt: { gt: usedAt } }],
      },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    let remaining = new Prisma.Decimal(tender.amount);
    if (
      holdings
        .reduce((sum, row) => sum.plus(row.amountRemaining), new Prisma.Decimal(0))
        .lessThan(remaining)
    )
      throw conflict(
        "There is not enough live shared family credit. Reload balances.",
        "HOLDING_INSUFFICIENT",
      );
    for (const holding of holdings) {
      if (remaining.isZero()) break;
      const amount = Prisma.Decimal.min(remaining, holding.amountRemaining);
      const drawn = await tx.customerValuePackageHolding.updateMany({
        where: { id: holding.id, amountRemaining: { gte: amount } },
        data: { amountRemaining: { decrement: amount } },
      });
      if (drawn.count !== 1)
        throw conflict("Family credit changed. Nothing was charged.", "HOLDING_INSUFFICIENT");
      await tx.customerRedemption.create({
        data: {
          tenantId,
          customerId,
          saleId,
          itemType: "VALUE_PACKAGE",
          itemId: holding.valuePackageId,
          quantity: 1,
          amount,
          usedAt,
          holdingId: holding.id,
        },
      });
      remaining = remaining.minus(amount);
    }
    return;
  }
  await tx.customerValuePackageHolding.updateMany({
    where: { id: holdingId, customerId, sharedFamilyId: null },
    data: { amountRemaining: { increment: 0 } },
  });
  const holding = await tx.customerValuePackageHolding.findFirst({
    where: { id: holdingId, customerId, sharedFamilyId: null },
    select: {
      id: true,
      valuePackageId: true,
      amountRemaining: true,
      expiresAt: true,
      valuePackage: { select: { name: true } },
    },
  });
  if (!holding) {
    throw notFound(
      "That credit is not this customer's, or it no longer exists.",
      "HOLDING_NOT_FOUND",
    );
  }

  const name = holding.valuePackage.name;
  assertHoldingLive(holding.expiresAt, name, usedAt);

  const amount = new Prisma.Decimal(tender.amount);
  if (holding.amountRemaining.lessThan(amount)) {
    throw badRequest(
      `${name} has only ${holding.amountRemaining.toFixed(2)} left, so it cannot pay ${amount.toFixed(
        2,
      )}.`,
      undefined,
      "HOLDING_INSUFFICIENT",
    );
  }

  const drawn = await tx.customerValuePackageHolding.updateMany({
    where: { id: holding.id, amountRemaining: { gte: amount } },
    data: { amountRemaining: { decrement: amount } },
  });
  if (drawn.count === 0) {
    throw conflict(
      `${name} has just been spent at another till. Nothing has been charged.`,
      "HOLDING_INSUFFICIENT",
    );
  }

  await tx.customerRedemption.create({
    data: {
      tenantId,
      customerId,
      saleId,
      itemType: "VALUE_PACKAGE",
      itemId: holding.valuePackageId,
      quantity: 1,
      amount,
      usedAt,
      holdingId: holding.id,
    },
  });
}

/**
 * The ledgers the sale fills.
 *
 * Five things, and each exists because legacy wrote it in the same request as the sale:
 *
 * - **Stock** comes off the product. Legacy did this in the sale controller
 *   (`SaleController::insertProduct`, a `decrement('quantity', …)` on the row) rather
 *   than in an inventory screen, so leaving it out would let a salon sell the same
 *   bottle twice and show stock it does not have.
 * - **Holdings** are granted for the three kinds that give something: sessions for a
 *   bundle, credit for a value package, a card for a gift card. Each names the line
 *   that granted it, so "which sale gave this customer their package" is answerable.
 * - **Points** are one signed row per sale, not a running balance — the balance is
 *   `SUM(point)`, so a correction is an offsetting row and never an edit to history.
 * - **An outstanding balance** when the sale is not paid in full.
 * - **Performance** for every line that named a stylist, which is what the staff
 *   report reads. Legacy recorded this per sold item rather than per sale.
 */
async function fillLedgers(
  tx: SaleTransaction,
  tenantId: string,
  saleId: string,
  customerId: string | null,
  priced: PricedLine[],
  paymentStatus: "PAID" | "UNPAID",
  outstandingAmount: Prisma.Decimal,
  soldAt: Date,
): Promise<void> {
  // Stock, per product line. `updateMany` with a `gte` guard rather than a bare
  // decrement, so a second till that read the same stock cannot take it below zero:
  // the guarded update matches no rows and this transaction rolls back.
  for (const line of priced) {
    if (line.item.stock === null) continue;
    const taken = await tx.product.updateMany({
      where: { id: line.item.itemId, quantity: { gte: line.input.quantity } },
      data: { quantity: { decrement: line.input.quantity } },
    });
    if (taken.count === 0) {
      throw conflict(
        `${line.item.itemName} just sold out. Nothing has been charged.`,
        "INSUFFICIENT_STOCK",
      );
    }
  }

  if (customerId !== null) {
    await grantHoldings(tx, tenantId, saleId, customerId, priced, soldAt);
  }

  // A point row needs a customer; a walk-in earns nothing, which is why the contract
  // documents `pointsEarned` as `0` for one rather than leaving it undefined.
  const pointsEarned = priced.reduce((sum, line) => sum + loyaltyPoints(line), 0);
  if (customerId !== null && pointsEarned !== 0) {
    await tx.customerPoint.create({
      data: { tenantId, customerId, saleId, point: pointsEarned },
    });
  }

  // An outstanding balance is a debt owed **by a named customer**. A walk-in that was
  // not paid in full has nobody to chase, so it is refused rather than recorded against
  // nobody.
  if (paymentStatus === "UNPAID" && outstandingAmount.greaterThan(0)) {
    if (customerId === null) {
      throw badRequest("This sale is not paid in full, so it needs a customer.", [
        { path: "body.customerId", message: "Required when the sale is not paid in full." },
      ]);
    }
    await tx.customerOutstanding.create({
      data: { tenantId, customerId, saleId, unpaidAmount: outstandingAmount },
    });
  }

  // Performance, one row per attributed line. `amount` is the **line total**, which is
  // what legacy's `employee_performances.amount` meant and what a percentage report
  // multiplies; the per-unit amount would under-report a line of three.
  //
  // A discounted line therefore credits the **payable** figure rather than the list one.
  // Legacy did the same thing invisibly — the discount was nowhere on the record; here it
  // is on the line, so the reduction can be seen and added up (ADR 0017 §6).
  const attributed = priced.filter((line) => line.input.staffId !== undefined);
  if (attributed.length > 0) {
    // Tender does not change service revenue: package/credit-paid service lines
    // earn identically to cash-paid lines. Package purchase lines never qualify.
    await lockCommissionConfiguration(tx, tenantId);
    const staff = await tx.user.findMany({
      where: { id: { in: attributed.map((line) => line.input.staffId as string) } },
      select: { id: true, commissionRate: true },
    });
    const evaluatedAt = new Date();
    const [rules, storedLines, services, products] = await Promise.all([
      tx.commissionRule.findMany({
        where: {
          effectiveAt: { lte: evaluatedAt },
          OR: [{ staffId: null }, { staffId: { in: staff.map((person) => person.id) } }],
        },
      }),
      tx.saleLine.findMany({ where: { saleId }, select: { id: true, position: true } }),
      tx.service.findMany({
        where: {
          id: {
            in: attributed
              .filter((line) => line.item.itemType === "SERVICE")
              .map((line) => line.item.itemId),
          },
        },
        select: { id: true, departmentId: true },
      }),
      tx.product.findMany({
        where: {
          id: {
            in: attributed
              .filter((line) => line.item.itemType === "PRODUCT")
              .map((line) => line.item.itemId),
          },
        },
        select: { id: true, departmentId: true },
      }),
    ]);
    const rates = new Map(staff.map((person) => [person.id, person.commissionRate]));
    const positions = new Map(storedLines.map((line) => [line.position, line.id]));
    const departments = new Map(
      [...services, ...products].map((item) => [item.id, item.departmentId]),
    );
    const commissions = [];
    for (const line of attributed) {
      if (line.item.itemType !== "SERVICE" && line.item.itemType !== "PRODUCT") continue;
      const userId = line.input.staffId as string;
      const selected = resolveCommission(
        rules,
        {
          staffId: userId,
          itemKind: line.item.itemType,
          itemId: line.item.itemId,
          departmentId: departments.get(line.item.itemId) ?? null,
          legacyServiceRate: rates.get(userId)?.toString() ?? "0",
        },
        evaluatedAt,
      );
      const rate = new Prisma.Decimal(selected.rate);
      const basis = line.netLineTotal.minus(line.taxAmount);
      const amount = basis.mul(rate).div(100).toDecimalPlaces(2);
      const saleLineId = positions.get(priced.indexOf(line));
      if (!saleLineId) throw new Error("Commission sale line snapshot is missing.");
      await tx.saleLine.update({
        where: { id: saleLineId },
        data: {
          commissionSnapshot: {
            staffId: userId,
            rate: rate.toFixed(2),
            basis: basis.toFixed(2),
            amount: amount.toFixed(2),
            ruleId: selected.ruleId,
            source: selected.source,
            evaluatedAt: evaluatedAt.toISOString(),
          },
        },
      });
      if (amount.isZero()) continue;
      commissions.push({
        tenantId,
        userId,
        saleId,
        rate,
        amount,
        basis,
        saleLineId,
        ruleId: selected.ruleId,
        ruleSource: selected.source,
      });
    }
    if (commissions.length > 0) await tx.employeeCommission.createMany({ data: commissions });

    await tx.employeePerformance.createMany({
      data: attributed.map((line) => ({
        tenantId,
        // Safe: the filter above is exactly `staffId !== undefined`.
        userId: line.input.staffId as string,
        saleId,
        itemType: line.item.itemType,
        itemId: line.item.itemId,
        amount: line.netLineTotal,
      })),
    });
  }
}

/**
 * Grants the three holdings, one row per granting line.
 *
 * The `saleLineId` is what ties a holding to the sale that granted it, which is how
 * "this package came from sale 24418" stays answerable after the catalogue row is
 * renamed. Legacy reached the same row through a `sale_package_id` column that pointed
 * at a pivot table the rebuild removed.
 */
async function grantHoldings(
  tx: SaleTransaction,
  tenantId: string,
  saleId: string,
  customerId: string,
  priced: PricedLine[],
  soldAt: Date,
): Promise<void> {
  const granting = priced.filter((line) => GRANTING_KINDS.has(line.item.itemType));
  if (granting.length === 0) return;

  // The line ids were just written, in cart order, so `position` lines them up with
  // `priced` rather than re-querying per line.
  const stored = await tx.saleLine.findMany({
    where: { saleId },
    select: {
      id: true,
      position: true,
      sale: { select: { collectionCurrency: true, outletId: true } },
    },
    orderBy: { position: "asc" },
  });

  for (const line of granting) {
    const lineId = stored[priced.indexOf(line)]?.id;
    if (!lineId) continue;
    const quantity = line.input.quantity;

    switch (line.item.itemType) {
      case "PACKAGE": {
        await tx.package.updateMany({
          where: { id: line.item.itemId },
          data: { sessionCount: { increment: 0 } },
        });
        const catalogue = await tx.package.findFirstOrThrow({
          where: { id: line.item.itemId },
          include: { services: { select: { serviceId: true } } },
        });
        const redemptionRules = {
          mode: catalogue.redemptionMode,
          requirements:
            catalogue.redemptionMode === "SERVICE_SET"
              ? catalogue.serviceSet
              : catalogue.services.map(({ serviceId }) => ({ serviceId, quantity: 1 })),
        };
        // Sessions granted scale with the quantity sold, and the remaining balance
        // starts equal to it — the whole grant is unspent at the moment of sale.
        const sessions = Number(line.item.grant) * quantity;
        const source = stored[priced.indexOf(line)]!;
        const economics = packagePurchaseValue(
          line.lineTotal.toFixed(2),
          line.voucherDiscountAmount.toFixed(2),
          line.taxAmount.toFixed(2),
        );
        const holding = await tx.customerPackageHolding.create({
          data: {
            tenantId,
            customerId,
            packageId: line.item.itemId,
            saleLineId: lineId,
            quantity: sessions,
            quantityRemaining: sessions,
            redemptionRules,
            payrollPurchaseSnapshot: capturePayrollPackagePurchase({
              saleId,
              saleLineId: lineId,
              packageId: line.item.itemId,
              originalCustomerId: customerId,
              outletId: source.sale.outletId,
              purchasedAt: soldAt.toISOString(),
              currency: source.sale.collectionCurrency,
              grantedSessions: sessions,
              grossCents: economics.grossCents.toString(),
              netCents: economics.netCents.toString(),
              taxCents: economics.taxCents.toString(),
              sellers: line.input.attribution?.sellers ?? null,
            }),
            expiresAt: packageExpiry(line.item.validityDays, soldAt),
          },
        });
        await recordPackagePurchase(tx, holding.id);
        break;
      }

      case "VALUE_PACKAGE": {
        const credit = (line.item.grant as Prisma.Decimal).mul(quantity);
        await tx.customerValuePackageHolding.create({
          data: {
            tenantId,
            customerId,
            valuePackageId: line.item.itemId,
            saleLineId: lineId,
            amount: credit,
            amountRemaining: credit,
            expiresAt: packageExpiry(line.item.validityDays, soldAt),
          },
        });
        break;
      }

      case "GIFT_CARD": {
        // The issued card inherits the template's expiry, so a card sold from a
        // six-month template expires in six months rather than never.
        const value = (line.item.grant as Prisma.Decimal).mul(quantity);
        await tx.customerGiftCardHolding.create({
          data: {
            tenantId,
            customerId,
            giftCardId: line.item.itemId,
            saleLineId: lineId,
            value,
            valueRemaining: value,
            expiresAt: line.item.expiresAt,
          },
        });
        break;
      }
    }
  }
}

/**
 * The transaction handle, as `$transaction` actually hands it over.
 *
 * Not `Prisma.TransactionClient`: `prisma` is the **extended** client (the tenant
 * scoping lives on it), and its interactive transaction carries those extensions, so
 * the bare namespace type does not describe what `tx` is. Reading the type off the call
 * is what keeps the two from drifting.
 */
type SaleTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** The receipt's own columns, plus the names a printed receipt shows. */
const SALE_SELECT = {
  collectionCurrency: true,
  id: true,
  outletId: true,
  receiptNumber: true,
  status: true,
  paymentStatus: true,
  soldAt: true,
  customerId: true,
  customer: { select: { name: true } },
  staffId: true,
  staff: { select: { name: true } },
  note: true,
  voidedAt: true,
  voidReason: true,
  // The void's actor, by name. A `SetNull` link, so this is `null` for a sale voided by
  // an account that has since been deleted — the sale itself survives that.
  voidedBy: { select: { name: true } },
  totalQuantity: true,
  totalAmount: true,
  paidAmount: true,
  taxAmount: true,
  taxRate: true,
  // The registration number as it was when the sale was completed, so a reprint does
  // not change when the salon edits its settings (TK2610-0010).
  gstRegistrationNumber: true,
  // The campaign this sale consumed, snapshotted on the sale. `null` for the ordinary
  // sale nobody vouchered (ADR 0020).
  voucherCode: true,
  voucherDiscountAmount: true,
  // The one full-sale refund, if any. The sale itself stays `COMPLETED`; this row is the
  // record that the money went back (ADR 0020 / R1).
  refund: {
    select: {
      amount: true,
      reason: true,
      restocked: true,
      refundedAt: true,
      refundedBy: { select: { name: true } },
      payouts: true,
    },
  },
  // The points the ledger recorded, not a recomputation: the ledger is the record, so
  // a correction row written later moves this figure without touching the sale.
  points: { select: { point: true } },
  lines: {
    select: {
      id: true,
      itemType: true,
      itemId: true,
      itemName: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      discountPercent: true,
      discountAmount: true,
      voucherDiscountAmount: true,
      taxAmount: true,
      taxRate: true,
      staffId: true,
      staff: { select: { name: true } },
      attribution: true,
    },
    // Cart order, which is why `SaleLine.position` exists.
    orderBy: { position: "asc" },
  },
  payments: {
    select: { method: true, amount: true, sessionId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.SaleSelect;

/** Serialises a sale row into the contract, parsing so a forgotten column throws. */
function toSaleDetail(row: Prisma.SaleGetPayload<{ select: typeof SALE_SELECT }>): SaleDetail {
  return saleDetailSchema.parse({
    id: row.id,
    outletId: row.outletId,
    receiptNumber: row.receiptNumber,
    status: row.status,
    paymentStatus: row.paymentStatus,
    soldAt: row.soldAt.toISOString(),
    customerId: row.customerId,
    customerName: row.customer?.name ?? null,
    staffId: row.staffId,
    staffName: row.staff?.name ?? null,
    note: row.note,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
    voidedByName: row.voidedBy?.name ?? null,
    totalQuantity: row.totalQuantity,
    totalAmount: amount(row.totalAmount),
    paidAmount: amount(row.paidAmount),
    // Summed from the lines the server wrote, not recomputed from rates: rounding means
    // the rate is not reversible into the money, and the money is what was charged.
    discountAmount: amount(
      row.lines.reduce((sum, line) => sum.plus(line.discountAmount), new Prisma.Decimal(0)),
    ),
    // Stored at write time, snapshotted against later rate changes: the receipt
    // reprints what the till charged, and history never moves (TK2610-0009).
    taxAmount: amount(row.taxAmount),
    taxRate: amount(row.taxRate),
    gstRegistrationNumber: row.gstRegistrationNumber,
    voucherCode: row.voucherCode,
    voucherDiscountAmount: amount(row.voucherDiscountAmount),
    refundedAt: row.refund?.refundedAt.toISOString() ?? null,
    refundAmount: row.refund === null ? null : amount(row.refund.amount),
    refundReason: row.refund?.reason ?? null,
    refundedByName: row.refund?.refundedBy?.name ?? null,
    refundRestocked: row.refund?.restocked ?? null,
    refundPayouts: row.refund?.payouts ?? [],
    // Never negative, for the same reason the write clamps it: overpayment is change.
    outstandingAmount: amount(Prisma.Decimal.max(row.totalAmount.minus(row.paidAmount), 0)),
    collectionCurrency: row.collectionCurrency,
    pointsEarned: row.points.reduce((sum, entry) => sum + entry.point, 0),
    lines: row.lines.map((line) => ({
      id: line.id,
      itemType: line.itemType,
      itemId: line.itemId,
      itemName: line.itemName,
      quantity: line.quantity,
      unitPrice: amount(line.unitPrice),
      lineTotal: amount(line.lineTotal),
      discountPercent: amount(line.discountPercent),
      discountAmount: amount(line.discountAmount),
      voucherDiscountAmount: amount(line.voucherDiscountAmount),
      netLineTotal: amount(line.lineTotal.minus(line.voucherDiscountAmount)),
      taxAmount: amount(line.taxAmount),
      taxRate: amount(line.taxRate),
      staffId: line.staffId,
      staffName: line.staff?.name ?? null,
      attribution:
        line.attribution === null ? null : commissionAttributionSchema.parse(line.attribution),
    })),
    payments: row.payments.map((tender) => ({
      method: tender.method,
      amount: amount(tender.amount),
      sessionId: tender.sessionId,
    })),
  });
}

/**
 * `GET /api/sales/:id` — the receipt.
 *
 * The same shape `POST /api/sales` returns, because the confirmation screen **is** the
 * receipt rather than a second page built from a different set of numbers. A sale from
 * another salon is simply not found: the Prisma extension filters the lookup.
 */
export async function getSale(id: string): Promise<SaleDetail> {
  const row = await prisma.sale.findFirst({ where: { id }, select: SALE_SELECT });
  if (!row) throw notFound("That sale does not exist.", "SALE_NOT_FOUND");

  return toSaleDetail(row);
}

/**
 * `POST /api/sales/voucher-preview` — what a code is worth on **this** cart.
 *
 * The till asks before it takes money, and the answer is the same arithmetic the write
 * will use: `resolveCart` prices the catalogue and `applyVoucher` allocates the reduction.
 * The browser therefore never shows a figure the server would not charge, and a code that
 * is expired or short of its minimum is refused here rather than at the payment step.
 */
export async function previewVoucher(input: VoucherPreviewInput): Promise<VoucherPreview> {
  const { priced, voucher } = await resolveCart({
    customerId: input.customerId,
    lines: input.lines,
    voucherCode: input.voucherCode,
  });

  // A preview never posts. `totalsOf` with no tenders gives the total after the voucher,
  // which is the only other figure the payment sheet draws.
  const totals = totalsOf(priced, []);
  if (voucher === null) {
    // Unreachable: `resolveCart` applies the code whenever it is present. If this ever
    // changes, failing loudly beats drawing a preview for a voucher nobody quoted.
    throw new Error("Voucher preview resolved without a voucher.");
  }

  return voucherPreviewSchema.parse({
    lineNetAmounts: priced.map((line) => amount(line.netLineTotal)),
    code: voucher.voucher.code,
    description: voucher.voucher.description,
    discountType: voucher.voucher.discountType,
    value: amount(voucher.voucher.value),
    discountAmount: amount(voucher.discountAmount),
    eligibleTotal: amount(voucher.eligibleTotal),
    totalAmount: amount(totals.totalAmount),
    minSpend: amount(voucher.voucher.minSpend),
    endsAt: voucher.voucher.endsAt.toISOString(),
  });
}

/**
 * Prisma's unique-constraint violation, as `staff.service.ts` spells it.
 *
 * Deliberately narrow: a bare `catch` that treats every error as "someone else won the
 * race" would swallow a genuine bug and answer it with the wrong sale.
 */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/** The sale a key already produced, or `null`. Scoped, so it is this salon's own. */
async function findByIdempotencyKey(key: string) {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw new Error("Sale lookup requires a tenant scope.");
  // Keys are tenant-unique. A key used in another branch must be a conflict,
  // not a raw unique-constraint failure or a replay of another branch's receipt.
  const replay = await runAsTenant(scope.tenantId, () =>
    prisma.sale.findFirst({
      where: { idempotencyKey: key },
      select: { id: true, outletId: true },
    }),
  );
  if (replay && scope.outletId && replay.outletId !== scope.outletId) {
    throw conflict("This attempt belongs to another outlet.", "IDEMPOTENCY_OUTLET_MISMATCH");
  }
  return replay;
}

/**
 * `POST /api/sales` — rings the sale up and returns its receipt.
 *
 * **Q16, idempotency.** Legacy's `pay-by-cash` posts a payment with no key anywhere,
 * so a double-tap on a slow connection charges twice. The client generates
 * `idempotencyKey` per attempt and this returns the sale that already exists rather
 * than writing a second one. The `@@unique([tenantId, idempotencyKey])` index is what
 * actually enforces it, which also covers two genuinely concurrent posts of one key:
 * the second loses the insert race and reads the winner's sale back.
 *
 * The key is optional because the legacy importer has none to give, and refusing it
 * there would break Phase 9 — an unkeyed write is simply not idempotent.
 *
 * `input.hold` parks the cart instead of ringing it up, and the difference begins and
 * ends at `writeSale`: the customer, the staff and the prices are resolved here either
 * way, so a hold is refused for exactly the reasons a sale is (ADR 0015).
 */
export async function createSale(input: CreateSaleInput): Promise<SaleDetail> {
  const tenantId = requireTenantScope();

  const key = input.idempotencyKey;
  if (key !== undefined) {
    const replay = await findByIdempotencyKey(key);
    if (replay) return getSale(replay.id);
  }

  const { priced, customerId, gstRegistrationNumber, voucher } = await resolveCart(input);

  try {
    return await getSale(
      await writeSale(tenantId, input, priced, customerId, gstRegistrationNumber, voucher),
    );
  } catch (error) {
    // The concurrent-double-post case: this call lost the unique index to one that has
    // already written the sale, so that sale exists and is the answer to this request.
    if (key !== undefined && isUniqueViolation(error)) {
      const winner = await findByIdempotencyKey(key);
      if (winner) return getSale(winner.id);
    }
    throw error;
  }
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Hold, resume and discard (Phase 5g)
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Resolve held items by exact kind/id, never by a limited catalogue search. No writes. */
export async function resumeSale(saleId: string): Promise<ResumeSale> {
  const sale = await getSale(saleId);
  if (sale.status !== "HELD") {
    throw conflict("This sale is no longer held. Refresh the held list.", "SALE_NOT_HELD");
  }
  const { entitled } = await moduleEntitlements();
  const items: ResumeSale["items"] = [];
  for (const kind of SALE_ITEM_KINDS) {
    const lines = sale.lines
      .filter((line) => line.itemType === kind)
      .map((line) => ({
        itemType: kind,
        itemId: line.itemId,
        quantity: line.quantity,
      }));
    if (!lines.length) continue;
    if (!entitled.has(KIND_MODULE[kind])) {
      throw forbidden(
        "This held cart contains a module your salon cannot sell.",
        "MODULE_NOT_ENTITLED",
      );
    }
    const regular = await loadKind(kind, lines, false);
    const member = await loadKind(kind, lines, true);
    for (const line of lines) {
      const row = regular.get(line.itemId);
      const memberRow = member.get(line.itemId);
      if (!row || !memberRow) {
        throw conflict(
          "A held item no longer exists. The cart was not picked up.",
          "HELD_ITEM_UNAVAILABLE",
        );
      }
      items.push({
        kind,
        id: row.itemId,
        name: row.itemName,
        price: money(row.unitPrice),
        memberPrice:
          kind === "VALUE_PACKAGE" || kind === "GIFT_CARD" ? null : money(memberRow.unitPrice),
      });
    }
  }
  // Another till may have completed/discarded it while catalogue rows were read.
  if ((await getSale(saleId)).status !== "HELD") {
    throw conflict("This sale is no longer held. Refresh the held list.", "SALE_NOT_HELD");
  }
  return resumeSaleSchema.parse({ sale, items });
}

/**
 * `GET /api/sales` — the paginated held-cart and receipt list.
 *
 * Newest first with stable id ties and one extra row to detect another page. `lineCount`
 * is the relation's own count rather than a second read, so the number the list draws
 * and the number of rows a resumed cart draws come from one query.
 *
 * `status` arrives already defaulted to `HELD` by the contract, so "no filter" cannot
 * mean "everything" by accident.
 */
export async function listSales(query: SaleListQuery): Promise<SaleList> {
  const page = query.page ?? 1;
  const rows = await prisma.sale.findMany({
    where: { status: query.status },
    select: {
      id: true,
      receiptNumber: true,
      status: true,
      soldAt: true,
      customerId: true,
      customer: { select: { name: true } },
      staffId: true,
      staff: { select: { name: true } },
      note: true,
      totalQuantity: true,
      totalAmount: true,
      _count: { select: { lines: true } },
    },
    // `id` breaks ties, so two carts parked in the same millisecond still have a stable
    // order and the list does not shuffle under the cashier's finger.
    orderBy: [{ soldAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    skip: (page - 1) * query.limit,
  });

  // Parsed once for the whole answer, so a column this reader left out is caught here
  // rather than reaching the browser outside its contract (AGENTS.md rule 6).
  return saleListSchema.parse({
    page,
    hasMore: rows.length > query.limit,
    items: rows.slice(0, query.limit).map((row) => ({
      id: row.id,
      receiptNumber: row.receiptNumber,
      status: row.status,
      soldAt: row.soldAt.toISOString(),
      customerId: row.customerId,
      customerName: row.customer?.name ?? null,
      staffId: row.staffId,
      staffName: row.staff?.name ?? null,
      note: row.note,
      lineCount: row._count.lines,
      totalQuantity: row.totalQuantity,
      totalAmount: amount(row.totalAmount),
    })),
  });
}

/**
 * `POST /api/sales/:id/complete` — rings up a cart that was parked (ADR 0015).
 *
 * The customer, the staff and the prices are resolved by the ordinary `resolveCart`, so
 * a hold is completed under exactly the rules it would have been rung up under. What is
 * *not* ordinary is where the money goes:
 *
 * - The hold's line rows are **deleted and rewritten**. The cart may have been edited
 *   between the resume and the payment, and a draft nobody has printed is not history —
 *   so the receipt is the cart as it was rung up, priced from the catalogue now.
 * - `soldAt` moves to this moment, because that is when the sale happened: the reports
 *   window on `soldAt`, and a cart parked yesterday must not land in yesterday's takings.
 * - The receipt number is allocated **after** the guard below, so a completion that
 *   loses a race does not burn one.
 *
 * A sale that is already `COMPLETED` returns its own receipt rather than writing a
 * second one, which is what makes a double-tap safe without an idempotency key (see
 * `completeSaleSchema`).
 */
export async function completeSale(saleId: string, input: CompleteSaleInput): Promise<SaleDetail> {
  const tenantId = requireTenantScope();

  const held = await prisma.sale.findFirst({
    where: { id: saleId },
    select: { id: true, status: true, staffId: true },
  });
  if (!held) throw notFound("That sale does not exist.", "SALE_NOT_FOUND");

  // A sequential double-tap — the common case — is answered here, from the row itself.
  if (held.status === "COMPLETED") return getSale(held.id);
  if (held.status === "VOID") {
    throw conflict("This sale was voided, so it cannot be completed.", "SALE_ALREADY_VOID");
  }

  const { priced, customerId, gstRegistrationNumber, voucher } = await resolveCart(input);
  const totals = totalsOf(priced, input.payments);
  const soldAt = new Date();
  // Whoever completes the sale rang it up, so the till's signed-in cashier wins. The
  // holder is the fallback for a caller with no principal of its own (a service test).
  const staffId = input.staffId ?? held.staffId;

  await prisma.$transaction(async (tx) => {
    await lockPrepaid(tx, tenantId);
    await prepaidSaleContext(tx, held.id);
    // The guard comes **first**, before the counter moves: only one till may take a
    // hold, and a loser has to give its number back rather than burn it. It is the same
    // count-checked update `fillLedgers` puts on stock, applied to a status.
    const taken = await tx.sale.updateMany({
      where: { id: held.id, status: "HELD" },
      data: {
        customerId,
        staffId,
        status: "COMPLETED",
        collectionCurrency: input.collection?.currency ?? null,
        totalQuantity: totals.totalQuantity,
        totalAmount: totals.totalAmount,
        taxAmount: totals.taxAmount,
        taxRate: totals.taxRate,
        gstRegistrationNumber,
        voucherCode: voucher?.voucher.code ?? null,
        voucherDiscountAmount: voucher?.discountAmount ?? new Prisma.Decimal(0),
        paidAmount: totals.paidAmount,
        paymentStatus: totals.paymentStatus,
        soldAt,
        note: input.note ?? null,
      },
    });
    if (taken.count === 0) {
      // A concurrent completion took the row. The message says what happened rather than
      // reporting success on a write that did not land.
      throw conflict("This cart has already been rung up.", "HOLD_ALREADY_COMPLETED");
    }

    const { receiptCounter } = await tx.tenant.update({
      where: { id: tenantId },
      data: { receiptCounter: { increment: 1 } },
      select: { receiptCounter: true },
    });
    if (receiptCounter > MAX_RECEIPT_NUMBER) {
      throw conflict(
        "This salon has used every available receipt number. Please contact your provider.",
        "RECEIPT_NUMBER_EXHAUSTED",
      );
    }

    await tx.sale.update({ where: { id: held.id }, data: { receiptNumber: receiptCounter } });

    // Rewritten, not read back: the resume may have edited the cart, and `position`
    // starts again at zero so the receipt reprints it in cart order.
    await tx.saleLine.deleteMany({ where: { saleId: held.id } });
    await writeLines(tx, tenantId, held.id, priced);
    if (voucher !== null) {
      await redeemVoucher(tx, tenantId, held.id, voucher);
    }
    await writePayments(tx, tenantId, held.id, input.payments, input.collection);
    await redeemPayments(
      tx,
      tenantId,
      held.id,
      customerId,
      priced,
      input.payments,
      totals.totalAmount,
    );

    await fillLedgers(
      tx,
      tenantId,
      held.id,
      customerId,
      priced,
      totals.paymentStatus,
      totals.outstandingAmount,
      soldAt,
    );
  });

  return getSale(held.id);
}

/**
 * `DELETE /api/sales/:id` — abandons a parked cart (ADR 0015).
 *
 * A hold wrote no ledger and holds no receipt number, so there is nothing to reverse and
 * the row goes for real: a soft delete would put abandoned carts and voided sales in one
 * bucket. `SaleLine` cascades with it, so the draft leaves nothing behind.
 *
 * A sale that is no longer held is **refused** rather than deleted — deleting a receipt
 * is the thing the void exists to prevent — and the count-checked delete is also what
 * makes two tills discarding one hold safe: the second matches nothing.
 */
export async function discardHold(saleId: string): Promise<void> {
  const held = await prisma.sale.findFirst({ where: { id: saleId }, select: { id: true } });
  if (!held) throw notFound("That sale does not exist.", "SALE_NOT_FOUND");

  const removed = await prisma.sale.deleteMany({ where: { id: held.id, status: "HELD" } });
  if (removed.count === 0) {
    throw conflict(
      "Only a cart that is still held can be discarded. A sale that was rung up is voided instead.",
      "SALE_NOT_HELD",
    );
  }
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Void (Phase 5h, ADR 0016)
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** What a void needs to know about the sale it is reversing. */
const VOIDABLE_SALE_SELECT = {
  id: true,
  status: true,
  customerId: true,
  lines: {
    select: { id: true, itemType: true, itemId: true, quantity: true },
    orderBy: { position: "asc" },
  },
  // Summed, then negated: the offsetting row is the *net* of what this sale recorded, so
  // a sale that already carries a correction reverses to zero rather than below it.
  points: { select: { point: true } },
} satisfies Prisma.SaleSelect;

type VoidableSale = Prisma.SaleGetPayload<{ select: typeof VOIDABLE_SALE_SELECT }>;

/**
 * The two reversals a void refuses to make.
 *
 * Both are cases where undoing the sale would need a decision with money attached that a
 * void is not allowed to make (ADR 0016 §6). They run **inside** the void's transaction,
 * so a refused void rolls back and leaves the sale exactly as it was.
 *
 * - **Credit the sale granted has been spent.** A package used, a gift card drawn down,
 *   prepaid credit consumed: undoing the sale would take away something the customer has
 *   already had the benefit of, and what they keep is a goodwill call.
 * - **A balance with a payment against it.** Money came in after the sale, so undoing it
 *   means putting money back — a refund, which is a different verb.
 */
async function assertVoidable(tx: SaleTransaction, sale: VoidableSale): Promise<void> {
  // A refund is the end of the sale's life: the money went back, and voiding afterwards
  // would reverse ledgers a second time while leaving the refund row pointing at a sale
  // the salon now calls undone (ADR 0020 / R1). Read inside the transaction so a refund
  // committed a moment ago is seen even if the sale row was loaded before it.
  const refund = await tx.saleRefund.findFirst({
    where: { saleId: sale.id },
    select: { id: true },
  });
  if (refund !== null) {
    throw conflict("This sale has been refunded, so it cannot be voided.", "SALE_ALREADY_REFUNDED");
  }

  const lineIds = sale.lines.map((line) => line.id);
  if (lineIds.length > 0) {
    // Update locks are held through the final delete, so redemption either commits
    // first (and is refused here) or waits and finds the holding gone.
    const where = { saleLineId: { in: lineIds } };
    await tx.customerPackageHolding.updateMany({
      where,
      data: { quantityRemaining: { increment: 0 } },
    });
    await tx.customerValuePackageHolding.updateMany({
      where,
      data: { amountRemaining: { increment: 0 } },
    });
    await tx.customerGiftCardHolding.updateMany({
      where,
      data: { valueRemaining: { increment: 0 } },
    });
    const [packages, credits, cards] = await Promise.all([
      tx.customerPackageHolding.findMany({
        where: { saleLineId: { in: lineIds } },
        select: { id: true, quantity: true, quantityRemaining: true },
      }),
      tx.customerValuePackageHolding.findMany({
        where: { saleLineId: { in: lineIds } },
        select: { id: true, amount: true, amountRemaining: true },
      }),
      tx.customerGiftCardHolding.findMany({
        where: { saleLineId: { in: lineIds } },
        select: { value: true, valueRemaining: true },
      }),
    ]);

    const sessionTransferred = await tx.sessionPackageTransferEvent.findFirst({
      where: { holdingId: { in: packages.map((holding) => holding.id) } },
      select: { id: true },
    });
    if (sessionTransferred)
      throw conflict(
        "Sessions this sale granted have been transferred. Their ownership history must be preserved; the purchase cannot be voided.",
        "HOLDING_ALREADY_TRANSFERRED",
      );

    const transferred = await tx.prepaidTransferEvent.findFirst({
      where: { holdingId: { in: credits.map((holding) => holding.id) } },
      select: { id: true },
    });
    if (transferred)
      throw conflict(
        "Credit this sale granted has been transferred. Its ownership history must be preserved; the purchase cannot be voided.",
        "HOLDING_ALREADY_TRANSFERRED",
      );

    const spent =
      packages.some((holding) => holding.quantityRemaining < holding.quantity) ||
      credits.some((holding) => holding.amountRemaining.lessThan(holding.amount)) ||
      cards.some((holding) => holding.valueRemaining.lessThan(holding.value));

    if (spent) {
      throw conflict(
        "Credit this sale granted has already been used, so the sale cannot be voided. Reverse the redemption first.",
        "HOLDING_ALREADY_SPENT",
      );
    }
  }

  // `saleId` is unique on the outstanding, so this is at most one row however many
  // payments hang off it.
  await tx.customerOutstanding.updateMany({
    where: { saleId: sale.id },
    data: { unpaidAmount: { increment: 0 } },
  });
  const outstanding = await tx.customerOutstanding.findFirst({
    where: { saleId: sale.id },
    select: { _count: { select: { payments: true } } },
  });
  if (outstanding !== null && outstanding._count.payments > 0) {
    throw conflict(
      "This sale's balance has been paid against, so voiding it would mean refunding money. Reverse the payment first.",
      "OUTSTANDING_ALREADY_PAID",
    );
  }
}

/**
 * Reverses what `fillLedgers` wrote, inside the transaction that flips the status.
 *
 * Written as rows rather than edits wherever the ledger is a history:
 *
 * - **Stock** goes back on the shelf. No upper guard, unlike the decrement: the goods are
 *   real and they have come back, so a stock level that was edited down by hand in the
 *   meantime is the salon's business and not a reason to refuse.
 * - **Points** get an offsetting negative row on the same sale. Never an edit, never a
 *   delete — `CustomerPoint`'s own schema comment makes this the rule for a correction.
 * - **Credit the sale spent** goes back on the holding and its `CustomerRedemption` row
 *   is stamped `revertedAt` rather than deleted — the legacy `unuse_time` this column
 *   already documents. A voided sale therefore refunds the package session, not just
 *   the money.
 * - **Holdings, the outstanding, performance and unpaid commission** are deleted. Nothing has
 *   been spent (see `assertVoidable`) and a voided sale earned nobody anything; what the
 *   lines recorded survives on `SaleLine`, which stays. Paid commissions remain flagged
 *   for reconciliation because a void cannot undo money already paid to staff.
 */
async function reverseForVoid(
  tx: SaleTransaction,
  tenantId: string,
  sale: VoidableSale,
): Promise<void> {
  for (const line of sale.lines) {
    if (line.itemType !== "PRODUCT") continue;
    const restored = await tx.product.updateMany({
      where: { id: line.itemId },
      data: { quantity: { increment: line.quantity } },
    });
    if (restored.count !== 1) {
      throw conflict(
        "A sold product no longer exists. Stock cannot be restored; nothing was reversed.",
        "REVERSAL_PRODUCT_MISSING",
      );
    }
  }

  const pointsEarned = sale.points.reduce((sum, entry) => sum + entry.point, 0);
  if (sale.customerId !== null && pointsEarned !== 0) {
    await tx.customerPoint.create({
      data: { tenantId, customerId: sale.customerId, saleId: sale.id, point: -pointsEarned },
    });
  }

  // What the sale spent, put back. The row is marked rather than deleted so the
  // redemption stays in the customer's history beside the point rows it earns.
  const redemptions = await tx.customerRedemption.findMany({
    where: { saleId: sale.id, revertedAt: null },
    select: { id: true, holdingId: true, itemType: true, quantity: true, amount: true },
  });

  if (redemptions.some((row) => row.itemType === "PACKAGE"))
    await lockCommissionConfiguration(tx, tenantId);
  for (const redemption of redemptions) {
    if (redemption.holdingId !== null) {
      if (redemption.itemType === "PACKAGE") {
        const restored = await tx.customerPackageHolding.updateMany({
          where: { id: redemption.holdingId },
          data: { quantityRemaining: { increment: redemption.quantity } },
        });
        if (restored.count !== 1)
          throw conflict(
            "The redeemed package no longer exists. Nothing was reversed.",
            "REVERSAL_HOLDING_MISSING",
          );
        await restorePackageRedemption(tx, redemption.holdingId, redemption.id);
        await voidRedemptionCommissionEvidence(
          tx,
          redemption.id,
          await tx.sale
            .findFirst({ where: { id: sale.id }, select: { voidedById: true } })
            .then((row) => row?.voidedById ?? null),
        );
      } else if (redemption.itemType === "VALUE_PACKAGE" && redemption.amount !== null) {
        const restored = await tx.customerValuePackageHolding.updateMany({
          where: { id: redemption.holdingId },
          data: { amountRemaining: { increment: redemption.amount } },
        });
        if (restored.count !== 1)
          throw conflict(
            "The redeemed credit no longer exists. Nothing was reversed.",
            "REVERSAL_HOLDING_MISSING",
          );
      }
      // A gift card is not spendable yet (TK2610-0011 covers packages and credit);
      // when it is, its restore belongs here with the other two.
    }

    await tx.customerRedemption.update({
      where: { id: redemption.id },
      data: { revertedAt: new Date() },
    });
  }

  const lineIds = sale.lines.map((line) => line.id);
  if (lineIds.length > 0) {
    const packages = await tx.customerPackageHolding.findMany({
      where: { saleLineId: { in: lineIds } },
      select: { id: true },
    });
    for (const holding of packages) await voidPackagePurchase(tx, holding.id, sale.id);
    await tx.customerPackageHolding.deleteMany({ where: { saleLineId: { in: lineIds } } });
    await tx.customerValuePackageHolding.deleteMany({ where: { saleLineId: { in: lineIds } } });
    await tx.customerGiftCardHolding.deleteMany({ where: { saleLineId: { in: lineIds } } });
  }

  // A void gives the redemption back; a refund deliberately does not (ADR 0020 / R1).
  // The row is marked rather than deleted, exactly like a `CustomerRedemption`, so the
  // campaign's history keeps the sale that consumed and then released it.
  const voucherRedemption = await tx.voucherRedemption.findFirst({
    where: { saleId: sale.id, revertedAt: null },
    select: { id: true, voucherId: true },
  });
  if (voucherRedemption !== null) {
    await tx.voucher.updateMany({
      where: { id: voucherRedemption.voucherId, redeemedCount: { gt: 0 } },
      data: { redeemedCount: { decrement: 1 } },
    });
    await tx.voucherRedemption.update({
      where: { id: voucherRedemption.id },
      data: { revertedAt: new Date() },
    });
  }

  await tx.customerOutstanding.deleteMany({ where: { saleId: sale.id } });
  await tx.employeePerformance.deleteMany({ where: { saleId: sale.id } });
  await tx.employeeCommission.updateMany({
    where: { saleId: sale.id, ledgerVersion: null, paidAt: { not: null } },
    data: { reconciliationRequired: true },
  });
  await tx.employeeCommission.deleteMany({
    where: { saleId: sale.id, ledgerVersion: null, paidAt: null },
  });
}

/**
 * `POST /api/sales/:id/void` — takes a rung-up sale off the books (ADR 0016).
 *
 * The sale **stays**: its lines, its receipt number and its tenders are the record of
 * what happened, and only the status changes. Everything `fillLedgers` wrote is reversed
 * in the same transaction (`reverseForVoid`), so no ledger can be left half-undone by a
 * failure midway.
 *
 * A second void is answered from the row rather than written again: the first reason and
 * the first actor stand, so a double-tap cannot rewrite an audit trail.
 *
 * The actor is a parameter rather than a field of `input`, because it has to come from the
 * verified token and never from the body — see `voidSaleSchema`.
 */
export async function voidSale(
  saleId: string,
  input: VoidSaleInput,
  actorId: string,
): Promise<SaleDetail> {
  const tenantId = requireTenantScope();

  const sale = await prisma.sale.findFirst({
    where: { id: saleId },
    select: VOIDABLE_SALE_SELECT,
  });
  if (!sale) throw notFound("That sale does not exist.", "SALE_NOT_FOUND");

  // Already void: the receipt it has is the answer, and neither the reason nor the actor
  // is rewritten.
  if (sale.status === "VOID") return getSale(sale.id);

  // A cart that was never rung up has no ledger and no receipt number, so there is
  // nothing to void — `DELETE /api/sales/:id` is its ending (ADR 0015).
  if (sale.status === "HELD") {
    throw conflict(
      "This cart was never rung up, so there is nothing to void. Discard it instead.",
      "SALE_NOT_COMPLETED",
    );
  }

  await prisma.$transaction(async (tx) => {
    await lockPrepaid(tx, tenantId, actorId, input.reason);
    await prepaidSaleContext(tx, sale.id);
    // Serialize with refund before checking its record. Otherwise a refund could
    // commit after assertVoidable's read but before this void changes the status.
    await tx.sale.update({ where: { id: sale.id }, data: { updatedAt: new Date() } });
    const current = await tx.sale.findFirst({
      where: { id: sale.id },
      select: VOIDABLE_SALE_SELECT,
    });
    if (!current) throw notFound("That sale does not exist.", "SALE_NOT_FOUND");
    if (current.status === "VOID") return;
    if (current.status !== "COMPLETED")
      throw conflict("This sale was not completed.", "SALE_NOT_COMPLETED");
    // Both refusals run here rather than before, so a void that is going to be refused
    // rolls back inside the same transaction that would have changed the row.
    await assertVoidable(tx, current);

    // Count-guarded, like the hold's completion and the stock decrement: two managers
    // voiding one sale at the same instant cannot both reverse it.
    const voided = await tx.sale.updateMany({
      where: { id: sale.id, status: "COMPLETED" },
      data: {
        status: "VOID",
        voidedAt: new Date(),
        voidReason: input.reason,
        voidedById: actorId,
      },
    });
    if (voided.count === 0) {
      throw conflict("This sale has already been voided.", "SALE_ALREADY_VOID");
    }

    await reverseForVoid(tx, tenantId, current);
  });

  return getSale(sale.id);
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Refund (ADR 0020 / R1)
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * `POST /api/sales/:id/refund` — records a **full-sale** refund.
 *
 * A refund is a fact appended to the sale, not an edit to it: the sale stays
 * `COMPLETED`, its lines, tenders and receipt number stand, and a `SaleRefund` row says
 * the money went back. This is why it is not a void — a void says the sale never
 * happened, a refund says it did and was undone with the customer.
 *
 * **The amount comes from the sale row**, never the request. A caller that could name
 * the figure could refund more than was taken. `restock` is the manager's explicit
 * choice; products go back on the shelf only when they actually came back.
 *
 * A second refund returns the existing receipt rather than writing another row — the
 * `saleId` unique index would refuse it anyway, so the answer is the same record a
 * retry should see. A voided sale has nothing to refund.
 */
export async function refundSale(
  saleId: string,
  input: RefundSaleInput,
  actorId: string,
): Promise<SaleDetail> {
  const sale = await prisma.sale.findFirst({
    where: { id: saleId },
    select: {
      id: true,
      status: true,
      totalAmount: true,
      customerId: true,
      refund: { select: { id: true } },
      points: { select: { point: true } },
      lines: { select: { itemType: true, itemId: true, quantity: true } },
    },
  });
  if (!sale) throw notFound("That sale does not exist.", "SALE_NOT_FOUND");

  // Idempotent, like a void: the first reason and actor are the audit record.
  if (sale.refund !== null) return getSale(sale.id);

  if (sale.status === "HELD") {
    throw conflict(
      "This cart was never rung up, so there is nothing to refund. Discard it instead.",
      "SALE_NOT_COMPLETED",
    );
  }
  if (sale.status === "VOID") {
    throw conflict("This sale was voided, so there is nothing to refund.", "SALE_ALREADY_VOID");
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Lock the sale row first. A void racing this refund either waits and then sees
      // the row below, or holds the row itself and this read sees `VOID` — so the two
      // endings cannot both be recorded.
      await tx.sale.update({ where: { id: sale.id }, data: { updatedAt: new Date() } });
      const current = await tx.sale.findFirst({
        where: { id: sale.id },
        select: {
          status: true,
          totalAmount: true,
          paidAmount: true,
          refund: { select: { id: true } },
          customerId: true,
          points: { select: { point: true } },
          lines: { select: { itemType: true, itemId: true, quantity: true } },
          payments: { select: { method: true, amount: true } },
          outstanding: { select: { id: true } },
        },
      });
      if (current?.status !== "COMPLETED") {
        throw conflict("This sale is no longer refundable.", "SALE_NOT_COMPLETED");
      }
      if (current.refund !== null) {
        // A retry that waited for the first transaction returns its receipt without
        // repeating stock or points adjustments.
        return;
      }

      if (
        current.paidAmount.lessThan(current.totalAmount) ||
        current.outstanding !== null ||
        current.lines.some((line) => line.itemType !== "SERVICE" && line.itemType !== "PRODUCT") ||
        current.payments.some((payment) => isRedemptionPaymentMethod(payment.method)) ||
        current.payments
          .reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0))
          .lessThan(current.totalAmount)
      ) {
        throw conflict(
          "Only fully paid service/product sales funded by money tenders can be refunded.",
          "SALE_NOT_REFUNDABLE",
        );
      }
      const payoutTotal = input.payouts.reduce(
        (sum, payout) => sum.plus(payout.amount),
        new Prisma.Decimal(0),
      );
      if (
        input.payouts.some(
          (payout) =>
            isRedemptionPaymentMethod(payout.method) ||
            payout.amount <= 0 ||
            !new Prisma.Decimal(payout.amount).equals(
              new Prisma.Decimal(payout.amount).toDecimalPlaces(2),
            ),
        ) ||
        !payoutTotal.equals(current.totalAmount)
      ) {
        throw badRequest(
          "Refund payouts must equal the sale total exactly.",
          undefined,
          "REFUND_PAYOUT_MISMATCH",
        );
      }

      await tx.saleRefund.create({
        data: {
          tenantId: requireTenantScope(),
          saleId: sale.id,
          // Snapshotted from the sale, so the refund cannot disagree with the receipt.
          amount: current.totalAmount,
          payouts: input.payouts.map((payout) => ({
            method: payout.method,
            amount: new Prisma.Decimal(payout.amount).toFixed(2),
          })),
          reason: input.reason,
          restocked: input.restock,
          refundedById: actorId,
          refundedAt: new Date(),
        },
      });

      const performances = await tx.employeePerformance.findMany({
        where: { saleId: sale.id, refundAdjustment: false },
      });
      if (performances.length > 0)
        await tx.employeePerformance.createMany({
          data: performances.map((row) => ({
            tenantId: row.tenantId,
            userId: row.userId,
            saleId: sale.id,
            itemType: row.itemType,
            itemId: row.itemId,
            amount: row.amount.negated(),
            refundAdjustment: true,
          })),
        });
      const commissions = await tx.employeeCommission.findMany({
        where: { saleId: sale.id, ledgerVersion: null, refundAdjustment: false },
      });
      for (const commission of commissions) {
        if (commission.paidAt !== null) {
          await tx.employeeCommission.update({
            where: { id: commission.id },
            data: { reconciliationRequired: true },
          });
        } else {
          await tx.employeeCommission.create({
            data: {
              tenantId: commission.tenantId,
              userId: commission.userId,
              saleId: sale.id,
              rate: commission.rate,
              saleLineId: commission.saleLineId,
              basis: commission.basis?.negated() ?? null,
              ruleId: commission.ruleId,
              ruleSource: commission.ruleSource,
              amount: commission.amount.negated(),
              refundAdjustment: true,
            },
          });
        }
      }

      if (input.restock) {
        for (const line of current.lines) {
          if (line.itemType !== "PRODUCT") continue;
          // No upper guard: the goods are real and have come back. A stock level edited
          // by hand in the meantime is the salon's business, not a reason to refuse.
          const restored = await tx.product.updateMany({
            where: { id: line.itemId },
            data: { quantity: { increment: line.quantity } },
          });
          if (restored.count !== 1) {
            throw conflict(
              "A sold product no longer exists. Choose no restock only if goods were not returned; nothing was refunded.",
              "REVERSAL_PRODUCT_MISSING",
            );
          }
        }
      }

      // The money went back, so the points earned on it go too. Like a void, this is an
      // offsetting ledger row rather than an edit or delete of the original earn: the
      // history of what the sale awarded stays readable, and the balance is the sum.
      const pointsEarned = current.points.reduce((sum, entry) => sum + entry.point, 0);
      if (current.customerId !== null && pointsEarned !== 0) {
        await tx.customerPoint.create({
          data: {
            tenantId: requireTenantScope(),
            customerId: current.customerId,
            saleId: sale.id,
            point: -pointsEarned,
          },
        });
      }
    });
  } catch (error) {
    // The unique `saleId` is the real guard; a concurrent retry loses the insert race and
    // gets the record the winner wrote rather than a second refund.
    if (isUniqueViolation(error)) return getSale(sale.id);
    throw error;
  }

  return getSale(sale.id);
}
