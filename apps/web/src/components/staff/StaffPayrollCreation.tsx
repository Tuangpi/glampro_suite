import { useQuery } from "@tanstack/react-query";
import type { CreateStaffInput } from "@glampro_suite/shared";
import type { PayrollConfiguration } from "@/components/settings/PayrollPlans";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { get } from "@/lib/api";

type Assignment = NonNullable<CreateStaffInput["payrollAssignment"]>;

export default function StaffPayrollCreation({
  value,
  onChange,
}: {
  value: Assignment | null;
  onChange: (value: Assignment | null) => void;
}) {
  const query = useQuery({
    queryKey: ["payroll-configuration", "staff-create"],
    queryFn: () => get<PayrollConfiguration>("/payroll-configuration"),
    refetchOnWindowFocus: false,
  });
  const data = query.data;
  if (query.isPending) return <p role="status">Loading payroll plans…</p>;
  if (query.isError || !data)
    return <p role="alert">Payroll plans could not be loaded. Cancel and reopen setup to retry.</p>;
  if (data.outletId)
    return <p role="alert">Switch to company context before creating staff with a payroll plan.</p>;
  const plans = data.plans.filter(
    (plan) =>
      !plan.archived &&
      !plan.outletIds.length &&
      plan.versions.some((v) => v.status === "PUBLISHED"),
  );
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-medium">Initial payroll assignment</legend>
      <p className="text-xs text-ink-muted">
        Staff, branch links and the reasoned assignment save together. This does not activate plan
        earnings. Only company-wide plans are supported. The plan must be published and effective in
        the assignment month.
      </p>
      <Select
        label="Initial payroll plan"
        value={value?.planId ?? ""}
        onChange={(event) =>
          onChange(
            event.target.value
              ? {
                  expectedRevision: data.assignments.revision,
                  planId: event.target.value,
                  fromDate: value?.fromDate ?? data.today,
                  reason: value?.reason ?? "",
                }
              : null,
          )
        }
        options={[
          { value: "", label: "Choose a plan" },
          ...plans.map((plan) => ({ value: plan.id, label: plan.name })),
        ]}
      />
      {value && (
        <>
          <Input
            label="Assigned from"
            type="date"
            required
            value={value.fromDate}
            onChange={(event) => onChange({ ...value, fromDate: event.target.value })}
          />
          <Input
            label="Assignment reason"
            required
            value={value.reason}
            onChange={(event) => onChange({ ...value, reason: event.target.value })}
          />
        </>
      )}
      {!plans.length && (
        <p role="status">Publish a company-wide plan before using this workflow.</p>
      )}
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          onChange(null);
          void query.refetch();
        }}
      >
        Reload payroll plans
      </Button>
    </fieldset>
  );
}
