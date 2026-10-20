/**
 * Rooms and equipment — TK2610-0020 phase D, settings card 11.
 *
 * The salon describes what a booking can occupy and **which services may use it**.
 * That set is an eligibility list, not a schedule: the booking engine gives each
 * service line the first member that is free for that line's window, so ticking
 * two wash chairs on a shampoo means "either chair", not "both".
 *
 * The form keeps the two rules the API owns rather than inventing its own: a name
 * is unique inside the salon, and a room is **archived** (`Inactive`) instead of
 * deleted, so the bookings already taken in it keep their line. `serviceIds` is
 * sent as the complete ticked set, because a checkbox list can only ever say what
 * is ticked now — the API replaces the set in the same transaction.
 */
import { useState } from "react";
import type { CatalogStatusValue, ResourceKindValue, ResourceSummary } from "@glampro_suite/shared";

import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Checkbox from "@/components/ui/Checkbox";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Table, { type TableColumn } from "@/components/ui/Table";
import {
  useCreateResource,
  useResourceList,
  useResourceServices,
  useUpdateResource,
} from "@/hooks/useResources";
import { getErrorMessage, getValidationDetails } from "@/lib/api";

const KIND_LABELS: Record<ResourceKindValue, string> = { ROOM: "Room", EQUIPMENT: "Equipment" };

export default function ResourcesCard({ canEdit }: { canEdit: boolean }) {
  const resources = useResourceList();
  const services = useResourceServices();
  const [editing, setEditing] = useState<ResourceSummary | "new" | null>(null);

  const serviceNames = new Map(
    (services.data?.data ?? []).map((service) => [service.id, service.name]),
  );
  const rows = resources.data ?? [];

  const columns: TableColumn<ResourceSummary>[] = [
    { key: "name", header: "Name", cell: (row) => row.name },
    { key: "kind", header: "Type", cell: (row) => KIND_LABELS[row.kind] },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <Badge variant={row.status === "ACTIVE" ? "success" : "neutral"}>
          {row.status === "ACTIVE" ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "services",
      header: "Used by",
      cell: (row) => {
        if (row.serviceIds.length === 0)
          return <span className="text-ink-muted">No service yet</span>;
        // Two names and a count reads better in a table cell than a wall of them.
        const names = row.serviceIds.map((id) => serviceNames.get(id) ?? "A retired service");
        return names.length <= 2
          ? names.join(", ")
          : `${names[0]}, ${names[1]} +${names.length - 2} more`;
      },
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) => (
        <Button
          type="button"
          variant="ghost"
          disabled={!canEdit || services.isPending || services.isError}
          onClick={() => setEditing(row)}
        >
          Edit {row.name}
        </Button>
      ),
    },
  ];

  return (
    <Card
      title="Rooms and equipment"
      description="What a booking can occupy. A service is booked only while one of the rooms or machines it may use is free."
      actions={
        <Button
          type="button"
          disabled={!canEdit || services.isPending || services.isError}
          onClick={() => setEditing("new")}
        >
          Add resource
        </Button>
      }
    >
      {services.isError ? (
        <p role="alert" className="text-sm text-danger">
          Services could not be loaded. Resource eligibility cannot be edited until the full list is
          available.
        </p>
      ) : null}
      {resources.isError ? (
        <p role="alert" className="text-sm text-danger">
          Rooms and equipment could not be loaded.
        </p>
      ) : resources.isPending ? (
        <p className="text-sm text-ink-muted">Loading rooms and equipment…</p>
      ) : (
        <Table
          caption="Rooms and equipment"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          empty={
            <p className="px-2 py-3 text-sm text-ink-muted">
              No rooms or equipment yet. Bookings work as they always did until one is added.
            </p>
          }
        />
      )}

      {editing ? (
        <ResourceEditor
          key={editing === "new" ? "new" : editing.id}
          resource={editing === "new" ? null : editing}
          services={(services.data?.data ?? []).map((service) => ({
            id: service.id,
            name: service.name,
          }))}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  );
}

/**
 * One room, or a blank one.
 *
 * The draft is local state rather than a form that seeds itself from a refetch:
 * the list can refetch behind an open editor, and a write-back would overwrite a
 * half-typed name. `null` is "create", which is why the same component serves
 * both — the fields and the rules are identical.
 */
function ResourceEditor({
  resource,
  services,
  onClose,
}: {
  resource: ResourceSummary | null;
  services: { id: string; name: string }[];
  onClose: () => void;
}) {
  const create = useCreateResource();
  const update = useUpdateResource();
  const [name, setName] = useState(resource?.name ?? "");
  const [kind, setKind] = useState<ResourceKindValue>(resource?.kind ?? "ROOM");
  const [status, setStatus] = useState<CatalogStatusValue>(resource?.status ?? "ACTIVE");
  const [serviceIds, setServiceIds] = useState<string[]>(resource?.serviceIds ?? []);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const pending = create.isPending || update.isPending;

  function toggleService(id: string, checked: boolean): void {
    setServiceIds((current) =>
      checked
        ? [...current.filter((entry) => entry !== id), id]
        : current.filter((entry) => entry !== id),
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setFieldErrors({});
    if (name.trim() === "") {
      setFieldErrors({ name: "Name is required" });
      return;
    }

    try {
      if (resource) {
        await update.mutateAsync({
          id: resource.id,
          input: { name: name.trim(), kind, status, serviceIds },
        });
      } else {
        await create.mutateAsync({ name: name.trim(), kind, status, serviceIds });
      }
      onClose();
    } catch (cause) {
      // A duplicate name comes back as a 409 carrying `body.name`, so it lands on
      // the control that caused it rather than at the top of the card.
      setFieldErrors(getValidationDetails(cause));
      setError(getErrorMessage(cause));
    }
  }

  return (
    <form
      className="mt-4 flex flex-col gap-3 rounded-md border border-line p-3"
      onSubmit={handleSubmit}
    >
      <h4 className="text-sm font-heavy">
        {resource ? `Edit ${resource.name}` : "New room or equipment"}
      </h4>

      <Input
        label="Name"
        value={name}
        error={fieldErrors["name"] ?? fieldErrors["body.name"]}
        onChange={(event) => setName(event.target.value)}
      />

      <Select
        label="Type"
        value={kind}
        options={[
          { value: "ROOM", label: "Room" },
          { value: "EQUIPMENT", label: "Equipment" },
        ]}
        onChange={(event) => setKind(event.target.value as ResourceKindValue)}
      />

      <Select
        label="Status"
        value={status}
        options={[
          { value: "ACTIVE", label: "Active — can be booked" },
          { value: "INACTIVE", label: "Inactive — kept for history, not bookable" },
        ]}
        onChange={(event) => setStatus(event.target.value as CatalogStatusValue)}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Services that may use it</legend>
        <p className="text-xs text-ink-muted">
          Tick every service that can be performed here. A booking takes one free member of this set
          — it does not need all of them.
        </p>
        {services.length === 0 ? (
          <p className="text-sm text-ink-muted">The catalogue has no active service yet.</p>
        ) : (
          <div className="max-h-56 overflow-y-auto rounded-md border border-line-soft p-2">
            {services.map((service) => (
              <Checkbox
                key={service.id}
                label={service.name}
                checked={serviceIds.includes(service.id)}
                onChange={(event) => toggleService(service.id, event.target.checked)}
              />
            ))}
          </div>
        )}
      </fieldset>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {resource ? "Save room or equipment" : "Add room or equipment"}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
