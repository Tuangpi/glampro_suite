/**
 * One company — `/platform/companies/:id`.
 *
 * Four sections behind tabs (overview, subscription, module access, activity)
 * and a purge, on a page that finally has a URL: `/platform/companies/:id` is
 * linkable, survives a refresh, and keeps the company's delete button off the
 * operator's own account screen.
 *
 * The danger zone is a plain card with one button. It used to be a `<details>`
 * disclosure containing a form, which is the shape of a setting you might
 * actually fill in — deletion of a company and every row filed under it is not
 * that. Now the button opens a modal where the reason is required and the slug
 * has to be typed back, and the button stays disabled until both are true.
 */
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { companyPurgeSchema, type CompanyDetail } from "@glampro_suite/shared";

import { AlertTriangle } from "@/components/icons";
import Badge, { type BadgeVariant } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Skeleton from "@/components/ui/Skeleton";
import { platformApi } from "./api";
import CompanyAdministration from "./CompanyAdministration";
import DetailTabs, { type DetailTab } from "./DetailTabs";

const STATUS_TONE: Record<string, BadgeVariant> = {
  ACTIVE: "success",
  SUSPENDED: "warning",
  CANCELLED: "danger",
};

/** Pending, accepted, revoked or lapsed — the invitation's own four states. */
function invitationState(detail: CompanyDetail) {
  const invitation = detail.invitation;
  if (!invitation) return { label: "None", variant: "neutral" as BadgeVariant };
  if (invitation.acceptedAt) return { label: "Accepted", variant: "success" as BadgeVariant };
  if (invitation.revokedAt) return { label: "Revoked", variant: "danger" as BadgeVariant };
  if (new Date(invitation.expiresAt) <= new Date())
    return { label: "Expired", variant: "warning" as BadgeVariant };
  return { label: "Pending", variant: "purple" as BadgeVariant };
}

export default function CompanyDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation();
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // A message from the page the operator came from — a creation, or a purge.
  const [notice, setNotice] = useState(() => (state as { notice?: string } | null)?.notice ?? "");
  const [administrating, setAdministrating] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeReason, setPurgeReason] = useState("");
  const [purgeSlug, setPurgeSlug] = useState("");
  const [purgeError, setPurgeError] = useState("");
  const [purging, setPurging] = useState(false);

  useEffect(() => {
    let active = true;
    platformApi
      .company(id)
      .then((value) => {
        if (active) {
          setDetail(value);
          setError("");
        }
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load company.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, revision]);

  const busy = administrating || purging;

  async function resendInvitation() {
    if (!detail) return;
    setError("");
    setNotice("");
    try {
      const result = await platformApi.resendInvitation(detail.id);
      setDetail(result.company);
      setNotice(
        result.invitationDelivery === "sent"
          ? "New invitation sent. Previous links are invalid."
          : "Invitation email failed. Please retry sending.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Company request failed.");
    }
  }

  /** Driven by the modal's form and by its footer button; both send the same. */
  async function purge() {
    if (!detail || purging) return;
    setPurging(true);
    setPurgeError("");
    try {
      const input = companyPurgeSchema.safeParse({ confirmSlug: purgeSlug, reason: purgeReason });
      if (!input.success) throw new Error(input.error.issues[0].message);
      const result = await platformApi.deleteCompany(detail.id, input.data);
      navigate("/platform", {
        replace: true,
        state: {
          notice: `Deleted ${result.company.name}: ${result.deletedRows} rows removed. The purge is recorded in the audit log.`,
        },
      });
    } catch (cause) {
      // The company is still here, so the modal stays open with what was typed.
      setPurgeError(cause instanceof Error ? cause.message : "Company request failed.");
    } finally {
      setPurging(false);
    }
  }

  const invitation = detail ? invitationState(detail) : null;
  const fields: Array<[string, React.ReactNode]> = detail
    ? [
        ["Company ID", <span className="font-mono text-xs">{detail.id}</span>],
        ["Slug", detail.slug],
        [
          "Status",
          <Badge variant={STATUS_TONE[detail.status] ?? "neutral"} dot>
            {detail.status}
          </Badge>,
        ],
        ["Owner", detail.owner?.name ?? "Not assigned"],
        ["Owner email", detail.owner?.email ?? "Not assigned"],
        [
          "Owner access",
          detail.owner
            ? detail.owner.disabled
              ? "Disabled / pending onboarding"
              : "Enabled"
            : "Not assigned",
        ],
        ...(invitation
          ? [
              ["Invitation", <Badge variant={invitation.variant}>{invitation.label}</Badge>] as [
                string,
                React.ReactNode,
              ],
            ]
          : []),
        ...(detail.invitation
          ? [
              ["Invitation expiry", new Date(detail.invitation.expiresAt).toLocaleString()] as [
                string,
                React.ReactNode,
              ],
            ]
          : []),
      ]
    : [];

  /** Resending only makes sense while the owner has not yet accepted. */
  const canResend = Boolean(
    detail?.owner?.disabled &&
    detail.status === "ACTIVE" &&
    detail.invitation &&
    !detail.invitation.acceptedAt,
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="ghost" disabled={busy} onClick={() => navigate("/platform")}>
          ← Back to companies
        </Button>
      </div>

      {error ? (
        <p role="alert" className="rounded-md bg-danger/5 px-3 py-2.5 text-sm text-danger">
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

      {loading && !detail ? (
        <div aria-busy="true" aria-label="Loading company details" className="flex flex-col gap-2">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-11" />
          <Skeleton className="h-32" />
        </div>
      ) : detail ? (
        <article aria-label="Company details" className="flex flex-col gap-4">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex size-11 items-center justify-center rounded-pill bg-purple-soft text-sm font-bold text-purple"
              >
                {detail.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
                  Company details
                </p>
                <h1 className="truncate text-2xl">{detail.name}</h1>
                <p className="text-sm text-ink-muted">{detail.slug}</p>
              </div>
            </div>
            <Badge variant={STATUS_TONE[detail.status] ?? "neutral"} dot>
              {detail.status}
            </Badge>
          </header>

          <DetailTabs value={tab} onChange={setTab} disabled={busy} />

          <div
            role="tabpanel"
            id="company-panel-overview"
            aria-labelledby="company-tab-overview"
            hidden={tab !== "overview"}
            tabIndex={0}
            className="flex flex-col gap-4 pt-2"
          >
            <Card
              title="Company overview"
              description="What this company is, and who owns it."
              actions={
                canResend ? (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void resendInvitation()}
                  >
                    Resend invitation
                  </Button>
                ) : null
              }
            >
              <dl className="grid gap-x-6 gap-y-3 px-2 pt-2 pb-1 sm:grid-cols-2">
                {fields.map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs text-ink-muted">{label}</dt>
                    <dd className="mt-0.5 text-sm break-words text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>

            <Card
              className="border-danger/40"
              title={
                <span className="flex items-center gap-2 text-danger">
                  <AlertTriangle aria-hidden />
                  Danger zone
                </span>
              }
              description="Deleting removes the company and every record filed under it. This cannot be undone."
            >
              <div className="flex flex-col gap-3 px-2 pt-2 pb-1">
                <p className="text-sm text-ink-body">
                  Suspending or cancelling keeps the data. Deleting removes the company and every
                  record filed under it — customers, sales, packages, commission and payroll history
                  — and cannot be undone.
                </p>
                <div>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      setPurgeOpen(true);
                      setPurgeReason("");
                      setPurgeSlug("");
                      setPurgeError("");
                    }}
                  >
                    Delete this company permanently
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          <CompanyAdministration
            key={detail.id}
            id={detail.id}
            tab={tab}
            onBusyChange={setAdministrating}
            onChange={async () => setDetail(await platformApi.company(detail.id))}
          />
        </article>
      ) : (
        <Card title="Company not available">
          <div className="px-2 py-2">
            <Button
              variant="secondary"
              onClick={() => {
                setLoading(true);
                setRevision((value) => value + 1);
              }}
            >
              Retry company details
            </Button>
          </div>
        </Card>
      )}

      {/* The last line of defence: a reason for the audit log, and the slug typed
          back so a mis-click can never be enough. */}
      <Modal
        open={purgeOpen}
        onClose={() => setPurgeOpen(false)}
        title="Delete this company permanently"
        description="The company and every record filed under it are removed. This cannot be undone."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={purging} onClick={() => setPurgeOpen(false)}>
              Keep this company
            </Button>
            <Button
              variant="danger"
              loading={purging}
              disabled={purgeReason.trim().length < 3 || purgeSlug !== detail?.slug}
              onClick={() => void purge()}
            >
              Delete company permanently
            </Button>
          </div>
        }
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void purge();
          }}
        >
          {purgeError ? (
            <p role="alert" className="rounded-md bg-danger/5 px-3 py-2.5 text-sm text-danger">
              {purgeError}
            </p>
          ) : null}
          <Input
            label="Reason for deletion"
            value={purgeReason}
            onChange={(event) => setPurgeReason(event.target.value)}
            minLength={3}
            maxLength={500}
            required
            disabled={purging}
            hint="Recorded in the audit log with who asked for it."
          />
          <Input
            label="Type the slug to confirm"
            value={purgeSlug}
            onChange={(event) => setPurgeSlug(event.target.value)}
            placeholder={detail?.slug}
            maxLength={64}
            required
            disabled={purging}
            hint={`Type ${detail?.slug ?? "the slug"} exactly to enable the delete button.`}
          />
        </form>
      </Modal>
    </div>
  );
}
