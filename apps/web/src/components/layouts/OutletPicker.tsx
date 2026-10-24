import { useQuery } from "@tanstack/react-query";
import type { OutletSummary } from "@glampro_suite/shared";
import { get } from "@/lib/api";
import { getOutletId, selectOutlet } from "@/lib/outlet-storage";
import { useAuth } from "@/contexts/AuthContext";

export default function OutletPicker() {
  const { tenant } = useAuth();
  const outlets = useQuery({
    queryKey: ["outlets", tenant?.id],
    queryFn: () => get<OutletSummary[]>("/outlets"),
  });
  if (outlets.isError)
    return <span role="alert">Outlet selection unavailable. Reload to retry.</span>;
  if (!outlets.data?.length && !getOutletId()) return null;
  return (
    <label className="text-sm text-ink-body">
      Outlet
      <select
        aria-label="Active outlet"
        value={getOutletId() ?? ""}
        className="ml-2 rounded-md border border-line-soft p-2"
        onChange={(event) => {
          if (!window.confirm("Switch outlet? The current unsaved cart will be cleared.")) return;
          // A hard reload removes all query and component state; no cross-outlet cached reports.
          for (const key of Object.keys(localStorage)) {
            if (key.startsWith("glampro.saleDraft.v1")) localStorage.removeItem(key);
          }
          selectOutlet(event.target.value);
          window.location.reload();
        }}
      >
        <option value="">All outlets / tenant-wide</option>
        {outlets.data
          ?.filter((outlet) => outlet.status === "ACTIVE")
          .map((outlet) => (
            <option key={outlet.id} value={outlet.id}>
              {outlet.name}
            </option>
          ))}
        {getOutletId() &&
          !outlets.data?.some(
            (outlet) => outlet.id === getOutletId() && outlet.status === "ACTIVE",
          ) && <option value={getOutletId()!}>Unavailable outlet — select another</option>}
      </select>
    </label>
  );
}
