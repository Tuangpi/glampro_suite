/**
 * The Subscription tab of a company: what is paid for now, the form that records
 * one manual period, and the periods already recorded.
 *
 * Three questions, in the order an operator asks them:
 *
 * 1. **Until when is this company paid for?** The summary card answers it from the
 *    periods the server already returns, instead of leaving the operator to compare
 *    two ISO instants in a table and work out which row is the live one.
 * 2. **Record the next period.** The form is its own card with its own reason. It
 *    used to share one "Change reason" field with the lifecycle buttons above it,
 *    which read as if the reason belonged to suspending the company.
 * 3. **What was recorded before?** The history renders days and money rather than
 *    `2026-11-01T00:00:00+08:00`, and marks the row that is running now.
 *
 * **A period may start on any day.** The API used to refuse a start in the future,
 * which made the one thing an operator does on renewal — schedule next month —
 * impossible; today only an end that has already passed is refused. A scheduled
 * period does not bring access forward, though: `resolveTenantStatus` counts only
 * periods that have started, so the company keeps its present status until the
 * period's first day, and "Reactivate" still requires a *current* period.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import type { CompanyAdministration } from "@glampro_suite/shared";
import { recordSubscriptionSchema } from "@glampro_suite/shared";

import Badge, { type BadgeVariant } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import Table, { type TableColumn } from "@/components/ui/Table";
import { dayToLocalInstant, formatDate, formatDateInputValue, formatPrice } from "@/lib/utils";
import { platformApi } from "./api";

type Period = CompanyAdministration["subscriptions"][number];
type EffectiveStatus = CompanyAdministration["effectiveStatus"];

const DAY_MS = 24 * 60 * 60 * 1000;

/** One tone per meaning, so a colour never says two different things on this tab. */
const STATUS_TONE: Record<Period["status"], BadgeVariant> = {
  ACTIVE: "success",
  PENDING: "warning",
  EXPIRED: "danger",
  CANCELLED: "neutral",
};

const EFFECTIVE_TONE: Record<EffectiveStatus, BadgeVariant> = {
  ACTIVE: "success",
  SUSPENDED: "warning",
  EXPIRED: "danger",
  CANCELLED: "neutral",
};

/**
 * The enum as a word. `ACTIVE` in a badge is a database value read aloud; "Active"
 * is what the rest of this screen's badges say ("Enabled", "Expired", "Core").
 */
const STATUS_LABEL: Record<Period["status"], string> = {
  ACTIVE: "Active",
  PENDING: "Pending",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

const EFFECTIVE_LABEL: Record<EffectiveStatus, string> = {
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

/**
 * `min` for a period end. Both boundaries are stored at midnight, so an end of
 * "today" has already passed and tomorrow is the earliest day the API accepts.
 */
function tomorrowInputValue(now: number): string {
  return formatDateInputValue(new Date(now + DAY_MS));
}

/** The end also has to be later than the start, so its floor follows the picked start. */
function endFloor(now: number, startDay: string): string {
  const tomorrow = tomorrowInputValue(now);
  const start = dayToLocalInstant(startDay);
  if (!start) return tomorrow;
  const nextDay = formatDateInputValue(new Date(new Date(start).getTime() + DAY_MS));
  return nextDay > tomorrow ? nextDay : tomorrow;
}

type Phase = "current" | "upcoming" | "past";

/** Mirrors `resolveTenantStatus`: a period counts once its first day has arrived. */
function phaseOf(row: Period, now: number): Phase {
  if (new Date(row.startDate).getTime() > now) return "upcoming";
  return new Date(row.endDate).getTime() > now ? "current" : "past";
}

/** "20 days" / "1 day" — the answer an operator reads, not a timestamp to subtract. */
function daysUntil(now: number, value: string): string {
  const count = Math.max(0, Math.ceil((new Date(value).getTime() - now) / DAY_MS));
  return count === 1 ? "1 day" : `${count} days`;
}

/** The period that is running now, if any: the latest end among the ones that have started. */
function runningPeriod(rows: Period[], now: number): Period | undefined {
  return rows
    .filter((row) => row.status === "ACTIVE" || row.status === "EXPIRED")
    .filter((row) => phaseOf(row, now) === "current")
    .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime())[0];
}

/** The earliest period that has been recorded but has not started yet. */
function scheduledPeriod(rows: Period[], now: number): Period | undefined {
  return rows
    .filter((row) => row.status === "ACTIVE" && phaseOf(row, now) === "upcoming")
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())[0];
}

function periodColumns(now: number): TableColumn<Period>[] {
  return [
    {
      key: "period",
      header: "Period",
      cell: (row) => {
        const phase = phaseOf(row, now);
        return (
          <div className="flex flex-col items-start gap-1">
            <span className="font-medium text-ink">
              {formatDate(row.startDate)} → {formatDate(row.endDate)}
            </span>
            {row.status === "ACTIVE" && phase === "current" ? (
              <Badge variant="success" dot>
                Current
              </Badge>
            ) : null}
            {row.status === "ACTIVE" && phase === "upcoming" ? (
              <Badge variant="warning" dot>
                Scheduled
              </Badge>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (row) => formatPrice(row.amount, row.currency),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <Badge variant={STATUS_TONE[row.status]} dot>
          {STATUS_LABEL[row.status]}
        </Badge>
      ),
    },
  ];
}

/** One label/value pair of the summary. Matches the Overview tab's `dt`/`dd`. */
function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-sm break-words text-ink">{value}</dd>
    </div>
  );
}

export interface SubscriptionPanelProps {
  companyId: string;
  effectiveStatus: EffectiveStatus;
  subscriptions: Period[];
  /** Re-read the company once a period has been recorded. */
  onRecorded: () => Promise<void>;
  /** Mirrors the parent's global "a write is in flight" signal. */
  onBusyChange?: (busy: boolean) => void;
}

export default function SubscriptionPanel({
  companyId,
  effectiveStatus,
  subscriptions,
  onRecorded,
  onBusyChange,
}: SubscriptionPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState("");
  /** What the start picker holds: the end's earliest day is derived from it. */
  const [startDay, setStartDay] = useState("");

  // `useState`'s initializer is the one place a component may read the clock: the
  // purity rule forbids `Date.now()` during render, and how long a period has left
  // does not need to tick while the tab is open.
  const [now] = useState(() => Date.now());
  const running = runningPeriod(subscriptions, now);
  const scheduled = scheduledPeriod(subscriptions, now);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    setNotice("");
    try {
      // The picker knows a day; the API stores an instant. Each boundary is that
      // day at midnight in the operator's own timezone, so the day never shifts.
      const startDate = dayToLocalInstant(String(values.get("startDate") ?? ""));
      const endDate = dayToLocalInstant(String(values.get("endDate") ?? ""));
      if (!startDate) throw new Error("Choose a valid period start date.");
      if (!endDate) throw new Error("Choose a valid period end date.");
      // `minLength` counts spaces and `reasonSchema` trims, so "   " reaches here.
      if (reason.trim().length < 3)
        throw new Error("Say why this period is being recorded — at least 3 characters.");
      const input = recordSubscriptionSchema.safeParse({
        startDate,
        endDate,
        amount: values.get("amount"),
        currency: values.get("currency"),
        reason,
      });
      if (!input.success) throw new Error(input.error.issues[0].message);
      await platformApi.recordSubscription(companyId, input.data);
      // Only after the server accepted it: a rejected period keeps its days.
      form.reset();
      setStartDay("");
      setReason("");
      setNotice("Subscription period recorded.");
      await onRecorded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to record this period.");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Current subscription"
        description={
          <span className="flex flex-wrap items-center gap-2">
            Effective status
            <Badge variant={EFFECTIVE_TONE[effectiveStatus]} dot>
              {EFFECTIVE_LABEL[effectiveStatus]}
            </Badge>
          </span>
        }
      >
        {running ? (
          <div className="flex flex-col gap-3 px-2 pt-2 pb-1">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Access from" value={formatDate(running.startDate)} />
              <Fact label="Access until" value={formatDate(running.endDate)} />
              <Fact label="Amount" value={formatPrice(running.amount, running.currency)} />
              <Fact label="Time left" value={daysUntil(now, running.endDate)} />
            </dl>
            {scheduled ? (
              <p className="text-sm text-ink-body">
                Next period starts {formatDate(scheduled.startDate)}, in{" "}
                {daysUntil(now, scheduled.startDate)}.
              </p>
            ) : null}
          </div>
        ) : scheduled ? (
          <div className="flex flex-col gap-3 px-2 pt-2 pb-1">
            <p className="text-sm text-ink-body">
              No period is running now. The next one starts {formatDate(scheduled.startDate)}, in{" "}
              {daysUntil(now, scheduled.startDate)} — a period brings no access forward until its
              first day, so the company keeps its present status until then.
            </p>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <Fact label="Access from" value={formatDate(scheduled.startDate)} />
              <Fact label="Access until" value={formatDate(scheduled.endDate)} />
              <Fact label="Amount" value={formatPrice(scheduled.amount, scheduled.currency)} />
            </dl>
          </div>
        ) : (
          <p className="px-2 pt-2 pb-1 text-sm text-ink-body">
            No subscription period recorded. Until one is added below, the company has no dated
            access window.
          </p>
        )}
      </Card>

      <Card
        title="Record a subscription period"
        description="Manual record only — nothing is charged or captured."
      >
        <form className="flex flex-col gap-4 px-2 pt-2 pb-1" onSubmit={submit}>
          <p className="text-sm text-ink-body">
            Pick the first and last day of the period. Both are recorded at midnight in your own
            timezone, and periods cannot overlap.
          </p>

          {error ? (
            <p role="alert" className="rounded-md bg-danger/5 px-3 py-2.5 text-sm text-danger">
              {error}
            </p>
          ) : null}

          {notice ? (
            <p
              role="status"
              className="rounded-md bg-success-soft px-3 py-2.5 text-sm text-success-text"
            >
              {notice}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              name="startDate"
              label="Period start"
              type="date"
              onChange={(event) => setStartDay(event.target.value)}
              disabled={busy}
              required
              hint="Any day. A future day schedules the next period; a past day backfills one."
            />
            <Input
              name="endDate"
              label="Period end"
              type="date"
              min={endFloor(now, startDay)}
              disabled={busy}
              required
              hint="A later day than the start, and a day that has not already passed."
            />
            <Input
              name="amount"
              label="Subscription amount"
              pattern="(?:0|[1-9][0-9]{0,9})\.[0-9]{2}"
              placeholder="99.00"
              disabled={busy}
              required
            />
            <Input
              name="currency"
              label="Currency"
              defaultValue="SGD"
              placeholder="SGD"
              pattern="[A-Z]{3}"
              disabled={busy}
              required
            />
          </div>

          <Input
            label="Reason for this period"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={3}
            maxLength={500}
            required
            disabled={busy}
            placeholder="Explain why this period is being recorded"
            hint="Required for the audit log. Stored with the period, not with the company."
          />

          <div>
            <Button type="submit" loading={busy}>
              Record subscription
            </Button>
          </div>
        </form>
      </Card>

      <Card
        title="Subscription history"
        description="The most recent 100 periods, latest end date first."
        flush
      >
        <Table
          caption="Subscription periods"
          rows={subscriptions}
          rowKey={(row) => row.id}
          columns={periodColumns(now)}
          empty={
            <EmptyState
              title="No subscription periods recorded."
              description="Record one above so the company's access has a date range."
            />
          }
        />
      </Card>
    </div>
  );
}
