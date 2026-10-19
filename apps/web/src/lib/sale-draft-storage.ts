/**
 * Browser persistence for the one unfinished till cart.
 *
 * The legacy client persisted its whole Redux sale reducer. The rebuild keeps a
 * much smaller draft: catalogue display data, quantities, performer choices and
 * the selected customer. Tenders and idempotency keys are deliberately absent,
 * and the API still re-prices every line when the sale is posted.
 */
import { z } from "zod";

import {
  MAX_SALE_LINES,
  SALE_ITEM_KINDS,
  customerSummarySchema,
  discountPercentSchema,
  type CustomerSummary,
} from "@glampro_suite/shared";

import type { CartLine } from "@/hooks/useSale";

const STORAGE_PREFIX = "glampro.saleDraft.v1";

const cartLineSchema = z.object({
  itemType: z.enum(SALE_ITEM_KINDS),
  itemId: z.string().min(1),
  name: z.string().min(1),
  quantity: z.number().int().min(1).max(10_000),
  price: z.string(),
  memberPrice: z.string().nullable(),
  staffId: z.string().min(1).optional(),
  // The **rate**, not the money — the money is the server's to compute (ADR 0017). The
  // bounds come from the contract, so a draft carrying a rate the API would refuse is
  // discarded rather than resumed into a cart that cannot be posted.
  discountPercent: discountPercentSchema.optional(),
});

const saleDraftSchema = z.object({
  version: z.literal(1),
  lines: z.array(cartLineSchema).max(MAX_SALE_LINES),
  customer: customerSummarySchema.nullable(),
  heldSaleId: z.string().min(1).nullable().optional(),
});

export interface SaleDraft {
  version: 1;
  lines: CartLine[];
  customer: CustomerSummary | null;
  heldSaleId?: string | null;
}

const EMPTY_DRAFT: SaleDraft = { version: 1, lines: [], customer: null };

export function saleDraftIdentity(tenantId: string, userId: string): string {
  return `${tenantId}:${userId}`;
}

function storageKey(identity: string): string {
  return `${STORAGE_PREFIX}:${identity}`;
}

export function readSaleDraft(identity: string | null): SaleDraft {
  if (!identity) return EMPTY_DRAFT;

  const key = storageKey(identity);
  const raw = localStorage.getItem(key);
  if (!raw) return EMPTY_DRAFT;

  try {
    const parsed = saleDraftSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // The cleanup below handles malformed JSON and a stale schema alike.
  }

  localStorage.removeItem(key);
  return EMPTY_DRAFT;
}

function writeSaleDraft(identity: string, draft: SaleDraft): void {
  const key = storageKey(identity);
  if (draft.lines.length === 0 && draft.customer === null && !draft.heldSaleId) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, JSON.stringify(draft));
}

export function setSaleDraftLines(identity: string | null, lines: CartLine[]): void {
  if (!identity) return;
  writeSaleDraft(identity, { ...readSaleDraft(identity), lines });
}

export function setSaleDraftCustomer(
  identity: string | null,
  customer: CustomerSummary | null,
): void {
  if (!identity) return;
  writeSaleDraft(identity, { ...readSaleDraft(identity), customer });
}

export function clearSaleDraft(identity: string | null): void {
  if (!identity) return;
  localStorage.removeItem(storageKey(identity));
}

export function setSaleDraftHeldSale(identity: string | null, heldSaleId: string | null): void {
  if (!identity) return;
  writeSaleDraft(identity, { ...readSaleDraft(identity), heldSaleId });
}
