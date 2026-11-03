import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { get, getErrorMessage } from "@/lib/api";
import { formatPrice } from "@/lib/utils";
import Button from "@/components/ui/Button";
import PayrollImpactTable from "./PayrollImpactTable";
import { impactSchema, signedMoney, sourceLabels, type PayrollPostedMoney } from "./payroll-impact";

const configurationSchema = z.object({
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
});
/** Money is only present when every authoritative input was available, so the two
 * states are exclusive rather than "some totals and some gaps". */
const readinessSchema = z.object({
  earningsActive: z.literal(false),
  planId: z.string(),
  planRevision: z.number().int(),
  periodKey: z.string().regex(/^\d{4}-\d{2}$/),
  timeZone: z.string(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  blockers: z.array(z.string()),
  configuration: configurationSchema,
  evidenceInventory: z.object({
    collectionCount: z.number().int().nonnegative(),
    legacyEarningsCount: z.number().int().nonnegative(),
  }),
});
const previewSchema = z.discriminatedUnion("status", [
  readinessSchema.extend({
    status: z.literal("AVAILABLE"),
    inputSource: z.enum(["FROZEN_CLOSE", "AUTHORITATIVE_LOADER"]),
    impact: impactSchema,
  }),
  readinessSchema.extend({
    status: z.literal("UNAVAILABLE"),
    inputSource: z.null(),
    impact: z.null(),
  }),
]);
/** Codes the loader and configuration resolver actually emit; anything else keeps
 * its raw code rather than being silently dropped. */
const blockerLabels: Record<string, string> = {
  APPROVED_PREVIOUS_CLOSE_OR_PERSISTED_OPENING_REQUIRED:
    "An approved prior close or a persisted opening carry is required before this month can be valued.",
  SOURCES_UNAVAILABLE: "Complete historical commission bases are unavailable.",
  CARRY_UNAVAILABLE: "Frozen carry balances are unavailable.",
  GROUPS_UNAVAILABLE: "Authoritative group incentive metrics are unavailable.",
  HISTORICAL_PLAN_VERSION_UNAVAILABLE: "This plan has no saved version to preview.",
  HISTORICAL_SALON_SETTINGS_UNAVAILABLE: "Pre-close audited salon settings are unavailable.",
  HISTORICAL_STAFF_SETTINGS_UNAVAILABLE: "Pre-close audited staff settings are unavailable.",
};
function blockerLabel(code: string) {
  return blockerLabels[code] ?? `Unresolved input requirement: ${code}`;
}

/** Mount only for company owners; key by plan/revision to discard stale requests and results.
 * `onResult` must be referentially stable (a `useCallback`): it is reported from an effect,
 * so an inline arrow would re-report on every parent render. */
export default function PayrollHistoricalPreview({
  planId,
  revision,
  disabled,
  onResult,
}: {
  planId: string;
  revision: number;
  disabled: boolean;
  onResult?: (planId: string, revision: number, postedMoney: PayrollPostedMoney | null) => void;
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
  // Salon-level gaps and per-configuration gaps are the same refusal to calculate.
  const blockers = result
    ? [...new Set([...result.blockers, ...result.configuration.blockers])]
    : [];
  // `null` means "checked, and the month could not be valued"; only a completed check
  // reports at all, so a refetch never briefly withdraws money that is still on screen.
  const postedMoney = useMemo(
    () =>
      result
        ? result.status === "AVAILABLE"
          ? { periodKey: result.periodKey, inputSource: result.inputSource, impact: result.impact }
          : null
        : undefined,
    [result],
  );
  useEffect(() => {
    if (postedMoney !== undefined) onResult?.(planId, revision, postedMoney);
  }, [onResult, planId, revision, postedMoney]);
  return (
    <section aria-label="Historical payroll input readiness" className="space-y-2">
      <h3>Historical payroll input readiness</h3>
      <p>
        Compare the last completed salon calendar month with the plan&apos;s latest saved rules. The
        posted column is the month&apos;s own commission and incentive money; the change column is
        what those same authoritative inputs would pay under the saved rules.
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
          <p>
            Calendar month: {result.periodKey} · Salon timezone: {result.timeZone}
          </p>
          <p>
            UTC window: {result.startsAt} inclusive → {result.endsAt} exclusive
          </p>
          {result.status === "AVAILABLE" ? (
            <>
              <p>Historical commission impact</p>
              <p>
                Posted {result.periodKey} commission:{" "}
                {formatPrice(result.impact.totals.before, result.impact.currency)} · with version{" "}
                {result.impact.afterVersion.versionNo} ({result.impact.afterVersion.status},
                effective {result.impact.afterVersion.effectiveFrom}):{" "}
                {formatPrice(result.impact.totals.after, result.impact.currency)} · change{" "}
                {signedMoney(result.impact.totals.change, result.impact.currency)}.
              </p>
              <p>Money source: {sourceLabels[result.inputSource]}.</p>
              <PayrollImpactTable periodKey={result.periodKey} impact={result.impact} />
              <p>
                Preview only: saving or publishing these rules does not change the posted month, and
                this check records nothing.
              </p>
            </>
          ) : (
            <p>
              Historical impact unavailable — no commission total or change has been calculated.
            </p>
          )}
          {!!blockers.length && (
            <ul>
              {blockers.map((code) => (
                <li key={code}>{blockerLabel(code)}</li>
              ))}
            </ul>
          )}
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
