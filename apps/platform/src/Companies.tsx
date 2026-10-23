import { useEffect, useState, type FormEvent } from "react";
import { createCompanySchema, type CompanyList, type CompanyDetail } from "@glampro_suite/shared";
import { platformApi } from "./api";

export default function Companies() {
  const [list, setList] = useState<CompanyList | null>(null);
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  useEffect(() => {
    let active = true;
    platformApi
      .companies(search, page)
      .then((value) => {
        if (active) setList(value);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load companies.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [search, page, revision]);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Company request failed.");
    } finally {
      setBusy(false);
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    await perform(async () => {
      const input = createCompanySchema.safeParse({ name, slug, ownerName, ownerEmail });
      if (!input.success) throw new Error(input.error.issues[0].message);
      const result = await platformApi.createCompany(input.data);
      setDetail(result.company);
      setRevision((value) => value + 1);
      setName("");
      setSlug("");
      setOwnerName("");
      setOwnerEmail("");
      setNotice(
        result.invitationDelivery === "sent"
          ? "Company created. Owner invitation sent."
          : "Company created, but invitation email failed. Use Resend invitation; do not create the company again.",
      );
    });
  }
  return (
    <div className="companies">
      <h2>Company management</h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <label>
        Search companies
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
            setLoading(true);
          }}
          maxLength={160}
        />
      </label>
      {loading && <p role="status">Loading companies…</p>}
      {list && (
        <>
          <p>{list.total} companies</p>
          <ul className="company-list">
            {list.items.map((company) => (
              <li key={company.id}>
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => setDetail(await platformApi.company(company.id)))
                  }
                >
                  {company.name}
                </button>
                <span>
                  {company.slug} · {company.status}
                </span>
              </li>
            ))}
          </ul>
          {!list.items.length && <p>No companies found.</p>}
          <div className="actions">
            <button
              disabled={page === 1 || busy}
              onClick={() => {
                setPage(page - 1);
                setLoading(true);
              }}
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              disabled={page * list.pageSize >= list.total || busy}
              onClick={() => {
                setPage(page + 1);
                setLoading(true);
              }}
            >
              Next
            </button>
          </div>
        </>
      )}
      {detail && (
        <article aria-label="Company details">
          <h3>{detail.name}</h3>
          <dl>
            <dt>Company ID</dt>
            <dd>{detail.id}</dd>
            <dt>Slug</dt>
            <dd>{detail.slug}</dd>
            <dt>Status</dt>
            <dd>{detail.status}</dd>
            <dt>Owner</dt>
            <dd>{detail.owner?.name ?? "Not assigned"}</dd>
            <dt>Owner email</dt>
            <dd>{detail.owner?.email ?? "Not assigned"}</dd>
            <dt>Owner access</dt>
            <dd>
              {detail.owner?.disabled
                ? "Disabled / pending onboarding"
                : detail.owner
                  ? "Enabled"
                  : "Not assigned"}
            </dd>
            <dt>Invitation</dt>
            <dd>
              {!detail.invitation
                ? "None"
                : detail.invitation.acceptedAt
                  ? "Accepted"
                  : detail.invitation.revokedAt
                    ? "Revoked"
                    : new Date(detail.invitation.expiresAt) <= new Date()
                      ? "Expired"
                      : "Pending"}
            </dd>
            {detail.invitation && (
              <>
                <dt>Invitation expiry</dt>
                <dd>{new Date(detail.invitation.expiresAt).toLocaleString()}</dd>
              </>
            )}
          </dl>
          {detail.owner?.disabled &&
            detail.status === "ACTIVE" &&
            detail.invitation &&
            !detail.invitation.acceptedAt && (
              <button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const result = await platformApi.resendInvitation(detail.id);
                    setDetail(result.company);
                    setNotice(
                      result.invitationDelivery === "sent"
                        ? "New invitation sent. Previous links are invalid."
                        : "Invitation email failed. Please retry sending.",
                    );
                  })
                }
              >
                Resend invitation
              </button>
            )}
          <button disabled={busy} onClick={() => setDetail(null)}>
            Close details
          </button>
        </article>
      )}
      <h3>Create company</h3>
      <form onSubmit={(event) => void create(event)}>
        <label>
          Company name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={160}
            required
          />
        </label>
        <label>
          Company slug
          <input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            minLength={3}
            maxLength={64}
            required
          />
        </label>
        <label>
          Owner name
          <input
            value={ownerName}
            onChange={(event) => setOwnerName(event.target.value)}
            maxLength={120}
            required
          />
        </label>
        <label>
          Owner email
          <input
            type="email"
            value={ownerEmail}
            onChange={(event) => setOwnerEmail(event.target.value)}
            maxLength={255}
            required
          />
        </label>
        <p>
          The owner receives a one-time 48-hour invitation to choose a password. No password is
          assigned by the operator.
        </p>
        <button disabled={busy} type="submit">
          {busy ? "Please wait…" : "Create company and invite owner"}
        </button>
      </form>
    </div>
  );
}
