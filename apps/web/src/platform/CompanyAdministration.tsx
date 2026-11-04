/**
 * Per-company administration: subscription, module access and audit history.
 *
 * Two things changed shape in the console redesign and both are about honesty
 * rather than looks:
 *
 * 1. **Module access is a row of switches, not a two-select form.** The old form
 *    asked the operator to pick a module *and* pick "grant"/"revoke" separately —
 *    two chances to pair the wrong module with the wrong action, and no view of
 *    the current state while doing it. A switch per module shows what is true
 *    now and changes exactly one thing when pressed.
 * 2. **The reason moved into the confirmation.** `companyModuleSchema` requires a
 *    reason for every change, so every toggle opens a modal that asks for one:
 *    the audit trail cannot be skipped by using the switch instead of the form.
 *
 * The switch never flips optimistically. It keeps the server's position until the
 * request answers and the company has been re-read.
 */
import { useEffect, useState, type FormEvent } from "react";
import type {
  CompanyAdministration as Administration,
  CompanyAudit,
  CompanyLifecycleInput,
} from "@glampro_suite/shared";
import {
  companyLifecycleSchema,
  companyModuleSchema,
  recordSubscriptionSchema,
} from "@glampro_suite/shared";

import { AlertTriangle } from "@/components/icons";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Pagination from "@/components/ui/Pagination";
import Skeleton from "@/components/ui/Skeleton";
import Switch from "@/components/ui/Switch";
import Table, { type TableColumn } from "@/components/ui/Table";
import { platformApi } from "./api";
import type { DetailTab } from "./DetailTabs";

type ModuleRow = Administration["modules"][number];
type ModuleChange = { code: string; name: string; enabled: boolean };

/**
 * A grant that has lapsed: the company once had the module and no longer does.
 * `entitled` is the server's own answer to "may they use it now" — a grant whose
 * `expiresAt` has passed reports `enabled: true, entitled: false`.
 */
function isExpired(row: ModuleRow): boolean {
  return !row.isCore && row.enabled && !row.entitled;
}

/** Missing or unparseable is an em dash, never "Invalid Date". */
function formatExpiry(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

const MODULE_COLUMNS = (
  busy: boolean,
  onToggle: (row: ModuleRow) => void,
): TableColumn<ModuleRow>[] => [
  {
    key: "module",
    header: "Module",
    cell: (row) => (
      <Switch
        label={row.name}
        checked={row.isCore ? true : row.entitled}
        disabled={row.isCore}
        loading={busy}
        onChange={() => onToggle(row)}
        description={
          row.isCore
            ? "Always available to this company."
            : row.entitled
              ? `Granted${row.expiresAt ? ` until ${formatExpiry(row.expiresAt)}` : " with no expiry"}.`
              : isExpired(row)
                ? `Expired ${formatExpiry(row.expiresAt)}. Turning it back on grants it again.`
                : "Not granted. Turning it on grants access immediately."
        }
        meta={row.isCore ? <Badge variant="purple">Core</Badge> : null}
      />
    ),
  },
  {
    key: "access",
    header: "Access",
    cell: (row) =>
      row.isCore ? (
        <Badge variant="purple">Core</Badge>
      ) : row.entitled ? (
        <Badge variant="success" dot>
          Enabled
        </Badge>
      ) : isExpired(row) ? (
        <Badge variant="warning" dot>
          Expired
        </Badge>
      ) : (
        <Badge>Not granted</Badge>
      ),
  },
  { key: "expires", header: "Expires", cell: (row) => formatExpiry(row.expiresAt) },
];

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
  /** The shared reason for subscription and lifecycle changes. */
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState<"suspend" | "cancel" | null>(null);
  const [loading, setLoading] = useState(true);
  /** The module a toggle is asking about, plus that modal's own draft. */
  const [moduleChange, setModuleChange] = useState<ModuleChange | null>(null);
  const [moduleReason, setModuleReason] = useState("");
  const [moduleExpiry, setModuleExpiry] = useState("");
  const [moduleError, setModuleError] = useState("");

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

  /**
   * Run one change, then re-read everything it could have touched.
   *
   * `onError` exists so a failure inside a modal is reported *in that modal*: the
   * alert at the top of the section would sit behind the overlay, which is the
   * same as not reporting it at all. Only one of the two ever receives the
   * message, so no screen announces the same failure twice.
   */
  async function perform(action: () => Promise<void>, onError?: (message: string) => void) {
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice("Change saved. Audit history will refresh.");
      setReason("");
      setConfirmation(null);
      setModuleChange(null);
      setLoading(true);
      setRevision((value) => value + 1);
      await onChange();
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Request failed.";
      if (onError) onError(message);
      else setError(message);
      return false;
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
    const form = event.currentTarget;
    const values = new FormData(form);
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
      // Only after the server accepted it: a rejected period keeps its dates.
      form.reset();
    });
  }

  function openModule(row: ModuleRow) {
    setModuleChange({ code: row.code, name: row.name, enabled: !row.entitled });
    setModuleReason("");
    setModuleExpiry("");
    setModuleError("");
  }

  /** Driven from the modal's footer button and from Enter inside its form. */
  async function saveModule() {
    const target = moduleChange;
    if (!target) return;
    await perform(async () => {
      const input = companyModuleSchema.safeParse({
        code: target.code,
        enabled: target.enabled,
        // A revocation has nothing to expire; the schema rejects a stray date.
        expiresAt: target.enabled ? moduleExpiry.trim() || null : null,
        reason: moduleReason,
      });
      if (!input.success) throw new Error(input.error.issues[0].message);
      await platformApi.changeModule(id, input.data);
    }, setModuleError);
  }

  return (
    <section aria-label="Company administration" className="flex flex-col gap-4">
      {error ? (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-md bg-danger/5 px-3 py-2.5 text-sm text-danger"
        >
          <AlertTriangle aria-hidden />
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded-md bg-success-soft px-3 py-2.5 text-sm text-success-text"
        >
          {notice}
        </p>
      ) : null}

      {loading && !data ? (
        <div
          aria-busy="true"
          aria-label="Loading company administration"
          className="flex flex-col gap-2"
        >
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
          <Skeleton className="h-11 w-2/3" />
        </div>
      ) : data ? (
        <>
          <div
            role="tabpanel"
            id="company-panel-subscription"
            aria-labelledby="company-tab-subscription"
            hidden={tab !== "subscription"}
            tabIndex={0}
            className="flex flex-col gap-4 pt-2"
          >
            <Card
              title="Subscription and company access"
              description={
                <span className="flex items-center gap-2">
                  Effective status <Badge dot>{data.effectiveStatus}</Badge>
                </span>
              }
            >
              <div className="flex flex-col gap-4 px-2 pt-2 pb-1">
                <p className="text-sm text-ink-body">
                  Lifecycle changes sign out all company sessions. Suspension allows a new read-only
                  login; cancellation blocks access. Record a current period before reactivating an
                  expired subscription.
                </p>

                <Input
                  label="Change reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  minLength={3}
                  maxLength={500}
                  required
                  disabled={busy}
                  placeholder="Explain why this change is needed"
                  hint="Required for all changes. Recorded in the company audit history."
                />

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => setConfirmation("suspend")}
                  >
                    Suspend company
                  </Button>
                  <Button
                    variant="secondary"
                    loading={busy}
                    disabled={reason.trim().length < 3}
                    onClick={() => void lifecycle("reactivate")}
                  >
                    Reactivate company
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => setConfirmation("cancel")}
                  >
                    Cancel company
                  </Button>
                </div>
              </div>
            </Card>

            <Card
              title="Recent subscription periods"
              description="The most recent 100 records. Manual record only — no payment is charged or captured."
            >
              <Table
                caption="Recent subscription periods"
                rows={data.subscriptions}
                rowKey={(row) => row.id}
                columns={[
                  { key: "start", header: "Start", cell: (row) => row.startDate },
                  { key: "end", header: "End", cell: (row) => row.endDate },
                  {
                    key: "amount",
                    header: "Amount",
                    align: "right",
                    cell: (row) => `${row.currency} ${row.amount}`,
                  },
                  { key: "status", header: "Status", cell: (row) => <Badge>{row.status}</Badge> },
                ]}
                empty={
                  <EmptyState
                    title="No subscription periods recorded."
                    description="Record the current period so the company's access has a date range."
                  />
                }
              />

              <form className="mt-4 flex flex-col gap-3 px-2" onSubmit={subscription}>
                <h4 className="text-sm font-bold text-ink">Record current subscription period</h4>
                <p className="text-xs text-ink-muted">
                  Use ISO timestamps with a timezone, for example 2026-10-23T00:00:00+08:00. Periods
                  cannot overlap.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    name="startDate"
                    label="Period start"
                    placeholder="2026-10-23T00:00:00+08:00"
                    required
                  />
                  <Input
                    name="endDate"
                    label="Period end"
                    placeholder="2026-11-23T00:00:00+08:00"
                    required
                  />
                  <Input
                    name="amount"
                    label="Subscription amount"
                    pattern="(?:0|[1-9][0-9]{0,9})\.[0-9]{2}"
                    placeholder="99.00"
                    required
                  />
                  <Input
                    name="currency"
                    label="Currency"
                    defaultValue="SGD"
                    pattern="[A-Z]{3}"
                    required
                  />
                </div>
                <div>
                  <Button type="submit" loading={busy} disabled={reason.trim().length < 3}>
                    Record subscription
                  </Button>
                </div>
              </form>
            </Card>
          </div>

          <div
            role="tabpanel"
            id="company-panel-modules"
            aria-labelledby="company-tab-modules"
            hidden={tab !== "modules"}
            tabIndex={0}
            className="pt-2"
          >
            <Card
              title="Module access"
              description="Core modules are always on. Add-ons are granted per company, and every change is recorded with a reason."
            >
              <Table
                caption="Company module access"
                rows={data.modules}
                rowKey={(row) => row.code}
                columns={MODULE_COLUMNS(busy, openModule)}
              />
              <p className="px-2 pt-3 text-xs text-ink-muted">
                A lapsed add-on keeps its date so the history stays readable; turning it back on
                grants it again from now.
              </p>
            </Card>
          </div>

          <div
            role="tabpanel"
            id="company-panel-activity"
            aria-labelledby="company-tab-activity"
            hidden={tab !== "activity"}
            tabIndex={0}
            className="pt-2"
          >
            <Card
              title="Company audit history"
              description="Every change made to this company, newest first."
              flush
            >
              {loading && audit ? (
                <p role="status" className="px-5 py-3 text-sm text-ink-muted">
                  Loading activity…
                </p>
              ) : null}

              {audit && audit.total === 0 ? (
                <EmptyState
                  title="No activity recorded yet."
                  description="Lifecycle changes, module grants and subscription records all appear here."
                />
              ) : null}

              {audit && audit.items.length ? (
                <ol className="divide-y divide-line-soft">
                  {audit.items.map((row) => (
                    <li key={row.id} className="px-5 py-3">
                      <p className="text-sm font-medium text-ink">{row.action}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        <time dateTime={row.createdAt}>
                          {new Date(row.createdAt).toLocaleString()}
                        </time>{" "}
                        ·{" "}
                        {row.actor
                          ? `${row.actor.name} (${row.actor.email})`
                          : "System / owner onboarding"}
                      </p>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-purple">
                          View technical details
                        </summary>
                        <pre className="mt-2 overflow-x-auto rounded-md bg-surface-2 p-3 text-2xs text-ink-body">
                          {JSON.stringify(row.metadata, null, 2)}
                        </pre>
                      </details>
                    </li>
                  ))}
                </ol>
              ) : null}

              {/* Driven by the server's total, not by what fits on this page. */}
              {audit && audit.total > 0 ? (
                <div className="px-5 py-3">
                  <Pagination
                    label="Audit history pages"
                    page={page}
                    pageCount={Math.max(1, Math.ceil(audit.total / audit.pageSize))}
                    onPageChange={(next) => {
                      setLoading(true);
                      setPage(next);
                    }}
                  />
                </div>
              ) : null}
            </Card>
          </div>
        </>
      ) : (
        <Card title="Administration unavailable">
          <div className="px-2 py-2">
            <Button
              variant="secondary"
              onClick={() => {
                setLoading(true);
                setRevision((value) => value + 1);
              }}
            >
              Retry administration
            </Button>
          </div>
        </Card>
      )}

      {/* Suspension and cancellation both sign out every company session, so
          they are confirmed against the reason already typed. */}
      <Modal
        open={confirmation !== null}
        onClose={() => setConfirmation(null)}
        size="sm"
        title={confirmation === "cancel" ? "Cancel this company?" : "Suspend this company?"}
        description={
          confirmation === "cancel"
            ? "Users will be blocked from signing in. The company keeps its data."
            : "All company sessions will be signed out. Users can sign in again with read-only access."
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>
              Keep current access
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => {
                if (confirmation) void lifecycle(confirmation);
              }}
            >
              Confirm {confirmation === "cancel" ? "cancellation" : "suspension"}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink-body">
          <span className="font-medium text-ink">Reason:</span> {reason}
        </p>
      </Modal>

      {/* Every module change carries a reason into the audit log, so the switch
          is the start of a confirmation rather than the change itself. */}
      <Modal
        open={moduleChange !== null}
        onClose={() => setModuleChange(null)}
        size="sm"
        title={
          moduleChange
            ? `${moduleChange.enabled ? "Turn on" : "Turn off"} ${moduleChange.name}?`
            : "Change module access"
        }
        description={
          moduleChange?.enabled
            ? "The company can use this module as soon as the change is saved."
            : "The company loses access immediately. Any data already recorded is kept."
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setModuleChange(null)}>
              Keep access as it is
            </Button>
            <Button
              variant={moduleChange?.enabled ? "primary" : "danger"}
              loading={busy}
              disabled={moduleReason.trim().length < 3}
              onClick={() => void saveModule()}
            >
              Confirm change
            </Button>
          </div>
        }
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void saveModule();
          }}
        >
          {moduleError ? (
            <p role="alert" className="rounded-md bg-danger/5 px-3 py-2.5 text-sm text-danger">
              {moduleError}
            </p>
          ) : null}
          <Input
            label="Reason for change"
            value={moduleReason}
            onChange={(event) => setModuleReason(event.target.value)}
            minLength={3}
            maxLength={500}
            required
            disabled={busy}
            placeholder="Explain why this change is needed"
            hint="Recorded in the company audit history."
          />
          {moduleChange?.enabled ? (
            <Input
              label="Expires at (optional)"
              value={moduleExpiry}
              onChange={(event) => setModuleExpiry(event.target.value)}
              placeholder="2026-11-23T00:00:00+08:00"
              disabled={busy}
              hint="Leave empty for no expiry. Include a timezone."
            />
          ) : null}
        </form>
      </Modal>
    </section>
  );
}
