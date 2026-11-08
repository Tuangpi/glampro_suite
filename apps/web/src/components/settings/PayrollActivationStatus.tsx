import { useQuery } from "@tanstack/react-query";
import { payrollCutoverStateSchema } from "@glampro_suite/shared";
import { get, getErrorMessage } from "@/lib/api";
import Button from "@/components/ui/Button";

/** Read the activation record, never the configuration API's legacy preview flag. */
export default function PayrollActivationStatus({
  today,
  compact = false,
}: {
  today: string;
  compact?: boolean;
}) {
  const query = useQuery({
    queryKey: ["payroll-cutover"],
    queryFn: async () => {
      const result = payrollCutoverStateSchema.safeParse(await get("/payroll-cutover"));
      if (!result.success)
        throw new Error("The server returned an invalid activation record. Please retry.");
      if (result.data.status === "ACTIVE" && !result.data.effectivePeriodKey)
        throw new Error("The activation record is missing its effective month. Please retry.");
      return result.data;
    },
    staleTime: 0,
    retry: false,
  });
  const state = query.data;
  const scheduled =
    state?.status === "ACTIVE" &&
    state.effectivePeriodKey !== null &&
    state.effectivePeriodKey > today.slice(0, 7);

  return (
    <section
      aria-label="Payroll activation status"
      className={
        compact ? "space-y-1 text-sm" : "space-y-2 rounded-lg border border-line bg-surface p-4"
      }
    >
      {!compact && <h3 className="font-bold">Payroll activation</h3>}
      {query.isPending ? (
        <p role="status">Checking payroll activation…</p>
      ) : query.isError ? (
        <>
          <p role="alert">Activation status unavailable. Do not assume payroll is inactive.</p>
          <p className="text-sm text-ink-muted">{getErrorMessage(query.error)}</p>
          <Button
            variant="secondary"
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Retry activation status
          </Button>
        </>
      ) : state ? (
        <p role="status">
          {state.status === "NOT_ACTIVATED"
            ? "Not activated — legacy commission recording remains in use."
            : state.status === "ROLLED_BACK"
              ? "Rolled back — legacy commission recording has resumed. Previously approved payroll is unchanged."
              : scheduled
                ? `Scheduled — plan-based payroll starts in ${state.effectivePeriodKey}.`
                : `Active — plan-based payroll applies from ${state.effectivePeriodKey}.`}
        </p>
      ) : null}
      {!compact && (
        <p className="text-sm text-ink-muted">
          Saving, publishing or assigning a plan does not activate payroll or send a payment.
          Activation is a separate owner-reviewed process; this page cannot change it.
        </p>
      )}
    </section>
  );
}
