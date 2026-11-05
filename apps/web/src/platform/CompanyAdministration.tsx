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
 *
 * The Subscription tab is `SubscriptionPanel`: it owns its own request, its own
 * reason and its own messages, so the `reason` state below belongs to lifecycle
 * and module changes only.
 *
 * Two more things were made honest after that:
 *
 * 3. **The lifecycle reason lives in the confirmation.** Suspending, cancelling
 *    and reactivating each open their own dialog asking why. A single "Change
 *    reason" box above three buttons read as a property of the company.
 * 4. **A module expiry is a date, not a typed instant.** It was a free-text ISO
 *    field (`2026-11-23T00:00:00+08:00`) that only a developer could fill in
 *    twice the same way; it is now a date picker plus three duration presets,
 *    and `dayToLocalInstant` writes the offset. Modules with no screen behind
 *    them say so and stay switched off — `UNENFORCED_MODULE_CODES`.
 *
 * Two more, both about not offering a request that cannot work:
 *
 * 5. **A lifecycle button that cannot do anything is dimmed, and the reason is on
 *    screen.** All three used to be live whatever the company's status, so
 *    "Reactivate" on an active company and "Suspend" on a suspended one existed only
 *    to answer `409`. `tenantStatus.ts` holds the rules the API already enforces,
 *    the card shows the effective status beside them, and the sentence under the
 *    badge says why the dimmed one is dimmed — a disabled button takes no hover, so
 *    a tooltip would be a tooltip nobody can read.
 * 6. **Module access can move for every add-on at once.** Granting nine add-ons was
 *    nine confirmations, nine reasons and nine audit rows for one decision. Two
 *    header buttons carry one reason and, when granting, one expiry for the whole
 *    batch (`POST /:id/modules/bulk`). The server decides the set — core modules and
 *    `UNENFORCED_MODULE_CODES` are never touched — and an add-on already in the
 *    target state comes back as `unchanged` instead of having its own expiry
 *    rewritten.
 */
import { useEffect, useState } from "react";
import type {
  CompanyAdministration as Administration,
  CompanyAudit,
  CompanyLifecycleInput,
} from "@glampro_suite/shared";
import {
  companyLifecycleSchema,
  companyModuleSchema,
  companyModulesBulkSchema,
  UNENFORCED_MODULE_CODES,
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
import { dayToLocalInstant, formatDateInputValue } from "@/lib/utils";
import { platformApi } from "./api";
import type { DetailTab } from "./DetailTabs";
import SubscriptionPanel from "./SubscriptionPanel";
import {
  TENANT_STATUS_LABEL,
  TENANT_STATUS_TONE,
  canCancel,
  canReactivate,
  canSuspend,
  latestPeriod,
  runningPeriod,
} from "./tenantStatus";

type ModuleRow = Administration["modules"][number];
/**
 * One module, or every add-on at once.
 *
 * Both open the same dialog: the reason field, the expiry picker and the presets are
 * identical, and only the sentence above them and the request underneath differ. Two
 * dialogs would be two places to keep the expiry rules right.
 */
type ModuleChange =
  | { scope: "one"; code: string; name: string; enabled: boolean }
  | { scope: "all"; enabled: boolean };

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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Tomorrow, as a date picker's value.
 *
 * An expiry of "today" is already over once it is stored at midnight, so the
 * earliest day the picker offers is the first one that is still in the future.
 */
function tomorrowDay(): string {
  return formatDateInputValue(new Date(Date.now() + DAY_MS));
}

/**
 * The durations an operator actually grants, as one click each.
 *
 * `day` is a function, not a value: a component that read the clock once at
 * import time would offer the wrong date tomorrow.
 */
const EXPIRY_PRESETS: Array<{ label: string; day: () => string }> = [
  { label: "30 days", day: () => formatDateInputValue(new Date(Date.now() + 30 * DAY_MS)) },
  { label: "90 days", day: () => formatDateInputValue(new Date(Date.now() + 90 * DAY_MS)) },
  { label: "1 year", day: () => formatDateInputValue(new Date(Date.now() + 365 * DAY_MS)) },
];

/**
 * The add-ons with nothing behind them yet, as a set so the column lookup stays
 * O(1) per row.
 *
 * They are in the catalogue, so the server lists them; there is no `requireModule`
 * guard and no screen for any of them, so a grant changes nothing at all. The
 * switch is disabled and the row says why — an operator who flips a switch and
 * sees no change learns only that the console lies.
 */
const UNENFORCED = new Set<string>(UNENFORCED_MODULE_CODES);

/** An add-on a bulk change may touch: not core, and with a screen behind it. */
function isAddOn(row: ModuleRow): boolean {
  return !row.isCore && !UNENFORCED.has(row.code);
}

/**
 * The count an operator needs before pressing a bulk button.
 *
 * "3 of 6 add-ons on" says how much a bulk change could move without opening the
 * dialog, and the lapsed count is the part that is easy to miss: a lapsed grant reads
 * as off on its switch and is still a row that "Turn all off" has to clear.
 */
function addOnSummary(rows: ModuleRow[]): string {
  if (!rows.length) return "This catalogue has no add-ons.";
  const on = rows.filter((row) => row.entitled).length;
  const lapsed = rows.filter(isExpired).length;
  const base = `${on} of ${rows.length} add-ons on`;
  return lapsed ? `${base}, ${lapsed} lapsed.` : `${base}.`;
}

/**
 * What a bulk change did, in one line.
 *
 * Both counts are reported: an operator who turns everything on in a company that
 * already had four add-ons needs to read that nothing was overwritten, not a cheerful
 * "9 add-ons turned on" that is false.
 */
function bulkNotice(enabled: boolean, changed: number, unchanged: number): string {
  const verb = enabled ? "on" : "off";
  const moved = `${changed} add-on${changed === 1 ? "" : "s"} turned ${verb}.`;
  if (!unchanged) return moved;
  return `${moved} ${unchanged} ${unchanged === 1 ? "was" : "were"} already ${verb} and left alone.`;
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
        disabled={row.isCore || UNENFORCED.has(row.code)}
        loading={busy}
        onChange={() => onToggle(row)}
        description={
          row.isCore
            ? "Always available to this company."
            : UNENFORCED.has(row.code)
              ? "Not available in this release — there is no screen behind it yet, so granting it changes nothing."
              : row.entitled
                ? `Granted${row.expiresAt ? ` until ${formatExpiry(row.expiresAt)}` : " with no expiry"}.`
                : isExpired(row)
                  ? `Expired ${formatExpiry(row.expiresAt)}. Turning it back on grants it again.`
                  : "Not granted. Turning it on grants access immediately."
        }
        meta={
          row.isCore ? (
            <Badge variant="purple">Core</Badge>
          ) : UNENFORCED.has(row.code) ? (
            <Badge>Not in this release</Badge>
          ) : null
        }
      />
    ),
  },
  {
    key: "access",
    header: "Access",
    cell: (row) =>
      row.isCore ? (
        <Badge variant="purple">Core</Badge>
      ) : UNENFORCED.has(row.code) ? (
        <Badge>Unavailable</Badge>
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

/**
 * What each lifecycle confirmation says, and what its button is called.
 *
 * `confirm` is deliberately not the same words as the button that opened it: the
 * card has "Suspend company" and the dialog has "Confirm suspension", so a click
 * on either is unambiguous in a screen reader's list of buttons.
 */
const LIFECYCLE_COPY: Record<
  CompanyLifecycleInput["action"],
  { title: string; description: string; confirm: string; tone: "primary" | "secondary" | "danger" }
> = {
  suspend: {
    title: "Suspend this company?",
    description:
      "All company sessions are signed out. Users can sign in again with read-only access.",
    confirm: "Confirm suspension",
    tone: "danger",
  },
  reactivate: {
    title: "Reactivate this company?",
    description:
      "Access returns only while a period is running. A period that starts later brings no access forward.",
    confirm: "Confirm reactivation",
    tone: "primary",
  },
  cancel: {
    title: "Cancel this company?",
    description: "Users are blocked from signing in. The company keeps its data.",
    confirm: "Confirm cancellation",
    tone: "danger",
  },
};

/** The sentence above a module dialog, for one module or for the whole batch. */
function moduleChangeTitle(change: ModuleChange | null): string {
  if (!change) return "Change module access";
  const verb = change.enabled ? "Turn on" : "Turn off";
  return change.scope === "all" ? `${verb} every add-on?` : `${verb} ${change.name}?`;
}

function moduleChangeDescription(change: ModuleChange | null): string {
  if (!change?.enabled)
    return change?.scope === "all"
      ? "Every granted add-on is removed, lapsed ones included. Any data already recorded is kept."
      : "The company loses access immediately. Any data already recorded is kept.";
  return change.scope === "all"
    ? "Every add-on that is off or lapsed is granted from now. Add-ons that are already on keep their own expiry."
    : "The company can use this module as soon as the change is saved.";
}

/**
 * Why a lifecycle button is dimmed, and what applies to this company now.
 *
 * It has to be text on the screen. A disabled button takes no hover and no focus, so
 * a tooltip explaining one is a tooltip nobody can read; the sentence sits beside the
 * status badge, where the operator is already looking.
 *
 * Each branch says what the *state* is, then what the enabled buttons will do, and
 * the one about a period that has not been recorded yet is deliberately not the same
 * sentence as one about a period that ended: a suspended company with nothing on the
 * Subscription tab can be reactivated, one whose period lapsed cannot.
 */
function lifecycleHint(data: Administration, now: number): string {
  const running = runningPeriod(data.subscriptions, now);
  const latest = latestPeriod(data.subscriptions, now);
  const until = running ? ` until ${formatExpiry(running.endDate)}` : "";
  switch (data.effectiveStatus) {
    case "ACTIVE":
      return `Access is running${until}. Suspending makes the company read-only for the rest of it; cancelling blocks it now.`;
    case "SUSPENDED":
      if (running)
        return `Suspended. Reactivating restores access${until}; cancelling blocks it for good.`;
      if (latest)
        return `Suspended, and its last period ended on ${formatExpiry(latest.endDate)}. Record a period on the Subscription tab and reactivate then, or cancel the company.`;
      return "Suspended, with no period recorded yet. Reactivating sets the company back to Active; a period on the Subscription tab is what grants access.";
    case "EXPIRED":
      if (data.status === "ACTIVE")
        return "The last period has ended, so access is closed. Suspension is for a company that is still running — record a new period on the Subscription tab, or cancel the company.";
      if (latest)
        return "Access has expired. Reactivating sets the company back to Active while a period is running, so record one on the Subscription tab first.";
      return "Expired, with no period recorded. Reactivating sets the company back to Active, though access still comes from a period on the Subscription tab.";
    case "CANCELLED":
      if (running)
        return `Cancelled. Reactivating undoes that while the current period runs${until}.`;
      if (latest)
        return `Cancelled, and its last period ended on ${formatExpiry(latest.endDate)}. A new period on the Subscription tab is what a reactivation needs.`;
      return "Cancelled, with no period recorded yet. Reactivating undoes the cancellation; access itself still comes from a period.";
  }
}

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
  /** Which lifecycle change is being confirmed, and that modal's own draft. */
  const [confirmation, setConfirmation] = useState<CompanyLifecycleInput["action"] | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [lifecycleError, setLifecycleError] = useState("");
  const [loading, setLoading] = useState(true);
  /** The module a toggle is asking about, plus that modal's own draft. */
  const [moduleChange, setModuleChange] = useState<ModuleChange | null>(null);
  const [moduleReason, setModuleReason] = useState("");
  /** The expiry day the picker holds (`YYYY-MM-DD`); empty means no expiry. */
  const [moduleExpiry, setModuleExpiry] = useState("");
  const [moduleError, setModuleError] = useState("");

  // One clock read per mount, as in `SubscriptionPanel`: the purity rule forbids
  // `Date.now()` during render, and "is a period running now" does not need to tick
  // while the tab is open.
  const [now] = useState(() => Date.now());
  /**
   * What the stored status and the periods allow, and why.
   *
   * `null` until the snapshot arrives; the card is only rendered with data, and a
   * missing answer dims a button rather than offering a request that would be refused.
   */
  const access = data
    ? {
        suspend: canSuspend(data.effectiveStatus),
        reactivate: canReactivate(data.status, data.subscriptions, now),
        cancel: canCancel(data.status),
        hint: lifecycleHint(data, now),
      }
    : null;
  /** The add-ons a bulk change may touch, and which of the two buttons would move any. */
  const addOns = (data?.modules ?? []).filter(isAddOn);
  const canTurnAllOn = addOns.some((row) => !row.entitled);
  const canTurnAllOff = addOns.some((row) => row.enabled);

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
  async function perform(
    action: () => Promise<void>,
    onError?: (message: string) => void,
    /**
     * Called only after the request succeeded, so a caller can report what actually
     * moved ("9 add-ons turned on") instead of the generic confirmation.
     */
    successNotice?: () => string,
  ) {
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(successNotice ? successNotice() : "Change saved. Audit history will refresh.");
      setLifecycleReason("");
      setLifecycleError("");
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

  /**
   * Open the confirmation for one lifecycle change.
   *
   * The reason starts empty every time: a reason typed for a suspension is not a
   * reason for a cancellation, and carrying it over would let the audit log claim
   * a motive the operator never wrote.
   */
  function openLifecycle(action: CompanyLifecycleInput["action"]) {
    setConfirmation(action);
    setLifecycleReason("");
    setLifecycleError("");
  }

  async function lifecycle(action: CompanyLifecycleInput["action"]) {
    await perform(async () => {
      const input = companyLifecycleSchema.safeParse({ action, reason: lifecycleReason });
      if (!input.success) throw new Error(input.error.issues[0].message);
      await platformApi.lifecycle(id, input.data);
    }, setLifecycleError);
  }

  /**
   * Re-read the company after the subscription panel records a period.
   *
   * It deliberately does not touch `error`/`notice`: the panel reports its own
   * outcome inside itself, and `perform`'s "Change saved" banner would claim a
   * change this component did not make.
   */
  async function refresh() {
    setLoading(true);
    setRevision((value) => value + 1);
    await onChange();
  }

  function openModule(row: ModuleRow) {
    setModuleChange({ scope: "one", code: row.code, name: row.name, enabled: !row.entitled });
    setModuleReason("");
    setModuleExpiry("");
    setModuleError("");
  }

  /** The same dialog as one module, with the whole add-on set behind it. */
  function openBulkChange(enabled: boolean) {
    setModuleChange({ scope: "all", enabled });
    setModuleReason("");
    setModuleExpiry("");
    setModuleError("");
  }

  /** Driven from the modal's footer button and from Enter inside its form. */
  async function saveModule() {
    const target = moduleChange;
    if (!target) return;
    // The picker knows a day; the API stores an instant. `dayToLocalInstant` writes
    // that day's midnight with the operator's own offset attached, so the day they
    // picked is the day the grant ends, in no other timezone.
    const expiresAt = target.enabled && moduleExpiry ? dayToLocalInstant(moduleExpiry) : null;
    if (target.enabled && moduleExpiry && !expiresAt) {
      setModuleError("Choose a valid expiry date.");
      return;
    }
    if (target.scope === "all") {
      const input = companyModulesBulkSchema.safeParse({
        enabled: target.enabled,
        expiresAt,
        reason: moduleReason,
      });
      if (!input.success) {
        setModuleError(input.error.issues[0].message);
        return;
      }
      // The counts are read out of the action, because the notice has to say what the
      // server did — the console asked for "every add-on", and the server decides
      // which ones were not already there.
      let changed = 0;
      let unchanged = 0;
      await perform(
        async () => {
          const result = await platformApi.changeModules(id, input.data);
          changed = result.changed.length;
          unchanged = result.unchanged.length;
        },
        setModuleError,
        () => bulkNotice(target.enabled, changed, unchanged),
      );
      return;
    }
    await perform(async () => {
      const input = companyModuleSchema.safeParse({
        code: target.code,
        enabled: target.enabled,
        // A revocation has nothing to expire; the schema rejects a stray date.
        expiresAt,
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
              title="Company access"
              description="Suspending, reactivating and cancelling this company."
            >
              <div className="flex flex-col gap-4 px-2 pt-2 pb-1">
                {/* The status the buttons below are gated on, and the sentence that
                    says why a dimmed one is dimmed. */}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={TENANT_STATUS_TONE[data.effectiveStatus]} dot>
                    {TENANT_STATUS_LABEL[data.effectiveStatus]}
                  </Badge>
                  <p className="text-sm text-ink-body">{access?.hint}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={busy || !access?.suspend}
                    onClick={() => openLifecycle("suspend")}
                  >
                    Suspend company
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy || !access?.reactivate}
                    onClick={() => openLifecycle("reactivate")}
                  >
                    Reactivate company
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy || !access?.cancel}
                    onClick={() => openLifecycle("cancel")}
                  >
                    Cancel company
                  </Button>
                </div>

                <p className="text-xs text-ink-muted">
                  Every change here signs out all company sessions and asks why, recording the
                  reason with the change. Suspension allows a new read-only sign-in; cancellation
                  blocks access altogether.
                </p>
              </div>
            </Card>

            <SubscriptionPanel
              companyId={id}
              effectiveStatus={data.effectiveStatus}
              subscriptions={data.subscriptions}
              onRecorded={refresh}
              onBusyChange={onBusyChange}
            />
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
              actions={
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || !canTurnAllOn}
                    onClick={() => openBulkChange(true)}
                  >
                    Turn all on
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || !canTurnAllOff}
                    onClick={() => openBulkChange(false)}
                  >
                    Turn all off
                  </Button>
                </div>
              }
            >
              {/* The count comes before the table: it says how much the two buttons
                  above could move, and the lapsed number is the part a switch reads
                  as "off" and still leaves a row behind. */}
              <p className="px-2 pt-2 text-sm text-ink-body">{addOnSummary(addOns)}</p>
              <Table
                caption="Company module access"
                rows={data.modules}
                rowKey={(row) => row.code}
                columns={MODULE_COLUMNS(busy, openModule)}
              />
              <div className="flex flex-col gap-1 px-2 pt-3 text-xs text-ink-muted">
                <p>
                  A lapsed add-on keeps its date so the history stays readable; turning it back on
                  grants it again from now.
                </p>
                <p>
                  An add-on the console marks as not in this release has no screen behind it yet, so
                  its switch stays off — granting it would change nothing a salon could see.
                </p>
                <p>
                  A bulk change is one decision: every add-on that is off (or lapsed) is granted, or
                  every granted add-on is removed, under a single reason and — when granting — a
                  single expiry. Core modules, add-ons not in this release, and add-ons already in
                  that state are left alone.
                </p>
              </div>
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

      {/* One confirmation per lifecycle change. The reason moved in here from the
          card: sitting above three buttons, it read as a property of the company
          rather than of the change about to be made. */}
      <Modal
        open={confirmation !== null}
        onClose={() => setConfirmation(null)}
        size="sm"
        title={confirmation ? LIFECYCLE_COPY[confirmation].title : "Company access"}
        description={confirmation ? LIFECYCLE_COPY[confirmation].description : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>
              Keep current access
            </Button>
            <Button
              type="submit"
              form="company-lifecycle-form"
              variant={confirmation ? LIFECYCLE_COPY[confirmation].tone : "primary"}
              loading={busy}
              disabled={lifecycleReason.trim().length < 3}
            >
              {confirmation ? LIFECYCLE_COPY[confirmation].confirm : "Confirm change"}
            </Button>
          </div>
        }
      >
        <form
          id="company-lifecycle-form"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (confirmation) void lifecycle(confirmation);
          }}
        >
          {lifecycleError ? (
            <p role="alert" className="rounded-md bg-danger/5 px-3 py-2.5 text-sm text-danger">
              {lifecycleError}
            </p>
          ) : null}
          <Input
            label="Reason for change"
            value={lifecycleReason}
            onChange={(event) => setLifecycleReason(event.target.value)}
            minLength={3}
            maxLength={500}
            required
            disabled={busy}
            placeholder="Explain why this change is needed"
            hint="Recorded in the company audit history."
          />
        </form>
      </Modal>

      {/* Every module change carries a reason into the audit log, so the switch
          is the start of a confirmation rather than the change itself. */}
      <Modal
        open={moduleChange !== null}
        onClose={() => setModuleChange(null)}
        size="sm"
        title={moduleChangeTitle(moduleChange)}
        description={moduleChangeDescription(moduleChange)}
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
            <div className="flex flex-col gap-2">
              <Input
                label="Expires at (optional)"
                type="date"
                value={moduleExpiry}
                min={tomorrowDay()}
                onChange={(event) => setModuleExpiry(event.target.value)}
                disabled={busy}
                hint="Leave empty for no expiry. The grant ends at midnight on this day, in your own timezone."
              />
              {/* The three durations an operator actually grants, as buttons: a
                  date picker alone makes "a year from now" three clicks and a
                  count on your fingers. */}
              <div className="flex flex-wrap items-center gap-2">
                {EXPIRY_PRESETS.map((preset) => (
                  <Button
                    key={preset.label}
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setModuleExpiry(preset.day())}
                  >
                    {preset.label}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setModuleExpiry("")}
                >
                  No expiry
                </Button>
              </div>
            </div>
          ) : null}
        </form>
      </Modal>
    </section>
  );
}
