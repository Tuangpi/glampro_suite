/**
 * What one session of a package is worth, read live off the form (spec v0.9 **N5**).
 *
 * Read-only by construction: it takes the numbers already typed into the drawer and
 * says what payroll will make of them, so a manager can see the consequence of a
 * price and a session count before the bundle is published. It writes nothing and it
 * is not a second source of truth — the sale's own line and the stored snapshot still
 * decide what a redemption is worth (`lib/package-session-value.ts` mirrors that
 * arithmetic exactly, and says where it cannot).
 *
 * The commission half states what this package's settings *do* — a fixed amount, the
 * plan, or nothing — rather than a money figure. A real estimate needs a plan rate and
 * a performing therapist, neither of which a package has; guessing one here would put
 * a number in front of a manager that the close could contradict.
 */
import { GST_RATE_PERCENT } from "@glampro_suite/shared";

import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { centsToPrice } from "@/lib/money";
import { packageSessionValue, type PackageSessionValue } from "@/lib/package-session-value";

/** The commission halves of the form, as typed. */
export interface PackageCommissionDraft {
  saleMode: string;
  saleFixed: string;
  redemptionMode: string;
  redemptionFixed: string;
}

export interface PackageSessionValuePreviewProps {
  sessions: string;
  memberPrice: string;
  nonmemberPrice: string;
  /** `null` for a reader who cannot see commission settings; the value still shows. */
  commission: PackageCommissionDraft | null;
}

/**
 * A four-decimal amount, in the salon's currency.
 *
 * `formatPrice` rounds to the cent, which is right for money a customer pays and
 * wrong for a session value — S$18.3480 and S$18.3520 are different figures to the
 * person checking a reconciliation. The last two digits are printed as stored.
 */
function SessionValue({ value }: { value: string }) {
  const [whole, fraction = ""] = value.split(".");
  const { formatPrice } = useSalonFormatting();
  return (
    <>
      {formatPrice(`${whole}.${fraction.slice(0, 2)}`)}
      <span>{fraction.slice(2)}</span>
    </>
  );
}

function PriceRow({
  label,
  price,
  sessions,
  value,
}: {
  label: string;
  price: string;
  sessions: number;
  value: PackageSessionValue | null;
}) {
  const { formatPrice } = useSalonFormatting();

  if (value === null) {
    return (
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <dt className="text-ink-body">{label}</dt>
        <dd className="text-ink-muted">Enter a price</dd>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <dt className="text-ink-body">{label}</dt>
        <dd className="font-bold text-ink">
          <SessionValue value={value.sessionValue} /> a session
        </dd>
      </div>
      <p className="text-xs text-ink-muted">
        {formatPrice(price)}
        {value.taxCents > 0
          ? ` includes ${formatPrice(centsToPrice(value.taxCents))} GST, so ${formatPrice(
              centsToPrice(value.netCents),
            )}`
          : ""}{" "}
        ÷ {sessions} {sessions === 1 ? "session" : "sessions"}, floored to four decimals.
        {value.residualSessions > 0
          ? ` The earliest ${value.residualSessions} ${
              value.residualSessions === 1 ? "session holds" : "sessions hold"
            } one extra S$0.0001 so the grant reconciles.`
          : ""}
      </p>
    </div>
  );
}

/** A fixed amount, or a nudge when the box is still empty. */
function fixedAmount(raw: string, formatPrice: (value: string | number) => string): string {
  const amount = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(amount))
    return "A fixed amount — enter it under commission settings.";
  return formatPrice(raw);
}

function saleLine(
  draft: PackageCommissionDraft,
  formatPrice: (value: string | number) => string,
): string {
  switch (draft.saleMode) {
    case "FIXED":
      return `A fixed ${fixedAmount(
        draft.saleFixed,
        formatPrice,
      )} for the sale, split between the sellers.`;
    case "FOLLOW_PLAN":
      return "The plan's package-sale rate, on what the sale collects.";
    case "EXCLUDE":
      return "No commission on the sale.";
    default:
      return "No explicit setting — the plan applies to new purchases until one is saved.";
  }
}

function redemptionLine(
  draft: PackageCommissionDraft,
  formatPrice: (value: string | number) => string,
): string {
  switch (draft.redemptionMode) {
    case "FIXED":
      return `A fixed ${fixedAmount(
        draft.redemptionFixed,
        formatPrice,
      )} for each session used, split between the performing staff.`;
    case "FOLLOW_PLAN":
      return "The plan's redemption rate, on the session value above.";
    case "EXCLUDE":
      return "No commission for the sessions used.";
    default:
      return "No explicit setting — the plan applies to new purchases until one is saved.";
  }
}

export default function PackageSessionValuePreview({
  sessions,
  memberPrice,
  nonmemberPrice,
  commission,
}: PackageSessionValuePreviewProps) {
  const { formatPrice, gstEnabled } = useSalonFormatting();
  const typed = Number(sessions);
  const count = Number.isSafeInteger(typed) && typed > 0 ? typed : null;
  const member = count === null ? null : packageSessionValue(memberPrice, count, gstEnabled);
  const nonmember = count === null ? null : packageSessionValue(nonmemberPrice, count, gstEnabled);

  return (
    <fieldset className="flex flex-col gap-3 rounded-card border border-line p-4">
      <legend className="px-1 text-sm font-bold text-ink">What one session is worth</legend>

      {count === null ? (
        <p className="text-sm text-ink-muted">
          {sessions.trim() === "0"
            ? "A package with no sessions has no session value to pay commission on."
            : "Enter how many sessions the bundle holds to see what one of them is worth."}
        </p>
      ) : (
        <dl className="flex flex-col gap-2 text-sm">
          <PriceRow label="Member price" price={memberPrice} sessions={count} value={member} />
          <PriceRow
            label="Non-member price"
            price={nonmemberPrice}
            sessions={count}
            value={nonmember}
          />
        </dl>
      )}

      <p className="text-xs text-ink-muted">
        {gstEnabled
          ? `GST of ${GST_RATE_PERCENT}% is backed out of the price before the division, exactly as the receipt does it.`
          : "This salon is not GST-registered, so the whole price counts as commissionable value."}{" "}
        A voucher or discount at the till changes the price it is worked out from.
      </p>

      {commission === null ? null : (
        <dl aria-label="Commission preview" className="flex flex-col gap-1 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <dt className="text-ink-body">Package sale</dt>
            <dd className="text-right text-ink">{saleLine(commission, formatPrice)}</dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <dt className="text-ink-body">Each redemption</dt>
            <dd className="text-right text-ink">{redemptionLine(commission, formatPrice)}</dd>
          </div>
        </dl>
      )}
    </fieldset>
  );
}
