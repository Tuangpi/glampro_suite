/**
 * Settings — focused categories for salon configuration and account security.
 * Categories mount on first visit and remain mounted while hidden, preserving
 * unsaved drafts without loading every settings query on arrival.
 *
 * Two boundaries this screen keeps rather than re-invents:
 *
 * - **`slug` and `status` are shown, never edited.** The first is the isolation
 *   key's public face and the second is the platform console's verdict; the
 *   PATCH contract is `.strict()` so a field smuggled in is a 422, not a silent
 *   write (AGENTS.md: nothing that belongs to the platform console is editable
 *   here).
 * - **The team summary reads `GET /api/staff`** — the same endpoint the staff
 *   screen reads. A second "summary" endpoint could disagree with the team
 *   page, and one question gets one answer (ADR 0010's shape).
 */
import { useState } from "react";
import PrivacyNoticeCard from "@/components/settings/PrivacyNoticeCard";
import MessagingCard from "@/components/settings/MessagingCard";
import ResourcesCard from "@/components/settings/ResourcesCard";
import CommissionRules from "@/components/settings/CommissionRules";

import { Link, useSearchParams } from "react-router";
import Outlets from "@/pages/Outlets";

import type {
  ModuleSummary,
  StaffSummary,
  UpdateSalonOperatingHoursInput,
} from "@glampro_suite/shared";

import { Briefcase, Settings as SettingsIcon } from "@/components/icons";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Checkbox from "@/components/ui/Checkbox";
import Input from "@/components/ui/Input";
import Skeleton from "@/components/ui/Skeleton";
import Table, { type TableColumn } from "@/components/ui/Table";
import { showToast } from "@/components/ui/toast-store";
import { ROLE_BADGE, ROLE_LABELS } from "@/constants/staff";
import { useAuth } from "@/contexts/AuthContext";
import {
  useModules,
  useSalonOperatingHours,
  useSalonProfile,
  useUpdateSalonOperatingHours,
  useUpdateSalonProfile,
} from "@/hooks/useSettings";
import { useStaffList } from "@/hooks/useStaff";
import { getErrorMessage, getValidationDetails } from "@/lib/api";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

import TwoFactorCard from "@/components/TwoFactorCard";

const SETTINGS_SECTIONS = [
  { id: "salon", label: "Salon details", description: "Business details, tax and preferences." },
  {
    id: "outlets",
    label: "Outlets",
    description: "Manage branches, opening hours and catalogue availability.",
  },
  {
    id: "booking",
    label: "Booking & hours",
    description: "Online booking, opening hours and resources.",
  },
  {
    id: "team",
    label: "Team & commissions",
    description: "Your team and company commission defaults.",
  },
  {
    id: "messages",
    label: "Customer messages",
    description: "WhatsApp, SMS and appointment reminders.",
  },
  {
    id: "privacy",
    label: "Privacy & security",
    description: "Salon privacy notices and your account security.",
  },
  {
    id: "features",
    label: "Features",
    description: "Features included in your salon's subscription.",
  },
] as const;

type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

export default function Settings() {
  const { isReadOnly, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const activeSection =
    SETTINGS_SECTIONS.find((section) => section.id === requestedSection)?.id ?? "salon";
  const [visited, setVisited] = useState<SettingsSection[]>([activeSection]);

  const canEdit =
    !isReadOnly && (user?.globalRole === "SUPER_ADMIN" || user?.globalRole === "MANAGER");

  function selectSection(section: SettingsSection) {
    setVisited((current) => [...new Set([...current, activeSection, section])]);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("section", section);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-xl">Settings</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Manage your salon and preferences. Choose a category to get started.
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-6">
          <label className="flex flex-col gap-2 text-sm font-medium lg:hidden">
            Settings category
            <select
              className="h-control rounded-md border border-line bg-surface px-3 text-ink"
              value={activeSection}
              onChange={(event) => selectSection(event.target.value as SettingsSection)}
            >
              {SETTINGS_SECTIONS.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.label}
                </option>
              ))}
            </select>
          </label>
          <nav aria-label="Settings categories" className="hidden flex-col gap-1 lg:flex">
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                aria-current={activeSection === section.id ? "page" : undefined}
                aria-controls={`settings-${section.id}`}
                onClick={() => selectSection(section.id)}
                className={`rounded-lg px-4 py-3 text-left text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-purple ${
                  activeSection === section.id
                    ? "bg-purple/10 text-purple"
                    : "text-ink-muted hover:bg-surface-muted hover:text-ink"
                }`}
              >
                {section.label}
              </button>
            ))}
          </nav>
          <p className="mt-4 text-xs text-ink-muted">
            Drafts stay here when you switch categories. Save each form before leaving Settings.
          </p>
        </aside>
        <div className="min-w-0">
          {SETTINGS_SECTIONS.map((section) => (
            <section
              key={section.id}
              id={`settings-${section.id}`}
              aria-labelledby={`settings-heading-${section.id}`}
              hidden={activeSection !== section.id}
            >
              {(activeSection === section.id || visited.includes(section.id)) && (
                <div className="flex flex-col gap-5">
                  <header>
                    <h3
                      id={`settings-heading-${section.id}`}
                      className="text-lg font-bold text-ink"
                    >
                      {section.label}
                    </h3>
                    <p className="mt-1 text-sm text-ink-muted">{section.description}</p>
                  </header>
                  {section.id === "salon" && <ProfileCard canEdit={canEdit} />}
                  {section.id === "outlets" && <Outlets />}
                  {section.id === "booking" && (
                    <>
                      <ProfileCard canEdit={canEdit} booking />
                      <OperatingHoursCard canEdit={canEdit} />
                      <ResourcesCard canEdit={canEdit} />
                    </>
                  )}
                  {section.id === "team" && <TeamSettings canEdit={canEdit} />}
                  {section.id === "messages" && <MessagingCard canEdit={canEdit} />}
                  {section.id === "privacy" && (
                    <>
                      <TwoFactorCard />
                      <PrivacyNoticeCard canEdit={canEdit} />
                    </>
                  )}
                  {section.id === "features" && <FeatureSettings />}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function FeatureSettings() {
  const modules = useModules();
  return (
    <ModulesCard modules={modules.data} isPending={modules.isPending} isError={modules.isError} />
  );
}

function TeamSettings({ canEdit }: { canEdit: boolean }) {
  const { user } = useAuth();
  const team = useStaffList({ page: 1, pageSize: 50, status: "active" });
  return (
    <>
      <TeamCard
        rows={team.data?.data ?? []}
        total={team.data?.total ?? 0}
        isPending={team.isPending}
        isError={team.isError}
      />
      {(user?.globalRole === "SUPER_ADMIN" || user?.globalRole === "MANAGER") && (
        <CommissionRules canEdit={canEdit} />
      )}
    </>
  );
}

/** Salon profile and salon-wide localisation preferences. */
function ProfileCard({ canEdit, booking = false }: { canEdit: boolean; booking?: boolean }) {
  const { formatDate } = useSalonFormatting();
  const { tenant } = useAuth();
  const profile = useSalonProfile(tenant?.id);
  const update = useUpdateSalonProfile();
  const data = profile.data;

  // Editable fields show the server's values until the user types, and
  // the user's from then on. Deliberately **not** an effect that seeds state: the
  // read lands after mount, and a write-back would clobber a half-typed name
  // whenever the profile refetched behind the form.
  const [draftName, setDraftName] = useState<string | null>(null);
  const [draftThreshold, setDraftThreshold] = useState<string | null>(null);
  const [draftTimeZone, setDraftTimeZone] = useState<string | null>(null);
  const [draftLocale, setDraftLocale] = useState<string | null>(null);
  const [draftGstEnabled, setDraftGstEnabled] = useState<boolean | null>(null);
  const [draftGstNumber, setDraftGstNumber] = useState<string | null>(null);
  const [draftOnlineEnabled, setDraftOnlineEnabled] = useState<boolean | null>(null);
  const [draftOnlineDeposit, setDraftOnlineDeposit] = useState<string | null>(null);
  const [draftOnlineNoShow, setDraftOnlineNoShow] = useState<string | null>(null);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const name = draftName ?? data?.name ?? "";
  const threshold = draftThreshold ?? (data === undefined ? "" : String(data.lowStockThreshold));
  const timeZone = draftTimeZone ?? data?.timeZone ?? "";
  const locale = draftLocale ?? data?.locale ?? "";
  const gstEnabled = draftGstEnabled ?? data?.gstEnabled ?? false;
  const gstRegistrationNumber = draftGstNumber ?? data?.gstRegistrationNumber ?? "";
  const onlineEnabled = draftOnlineEnabled ?? data?.onlineBookingEnabled ?? false;
  const onlineDeposit =
    draftOnlineDeposit ?? (data === undefined ? "" : (data.onlineDepositAmount / 100).toFixed(2));
  const onlineNoShow =
    draftOnlineNoShow ?? (data === undefined ? "" : (data.onlineNoShowFee / 100).toFixed(2));

  const fieldError = (field: string): string | undefined =>
    fieldErrors[field] ?? fieldErrors[`body.${field}`];

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);

    try {
      await update.mutateAsync(
        booking
          ? {
              // The existing API requires these two fields on every profile write.
              // Use saved values, never the other category's unsaved draft.
              name: data!.name,
              lowStockThreshold: data!.lowStockThreshold,
              onlineBookingEnabled: onlineEnabled,
              onlineDepositAmount: Math.round(Number(onlineDeposit || 0) * 100),
              onlineNoShowFee: Math.round(Number(onlineNoShow || 0) * 100),
            }
          : {
              name: name.trim(),
              lowStockThreshold: Number(threshold),
              timeZone: timeZone.trim(),
              locale: locale.trim(),
              // Always sent: the toggle is a checkbox, so "untouched" and "off"
              // are the same unchecked state and omitting it would never uncheck.
              gstEnabled,
              gstRegistrationNumber:
                gstRegistrationNumber.trim().length > 0 ? gstRegistrationNumber.trim() : null,
            },
      );
      showToast("success", booking ? "Booking settings saved." : "Salon profile saved.");
    } catch (error) {
      const details = getValidationDetails(error);
      if (Object.keys(details).length > 0) {
        setFieldErrors(details);
        return;
      }
      setFormError(getErrorMessage(error));
    }
  }

  return (
    <Card
      title={booking ? "Online booking" : "Salon profile"}
      description={
        booking
          ? "Choose whether customers can book online and set your booking fees."
          : "Your business name, regional preferences and tax settings."
      }
    >
      {profile.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </div>
      ) : profile.isError || data === undefined ? (
        // Not pending and no record: the read failed, or answered nothing. Either
        // way there is no profile to edit, which is the same sentence to a user.
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          The profile could not be loaded.
        </p>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError ? (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {formError}
            </p>
          ) : null}

          {!booking && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Salon name"
                  required
                  value={name}
                  onChange={(event) => setDraftName(event.target.value)}
                  error={fieldError("name")}
                  disabled={!canEdit || update.isPending}
                  maxLength={200}
                />
                <Input
                  label="Low-stock threshold"
                  type="number"
                  min={0}
                  max={10000}
                  value={threshold}
                  onChange={(event) => setDraftThreshold(event.target.value)}
                  error={fieldError("lowStockThreshold")}
                  disabled={!canEdit || update.isPending}
                  hint="Products with stock at or below this quantity are marked as low stock."
                />
                <Input
                  label="Salon timezone"
                  required
                  value={timeZone}
                  onChange={(event) => setDraftTimeZone(event.target.value)}
                  error={fieldError("timeZone")}
                  disabled={!canEdit || update.isPending}
                  maxLength={100}
                  hint="Use a timezone identifier, such as Asia/Singapore. Saved for the whole salon."
                />
                <Input
                  label="Formatting locale"
                  required
                  value={locale}
                  onChange={(event) => setDraftLocale(event.target.value)}
                  error={fieldError("locale")}
                  disabled={!canEdit || update.isPending}
                  maxLength={100}
                  hint="Use a locale identifier, such as en-SG. This preference does not translate the app."
                />
              </div>

              <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3">
                <Checkbox
                  label="Charge GST (9% inclusive)"
                  checked={gstEnabled}
                  disabled={!canEdit || update.isPending}
                  onChange={(event) => setDraftGstEnabled(event.target.checked)}
                />
                {gstEnabled && (
                  <Input
                    label="GST registration number"
                    required={gstEnabled}
                    value={gstRegistrationNumber}
                    onChange={(event) => setDraftGstNumber(event.target.value)}
                    error={fieldError("gstRegistrationNumber")}
                    disabled={!canEdit || update.isPending}
                    maxLength={50}
                    hint="Printed on receipts and tax reports. Required while GST is enabled."
                  />
                )}
                <p className="text-xs text-ink-muted">
                  Catalogue prices include 9% GST when enabled; the till shows the GST component on
                  receipts and reports without changing what the customer pays.
                </p>
              </div>
            </>
          )}

          {booking && (
            <div className="flex flex-col gap-3">
              <Checkbox
                label="Enable online booking"
                checked={onlineEnabled}
                disabled={!canEdit || update.isPending}
                onChange={(event) => setDraftOnlineEnabled(event.target.checked)}
              />
              {onlineEnabled && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Deposit amount (SGD)"
                    type="number"
                    min={0}
                    step="0.01"
                    value={onlineDeposit}
                    onChange={(event) => setDraftOnlineDeposit(event.target.value)}
                    error={fieldError("onlineDepositAmount")}
                    disabled={!canEdit || update.isPending}
                  />
                  <Input
                    label="No-show fee (SGD)"
                    type="number"
                    min={0}
                    step="0.01"
                    value={onlineNoShow}
                    onChange={(event) => setDraftOnlineNoShow(event.target.value)}
                    error={fieldError("onlineNoShowFee")}
                    disabled={!canEdit || update.isPending}
                  />
                </div>
              )}
              <p className="text-xs text-ink-muted">
                Amounts are in Singapore dollars. Set a fee to 0 for no charge.
              </p>
            </div>
          )}

          {!booking && (
            <details className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer text-sm font-medium text-ink">
                Account details
              </summary>
              <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <Fact label="Salon identifier" value={data.slug} />
                <Fact label="Status" value={data.status} />
                <Fact label="Owner" value={data.owner?.name ?? "—"} />
                <Fact label="Created" value={formatDate(data.createdAt)} />
              </dl>
              <p className="text-xs text-ink-muted">
                Your salon identifier and account status are read-only. Contact support if they need
                to change.
              </p>
            </details>
          )}

          {canEdit ? (
            <div className="flex justify-end">
              <Button type="submit" loading={update.isPending}>
                {booking ? "Save booking settings" : "Save profile"}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-ink-muted">
              {booking
                ? "Only a manager or the owner can change booking settings."
                : isReadOnlyReason()}
            </p>
          )}
        </form>
      )}
    </Card>
  );
}

/** Why the save button is absent — one sentence rather than a dead control. */
function isReadOnlyReason(): string {
  return "Only a manager or the owner can change the salon profile.";
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="font-bold text-ink">{value}</dd>
    </div>
  );
}

/** The modules panel: what the catalogue offers and what this salon may use. */
function ModulesCard({
  modules,
  isPending,
  isError,
}: {
  modules: ModuleSummary[] | undefined;
  isPending: boolean;
  isError: boolean;
}) {
  const { formatDate } = useSalonFormatting();
  const columns: TableColumn<ModuleSummary>[] = [
    {
      key: "name",
      header: "Module",
      cell: (row) => <span className="font-bold text-ink">{row.name}</span>,
    },
    { key: "category", header: "Type", cell: (row) => row.category },
    {
      key: "access",
      header: "Access",
      cell: (row) =>
        row.entitled ? (
          <Badge variant={row.isCore ? "purple" : "success"}>
            {row.isCore ? "Core" : "Active"}
          </Badge>
        ) : (
          <Badge variant="neutral">Not purchased</Badge>
        ),
    },
    {
      key: "expires",
      header: "Renews",
      cell: (row) => (row.expiresAt ? formatDate(row.expiresAt) : "—"),
    },
  ];

  return (
    <Card
      title="Modules"
      description="View the features available to your salon. Contact support to change your subscription."
    >
      {isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : isError ? (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          The module list could not be loaded.
        </p>
      ) : (
        <Table
          caption="Modules this salon has access to"
          columns={columns}
          rows={modules ?? []}
          rowKey={(row) => row.code}
          className="rounded-none border-0"
        />
      )}
    </Card>
  );
}

/** Staff and roles — the same rows the staff screen lists, summarised here. */
function TeamCard({
  rows,
  total,
  isPending,
  isError,
}: {
  rows: StaffSummary[];
  total: number;
  isPending: boolean;
  isError: boolean;
}) {
  const columns: TableColumn<StaffSummary>[] = [
    {
      key: "name",
      header: "Name",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-bold text-ink">{row.name}</p>
          <p className="truncate text-xs text-ink-muted">{row.email}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (row) => (
        <Badge variant={ROLE_BADGE[row.globalRole]}>{ROLE_LABELS[row.globalRole]}</Badge>
      ),
    },
    { key: "position", header: "Position", cell: (row) => row.position ?? "—" },
  ];

  return (
    <Card
      title="Staff and roles"
      description={
        isPending
          ? "Loading the team…"
          : `${total} active ${total === 1 ? "account" : "accounts"} in this salon.`
      }
      actions={
        // A link, not a `Button`: it navigates, and the rail's own styles are
        // what make it look like one — a button that pretends to be a link is
        // the wrong element for Enter and middle-click alike.
        <Link
          to="/staff"
          className="inline-flex h-control items-center gap-1.5 rounded-md border border-line px-4 text-sm font-medium text-ink-body transition hover:bg-surface-muted"
        >
          <Briefcase aria-hidden />
          Manage staff
        </Link>
      }
    >
      {isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : isError ? (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          The team could not be loaded.
        </p>
      ) : (
        <Table
          caption="Active staff and their roles"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          className="rounded-none border-0"
          empty={
            <p className="px-5 py-6 text-sm text-ink-muted">
              <SettingsIcon aria-hidden className="mr-1.5 inline" />
              No staff accounts yet.
            </p>
          }
        />
      )}
    </Card>
  );
}

/**
 * The salon's published operating hours — one editable row per day of the
 * week. Times are the salon's local wall-clock time. Read-only for roles that
 * cannot edit settings; the save action is absent entirely.
 */
function OperatingHoursCard({ canEdit }: { canEdit: boolean }) {
  const hours = useSalonOperatingHours();
  const update = useUpdateSalonOperatingHours();
  const data = hours.data;

  // The seven day keys of `SalonOperatingHours`. Restricted to days only so the
  // draft and index access can never collide with the `tenantId` field.
  type DayKey = "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";

  const DAYS: { key: DayKey; label: string }[] = [
    { key: "monday", label: "Monday" },
    { key: "tuesday", label: "Tuesday" },
    { key: "wednesday", label: "Wednesday" },
    { key: "thursday", label: "Thursday" },
    { key: "friday", label: "Friday" },
    { key: "saturday", label: "Saturday" },
    { key: "sunday", label: "Sunday" },
  ];

  // `null` means "show the server's values". Once a day is touched, its draft
  // is stored here and the draft wins over the server value until save.
  const [draft, setDraft] = useState<Record<DayKey, { open: string; close: string } | null> | null>(
    null,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const pending = hours.isPending || update.isPending;
  const disabled = !canEdit || pending;

  const serverValue = (day: DayKey): { open: string; close: string } | null => data?.[day] ?? null;
  // `null` in the draft means "close this day" and must be distinguished from
  // "not drafted" (undefined). `??` would collapse both to the server value,
  // so we check key membership with `in` instead.
  const currentValue = (day: DayKey): { open: string; close: string } | null => {
    if (draft !== null && day in draft) return draft[day];
    return serverValue(day);
  };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);

    if (!data) return;

    const changed: UpdateSalonOperatingHoursInput = {};
    for (const day of DAYS) {
      const key = day.key;
      const server = serverValue(key);
      const current = currentValue(key);
      const serverOpen = server ? server.open : null;
      const serverClose = server ? server.close : null;
      const currentOpen = current ? current.open : null;
      const currentClose = current ? current.close : null;
      if (currentOpen !== serverOpen || currentClose !== serverClose) {
        changed[key] = current;
      }
    }

    if (Object.keys(changed).length === 0) return;

    try {
      await update.mutateAsync(changed);
      showToast("success", "Business hours saved.");
    } catch (error) {
      const details = getValidationDetails(error);
      if (Object.keys(details).length > 0) {
        setFieldErrors(details);
        return;
      }
      setFormError(getErrorMessage(error));
    }
  }

  const setDay = (
    day: DayKey,
    updater: (
      current: { open: string; close: string } | null,
    ) => { open: string; close: string } | null,
  ) => {
    setDraft((prev: Record<DayKey, { open: string; close: string } | null> | null) => {
      const base: Record<DayKey, { open: string; close: string } | null> =
        prev ?? ({} as Record<DayKey, { open: string; close: string } | null>);
      const next = updater(day in base ? base[day] : serverValue(day));
      return { ...base, [day]: next };
    });
    setFieldErrors({});
    setFormError(null);
  };

  return (
    <Card title="Business hours" description="Used to generate available appointment slots.">
      {hours.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : hours.isError || data === undefined ? (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          The business hours could not be loaded.
        </p>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError ? (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {formError}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DAYS.map((day) => {
              const key = day.key;
              const current = currentValue(key);
              const isOpen = current !== null;
              const dayError = fieldErrors[key] ?? fieldErrors[`body.${key}`];
              return (
                <div
                  key={key}
                  className="flex flex-col gap-2 p-3 rounded-lg border border-line bg-surface"
                >
                  <div className="flex items-center justify-between">
                    <Checkbox
                      label={day.label}
                      checked={isOpen}
                      disabled={disabled}
                      onChange={(event) =>
                        setDay(key, () =>
                          event.target.checked
                            ? (current ?? { open: "09:00", close: "20:00" })
                            : null,
                        )
                      }
                    />
                    {isOpen && current ? (
                      <span className="text-xs text-ink-muted">
                        {current.open} – {current.close}
                      </span>
                    ) : null}
                  </div>
                  {isOpen && current ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        label="Opens"
                        type="time"
                        value={current.open}
                        onChange={(event) =>
                          setDay(key, (c) => ({
                            open: event.target.value,
                            close: c?.close ?? "20:00",
                          }))
                        }
                        error={dayError}
                        disabled={disabled}
                        hint="Local time"
                      />
                      <Input
                        label="Closes"
                        type="time"
                        value={current.close}
                        onChange={(event) =>
                          setDay(key, (c) => ({
                            open: c?.open ?? "09:00",
                            close: event.target.value,
                          }))
                        }
                        error={dayError}
                        disabled={disabled}
                        hint="Local time"
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <p className="text-xs text-ink-muted">Times are shown in your salon's local time.</p>

          {canEdit ? (
            <div className="flex justify-end">
              <Button type="submit" loading={update.isPending} disabled={disabled}>
                Save hours
              </Button>
            </div>
          ) : null}
        </form>
      )}
    </Card>
  );
}
