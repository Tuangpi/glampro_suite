import Badge from "@/components/ui/Badge";

/**
 * Payroll/Sales % with the specification's red above-alert state.
 *
 * Salary-derived, so both payroll tables render it only where the server sent it —
 * the owner's rows — using the same boundary as the salary and take-home columns. A
 * month with no collection has no ratio and shows a dash rather than a meaningless
 * zero percent. The tone is never the only signal: an alert row also says "above
 * alert", because colour alone must not carry the meaning.
 */
export default function PayrollSalesRatio({
  pct,
  alert,
}: {
  pct: string | null | undefined;
  alert: boolean | undefined;
}) {
  if (pct === null || pct === undefined) return <>—</>;
  return (
    <Badge variant={alert ? "danger" : "neutral"} dot={Boolean(alert)}>
      {pct}%{alert ? " above alert" : ""}
    </Badge>
  );
}
