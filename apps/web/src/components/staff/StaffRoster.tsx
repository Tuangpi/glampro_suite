import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createShiftSchema, type ShiftSummary } from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { getErrorMessage, getPaginated, patch, post } from "@/lib/api";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const time = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export default function StaffRoster({ staffId }: { staffId: string }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [day, setDay] = useState("1");
  const [kind, setKind] = useState("WORK");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("18:00");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const key = ["staff-roster", staffId];
  const roster = useQuery({
    queryKey: key,
    queryFn: async () => {
      const rows: ShiftSummary[] = [];
      for (let page = 1; ; page++) {
        const result = await getPaginated<ShiftSummary>("/shifts", {
          userId: staffId,
          page,
          pageSize: 200,
        });
        rows.push(...result.data);
        if (page >= result.pageCount) return rows;
      }
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      const minute = (value: string) => {
        if (!/^\d{2}:\d{2}$/.test(value)) return NaN;
        const [h, m] = value.split(":").map(Number);
        if (h! > 24 || m! > 59 || (h === 24 && m !== 0)) return NaN;
        return h! * 60 + m!;
      };
      const result = createShiftSchema.safeParse({
        userId: staffId,
        dayOfWeek: Number(day),
        kind,
        startsAtMinute: minute(start),
        endsAtMinute: minute(end),
        effectiveFrom: from || undefined,
        effectiveTo: to || null,
      });
      if (!result.success)
        throw new Error(result.error.issues.map((issue) => issue.message).join(" "));
      if (editing)
        return patch(`/shifts/${editing}`, { ...result.data, effectiveFrom: from || null });
      return post("/shifts", result.data);
    },
    onSuccess: () => {
      setEditing(null);
      setError(null);
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (failure) => setError(getErrorMessage(failure)),
  });

  function edit(row: ShiftSummary) {
    setEditing(row.id);
    setDay(String(row.dayOfWeek));
    setKind(row.kind);
    setStart(time(row.startsAtMinute));
    setEnd(time(row.endsAtMinute));
    setFrom(row.effectiveFrom ?? "");
    setTo(row.effectiveTo ?? "");
    setError(null);
  }

  return (
    <section
      aria-label="Working hours"
      className="flex flex-col gap-3 border-t border-line-soft pt-4"
    >
      <h3 className="text-sm font-medium text-ink">Working hours and breaks</h3>
      <p className="text-xs text-ink-muted">
        Recurring salon-local hours. Withdraw a row by setting its effective end date. End related
        breaks before shortening work hours. No roster means unrestricted booking.
      </p>
      {roster.isPending ? (
        <p>Loading working hours…</p>
      ) : roster.isError ? (
        <p role="alert">{getErrorMessage(roster.error)}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {roster.data.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {DAYS[row.dayOfWeek]} {row.kind === "WORK" ? "Work" : "Break"}{" "}
                {time(row.startsAtMinute)}–{time(row.endsAtMinute)} (
                {row.effectiveFrom ?? "Any start"} to {row.effectiveTo ?? "No end"})
              </span>
              <Button type="button" size="sm" variant="secondary" onClick={() => edit(row)}>
                Edit hours
              </Button>
            </li>
          ))}
          {roster.data.length === 0 && <li>No working hours configured.</li>}
        </ul>
      )}
      <Select
        label="Weekday"
        value={day}
        onChange={(event) => setDay(event.target.value)}
        options={DAYS.map((label, value) => ({ label, value: String(value) }))}
      />
      <Select
        label="Interval type"
        value={kind}
        onChange={(event) => setKind(event.target.value)}
        options={[
          { label: "Work", value: "WORK" },
          { label: "Break", value: "BREAK" },
        ]}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Start time (HH:mm)"
          value={start}
          onChange={(event) => setStart(event.target.value)}
          placeholder="09:00"
        />
        <Input
          label="End time (HH:mm, 24:00 allowed)"
          value={end}
          onChange={(event) => setEnd(event.target.value)}
          placeholder="18:00"
        />
        <Input
          label="Effective from"
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <Input
          label="Effective to"
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={save.isPending || roster.isError || roster.isPending}
          onClick={() => save.mutate()}
        >
          {editing ? "Save working hours" : "Add working hours"}
        </Button>
        {editing && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEditing(null);
              setError(null);
            }}
          >
            Cancel hours edit
          </Button>
        )}
      </div>
    </section>
  );
}
