/**
 * CP-007 inventory classification — the pure half of the cutover dry run.
 *
 * It answers one question per legacy row: *could plan payroll pay this month
 * without paying anything twice and without abandoning money someone still owes?*
 * Nothing here reads or writes a database, so the classification is testable
 * without a fixture and the same function serves the dry run, the activation
 * refusal and the operator CLI.
 *
 * Severity follows the answer, not the amount:
 *
 * - `BLOCKER` is a **double payment** (legacy already paid a traceable earning in a
 *   month the plan will pay again), an **abandoned earning** (an unpaid row the plan
 *   cannot re-derive because it names no sale), or an **unsettled clawback**.
 * - `WARNING` is evidence the owner may accept: legacy money that left for an
 *   untraceable row, and unpaid traceable rows the plan simply re-derives.
 *
 * Activation freezes the whole classification into the attested `inventoryHash`, so
 * a warning is acknowledged rather than ignored.
 */
import type {
  PayrollCutoverBucket,
  PayrollCutoverIssue,
  PayrollCutoverMonth,
  PayrollCutoverVerdict,
} from "@glampro_suite/shared";
import { add, exact, fixed, type Exact, ZERO } from "@glampro_suite/shared";

/** One `employee_commissions` row reduced to what classification needs. */
export interface PayrollCutoverLegacyRow {
  id: string;
  staffId: string;
  /** `null` means the earning names no sale, so its source cannot be verified. */
  saleId: string | null;
  /** Salon-local month the earning belongs to, resolved from the sale where one exists. */
  periodKey: string;
  /** Exact stored amount as a decimal string; never a float. */
  amount: string;
  /** `null` means legacy had not paid this row when the inventory was taken. */
  paid: boolean;
  /** `reconciliationRequired`: an unsettled refund clawback. */
  clawback: boolean;
}

export interface PayrollCutoverPayrollMonth {
  periodKey: string;
  status: "OPEN" | "CALCULATED" | "APPROVED";
  payoutConfirmed: boolean;
}

export interface PayrollCutoverClassificationInput {
  /** Salon months to classify, ascending, ending with the current month. */
  periodKeys: readonly string[];
  currentPeriodKey: string;
  /** The stored activation month, or the month a dry run is proposing. */
  effectivePeriodKey: string | null;
  legacy: readonly PayrollCutoverLegacyRow[];
  payroll: readonly PayrollCutoverPayrollMonth[];
}

export interface PayrollCutoverClassification {
  months: PayrollCutoverMonth[];
  issues: PayrollCutoverIssue[];
  totals: {
    months: number;
    coveredMonths: number;
    legacy: {
      total: PayrollCutoverBucket;
      paid: PayrollCutoverBucket;
      unpaid: PayrollCutoverBucket;
      clawback: PayrollCutoverBucket;
      unidentified: PayrollCutoverBucket;
    };
  };
}

interface Acc {
  rows: number;
  amount: Exact;
}
const acc = (): Acc => ({ rows: 0, amount: ZERO });
function into(target: Acc, amount: string): void {
  target.rows += 1;
  target.amount = add(target.amount, exact(amount));
}
const frozen = (value: Acc): PayrollCutoverBucket => ({
  rows: value.rows,
  amount: fixed(value.amount, 2),
});

/** `2026-01` → `2025-12`. Callers only ever pass validated period keys. */
export function previousPeriodKey(periodKey: string): string {
  const [year, month] = periodKey.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

/** `2026-12` → `2027-01`. Callers only ever pass validated period keys. */
export function nextPeriodKey(periodKey: string): string {
  const [year, month] = periodKey.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** The `months` salon months ending with (and including) `currentPeriodKey`, ascending. */
export function payrollCutoverWindow(currentPeriodKey: string, months: number): string[] {
  const keys = [currentPeriodKey];
  while (keys.length < months) keys.unshift(previousPeriodKey(keys[0]));
  return keys;
}

/**
 * Classifies one window of legacy evidence against one candidate activation month.
 * The caller hashes the result; this function only decides verdicts and issues.
 */
export function classifyPayrollCutover(
  input: PayrollCutoverClassificationInput,
): PayrollCutoverClassification {
  const payrollByMonth = new Map(input.payroll.map((row) => [row.periodKey, row]));
  const issues = new Map<string, PayrollCutoverIssue>();

  const flag = (
    code: PayrollCutoverIssue["code"],
    severity: PayrollCutoverIssue["severity"],
    periodKey: string,
    staffId: string | null,
    amount: string,
  ): void => {
    const id = `${code}|${periodKey}|${staffId ?? ""}`;
    const existing = issues.get(id);
    if (existing) {
      issues.set(id, {
        ...existing,
        rows: existing.rows + 1,
        amount: fixed(add(exact(existing.amount), exact(amount)), 2),
      });
      return;
    }
    issues.set(id, {
      code,
      severity,
      periodKey,
      staffId,
      rows: 1,
      amount: fixed(exact(amount), 2),
    });
  };

  if (input.effectivePeriodKey !== null && input.effectivePeriodKey < input.currentPeriodKey)
    // A closed month is history, so no cutover may reach back into one.
    flag(
      "EFFECTIVE_PERIOD_PRECEDES_CURRENT_MONTH",
      "BLOCKER",
      input.effectivePeriodKey,
      null,
      "0.00",
    );

  const months = input.periodKeys.map((periodKey): PayrollCutoverMonth => {
    const covered = input.effectivePeriodKey !== null && periodKey >= input.effectivePeriodKey;
    const total = acc();
    const paid = acc();
    const unpaid = acc();
    const clawback = acc();
    const unidentified = acc();

    for (const row of input.legacy) {
      if (row.periodKey !== periodKey) continue;
      into(total, row.amount);
      if (row.paid) into(paid, row.amount);
      else into(unpaid, row.amount);
      if (row.clawback) into(clawback, row.amount);
      if (row.saleId === null) into(unidentified, row.amount);

      if (row.clawback)
        // Owed back whatever the month: activating over it would forget a debt.
        flag("LEGACY_CLAWBACK_OUTSTANDING", "BLOCKER", periodKey, row.staffId, row.amount);
      else if (covered && row.paid && row.saleId !== null)
        // The plan will pay this same sale again: two payouts, one sale.
        flag("LEGACY_PAYOUT_INSIDE_COVERED_MONTH", "BLOCKER", periodKey, row.staffId, row.amount);
      else if (covered && !row.paid && row.saleId === null)
        // Nothing re-derives it and legacy is about to stop: money silently lost.
        flag("LEGACY_EARNING_WITHOUT_SOURCE", "BLOCKER", periodKey, row.staffId, row.amount);
      else if (covered && !row.paid)
        // Traceable and unpaid: plan payroll re-derives it from the sale.
        flag("LEGACY_EARNING_SUPERSEDED", "WARNING", periodKey, row.staffId, row.amount);
      else if (row.paid && row.saleId === null)
        // Historic money that left without a traceable sale: classified, not blocking.
        flag("LEGACY_WITHOUT_SALE", "WARNING", periodKey, row.staffId, row.amount);
    }

    const verdict: PayrollCutoverVerdict =
      paid.rows > 0
        ? "ALREADY_PAID"
        : clawback.rows > 0 || unidentified.rows > 0
          ? "INCOMPLETE"
          : "RELIABLE";
    const payroll = payrollByMonth.get(periodKey);
    return {
      periodKey,
      verdict,
      covered,
      legacy: {
        total: frozen(total),
        paid: frozen(paid),
        unpaid: frozen(unpaid),
        clawback: frozen(clawback),
        unidentified: frozen(unidentified),
      },
      payroll: {
        status: payroll?.status ?? null,
        payoutConfirmed: payroll?.payoutConfirmed ?? false,
      },
    };
  });

  const sumOf = (pick: (month: PayrollCutoverMonth) => PayrollCutoverBucket) =>
    months.reduce(
      (result, month) => ({
        rows: result.rows + pick(month).rows,
        amount: add(result.amount, exact(pick(month).amount)),
      }),
      acc(),
    );

  return {
    months,
    issues: [...issues.values()].sort(
      (a, b) =>
        a.periodKey.localeCompare(b.periodKey) ||
        a.code.localeCompare(b.code) ||
        (a.staffId ?? "").localeCompare(b.staffId ?? ""),
    ),
    totals: {
      months: months.length,
      coveredMonths: months.filter((month) => month.covered).length,
      legacy: {
        total: frozen(sumOf((month) => month.legacy.total)),
        paid: frozen(sumOf((month) => month.legacy.paid)),
        unpaid: frozen(sumOf((month) => month.legacy.unpaid)),
        clawback: frozen(sumOf((month) => month.legacy.clawback)),
        unidentified: frozen(sumOf((month) => month.legacy.unidentified)),
      },
    },
  };
}

/** The issues that refuse activation, in inventory order. */
export function payrollCutoverBlockers(
  issues: readonly PayrollCutoverIssue[],
): PayrollCutoverIssue[] {
  return issues.filter((issue) => issue.severity === "BLOCKER");
}
