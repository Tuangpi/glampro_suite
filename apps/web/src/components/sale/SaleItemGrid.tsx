/**
 * The item grid — one tab's sellable rows of handoff screen 01.
 *
 * The page renders the same grid inside every `Tabs` panel and only the active
 * one reaches the DOM, so `kind` here is the tab that *contains* the grid and
 * the rows are whatever `?kind=` returned: the same contract column in both
 * places, as `searchSaleItems` documents. A kind the salon has not bought never
 * gets a tab at all (`searchableKinds`), so this grid can never be asked to
 * draw rows the salon cannot sell — omitted, not refused.
 *
 * Each row is a button because the grid's one verb is "add to the cart". The
 * meta line carries only columns that kind actually has — a stock count for a
 * product, a session count for a package — because a second field carrying the
 * same meaning would give the two a chance to disagree (the schema's union
 * rule, drawn rather than re-declared).
 */
import type { SaleItem, SaleItemKind } from "@glampro_suite/shared";

import { Cart, Plus, Search } from "@/components/icons";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { SALE_KIND_LABELS } from "@/constants/sale";
import { formatDuration } from "@/lib/utils";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

export interface SaleItemGridProps {
  /** The tab this grid sits under — for the empty "no rows" sentence. */
  kind: SaleItemKind;
  items: SaleItem[];
  isPending: boolean;
  isError: boolean;
  /** The debounced term, for the "no match" sentence. */
  search: string;
  /** Whether the sale's customer carries a membership reference. */
  isMember: boolean;
  onAdd: (item: SaleItem) => void;
  onRetry: () => void;
  onClearSearch: () => void;
}

export default function SaleItemGrid({
  kind,
  items,
  isPending,
  isError,
  search,
  isMember,
  onAdd,
  onRetry,
  onClearSearch,
}: SaleItemGridProps) {
  const { formatPrice } = useSalonFormatting();
  if (isPending) {
    return (
      <div
        aria-busy
        aria-label={`Loading ${SALE_KIND_LABELS[kind].toLowerCase()}`}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        title={`The ${SALE_KIND_LABELS[kind].toLowerCase()} could not be loaded`}
        description="The till needs the catalogue to ring anything up."
        icon={<Cart />}
        action={<Button onClick={onRetry}>Try again</Button>}
      />
    );
  }

  if (items.length === 0) {
    return search ? (
      <EmptyState
        title="No items match that search"
        description={`Nothing in ${SALE_KIND_LABELS[kind].toLowerCase()} matches “${search}”.`}
        icon={<Search />}
        action={
          <Button variant="secondary" onClick={onClearSearch}>
            Clear search
          </Button>
        }
      />
    ) : (
      <EmptyState
        title={`No ${SALE_KIND_LABELS[kind].toLowerCase()} to sell`}
        description="The catalogue has nothing sellable in this category yet — add it in Products first."
        icon={<Cart />}
      />
    );
  }

  return (
    <ul aria-label={SALE_KIND_LABELS[kind]} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const price = isMember && item.memberPrice !== null ? item.memberPrice : item.price;
        return (
          <li key={`${item.kind}:${item.id}`}>
            <button
              type="button"
              onClick={() => onAdd(item)}
              aria-label={`Add ${item.name} to the cart, ${formatPrice(price)}`}
              className="flex min-h-control w-full flex-col gap-1.5 rounded-card border border-line bg-surface p-4 text-left transition-colors hover:border-purple focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-words font-bold text-ink">{item.name}</span>
                <Plus aria-hidden className="shrink-0 text-base text-purple" />
              </span>

              <span className="flex items-center gap-2 text-sm">
                <span className="font-heavy text-ink">{formatPrice(price)}</span>
                {/* Shown beside, not instead: a walk-in's cashier must see the
                    price they are actually charging. */}
                {!isMember && item.memberPrice !== null && item.memberPrice !== item.price ? (
                  <span className="text-xs text-ink-muted">
                    member {formatPrice(item.memberPrice)}
                  </span>
                ) : null}
              </span>

              <span className="text-xs text-ink-muted">
                <ItemMeta item={item} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The one-line fact that kind actually has. Exhaustive, like the service's kinds. */
function ItemMeta({ item }: { item: SaleItem }) {
  const { formatPrice } = useSalonFormatting();
  switch (item.kind) {
    case "SERVICE":
      return (
        <>
          {formatDuration(item.durationMinutes)}
          {item.points > 0 ? ` · ${item.points} pts` : ""}
        </>
      );
    case "PRODUCT":
      return (
        <span className="inline-flex items-center gap-1.5">
          {item.quantity > 0 ? `${item.quantity} in stock` : "Out of stock"}
          {item.lowStock && item.quantity > 0 ? <Badge variant="warning">Low</Badge> : null}
        </span>
      );
    case "PACKAGE":
      return (
        <>
          {item.sessionCount} {item.sessionCount === 1 ? "session" : "sessions"}
          {item.serviceCount > 0 ? ` · ${item.serviceCount} services` : ""}
        </>
      );
    case "VALUE_PACKAGE":
      return (
        <>
          {formatPrice(item.credit)} credit
          {item.serviceCount > 0 ? ` · ${item.serviceCount} services` : ""}
        </>
      );
    case "GIFT_CARD":
      return <>{item.expiresAt ? "Expires — see card terms" : "Never expires"}</>;
  }
}
