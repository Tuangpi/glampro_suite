/** Focused business reports with one shared salon-local date range. */
import { useMemo, useState } from "react";
import { BarChart } from "@/components/icons";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import Skeleton from "@/components/ui/Skeleton";
import BusinessReportDashboard from "@/components/reports/BusinessReportDashboard";
import { useReportOverview } from "@/hooks/useReports";
import { getErrorMessage } from "@/lib/api";
import { formatDateInputValue } from "@/lib/utils";
import { instantFromSalonDate, toSalonDate } from "@/lib/salon-time";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

type DatePreset = "today" | "week" | "month" | "custom";

function presetDates(timeZone: string, preset: DatePreset = "month") {
  const today = toSalonDate(new Date(), timeZone)!;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (preset === "week") start.setDate(start.getDate() - 6);
  if (preset === "month") start.setDate(1);
  return { from: formatDateInputValue(start), to: formatDateInputValue(today) };
}

function dateParts(value: string): [number, number, number] {
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  return [year, month, day];
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = dateParts(value);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function rangeInstants(from: string, to: string, timeZone: string) {
  const [fromYear, fromMonth, fromDay] = dateParts(from);
  const [toYear, toMonth, toDay] = dateParts(to);
  // Both edges are salon-local calendar dates, not browser-local or UTC days.
  const fromInstant = instantFromSalonDate(new Date(fromYear, fromMonth - 1, fromDay), timeZone);
  const toInstant = instantFromSalonDate(
    new Date(toYear, toMonth - 1, toDay, 23, 59, 59, 999),
    timeZone,
  );
  return { from: fromInstant.toISOString(), to: toInstant.toISOString(), timeZone };
}

export default function Reports() {
  const { timeZone } = useSalonFormatting();
  const [preset, setPreset] = useState<DatePreset>("month");
  const [dates, setDates] = useState(() => presetDates(timeZone));
  const validRange = isValidDate(dates.from) && isValidDate(dates.to) && dates.from <= dates.to;
  const range = useMemo(
    () =>
      validRange ? rangeInstants(dates.from, dates.to, timeZone) : { from: "", to: "", timeZone },
    [dates.from, dates.to, timeZone, validRange],
  );
  const report = useReportOverview(range, validRange);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-xl">Reports</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Appointments, sales, products, services and packages — all in one place.
        </p>
      </header>
      <section
        aria-label="Sales period"
        className="space-y-3 rounded-card border border-line bg-surface p-4"
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label="Date presets">
          {(
            [
              ["today", "Today"],
              ["week", "Last 7 days"],
              ["month", "This month"],
              ["custom", "Custom"],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              variant={preset === id ? "secondary" : "ghost"}
              aria-pressed={preset === id}
              onClick={() => {
                setPreset(id);
                if (id !== "custom") setDates(presetDates(timeZone, id));
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="From"
            type="date"
            value={dates.from}
            max={dates.to}
            fullWidth={false}
            onChange={(event) => {
              setPreset("custom");
              setDates((current) => ({ ...current, from: event.target.value }));
            }}
          />
          <Input
            label="To"
            type="date"
            value={dates.to}
            min={dates.from}
            fullWidth={false}
            onChange={(event) => {
              setPreset("custom");
              setDates((current) => ({ ...current, to: event.target.value }));
            }}
          />
          <p className="pb-3 text-xs text-ink-muted">Sales period · {timeZone}</p>
        </div>
      </section>
      {!validRange ? (
        <p
          role="alert"
          className="rounded-card border border-line bg-surface p-4 text-sm text-danger-text"
        >
          Choose valid From and To dates. From must be on or before To.
        </p>
      ) : report.isPending ? (
        <div role="status" aria-label="Loading report" className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      ) : report.isError ? (
        <EmptyState
          title="The report could not be loaded"
          description={getErrorMessage(report.error)}
          icon={<BarChart />}
        />
      ) : report.data ? (
        <BusinessReportDashboard data={report.data} />
      ) : null}
    </div>
  );
}
