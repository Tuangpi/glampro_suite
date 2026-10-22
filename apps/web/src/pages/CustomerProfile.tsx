import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CustomerPhoto, CustomerPurchase, CustomerVisit } from "@glampro_suite/shared";
import CustomerAvatar from "@/components/customers/CustomerAvatar";
import CustomerFormDrawer from "@/components/customers/CustomerFormDrawer";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Pagination from "@/components/ui/Pagination";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { useCustomer, useCustomerHoldings } from "@/hooks/useCustomers";
import api, { del, getErrorMessage, getPaginated, post } from "@/lib/api";
import { useModules } from "@/hooks/useSettings";
import CustomerTreatmentList from "@/pages/CustomerTreatmentList";

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
  if (customer.isPending) return <p role="status">Loading customer…</p>;
  if (!customer.data || customer.isError)
    return (
      <div role="alert">
        <p>Customer could not be loaded. {getErrorMessage(customer.error)}</p>
        <Button onClick={() => void customer.refetch()}>Try again</Button>
        <Link to="/customers">Back to customers</Link>
      </div>
    );
  const row = customer.data;
  return (
    <div className="flex flex-col gap-5">
      <Link to="/customers" className="text-sm underline">
        Back to customers
      </Link>
      <header className="flex flex-wrap items-center gap-4">
        <CustomerAvatar name={row.name} size="hero" />
        <div className="flex-1">
          <h2 className="text-xl text-ink">{row.name}</h2>
          <p>
            {row.phone ?? "No phone"} · {row.email ?? "No email"}
          </p>
          <p className="text-sm text-ink-muted">
            Customer since {formatDate(row.createdAt)}
            {row.code ? ` · ${row.code}` : ""}
          </p>
        </div>
        <Button disabled={isReadOnly} onClick={() => setEditing(true)}>
          Edit profile and consent
        </Button>
      </header>
      <section
        className="rounded-card border border-line bg-surface p-5"
        aria-label="Customer details"
      >
        <h3 className="font-bold">Details and notes</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-ink-muted">Address</dt>
            <dd>{row.address ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Date of birth</dt>
            <dd>{row.dateOfBirth ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Membership reference</dt>
            <dd>{row.memberId ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Branches</dt>
            <dd>{row.departments.map((d) => d.name).join(", ") || "—"}</dd>
          </div>
        </dl>
        <h4 className="mt-4 font-bold">Notes</h4>
        <p className="whitespace-pre-wrap break-words">
          {row.comment || "No notes yet. Edit the profile to add notes."}
        </p>
      </section>
      <section
        className="rounded-card border border-line bg-surface p-5"
        aria-label="Package and credit balances"
      >
        <h3 className="font-bold">Package and credit balances</h3>
        <p className="text-sm text-ink-muted">
          Active, unexpired balances only. Credit is available for any purchase.
        </p>
        {holdings.isPending ? (
          <p role="status">Loading balances…</p>
        ) : holdings.isError ? (
          <div role="alert">
            {getErrorMessage(holdings.error)}{" "}
            <Button onClick={() => void holdings.refetch()}>Retry balances</Button>
          </div>
        ) : holdings.data?.holdings.length ? (
          <ul className="mt-3 flex flex-col gap-2">
            {holdings.data.holdings.map((h) => (
              <li key={h.id} className="rounded-md bg-surface-muted p-3">
                <strong>{h.name}</strong> —{" "}
                {h.kind === "PACKAGE"
                  ? `${h.quantityRemaining} sessions`
                  : formatPrice(h.amountRemaining ?? "0")}
                <span className="ml-2 text-sm text-ink-muted">
                  {h.expiresAt ? `Expires ${formatDate(h.expiresAt)}` : "No expiry"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No active packages or prepaid credit.</p>
        )}
      </section>
      <History id={id} kind="visits" />
      <History id={id} kind="purchases" />
      <Treatments id={id} />
      <Photos id={id} readOnly={isReadOnly} />
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

function Treatments({ id }: { id: string }) {
  const modules = useModules();
  if (modules.isPending) return <p role="status">Loading treatment access…</p>;
  if (modules.isError)
    return (
      <div role="alert">
        Treatment access could not be loaded.
        <Button onClick={() => void modules.refetch()}>Retry treatment access</Button>
      </div>
    );
  return modules.data?.some((module) => module.code === "treatments" && module.entitled) ? (
    <CustomerTreatmentList key={id} customerId={id} />
  ) : null;
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
  return (
    <section className="rounded-card border border-line bg-surface p-5" aria-label={title}>
      <h3 className="font-bold">{title}</h3>
      <p className="text-sm text-ink-muted">
        {kind === "visits"
          ? "Past appointments; status distinguishes completed, cancelled and missed visits."
          : "Completed and voided sales. Held carts are excluded."}
      </p>
      {result.isPending ? (
        <p role="status">Loading history…</p>
      ) : result.isError ? (
        <div role="alert">
          {getErrorMessage(result.error)}{" "}
          <Button onClick={() => void result.refetch()}>Retry history</Button>
        </div>
      ) : (
        <>
          {!result.data?.data.length ? (
            <p>No {kind} recorded.</p>
          ) : (
            <ul className="my-3 divide-y divide-line-soft">
              {result.data.data.map((entry) => (
                <li key={entry.id} className="py-3">
                  {"startsAt" in entry ? (
                    <>
                      {formatDate(entry.startsAt, { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                      {entry.service ?? "Service not assigned"} ·{" "}
                      {entry.staff ?? "Staff not assigned"}
                    </>
                  ) : (
                    <>
                      {formatDate(entry.soldAt)} ·{" "}
                      {entry.receiptNumber === null
                        ? "Receipt not assigned"
                        : `Receipt #${entry.receiptNumber}`}{" "}
                      · {formatPrice(entry.total)}
                    </>
                  )}
                  <span className="ml-2 text-sm font-bold">{entry.status}</span>
                </li>
              ))}
            </ul>
          )}
          <Pagination
            page={page}
            pageCount={result.data?.pageCount ?? 0}
            onPageChange={setPage}
            label={`${title} pages`}
          />
        </>
      )}
    </section>
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
    <section
      className="rounded-card border border-line bg-surface p-5"
      aria-label="Customer photos"
    >
      <h3 className="font-bold">Photos</h3>
      <p className="text-sm text-ink-muted">
        Private to this salon. Upload requires recorded data consent. Withdrawal prevents new
        uploads; retained photos can be deleted here. JPEG/PNG, up to 5 MB. Photos retain their
        original metadata.
      </p>
      {!readOnly ? (
        <form onSubmit={(e) => void upload(e)} className="my-4 flex flex-col gap-3">
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
            value={caption}
            maxLength={500}
            disabled={busy}
            onChange={(e) => setCaption(e.target.value)}
          />
          <Button type="submit" disabled={!file || busy}>
            Upload photo
          </Button>
        </form>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {photos.isPending ? (
        <p role="status">Loading photos…</p>
      ) : photos.isError ? (
        <div role="alert">
          {getErrorMessage(photos.error)}{" "}
          <Button onClick={() => void photos.refetch()}>Retry photos</Button>
        </div>
      ) : (
        <>
          {!photos.data?.data.length ? (
            <p>No photos yet.</p>
          ) : (
            <div className="my-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {photos.data.data.map((photo) => (
                <figure key={photo.id} className="rounded-md border border-line p-3">
                  <PrivatePhoto customerId={id} photo={photo} />
                  <figcaption className="my-2 whitespace-pre-wrap break-words">
                    {photo.caption || "Customer photo"}
                  </figcaption>
                  {!readOnly ? (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void remove(photo.id)}
                    >
                      Delete photo
                    </Button>
                  ) : null}
                </figure>
              ))}
            </div>
          )}
          <Pagination
            page={page}
            pageCount={photos.data?.pageCount ?? 0}
            onPageChange={setPage}
            label="Photo pages"
          />
        </>
      )}
    </section>
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
      className="h-52 w-full rounded-md object-contain"
    />
  ) : (
    <p role="status">Loading photo…</p>
  );
}
