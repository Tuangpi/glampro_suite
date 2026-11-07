import { useQuery } from "@tanstack/react-query";
import type { CommissionConfiguration } from "@glampro_suite/shared";
import { COMMISSION_KIND_LABELS } from "@glampro_suite/shared";
import { get, getErrorMessage } from "@/lib/api";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

/** Read the existing effective policy, not a second financial configuration writer. */
export default function PackageCommissionRules({ packageId }: { packageId: string | null }) {
  const { formatDateTime, timeZone } = useSalonFormatting();
  const query = useQuery({
    queryKey: ["commissions", "package-drawer", packageId],
    queryFn: () => get<CommissionConfiguration>("/commissions", { page: 1 }),
    enabled: !!packageId,
    staleTime: 0,
    retry: false,
  });
  const groups = [
    { label: "Current", rows: query.data?.current ?? [] },
    { label: "Scheduled", rows: query.data?.scheduled ?? [] },
  ].map((group) => ({
    ...group,
    rows: group.rows.filter(
      (row) =>
        row.scope === "PACKAGE" &&
        row.targetId === packageId &&
        ["PACKAGE_SALE", "PACKAGE_REDEMPTION"].includes(row.itemKind),
    ),
  }));
  return (
    <section aria-label="Package percentage rules" className="rounded-card border border-line p-4">
      <h4 className="font-bold">Package percentage rules (read-only)</h4>
      <p>
        Company package rules are shown here, not a guaranteed commission award. Staff-specific
        rules, plan precedence and fixed/excluded package settings can change the result. Approved
        payroll and existing purchase snapshots are unchanged.
      </p>
      {!packageId ? (
        <p>Save this package before configuring percentage rules and effective dates.</p>
      ) : query.isPending ? (
        <p role="status">Loading package percentage rules…</p>
      ) : query.isError ? (
        <p role="alert">Percentage rules unavailable: {getErrorMessage(query.error)}</p>
      ) : groups.every((group) => group.rows.length === 0) ? (
        <p>No company percentage override is recorded for this package.</p>
      ) : (
        <ul>
          {groups.flatMap((group) =>
            group.rows.map((row) => (
              <li key={`${group.label}:${row.id}`}>
                {group.label} · {COMMISSION_KIND_LABELS[row.itemKind]} ·{" "}
                {row.rate === null ? "Inherit" : `${row.rate}%`} · Effective{" "}
                {formatDateTime(row.effectiveAt)} ({timeZone}) · {row.reason}
              </li>
            )),
          )}
        </ul>
      )}
      <a href="/settings?section=team&team=rules">
        Manage percentages and effective dates in Commission rules
      </a>
    </section>
  );
}
