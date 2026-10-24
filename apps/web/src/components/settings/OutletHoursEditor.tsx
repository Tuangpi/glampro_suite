import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  outletOperatingHoursSchema,
  type OutletOperatingHours,
  type OutletSummary,
} from "@glampro_suite/shared";
import { patch } from "@/lib/api";

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
  const save = useMutation({
    mutationFn: () =>
      patch(`/outlets/${outlet.id}`, { operatingHours: inherit ? null : draft, timeZone: zone }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["outlets"] }),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    const result = outletOperatingHoursSchema.safeParse(draft);
    if (!inherit && !result.success) {
      setError("Use valid opening and closing times; closing must be later on the same day.");
      return;
    }
    setError("");
    save.mutate();
  }
  return (
    <details className="mt-3">
      <summary>Operating hours — {outlet.name}</summary>
      <form onSubmit={submit} className="space-y-3 mt-3">
        <p>
          Bookings use this outlet’s local time. Missing overrides inherit company hours. Changes do
          not move existing bookings. Staff and resources remain shared across outlets.
        </p>
        <label>
          Time zone{" "}
          <input
            required
            aria-label={`${outlet.name} time zone`}
            value={zone}
            onChange={(event) => setZone(event.target.value)}
            disabled={save.isPending}
            className="rounded border p-2"
          />
        </label>
        <label className="block">
          <input
            type="checkbox"
            checked={inherit}
            disabled={save.isPending}
            onChange={(event) => setInherit(event.target.checked)}
          />{" "}
          Use company hours
        </label>
        {!inherit &&
          DAYS.map((day) => (
            <fieldset key={day} disabled={save.isPending} className="flex gap-3 items-center">
              <legend className="capitalize">{day}</legend>
              <label>
                <input
                  type="checkbox"
                  checked={draft[day] !== null}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      [day]: event.target.checked ? { open: "09:00", close: "18:00" } : null,
                    })
                  }
                />{" "}
                Open
              </label>
              {draft[day] && (
                <>
                  <label>
                    Opens{" "}
                    <input
                      type="time"
                      required
                      aria-label={`${day} opens`}
                      value={draft[day].open}
                      onChange={(event) =>
                        setDraft({ ...draft, [day]: { ...draft[day]!, open: event.target.value } })
                      }
                    />
                  </label>
                  <label>
                    Closes{" "}
                    <input
                      type="time"
                      required
                      aria-label={`${day} closes`}
                      value={draft[day].close}
                      onChange={(event) =>
                        setDraft({ ...draft, [day]: { ...draft[day]!, close: event.target.value } })
                      }
                    />
                  </label>
                </>
              )}
            </fieldset>
          ))}
        {(error || save.isError) && (
          <p role="alert">
            {error || "Hours could not be saved. Check the time zone and try again."}
          </p>
        )}
        {save.isSuccess && <p role="status">Outlet hours saved.</p>}
        <button disabled={save.isPending} className="rounded bg-purple px-4 py-2 text-white">
          Save outlet hours
        </button>
      </form>
    </details>
  );
}
