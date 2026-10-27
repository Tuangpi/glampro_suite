import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { get, getErrorMessage } from "@/lib/api";
import Button from "@/components/ui/Button";

const previewSchema = z.object({
  status: z.literal("UNAVAILABLE"),
  earningsActive: z.literal(false),
  impact: z.null(),
  planId: z.string(),
  planRevision: z.number().int(),
  periodKey: z.string().regex(/^\d{4}-\d{2}$/),
  timeZone: z.string(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  blockers: z.array(z.string()),
  configuration: z.object({
    assignmentRevision: z.number().int().nonnegative(),
    settingsRevision: z.number().int().nonnegative(),
    blockers: z.array(z.string()),
    staff: z.array(
      z.object({
        staffId: z.string(),
        staffName: z.string(),
        disabled: z.boolean(),
        joinDate: z.string().nullable(),
        staffRevision: z.number().int().nullable(),
        version: z.object({ id: z.string(), versionNo: z.number().int() }),
        blockers: z.array(z.string()),
      }),
    ),
  }),
  evidenceInventory: z.object({
    collectionCount: z.number().int().nonnegative(),
    legacyEarningsCount: z.number().int().nonnegative(),
  }),
});
const blockerLabels: Record<string, string> = {
  AUTHORITATIVE_RATE_FREE_BASES_UNAVAILABLE:
    "Complete historical commission bases are unavailable.",
  FROZEN_CARRY_INPUTS_UNAVAILABLE: "Frozen carry balances are unavailable.",
  AUTHORITATIVE_GROUP_METRICS_UNAVAILABLE: "Authoritative group incentive metrics are unavailable.",
  HISTORICAL_SALON_SETTINGS_UNAVAILABLE: "Pre-close audited salon settings are unavailable.",
  HISTORICAL_STAFF_SETTINGS_UNAVAILABLE: "Pre-close audited staff settings are unavailable.",
};
function blockerLabel(code: string) {
  return blockerLabels[code] ?? `Unresolved input requirement: ${code}`;
}

/** Mount only for company owners; key by plan/revision to discard stale requests and results. */
export default function PayrollHistoricalPreview({
  planId,
  revision,
  disabled,
}: {
  planId: string;
  revision: number;
  disabled: boolean;
}) {
  const [requested, setRequested] = useState(false);
  const query = useQuery({
    queryKey: ["payroll-configuration", "historical-preview", planId, revision],
    enabled: requested && !disabled,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const data = previewSchema.parse(
        await get<unknown>(
          `/payroll-configuration/plans/${encodeURIComponent(planId)}/historical-preview`,
          { expectedRevision: revision },
        ),
      );
      if (data.planId !== planId || data.planRevision !== revision)
        throw new Error("Plan changed. Reload before checking historical inputs.");
      return data;
    },
  });
  const result = !disabled && !query.isFetching && !query.isError ? query.data : undefined;
  return (
    <section aria-label="Historical payroll input readiness" className="space-y-2">
      <h3>Historical payroll input readiness</h3>
      <p>
        Check saved configuration for the last completed salon calendar month. This is not an
        approved payroll statement, and does not calculate the impact of unsaved rules.
      </p>
      <Button
        variant="secondary"
        disabled={disabled || query.isFetching}
        onClick={() => {
          if (requested) void query.refetch();
          else setRequested(true);
        }}
      >
        Check historical inputs
      </Button>
      {disabled && (
        <p>Wait for configuration to finish loading or saving before checking inputs.</p>
      )}
      {!disabled && query.isFetching && <p role="status">Checking historical inputs…</p>}
      {!disabled && query.isError && (
        <p role="alert">Unable to check historical inputs. {getErrorMessage(query.error)}</p>
      )}
      {result && (
        <div className="space-y-2">
          <p>Historical impact unavailable — no commission total or change has been calculated.</p>
          <p>
            Calendar month: {result.periodKey} · Salon timezone: {result.timeZone}
          </p>
          <p>
            UTC window: {result.startsAt} inclusive → {result.endsAt} exclusive
          </p>
          <ul>
            {[...new Set([...result.blockers, ...result.configuration.blockers])].map((code) => (
              <li key={code}>{blockerLabel(code)}</li>
            ))}
          </ul>
          <p>
            Assignment audit revision: {result.configuration.assignmentRevision} · Salon settings
            audit revision: {result.configuration.settingsRevision}
          </p>
          <p>
            Salon-wide evidence inventory only: {result.evidenceInventory.collectionCount}{" "}
            collection records; {result.evidenceInventory.legacyEarningsCount} legacy earnings
            records. Counts do not establish complete bases or payable amounts.
          </p>
          {!result.configuration.staff.length ? (
            <p>
              No staff resolved to this plan at month end. This is not evidence of zero earnings.
            </p>
          ) : (
            <ul>
              {result.configuration.staff.map((staff) => (
                <li key={staff.staffId} className="border-b py-2">
                  <p>
                    {staff.staffName}
                    {staff.disabled ? " (currently disabled)" : ""} · Published version{" "}
                    {staff.version.versionNo}
                  </p>
                  <p>
                    Audited join date: {staff.joinDate ?? "Unavailable"} · Staff audit revision:{" "}
                    {staff.staffRevision ?? "Unavailable"}
                  </p>
                  {staff.blockers.map((code) => (
                    <p key={code}>{blockerLabel(code)}</p>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p>Plan-based earnings remain inactive. No historical records are changed by this check.</p>
    </section>
  );
}
