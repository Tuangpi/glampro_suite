/**
 * A staff member's rota — the availability section of `/staff/:id`.
 *
 * The section is a **list first**: the hours this person actually works, grouped by
 * weekday, with one button that reveals the form. The old shape kept six controls
 * permanently on screen, so the section read as a form that happened to have a list
 * above it, and the same controls served "add" and "edit" without saying which.
 *
 * What this component deliberately does not do:
 *
 * - **It does not repeat the page's heading.** `/staff/:id` already prints "Working
 *   hours" and the section description above every section (`StaffProfile.tsx`), so a
 *   second `<h3>` here was the third copy of the same sentence.
 * - **It does not decide who may write.** `canEdit` is the page's `canManage &&
 *   !isReadOnly`, the same pair `requireRole` enforces; hiding the buttons is a
 *   convenience, the API is the boundary. A stylist or a suspended salon reads.
 * - **It does not offer a delete.** `PATCH /shifts/:id` has no `DELETE` beside it on
 *   purpose: a shift is withdrawn by ending its window, because a booking made under
 *   last month's rota has to keep meaning what it meant. "End after today" writes
 *   today's salon date into `effectiveTo`, which — the window being inclusive — stops
 *   the row applying from tomorrow while leaving today's rota intact.
 * - **It does not re-word the contract.** Ordering, the midnight bound (`1440`) and the
 *   effective-window rule all come from `createShiftSchema`; a break that does not sit
 *   inside that day's work hours is refused by the service (`BREAK_OUTSIDE_SHIFT`) and
 *   its message is shown rather than paraphrased.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createShiftSchema,
  type CreateShiftInput,
  type ShiftKindValue,
  type ShiftSummary,
} from "@glampro_suite/shared";

import { Plus } from "@/components/icons";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Checkbox from "@/components/ui/Checkbox";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Skeleton from "@/components/ui/Skeleton";
import { showToast } from "@/components/ui/toast-store";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { getErrorMessage, getPaginated, getValidationDetails, patch, post } from "@/lib/api";
import { toSalonDate } from "@/lib/salon-time";
import { formatDateInputValue } from "@/lib/utils";

/** `dayOfWeek` is `0 = Sunday` in the API, so these labels index straight into it. */
const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Reading order, Monday first. The stored value keeps `0 = Sunday` because it mirrors
 * `Date#getDay()`; the shared schema records that Monday-first is a presentation order
 * the client applies, not a different numbering.
 */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** `startsAtMinute`/`endsAtMinute` are minutes past local midnight, 24:00 included. */
const END_OF_DAY = 24 * 60;

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

/** `540` → `09:00`, `1440` → `24:00`. */
function clockLabel(minutes: number): string {
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  return `${hours}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The minutes an `<input type="time">` value stands for, or `null` if it is not a time. */
function minuteOf(value: string): number | null {
  if (!/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours! > 23 || minutes! > 59) return null;
  return hours! * 60 + minutes!;
}

interface Draft {
  day: string;
  kind: ShiftKindValue;
  start: string;
  end: string;
  /** `1440` is legal and a time picker cannot express it, so it is its own control. */
  endsAtMidnight: boolean;
  from: string;
  to: string;
}

function blankDraft(): Draft {
  return {
    day: "1",
    kind: "WORK",
    start: "09:00",
    end: "18:00",
    endsAtMidnight: false,
    from: "",
    to: "",
  };
}

function draftOf(row: ShiftSummary): Draft {
  const endsAtMidnight = row.endsAtMinute >= END_OF_DAY;
  return {
    day: String(row.dayOfWeek),
    kind: row.kind,
    start: clockLabel(row.startsAtMinute),
    end: endsAtMidnight ? "00:00" : clockLabel(row.endsAtMinute),
    endsAtMidnight,
    from: row.effectiveFrom ?? "",
    to: row.effectiveTo ?? "",
  };
}

/** Work rows first, then their breaks, each in clock order. */
function inReadingOrder(rows: ShiftSummary[]): ShiftSummary[] {
  return [...rows].sort((left, right) =>
    left.kind === right.kind
      ? left.startsAtMinute - right.startsAtMinute
      : left.kind === "WORK"
        ? -1
        : 1,
  );
}

/**
 * Today's calendar date in the salon's zone, not the browser's — the same rule the
 * calendar follows (`lib/salon-time`), so a manager working from another country ends a
 * rota on the day the salon means.
 */
function salonToday(timeZone: string): string {
  const today = toSalonDate(new Date(), timeZone);
  return formatDateInputValue(today ?? new Date());
}

export default function StaffRoster({ staffId, canEdit }: { staffId: string; canEdit: boolean }) {
  const client = useQueryClient();
  const { formatDate, timeZone } = useSalonFormatting();
  const [editor, setEditor] = useState<{ row: ShiftSummary | null } | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [windowOpen, setWindowOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  /** The row under edit, or `null` while adding — read by the form's own chrome. */
  const editingRow = editor?.row ?? null;
  /**
   * The editor sits above the list, so opening it from a row near the bottom would
   * otherwise leave the form off screen; focus would also stay on a button that is now
   * below the field it revealed. `scrollIntoView` does not exist in jsdom, hence the
   * guard rather than a bare call.
   */
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    if (typeof form.scrollIntoView === "function") form.scrollIntoView({ block: "nearest" });
    form.focus({ preventScroll: true });
  }, [editor]);

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

  /** The API prefixes paths with the request part; a form only knows field names. */
  const fieldError = (field: string): string | undefined =>
    fieldErrors[field] ?? fieldErrors[`body.${field}`];

  function openEditor(row: ShiftSummary | null) {
    setEditor({ row });
    setDraft(row ? draftOf(row) : blankDraft());
    setWindowOpen(Boolean(row?.effectiveFrom || row?.effectiveTo));
    setFieldErrors({});
    setFormError(null);
  }

  function closeEditor() {
    setEditor(null);
    setFieldErrors({});
    setFormError(null);
  }

  function setField<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((previous) => ({ ...previous, [field]: value }));
  }

  function failed(error: unknown) {
    const details = getValidationDetails(error);
    if (Object.keys(details).length > 0) {
      setFieldErrors(details);
      return;
    }
    setFormError(getErrorMessage(error));
  }

  const save = useMutation({
    mutationFn: async (input: CreateShiftInput) => {
      const target = editor?.row;
      if (!target) return post("/shifts", input);
      // Only the fields a rota row may change. The old shape spread the whole parsed
      // create payload back at PATCH, re-sending `userId` on a path that cannot move a
      // row between people anyway.
      return patch(`/shifts/${target.id}`, {
        dayOfWeek: input.dayOfWeek,
        kind: input.kind,
        startsAtMinute: input.startsAtMinute,
        endsAtMinute: input.endsAtMinute,
        effectiveFrom: input.effectiveFrom ?? null,
        effectiveTo: input.effectiveTo ?? null,
      });
    },
    onSuccess: () => {
      showToast("success", editor?.row ? "Working hours updated." : "Working hours added.");
      closeEditor();
      void client.invalidateQueries({ queryKey: key });
    },
    onError: failed,
  });

  const stop = useMutation({
    mutationFn: (row: ShiftSummary) =>
      // The window is inclusive, so "today" keeps today's rota and ends it tomorrow.
      patch(`/shifts/${row.id}`, { effectiveTo: salonToday(timeZone) }),
    onSuccess: () => {
      showToast("success", "These hours now end after today.");
      closeEditor();
      void client.invalidateQueries({ queryKey: key });
    },
    onError: failed,
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);

    const startsAtMinute = minuteOf(draft.start);
    const endsAtMinute = draft.endsAtMidnight ? END_OF_DAY : minuteOf(draft.end);
    const errors: Record<string, string> = {};
    if (startsAtMinute === null) errors.startsAtMinute = "Choose a start time, such as 09:00.";
    if (endsAtMinute === null)
      errors.endsAtMinute = "Choose an end time, or tick “Ends at midnight”.";
    if (startsAtMinute === null || endsAtMinute === null) {
      setFieldErrors(errors);
      return;
    }

    // Ordering and the effective-window rule are the contract's, not this form's.
    const parsed = createShiftSchema.safeParse({
      userId: staffId,
      dayOfWeek: Number(draft.day),
      kind: draft.kind,
      startsAtMinute,
      endsAtMinute,
      effectiveFrom: draft.from || undefined,
      effectiveTo: draft.to || null,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "");
        errors[field] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    save.mutate(parsed.data);
  }

  const rows = roster.data ?? [];
  const byDay = new Map<number, ShiftSummary[]>();
  for (const row of rows) byDay.set(row.dayOfWeek, [...(byDay.get(row.dayOfWeek) ?? []), row]);

  function windowLabel(row: ShiftSummary): string | null {
    const from = row.effectiveFrom ? formatDate(row.effectiveFrom, DATE_OPTIONS) : null;
    const to = row.effectiveTo ? formatDate(row.effectiveTo, DATE_OPTIONS) : null;
    if (from && to) return `${from} – ${to}`;
    if (from) return `from ${from}`;
    if (to) return `until ${to}`;
    return null;
  }

  // A `Card`, like every other section of this page: the roster used to paint straight
  // onto the page background, which made the form look like it was floating. Unnamed on
  // purpose — the page's own `<h3>` already names this section, and a second landmark
  // with the same words only makes the page harder to navigate.
  return (
    <Card flush className="gap-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="max-w-prose text-xs text-ink-muted">
          Salon time. A break has to sit inside that day’s working hours.
        </p>
        {canEdit && (
          <Button type="button" size="sm" onClick={() => openEditor(null)}>
            <Plus className="text-base" />
            Add working hours
          </Button>
        )}
      </div>

      {/* Directly under the control that opens it, and above the list it rewrites: a form
          appended after a long rota was behind a scroll. Opened from a row near the
          bottom, the focus and the scroll-into-view in the effect above bring the eye
          back up to it. */}
      {editor && (
        <form
          key={editingRow?.id ?? "new"}
          ref={formRef}
          tabIndex={-1}
          onSubmit={submit}
          noValidate
          aria-labelledby="staff-roster-editor-title"
          className="flex flex-col gap-3 border-t border-line-soft bg-surface-muted px-4 py-4"
        >
          <h4 id="staff-roster-editor-title" className="text-sm font-medium text-ink">
            {editingRow ? "Edit working hours" : "Add working hours"}
          </h4>
          <fieldset disabled={save.isPending} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Weekday"
                value={draft.day}
                onChange={(event) => setField("day", event.target.value)}
                options={WEEK_ORDER.map((day) => ({
                  label: DAY_LABELS[day]!,
                  value: String(day),
                }))}
              />
              <Select
                label="Type"
                value={draft.kind}
                onChange={(event) => setField("kind", event.target.value as ShiftKindValue)}
                options={[
                  { label: "Working hours", value: "WORK" },
                  { label: "Break", value: "BREAK" },
                ]}
                hint={
                  draft.kind === "BREAK"
                    ? "A break has to sit inside that day’s working hours."
                    : undefined
                }
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Start time"
                type="time"
                value={draft.start}
                onChange={(event) => setField("start", event.target.value)}
                error={fieldError("startsAtMinute")}
              />
              <Input
                label="End time"
                type="time"
                value={draft.end}
                onChange={(event) => setField("end", event.target.value)}
                disabled={draft.endsAtMidnight}
                error={fieldError("endsAtMinute")}
              />
            </div>

            <Checkbox
              label="Ends at midnight"
              hint="The same as 24:00 — a time picker cannot show it."
              checked={draft.endsAtMidnight}
              onChange={(event) => setField("endsAtMidnight", event.target.checked)}
            />

            <details
              open={windowOpen}
              onToggle={(event) => setWindowOpen(event.currentTarget.open)}
              className="rounded-md border border-line-soft px-3"
            >
              <summary className="min-h-control cursor-pointer py-2 text-sm text-ink-body">
                Change only part of the year (optional)
              </summary>
              <div className="grid gap-3 pb-3 sm:grid-cols-2">
                <Input
                  label="Effective from"
                  type="date"
                  value={draft.from}
                  onChange={(event) => setField("from", event.target.value)}
                />
                <Input
                  label="Effective to"
                  type="date"
                  value={draft.to}
                  onChange={(event) => setField("to", event.target.value)}
                  error={fieldError("effectiveTo")}
                />
              </div>
              <p className="pb-3 text-xs text-ink-muted">
                Leave both blank to apply every week. An end date withdraws these hours from that
                day onwards, which is how a rota is retired — there is no delete.
              </p>
            </details>

            {formError && (
              <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
                {formError}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              {editingRow?.kind === "WORK" && !editingRow.effectiveTo ? (
                <div className="flex flex-col gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    loading={stop.isPending}
                    onClick={() => stop.mutate(editingRow)}
                  >
                    End after today
                  </Button>
                  <span className="text-xs text-ink-muted">
                    Makes today the last day these hours apply.
                  </span>
                </div>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={closeEditor}>
                  Cancel
                </Button>
                <Button type="submit" loading={save.isPending}>
                  Save hours
                </Button>
              </div>
            </div>
          </fieldset>
        </form>
      )}

      <div className="border-t border-line-soft px-4 py-3">
        {roster.isPending ? (
          // Rows shaped like the list that is coming, so the section does not jump when
          // the rota lands.
          <div role="status" aria-busy="true">
            <span className="sr-only">Loading working hours…</span>
            <ul className="flex flex-col gap-2">
              {Array.from({ length: 3 }, (_, index) => (
                <li key={index} className="flex items-center justify-between gap-2">
                  <Skeleton className="h-4 max-w-64" />
                  <Skeleton className="h-7 max-w-20" />
                </li>
              ))}
            </ul>
          </div>
        ) : roster.isError ? (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-sm text-danger">
              {getErrorMessage(roster.error)}
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void roster.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No working hours yet"
            description="With no rows here this person can be booked at any time. Add the days they actually work."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {WEEK_ORDER.filter((day) => byDay.has(day)).map((day) => (
              <div key={day} className="flex flex-col gap-2">
                <h4 className="text-2xs font-heavy tracking-wide text-ink-muted uppercase">
                  {DAY_LABELS[day]}
                </h4>
                <ul className="flex flex-col gap-2">
                  {inReadingOrder(byDay.get(day) ?? []).map((row) => {
                    const label = windowLabel(row);
                    const kind = row.kind === "BREAK" ? "break" : "working hours";
                    return (
                      <li key={row.id} className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-ink">
                          <span className="font-medium tabular-nums">
                            {clockLabel(row.startsAtMinute)} – {clockLabel(row.endsAtMinute)}
                          </span>
                          {row.kind === "BREAK" && <Badge>Break</Badge>}
                          {label && <span className="text-xs text-ink-muted">{label}</span>}
                        </span>
                        {canEdit && (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            aria-label={`Edit ${DAY_LABELS[row.dayOfWeek]} ${kind}`}
                            onClick={() => openEditor(row)}
                          >
                            Edit
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
