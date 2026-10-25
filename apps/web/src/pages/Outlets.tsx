import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createOutletSchema, type OutletSummary } from "@glampro_suite/shared";
import { get, patch, post } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import OutletHoursEditor from "@/components/settings/OutletHoursEditor";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import Skeleton from "@/components/ui/Skeleton";
import { queryKeys } from "@/constants/queryKeys";

const ERROR_CLASS = "rounded-md bg-danger/10 px-3 py-2 text-sm text-danger";
const SUCCESS_CLASS = "rounded-md bg-success-soft px-3 py-2 text-sm text-success-text";

export default function Outlets() {
  const { user, isReadOnly } = useAuth();
  const canManage = !isReadOnly && ["SUPER_ADMIN", "MANAGER"].includes(user?.globalRole ?? "");
  const outlets = useQuery({
    queryKey: ["outlets"],
    queryFn: () => get<OutletSummary[]>("/outlets"),
  });
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState("");
  const rows = outlets.data ?? [];
  function openCreate() {
    setCreated("");
    setAdding(true);
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-line bg-surface-muted px-4 py-3 text-sm text-ink-muted">
        <p className="font-bold text-ink">Branches, one shared company</p>
        <p className="mt-1">
          Customers, credit, stock quantities, staff and resources stay shared. Company roles apply
          at every outlet. Use the top-bar selector for branch sales, bookings and reports; “All
          outlets” also includes historical company-wide sales.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-base font-bold text-ink">Your outlets</h4>
          <p className="mt-1 text-sm text-ink-muted">
            Manage branch status and local booking hours.
          </p>
        </div>
        {canManage && !adding && <Button onClick={openCreate}>Add outlet</Button>}
      </div>
      {created && (
        <p role="status" className={SUCCESS_CLASS}>
          {created}
        </p>
      )}
      {canManage && adding && (
        <AddOutlet
          onCancel={() => setAdding(false)}
          onCreated={(name) => {
            setCreated(`${name} outlet created.`);
            setAdding(false);
          }}
        />
      )}
      {outlets.isPending ? (
        <div aria-busy="true" aria-label="Loading outlets" className="space-y-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : outlets.isError ? (
        <div role="alert" className={ERROR_CLASS}>
          <p>Could not load outlets. Refresh the list before making changes.</p>
          <Button
            variant="secondary"
            onClick={() => void outlets.refetch()}
            loading={outlets.isFetching}
            className="mt-3"
          >
            Retry outlets
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No outlets yet"
            description="Add your first branch to manage local booking hours and branch reporting."
            action={
              canManage && !adding ? (
                <Button onClick={openCreate}>Add your first outlet</Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <ul aria-label="Company outlets" className="space-y-3">
          {rows.map((outlet) => (
            <li key={outlet.id}>
              <OutletCard outlet={outlet} canManage={canManage} />
            </li>
          ))}
        </ul>
      )}
      {canManage && !outlets.isPending && !outlets.isError && (
        <CatalogueAvailability outlets={rows} />
      )}
    </div>
  );
}

function AddOutlet({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (name: string) => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: (input: { name: string; slug: string }) => post("/outlets", input),
    onSuccess: (_data, input) => {
      void client.invalidateQueries({ queryKey: ["outlets"] });
      onCreated(input.name);
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    const result = createOutletSchema.safeParse({ name, slug });
    if (!result.success) {
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues)
        fields[String(issue.path[0])] =
          issue.path[0] === "slug"
            ? "Use lowercase letters, numbers and single hyphens, up to 64 characters."
            : "Enter an outlet name, up to 120 characters.";
      setErrors(fields);
      return;
    }
    setErrors({});
    create.mutate({ name: result.data.name, slug: result.data.slug });
  }
  return (
    <Card
      title="Add outlet"
      description="New branches use your company time zone and opening hours until you override them."
    >
      <form onSubmit={submit} noValidate className="space-y-4 pt-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Name"
            required
            maxLength={120}
            placeholder="Central branch"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={errors.name}
            disabled={create.isPending}
          />
          <Input
            label="Slug"
            required
            maxLength={64}
            placeholder="central-branch"
            hint="A unique outlet identifier: lowercase letters, numbers and hyphens."
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            error={errors.slug}
            disabled={create.isPending}
          />
        </div>
        {create.isError && (
          <p role="alert" className={ERROR_CLASS}>
            Could not create the outlet. Check that the slug is unique and try again.
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Create outlet
          </Button>
        </div>
      </form>
    </Card>
  );
}

function OutletCard({ outlet, canManage }: { outlet: OutletSummary; canManage: boolean }) {
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const active = outlet.status === "ACTIVE";
  const status = useMutation({
    mutationFn: (next: "ACTIVE" | "SUSPENDED") => patch(`/outlets/${outlet.id}`, { status: next }),
    onSuccess: () => {
      setConfirming(false);
      void client.invalidateQueries({ queryKey: ["outlets"] });
    },
  });
  return (
    <Card>
      <div className="space-y-3 px-1 pt-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="break-words text-base text-ink">{outlet.name}</strong>
              <Badge variant={active ? "success" : "neutral"} dot>
                {active ? "Active" : "Suspended"}
              </Badge>
            </div>
            <p className="mt-1 break-words text-sm text-ink-muted">
              {outlet.timeZone} ·{" "}
              {outlet.operatingHours ? "Custom outlet hours" : "Uses company hours"}
            </p>
            <p className="mt-1 break-all text-xs text-ink-muted">Outlet slug: {outlet.slug}</p>
          </div>
          {canManage && (
            <Button
              variant={active ? "danger" : "secondary"}
              loading={status.isPending}
              onClick={() => {
                status.reset();
                if (active) setConfirming(true);
                else status.mutate("ACTIVE");
              }}
            >
              {active ? "Suspend" : "Reactivate"}
            </Button>
          )}
        </div>
        {status.isError && !confirming && (
          <p role="alert" className={ERROR_CLASS}>
            Could not update {outlet.name}. Please try again.
          </p>
        )}
        {status.isSuccess && (
          <p role="status" className={SUCCESS_CLASS}>
            {outlet.name} {status.variables === "ACTIVE" ? "reactivated" : "suspended"}.
          </p>
        )}
        {canManage && <OutletHoursEditor outlet={outlet} />}
      </div>
      <Modal
        open={confirming && canManage}
        onClose={() => {
          if (!status.isPending) setConfirming(false);
        }}
        title={`Suspend ${outlet.name}?`}
        description="This outlet will no longer be available for active outlet selection. Existing records are not deleted."
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              disabled={status.isPending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={status.isPending}
              onClick={() => status.mutate("SUSPENDED")}
            >
              Confirm suspension
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink-muted">
          You can reactivate this outlet later. Customers, credit and stock remain shared across the
          company.
        </p>
        {status.isError && (
          <p role="alert" className={`${ERROR_CLASS} mt-3`}>
            Could not suspend {outlet.name}. Please try again.
          </p>
        )}
      </Modal>
    </Card>
  );
}

function CatalogueAvailability({ outlets }: { outlets: OutletSummary[] }) {
  const client = useQueryClient();
  const [kind, setKind] = useState("PRODUCT");
  const [itemId, setItemId] = useState("");
  const [outletId, setOutletId] = useState("");
  const [error, setError] = useState("");
  const assign = useMutation({
    mutationFn: (input: { kind: string; id: string; outletId: string | null }) =>
      post("/outlets/assign", input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["outlets"] });
      void client.invalidateQueries({ queryKey: queryKeys.products.list() });
      void client.invalidateQueries({ queryKey: queryKeys.packages.list() });
      void client.invalidateQueries({ queryKey: queryKeys.sale.items() });
    },
  });
  const activeOutlets = outlets.filter((outlet) => outlet.status === "ACTIVE");
  const unavailable = Boolean(outletId && !activeOutlets.some((outlet) => outlet.id === outletId));
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!itemId.trim() || itemId.trim().length > 64) {
      setError("Enter a catalogue item ID, up to 64 characters.");
      return;
    }
    if (unavailable) return;
    setError("");
    assign.mutate({ kind, id: itemId.trim(), outletId: outletId || null });
  }
  return (
    <Card
      title="Catalogue availability"
      description="Choose where an existing product or package is available. This does not move or duplicate stock."
    >
      <form onSubmit={submit} noValidate className="space-y-4 pt-3" onChange={() => assign.reset()}>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Select
            label="Item type"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value);
              setItemId("");
              setError("");
            }}
            options={[
              { value: "PRODUCT", label: "Product" },
              { value: "PACKAGE", label: "Package" },
            ]}
            disabled={assign.isPending}
          />
          <Input
            label="Catalogue item ID"
            required
            maxLength={64}
            value={itemId}
            onChange={(event) => setItemId(event.target.value)}
            hint="Paste the existing product or package ID, not its name or SKU."
            error={error}
            disabled={assign.isPending}
          />
          <Select
            label="Available at"
            value={outletId}
            onChange={(event) => setOutletId(event.target.value)}
            placeholder=""
            options={[
              { value: "", label: "All outlets (company-wide)" },
              ...activeOutlets.map((outlet) => ({ value: outlet.id, label: outlet.name })),
              ...(unavailable
                ? [
                    {
                      value: outletId,
                      label: "Unavailable outlet — choose another",
                      disabled: true,
                    },
                  ]
                : []),
            ]}
            error={
              unavailable
                ? "This outlet is no longer active. Choose another outlet or All outlets."
                : undefined
            }
            hint="Company-wide items are available at every outlet."
            disabled={assign.isPending}
          />
        </div>
        <p className="text-xs text-ink-muted">
          ID-based assignment supports items outside the outlet currently selected in the top bar.
        </p>
        {assign.isError && (
          <p role="alert" className={ERROR_CLASS}>
            Could not save availability. Check the item type, catalogue ID and outlet, then try
            again.
          </p>
        )}
        {assign.isSuccess && (
          <p role="status" className={SUCCESS_CLASS}>
            Catalogue availability saved.
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" loading={assign.isPending} disabled={unavailable}>
            Save availability
          </Button>
        </div>
      </form>
    </Card>
  );
}
