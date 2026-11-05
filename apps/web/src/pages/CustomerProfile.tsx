import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CustomerPhoto, CustomerPurchase, CustomerVisit } from "@glampro_suite/shared";
import CustomerAvatar from "@/components/customers/CustomerAvatar";
import CustomerArchivePanel from "@/components/customers/CustomerArchivePanel";
import CustomerHoldingHistoryPanel from "@/components/customers/CustomerHoldingHistoryPanel";
import CustomerPrepaidPanel from "@/components/customers/CustomerPrepaidPanel";
import CustomerSessionPackagesPanel from "@/components/customers/CustomerSessionPackagesPanel";
import CustomerFormDrawer from "@/components/customers/CustomerFormDrawer";
import { ChevronLeft, Mail, Phone } from "@/components/icons";
import Badge, { type BadgeVariant } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import Pagination from "@/components/ui/Pagination";
import Skeleton from "@/components/ui/Skeleton";
import Tabs from "@/components/ui/Tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { genderLabel } from "@/constants/customers";
import { useCustomer, useCustomerHoldings } from "@/hooks/useCustomers";
import api, { del, getErrorMessage, getPaginated, post } from "@/lib/api";
import { useModules } from "@/hooks/useSettings";
import CustomerTreatmentList from "@/pages/CustomerTreatmentList";

/** Every section the page can show, in reading order; the id is the `?tab=` value. */
const TABS = ["overview", "packages", "history", "treatments", "photos"] as const;
type TabId = (typeof TABS)[number];

const TAB_LABELS: Record<TabId, string> = {
  overview: "Overview",
  packages: "Packages & credit",
  history: "History",
  treatments: "Treatments",
  photos: "Photos",
};

function isTabId(value: string | null): value is TabId {
  return TABS.some((tab) => tab === value);
}

/** Visit and sale states share one vocabulary; the badge colour is the only mapping. */
function statusTone(status: string): BadgeVariant {
  switch (status) {
    case "COMPLETED":
    case "PAID":
      return "success";
    case "CANCELLED":
    case "VOID":
      return "danger";
    case "NO_SHOW":
      return "warning";
    default:
      return "neutral";
  }
}

/** One labelled value in the details grid. An absent value reads as a dash, never a blank row. */
function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-heavy tracking-wide text-ink-muted uppercase">{label}</dt>
      <dd className="mt-0.5 break-words text-ink-body">{value?.trim() ? value : "—"}</dd>
    </div>
  );
}

export default function CustomerProfile() {
  const { id } = useParams();
  return id ? <Profile key={id} id={id} /> : <p role="alert">Customer not found.</p>;
}

function Profile({ id }: { id: string }) {
  const customer = useCustomer(id);
  const holdings = useCustomerHoldings(id);
  const { isReadOnly } = useAuth();
  const { formatDate, formatPrice } = useSalonFormatting();
  const [editing, setEditing] = useState(false);
  const [params, setParams] = useSearchParams();
  // The URL owns the section, so a link sent to a colleague opens where it was sent from.
  const requested = params.get("tab");
  const activeTab: TabId = isTabId(requested) ? requested : "overview";
  if (customer.isPending) return <p role="status">Loading customer…</p>;
  if (!customer.data || customer.isError)
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p>Customer could not be loaded. {getErrorMessage(customer.error)}</p>
        <div className="flex items-center gap-3">
          <Button onClick={() => void customer.refetch()}>Try again</Button>
          <Link to="/customers" className="text-sm text-ink-body underline">
            Back to customers
          </Link>
        </div>
      </div>
    );
  const row = customer.data;
  const activeBalances = holdings.data?.holdings ?? [];
  function selectTab(tab: string) {
    const next = new URLSearchParams(params);
    if (tab === "overview") next.delete("tab");
    else next.set("tab", tab);
    setParams(next, { replace: true });
  }
  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/customers"
        className="inline-flex w-fit items-center gap-1 text-sm font-bold text-ink-muted transition-colors hover:text-purple"
      >
        <ChevronLeft aria-hidden />
        Back to customers
      </Link>

      <Card flush>
        <div className="flex flex-wrap items-center gap-4 px-5 py-5">
          <CustomerAvatar name={row.name} size="hero" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-heavy text-ink">{row.name}</h2>
              {row.archivedAt ? (
                <Badge variant="danger" dot>
                  Archived
                </Badge>
              ) : null}
              {row.code ? <Badge variant="neutral">{row.code}</Badge> : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-body">
              {row.phone ? (
                <a
                  href={`tel:${row.phone}`}
                  className="inline-flex items-center gap-1.5 hover:text-purple hover:underline"
                >
                  <Phone className="text-ink-muted" />
                  {row.phone}
                </a>
              ) : (
                <span className="text-ink-muted">No phone</span>
              )}
              {row.email ? (
                <a
                  href={`mailto:${row.email}`}
                  className="inline-flex items-center gap-1.5 hover:text-purple hover:underline"
                >
                  <Mail className="text-ink-muted" />
                  {row.email}
                </a>
              ) : (
                <span className="text-ink-muted">No email</span>
              )}
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              Customer since {formatDate(row.createdAt)}
              {row.departments.length ? ` · ${row.departments.map((d) => d.name).join(", ")}` : ""}
            </p>
          </div>
          <Button disabled={isReadOnly} onClick={() => setEditing(true)}>
            Edit profile and consent
          </Button>
        </div>
      </Card>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Tabs
          label="Customer sections"
          activeId={activeTab}
          onChange={selectTab}
          className="min-w-0 xl:order-1"
          items={[
            {
              id: "overview",
              label: TAB_LABELS.overview,
              content: (
                <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
                  <Card title="Details" label="Details">
                    <dl className="grid gap-x-6 gap-y-3 py-1 sm:grid-cols-2">
                      <Field label="Address" value={row.address} />
                      <Field label="Date of birth" value={row.dateOfBirth} />
                      <Field label="Membership reference" value={row.memberId} />
                      <Field
                        label="Branches"
                        value={row.departments.map((department) => department.name).join(", ")}
                      />
                      <Field label="Gender" value={genderLabel(row.gender)} />
                      <Field label="Card number" value={row.cardNumber} />
                      <Field label="Hair card" value={row.hairCardNumber} />
                      <Field label="Manicure card" value={row.maniCardNumber} />
                    </dl>
                  </Card>
                  <Card title="Notes" label="Notes">
                    {row.comment?.trim() ? (
                      <p className="py-1 whitespace-pre-wrap break-words text-ink-body">
                        {row.comment}
                      </p>
                    ) : (
                      <EmptyState
                        title="No notes yet"
                        description="Edit the profile to add allergies, preferences or anything the next stylist should know."
                        className="px-2 py-8"
                      />
                    )}
                  </Card>
                </div>
              ),
            },
            {
              id: "packages",
              label: TAB_LABELS.packages,
              content: <Packages id={id} />,
            },
            {
              id: "history",
              label: TAB_LABELS.history,
              content: (
                <div className="flex flex-col gap-5 2xl:grid 2xl:grid-cols-2 2xl:items-start">
                  <History id={id} kind="visits" />
                  <History id={id} kind="purchases" />
                </div>
              ),
            },
            { id: "treatments", label: TAB_LABELS.treatments, content: <Treatments id={id} /> },
            {
              id: "photos",
              label: TAB_LABELS.photos,
              content: <Photos id={id} readOnly={isReadOnly} />,
            },
          ]}
        />

        {/* DOM-first so the summary leads on a phone; `order` moves it to the rail on xl. */}
        <aside className="flex flex-col gap-4 xl:sticky xl:top-[calc(var(--sp-topbar-h)+1.5rem)] xl:order-2 xl:max-h-[calc(100dvh-var(--sp-topbar-h)-3rem)] xl:self-start xl:overflow-y-auto">
          <Card
            title="Balances"
            label="Balances"
            description="Active, unexpired balances only. Credit is available for any purchase."
          >
            {holdings.isPending ? (
              <div
                aria-busy="true"
                aria-label="Loading balances"
                className="flex flex-col gap-2 py-1"
              >
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : holdings.isError ? (
              <div role="alert" className="flex flex-wrap items-center gap-2 py-1 text-sm">
                {getErrorMessage(holdings.error)}{" "}
                <Button size="sm" variant="secondary" onClick={() => void holdings.refetch()}>
                  Retry balances
                </Button>
              </div>
            ) : activeBalances.length ? (
              <ul className="flex flex-col gap-2 py-1">
                {activeBalances.map((holding) => (
                  <li key={holding.id} className="rounded-md bg-surface-2 px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 truncate text-sm font-bold text-ink">{holding.name}</p>
                      <p className="shrink-0 text-sm font-heavy text-ink">
                        {holding.kind === "PACKAGE"
                          ? `${holding.quantityRemaining} sessions`
                          : formatPrice(holding.amountRemaining ?? "0")}
                      </p>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {holding.expiresAt ? `Expires ${formatDate(holding.expiresAt)}` : "No expiry"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="No active balances"
                description="A session package or prepaid credit shows here while it lasts."
                className="px-2 py-8"
              />
            )}
          </Card>
          <CustomerArchivePanel key={row.id} customer={row} refreshing={customer.isFetching} />
        </aside>
      </div>
      {editing ? (
        <CustomerFormDrawer
          key={row.updatedAt}
          open
          customer={row}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}

/** Ownership, transfers and the audit trail — all three read the `packages` add-on. */
function Packages({ id }: { id: string }) {
  const modules = useModules();
  if (modules.isPending) return <p role="status">Loading package access…</p>;
  if (modules.isError)
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
        Package access could not be loaded.
        <Button size="sm" variant="secondary" onClick={() => void modules.refetch()}>
          Retry package access
        </Button>
      </div>
    );
  const intro =
    "Who owns each balance, what moved between customers, and the audit trail behind every draw.";
  return modules.data?.some((module) => module.code === "packages" && module.entitled) ? (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-muted">{intro}</p>
      <CustomerPrepaidPanel customerId={id} />
      <CustomerSessionPackagesPanel customerId={id} />
      <CustomerHoldingHistoryPanel customerId={id} />
    </div>
  ) : (
    <Card title="Packages & credit" label="Packages & credit" description={intro}>
      <EmptyState
        title="The packages add-on is not enabled"
        description="An owner can turn it on in Settings. Ownership, transfers and history appear here once it is on."
        className="px-2 py-8"
      />
    </Card>
  );
}

function Treatments({ id }: { id: string }) {
  const modules = useModules();
  if (modules.isPending) return <p role="status">Loading treatment access…</p>;
  if (modules.isError)
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
        Treatment access could not be loaded.
        <Button size="sm" variant="secondary" onClick={() => void modules.refetch()}>
          Retry treatment access
        </Button>
      </div>
    );
  return modules.data?.some((module) => module.code === "treatments" && module.entitled) ? (
    <CustomerTreatmentList key={id} customerId={id} />
  ) : (
    <Card
      title="Treatments"
      label="Treatments"
      description="What was applied during each visit, kept with the customer."
    >
      <EmptyState
        title="The treatments add-on is not enabled"
        description="An owner can turn it on in Settings. Records appear here once it is on."
        className="px-2 py-8"
      />
    </Card>
  );
}

function History({ id, kind }: { id: string; kind: "visits" | "purchases" }) {
  const [page, setPage] = useState(1);
  const { formatDate, formatPrice } = useSalonFormatting();
  const title = kind === "visits" ? "Visit history" : "Purchase history";
  const result = useQuery({
    queryKey: ["customers", id, kind, page],
    queryFn: () =>
      getPaginated<CustomerVisit | CustomerPurchase>(`/customers/${id}/${kind}`, {
        page,
        pageSize: 10,
      }),
  });
  const pageCount = result.data?.pageCount ?? 0;
  return (
    <Card
      title={title}
      label={title}
      description={
        kind === "visits"
          ? "Past appointments; the status tells completed, cancelled and missed visits apart."
          : "Completed and voided sales. Held carts are excluded."
      }
      footer={
        pageCount > 1 ? (
          <Pagination
            page={page}
            pageCount={pageCount}
            onPageChange={setPage}
            label={`${title} pages`}
          />
        ) : undefined
      }
    >
      {result.isPending ? (
        <div
          aria-busy="true"
          aria-label={`Loading ${title.toLowerCase()}`}
          className="flex flex-col gap-2 py-1"
        >
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : result.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 py-1 text-sm">
          {getErrorMessage(result.error)}{" "}
          <Button size="sm" variant="secondary" onClick={() => void result.refetch()}>
            Retry history
          </Button>
        </div>
      ) : !result.data?.data.length ? (
        <EmptyState
          title={`No ${kind} recorded`}
          description={
            kind === "visits"
              ? "Appointments booked for this customer appear here once they start."
              : "Completed and voided sales for this customer appear here."
          }
          className="px-2 py-8"
        />
      ) : (
        <ul className="divide-y divide-line-soft">
          {result.data.data.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink">
                  {"startsAt" in entry
                    ? (entry.service ?? "Service not assigned")
                    : entry.receiptNumber === null
                      ? "Receipt not assigned"
                      : `Receipt #${entry.receiptNumber} · ${formatPrice(entry.total)}`}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {"startsAt" in entry
                    ? `${formatDate(entry.startsAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })} · ${entry.staff ?? "Staff not assigned"}`
                    : formatDate(entry.soldAt)}
                </p>
              </div>
              <Badge variant={statusTone(entry.status)}>{entry.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Photos({ id, readOnly }: { id: string; readOnly: boolean }) {
  const [page, setPage] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const client = useQueryClient();
  const key = ["customers", id, "photos"];
  const photos = useQuery({
    queryKey: [...key, page],
    queryFn: () => getPaginated<CustomerPhoto>(`/customers/${id}/photos`, { page, pageSize: 6 }),
  });
  async function upload(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || readOnly || busy) return;
    setError(null);
    if (file.size > 5 * 1024 * 1024 || !["image/png", "image/jpeg"].includes(file.type)) {
      setError("Choose a JPEG or PNG photo up to 5 MB.");
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("photo", file);
      body.append("caption", caption);
      await post(`/customers/${id}/photos`, body);
      setFile(null);
      setCaption("");
      setInputKey((v) => v + 1);
      setPage(1);
      await client.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(photoId: string) {
    if (readOnly || busy || !window.confirm("Delete this customer photo permanently?")) return;
    setBusy(true);
    setError(null);
    try {
      await del(`/customers/${id}/photos/${photoId}`);
      setPage(1);
      await client.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card
      title="Photos"
      label="Photos"
      description="Private to this salon. Upload requires recorded data consent; withdrawal prevents new uploads. JPEG/PNG, up to 5 MB."
      footer={
        photos.data && photos.data.pageCount > 1 ? (
          <Pagination
            page={page}
            pageCount={photos.data.pageCount}
            onPageChange={setPage}
            label="Photo pages"
          />
        ) : undefined
      }
    >
      {!readOnly ? (
        <form onSubmit={(e) => void upload(e)} className="flex flex-col gap-3 py-1 sm:max-w-sm">
          <Input
            key={inputKey}
            label="Photo"
            type="file"
            accept="image/jpeg,image/png"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Input
            label="Photo caption"
            placeholder="e.g. Before — balayage"
            value={caption}
            maxLength={500}
            disabled={busy}
            onChange={(e) => setCaption(e.target.value)}
          />
          <Button type="submit" disabled={!file || busy} className="w-full sm:w-auto">
            Upload photo
          </Button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="py-1 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {photos.isPending ? (
        <div
          aria-busy="true"
          aria-label="Loading photos"
          className="grid gap-4 py-1 sm:grid-cols-2 lg:grid-cols-3"
        >
          <Skeleton className="h-52" />
          <Skeleton className="h-52" />
        </div>
      ) : photos.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 py-1 text-sm">
          {getErrorMessage(photos.error)}{" "}
          <Button size="sm" variant="secondary" onClick={() => void photos.refetch()}>
            Retry photos
          </Button>
        </div>
      ) : !photos.data?.data.length ? (
        <EmptyState
          title="No photos yet."
          description={
            readOnly ? "Photos uploaded by the salon appear here." : "Upload the first one above."
          }
          className="px-2 py-8"
        />
      ) : (
        <div className="grid gap-4 py-1 sm:grid-cols-2 lg:grid-cols-3">
          {photos.data.data.map((photo) => (
            <figure key={photo.id} className="overflow-hidden rounded-md border border-line">
              <PrivatePhoto customerId={id} photo={photo} />
              <figcaption className="flex flex-col gap-2 border-t border-line-soft px-3 py-2">
                <p className="break-words text-sm text-ink-body">
                  {photo.caption || "Customer photo"}
                </p>
                {!readOnly ? (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => void remove(photo.id)}
                  >
                    Delete photo
                  </Button>
                ) : null}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </Card>
  );
}

function PrivatePhoto({ customerId, photo }: { customerId: string; photo: CustomerPhoto }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void api
      .get<Blob>(`/customers/${customerId}/photos/${photo.id}`, { responseType: "blob" })
      .then((res) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(res.data);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [customerId, photo.id]);
  return failed ? (
    <p role="alert">Photo could not be loaded.</p>
  ) : url ? (
    <img
      src={url}
      alt={photo.caption || "Customer photo"}
      className="h-52 w-full bg-surface-2 object-contain"
    />
  ) : (
    <p role="status">Loading photo…</p>
  );
}
