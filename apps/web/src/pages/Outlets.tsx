import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OutletSummary } from "@glampro_suite/shared";
import { get, patch, post } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export default function Outlets() {
  const { user, isReadOnly } = useAuth();
  const canManage = !isReadOnly && ["SUPER_ADMIN", "MANAGER"].includes(user?.globalRole ?? "");
  const client = useQueryClient();
  const outlets = useQuery({
    queryKey: ["outlets"],
    queryFn: () => get<OutletSummary[]>("/outlets"),
  });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [kind, setKind] = useState("PRODUCT");
  const [itemId, setItemId] = useState("");
  const [outletId, setOutletId] = useState("");
  const write = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
    onSuccess: () => client.invalidateQueries({ queryKey: ["outlets"] }),
  });
  function create(event: FormEvent) {
    event.preventDefault();
    write.mutate(() => post("/outlets", { name, slug }));
  }
  return (
    <main className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Outlets</h1>
      <p>
        Customers, credit and stock quantities are shared across this company. Select an outlet in
        the top bar for branch sales and reporting. “All outlets” includes historical tenant-wide
        sales. Staff use their existing company roles at every outlet.
      </p>
      {outlets.isPending && <p>Loading outlets…</p>}
      {outlets.isError && <p role="alert">Could not load outlets.</p>}
      {write.isError && (
        <p role="alert">
          The change failed. Check the fields, permissions and whether the slug is already used.
        </p>
      )}
      {write.isSuccess && <p role="status">Change saved.</p>}
      <ul className="space-y-3">
        {outlets.data?.map((outlet) => (
          <li key={outlet.id} className="rounded-md border border-line-soft p-3">
            <strong>{outlet.name}</strong> — {outlet.slug} — {outlet.status}
            {canManage && (
              <button
                className="ml-4 underline"
                disabled={write.isPending}
                onClick={() =>
                  write.mutate(() =>
                    patch(`/outlets/${outlet.id}`, {
                      status: outlet.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
                    }),
                  )
                }
              >
                {outlet.status === "ACTIVE" ? "Suspend" : "Reactivate"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <>
          <form onSubmit={create} className="flex flex-wrap gap-3">
            <h2 className="w-full text-lg font-bold">Add outlet</h2>
            <label>
              Name{" "}
              <input
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="rounded border p-2"
              />
            </label>
            <label>
              Slug{" "}
              <input
                required
                maxLength={64}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                className="rounded border p-2"
              />
            </label>
            <button disabled={write.isPending} className="rounded bg-purple px-4 text-white">
              Create outlet
            </button>
          </form>
          <form
            className="flex flex-wrap gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              write.mutate(() =>
                post("/outlets/assign", { kind, id: itemId, outletId: outletId || null }),
              );
            }}
          >
            <h2 className="w-full text-lg font-bold">Catalogue availability</h2>
            <p className="w-full">
              Assign an existing product or package by its catalogue ID. Tenant-wide items remain
              available at every outlet. This does not move or duplicate stock.
            </p>
            <label>
              Kind{" "}
              <select value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="PRODUCT">Product</option>
                <option value="PACKAGE">Package</option>
              </select>
            </label>
            <label>
              Item ID{" "}
              <input
                required
                maxLength={64}
                value={itemId}
                onChange={(event) => setItemId(event.target.value)}
                className="rounded border p-2"
              />
            </label>
            <label>
              Availability{" "}
              <select value={outletId} onChange={(event) => setOutletId(event.target.value)}>
                <option value="">Tenant-wide</option>
                {outlets.data
                  ?.filter((outlet) => outlet.status === "ACTIVE")
                  .map((outlet) => (
                    <option key={outlet.id} value={outlet.id}>
                      {outlet.name}
                    </option>
                  ))}
              </select>
            </label>
            <button disabled={write.isPending} className="rounded bg-purple px-4 text-white">
              Save availability
            </button>
          </form>
        </>
      )}
    </main>
  );
}
