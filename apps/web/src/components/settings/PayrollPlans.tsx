import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import {
  hairPayrollExample,
  tpPayrollExample,
  payrollPlanDefinitionSchema,
  validatePayrollPlan,
  calculatePayrollComponent,
  comparePayrollMethods,
  payrollCommissionCurve,
  type PayrollPlanDefinition,
  type PayrollComponent,
  type PayrollAssignment,
  type PayrollSettingsWrite,
  type PayrollProfileWrite,
} from "@glampro_suite/shared";
import { get, post, getErrorMessage, getErrorCode } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Modal from "@/components/ui/Modal";
import Tabs from "@/components/ui/Tabs";
import Skeleton from "@/components/ui/Skeleton";
import PayrollDefinitionEditor from "./PayrollDefinitionEditor";
import PayrollActivationStatus from "./PayrollActivationStatus";
import PayrollAssignments from "./PayrollAssignments";
import PayrollVersionComparison from "./PayrollVersionComparison";
import PayrollHistoricalPreview from "./PayrollHistoricalPreview";
import type { PayrollPostedMoney } from "./payroll-impact";
import { PayrollSalonSettingsForm, PayrollPlanMetadataForm } from "./PayrollSettingsForms";

/**
 * The commission types a plan component may count. `GC_SALE` is deliberately absent:
 * no producer writes a gift-card sale base line, so offering it would promise
 * commission on revenue the close can never see (CP-008 (d)).
 *
 * Only this picker is narrowed. `payrollCommissionTypeSchema` keeps the full
 * vocabulary, because it is strict and already-published definitions may hold
 * `GC_SALE` — dropping the value there would make a saved definition unparseable
 * and block a close. A component that counts it keeps counting it untouched.
 */
const COMPONENT_COMMISSION_TYPES: readonly PayrollComponent["commissionTypes"][number][] = [
  "SVC",
  "PRD",
  "PKG_SALE",
  "PKG_RED",
  "FOC",
  "VP_SALE",
  "VP_SPEND",
];

const COMMISSION_TYPE_LABELS: Record<string, string> = {
  SVC: "Services",
  PRD: "Products",
  PKG_SALE: "Package sales",
  PKG_RED: "Package redemptions",
  FOC: "Complimentary services",
  VP_SALE: "Value-package sales",
  VP_SPEND: "Value-package spending",
};

const METHOD_LABELS: Record<PayrollComponent["method"], string> = {
  FLAT: "Flat percentage",
  TIER_WHOLE: "Reached rate on the whole amount",
  TIER_SLICE: "Each tier at its own rate",
  TIER_MIXED: "Mixed tier rules",
  FIXED_PER_UNIT: "Fixed amount per unit",
};

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
    settings: {
      revision: number;
      joinDate: string | null;
      stageEndOverride: number | null;
      commissionRole?: "COMMISSION_EARNING" | "NON_COMMISSION" | null;
    };
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
  historyPage: number;
  historyTotal: number;
}

export default function PayrollPlans({ canEdit, staffId }: { canEdit: boolean; staffId?: string }) {
  const client = useQueryClient();
  const { user } = useAuth();
  const [historyPage, setHistoryPage] = useState(1);
  const query = useQuery({
    queryKey: ["payroll-configuration", historyPage, user?.twoFactorEnabled],
    queryFn: () => get<PayrollConfiguration>("/payroll-configuration", { historyPage }),
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
  const [selected, setSelected] = useState("");
  const [view, setView] = useState("list");
  const [step, setStep] = useState("details");
  const [metadataDirty, setMetadataDirty] = useState(false);
  const [metadataKey, setMetadataKey] = useState(0);
  const [pendingSave, setPendingSave] = useState<{ url: string; body: object } | null>(null);
  const [discardTarget, setDiscardTarget] = useState<{ view: string; planId?: string } | null>(
    null,
  );
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
  // Posted money is published by the readiness check, keyed by the revision it was
  // calculated for, so a saved draft can never inherit the previous rules' money.
  const [postedMoney, setPostedMoney] = useState<Record<string, PayrollPostedMoney | null>>({});
  const recordPostedMoney = useCallback(
    (planId: string, revision: number, money: PayrollPostedMoney | null) =>
      setPostedMoney((current) => {
        const key = `${planId}-${revision}`;
        return current[key] === money ? current : { ...current, [key]: money };
      }),
    [],
  );
  const mutation = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) => post(url, body),
  });
  const calculatorPlan = query.data?.plans.find((p) => p.id === selected) ?? query.data?.plans[0];
  const calculatedDefinition =
    draft && draft.planId === calculatorPlan?.id
      ? draft.definition
      : calculatorPlan?.versions[0]?.definition;
  const selectedComponent =
    calculatedDefinition?.components.find((c) => c.key === componentKey) ??
    calculatedDefinition?.components[0];
  const calculations = useMemo(() => {
    let calculator: ReturnType<typeof calculatePayrollComponent> | null = null;
    let comparison: ReturnType<typeof comparePayrollMethods> = [];
    let curve: ReturnType<typeof payrollCommissionCurve> = [];
    let calculatorError = "";
    try {
      if (selectedComponent) {
        calculator = calculatePayrollComponent(selectedComponent, base, { stageKey, units });
        comparison = comparePayrollMethods(selectedComponent, base, { stageKey, units });
        if (selectedComponent.method.startsWith("TIER_"))
          curve = payrollCommissionCurve(selectedComponent, "30000", 60, { stageKey, units });
      }
    } catch (cause) {
      calculatorError = cause instanceof Error ? cause.message : "Invalid calculator input.";
    }
    return { calculator, comparison, curve, calculatorError };
  }, [selectedComponent, base, stageKey, units]);
  async function save(url: string, body: object, confirmed = false) {
    if (!staffId && !confirmed) {
      setReason("");
      setError("");
      setPendingSave({ url, body });
      return;
    }
    setError("");
    setNotice("");
    try {
      if (reason.trim().length < 3)
        throw new Error("Enter a change reason (at least 3 characters).");
      await mutation.mutateAsync({
        url: `/payroll-configuration${url}`,
        body: { ...body, reason },
      });
      if (url.endsWith("/draft")) {
        setDraft(null);
        setAdvanced(null);
      }
      setReason("");
      await client.invalidateQueries({ queryKey: ["payroll-configuration"] });
      await client.invalidateQueries({ queryKey: ["staff"] });
      setNotice("Configuration saved. Payroll activation and posted money are unchanged.");
      if (url.endsWith("/metadata")) setMetadataDirty(false);
      setPendingSave(null);
      if (url === "/plans" || url.endsWith("/duplicate")) setView("list");
    } catch (cause) {
      setError(getErrorMessage(cause));
    }
  }
  if (query.isPending && query.errorUpdateCount === 0)
    // A card the shape of the one that is coming, so choosing the Payroll section does
    // not flash a paragraph and then replace it with a form.
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-4">
        <span className="sr-only">Loading payroll plans…</span>
        <div className="rounded-card border border-line bg-surface">
          <div className="border-b border-line-soft px-5 py-4">
            <Skeleton className="h-5 max-w-48" />
          </div>
          <div className="flex flex-col gap-4 px-5 py-4">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
        <Skeleton className="h-11 max-w-40" />
      </div>
    );
  if (query.isError && getErrorCode(query.error) === "OWNER_TWO_FACTOR_REQUIRED")
    return (
      <Card title="Enable two-factor authentication to access pay plans">
        <div className="space-y-3">
          <p>
            Your owner account needs email verification enabled before you can access pay plans.
          </p>
          <p className="text-sm text-ink-muted">
            Go to Privacy &amp; security → Account security, turn on Email verification code at
            sign-in, and confirm the six-digit code sent to your email.
          </p>
          <Link
            to="/settings?section=privacy&returnTo=pay-plans"
            className="inline-flex min-h-control items-center rounded-md bg-purple px-4.5 font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple"
          >
            Set up email verification
          </Link>
          <p className="text-sm text-ink-muted">
            After completing setup, return to Pay plans. Your plans will reload automatically.
          </p>
        </div>
      </Card>
    );
  if (query.isError || !query.data)
    return (
      <div role="alert" className="space-y-3">
        <p>Unable to load commission plans.</p>
        <p className="text-sm text-ink-muted">
          {query.error
            ? getErrorMessage(query.error)
            : query.isFetching
              ? "Loading commission plans again…"
              : "No configuration was returned. Please retry loading the plans."}
        </p>
        <Button loading={query.isFetching} onClick={() => void query.refetch()}>
          {query.isFetching ? "Retrying plans…" : "Retry plans"}
        </Button>
      </div>
    );
  const data = query.data;
  const plan = data.plans.find((p) => p.id === selected) ?? data.plans[0];
  const version = plan?.versions[0];
  // `draft` is tested before the comparison, not through it: `draft?.planId` and
  // `plan?.id` are both `undefined` in a salon with no plans, which made the
  // equality hold and then read `definition` off a null draft — a crash on the
  // empty state, not on a configured one.
  const definition = draft && draft.planId === plan?.id ? draft.definition : version?.definition;
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
  const { calculator, comparison, curve, calculatorError } = calculations;
  const activeAssignments = data.assignments.rows.filter(
    (r) => r.fromDate <= data.today && (!r.toDate || r.toDate >= data.today),
  );
  function navigate(nextView: string, planId?: string) {
    if (
      (nextView === "create" || (planId && planId !== plan?.id)) &&
      (draft || advanced !== null || metadataDirty)
    ) {
      setDiscardTarget({ view: nextView, planId });
      return;
    }
    if (planId) setSelected(planId);
    setView(nextView);
  }
  if (staffId)
    return (
      <Card
        title="Commission plan and payroll"
        description="Assign a published plan and maintain payroll details. Save staff identity changes separately."
      >
        <PayrollActivationStatus today={data.today} compact />
        {error && !pendingSave && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {data.outletId ? (
          <p>Switch to company context to manage staff assignments and payroll profiles.</p>
        ) : (
          <>
            <Input
              label="Payroll change reason"
              placeholder="e.g. Assigned to the senior stylist plan"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={!canEdit || mutation.isPending}
            />
            <PayrollAssignments
              key={`assign-${staffId}-${data.assignments.revision}`}
              data={data}
              canEdit={canEdit && !mutation.isPending && !query.isFetching}
              staffId={staffId}
              save={save}
            />
          </>
        )}
      </Card>
    );
  return (
    <Card
      title="Pay plans"
      description="Define commission rules, assign staff, and preview earnings before publishing."
    >
      <div className="space-y-4">
        <PayrollActivationStatus today={data.today} compact />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => navigate("list")}>
            All plans
          </Button>
          {canEdit && <Button onClick={() => navigate("create")}>Create plan</Button>}
          {!data.outletId && (
            <Button variant="secondary" onClick={() => navigate("policies")}>
              Payroll policies
            </Button>
          )}
          <Button variant="secondary" onClick={() => navigate("audit")}>
            Configuration history
          </Button>
          <Link to="/staff" className="text-sm font-bold text-purple">
            Staff payroll profiles
          </Link>
        </div>
        <details>
          <summary className="text-sm text-ink-muted">How pay plans work</summary>
          <p className="mt-2 text-sm text-ink-muted">
            Create rules, test a calculation, publish an effective version, then assign staff.
            Publishing does not activate payroll. Salary and employment details belong on each staff
            profile.
          </p>
        </details>
        {view === "list" && (
          <section aria-label="Pay-plan list" className="space-y-3">
            {!data.plans.length && <p>No pay plans yet. Create a plan to get started.</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="p-3">Plan</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Assigned staff</th>
                    <th className="p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.plans.map((item) => {
                    const latest = item.versions[0];
                    const published = item.versions.find(
                      (v) => v.status === "PUBLISHED" && v.effectiveFrom <= data.today,
                    );
                    const status = item.archived
                      ? "Archived"
                      : latest?.status === "DRAFT"
                        ? published
                          ? "Published · draft changes"
                          : "Draft"
                        : latest && latest.effectiveFrom > data.today
                          ? `Scheduled · ${latest.effectiveFrom}`
                          : "Published";
                    return (
                      <tr key={item.id} className="border-b border-line">
                        <td className="p-3 font-bold">{item.name}</td>
                        <td className="p-3">{status}</td>
                        <td className="p-3">{item.staffCount}</td>
                        <td className="flex flex-wrap gap-2 p-3">
                          <Button variant="secondary" onClick={() => navigate("edit", item.id)}>
                            {canEdit ? `Edit ${item.name}` : `View ${item.name}`}
                          </Button>
                          {!data.outletId && canEdit && !item.archived && (
                            <Button variant="secondary" onClick={() => navigate("assign", item.id)}>
                              Assign staff to {item.name}
                            </Button>
                          )}
                          <Button variant="secondary" onClick={() => navigate("history", item.id)}>
                            History for {item.name}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-ink-muted">
              {
                data.staff.filter(
                  (person) =>
                    !person.disabled && !activeAssignments.some((row) => row.staffId === person.id),
                ).length
              }{" "}
              staff without a current plan assignment. Commission-earning staff need an applicable
              published plan before monthly payroll.
            </p>
          </section>
        )}
        {data.outletId && (
          <p>
            Outlet-scoped plans only. Staff assignments and salary profiles require company context.
          </p>
        )}
        {error && !pendingSave && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {stale && <p role="alert">This draft is stale. Reload and discard it before saving.</p>}
        {view === "edit" && (
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
        )}
        <section
          hidden={!["edit", "create", "history", "tools"].includes(view)}
          aria-label="Plan workspace"
          className="space-y-4"
        >
          {plan && view !== "create" && (
            <h3 className="font-bold">
              {plan.name}
              {draft ? " · unsaved rules" : ""}
            </h3>
          )}
          {view === "edit" && (
            <Tabs
              label="Plan editor steps"
              activeId={step}
              onChange={setStep}
              items={[
                { id: "details", label: "1. Details", content: null },
                { id: "rules", label: "2. Earning rules", content: null },
                { id: "review", label: "3. Review", content: null },
              ]}
            />
          )}
          {canEdit && (
            <div hidden={view !== "create"} className="space-y-3 rounded-lg border border-line p-4">
              <h3 className="font-bold">Create a plan</h3>
              <p className="text-sm text-ink-muted">
                Start from a sample or duplicate the selected plan. Templates are examples, not
                approved pay policies; review all rates before publishing.
              </p>
              <Input
                label="New or duplicate plan name"
                placeholder="e.g. Hair stylist plan 2027"
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
                    Create {sample === "Hair" ? "hair stylist" : "therapist (TP)"} sample draft
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
                    Duplicate {plan.name}
                  </Button>
                )}
              </div>
            </div>
          )}
          {plan && version && definition && (
            <>
              <div hidden={view !== "edit" || step !== "details"}>
                <PayrollPlanMetadataForm
                  key={`${plan.id}-${metadataKey}`}
                  onDirtyChange={setMetadataDirty}
                  value={{
                    revision: plan.revision,
                    name: plan.name,
                    description: plan.description,
                    positions: plan.positions,
                    outletIds: plan.outletIds,
                  }}
                  canEdit={
                    canEdit &&
                    !mutation.isPending &&
                    !query.isFetching &&
                    !plan.archived &&
                    !draft &&
                    advanced === null
                  }
                  save={(body) => save(`/plans/${plan.id}/metadata`, body)}
                />
                <p className="text-sm text-ink-muted">
                  {plan.outletIds.length ? "Selected outlets" : "Salon-wide"} · Version{" "}
                  {version.versionNo} ·{" "}
                  {version.status === "DRAFT"
                    ? "Draft"
                    : version.effectiveFrom > data.today
                      ? "Scheduled"
                      : "Published"}{" "}
                  · effective {version.effectiveFrom}
                </p>
              </div>
              <div hidden={view !== "edit" || step !== "rules"} className="space-y-4">
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
                      placeholder="e.g. Service commission"
                      value={component.name}
                      onChange={(e) => editComponent({ name: e.target.value })}
                    />
                    <div className="flex flex-wrap gap-3" aria-label="Sales that count">
                      {COMPONENT_COMMISSION_TYPES.map((type) => (
                        <label key={type}>
                          <input
                            type="checkbox"
                            checked={component.commissionTypes.includes(type)}
                            onChange={(e) =>
                              editComponent({
                                commissionTypes: e.target.checked
                                  ? [...component.commissionTypes, type]
                                  : component.commissionTypes.filter((v) => v !== type),
                              })
                            }
                          />{" "}
                          {COMMISSION_TYPE_LABELS[type] ?? type}
                        </label>
                      ))}
                    </div>
                    <details>
                      <summary>
                        Advanced earning rules · {component.basePct}% base
                        {component.monthlyCap ? ` · cap ${component.monthlyCap}` : ""}
                        {component.categoryInclude?.length || component.categoryExclude?.length
                          ? " · category filters apply"
                          : ""}
                      </summary>
                      <div className="space-y-3 pt-3">
                        <Input
                          label="Base percentage"
                          hint="Share of eligible sales used as the base, not the commission rate. Example: 5,000 sales × 100% base × 10% flat rate = 500 commission."
                          placeholder="e.g. 5"
                          value={component.basePct}
                          onChange={(e) => editComponent({ basePct: e.target.value })}
                        />
                        <Input
                          key={`${plan.id}-${component.key}-include-${JSON.stringify(component.categoryInclude)}`}
                          label="Included category keys (comma-separated, blank = all)"
                          hint="Use the category keys recorded on commission base lines. Exclusions take precedence."
                          placeholder="e.g. COLOUR, TREATMENT"
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
                          placeholder="e.g. RETAIL, GIFT_CARD"
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
                          placeholder="e.g. 1500.00"
                          value={component.monthlyCap ?? ""}
                          onChange={(e) => editComponent({ monthlyCap: e.target.value || null })}
                        />
                      </div>
                    </details>
                    <Select
                      label="Calculation method"
                      hint="Whole amount uses the reached rate on the entire base. By slice applies each rate only to its band."
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
                        placeholder="e.g. 5"
                        value={component.flatRatePct ?? ""}
                        onChange={(e) => editComponent({ flatRatePct: e.target.value })}
                      />
                    )}
                    {component.method === "FIXED_PER_UNIT" && (
                      <Input
                        label="Fixed amount per unit"
                        placeholder="0.00"
                        value={component.fixedAmount ?? ""}
                        onChange={(e) => editComponent({ fixedAmount: e.target.value })}
                      />
                    )}
                    {component.method.startsWith("TIER_") &&
                      component.bands.map((band, index) => (
                        <div className="flex flex-wrap items-end gap-2" key={index}>
                          <Input
                            label={`Band ${index + 1} upper limit (blank = uncapped)`}
                            placeholder="e.g. 10000"
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
                            placeholder="e.g. 3"
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
                                placeholder="e.g. 4"
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
                              editComponent({
                                bands: component.bands.filter((_, i) => i !== index),
                              })
                            }
                          >
                            Remove band {index + 1}
                          </Button>
                        </div>
                      ))}
                    <div className="flex flex-wrap gap-2">
                      {component.method.startsWith("TIER_") && (
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
                      )}
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
                            components: definition.components.filter(
                              (c) => c.key !== component.key,
                            ),
                          })
                        }
                      >
                        Remove component
                      </Button>
                    </div>
                  </fieldset>
                )}
                <details>
                  <summary>
                    Tenure stages, incentives and ordering · {definition.stages.length} stages ·{" "}
                    {definition.incentives.length} incentives
                  </summary>
                  <PayrollDefinitionEditor
                    definition={definition}
                    disabled={locked || plan.archived || advanced !== null}
                    onChange={change}
                  />
                </details>
                {[...new Set(validation.errors)].map((message) => (
                  <p role="alert" key={message}>
                    {message}
                  </p>
                ))}
                {[...new Set(validation.warnings)].map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </div>
              <div hidden={view !== "tools"}>
                <details open>
                  <summary>Advanced definition JSON backup and import</summary>
                  <Button
                    variant="secondary"
                    disabled={locked || plan.archived}
                    onClick={() =>
                      void save(`/plans/${plan.id}/archive`, { expectedRevision: plan.revision })
                    }
                  >
                    Archive plan
                  </Button>
                  <p>
                    Edit the complete plan JSON. Validation is required before saving; monetary
                    values are strings.
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
              </div>
              <div hidden={view !== "edit" || step !== "review"} className="space-y-4">
                <h3 className="font-bold">Review before publishing</h3>
                <p className="text-sm text-ink-muted">
                  {definition.stages.length} tenure stages · {definition.incentives.length}{" "}
                  incentive rules. Existing advanced rules remain in place.
                </p>
                {definition.components.map((rule) => (
                  <div key={rule.key} className="rounded-lg border border-line p-3 text-sm">
                    <strong>{rule.name}</strong>
                    <p>
                      {rule.commissionTypes
                        .map((type) => COMMISSION_TYPE_LABELS[type] ?? type)
                        .join(", ")}
                    </p>
                    <p>
                      {METHOD_LABELS[rule.method]} ·{" "}
                      {rule.method === "FLAT"
                        ? `${rule.flatRatePct}% rate`
                        : rule.method === "FIXED_PER_UNIT"
                          ? `${rule.fixedAmount} per unit`
                          : `${rule.bands.length} tier bands`}{" "}
                      · {rule.basePct}% base{rule.monthlyCap ? ` · cap ${rule.monthlyCap}` : ""}
                    </p>
                    {!!(rule.categoryInclude?.length || rule.categoryExclude?.length) && (
                      <p>Category filters apply.</p>
                    )}
                  </div>
                ))}
                <Input
                  label="Plan effective date"
                  hint="The published version can be selected from this date. Staff also need an applicable plan assignment; publishing does not activate payroll."
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
                            (version.effectiveFrom < data.today
                              ? data.today
                              : version.effectiveFrom),
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
                        metadataDirty ||
                        !!draft ||
                        advanced !== null
                      }
                      onClick={() =>
                        void save(`/plans/${plan.id}/publish`, { expectedRevision: plan.revision })
                      }
                    >
                      Publish saved version
                    </Button>
                  </div>
                )}
              </div>
              <div hidden={view !== "history"}>
                <details open>
                  <summary>Version history and comparison</summary>
                  <PayrollVersionComparison
                    key={plan.id}
                    versions={plan.versions}
                    draft={draft?.definition}
                    postedMoney={postedMoney[`${plan.id}-${plan.revision}`]}
                  />
                  {plan.versions.map((v, index) => (
                    <div key={v.id} className="my-2 border-b pb-2">
                      <p>
                        Version {v.versionNo} · {v.status} · effective {v.effectiveFrom} ·{" "}
                        {v.actorId}: {v.reason}
                      </p>
                      <details>
                        <summary>Advanced version definition</summary>
                        <pre className="overflow-auto text-xs">
                          {JSON.stringify(v.definition, null, 2)}
                        </pre>
                      </details>
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
              </div>
              <div hidden={view !== "edit" || step !== "review"}>
                <section aria-label="Commission calculator" className="space-y-2">
                  <h3>Test calculator and method comparison</h3>
                  <Input
                    label="Calculator monthly base"
                    placeholder="e.g. 25000.00"
                    value={base}
                    onChange={(e) => setBase(e.target.value)}
                  />
                  <Input
                    label="Calculator credited units"
                    placeholder="e.g. 120"
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
                      <details>
                        <summary>Calculation breakdown</summary>
                        <pre className="overflow-auto text-xs">
                          {JSON.stringify(calculator.working, null, 2)}
                        </pre>
                      </details>
                    </>
                  )}
                  <details>
                    <summary>Compare calculation methods</summary>
                    {comparison.map((row) => (
                      <p key={row.method}>
                        {row.method}: S${row.result.amount}
                      </p>
                    ))}
                    {!!curve.length && (
                      <>
                        <p>
                          Commission vs base,{" "}
                          {definition.stages.find((stage) => stage.key === stageKey)?.name ??
                            "Standard"}{" "}
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
                  </details>
                </section>
              </div>
              {view === "edit" && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setView("impact")}>
                    Review historical impact
                  </Button>
                  <Button variant="secondary" onClick={() => setView("history")}>
                    Version history
                  </Button>
                  <Button variant="secondary" onClick={() => setView("tools")}>
                    Advanced tools
                  </Button>
                </div>
              )}
              {["tools", "history"].includes(view) && (
                <Button variant="secondary" onClick={() => setView("edit")}>
                  Back to editor
                </Button>
              )}
            </>
          )}
        </section>
        {!data.outletId && (
          <>
            <section
              hidden={view !== "assign"}
              aria-label="Assign staff"
              className="space-y-4 rounded-lg border border-line p-4"
            >
              <h3 className="font-bold">Assign staff to {plan?.name}</h3>
              <PayrollAssignments
                key={`assign-${plan?.id}-${data.assignments.revision}`}
                data={data}
                canEdit={canEdit && !mutation.isPending && !query.isFetching}
                save={save}
                initialPlanId={plan?.id}
              />
            </section>
            <section
              hidden={view !== "policies"}
              aria-label="Payroll policies"
              className="space-y-4 rounded-lg border border-line p-4"
            >
              <h3 className="font-bold">Payroll policies</h3>
              <PayrollSalonSettingsForm
                value={data.settings}
                canEdit={canEdit && !mutation.isPending && !query.isFetching}
                save={(body) => save("/settings", body)}
              />
            </section>
          </>
        )}
        <div hidden={view !== "audit"}>
          <details id="pay-plan-audit" className="scroll-mt-4 rounded-lg border border-line p-4">
            <summary>Configuration audit ({data.historyTotal} events)</summary>
            <p>
              Page {historyPage} of {Math.max(1, Math.ceil(data.historyTotal / data.historyLimit))}.
              New activity may shift page boundaries; refresh to see the latest events.
            </p>
            <Button
              variant="secondary"
              disabled={historyPage <= 1 || query.isFetching}
              onClick={() => setHistoryPage((page) => page - 1)}
            >
              Previous audit page
            </Button>
            <Button
              variant="secondary"
              disabled={historyPage * data.historyLimit >= data.historyTotal || query.isFetching}
              onClick={() => setHistoryPage((page) => page + 1)}
            >
              Next audit page
            </Button>
            {data.history.map((e) => (
              <div key={e.id}>
                <p>
                  {e.createdAt} · {e.kind} · revision {e.revision} · {e.actorId}: {e.reason}
                </p>
                <pre className="overflow-auto text-xs">{JSON.stringify(e.payload, null, 2)}</pre>
              </div>
            ))}
          </details>
        </div>
        <div hidden={view !== "impact"}>
          <h3 className="font-bold">Historical impact — {plan?.name}</h3>
          <p>
            The historical impact preview compares the last completed salon month&apos;s posted
            commission with the plan&apos;s latest saved rules. It never changes posted money, and
            unsaved edits are not included.
          </p>
          {canEdit && !data.outletId && plan && (
            <PayrollHistoricalPreview
              key={`${plan.id}-${plan.revision}`}
              planId={plan.id}
              revision={plan.revision}
              disabled={mutation.isPending || query.isFetching}
              onResult={recordPostedMoney}
            />
          )}
          <Button variant="secondary" onClick={() => setView("edit")}>
            Back to editor
          </Button>
        </div>
        <Modal
          open={!!pendingSave}
          onClose={() => {
            if (!mutation.isPending) setPendingSave(null);
          }}
          title="Confirm payroll configuration change"
          description="A reason is required for the audit history. This does not activate payroll or send payments."
          footer={
            <Button
              disabled={
                !canEdit || reason.trim().length < 3 || mutation.isPending || query.isFetching
              }
              onClick={() => pendingSave && void save(pendingSave.url, pendingSave.body, true)}
            >
              Confirm change
            </Button>
          }
        >
          <Input
            label="Change reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Annual commission review"
            disabled={mutation.isPending}
          />
          {error && <p role="alert">{error}</p>}
        </Modal>
        <Modal
          open={!!discardTarget}
          onClose={() => setDiscardTarget(null)}
          title="Discard unsaved plan rules?"
          description="Switching plans will discard unsaved details, rule changes and JSON edits for this plan."
          footer={
            <Button
              onClick={() => {
                if (!discardTarget) return;
                setDraft(null);
                setAdvanced(null);
                setMetadataDirty(false);
                setMetadataKey((value) => value + 1);
                if (discardTarget.planId) setSelected(discardTarget.planId);
                setView(discardTarget.view);
                setDiscardTarget(null);
              }}
            >
              Discard and continue
            </Button>
          }
        >
          <Button variant="secondary" onClick={() => setDiscardTarget(null)}>
            Keep editing
          </Button>
        </Modal>
      </div>
    </Card>
  );
}
