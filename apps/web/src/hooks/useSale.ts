/**
 * Sale data — handoff screens 01–02 (`GET /api/sales/items`, `POST /api/sales`).
 *
 * No new contract: the search query and the write reuse `saleItemSearchQuerySchema`
 * and `createSaleSchema` from `@glampro_suite/shared`, so everything below is shaped by
 * what those two schemas already say. The hold flow at the bottom reuses
 * `createSaleSchema`'s `hold` flag, `completeSaleSchema` and `saleListSchema`, so a
 * parked cart is described in exactly the words the API accepts (ADR 0015).
 *
 * The open cart lives in the TanStack Query cache under
 * `queryKeys.sale.openCart(identity)` rather than in a context. The rail badge and the
 * till read one cart without prop-drilling, and the cart survives both a round
 * trip to another screen and a browser reload. `lib/sale-draft-storage.ts` is the
 * durable layer under that cache, scoped to tenant + user; successful payment or
 * signing out clears it.
 *
 * **Unit prices are never stored.** A line keeps both prices the search returned
 * (`price` and `memberPrice`) and `lineUnitPrice` derives the one that applies
 * from the customer, because the customer can change after the search and the
 * server prices the same way (`priceLine` in `sale.service.ts`): member for
 * service/product/package when they carry a membership reference, the only price
 * there is for a value package or a gift card. A cart that froze the price at
 * add time would disagree with the receipt the server writes.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  DEFAULT_SALE_ITEM_LIMIT,
  MAX_SALE_LINES,
  type CompleteSaleInput,
  type CreateSaleInput,
  type CustomerDetail,
  type CustomerSummary,
  type SaleDetail,
  type SaleItem,
  type SaleItemKind,
  type RefundSaleInput,
  type SaleItemSearchResult,
  type SaleLineInput,
  type SaleList,
  type SaleReceiptEmailResult,
  type VoucherPreview,
  type VoucherPreviewInput,
} from "@glampro_suite/shared";

import { queryKeys } from "@/constants/queryKeys";
import { useAuth } from "@/contexts/AuthContext";
import { del, get, getPaginated, post } from "@/lib/api";
import { discountedPrice, priceToCents } from "@/lib/money";
import {
  clearSaleDraft,
  readSaleDraft,
  saleDraftIdentity,
  setSaleDraftLines,
} from "@/lib/sale-draft-storage";

/**
 * One row of the till's cart.
 *
 * It is **not** a `SaleLineInput`: the request carries what was sold and how
 * many, while the cart also carries the name and the two prices the search
 * returned. `toSaleLineInputs` strips it back down at post time, so the price a
 * salon charges is the one the server read from the catalogue (the schema's "no
 * price" rule) and never one the browser held.
 */
export interface CartLine {
  itemType: SaleItemKind;
  itemId: string;
  name: string;
  quantity: number;
  /** The non-member price — or the only price — as the search returned it. */
  price: string;
  /** The member price, or `null` for the kinds that have only one price. */
  memberPrice: string | null;
  /** Who gets credit for this line. Absent for product lines (the MVP rule). */
  staffId?: string;
  /**
   * The reduction the cashier applied, as a **rate** (ADR 0017). The one price-shaped
   * thing the till may send, and a rate rather than an amount so it cannot name a price:
   * the server turns it into money against the catalogue's own figure, which is what the
   * receipt charges. Absent is a line nobody discounted.
   *
   * It belongs to the line, so adding another unit of the same item grows the line and
   * inherits its rate rather than starting an undiscounted twin (`addCartLine`). The
   * cashier set it on the line and can see it there.
   */
  discountPercent?: number;
}

/**
 * The key two lines merge on. A service added for two different stylists is two
 * lines, because the second click names a different performer — merging on the
 * item alone would silently re-attribute the first line.
 */
export function cartLineKey(line: Pick<CartLine, "itemType" | "itemId" | "staffId">): string {
  return `${line.itemType}:${line.itemId}:${line.staffId ?? ""}`;
}

/**
 * The price one unit costs for the customer on this sale — always derived, so
 * switching between a member and a walk-in re-prices the cart without searching
 * again (the reason the search returns both prices), and so a line's discount is
 * applied the way the server applies it (ADR 0017).
 */
export function lineUnitPrice(
  line: Pick<CartLine, "price" | "memberPrice" | "discountPercent">,
  isMember: boolean,
): string {
  return discountedPrice(listUnitPrice(line, isMember), line.discountPercent);
}

/**
 * The same line at the catalogue's price, with no discount — what the cart's `Discount`
 * row subtracts from.
 *
 * Only the till's own totals need it: everything that *shows* a price charges the
 * discounted one, because that is what the receipt will.
 */
export function listUnitPrice(
  line: Pick<CartLine, "price" | "memberPrice">,
  isMember: boolean,
): string {
  if (isMember && line.memberPrice !== null) return line.memberPrice;
  return line.price;
}

/**
 * Adds one unit of the item. An identical line grows instead: a till adds
 * another shampoo to the line it already has rather than starting a new one —
 * and it grows the line's **discount with it**, because a rate belongs to the
 * line the cashier set it on rather than to the units added after it (ADR 0017).
 *
 * Returns whether the line landed. Past 100 distinct lines it does not,
 * because the write would be refused (`MAX_SALE_LINES` says a hundred lines is
 * far past any real till receipt) — the page says so instead of posting a cart
 * the server cannot take.
 */
export function addCartLine(
  lines: CartLine[],
  item: SaleItem,
  staffId: string | undefined,
  isMember: boolean,
): { lines: CartLine[]; added: boolean } {
  const key = cartLineKey({ itemType: item.kind, itemId: item.id, staffId });

  if (lines.some((line) => cartLineKey(line) === key)) {
    return {
      lines: lines.map((line) =>
        cartLineKey(line) === key
          ? { ...line, quantity: Math.min(line.quantity + 1, 10_000) }
          : line,
      ),
      added: true,
    };
  }

  if (lines.length >= MAX_SALE_LINES) return { lines, added: false };

  return {
    lines: [
      ...lines,
      {
        itemType: item.kind,
        itemId: item.id,
        name: item.name,
        quantity: 1,
        // Stored for the cart's own preview only: `lineUnitPrice` re-derives the
        // charge from `isMember` on every render (see the module comment), and
        // `toSaleLineInputs` drops all prices before posting.
        price: isMember && item.memberPrice !== null ? item.memberPrice : item.price,
        memberPrice: item.memberPrice,
        ...(staffId ? { staffId } : {}),
      },
    ],
    added: true,
  };
}

/**
 * Sets a line's quantity. Zero removes the line — the contract's "a line of
 * zero is not a line", and the stepper's minus key at 1. Past 10,000 it clamps,
 * because `saleLineInputSchema` refuses more.
 */
export function setCartLineQuantity(lines: CartLine[], key: string, quantity: number): CartLine[] {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return lines.filter((line) => cartLineKey(line) !== key);
  }
  return lines.map((line) =>
    cartLineKey(line) === key
      ? { ...line, quantity: Math.min(Math.trunc(quantity), 10_000) }
      : line,
  );
}

/** Credits a line to a stylist, or back to nobody. */
export function setCartLineStaff(
  lines: CartLine[],
  key: string,
  staffId: string | undefined,
): CartLine[] {
  return lines.flatMap((line) => {
    if (cartLineKey(line) !== key) return [line];
    if (!staffId) return [{ ...line, staffId: undefined }];
    const next: CartLine = { ...line, staffId };
    // Re-keying can collide with an existing line: crediting one of two
    // identical shampoo lines to the other's stylist leaves one line of two.
    const twin = lines.find((other) => other !== line && cartLineKey(other) === cartLineKey(next));
    if (twin) return [];
    return [next];
  });
}

/**
 * Sets or clears a line's discount rate (ADR 0017).
 *
 * A blank, a non-number or a rate of zero **clears** it, so an untouched line sends no
 * `discountPercent` at all: the receipt then says nothing about a discount nobody made,
 * rather than printing "0% off". The rate is rounded to two decimals and clamped to
 * 0–100, which is exactly what `discountPercentSchema` accepts — a rate the server would
 * refuse must not be reachable by typing.
 */
export function setCartLineDiscount(
  lines: CartLine[],
  key: string,
  percent: number | undefined,
): CartLine[] {
  const cleared = percent === undefined || !Number.isFinite(percent) || percent <= 0;
  const rate = cleared ? undefined : Math.min(Math.round(percent * 100) / 100, 100);

  return lines.map((line) => {
    if (cartLineKey(line) !== key) return line;
    return { ...line, discountPercent: rate };
  });
}

/**
 * Removes a line outright.
 */
export function removeCartLine(lines: CartLine[], key: string): CartLine[] {
  return lines.filter((line) => cartLineKey(line) !== key);
}

/**
 * The cart as the till posts it: what was sold and how many, per line, with no
 * prices anywhere (the schema's "no price" rule).
 */
export function toSaleLineInputs(lines: CartLine[]): SaleLineInput[] {
  return lines.map((line) => ({
    itemType: line.itemType,
    itemId: line.itemId,
    quantity: line.quantity,
    ...(line.staffId ? { staffId: line.staffId } : {}),
    // Absent rather than `0` when nobody discounted: the rate is what the receipt
    // discloses, and "0% off" is a disclosure of nothing (ADR 0017).
    ...(line.discountPercent ? { discountPercent: line.discountPercent } : {}),
  }));
}

/**
 * A parked cart, back in the till.
 *
 * `price` is the pre-discount figure the hold was parked at and `memberPrice` is `null`, because a
 * stored line carries **one** price and not the catalogue's member/non-member pair.
 * Inventing the second here would be the browser naming a price, so a resumed line
 * draws the quote it was parked with and the server re-prices every line from the
 * catalogue when the sale is finally rung up (`completeSale`). The receipt is the
 * figure that counts, and it is not this one.
 */
export function cartLinesFrom(sale: SaleDetail): CartLine[] {
  return sale.lines.map((line) => ({
    itemType: line.itemType,
    itemId: line.itemId,
    name: line.itemName,
    quantity: line.quantity,
    // Stored unitPrice is already discounted. Restore the original per-unit cents
    // before the cart applies the preserved rate, otherwise pickup discounts twice.
    price: (
      (priceToCents(line.unitPrice) + priceToCents(line.discountAmount) / line.quantity) /
      100
    ).toFixed(2),
    memberPrice: null,
    ...(line.staffId ? { staffId: line.staffId } : {}),
    // The rate comes back with the line: it is part of what the cashier set, and the
    // completion re-prices the cart from the same catalogue the hold was priced from.
    ...(Number(line.discountPercent) > 0 ? { discountPercent: Number(line.discountPercent) } : {}),
  }));
}

export interface SaleItemFilters {
  search?: string;
  kind?: SaleItemKind;
}

/**
 * The item search the cashier types into.
 *
 * The filters object is the last element of the key (the `queryKeys.ts`
 * convention), so the mutation below invalidates every search and every kind
 * with one prefix. `limit` is sent explicitly rather than left to the schema
 * default, so the picker's one-page-per-kind is a decision on this line rather
 * than an accident of the default. `?kind=` narrows the rows only.
 */
export function useSaleItems(filters: SaleItemFilters = {}) {
  return useQuery({
    queryKey: [...queryKeys.sale.items(), filters],
    queryFn: () =>
      get<SaleItemSearchResult>("/sales/items", {
        search: filters.search || undefined,
        kind: filters.kind,
        limit: DEFAULT_SALE_ITEM_LIMIT,
      }),
    placeholderData: (previous) => previous,
  });
}

/** How many customer rows the picker shows — a short list, not a page. */
const CUSTOMER_PICKER_PAGE_SIZE = 8;

/**
 * The customer picker search.
 *
 * Idle until the cashier types: an unfiltered first page would be "recent
 * customers", a claim no endpoint ordering makes, so no rows is the honest
 * answer before the first keystroke rather than a list that looks curated.
 */
export function useSaleCustomers(search: string) {
  const term = search.trim();
  return useQuery({
    queryKey: [...queryKeys.sale.customers(), { search: term }],
    queryFn: () =>
      getPaginated<CustomerSummary>("/customers", {
        page: 1,
        pageSize: CUSTOMER_PICKER_PAGE_SIZE,
        search: term || undefined,
      }),
    enabled: term.length > 0,
    placeholderData: (previous) => previous,
  });
}

export interface SaleCart {
  lines: CartLine[];
  addItem: (item: SaleItem, staffId: string | undefined, isMember: boolean) => boolean;
  setQuantity: (key: string, quantity: number) => void;
  setStaff: (key: string, staffId: string | undefined) => void;
  /** Sets or clears a line's discount rate; `undefined` clears it (ADR 0017). */
  setDiscount: (key: string, percent: number | undefined) => void;
  removeLine: (key: string) => void;
  /** Replaces the whole cart at once — what picking up a parked cart does. */
  setLines: (lines: CartLine[]) => void;
  clearCart: () => void;
}

/**
 * The open cart (see the module comment for why it is a query).
 *
 * `staleTime` and `gcTime` are infinite because the cart is written, never
 * fetched: the initial `[]` is the seed an empty cart starts from, and nothing
 * may refetch it away from under the cashier mid-sale.
 */
export function useSaleCart(): SaleCart {
  const queryClient = useQueryClient();
  const { tenant, user } = useAuth();
  const identity = tenant && user ? saleDraftIdentity(tenant.id, user.id) : null;
  const cartKey = queryKeys.sale.openCart(identity ?? "anonymous");
  const query = useQuery<CartLine[]>({
    queryKey: cartKey,
    queryFn: () => readSaleDraft(identity).lines,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

  function update(updater: (lines: CartLine[]) => CartLine[]): void {
    queryClient.setQueryData<CartLine[]>(cartKey, (current) => {
      const next = updater(current ?? []);
      setSaleDraftLines(identity, next);
      return next;
    });
  }

  return {
    lines: query.data ?? [],
    addItem: (item, staffId, isMember) => {
      let added = false;
      update((lines) => {
        const next = addCartLine(lines, item, staffId, isMember);
        added = next.added;
        return next.lines;
      });
      return added;
    },
    setQuantity: (key, quantity) => {
      update((lines) => setCartLineQuantity(lines, key, quantity));
    },
    setStaff: (key, staffId) => {
      update((lines) => setCartLineStaff(lines, key, staffId));
    },
    setDiscount: (key, percent) => {
      update((lines) => setCartLineDiscount(lines, key, percent));
    },
    removeLine: (key) => {
      update((lines) => removeCartLine(lines, key));
    },
    setLines: (lines) => {
      update(() => lines);
    },
    clearCart: () => {
      update(() => []);
    },
  };
}

/**
 * Rings the cart up: `201` with the receipt as the body, which the page draws
 * directly (the confirmation screen *is* the receipt — roadmap Phase 5d).
 *
 * The cart is cleared on success, so the rail badge drops with the sale rather
 * than waiting for the receipt to be dismissed. The server-backed views a sale
 * moves — the item grid (stock fell) and the catalogue's list and low-stock
 * count — are invalidated with it, along with customer history/balances and reports.
 */
export function useCreateSale() {
  const queryClient = useQueryClient();
  const { tenant, user } = useAuth();
  const identity = tenant && user ? saleDraftIdentity(tenant.id, user.id) : null;

  return useMutation({
    mutationFn: (input: CreateSaleInput) => post<SaleDetail>("/sales", input),
    onSuccess: () => {
      invalidateAfterSale(queryClient, identity, false);
    },
  });
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Hold, resume and discard (Phase 5g)
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * What a completed write does to the cache.
 *
 * The cart is spent, so it empties and its browser draft goes with it. The server-backed
 * views a sale moves are refetched: the item grid (stock fell) and the catalogue's list
 * and low-stock count, customer history/balances, reports and dashboard totals.
 *
 * `fromHold` adds the hold list, because a cart that was *parked* has to leave it. A
 * plain sale passes `false` rather than refetching a list it cannot have changed.
 */
function invalidateAfterSale(
  queryClient: QueryClient,
  identity: string | null,
  fromHold: boolean,
): void {
  queryClient.setQueryData<CartLine[]>(queryKeys.sale.openCart(identity ?? "anonymous"), []);
  clearSaleDraft(identity);
  invalidateSaleViews(queryClient);
  if (fromHold) void queryClient.invalidateQueries({ queryKey: queryKeys.sale.holds() });
}

/** Refresh persisted sale effects without clearing another open cart. */
function invalidateSaleViews(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.sale.history() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.sale.items() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.products.list() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.products.count() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.customers.all() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.summary() });
}

/**
 * The salon's parked carts — `GET /api/sales?status=HELD`.
 *
 * Tenant-wide rather than per-user, because that is the point of a shared hold: a
 * colleague has to be able to finish the cart somebody else parked (ADR 0015).
 */
export function useHeldSales(page = 1) {
  return useQuery({
    queryKey: [...queryKeys.sale.holds(), page],
    queryFn: () => get<SaleList>("/sales", { status: "HELD", page }),
  });
}

export function useSaleHistory(status: "COMPLETED" | "VOID", page: number, enabled: boolean) {
  return useQuery({
    queryKey: [...queryKeys.sale.history(), { status, page }],
    queryFn: () => get<SaleList>("/sales", { status, page }),
    enabled,
  });
}

export function useOpenSaleReceipt() {
  return useMutation({
    mutationFn: (id: string) => get<SaleDetail>(`/sales/${id}`),
  });
}

/**
 * The cart a hold posts: the same lines and no money anywhere.
 *
 * `payments` and `idempotencyKey` are dropped from the type rather than merely left
 * empty, because the API refuses a hold that carries a tender — money changing hands is
 * what completion *is* — and a hook that could express one would be a hook that could
 * post a cart the server rejects.
 */
export type HoldSaleInput = Omit<CreateSaleInput, "hold" | "idempotencyKey" | "payments">;

/**
 * Parks the cart: `POST /api/sales` with `hold`.
 *
 * The server writes the draft — no receipt number, no tender, no ledger row — and the
 * cart empties here, because it is a row now and every till can see it (ADR 0015).
 */
export function useHoldSale() {
  const queryClient = useQueryClient();
  const { tenant, user } = useAuth();
  const identity = tenant && user ? saleDraftIdentity(tenant.id, user.id) : null;

  return useMutation({
    mutationFn: (input: HoldSaleInput) => post<SaleDetail>("/sales", { ...input, hold: true }),
    onSuccess: () => {
      invalidateAfterSale(queryClient, identity, true);
    },
  });
}

/**
 * Picks a parked cart up: the hold's lines and its customer, ready to be edited and
 * rung up.
 *
 * Two reads rather than one, and deliberately. The hold list answers with a **summary** —
 * no lines — so that fifty parked carts are not fifty carts' worth of rows in one
 * response, and the customer row comes with it because `isMember` is read off
 * `Customer.memberId`: a cart priced as a walk-in and then posted for a member would
 * show the cashier the wrong figures on the way to the same receipt.
 */
export function useResumeHold() {
  return useMutation({
    mutationFn: async (saleId: string) => {
      const sale = await get<SaleDetail>(`/sales/${saleId}`);
      const customer = sale.customerId
        ? await get<CustomerDetail>(`/customers/${sale.customerId}`)
        : null;
      return { sale, customer };
    },
  });
}

/**
 * Rings a parked cart up: `POST /api/sales/:id/complete`.
 *
 * Not a new sale — the same row changes state, so the receipt that comes back carries
 * the id the hold already had. The cart empties with it, because the sale has consumed
 * it, and the hold list is refetched because the row has just left it.
 */
export function useCompleteSale() {
  const queryClient = useQueryClient();
  const { tenant, user } = useAuth();
  const identity = tenant && user ? saleDraftIdentity(tenant.id, user.id) : null;

  return useMutation({
    mutationFn: ({ saleId, input }: { saleId: string; input: CompleteSaleInput }) =>
      post<SaleDetail>(`/sales/${saleId}/complete`, input),
    onSuccess: () => {
      invalidateAfterSale(queryClient, identity, true);
    },
  });
}

/**
 * Abandons a parked cart.
 *
 * A hold is the only sale the API will delete: it wrote no ledger and holds no receipt
 * number, so there is nothing to reverse. A sale that was rung up is refused (409) and
 * is voided instead (ADR 0016).
 */
export function useDiscardHold() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (saleId: string) => del<{ id: string }>(`/sales/${saleId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sale.holds() });
    },
  });
}

/**
 * Voids a rung-up sale: `POST /api/sales/:id/void` (ADR 0016).
 *
 * The **reason** is the whole request; the actor is the token's, not the browser's, which
 * is why it cannot be passed in from here. The server answers with the *voided* receipt,
 * so the screen redraws from the server's own row rather than guessing at the new state.
 *
 * A void puts stock back, so the item grid and the catalogue's low-stock count move with
 * it. The hold list does not: the API refuses a voided hold, so a `HELD` sale cannot be
 * the one this touched.
 */
export function useVoidSale() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ saleId, reason }: { saleId: string; reason: string }) =>
      post<SaleDetail>(`/sales/${saleId}/void`, { reason }),
    onSuccess: () => {
      invalidateSaleViews(queryClient);
    },
  });
}

/**
 * What a voucher code is worth on the cart the cashier is about to pay for
 * (ADR 0020): `POST /api/sales/voucher-preview`.
 *
 * A mutation rather than a query because the cart is the request body and a preview is
 * an action the cashier asks for by pressing **Apply** — not a cache entry that should
 * refetch behind their back. Nothing is written; the server prices the catalogue and
 * allocates the code exactly as the sale write will, so the sheet never shows a figure
 * the receipt would not charge.
 *
 * A refusal (expired, below its minimum, already redeemed) is an error the dialog shows
 * beside the field; the sale can still be posted without the voucher.
 */
export function useVoucherPreview() {
  return useMutation({
    mutationFn: (input: VoucherPreviewInput) =>
      post<VoucherPreview>("/sales/voucher-preview", input),
  });
}

/**
 * Records a full-sale refund: `POST /api/sales/:id/refund` (ADR 0020).
 *
 * The body names the reason and whether product lines go back on the shelf; the
 * **amount is not in it** and the actor is the token's. The server answers with the same
 * receipt shape `GET /:id` serves, so the screen redraws from its own row. A refund puts
 * stock back only when asked, so the item grid and the catalogue's counts move like a
 * void's do; the sale itself stays `COMPLETED` and keeps its number.
 */
export function useRefundSale() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ saleId, input }: { saleId: string; input: RefundSaleInput }) =>
      post<SaleDetail>(`/sales/${saleId}/refund`, input),
    onSuccess: (sale) => {
      queryClient.setQueryData(queryKeys.sale.detail(sale.id), sale);
      invalidateSaleViews(queryClient);
    },
  });
}

/**
 * Emails a copy of a receipt: `POST /api/sales/:id/receipt/email` (TK2610-0010).
 *
 * A send is a side effect, not a change to the sale, so nothing is invalidated: the
 * receipt on screen is already the server's row and the answer only says where the copy
 * went. The server reads that receipt again under this tenant, so the email carries the
 * same lines and the same GST number the screen is showing.
 */
export function useEmailSaleReceipt() {
  return useMutation({
    mutationFn: ({ saleId, email }: { saleId: string; email: string }) =>
      post<SaleReceiptEmailResult>(`/sales/${saleId}/receipt/email`, { email }),
  });
}
