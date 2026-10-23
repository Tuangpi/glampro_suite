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

export default function CompanyAdministration({
  id,
  onChange,
}: {
  id: string;
  onChange: () => Promise<void>;
}) {
  const [data, setData] = useState<Administration | null>(null);
  const [audit, setAudit] = useState<CompanyAudit | null>(null);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([platformApi.administration(id), platformApi.audit(id, page)])
      .then(([administration, history]) => {
        if (active) {
          setData(administration);
          setAudit(history);
        }
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Unable to load administration.");
      });
    return () => {
      active = false;
    };
  }, [id, page, revision]);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice("Change saved. Audit history will refresh.");
      setReason("");
      setRevision((value) => value + 1);
      await onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.");
    } finally {
      setBusy(false);
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
      <h3>Subscription and access management</h3>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!data ? (
        <p role="status">Loading administration…</p>
      ) : (
        <>
          <p>Effective status: {data.effectiveStatus}</p>
          <label>
            Change reason
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={3}
              maxLength={500}
              required
            />
          </label>
          <p>
            Lifecycle changes sign out all company sessions. Suspension allows a new read-only
            login; cancellation blocks access. Record a current period before reactivating an
            expired subscription.
          </p>
          <div className="actions">
            <button disabled={busy} onClick={() => void lifecycle("suspend")}>
              Suspend company
            </button>
            <button disabled={busy} onClick={() => void lifecycle("reactivate")}>
              Reactivate company
            </button>
            <button disabled={busy} onClick={() => void lifecycle("cancel")}>
              Cancel company
            </button>
          </div>
          <h4>Recent subscription periods (up to 100)</h4>
          <ul>
            {data.subscriptions.map((row) => (
              <li key={row.id}>
                {row.startDate} — {row.endDate}: {row.currency} {row.amount} ({row.status})
              </li>
            ))}
          </ul>
          <form onSubmit={subscription}>
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
          <h4>Module access</h4>
          <ul>
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
          <form onSubmit={module}>
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
        </>
      )}
      <h4>Company audit history</h4>
      {audit && (
        <>
          <ol>
            {audit.items.map((row) => (
              <li key={row.id}>
                {row.createdAt} — {row.action} —{" "}
                {row.actor ? `${row.actor.name} (${row.actor.email})` : "System / owner onboarding"}
                <pre>{JSON.stringify(row.metadata, null, 2)}</pre>
              </li>
            ))}
          </ol>
          <div className="actions">
            <button disabled={busy || page <= 1} onClick={() => setPage((value) => value - 1)}>
              Previous audit page
            </button>
            <span>Audit page {page}</span>
            <button
              disabled={busy || page * audit.pageSize >= audit.total}
              onClick={() => setPage((value) => value + 1)}
            >
              Next audit page
            </button>
          </div>
        </>
      )}
    </div>
  );
}
