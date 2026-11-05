/**
 * The Subscription tab of a company: one card that answers "paid until when?",
 * one modal that records the next period, and the periods already recorded
 * behind a disclosure.
 *
 * The tab used to be three stacked cards plus a lifecycle card, and it made an
 * operator do the work: compare two ISO instants in a table, work out which row
 * was live, and find the one card out of four that actually wrote. It now reads
 * in the order the questions are asked:
 *
 * 1. **Plan** — the status, the two boundaries, the time left and the amount.
 *    Only what "paid until when?" needs.
 * 2. **Record period** — behind one button, in a modal with its own reason field.
 *    It used to share the section's single "Change reason" input with the
 *    lifecycle buttons, which read as if a renewal's reason belonged to
 *    suspending the company.
 * 3. **History** — a `<details>` disclosure, because "what was recorded before?"
 *    is the occasional question, not the daily one.
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
import Modal from "@/components/ui/Modal";
import Table, { type TableColumn } from "@/components/ui/Table";
import { dayToLocalInstant, formatDate, formatDateInputValue, formatPrice } from "@/lib/utils";
import { platformApi } from "./api";
import {
  TENANT_STATUS_LABEL,
  TENANT_STATUS_TONE,
  runningPeriod,
  type TenantStatus,
} from "./tenantStatus";

type Period = CompanyAdministration["subscriptions"][number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** One tone per meaning, so a colour never says two different things on this tab. */
const STATUS_TONE: Record<Period["status"], BadgeVariant> = {
  ACTIVE: "success",
  PENDING: "warning",
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
  effectiveStatus: TenantStatus;
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
  /** The record form lives in a modal; the card keeps one button. */
  const [formOpen, setFormOpen] = useState(false);

  // `useState`'s initializer is the one place a component may read the clock: the
  // purity rule forbids `Date.now()` during render, and how long a period has left
  // does not need to tick while the tab is open.
  const [now] = useState(() => Date.now());
  const running = runningPeriod(subscriptions, now);
  const scheduled = scheduledPeriod(subscriptions, now);

  /**
   * Open the record form.
   *
   * A previous failure is cleared first: that alert belongs to the attempt that
   * caused it, and re-opening the form is a new attempt.
   */
  function openForm() {
    setError("");
    setFormOpen(true);
  }

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
      // Closed only after the server accepted it: a rejected period keeps the
      // form open with the days the operator picked.
      setFormOpen(false);
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
        title="Plan"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={TENANT_STATUS_TONE[effectiveStatus]} dot>
              {TENANT_STATUS_LABEL[effectiveStatus]}
            </Badge>
            <span>
              {subscriptions.length === 0
                ? "No period recorded"
                : `${subscriptions.length} period${subscriptions.length === 1 ? "" : "s"} recorded`}
            </span>
          </span>
        }
        actions={
          <Button variant="secondary" disabled={busy} onClick={openForm}>
            Record period
          </Button>
        }
      >
        {/* A recorded period is reported here rather than in the form it just
            closed: the card is what the operator is left looking at. */}
        {notice ? (
          <p
            role="status"
            className="mx-2 mt-2 rounded-md bg-success-soft px-3 py-2 text-sm text-success-text"
          >
            {notice}
          </p>
        ) : null}
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
            No subscription period recorded, so the company has no dated access window. Use{" "}
            <span className="font-bold text-ink">Record period</span> to give it one.
          </p>
        )}
      </Card>

      {/* The form is a modal, not a card: recording a period is an occasional
          decision, and a permanently open form made the tab look like a settings
          page with two summaries bolted on. */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Record a subscription period"
        description="Manual record only — nothing is charged or captured."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="record-subscription-form" loading={busy}>
              Record subscription
            </Button>
          </div>
        }
      >
        <form id="record-subscription-form" className="flex flex-col gap-4" onSubmit={submit}>
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
        </form>
      </Modal>

      {/* Behind a disclosure: the history is read when something needs checking,
          not on every visit, and a 100-row table pushed the one card that matters
          off the screen. The summary carries the count so a closed disclosure
          still answers "is there any history?". */}
      <Card flush>
        <details className="group">
          <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4">
            <span className="text-base font-heavy text-ink">Subscription history</span>
            <span className="text-sm text-ink-muted">
              {subscriptions.length === 0
                ? "Nothing recorded"
                : `${subscriptions.length} period${subscriptions.length === 1 ? "" : "s"}, latest end first`}
            </span>
          </summary>
          <Table
            caption="Subscription periods"
            rows={subscriptions}
            rowKey={(row) => row.id}
            columns={periodColumns(now)}
            empty={
              <EmptyState
                title="No subscription periods recorded."
                description="Record one so the company's access has a date range."
              />
            }
          />
        </details>
      </Card>
    </div>
  );
}
