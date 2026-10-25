import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  outletOperatingHoursSchema,
  updateOutletSchema,
  type OutletOperatingHours,
  type OutletSummary,
} from "@glampro_suite/shared";
import { patch } from "@/lib/api";
import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import Input from "@/components/ui/Input";

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
const CLOSED = Object.fromEntries(DAYS.map((day) => [day, null])) as OutletOperatingHours;

export default function OutletHoursEditor({ outlet }: { outlet: OutletSummary }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<OutletOperatingHours>(outlet.operatingHours ?? CLOSED);
  const [zone, setZone] = useState(outlet.timeZone);
  const [inherit, setInherit] = useState(!outlet.operatingHours);
  const [error, setError] = useState("");
  const [zoneError, setZoneError] = useState("");
  const save = useMutation({
    mutationFn: () =>
      patch(`/outlets/${outlet.id}`, { operatingHours: inherit ? null : draft, timeZone: zone }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["outlets"] }),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    const validZone = updateOutletSchema.safeParse({ timeZone: zone });
    setZoneError(validZone.success ? "" : "Enter a valid IANA time zone, such as Asia/Singapore.");
    const result = outletOperatingHoursSchema.safeParse(draft);
    if (!inherit && !result.success) {
      setError("Use valid opening and closing times; closing must be later on the same day.");
      return;
    }
    setError("");
    if (!validZone.success) return;
    save.mutate();
  }
  return (
    <details className="border-t border-line-soft pt-3">
      <summary className="min-h-control cursor-pointer rounded-md py-3 text-sm font-bold text-purple focus-visible:outline-2 focus-visible:outline-purple">
        Edit hours — {outlet.name}
      </summary>
      <form onSubmit={submit} className="mt-3 space-y-4" onChange={() => save.reset()}>
        <p className="text-sm text-ink-muted">
          Bookings use this outlet’s local time. Missing overrides inherit company hours. Changes do
          not move existing bookings. Staff and resources remain shared across outlets.
        </p>
        <Input
          label="Time zone"
          hint="Use an IANA time zone, for example Asia/Singapore."
          error={zoneError}
          required
          aria-label={`${outlet.name} time zone`}
          value={zone}
          onChange={(event) => setZone(event.target.value)}
          disabled={save.isPending}
        />
        <Checkbox
          label="Use company hours"
          hint="Turn this off to set a full-week schedule for this outlet. Unchecked days are closed."
          checked={inherit}
          disabled={save.isPending}
          onChange={(event) => setInherit(event.target.checked)}
        />
        {inherit && (
          <p className="rounded-md bg-surface-muted px-3 py-2 text-sm text-ink-muted">
            This outlet follows the company opening hours configured in Booking &amp; hours.
          </p>
        )}
        <div className="grid gap-3 xl:grid-cols-2">
          {!inherit &&
            DAYS.map((day) => (
              <fieldset
                key={day}
                disabled={save.isPending}
                className="min-w-0 rounded-lg border border-line p-3"
              >
                <legend className="px-1 text-sm font-bold capitalize text-ink">{day}</legend>
                <Checkbox
                  label="Open"
                  checked={draft[day] !== null}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      [day]: event.target.checked ? { open: "09:00", close: "18:00" } : null,
                    })
                  }
                />
                {draft[day] && (
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <Input
                      label="Opens"
                      type="time"
                      required
                      aria-label={`${day} opens`}
                      value={draft[day].open}
                      onChange={(event) =>
                        setDraft({ ...draft, [day]: { ...draft[day]!, open: event.target.value } })
                      }
                    />
                    <Input
                      label="Closes"
                      type="time"
                      required
                      aria-label={`${day} closes`}
                      value={draft[day].close}
                      onChange={(event) =>
                        setDraft({ ...draft, [day]: { ...draft[day]!, close: event.target.value } })
                      }
                    />
                  </div>
                )}
                {!draft[day] && <p className="text-xs text-ink-muted">Closed</p>}
              </fieldset>
            ))}
        </div>
        {(error || save.isError) && (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {error || "Hours could not be saved. Check the time zone and try again."}
          </p>
        )}
        {save.isSuccess && (
          <p role="status" className="text-sm text-success-text">
            Outlet hours saved.
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending}>
            Save outlet hours
          </Button>
        </div>
      </form>
    </details>
  );
}
