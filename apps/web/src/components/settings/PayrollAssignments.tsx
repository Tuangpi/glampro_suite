import { useState } from "react";
import {
  payrollStageSchedule,
  payrollTenureMonth,
  resolvePayrollStage,
} from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { PayrollProfileForm, PayrollStaffSettingsForm } from "./PayrollSettingsForms";
import type { PayrollConfiguration } from "./PayrollPlans";

export default function PayrollAssignments({
  data,
  canEdit,
  save,
  staffId,
  initialPlanId,
}: {
  data: PayrollConfiguration;
  canEdit: boolean;
  save: (url: string, body: object) => Promise<void>;
  staffId?: string;
  initialPlanId?: string;
}) {
  const [staffIds, setStaffIds] = useState<string[]>(staffId ? [staffId] : []);
  const [planId, setPlanId] = useState(initialPlanId ?? "");
  const [date, setDate] = useState(data.today);
  const [personId, setPersonId] = useState(staffId ?? data.staff[0]?.id ?? "");
  const person = data.staff.find((s) => s.id === personId);
  const assignment = data.assignments.rows.find(
    (r) =>
      r.staffId === personId && r.fromDate <= data.today && (!r.toDate || r.toDate >= data.today),
  );
  const definition = data.plans
    .find((p) => p.id === assignment?.planId)
    ?.versions.find((v) => v.status === "PUBLISHED" && v.effectiveFrom <= data.today)?.definition;
  let schedule: unknown = [];
  try {
    if (definition && person?.settings.joinDate)
      schedule = {
        tenureMonth: payrollTenureMonth(
          person.settings.joinDate,
          data.today.slice(0, 7),
          data.settings.joinAfterDay,
        ),
        stage: resolvePayrollStage(
          definition.stages,
          payrollTenureMonth(
            person.settings.joinDate,
            data.today.slice(0, 7),
            data.settings.joinAfterDay,
          ),
          person.settings.stageEndOverride,
        ).name,
        schedule: payrollStageSchedule(
          definition.stages,
          person.settings.joinDate,
          data.settings.joinAfterDay,
        ),
      };
  } catch (cause) {
    schedule = cause instanceof Error ? cause.message : "Unavailable";
  }
  return (
    <section className="space-y-3" aria-label="Staff plans and payroll profiles">
      <h3>Staff assignments and payroll profiles</h3>
      <p className="text-xs text-ink-muted">
        One plan timeline per staff member. Eligible outlets pool together; other outlet activity
        requires separate flat-rule fallback. Assignments snapshot plan outlet scope.
        Commission-earning staff need an applicable published plan; missing plans can block monthly
        payroll.
      </p>
      <fieldset disabled={!canEdit}>
        <legend>Assign plan (select one or more staff)</legend>
        {data.staff
          .filter((s) => !s.disabled && (!staffId || s.id === staffId))
          .map((s) => (
            <label key={s.id} className="mr-3 inline-block">
              <input
                type="checkbox"
                checked={staffIds.includes(s.id)}
                onChange={(e) =>
                  setStaffIds(
                    e.target.checked ? [...staffIds, s.id] : staffIds.filter((id) => id !== s.id),
                  )
                }
              />{" "}
              {s.name}
            </label>
          ))}
        <Select
          label="Assignment plan"
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          options={[
            { value: "", label: "No plan — review payroll eligibility" },
            ...data.plans
              .filter(
                (p) =>
                  !p.archived &&
                  (p.id === assignment?.planId || p.versions.some((v) => v.status === "PUBLISHED")),
              )
              .map((p) => ({
                value: p.id,
                label: `${p.name}${p.outletIds.length ? " — selected outlets" : " — all outlets"}`,
              })),
          ]}
        />
        <Input
          label="Assignment from date"
          type="date"
          min={data.today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Button
          disabled={
            !staffIds.length ||
            (!!planId &&
              !data.plans.some(
                (p) =>
                  p.id === planId &&
                  !p.archived &&
                  p.versions.some(
                    (v) =>
                      v.status === "PUBLISHED" && v.effectiveFrom.slice(0, 7) <= date.slice(0, 7),
                  ),
              ))
          }
          onClick={() =>
            void save("/assignments", {
              expectedRevision: data.assignments.revision,
              staffIds,
              planId: planId || null,
              fromDate: date,
            })
          }
        >
          Assign selected staff
        </Button>
      </fieldset>
      {staffId && (
        <>
          <Select
            label="Payroll staff member"
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            options={data.staff
              .filter((s) => !staffId || s.id === staffId)
              .map((s) => ({ value: s.id, label: s.name }))}
          />
          {person && (
            <div className="space-y-3" key={person.id}>
              <p>Stage schedule (automatic progression; override affects stage selection):</p>
              <details>
                <summary>View tenure schedule details</summary>
                <pre className="overflow-auto text-xs">{JSON.stringify(schedule, null, 2)}</pre>
              </details>
              <PayrollStaffSettingsForm
                value={person.settings}
                canEdit={canEdit}
                save={(body) => save(`/staff/${person.id}/settings`, body)}
              />
              {person.profile && (
                <PayrollProfileForm
                  value={person.profile}
                  canEdit={canEdit}
                  save={(body) => save(`/staff/${person.id}/profile`, body)}
                />
              )}
              <h4>Assignment history</h4>
              {data.assignments.rows
                .filter((r) => r.staffId === personId)
                .map((r) => (
                  <p key={r.id}>
                    {data.plans.find((p) => p.id === r.planId)?.name ?? r.planId}: {r.fromDate} to{" "}
                    {r.toDate ?? "ongoing"} ·{" "}
                    {/* Outlet attribution is parked: a salon without branches only ever
                    reaches the salon-wide case, so name that rather than a scope it
                    has no way to configure. */}
                    {r.outletIds?.length ? `Outlets: ${r.outletIds.join(", ")}` : "Salon-wide"}
                  </p>
                ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
