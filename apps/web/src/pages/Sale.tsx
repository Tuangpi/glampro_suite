/**
 * Sale — handoff screens 01 and 02, the till.
 *
 * **MVP slice M1** (`docs/mvp.md`): category tabs → search → grid → cart
 * (quantity, per-line staff) → tender (cash, card, split) → receipt. Since Phase 5g
 * the cart can also be **held** and picked up again at any till in the salon
 * [ADR 0015]. Void from the till, line discounts, receipt printing and keyboard
 * shortcuts remain full-phase work. The unfinished cart and customer survive reloads.
 *
 * Four things this page decides rather than re-derives:
 *
 * 1. **The tabs are the server's `searchableKinds`.** `/sales/items` omits a kind
 *    whose add-on the salon has not bought and names what is left, so a salon
 *    without Packages gets no Packages tab rather than an empty one. The kinds are
 *    never re-listed here, so the tab row cannot drift from what the API accepts.
 *    Only the selected category's page is fetched; switching tabs resets paging.
 * 2. **The staff picker is narrowed to the service's branch** — `User.departments`
 *    ∩ `Service.departmentId`, the MVP's service↔staff decision. A service the
 *    salon has not tied to a branch offers the whole team, which is exactly what
 *    `AppointmentFormDrawer` does for a booking (ADR 0013's twin), and the two
 *    service details are resolved by cart ID rather than a truncated catalog list.
 * 3. **A granting line forces a customer** (`PACKAGE`, `VALUE_PACKAGE`,
 *    `GIFT_CARD` buy credit for somebody). The dialog refuses to post without one
 *    and the server refuses the same sale, so the cashier is told before counting
 *    notes rather than after.
 * 4. **The receipt replaces the till.** The confirmation screen *is* the receipt
 *    (Phase 5d) and the cart is empty by then, so leaving a grid on screen beside
 *    it would only invite a second sale onto the same receipt.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import {
  MAX_SALE_LINES,
  SALE_ITEM_KINDS,
  normalizeBarcode,
  type CustomerSummary,
  type SaleDetail,
  type SaleItem,
  type SaleItemKind,
  type SalePaymentInput,
  type SaleItemSearchResult,
} from "@glampro_suite/shared";

import { Search } from "@/components/icons";
import DirectTipsPanel from "@/components/sale/DirectTipsPanel";
import PosStaffSwitch from "@/components/sale/PosStaffSwitch";
import CartPanel from "@/components/sale/CartPanel";
import { type StaffOption } from "@/components/sale/CartLine";
import CustomerPicker from "@/components/sale/CustomerPicker";
import HeldCartsPanel from "@/components/sale/HeldCartsPanel";
import PaymentDialog from "@/components/sale/PaymentDialog";
import ReceiptView from "@/components/sale/ReceiptView";
import SaleCollectionsPanel from "@/components/sale/SaleCollectionsPanel";
import RefundSaleDialog from "@/components/sale/RefundSaleDialog";
import SaleItemGrid from "@/components/sale/SaleItemGrid";
import SaleListPagination from "@/components/sale/SaleListPagination";
import SaleHistoryPanel from "@/components/sale/SaleHistoryPanel";
import VoidSaleDialog from "@/components/sale/VoidSaleDialog";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Drawer from "@/components/ui/Drawer";
import Modal from "@/components/ui/Modal";
import Tabs from "@/components/ui/Tabs";
import { showToast } from "@/components/ui/toast-store";
import { SALE_KIND_LABELS, VOID_SALE_ROLES } from "@/constants/sale";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { useCartServices } from "@/hooks/useServices";
import { useStaffList } from "@/hooks/useStaff";
import {
  lineUnitPrice,
  toSaleLineInputs,
  useCompleteSale,
  useCreateSale,
  useDiscardHold,
  useHeldSales,
  useHoldSale,
  useRefundSale,
  useResumeHold,
  useSaleCart,
  useSaleItems,
  useVoidSale,
} from "@/hooks/useSale";
import { get, getErrorMessage } from "@/lib/api";
import { cartTotalCents, priceToCents } from "@/lib/money";
import {
  readSaleDraft,
  saleDraftIdentity,
  setSaleDraftCustomer,
  setSaleDraftHeldSale,
} from "@/lib/sale-draft-storage";

/**
 * Existing staff-picker size. Catalog paging and cart-service details do not
 * depend on this list's size.
 */
const LIST_PAGE_SIZE = 200;
const CATALOG_PAGE_SIZE = 24;

/** Typing must not fire a query per keystroke; the box still feels immediate. */
const SEARCH_DEBOUNCE_MS = 300;

/** The kinds that hand something to a customer, and so need one to hand it to. */
const GRANTING_KINDS: ReadonlySet<SaleItemKind> = new Set<SaleItemKind>([
  "PACKAGE",
  "VALUE_PACKAGE",
  "GIFT_CARD",
]);

export default function Sale() {
  const { isReadOnly, tenant, user } = useAuth();
  const draftIdentity = tenant && user ? saleDraftIdentity(tenant.id, user.id) : null;

  const [kind, setKind] = useState<SaleItemKind>("SERVICE");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [catalogPage, setCatalogPage] = useState(1);
  /** What the scanner or the cashier typed into the barcode field. */
  const [barcodeInput, setBarcodeInput] = useState("");
  /** While a barcode lookup is in flight, so a held Enter cannot double-add. */
  const [barcodeBusy, setBarcodeBusy] = useState(false);
  const barcodeInFlight = useRef(false);
  const barcodeVersion = useRef(0);
  const [customer, setCustomer] = useState<CustomerSummary | null>(
    () => readSaleDraft(draftIdentity).customer,
  );
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SaleDetail | null>(null);
  const [historicalReceipt, setHistoricalReceipt] = useState(false);
  const [heldPage, setHeldPage] = useState(1);
  const [heldOpen, setHeldOpen] = useState(false);
  const cartSection = useRef<HTMLDivElement>(null);
  /** The parked cart this till is ringing up, or `null` for an ordinary sale. */
  const [heldSaleId, updateHeldSaleId] = useState<string | null>(
    () => readSaleDraft(draftIdentity).heldSaleId ?? null,
  );
  function setHeldSaleId(id: string | null) {
    setSaleDraftHeldSale(draftIdentity, id);
    updateHeldSaleId(id);
  }
  /** The hold whose pickup or discard is in flight, so that row's buttons wait. */
  const [busyHoldId, setBusyHoldId] = useState<string | null>(null);
  const holdAction = useRef(false);
  const [replacementHoldId, setReplacementHoldId] = useState<string | null>(null);
  const pickupVersion = useRef(0);
  useEffect(
    () => () => {
      pickupVersion.current += 1;
    },
    [draftIdentity],
  );
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  const { formatPrice } = useSalonFormatting();

  // Typing should not fire a query per keystroke, but the box must still feel
  // immediate, so the term is debounced rather than submitted.
  useEffect(() => {
    // An unchanged search must not reset a page chosen while the timer waits.
    if (searchInput.trim() === search) return;
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setCatalogPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput, search]);

  useEffect(() => {
    setSaleDraftCustomer(draftIdentity, customer);
  }, [customer, draftIdentity]);

  const cart = useSaleCart();
  const createSale = useCreateSale();
  // The hold flow (ADR 0015): park the cart, read the salon's parked carts, pick one
  // up, ring it up, or abandon it.
  const holdSale = useHoldSale();
  const completeSale = useCompleteSale();
  const resumeHold = useResumeHold();
  const discardHold = useDiscardHold();
  const heldCarts = useHeldSales(heldPage);
  const voidSale = useVoidSale();
  const refundSale = useRefundSale();
  const cartLocked = isReadOnly || holdSale.isPending || busyHoldId !== null;

  // A lookup belongs to the draft it started from, not a replacement or checkout.
  useEffect(
    () => () => {
      barcodeVersion.current += 1;
    },
    [
      cart.lines,
      customer,
      draftIdentity,
      checkoutOpen,
      receipt,
      cartLocked,
      heldSaleId,
      replacementHoldId,
    ],
  );

  /**
   * Whether this user may void a receipt (ADR 0016).
   *
   * A mirror of the API's `requireRole`, used only to decide whether to draw the action:
   * the server is what enforces it, and a button that always 403s is worse than none.
   */
  const canVoid = user !== null && VOID_SALE_ROLES.includes(user.globalRole);
  /** The same manager gate the refund route enforces (ADR 0020), mirroring it for the UI. */
  const canRefund = canVoid;
  const items = useSaleItems({
    search: search || undefined,
    kind,
    page: catalogPage,
    limit: CATALOG_PAGE_SIZE,
  });
  const services = useCartServices(
    cart.lines.filter((line) => line.itemType === "SERVICE").map((line) => line.itemId),
  );
  const staff = useStaffList({ page: 1, pageSize: LIST_PAGE_SIZE, status: "active" });

  const isMember = customer?.memberId != null;

  const kinds = items.data?.searchableKinds ?? [];
  // `SERVICE` is the fallback only while the first answer is in flight (the sales
  // module is core, so a service is always sellable): it names the skeleton's
  // `aria-label` and nothing else.
  const activeKind = (kinds.includes(kind) ? kind : kinds[0]) ?? "SERVICE";

  const staffRows = staff.data?.data ?? [];
  const departmentOfService = useMemo(
    () =>
      new Map(
        services.flatMap((service) =>
          service.data ? [[service.data.id, service.data.departmentId] as const] : [],
        ),
      ),
    [services],
  );

  /**
   * The people a service line may be credited to.
   *
   * One the salon has not tied to a branch offers the whole team — the rule
   * `AppointmentFormDrawer` applies too, because a branch-less service has no
   * department to intersect with.
   */
  function staffForService(serviceId: string): StaffOption[] {
    const departmentId = departmentOfService.get(serviceId);
    // Unknown/loading/failed details must not offer staff from another department.
    if (departmentId === undefined) return [];
    if (departmentId === null) return staffRows;
    return staffRows.filter((person) =>
      person.departments.some((link) => link.id === departmentId),
    );
  }

  // The page's own estimate of the cart total, derived through the same
  // `lineUnitPrice` the panel draws with so the two cannot disagree. The server
  // re-prices from the catalogue regardless (the schema's "no price" rule).
  const totalCents = cartTotalCents(
    cart.lines.map((line) => ({
      unitPrice: lineUnitPrice(line, isMember),
      quantity: line.quantity,
    })),
  );
  const needsCustomer = cart.lines.some((line) => GRANTING_KINDS.has(line.itemType));

  function handleAdd(item: SaleItem) {
    if (holdSale.isPending || holdAction.current) return;
    // A suspended salon may look but not write (TENANCY.md §6). The API would
    // refuse the sale at the end of the cart, but filling one first would be a
    // till that lets a cashier take someone's money and then fails.
    if (isReadOnly) {
      showToast("error", "This salon's subscription is suspended, so the till cannot take money.");
      return;
    }

    // No staff at add time: who performed a service is the cashier's pick on the
    // line itself, and pre-choosing one would attribute work nobody claimed.
    const added = cart.addItem(item, undefined, isMember);
    if (!added) {
      showToast("info", `The cart holds at most ${MAX_SALE_LINES} lines. Remove one to add this.`);
    }
  }

  function openCheckout() {
    if (cartLocked || holdAction.current) return;
    setCheckoutError(null);
    setCheckoutOpen(true);
  }

  /**
   * A scan or a typed code, resolved to one product and put in the cart.
   *
   * The lookup is the server's **exact** barcode answer (`?barcode=`), never the
   * name search: a barcode is a code, so the product it names is picked out by
   * comparing the normalised value on this side too. A code that names nothing
   * adds nothing — a till that fell back to "the closest match" would sell the
   * wrong shampoo.
   *
   * Two checks happen before the line lands, because a scan is too fast to
   * correct afterwards: the units **already in the cart** count against stock,
   * so a repeated scan cannot walk a line past what is on the shelf, and an
   * identical line grows rather than duplicating (which is what `addCartLine`
   * does — the stock check below is what makes the growth bounded).
   */
  async function submitBarcode(): Promise<void> {
    const code = normalizeBarcode(barcodeInput);
    setBarcodeInput("");
    if (
      code === null ||
      barcodeInFlight.current ||
      cartLocked ||
      holdAction.current ||
      checkoutOpen ||
      receipt ||
      replacementHoldId
    )
      return;

    barcodeInFlight.current = true;
    const version = ++barcodeVersion.current;
    setBarcodeBusy(true);
    try {
      const result = await get<SaleItemSearchResult>("/sales/items", {
        barcode: code,
        kind: "PRODUCT",
        // One name row is all the non-exact part of the answer needs: this side
        // keeps only the row whose barcode equals the scanned code.
        limit: 1,
      });
      if (version !== barcodeVersion.current || holdAction.current) return;
      const match = result.items.find(
        (item): item is Extract<SaleItem, { kind: "PRODUCT" }> =>
          item.kind === "PRODUCT" && item.barcode === code,
      );
      if (!match) {
        showToast("error", `No product in this salon carries the barcode ${code}.`);
        return;
      }

      const inCart = cart.lines
        .filter((line) => line.itemType === "PRODUCT" && line.itemId === match.id)
        .reduce((total, line) => total + line.quantity, 0);
      if (inCart + 1 > match.quantity) {
        showToast(
          "error",
          match.quantity === 0
            ? `${match.name} is out of stock.`
            : `Only ${match.quantity} of ${match.name} in stock, and the cart already holds ${inCart}.`,
        );
        return;
      }

      handleAdd(match);
    } catch (error) {
      if (version === barcodeVersion.current) showToast("error", getErrorMessage(error));
    } finally {
      barcodeInFlight.current = false;
      setBarcodeBusy(false);
    }
  }

  async function takePayment(
    payments: SalePaymentInput[],
    idempotencyKey: string,
    voucherCode: string | null,
    collection?: import("@glampro_suite/shared").SaleCollectionInput,
  ) {
    setCheckoutError(null);
    const cartBody = {
      ...(customer ? { customerId: customer.id } : {}),
      lines: toSaleLineInputs(cart.lines),
      payments,
      ...(collection ? { collection } : {}),
      ...(voucherCode === null ? {} : { voucherCode }),
    };
    try {
      // A parked cart is **rung up**, not re-posted: the same row takes the money, so
      // the receipt keeps the id the hold already had and the draft's lines are
      // rewritten where they stand (ADR 0015). Everything else about the write is the
      // same one an ordinary sale makes, including the server pricing every line.
      // The idempotency key is only for the create: completing twice is answered by
      // the sale's own status, which needs no key from here.
      const sale = heldSaleId
        ? await completeSale.mutateAsync({ saleId: heldSaleId, input: cartBody })
        : await createSale.mutateAsync({ ...cartBody, idempotencyKey });
      // The cart is cleared by the mutation's own success handler, so the rail badge
      // drops with the sale rather than waiting for the receipt to close.
      setCheckoutOpen(false);
      setCustomer(null);
      setHeldSaleId(null);
      setReceipt(sale);
      showToast(
        "success",
        sale.receiptNumber === null
          ? "Sale rung up."
          : `Sale rung up as receipt #${sale.receiptNumber}.`,
      );
    } catch (error) {
      // Stay open: the message belongs beside the tenders it refused, and a retry
      // keeps this attempt's key.
      setCheckoutError(getErrorMessage(error));
    }
  }

  /**
   * Parks the cart, and the salon can see it.
   *
   * Not a browser draft: a hold is a row every till reads, so a cart parked at this
   * counter can be finished at another (ADR 0015). No payment is involved — the API
   * refuses a hold that carries one — so the checkout dialog never opens on this path.
   */
  async function holdCart() {
    if (holdAction.current || holdSale.isPending) return;
    if (heldSaleId) {
      showToast("info", "This cart is already held. Take payment or leave it held.");
      return;
    }
    if (isReadOnly) {
      showToast("error", "This salon's subscription is suspended, so the till cannot take money.");
      return;
    }

    try {
      await holdSale.mutateAsync({
        ...(customer ? { customerId: customer.id } : {}),
        lines: toSaleLineInputs(cart.lines),
      });
      // The cart is empty by now — the hook's success handler did it, because the
      // cart is a row rather than a draft.
      setCustomer(null);
      setHeldSaleId(null);
      showToast("info", "Cart held. It is on the held list for anyone at the counter.");
    } catch (error) {
      showToast("error", getErrorMessage(error));
    }
  }

  /** Picks a parked cart up: its lines and its customer, back in the till. */
  async function pickUpHold(id: string) {
    if (cartLocked || holdAction.current || checkoutOpen) return;
    if (cart.lines.length || customer || heldSaleId) {
      setReplacementHoldId(id);
      return;
    }
    await loadHold(id);
  }

  async function loadHold(id: string) {
    if (cartLocked || holdAction.current || checkoutOpen) return;
    holdAction.current = true;
    const version = ++pickupVersion.current;
    setReplacementHoldId(null);
    setBusyHoldId(id);
    try {
      const { sale, customer: heldCustomer, lines } = await resumeHold.mutateAsync(id);
      if (version !== pickupVersion.current) return;
      cart.setLines(lines);
      setCustomer(heldCustomer);
      setHeldSaleId(sale.id);
      setCheckoutError(null);
      showToast("info", "Cart picked up at current catalogue prices. Payment checks prices again.");
    } catch (error) {
      showToast("error", getErrorMessage(error));
    } finally {
      holdAction.current = false;
      setBusyHoldId(null);
    }
  }

  /** Abandons a parked cart. The API refuses anything that was already rung up. */
  async function discardHeldCart(id: string) {
    if (cartLocked || holdAction.current || checkoutOpen) return;
    holdAction.current = true;
    setBusyHoldId(id);
    try {
      await discardHold.mutateAsync(id);
      // The cart on screen may be the one that has just gone.
      if (heldSaleId === id) {
        setHeldSaleId(null);
        cart.clearCart();
        setCustomer(null);
      }
      showToast("info", "Held cart discarded.");
    } catch (error) {
      showToast("error", getErrorMessage(error));
    } finally {
      holdAction.current = false;
      setBusyHoldId(null);
    }
  }

  /**
   * Voids the receipt on screen (ADR 0016).
   *
   * The reason and optional cash confirmation are sent; the actor is the token's, so nothing here can
   * name somebody else. The server answers with the voided receipt, which replaces the
   * one on screen — the same sale, with a status the receipt now says out loud.
   */
  async function voidReceipt(reason: string, cashDisposition?: "NO_MOVEMENT") {
    if (!receipt) return;
    setVoidError(null);
    try {
      const voided = await voidSale.mutateAsync({
        saleId: receipt.id,
        reason,
        ...(cashDisposition ? { cashDisposition } : {}),
      });
      setVoidOpen(false);
      setReceipt(voided);
      showToast(
        "info",
        voided.receiptNumber === null ? "Sale voided." : `Receipt #${voided.receiptNumber} voided.`,
      );
    } catch (error) {
      // Stay open with the server's own reason: a refusal here is usually something the
      // manager can act on — a package the customer has already used, a balance that has
      // been paid against.
      setVoidError(getErrorMessage(error));
    }
  }

  /**
   * Records a full-sale refund (ADR 0020).
   *
   * The amount is the sale's, not the dialog's: this sends the reason and whether the
   * goods came back, and the server answers with the same receipt now carrying the
   * refund. The screen redraws from that row, exactly as it does after a void.
   */
  async function refundReceipt(input: import("@glampro_suite/shared").RefundSaleInput) {
    if (!receipt) return;
    setRefundError(null);
    try {
      const refunded = await refundSale.mutateAsync({ saleId: receipt.id, input });
      setRefundOpen(false);
      setReceipt(refunded);
      showToast(
        "info",
        refunded.receiptNumber === null
          ? "Refund recorded."
          : `Refund recorded against receipt #${refunded.receiptNumber}.`,
      );
    } catch (error) {
      setRefundError(getErrorMessage(error));
    }
  }

  /** Back to an empty till. The cart is already empty — the sale consumed it. */
  function startNewSale() {
    setReceipt(null);
    setCheckoutOpen(false);
    setCheckoutError(null);
    setCustomer(null);
    setHeldSaleId(null);
    setVoidOpen(false);
    setVoidError(null);
    setRefundOpen(false);
    setRefundError(null);
    setSearchInput("");
    setSearch("");
    setCatalogPage(1);
    setBarcodeInput("");
    setKind("SERVICE");
  }

  /** One tab's grid. `Tabs` renders only the active panel, so one is ever mounted. */
  function gridFor(itemKind: SaleItemKind) {
    return (
      <SaleItemGrid
        kind={itemKind}
        items={(items.data?.items ?? []).filter((item) => item.kind === itemKind)}
        isPending={items.isPending || items.isPlaceholderData}
        isError={items.isError}
        search={search}
        isMember={isMember}
        onAdd={handleAdd}
        onRetry={() => void items.refetch()}
        onClearSearch={() => {
          setSearchInput("");
          setSearch("");
          setCatalogPage(1);
        }}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-24 lg:pb-0">
      {!receipt ? (
        <header>
          <h2 className="text-xl">Sale</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Add services and products to the cart, then take payment.
          </p>
        </header>
      ) : null}

      {!receipt && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PosStaffSwitch disabled={cartLocked || checkoutOpen} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" aria-haspopup="dialog" onClick={() => setHeldOpen(true)}>
              Held carts
              {heldCarts.isError
                ? " · unavailable"
                : heldCarts.data?.items.length
                  ? ` · ${heldCarts.data.items.length}${heldCarts.data.hasMore ? "+" : ""} on page ${heldPage}`
                  : ""}
            </Button>
            <SaleHistoryPanel
              disabled={holdSale.isPending || busyHoldId !== null}
              onOpen={(sale) => {
                if (holdAction.current || holdSale.isPending) return;
                setHistoricalReceipt(true);
                setReceipt(sale);
              }}
            />
          </div>
        </div>
      )}
      {/* After a sale the till is gone until "New sale" — see the module comment. */}
      {receipt ? (
        <>
          <ReceiptView
            sale={receipt}
            historical={historicalReceipt}
            onNewSale={
              historicalReceipt
                ? () => {
                    setReceipt(null);
                    setHistoricalReceipt(false);
                    setVoidOpen(false);
                    setRefundOpen(false);
                  }
                : startNewSale
            }
            returnLabel={historicalReceipt ? "Back to cart" : "New sale"}
            customerEmail={historicalReceipt ? null : (customer?.email ?? null)}
            canVoid={canVoid && !isReadOnly}
            onVoid={() => {
              setVoidError(null);
              setVoidOpen(true);
            }}
            canRefund={canRefund && !isReadOnly}
            onRefund={() => {
              setRefundError(null);
              setRefundOpen(true);
            }}
          />

          <SaleCollectionsPanel sale={receipt} />
          <DirectTipsPanel
            key={`${tenant?.id}:${receipt.id}`}
            sale={receipt}
            staff={staffRows}
            canReturn={canRefund}
          />

          {voidOpen ? (
            <VoidSaleDialog
              receiptLabel={
                receipt.receiptNumber === null ? "This sale" : `Receipt #${receipt.receiptNumber}`
              }
              isPending={voidSale.isPending}
              errorMessage={voidError}
              onClose={() => setVoidOpen(false)}
              onConfirm={(reason, cashDisposition) => void voidReceipt(reason, cashDisposition)}
            />
          ) : null}

          {refundOpen ? (
            <RefundSaleDialog
              receiptLabel={
                receipt.receiptNumber === null ? "This sale" : `Receipt #${receipt.receiptNumber}`
              }
              amountLabel={formatPrice(receipt.totalAmount)}
              amount={receipt.totalAmount}
              isPending={refundSale.isPending}
              errorMessage={refundError}
              onClose={() => setRefundOpen(false)}
              onConfirm={(input) => void refundReceipt(input)}
            />
          ) : null}
        </>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0">
            <section
              aria-label="Items to sell"
              className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4"
            >
              {/*
                The scanner's field. A gun types the code like a keyboard and
                sends Enter, so the whole row is one form: Enter or the button
                resolves it, and the field clears either way for the next scan.
                Kept beside — not merged into — the name search, because the two
                answer differently: this one demands an exact code, that one
                matches loosely.
              */}
              <details className="rounded-md border border-line-soft px-3 py-2">
                <summary className="min-h-control cursor-pointer content-center text-sm font-bold text-ink-body">
                  Scan barcode
                </summary>
                <form
                  className="flex items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitBarcode();
                  }}
                >
                  <label className="flex-1">
                    <span className="mb-1.5 block text-sm font-medium text-ink">Barcode</span>
                    <input
                      type="text"
                      value={barcodeInput}
                      onChange={(event) => setBarcodeInput(event.target.value)}
                      placeholder="Scan a barcode or type the code"
                      aria-label="Scan a barcode or type the code"
                      autoComplete="off"
                      maxLength={64}
                      disabled={cartLocked}
                      className="h-control w-full rounded-md border border-line bg-surface px-3 font-mono text-sm text-ink transition-colors placeholder:font-sans placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-purple disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-disabled"
                    />
                  </label>
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={cartLocked || barcodeBusy || barcodeInput.trim() === ""}
                  >
                    Add
                  </Button>
                </form>
              </details>

              <div className="relative order-first">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted"
                />
                <input
                  type="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search services, products, packages…"
                  aria-label="Search the catalogue"
                  className="h-control w-full rounded-md border border-line bg-surface pr-3 pl-9 text-sm text-ink transition-colors placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-purple"
                />
              </div>

              {kinds.length > 0 ? (
                <Tabs
                  label="Item categories"
                  activeId={activeKind}
                  onChange={(id) => {
                    const next = SALE_ITEM_KINDS.find((candidate) => candidate === id);
                    if (next) {
                      setKind(next);
                      setCatalogPage(1);
                    }
                  }}
                  items={kinds.map((itemKind) => ({
                    id: itemKind,
                    label: SALE_KIND_LABELS[itemKind],
                    content: gridFor(itemKind),
                  }))}
                />
              ) : (
                // An empty tab row means the first search has not answered or
                // failed — the kinds the salon may sell are the server's answer,
                // and guessing them here is the drift this page exists to avoid.
                // The grid below says which of the two it is.
                gridFor(activeKind)
              )}
              <SaleListPagination
                page={catalogPage}
                hasMore={items.data?.hasMore ?? false}
                disabled={items.isPending || items.isFetching || items.isError}
                onPageChange={setCatalogPage}
              />
            </section>
          </div>

          <div
            ref={cartSection}
            id="sale-cart"
            tabIndex={-1}
            className="flex min-w-0 scroll-mt-24 flex-col gap-4 focus-visible:outline-2 focus-visible:outline-purple lg:sticky lg:top-24"
          >
            <Card title="Customer">
              <CustomerPicker customer={customer} onSelect={setCustomer} disabled={cartLocked} />
              {isMember ? (
                <p className="mt-2 text-xs font-bold text-purple">Member pricing applied</p>
              ) : null}
              {needsCustomer && !customer ? (
                <p role="status" className="mt-2 text-sm text-warning">
                  Select a customer to issue this package, credit or gift card.
                </p>
              ) : null}
            </Card>
            {heldSaleId ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-purple/40 bg-surface-2 px-4 py-2.5">
                <p className="text-xs text-ink-body">
                  Ringing up the <span className="font-bold text-ink">held cart</span> you picked up
                  at current catalogue prices. Taking payment completes it and checks prices again.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={cartLocked}
                  onClick={() => {
                    // Nothing was written: the hold is still parked, and this only
                    // clears the till.
                    setHeldSaleId(null);
                    cart.clearCart();
                    setCustomer(null);
                  }}
                >
                  Leave it held
                </Button>
              </div>
            ) : null}

            {services.some((service) => service.isError) ? (
              <div role="alert" className="rounded-card border border-line bg-surface p-3 text-sm">
                <p>
                  Service details could not be loaded. Staff choices are unavailable for affected
                  services.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    for (const service of services) {
                      if (service.isError) void service.refetch();
                    }
                  }}
                >
                  Retry service details
                </Button>
              </div>
            ) : null}
            <CartPanel
              lines={cart.lines}
              isMember={isMember}
              staffForService={staffForService}
              needsCustomer={needsCustomer && !customer}
              disabled={cartLocked}
              onQuantity={cart.setQuantity}
              onStaff={cart.setStaff}
              sellerOptions={staffRows}
              onAttribution={cart.setAttribution}
              onDiscount={cart.setDiscount}
              onRemove={cart.removeLine}
              onClear={cart.clearCart}
              onCheckout={openCheckout}
              onHold={() => void holdCart()}
              holdPending={holdSale.isPending}
            />

            <Drawer
              open={heldOpen}
              onClose={() => setHeldOpen(false)}
              title="Held carts"
              widthClassName="max-w-lg"
            >
              <HeldCartsPanel
                holds={heldCarts.data?.items ?? []}
                isPending={heldCarts.isPending}
                isError={heldCarts.isError}
                activeId={heldSaleId}
                busyId={busyHoldId}
                disabled={cartLocked || checkoutOpen}
                onPickUp={(id) => {
                  setHeldOpen(false);
                  void pickUpHold(id);
                }}
                onDiscard={(id) => void discardHeldCart(id)}
                onRetry={() => void heldCarts.refetch()}
                page={heldPage}
                hasMore={heldCarts.data?.hasMore ?? false}
                isFetching={heldCarts.isFetching}
                onPageChange={setHeldPage}
              />
            </Drawer>
          </div>
        </div>
      )}

      {!receipt && cart.lines.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 ml-rail flex items-center justify-between gap-3 border-t border-line bg-surface p-3 shadow-menu lg:hidden">
          <div>
            <p className="text-xs text-ink-muted">
              {cart.lines.reduce((sum, line) => sum + line.quantity, 0)} items in cart
            </p>
            <p className="font-heavy text-ink">{formatPrice(totalCents / 100)}</p>
          </div>
          <Button
            onClick={() => {
              cartSection.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              cartSection.current?.focus({ preventScroll: true });
            }}
          >
            View cart
          </Button>
        </div>
      ) : null}

      {replacementHoldId ? (
        <Modal
          open
          title="Replace the open cart?"
          description="Local cart edits will be discarded. Any existing server hold stays unchanged. Hold the current cart first if you need to keep it."
          onClose={() => setReplacementHoldId(null)}
          size="sm"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setReplacementHoldId(null)}>
                Keep current cart
              </Button>
              <Button variant="danger" onClick={() => void loadHold(replacementHoldId)}>
                Replace and pick up
              </Button>
            </div>
          }
        >
          <p>The held cart will use current catalogue prices. Payment checks prices again.</p>
        </Modal>
      ) : null}
      {checkoutOpen ? (
        <PaymentDialog
          staff={staffRows}
          key={JSON.stringify([cart.lines, customer?.id, isMember])}
          totalCents={totalCents}
          lines={cart.lines.map((line) => ({
            itemName: line.name,
            itemType: line.itemType,
            itemId: line.itemId,
            quantity: line.quantity,
            unitPriceCents: priceToCents(lineUnitPrice(line, isMember)),
          }))}
          customerId={customer?.id ?? null}
          hasCustomer={customer !== null}
          needsCustomer={needsCustomer}
          hasManualDiscount={cart.lines.some((line) => (line.discountPercent ?? 0) > 0)}
          isPending={createSale.isPending || completeSale.isPending}
          errorMessage={checkoutError}
          onClose={() => setCheckoutOpen(false)}
          onConfirm={(payments, key, voucherCode, collection) =>
            void takePayment(payments, key, voucherCode, collection)
          }
        />
      ) : null}
    </div>
  );
}
