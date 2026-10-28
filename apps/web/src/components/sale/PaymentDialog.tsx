/**
 * The tender step — handoff screen 02's payment sheet.
 *
 * One payer, one row per tender: cash, card, or a split is two rows, which is
 * how `createSaleSchema` models money (`payments[]`, legacy's three endpoints
 * collapsed into one array). Everything here is **whole cents**
 * (`lib/money.ts`), because the till's total and the tenders added up must agree
 * to the cent before anything is posted.
 *
 * **The idempotency key is minted here, once per attempt** (Q16,
 * `lib/idempotency.ts`). The page mounts this dialog on open and unmounts it on
 * close, so:
 *
 * - a double-tap on "Take payment" reuses the key and the API returns the sale
 *   that already exists rather than charging twice;
 * - a genuine refusal (a 422, a suspended salon) is fixed and retried with the
 *   same key, which is safe because nothing was written for it.
 *
 * Two rules the dialog states rather than lets the server discover:
 *
 * - **A shortfall is only allowed when the sale has a customer.** The API
 *   records the balance against the customer (`CustomerOutstanding`); with no
 *   customer there is nowhere for it to go, so the tender has to cover the
 *   total. Overpaying is always fine — that is change, not a credit.
 * - **A cart that grants credit needs a customer** before payment, because the
 *   server refuses that sale whole (`createSale`'s `GRANTING_KINDS` check) and
 *   the cashier should know before they start counting notes.
 *
 * Since TK2610-0011 the sheet also takes **local rails** — PayNow/SGQR, NETS,
 * GrabPay, Atome — which are recorded, not acquired: the cashier reads which one the
 * customer used and no QR is generated and no provider is called (ADR 0019). And it
 * takes **credit the customer already holds**, drawn from `GET /customers/:id/holdings`:
 * a package session or prepaid credit is a *tender*, so the amount it pays is computed
 * here by the same rule the server applies (`redeemPayments`) and posted with the
 * `holdingId` it spends. The amount field is therefore read-only on those rows: the
 * till is stating what the holding covers, not asking the cashier to type it.
 */
import { useState } from "react";
import CommissionAttributionEditor from "./CommissionAttributionEditor";
import type { StaffOption } from "./CartLine";
import type { CommissionShares } from "@glampro_suite/shared";

import {
  MAX_SALE_PAYMENTS,
  isRedemptionPaymentMethod,
  type SalePaymentInput,
  type SaleCollectionInput,
  type SalePaymentMethod,
  type VoucherPreview,
} from "@glampro_suite/shared";

import { Plus, Trash } from "@/components/icons";
import Button from "@/components/ui/Button";
import { CONTROL_CLASS } from "@/components/ui/Field";
import IconButton from "@/components/ui/IconButton";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import Input from "@/components/ui/Input";
import { PAYMENT_METHOD_OPTIONS } from "@/constants/sale";
import { useCustomerHoldings } from "@/hooks/useCustomers";
import { useVoucherPreview } from "@/hooks/useSale";
import { getErrorMessage } from "@/lib/api";
import { newIdempotencyKey } from "@/lib/idempotency";
import { centsToPrice, priceToCents } from "@/lib/money";
import { packageCoverage, type PaymentLine } from "@/lib/package-coverage";
import { cn } from "@/lib/utils";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

/** One row of the sheet, as typed. Amounts stay strings until they are posted. */
interface TenderDraft {
  unpaidSessionOverride?: SalePaymentInput["unpaidSessionOverride"];
  id: number;
  method: SalePaymentMethod;
  amount: string;
  /** The package or credit a redemption tender spends; unused by the money tenders. */
  holdingId?: string;
  performers?: CommissionShares;
}

export interface PaymentDialogProps {
  staff?: StaffOption[];
  /** The cart total in whole cents, derived the same way the cart panel draws it. */
  totalCents: number;
  /** The cart, for pricing what a package covers. */
  lines: readonly PaymentLine[];
  /** The customer attached to the sale, whose credit this sheet may spend. */
  customerId: string | null;
  /** Whether the sale has a customer — a balance can only be owed to somebody. */
  hasCustomer: boolean;
  /** The cart holds a package, value package or gift card, so it needs a customer. */
  needsCustomer: boolean;
  /**
   * The cart carries a manual line discount, so a voucher cannot be added: ADR 0020's
   * D1 rule refuses the pair. The sheet says why rather than letting the API refuse the
   * sale after the money has been counted.
   */
  hasManualDiscount: boolean;
  /** The write is in flight; every control is frozen so one attempt stays one attempt. */
  isPending: boolean;
  /** The server's refusal, shown above the tenders. */
  errorMessage: string | null;
  onClose: () => void;
  onConfirm: (
    payments: SalePaymentInput[],
    idempotencyKey: string,
    voucherCode: string | null,
    collection?: SaleCollectionInput,
  ) => void;
}

let nextTenderId = 1;

export default function PaymentDialog({
  staff = [],
  totalCents,
  lines,
  customerId,
  hasCustomer,
  needsCustomer,
  hasManualDiscount,
  isPending,
  errorMessage,
  onClose,
  onConfirm,
}: PaymentDialogProps) {
  const { formatPrice } = useSalonFormatting();
  // One key per mount, i.e. per attempt — see the module comment.
  const [idempotencyKey] = useState(newIdempotencyKey);
  // One tender, pre-filled with the exact total: the overwhelmingly common case
  // is a customer handing over the whole amount in one way.
  const [tenders, setTenders] = useState<TenderDraft[]>(() => [
    { id: nextTenderId++, method: "CASH", amount: centsToPrice(totalCents) },
  ]);

  // The voucher step (ADR 0020): the code is previewed against the server's own
  // arithmetic before it is posted, so the sheet never offers a discount the write
  // would refuse or re-price.
  const voucherPreview = useVoucherPreview();
  const [voucherCode, setVoucherCode] = useState("");
  const [voucher, setVoucher] = useState<VoucherPreview | null>(null);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [recordCollection, setRecordCollection] = useState(false);
  const [collectionConfirmed, setCollectionConfirmed] = useState(false);
  const [allocationDraft, setAllocationDraft] = useState<Record<string, string>>({});
  // What the customer actually owes: the cart, less whatever the applied code took
  // off. Tenders, change and the blocker all read this figure.
  const dueCents = voucher === null ? totalCents : priceToCents(voucher.totalAmount);

  // What this customer can still spend. A walk-in has none, and the query stays idle
  // rather than asking the API for a customer that is not there.
  const holdings = useCustomerHoldings(customerId);
  const available = holdings.data?.holdings ?? [];
  const packages = available.filter((holding) => holding.kind === "PACKAGE");
  const credits = available.filter((holding) => holding.kind === "PREPAID_CREDIT");

  /**
   * What one row is worth. A money tender is what the cashier typed; a redemption is
   * derived from the holding it spends, so the sheet never asks for a number the
   * server would have to correct.
   */
  const allocated = lines.map(() => 0);
  function amountFor(tender: TenderDraft, alreadyPaid: number): number {
    if (!isRedemptionPaymentMethod(tender.method)) return priceToCents(tender.amount);

    const holding = available.find((row) => row.id === tender.holdingId);
    if (!holding) return 0;

    if (holding.kind === "PREPAID_CREDIT") {
      // Credit pays the rest of the bill, up to what is left on it — never more than
      // the sale, which the server refuses as overpayment.
      return Math.min(priceToCents(holding.amountRemaining), Math.max(dueCents - alreadyPaid, 0));
    }

    const coverage = packageCoverage(
      holding,
      lines.map((line, index) => ({
        ...line,
        totalCents:
          voucher?.lineNetAmounts?.[index] !== undefined
            ? priceToCents(voucher.lineNetAmounts[index])
            : (line.totalCents ?? line.unitPriceCents * line.quantity),
      })),
      allocated,
    );
    allocated.splice(0, allocated.length, ...coverage.units);
    return coverage.cents;
  }

  // Rows in order, so a second credit tender only sees what the first left owing.
  const tenderCents: number[] = [];
  let paidCents = 0;
  for (const tender of tenders) {
    const cents = amountFor(tender, paidCents);
    tenderCents.push(cents);
    paidCents += cents;
  }
  const remainingCents = dueCents - paidCents;
  const collectionAllocations = tenders.flatMap((tender, paymentIndex) =>
    lines.flatMap((_, linePosition) => {
      const value = allocationDraft[`${tender.id}:${linePosition}`] ?? "";
      return priceToCents(value) > 0
        ? [{ paymentIndex, linePosition, grossCents: String(priceToCents(value)) }]
        : [];
    }),
  );
  const collectionError = !recordCollection
    ? null
    : paidCents <= 0 || remainingCents < 0
      ? "Collection capture requires a positive payment with no change to give."
      : tenders.some((tender, index) => {
            const amounts = lines.map(
              (_, position) => allocationDraft[`${tender.id}:${position}`] ?? "",
            );
            return (
              amounts.some((value) => value !== "" && !/^\d+(?:\.\d{1,2})?$/.test(value)) ||
              collectionAllocations
                .filter((row) => row.paymentIndex === index)
                .reduce((sum, row) => sum + Number(row.grossCents), 0) !==
                (isRedemptionPaymentMethod(tender.method) ? 0 : tenderCents[index])
            );
          })
        ? "Allocate each money tender to cart lines exactly, using amounts with at most two decimals."
        : !collectionConfirmed
          ? "Confirm the SGD currency and explicit line allocations."
          : null;

  const hasBadAmount = tenders.some(
    (tender) =>
      !isRedemptionPaymentMethod(tender.method) && !/^\d*\.?\d{0,2}$/.test(tender.amount.trim()),
  );
  const blockedByCustomer = needsCustomer && !hasCustomer;
  // Credit belongs to a person, so a walk-in cart cannot spend it — the server refuses
  // the same thing with `HOLDING_REQUIRES_CUSTOMER`.
  const redemptionWithoutCustomer =
    !hasCustomer && tenders.some((tender) => isRedemptionPaymentMethod(tender.method));
  const missingHolding = tenders.some(
    (tender) => isRedemptionPaymentMethod(tender.method) && tender.holdingId === undefined,
  );
  const emptyRedemption = tenders.some(
    (tender, index) => isRedemptionPaymentMethod(tender.method) && tenderCents[index] === 0,
  );
  // Change is a money tender's business. A package or credit that pays more than the
  // sale is a mistake the server refuses, so the sheet says so before it posts.
  const overRedeemed =
    paidCents > dueCents && tenders.some((tender) => isRedemptionPaymentMethod(tender.method));

  /**
   * Why the sale cannot be posted yet, or `null` when it can. Rendered as the
   * sentence beside the buttons *and* used to disable them, so the reason for a
   * refusal is never a mystery.
   */
  const blocker =
    collectionError ??
    (voucherPreview.isPending
      ? "Wait for the voucher preview before taking payment."
      : blockedByCustomer
        ? "Pick a customer first — this cart grants credit, which has to belong to somebody."
        : redemptionWithoutCustomer
          ? "Attach a customer first — package and credit tenders spend somebody's credit."
          : missingHolding
            ? "Choose which package or credit is paying."
            : emptyRedemption
              ? "That package or credit covers nothing in this cart. Pick another tender."
              : overRedeemed
                ? "A package or credit cannot pay more than the sale totals. Remove a tender that covers a line twice."
                : hasBadAmount
                  ? "Enter an amount for every tender."
                  : remainingCents > 0 && !hasCustomer
                    ? `The tenders are ${formatPrice(centsToPrice(remainingCents))} short and there is no customer to carry the balance.`
                    : null);

  function setTender(id: number, patch: Partial<TenderDraft>) {
    setCollectionConfirmed(false);
    setTenders((current) =>
      current.map((tender) => (tender.id === id ? { ...tender, ...patch } : tender)),
    );
  }

  /**
   * Switching a row's tender. A redemption lands on the first holding of that kind, so
   * the row is immediately postable; switching back to money clears both, because a
   * typed amount belongs to the tender it was typed for.
   */
  function chooseMethod(id: number, method: SalePaymentMethod) {
    const first =
      method === "PACKAGE" ? packages[0] : method === "PREPAID_CREDIT" ? credits[0] : undefined;
    setTender(id, {
      method,
      amount: "",
      holdingId: first?.id,
      performers: undefined,
      unpaidSessionOverride: undefined,
    });
  }

  function addTender() {
    setCollectionConfirmed(false);
    setTenders((current) => [...current, { id: nextTenderId++, method: "CARD", amount: "" }]);
  }

  function removeTender(id: number) {
    setCollectionConfirmed(false);
    setTenders((current) => current.filter((tender) => tender.id !== id));
  }

  /**
   * Keeps a single full-amount tender honest when a voucher changes the bill. A money
   * tender typed at the old due follows the new one; anything else (a split, a
   * redemption) is left exactly as the cashier entered it.
   */
  function retotalTenders(nextDueCents: number, previousDueCents: number) {
    setTenders((current) =>
      current.length === 1
        ? current.map((tender) =>
            !isRedemptionPaymentMethod(tender.method) &&
            priceToCents(tender.amount) === previousDueCents
              ? { ...tender, amount: centsToPrice(nextDueCents) }
              : tender,
          )
        : current,
    );
  }

  /**
   * Asks the server what the code is worth on this cart. The write posts the same
   * code (not the figure), so this preview and the receipt cannot disagree.
   */
  async function applyVoucher() {
    setCollectionConfirmed(false);
    if (isPending || voucherPreview.isPending || hasManualDiscount || voucher !== null) return;
    const code = voucherCode.trim();
    if (code.length < 3) {
      setVoucherError("Enter the voucher code.");
      return;
    }
    setVoucherError(null);
    try {
      const preview = await voucherPreview.mutateAsync({
        voucherCode: code,
        ...(customerId ? { customerId } : {}),
        // Prices are the server's to read; the preview takes only what was sold.
        lines: lines.map(({ itemType, itemId, quantity }) => ({ itemType, itemId, quantity })),
      });
      setVoucher(preview);
      setVoucherCode(preview.code);
      retotalTenders(priceToCents(preview.totalAmount), dueCents);
    } catch (error) {
      setVoucherError(getErrorMessage(error));
    }
  }

  /** Takes the code off the sheet; the sale is posted at the cart's own total. */
  function removeVoucher() {
    setCollectionConfirmed(false);
    setVoucher(null);
    setVoucherCode("");
    setVoucherError(null);
    retotalTenders(totalCents, dueCents);
  }

  /** "Rest" — what a split needs after the first tender has been typed. */
  function fillRemaining(id: number) {
    setTender(id, { amount: centsToPrice(Math.max(remainingCents, 0)) });
  }

  /** The holdings a redemption method may spend, as select options. */
  function holdingOptions(method: SalePaymentMethod) {
    return method === "PACKAGE" ? packages : method === "PREPAID_CREDIT" ? credits : [];
  }

  function submit() {
    if (isPending || blocker !== null) return;
    const payments = tenders.map((tender, index) => ({
      method: tender.method,
      // Rounded through cents, so a typed "12.5" posts as 12.50. A redemption posts
      // the amount this sheet derived, which is exactly what the server recomputes.
      amount: Number(centsToPrice(tenderCents[index] ?? 0)),
      ...(isRedemptionPaymentMethod(tender.method) ? { holdingId: tender.holdingId } : {}),
      ...(tender.method === "PACKAGE" && tender.performers
        ? { performers: tender.performers }
        : {}),
      ...(tender.method === "PACKAGE" && tender.unpaidSessionOverride
        ? { unpaidSessionOverride: tender.unpaidSessionOverride }
        : {}),
    }));
    if (recordCollection) {
      onConfirm(payments, idempotencyKey, voucher === null ? null : voucher.code, {
        currency: "SGD",
        allocations: collectionAllocations,
      });
    } else onConfirm(payments, idempotencyKey, voucher === null ? null : voucher.code);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Take payment"
      description="How the money was handed over. A split is two tenders."
      size="md"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">
            {blocker ??
              (remainingCents < 0
                ? `Change to give: ${formatPrice(centsToPrice(-remainingCents))}`
                : remainingCents === 0
                  ? "Paid in full."
                  : `${formatPrice(centsToPrice(remainingCents))} will be left on the customer's account.`)}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={submit} loading={isPending} disabled={blocker !== null}>
              Take payment
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {errorMessage ? (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {errorMessage}
          </p>
        ) : null}

        <div className="flex items-baseline justify-between rounded-md bg-surface-2 px-4 py-3">
          <span className="text-sm font-bold text-ink-body">Total due</span>
          <span className="text-lg font-heavy text-ink">{formatPrice(centsToPrice(dueCents))}</span>
        </div>

        {/* The voucher step (ADR 0020). A code is a campaign the manager published,
            not a tender: it changes the bill, and the server prices it. D1 refuses a
            voucher beside manual line discounts, so the field says why up front. */}
        <div className="flex flex-col gap-2 rounded-md border border-line-soft bg-surface p-3">
          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-xs font-bold text-ink-body">Voucher</span>
              <input
                type="text"
                value={voucherCode}
                disabled={
                  isPending || voucherPreview.isPending || voucher !== null || hasManualDiscount
                }
                aria-label="Voucher code"
                placeholder="Enter a code"
                onChange={(event) => setVoucherCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && voucher === null) {
                    event.preventDefault();
                    void applyVoucher();
                  }
                }}
                className={cn(CONTROL_CLASS, "h-control px-3 uppercase")}
              />
            </label>
            {voucher === null ? (
              <Button
                variant="secondary"
                loading={voucherPreview.isPending}
                disabled={isPending || hasManualDiscount || voucherCode.trim().length < 3}
                onClick={() => void applyVoucher()}
              >
                Apply
              </Button>
            ) : (
              <Button variant="ghost" disabled={isPending} onClick={removeVoucher}>
                Remove
              </Button>
            )}
          </div>

          {hasManualDiscount ? (
            <p className="text-xs text-ink-muted">
              This cart has a manual line discount. Remove it from the cart before applying a
              voucher — the two cannot share a sale.
            </p>
          ) : null}

          {voucherError ? (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {voucherError}
            </p>
          ) : null}

          {voucher !== null ? (
            <p className="text-sm text-success-text">
              {voucher.code} applied — −{formatPrice(voucher.discountAmount)}
              {voucher.description ? ` · ${voucher.description}` : ""}
            </p>
          ) : null}
        </div>

        {credits.some((holding) => holding.id.startsWith("family:")) ? (
          <p className="text-sm text-ink-muted">
            Shared family credit uses only explicitly shared, unexpired holdings. Each holding keeps
            its own expiry. The server draws earliest expiry first, then purchase date; no-expiry
            credit is last. Balances and membership are rechecked on payment.
          </p>
        ) : null}
        <ul aria-label="Tenders" className="flex flex-col gap-3">
          {tenders.map((tender, index) => {
            const isRedemption = isRedemptionPaymentMethod(tender.method);
            const options = holdingOptions(tender.method).map((holding) => ({
              value: holding.id,
              label:
                holding.kind === "PACKAGE"
                  ? `${holding.name} — ${holding.quantityRemaining} left${holding.paidSessionsRemaining !== undefined && holding.paidSessionsRemaining !== null ? ` (${holding.paidSessionsRemaining} paid)` : " (payment evidence unavailable)"}`
                  : `${holding.name} — ${formatPrice(holding.amountRemaining ?? "0.00")} left`,
            }));

            return (
              <li
                key={tender.id}
                className="flex flex-col gap-2 rounded-md border border-line-soft bg-surface p-3"
              >
                <div className="flex items-end gap-2">
                  <Select
                    label={`Tender ${index + 1}`}
                    value={tender.method}
                    disabled={isPending}
                    onChange={(event) =>
                      chooseMethod(tender.id, event.target.value as SalePaymentMethod)
                    }
                    options={PAYMENT_METHOD_OPTIONS}
                    className="w-40 shrink-0"
                  />

                  {isRedemption ? (
                    <>
                      <Select
                        label={`Paid with (tender ${index + 1})`}
                        value={tender.holdingId ?? ""}
                        disabled={isPending || options.length === 0}
                        placeholder={options.length === 0 ? "None available" : "Select…"}
                        options={options}
                        onChange={(event) =>
                          setTender(tender.id, {
                            holdingId: event.target.value,
                            unpaidSessionOverride: undefined,
                          })
                        }
                        className="min-w-0 flex-1"
                      />
                      {/* Derived, never typed: the server recomputes what the holding
                          covers and refuses anything else, so an editable box here
                          would only offer a way to fail. */}
                      <div className="flex w-28 shrink-0 flex-col gap-1.5">
                        <span className="text-xs font-bold text-ink-body">Amount</span>
                        <span
                          className={cn(
                            CONTROL_CLASS,
                            "flex h-control items-center justify-end px-3 font-bold text-ink",
                          )}
                        >
                          {formatPrice(centsToPrice(tenderCents[index] ?? 0))}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* A raw input rather than `Input`: the amount is one of four controls
                          in a row whose label already names the tender, and the accessible
                          name carries that number so a screen reader still hears which row
                          this box belongs to. */}
                      <label className="flex flex-1 flex-col gap-1.5">
                        <span className="text-xs font-bold text-ink-body">Amount</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={tender.amount}
                          disabled={isPending}
                          aria-label={`Amount for tender ${index + 1}`}
                          onChange={(event) => setTender(tender.id, { amount: event.target.value })}
                          className={cn(CONTROL_CLASS, "h-control px-3 text-right")}
                        />
                      </label>

                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isPending || remainingCents <= 0}
                        onClick={() => fillRemaining(tender.id)}
                      >
                        Rest
                      </Button>
                    </>
                  )}

                  {tenders.length > 1 ? (
                    <IconButton
                      label={`Remove tender ${index + 1}`}
                      icon={<Trash />}
                      variant="outline"
                      disabled={isPending}
                      onClick={() => removeTender(tender.id)}
                    />
                  ) : (
                    // Keeps the row's height and the last column steady, so adding a
                    // second tender does not shift the first one's controls.
                    <span aria-hidden className="h-control w-control shrink-0" />
                  )}
                </div>

                {tender.method === "PACKAGE" ? (
                  <div className="mt-2">
                    <p className="text-xs text-ink-muted">
                      Optional session/set performers. This split applies to the whole original
                      session value, not current service prices. If omitted, identical covered-line
                      splits are retained; conflicting splits remain unknown. No new earnings are
                      enabled.
                    </p>
                    <CommissionAttributionEditor
                      value={tender.performers ? { performers: tender.performers } : undefined}
                      performers={staff}
                      disabled={isPending}
                      onChange={(value) => setTender(tender.id, { performers: value?.performers })}
                    />
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!tender.unpaidSessionOverride}
                        disabled={isPending}
                        onChange={(event) =>
                          setTender(tender.id, {
                            unpaidSessionOverride: event.target.checked
                              ? { managerId: "", pin: "", reason: "" }
                              : undefined,
                          })
                        }
                      />
                      Manager approval for unpaid sessions
                    </label>
                    {tender.unpaidSessionOverride ? (
                      <div className="flex flex-col gap-2">
                        <Select
                          label={`Approving manager (tender ${index + 1})`}
                          value={tender.unpaidSessionOverride.managerId}
                          options={staff.map((person) => ({
                            value: person.id,
                            label: person.name,
                          }))}
                          disabled={isPending}
                          onChange={(event) =>
                            setTender(tender.id, {
                              unpaidSessionOverride: {
                                ...tender.unpaidSessionOverride!,
                                managerId: event.target.value,
                              },
                            })
                          }
                        />
                        <Input
                          label={`Manager PIN (tender ${index + 1})`}
                          type="password"
                          autoComplete="off"
                          value={tender.unpaidSessionOverride.pin}
                          disabled={isPending}
                          onChange={(event) =>
                            setTender(tender.id, {
                              unpaidSessionOverride: {
                                ...tender.unpaidSessionOverride!,
                                pin: event.target.value,
                              },
                            })
                          }
                        />
                        <Input
                          label={`Approval reason (tender ${index + 1})`}
                          value={tender.unpaidSessionOverride.reason}
                          disabled={isPending}
                          maxLength={500}
                          onChange={(event) =>
                            setTender(tender.id, {
                              unpaidSessionOverride: {
                                ...tender.unpaidSessionOverride!,
                                reason: event.target.value,
                              },
                            })
                          }
                        />
                        <p className="text-xs text-ink-muted">
                          The server verifies the manager PIN and current role. Approval and reason
                          are audited; the PIN is not retained.
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {isRedemption ? (
                  <p className="text-xs text-ink-muted">
                    {tender.method === "PACKAGE"
                      ? "Sessions come off the package when the sale is taken; void it and they go back."
                      : "Credit is taken off the balance when the sale is taken; void it and it goes back."}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>

        <section className="flex flex-col gap-3 rounded-md border border-line-soft p-3">
          <label className="flex items-center gap-2 text-sm font-bold">
            <input
              type="checkbox"
              checked={recordCollection}
              disabled={isPending}
              onChange={(event) => {
                setRecordCollection(event.target.checked);
                setCollectionConfirmed(false);
              }}
            />
            Record collection allocations
          </label>
          {recordCollection ? (
            <>
              <p className="text-xs text-ink-muted">
                Amounts are SGD. Enter how each recorded money tender pays each cart line. This
                saves evidence only, not commission earnings. Package/credit tenders are not fresh
                cash: their allocation is zero. Change is not supported. Server-priced line limits
                are checked on submission.
              </p>
              {tenders.map((tender, index) =>
                isRedemptionPaymentMethod(tender.method) ? null : (
                  <fieldset key={tender.id} disabled={isPending} className="flex flex-col gap-2">
                    <legend className="text-sm font-bold">
                      Tender {index + 1}: {formatPrice(centsToPrice(tenderCents[index] ?? 0))}
                    </legend>
                    {lines.map((line, position) => (
                      <label
                        key={position}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        Line {position + 1}: {line.itemName ?? line.itemType}
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`Tender ${index + 1} allocation to line ${position + 1}`}
                          className={cn(CONTROL_CLASS, "w-28 px-2")}
                          value={allocationDraft[`${tender.id}:${position}`] ?? ""}
                          onChange={(event) => {
                            setAllocationDraft((current) => ({
                              ...current,
                              [`${tender.id}:${position}`]: event.target.value,
                            }));
                            setCollectionConfirmed(false);
                          }}
                        />
                      </label>
                    ))}
                  </fieldset>
                ),
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={collectionConfirmed}
                  disabled={isPending}
                  onChange={(event) => setCollectionConfirmed(event.target.checked)}
                />
                I confirm these payments were collected in SGD and allocated as entered.
              </label>
            </>
          ) : (
            <p className="text-xs text-ink-muted">
              Optional while collection integration is in progress. Without confirmation,
              payment-to-line evidence remains unknown.
            </p>
          )}
        </section>

        {tenders.length < MAX_SALE_PAYMENTS ? (
          <Button variant="secondary" size="sm" onClick={addTender} disabled={isPending}>
            <Plus aria-hidden />
            Add another tender
          </Button>
        ) : null}
      </div>
    </Modal>
  );
}
