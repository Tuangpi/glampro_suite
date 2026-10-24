import { useEffect, useState, type FormEvent } from "react";
import { createCompanySchema, type CompanyList, type CompanyDetail } from "@glampro_suite/shared";
import { platformApi } from "./api";
import CompanyAdministration from "./CompanyAdministration";
import DetailTabs, { type DetailTab } from "./DetailTabs";

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
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [administrationBusy, setAdministrationBusy] = useState(false);
  useEffect(() => {
    let active = true;
    platformApi
      .companies(search, page)
      .then((value) => {
        if (active) {
          setList(value);
          setError("");
        }
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
      setTab("overview");
      setCreating(false);
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
      <div className="page-heading">
        <div>
          <span className="eyebrow">Operator workspace</span>
          <h1>Company management</h1>
          <p className="muted">Manage companies, owner invitations and access in one place.</p>
        </div>
        {!detail && !creating && (
          <button
            onClick={() => {
              setCreating(true);
              setNotice("");
            }}
          >
            + Create company
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!detail && !creating && (
        <div className="directory card" aria-busy={loading}>
          <div className="directory-toolbar">
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
                placeholder="Search by company name or slug…"
              />
            </label>
            <button
              className="button-secondary"
              disabled={loading || busy}
              onClick={() => {
                setLoading(true);
                setRevision((value) => value + 1);
              }}
            >
              Refresh companies
            </button>
          </div>
          {loading && <p role="status">Loading companies…</p>}
          {list && (
            <>
              <p>{list.total} companies</p>
              <div className="company-list-heading" aria-hidden="true">
                <span>Company</span>
                <span>Status</span>
                <span>Action</span>
              </div>
              <ul className="company-list" aria-label="Companies">
                {list.items.map((company) => (
                  <li key={company.id}>
                    <button
                      disabled={busy}
                      className="company-name"
                      aria-label={company.name}
                      onClick={() =>
                        void perform(async () => {
                          setDetail(await platformApi.company(company.id));
                          setTab("overview");
                        })
                      }
                    >
                      <span className="company-avatar" aria-hidden="true">
                        {company.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span>
                        <strong>{company.name}</strong>
                        <small>{company.slug}</small>
                      </span>
                    </button>
                    <span className={`status-badge status-${company.status.toLowerCase()}`}>
                      {company.status}
                    </span>
                    <button
                      className="button-secondary"
                      aria-label={`View details for ${company.name}`}
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          setDetail(await platformApi.company(company.id));
                          setTab("overview");
                        })
                      }
                    >
                      View details <span aria-hidden="true">→</span>
                    </button>
                  </li>
                ))}
              </ul>
              {!list.items.length && (
                <div className="empty-state">
                  <h3>No companies found.</h3>
                  <p>
                    {search
                      ? "Try a different company name or slug."
                      : "Create your first company to invite its owner."}
                  </p>
                </div>
              )}
              <div className="actions pagination">
                <button
                  disabled={page === 1 || busy}
                  className="button-secondary"
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
                  className="button-secondary"
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
        </div>
      )}
      {detail && (
        <article className="company-detail card" aria-label="Company details">
          <button
            className="button-secondary"
            disabled={busy || administrationBusy}
            onClick={() => setDetail(null)}
          >
            ← Back to companies
          </button>
          <div className="detail-heading">
            <div>
              <span className="eyebrow">Company details</span>
              <h2>{detail.name}</h2>
              <p className="muted">{detail.slug}</p>
            </div>
            <span className={`status-badge status-${detail.status.toLowerCase()}`}>
              {detail.status}
            </span>
          </div>
          <DetailTabs value={tab} onChange={setTab} disabled={busy || administrationBusy} />
          <div
            role="tabpanel"
            id="company-panel-overview"
            aria-labelledby="company-tab-overview"
            hidden={tab !== "overview"}
            tabIndex={0}
          >
            <h3>Company overview</h3>
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
          </div>
          <CompanyAdministration
            key={detail.id}
            id={detail.id}
            tab={tab}
            onBusyChange={setAdministrationBusy}
            onChange={async () => {
              setDetail(await platformApi.company(detail.id));
              setRevision((value) => value + 1);
            }}
          />
        </article>
      )}
      {creating && !detail && (
        <div className="card create-company">
          <button className="button-secondary" disabled={busy} onClick={() => setCreating(false)}>
            ← Back to companies
          </button>
          <h2>Create company</h2>
          <p className="muted">
            Set up the company and invite its owner. They will choose their own password.
          </p>
          <form className="form-grid" onSubmit={(event) => void create(event)}>
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
      )}
    </div>
  );
}
