import { useEffect, useState, type FormEvent } from "react";
import type {
  CompanyAdministration as Administration,
  CompanyAudit,
  CompanyLifecycleInput,
} from "@glampro_suite/shared";
import {
  recordSubscriptionSchema,
  companyModuleSchema,
  companyLifecycleSchema,
} from "@glampro_suite/shared";
import { platformApi } from "./api";
import type { DetailTab } from "./DetailTabs";

export default function CompanyAdministration({
  id,
  onChange,
  tab = "subscription",
  onBusyChange,
}: {
  id: string;
  onChange: () => Promise<void>;
  tab?: DetailTab;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [data, setData] = useState<Administration | null>(null);
  const [audit, setAudit] = useState<CompanyAudit | null>(null);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState<"suspend" | "cancel" | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    Promise.all([platformApi.administration(id), platformApi.audit(id, page)])
      .then(([administration, history]) => {
        if (active) {
          setData(administration);
          setAudit(history);
          setError("");
        }
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Unable to load administration.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, page, revision]);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice("Change saved. Audit history will refresh.");
      setReason("");
      setConfirmation(null);
      setLoading(true);
      setRevision((value) => value + 1);
      await onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  async function lifecycle(action: CompanyLifecycleInput["action"]) {
    await perform(async () => {
      const input = companyLifecycleSchema.safeParse({ action, reason });
      if (!input.success) throw new Error(input.error.issues[0].message);
      await platformApi.lifecycle(id, input.data);
    });
  }
  function subscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    void perform(async () => {
      const input = recordSubscriptionSchema.safeParse({
        startDate: values.get("startDate"),
        endDate: values.get("endDate"),
        amount: values.get("amount"),
        currency: values.get("currency"),
        reason,
      });
      if (!input.success) throw new Error(input.error.issues[0].message);
      await platformApi.recordSubscription(id, input.data);
    });
  }
  function module(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    void perform(async () => {
      const enabled = values.get("enabled") === "grant";
      const input = companyModuleSchema.safeParse({
        code: values.get("code"),
        enabled,
        expiresAt: enabled ? values.get("expiresAt") || null : null,
        reason,
      });
      if (!input.success) throw new Error(input.error.issues[0].message);
      await platformApi.changeModule(id, input.data);
    });
  }
  return (
    <div aria-label="Company administration">
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {loading && !data ? (
        <p role="status">Loading administration…</p>
      ) : data ? (
        <>
          {tab !== "overview" && tab !== "activity" && (
            <div className="change-reason">
              <p>
                Effective status:{" "}
                <span className={`status-badge status-${data.effectiveStatus.toLowerCase()}`}>
                  {data.effectiveStatus}
                </span>
              </p>
              <label>
                Change reason
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  minLength={3}
                  maxLength={500}
                  required
                  disabled={busy}
                  placeholder="Explain why this change is needed"
                />
              </label>
              <p className="note">
                Required for all changes. This reason is recorded in the company audit history.
              </p>
            </div>
          )}
          <div
            role="tabpanel"
            id="company-panel-subscription"
            aria-labelledby="company-tab-subscription"
            hidden={tab !== "subscription"}
            tabIndex={0}
          >
            <h3>Subscription and company access</h3>
            <p className="note">
              Lifecycle changes sign out all company sessions. Suspension allows a new read-only
              login; cancellation blocks access. Record a current period before reactivating an
              expired subscription.
            </p>
            <div className="actions">
              <button
                className="button-warning"
                disabled={busy || reason.trim().length < 3}
                onClick={() => setConfirmation("suspend")}
              >
                Suspend company
              </button>
              <button
                className="button-secondary"
                disabled={busy || reason.trim().length < 3}
                onClick={() => void lifecycle("reactivate")}
              >
                Reactivate company
              </button>
              <button
                className="button-danger"
                disabled={busy || reason.trim().length < 3}
                onClick={() => setConfirmation("cancel")}
              >
                Cancel company
              </button>
            </div>
            {confirmation && (
              <div className="confirmation" role="group" aria-label="Confirm company access change">
                <h4>
                  {confirmation === "suspend" ? "Suspend this company?" : "Cancel this company?"}
                </h4>
                <p>
                  All company sessions will be signed out.{" "}
                  {confirmation === "suspend"
                    ? "Users can sign in again with read-only access."
                    : "Users will be blocked from signing in."}
                </p>
                <p>
                  <strong>Reason:</strong> {reason}
                </p>
                <div className="actions">
                  <button
                    className="button-danger"
                    disabled={busy}
                    onClick={() => void lifecycle(confirmation)}
                  >
                    Confirm {confirmation === "suspend" ? "suspension" : "cancellation"}
                  </button>
                  <button
                    className="button-secondary"
                    disabled={busy}
                    onClick={() => setConfirmation(null)}
                  >
                    Keep current access
                  </button>
                </div>
              </div>
            )}
            <h4>Recent subscription periods (up to 100)</h4>
            <ul>
              {data.subscriptions.map((row) => (
                <li key={row.id}>
                  {row.startDate} — {row.endDate}: {row.currency} {row.amount} ({row.status})
                </li>
              ))}
            </ul>
            {!data.subscriptions.length && (
              <p className="muted">No subscription periods recorded.</p>
            )}
            <form className="form-grid" onSubmit={subscription}>
              <h4>Record current subscription period</h4>
              <p>
                Manual record only; no payment is charged or recorded. Use ISO timestamps with a
                timezone, for example 2026-10-23T00:00:00+08:00. Periods cannot overlap.
              </p>
              <label>
                Period start
                <input name="startDate" placeholder="2026-10-23T00:00:00+08:00" required />
              </label>
              <label>
                Period end
                <input name="endDate" placeholder="2026-11-23T00:00:00+08:00" required />
              </label>
              <label>
                Subscription amount
                <input
                  name="amount"
                  pattern="(?:0|[1-9][0-9]{0,9})\.[0-9]{2}"
                  placeholder="99.00"
                  required
                />
              </label>
              <label>
                Currency
                <input name="currency" defaultValue="SGD" pattern="[A-Z]{3}" required />
              </label>
              <button disabled={busy || reason.trim().length < 3}>Record subscription</button>
            </form>
          </div>
          <div
            role="tabpanel"
            id="company-panel-modules"
            aria-labelledby="company-tab-modules"
            hidden={tab !== "modules"}
            tabIndex={0}
          >
            <h4>Module access</h4>
            <ul className="module-list">
              {data.modules.map((row) => (
                <li key={row.code}>
                  {row.name}:{" "}
                  {row.isCore
                    ? "Core (always available)"
                    : row.entitled
                      ? "Enabled"
                      : row.enabled
                        ? "Expired"
                        : "Not granted"}
                  {row.expiresAt ? ` until ${row.expiresAt}` : ""}
                </li>
              ))}
            </ul>
            <form className="form-grid" onSubmit={module}>
              <label>
                Add-on module
                <select name="code" required>
                  {data.modules
                    .filter((row) => !row.isCore)
                    .map((row) => (
                      <option key={row.code} value={row.code}>
                        {row.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Access action
                <select name="enabled">
                  <option value="grant">Grant or update</option>
                  <option value="revoke">Revoke</option>
                </select>
              </label>
              <label>
                Add-on expiry (ISO timestamp, optional)
                <input name="expiresAt" placeholder="2026-11-23T00:00:00+08:00" />
              </label>
              <button
                disabled={
                  busy || reason.trim().length < 3 || !data.modules.some((row) => !row.isCore)
                }
              >
                Save add-on access
              </button>
            </form>
          </div>
        </>
      ) : (
        <button
          className="button-secondary"
          onClick={() => {
            setLoading(true);
            setRevision((value) => value + 1);
          }}
        >
          Retry administration
        </button>
      )}
      <div
        role="tabpanel"
        id="company-panel-activity"
        aria-labelledby="company-tab-activity"
        hidden={tab !== "activity"}
        tabIndex={0}
      >
        <h4>Company audit history</h4>
        {loading && <p role="status">Loading activity…</p>}
        {audit && (
          <>
            {!audit.total && <p className="empty-state">No activity recorded yet.</p>}
            <ol className="audit-list">
              {audit.items.map((row) => (
                <li key={row.id}>
                  <strong>{row.action}</strong>
                  <p>
                    <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time>{" "}
                    ·{" "}
                    {row.actor
                      ? `${row.actor.name} (${row.actor.email})`
                      : "System / owner onboarding"}
                  </p>
                  <details>
                    <summary>View technical details</summary>
                    <pre>{JSON.stringify(row.metadata, null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ol>
            <div className="actions pagination">
              <button
                className="button-secondary"
                disabled={busy || loading || page <= 1}
                onClick={() => {
                  setLoading(true);
                  setPage((value) => value - 1);
                }}
              >
                Previous audit page
              </button>
              <span>Audit page {page}</span>
              <button
                className="button-secondary"
                disabled={busy || loading || page * audit.pageSize >= audit.total}
                onClick={() => {
                  setLoading(true);
                  setPage((value) => value + 1);
                }}
              >
                Next audit page
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
