/**
 * One staff member — handoff screen 09's editor, as a page.
 *
 * The drawer that used to hold this was one 576px column carrying five independent
 * save scopes: profile, POS PIN, password, roster, payroll and commission rules. Only
 * the profile had a footer button, so payroll settings below the fold looked like they
 * were saved by "Save changes" — the exact opposite of what the API does. The fix is
 * layout, not behaviour: the same five writes now live in five sections behind a rail,
 * each section a small page of its own with its own button.
 *
 * What is preserved from the drawer:
 *
 * - **Sections mount on first visit and stay mounted while hidden**, so an unsaved
 *   draft survives a look at another section instead of being thrown away by a switch.
 *   `?section=` deep-links one, which is how a create that continued into payroll lands
 *   where it meant to.
 * - **The write boundaries are unchanged.** `SUPER_ADMIN` and `MANAGER` may edit; a
 *   stylist reads; a suspended salon reads (TENANCY.md §6). Hiding a section is a
 *   convenience — `requireRole` is the boundary.
 * - **Employment sections are absent for a stylist**, because payroll and commission
 *   configuration are owner/manager work; the person's own earnings live in Settings.
 *
 * Every form is keyed on `staff.id`, so a refetch after one save cannot write a draft
 * over a record it never loaded.
 */
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { ChevronLeft } from "@/components/icons";
import CommissionRules from "@/components/settings/CommissionRules";
import PayrollPlans from "@/components/settings/PayrollPlans";
import StaffAccessCard from "@/components/staff/StaffAccessCard";
import StaffIdentityForm from "@/components/staff/StaffIdentityForm";
import StaffProfileSkeleton from "@/components/staff/StaffProfileSkeleton";
import StaffRoster from "@/components/staff/StaffRoster";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { ROLE_BADGE, ROLE_LABELS } from "@/constants/staff";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { useStaff } from "@/hooks/useStaff";
import { getErrorMessage } from "@/lib/api";
import { getInitials } from "@/lib/utils";

/**
 * The rail, in the order a person is set up: who they are, how they sign in, when they
 * work, and only then what they are paid. The last two are owner/manager territory and
 * are filtered out for everyone else rather than shown and then refused.
 */
const STAFF_SECTIONS = [
  {
    id: "identity",
    label: "Identity & profile",
    description: "The name, role and branches this person is booked under.",
  },
  {
    id: "access",
    label: "Login & security",
    description: "Their login, their POS PIN, their password and whether the account is open.",
  },
  {
    id: "availability",
    label: "Working hours",
    description: "The rota this branch can book them into.",
  },
  {
    id: "payroll",
    label: "Payroll",
    description: "Commission classification, pay plans and the join date payroll bills from.",
  },
  {
    id: "commission",
    label: "Commission rules",
    description: "Per-service and per-product overrides for this person.",
  },
] as const;

type StaffProfileSection = (typeof STAFF_SECTIONS)[number]["id"];

/** The two sections that only exist for someone who may configure employment terms. */
const EMPLOYMENT_SECTIONS: ReadonlyArray<StaffProfileSection> = ["payroll", "commission"];

export default function StaffProfile() {
  const { id } = useParams();
  return id ? <Profile key={id} id={id} /> : <p role="alert">Staff member not found.</p>;
}

function Profile({ id }: { id: string }) {
  const staff = useStaff(id);
  const { user, isReadOnly } = useAuth();
  const { formatDate, formatDateTime } = useSalonFormatting();
  const [searchParams, setSearchParams] = useSearchParams();

  /** Owner or manager, in a salon that is not suspended: the same pair `requireRole` names. */
  const canManage = user?.globalRole === "SUPER_ADMIN" || user?.globalRole === "MANAGER";
  const canEdit = canManage && !isReadOnly;
  /**
   * Payroll **plans** are an owner's to write — a manager can read a plan but not mint
   * one — while commission rules are open to anyone who may edit at all. Both rules are
   * the drawer's, carried over unchanged.
   */
  const canEditPayroll = user?.globalRole === "SUPER_ADMIN" && !isReadOnly;
  const canEditCommission = !isReadOnly;

  const sections = canManage
    ? STAFF_SECTIONS
    : STAFF_SECTIONS.filter((section) => !EMPLOYMENT_SECTIONS.includes(section.id));
  const requestedSection = searchParams.get("section");
  const activeSection: StaffProfileSection =
    sections.find((section) => section.id === requestedSection)?.id ?? "identity";
  const [visited, setVisited] = useState<StaffProfileSection[]>([activeSection]);

  function selectSection(section: StaffProfileSection) {
    setVisited((current) => [...new Set([...current, activeSection, section])]);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("section", section);
      return next;
    });
  }

  if (staff.isPending) {
    return <StaffProfileSkeleton />;
  }

  if (!staff.data || staff.isError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-card border border-line bg-surface p-5"
      >
        <p className="text-sm text-ink">
          The staff member could not be loaded. {getErrorMessage(staff.error)}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void staff.refetch()}>Try again</Button>
          <Link to="/staff" className="text-sm text-ink underline">
            Back to staff
          </Link>
        </div>
      </div>
    );
  }

  const row = staff.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          to="/staff"
          className="inline-flex items-center gap-1 text-sm text-ink-muted underline hover:text-ink"
        >
          <ChevronLeft aria-hidden className="text-xs" />
          Back to staff
        </Link>

        <header className="flex flex-wrap items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-purple-soft text-base font-extrabold text-purple"
          >
            {getInitials(row.name)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl text-ink">{row.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant={ROLE_BADGE[row.globalRole]}>{ROLE_LABELS[row.globalRole]}</Badge>
              <Badge variant={row.disabled ? "neutral" : "success"} dot>
                {row.disabled ? "Disabled" : "Active"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              {row.position ?? "No position set"} · Joined {formatDate(row.startDate)} · Last login{" "}
              {formatDateTime(row.lastLoginAt)}
            </p>
          </div>
        </header>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-6">
          <label className="flex flex-col gap-2 text-sm font-medium lg:hidden">
            Staff section
            <select
              className="h-control rounded-md border border-line bg-surface px-3 text-ink"
              value={activeSection}
              onChange={(event) => selectSection(event.target.value as StaffProfileSection)}
            >
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.label}
                </option>
              ))}
            </select>
          </label>
          <nav aria-label="Staff sections" className="hidden flex-col gap-1 lg:flex">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                aria-current={activeSection === section.id ? "page" : undefined}
                aria-controls={`staff-${section.id}`}
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
            Drafts stay here when you switch sections. Save each form before leaving this page.
          </p>
        </aside>

        <div className="min-w-0">
          {sections.map((section) => (
            <section
              key={section.id}
              id={`staff-${section.id}`}
              aria-labelledby={`staff-heading-${section.id}`}
              hidden={activeSection !== section.id}
            >
              {(activeSection === section.id || visited.includes(section.id)) && (
                <div className="flex flex-col gap-5">
                  <header>
                    <h3 id={`staff-heading-${section.id}`} className="text-lg font-bold text-ink">
                      {section.label}
                    </h3>
                    <p className="mt-1 text-sm text-ink-muted">{section.description}</p>
                  </header>
                  {/* Keyed on the record, not on the section: a refetch after one save
                      must not remount a neighbour's draft, but a different person must
                      never inherit one. */}
                  {section.id === "identity" && (
                    <StaffIdentityForm key={row.id} staff={row} canEdit={canEdit} />
                  )}
                  {section.id === "access" && (
                    <StaffAccessCard key={row.id} staff={row} canEdit={canEdit} />
                  )}
                  {section.id === "availability" && <StaffRoster staffId={row.id} />}
                  {section.id === "payroll" && (
                    <PayrollPlans staffId={row.id} canEdit={canEditPayroll} />
                  )}
                  {section.id === "commission" && (
                    <CommissionRules staffId={row.id} canEdit={canEditCommission} />
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
