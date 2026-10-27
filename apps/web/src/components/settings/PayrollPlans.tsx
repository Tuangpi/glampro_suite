import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  hairPayrollExample,
  tpPayrollExample,
  payrollPlanDefinitionSchema,
  validatePayrollPlan,
  calculatePayrollComponent,
  comparePayrollMethods,
  payrollCommissionCurve,
  payrollStageSchedule,
  payrollTenureMonth,
  resolvePayrollStage,
  type PayrollPlanDefinition,
  type PayrollComponent,
  type PayrollAssignment,
  type PayrollSettingsWrite,
  type PayrollProfileWrite,
} from "@glampro_suite/shared";
import { get, post, getErrorMessage } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import PayrollDefinitionEditor from "./PayrollDefinitionEditor";

interface Version {
  id: string;
  versionNo: number;
  effectiveFrom: string;
  status: "DRAFT" | "PUBLISHED";
  definition: PayrollPlanDefinition;
  actorId: string;
  reason: string;
  publishedAt: string | null;
}
interface Plan {
  id: string;
  name: string;
  description: string;
  positions: string[];
  outletIds: string[];
  revision: number;
  archived: boolean;
  staffCount: number;
  versions: Version[];
}
export interface PayrollConfiguration {
  today: string;
  outletId: string | null;
  earningsActive: boolean;
  plans: Plan[];
  settings: Omit<PayrollSettingsWrite, "expectedRevision" | "reason"> & { revision: number };
  assignments: { revision: number; rows: PayrollAssignment[] };
  staff: {
    id: string;
    name: string;
    disabled: boolean;
    settings: { revision: number; joinDate: string | null; stageEndOverride: number | null };
    profile?: Omit<PayrollProfileWrite, "expectedRevision" | "reason"> & { revision: number };
  }[];
  history: {
    id: string;
    kind: string;
    targetId: string;
    revision: number;
    actorId: string;
    reason: string;
    payload: unknown;
    createdAt: string;
  }[];
  historyLimit: number;
}

export default function PayrollPlans({ canEdit, staffId }: { canEdit: boolean; staffId?: string }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["payroll-configuration"],
    queryFn: () => get<PayrollConfiguration>("/payroll-configuration"),
    staleTime: 0,
  });
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState<{
    planId: string;
    revision: number;
    definition: PayrollPlanDefinition;
    date: string;
  } | null>(null);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [componentKey, setComponentKey] = useState("");
  const [base, setBase] = useState("6830");
  const [units, setUnits] = useState("1");
  const [stageKey, setStageKey] = useState("std");
  const [advanced, setAdvanced] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => post(url, body),
  });
  async function save(url: string, body: object) {
    setError("");
    setNotice("");
    try {
      if (reason.trim().length < 3)
        throw new Error("Enter a change reason (at least 3 characters).");
      await mutation.mutateAsync({
        url: `/payroll-configuration${url}`,
        body: { ...body, reason },
      });
      setDraft(null);
      setAdvanced(null);
      setReason("");
      await client.invalidateQueries({ queryKey: ["payroll-configuration"] });
      setNotice("Configuration saved. Plan-based earnings remain inactive.");
    } catch (cause) {
      setError(getErrorMessage(cause));
    }
  }
  if (query.isPending) return <p role="status">Loading commission plans…</p>;
  if (query.isError || !query.data)
    return (
      <div role="alert">
        Unable to load commission plans.{" "}
        <Button onClick={() => void query.refetch()}>Retry plans</Button>
      </div>
    );
  const data = query.data;
  const plan = data.plans.find((p) => p.id === selected) ?? data.plans[0];
  const version = plan?.versions[0];
  const definition = draft?.planId === plan?.id ? draft!.definition : version?.definition;
  const stale = !!draft && (draft.planId !== plan?.id || draft.revision !== plan?.revision);
  const locked = !canEdit || mutation.isPending || query.isFetching || stale;
  const component =
    definition?.components.find((c) => c.key === componentKey) ?? definition?.components[0];
  const validation = definition ? validatePayrollPlan(definition) : { errors: [], warnings: [] };
  function change(next: PayrollPlanDefinition) {
    if (!plan || !version) return;
    setDraft({
      planId: plan.id,
      revision: draft?.revision ?? plan.revision,
      definition: next,
      date:
        draft?.date ?? (version.effectiveFrom < data.today ? data.today : version.effectiveFrom),
    });
  }
  function editComponent(patch: Partial<PayrollComponent>) {
    if (definition && component)
      change({
        ...definition,
        components: definition.components.map((c) =>
          c.key === component.key ? { ...c, ...patch } : c,
        ),
      });
  }
  let calculator: ReturnType<typeof calculatePayrollComponent> | null = null;
  let comparison: ReturnType<typeof comparePayrollMethods> = [];
  let curve: ReturnType<typeof payrollCommissionCurve> = [];
  let calculatorError = "";
  try {
    if (component) {
      calculator = calculatePayrollComponent(component, base, { stageKey, units });
      comparison = comparePayrollMethods(component, base, { stageKey, units });
      if (component.method.startsWith("TIER_"))
        curve = payrollCommissionCurve(component, "30000", 60, { stageKey, units });
    }
  } catch (cause) {
    calculatorError = cause instanceof Error ? cause.message : "Invalid calculator input.";
  }
  const activeAssignments = data.assignments.rows.filter(
    (r) => r.fromDate <= data.today && (!r.toDate || r.toDate >= data.today),
  );
  return (
    <Card
      title="Versioned commission plans"
      description="Configuration preview only. Legacy earnings are unchanged until controlled cutover."
    >
      <div className="space-y-4">
        <p>
          {data.plans.filter((p) => !p.archived).length} active plans ·{" "}
          {new Set(activeAssignments.map((r) => r.staffId)).size} staff on a plan ·{" "}
          {
            data.staff.filter(
              (s) => !s.disabled && !activeAssignments.some((r) => r.staffId === s.id),
            ).length
          }{" "}
          without a plan (flat fallback)
        </p>
        {data.outletId && (
          <p>
            Outlet-scoped plans only. Staff assignments and salary profiles require company context.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {stale && <p role="alert">This draft is stale. Reload and discard it before saving.</p>}
        <Button
          variant="secondary"
          disabled={mutation.isPending}
          onClick={async () => {
            await query.refetch();
            setDraft(null);
            setAdvanced(null);
          }}
        >
          Reload and discard plan draft
        </Button>
        <Input
          label="Plan change reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={!canEdit || mutation.isPending}
        />
        <Select
          label="Commission plan"
          value={plan?.id ?? ""}
          onChange={(e) => {
            setSelected(e.target.value);
            setDraft(null);
            setAdvanced(null);
          }}
          options={data.plans.map((p) => ({
            value: p.id,
            label: `${p.name} · ${p.staffCount} staff${p.archived ? " (archived)" : ""}`,
          }))}
        />
        {canEdit && (
          <div className="space-y-2">
            <Input
              label="New or duplicate plan name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {["Hair", "TP"].map((sample) => (
                <Button
                  key={sample}
                  disabled={locked || !name.trim()}
                  onClick={() =>
                    void save("/plans", {
                      name,
                      description: `${sample} sample — review before publishing`,
                      positions: [],
                      outletIds: data.outletId ? [data.outletId] : [],
                      definition: sample === "Hair" ? hairPayrollExample() : tpPayrollExample(),
                    })
                  }
                >
                  Create {sample} sample draft
                </Button>
              ))}
              {plan && (
                <Button
                  variant="secondary"
                  disabled={locked || !name.trim()}
                  onClick={() =>
                    void save(`/plans/${plan.id}/duplicate`, {
                      name,
                      description: plan.description,
                      positions: plan.positions,
                      outletIds: data.outletId ? [data.outletId] : plan.outletIds,
                      expectedRevision: plan.revision,
                    })
                  }
                >
                  Duplicate plan
                </Button>
              )}
            </div>
          </div>
        )}
        {plan && version && definition && (
          <>
            <p>
              {plan.description} · Positions: {plan.positions.join(", ") || "All"} ·{" "}
              {plan.archived
                ? "Archived"
                : version.status === "DRAFT"
                  ? "Draft"
                  : version.effectiveFrom > data.today
                    ? "Scheduled"
                    : "Published"}{" "}
              · Revision {plan.revision}
            </p>
            <Select
              label="Plan component"
              value={component?.key ?? ""}
              onChange={(e) => setComponentKey(e.target.value)}
              options={[...definition.components]
                .sort((a, b) => a.sort - b.sort)
                .map((c) => ({ value: c.key, label: c.name }))}
            />
            {component && (
              <fieldset disabled={locked || plan.archived} className="space-y-3">
                <Input
                  label="Component name"
                  value={component.name}
                  onChange={(e) => editComponent({ name: e.target.value })}
                />
                <div className="flex flex-wrap gap-3" aria-label="Sales that count">
                  {[
                    "SVC",
                    "PRD",
                    "PKG_SALE",
                    "PKG_RED",
                    "FOC",
                    "VP_SALE",
                    "VP_SPEND",
                    "GC_SALE",
                  ].map((type) => (
                    <label key={type}>
                      <input
                        type="checkbox"
                        checked={component.commissionTypes.includes(type as never)}
                        onChange={(e) =>
                          editComponent({
                            commissionTypes: e.target.checked
                              ? [...component.commissionTypes, type as never]
                              : component.commissionTypes.filter((v) => v !== type),
                          })
                        }
                      />{" "}
                      {type}
                    </label>
                  ))}
                </div>
                <Input
                  label="Base percentage"
                  value={component.basePct}
                  onChange={(e) => editComponent({ basePct: e.target.value })}
                />
                <Input
                  key={`${plan.id}-${component.key}-include-${JSON.stringify(component.categoryInclude)}`}
                  label="Included category keys (comma-separated, blank = all)"
                  hint="Use the category keys recorded on commission base lines. Exclusions take precedence."
                  defaultValue={component.categoryInclude?.join(", ") ?? ""}
                  onBlur={(e) =>
                    editComponent({
                      categoryInclude: [
                        ...new Set(
                          e.target.value
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        ),
                      ],
                    })
                  }
                />
                <Input
                  key={`${plan.id}-${component.key}-exclude-${JSON.stringify(component.categoryExclude)}`}
                  label="Excluded category keys (comma-separated)"
                  defaultValue={component.categoryExclude?.join(", ") ?? ""}
                  onBlur={(e) =>
                    editComponent({
                      categoryExclude: [
                        ...new Set(
                          e.target.value
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        ),
                      ],
                    })
                  }
                />
                <Input
                  label="Monthly cap (blank for no cap)"
                  value={component.monthlyCap ?? ""}
                  onChange={(e) => editComponent({ monthlyCap: e.target.value || null })}
                />
                <Select
                  label="Calculation method"
                  value={component.method}
                  onChange={(e) =>
                    editComponent({ method: e.target.value as PayrollComponent["method"] })
                  }
                  options={[
                    { value: "FLAT", label: "Flat percentage" },
                    { value: "TIER_WHOLE", label: "Whole amount — reached rate on all base" },
                    { value: "TIER_SLICE", label: "By slice — each band at its own rate" },
                    { value: "TIER_MIXED", label: "Mixed — whole or slice per band" },
                    { value: "FIXED_PER_UNIT", label: "Fixed amount per credited unit" },
                  ]}
                />
                {component.method === "FLAT" && (
                  <Input
                    label="Flat rate percentage"
                    value={component.flatRatePct ?? ""}
                    onChange={(e) => editComponent({ flatRatePct: e.target.value })}
                  />
                )}
                {component.method === "FIXED_PER_UNIT" && (
                  <Input
                    label="Fixed amount per unit"
                    value={component.fixedAmount ?? ""}
                    onChange={(e) => editComponent({ fixedAmount: e.target.value })}
                  />
                )}
                {component.bands.map((band, index) => (
                  <div className="flex flex-wrap items-end gap-2" key={index}>
                    <Input
                      label={`Band ${index + 1} upper limit (blank = uncapped)`}
                      value={band.upperLimit ?? ""}
                      onChange={(e) =>
                        editComponent({
                          bands: component.bands.map((b, i) =>
                            i === index ? { ...b, upperLimit: e.target.value || null } : b,
                          ),
                        })
                      }
                    />
                    <Input
                      label={`Band ${index + 1} standard rate`}
                      value={band.ratePct}
                      onChange={(e) =>
                        editComponent({
                          bands: component.bands.map((b, i) =>
                            i === index ? { ...b, ratePct: e.target.value } : b,
                          ),
                        })
                      }
                    />
                    {definition.stages
                      .filter((s) => s.key !== "std")
                      .map((stage) => (
                        <Input
                          key={stage.key}
                          label={`Band ${index + 1} ${stage.name} rate (blank = standard)`}
                          value={band.stageRates?.[stage.key] ?? ""}
                          onChange={(e) =>
                            editComponent({
                              bands: component.bands.map((b, i) =>
                                i === index
                                  ? {
                                      ...b,
                                      stageRates: {
                                        ...b.stageRates,
                                        [stage.key]: e.target.value || null,
                                      },
                                    }
                                  : b,
                              ),
                            })
                          }
                        />
                      ))}
                    {component.method === "TIER_MIXED" && (
                      <Select
                        label={`Band ${index + 1} applies`}
                        value={band.applyMode}
                        onChange={(e) =>
                          editComponent({
                            bands: component.bands.map((b, i) =>
                              i === index
                                ? { ...b, applyMode: e.target.value as "WHOLE" | "SLICE" }
                                : b,
                            ),
                          })
                        }
                        options={[
                          { value: "WHOLE", label: "From $1" },
                          { value: "SLICE", label: "Slice only" },
                        ]}
                      />
                    )}
                    <Button
                      variant="secondary"
                      onClick={() =>
                        editComponent({ bands: component.bands.filter((_, i) => i !== index) })
                      }
                    >
                      Remove band {index + 1}
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      editComponent({
                        bands: [
                          ...component.bands,
                          { upperLimit: null, ratePct: "0", applyMode: "SLICE" },
                        ],
                      })
                    }
                  >
                    Add band
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      change({
                        ...definition,
                        components: [
                          ...definition.components,
                          {
                            key: crypto.randomUUID(),
                            name: "New component",
                            commissionTypes: ["SVC"],
                            basePct: "100",
                            method: "FLAT",
                            flatRatePct: "0",
                            bands: [],
                            sort: definition.components.length + 1,
                          },
                        ],
                      })
                    }
                  >
                    Add component
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      change({
                        ...definition,
                        components: [
                          ...definition.components,
                          {
                            ...component,
                            key: crypto.randomUUID(),
                            name: `${component.name} copy`,
                          },
                        ],
                      })
                    }
                  >
                    Duplicate component
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      change({
                        ...definition,
                        components: definition.components.filter((c) => c.key !== component.key),
                      })
                    }
                  >
                    Remove component
                  </Button>
                </div>
              </fieldset>
            )}
            <PayrollDefinitionEditor
              definition={definition}
              disabled={locked || plan.archived || advanced !== null}
              onChange={change}
            />
            {validation.errors.map((message) => (
              <p role="alert" key={message}>
                {message}
              </p>
            ))}
            {validation.warnings.map((message) => (
              <p key={message}>{message}</p>
            ))}
            <details>
              <summary>Advanced definition JSON backup and import</summary>
              <p>
                Edit the complete plan JSON. Validation is required before saving; monetary values
                are strings.
              </p>
              <label className="block">
                Plan definition JSON
                <textarea
                  className="min-h-64 w-full rounded border p-2 font-mono text-sm"
                  disabled={locked || plan.archived}
                  value={advanced ?? JSON.stringify(definition, null, 2)}
                  onChange={(e) => setAdvanced(e.target.value)}
                />
              </label>
              <Button
                disabled={locked || advanced === null}
                onClick={() => {
                  try {
                    change(payrollPlanDefinitionSchema.parse(JSON.parse(advanced!)));
                    setAdvanced(null);
                    setError("");
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : "Invalid plan JSON.");
                  }
                }}
              >
                Apply JSON to draft
              </Button>
            </details>
            <Input
              label="Plan effective date"
              type="date"
              min={data.today}
              value={
                draft?.date ??
                (version.effectiveFrom < data.today ? data.today : version.effectiveFrom)
              }
              disabled={locked || plan.archived}
              onChange={(e) =>
                setDraft({
                  planId: plan.id,
                  revision: draft?.revision ?? plan.revision,
                  definition,
                  date: e.target.value,
                })
              }
            />
            {canEdit && (
              <div className="flex gap-2">
                <Button
                  disabled={
                    locked || plan.archived || !!validation.errors.length || advanced !== null
                  }
                  onClick={() =>
                    void save(`/plans/${plan.id}/draft`, {
                      expectedRevision: draft?.revision ?? plan.revision,
                      effectiveFrom:
                        draft?.date ??
                        (version.effectiveFrom < data.today ? data.today : version.effectiveFrom),
                      definition,
                    })
                  }
                >
                  Save plan draft
                </Button>
                <Button
                  disabled={
                    locked ||
                    plan.archived ||
                    version.status !== "DRAFT" ||
                    !!draft ||
                    advanced !== null
                  }
                  onClick={() =>
                    void save(`/plans/${plan.id}/publish`, { expectedRevision: plan.revision })
                  }
                >
                  Publish saved version
                </Button>
                <Button
                  variant="secondary"
                  disabled={locked || plan.archived}
                  onClick={() =>
                    void save(`/plans/${plan.id}/archive`, { expectedRevision: plan.revision })
                  }
                >
                  Archive plan
                </Button>
              </div>
            )}
            <details>
              <summary>Version history and comparison</summary>
              {plan.versions.map((v, index) => (
                <div key={v.id} className="my-2 border-b pb-2">
                  <p>
                    Version {v.versionNo} · {v.status} · effective {v.effectiveFrom} · {v.actorId}:{" "}
                    {v.reason}
                  </p>
                  <pre className="overflow-auto text-xs">
                    {JSON.stringify(v.definition, null, 2)}
                  </pre>
                  {index === 0 && draft && (
                    <p>
                      Unsaved draft differs:{" "}
                      {JSON.stringify(draft.definition) !== JSON.stringify(v.definition)
                        ? "Yes"
                        : "No"}
                    </p>
                  )}
                </div>
              ))}
            </details>
            <section aria-label="Commission calculator" className="space-y-2">
              <h3>Test calculator and method comparison</h3>
              <Input
                label="Calculator monthly base"
                value={base}
                onChange={(e) => setBase(e.target.value)}
              />
              <Input
                label="Calculator credited units"
                value={units}
                onChange={(e) => setUnits(e.target.value)}
              />
              <Select
                label="Calculator stage"
                value={stageKey}
                onChange={(e) => setStageKey(e.target.value)}
                options={[
                  { value: "std", label: "Standard" },
                  ...definition.stages
                    .filter((s) => s.key !== "std")
                    .map((s) => ({ value: s.key, label: s.name })),
                ]}
              />
              {calculatorError && <p role="alert">{calculatorError}</p>}
              {calculator && (
                <>
                  <p>Calculated commission: S${calculator.amount}</p>
                  <pre className="overflow-auto text-xs">
                    {JSON.stringify(calculator.working, null, 2)}
                  </pre>
                </>
              )}
              {comparison.map((row) => (
                <p key={row.method}>
                  {row.method}: S${row.result.amount}
                </p>
              ))}
              {!!curve.length && (
                <>
                  <p>
                    Commission vs base,{" "}
                    {definition.stages.find((stage) => stage.key === stageKey)?.name ?? "Standard"}{" "}
                    stage, S$0–30,000. Test base: S${base}. Blue: whole; green: slice; purple:
                    mixed.
                  </p>
                  <svg
                    role="img"
                    aria-label="Commission method comparison chart"
                    viewBox="0 0 600 200"
                    className="w-full max-w-2xl border"
                  >
                    <title>Selected-stage whole, slice and mixed comparison</title>
                    {["TIER_WHOLE", "TIER_SLICE", "TIER_MIXED"].map((method, i) => (
                      <polyline
                        key={method}
                        fill="none"
                        stroke={["#2563eb", "#16a34a", "#9333ea"][i]}
                        points={curve
                          .map(
                            (point) =>
                              `${Number(point.base) / 50},${200 - Number(point.methods.find((m) => m.method === method)?.result.amount ?? 0) / 50}`,
                          )
                          .join(" ")}
                      />
                    ))}
                    <line
                      x1={Number(base) / 50}
                      x2={Number(base) / 50}
                      y1="0"
                      y2="200"
                      stroke="currentColor"
                      strokeDasharray="4"
                    />
                  </svg>
                </>
              )}
            </section>
          </>
        )}
        {!data.outletId && (
          <>
            <PayrollAssignments
              key={`assign-${data.assignments.revision}`}
              data={data}
              canEdit={canEdit && !mutation.isPending}
              staffId={staffId}
              save={save}
            />
            <details>
              <summary>Salon commission settings (configuration only)</summary>
              <JsonSettings
                key={data.settings.revision}
                value={data.settings}
                canEdit={canEdit && !mutation.isPending}
                save={(body) => save("/settings", body)}
                label="Salon settings JSON"
              />
            </details>
          </>
        )}
        <details>
          <summary>Configuration audit (latest {data.historyLimit} events)</summary>
          {data.history.map((e) => (
            <div key={e.id}>
              <p>
                {e.createdAt} · {e.kind} · revision {e.revision} · {e.actorId}: {e.reason}
              </p>
              <pre className="overflow-auto text-xs">{JSON.stringify(e.payload, null, 2)}</pre>
            </div>
          ))}
        </details>
        <p>
          Historical impact preview is not available until authoritative monthly inputs and closed
          payroll periods are integrated. Calculator values are simulations, not historical payroll.
        </p>
      </div>
    </Card>
  );
}

function JsonSettings({
  value,
  canEdit,
  save,
  label,
}: {
  value: object & { revision: number };
  canEdit: boolean;
  save: (body: object) => Promise<void>;
  label: string;
}) {
  const { revision, ...fields } = value;
  const [text, setText] = useState(JSON.stringify(fields, null, 2));
  const [error, setError] = useState("");
  return (
    <div className="space-y-2">
      <label>
        {label}
        <textarea
          className="block min-h-40 w-full border p-2 font-mono"
          disabled={!canEdit}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <Button
        disabled={!canEdit}
        onClick={() => {
          try {
            const parsed: unknown = JSON.parse(text);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
              throw new Error("Enter a JSON object.");
            void save({ ...parsed, expectedRevision: revision });
            setError("");
          } catch {
            setError("Enter a valid JSON object.");
          }
        }}
      >
        Save {label}
      </Button>
    </div>
  );
}

function PayrollAssignments({
  data,
  canEdit,
  save,
  staffId,
}: {
  data: PayrollConfiguration;
  canEdit: boolean;
  save: (url: string, body: object) => Promise<void>;
  staffId?: string;
}) {
  const [staffIds, setStaffIds] = useState<string[]>(staffId ? [staffId] : []);
  const [planId, setPlanId] = useState("");
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
            { value: "", label: "No plan — flat fallback" },
            ...data.plans
              .filter((p) => !p.archived && !p.outletIds.length)
              .map((p) => ({ value: p.id, label: p.name })),
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
          disabled={!staffIds.length}
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
          <pre className="overflow-auto text-xs">{JSON.stringify(schedule, null, 2)}</pre>
          <JsonSettings
            key={`staff-${person.id}-${person.settings.revision}`}
            label="Staff join date and stage override JSON"
            value={person.settings}
            canEdit={canEdit}
            save={(body) => save(`/staff/${person.id}/settings`, body)}
          />
          {person.profile && (
            <JsonSettings
              key={`profile-${person.id}-${person.profile.revision}`}
              label="Salary profile JSON"
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
                {r.toDate ?? "ongoing"}
              </p>
            ))}
        </div>
      )}
    </section>
  );
}
