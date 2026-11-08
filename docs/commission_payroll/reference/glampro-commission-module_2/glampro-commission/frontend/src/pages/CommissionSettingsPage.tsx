/**
 * Settings › Commission settings (SRS §4.3, screens 7.2 – C3/C4/C5/C17–C20).
 * The admin edits a DRAFT copy of the plan; everything is testable before publishing:
 *  - component editor (sales types, base %, cap, method, bands, stage rates, mixed apply mode)
 *  - stages and incentives editors
 *  - test calculator + method comparison + chart (runs locally with the shared engine)
 *  - impact preview on last month (server)
 *  - save draft / publish with effective date + reason
 */
import { useEffect, useMemo, useState } from 'react';
import {
  CALC_METHOD_LABELS, COMMISSION_TYPE_LABELS, CalcMethod, CommissionType, PlanComponent, PlanDefinition, TierBand,
  D, calcComponent, compareMethods, fmt, validatePlan,
} from '@glampro/commission-shared';
import { useApp } from '../AppContext';
import type { ImpactResult, PlanListItem } from '../api/client';
import { Card, Diff, ErrorBox, Field, Money, prevPeriod, thisPeriod, today, useAction, useLoad } from '../components/ui';
import { TierChart } from '../components/Chart';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const ALL_TYPES = Object.keys(COMMISSION_TYPE_LABELS) as CommissionType[];

export function CommissionSettingsPage() {
  const { api, toast } = useApp();
  const overview = useLoad(() => api.overview(), [api]);
  const plans = useLoad(() => api.plans(), [api]);
  const [planId, setPlanId] = useState<string>('');
  const [draft, setDraft] = useState<PlanDefinition | null>(null);
  const [dirty, setDirty] = useState(false);
  const [compIdx, setCompIdx] = useState(0);
  const [stageKey, setStageKey] = useState('std');
  const [testBase, setTestBase] = useState('8985.50');
  const [tab, setTab] = useState<'components' | 'stages' | 'incentives'>('components');

  const plan: PlanListItem | undefined = plans.data?.find((p) => p.id === planId);
  useEffect(() => { if (!planId && plans.data?.length) setPlanId(plans.data[0].id); }, [plans.data, planId]);
  useEffect(() => {
    if (!plan) return;
    const src = plan.draftVersion ?? plan.currentVersion;
    setDraft(src ? clone(src.definition) : { stages: [], components: [], incentives: [] });
    setDirty(false); setCompIdx(0);
  }, [plan?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const validation = useMemo(() => (draft ? validatePlan(draft) : { errors: [], warnings: [] }), [draft]);
  const update = (fn: (d: PlanDefinition) => void) => { setDraft((d) => { if (!d) return d; const n = clone(d); fn(n); return n; }); setDirty(true); };
  const comp = draft?.components[compIdx];
  const stageKeys = draft?.stages.map((s) => s.key) ?? ['std'];
  useEffect(() => { if (!stageKeys.includes(stageKey)) setStageKey(stageKeys.includes('std') ? 'std' : stageKeys[0] ?? 'std'); }, [stageKeys.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <h2>Commission settings</h2>
      <div className="sub">Set every rule yourself: which sales count, flat or tiered, whole-amount or by-slice tiers, stages, caps and incentives. Test before publishing.</div>
      <ErrorBox error={overview.error || plans.error} />
      <div className="cards">
        <div className="kpi"><b>{overview.data?.cards.activePlans ?? '–'}</b><span>Active plans</span></div>
        <div className="kpi"><b>{overview.data?.cards.staffOnPlan ?? '–'}</b><span>Staff on a plan</span></div>
        <div className={`kpi ${overview.data?.cards.staffWithoutPlan ? 'warn' : ''}`}><b>{overview.data?.cards.staffWithoutPlan ?? '–'}</b><span>Staff without plan (flat fallback)</span></div>
        <div className="kpi"><b>{dirty ? 'Unsaved' : plan?.draftVersion ? 'Draft' : 'Published'}</b><span>Editing status</span></div>
      </div>

      <div className="grid2">
        <section>
          <Card title="Plan">
            <div className="row">
              <Field label="Plan"><select value={planId} onChange={(e) => setPlanId(e.target.value)}>{plans.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label="Stage to edit / test"><select value={stageKey} onChange={(e) => setStageKey(e.target.value)}>{draft?.stages.map((s) => <option key={s.key} value={s.key}>{s.name} (months {s.fromMonth}{s.toMonth ? `–${s.toMonth}` : '+'})</option>)}</select></Field>
            </div>
            <div className="tabs" style={{ marginTop: 14 }}>
              {(['components', 'stages', 'incentives'] as const).map((t) => <button key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
            </div>
            {tab === 'components' && draft && (
              <div className="tabs">
                {draft.components.map((c, i) => <button key={c.key} className={`tab ${i === compIdx ? 'on' : ''}`} onClick={() => setCompIdx(i)}>{i + 1}) {c.name}</button>)}
                <button className="btn ghost sm" onClick={() => { update((d) => d.components.push(newComponent(d))); setCompIdx(draft.components.length); }}>+ Component</button>
              </div>
            )}
          </Card>

          {tab === 'components' && comp && draft && (
            <ComponentEditor comp={comp} stages={draft.stages.filter((s) => s.key !== 'std')}
              onChange={(c) => update((d) => { d.components[compIdx] = c; })}
              onRemove={() => { update((d) => { d.components.splice(compIdx, 1); }); setCompIdx(0); }} />
          )}
          {tab === 'stages' && draft && <StagesEditor draft={draft} update={update} />}
          {tab === 'incentives' && draft && <IncentivesEditor draft={draft} update={update} />}

          {(validation.errors.length > 0 || validation.warnings.length > 0) && (
            <Card title="Checks">
              {validation.errors.map((e) => <div key={e} className="errbox">{e}</div>)}
              {validation.warnings.map((w) => <div key={w} className="warnbox">{w}</div>)}
            </Card>
          )}
          {plan && draft && <PublishBar plan={plan} draft={draft} dirty={dirty} hasErrors={validation.errors.length > 0}
            onSaved={() => { setDirty(false); plans.reload(); overview.reload(); toast('Saved'); }} />}
        </section>

        <section>
          {comp && (
            <Card title="Test calculator" hint="Enter a month's base for this component (before base %).">
              <Field label="Monthly base (S$)"><input className="num" type="number" step="0.01" value={testBase} onChange={(e) => setTestBase(e.target.value)} /></Field>
              <TestResult comp={comp} base={testBase} stageKey={stageKey} stageName={draft?.stages.find((s) => s.key === stageKey)?.name ?? stageKey} />
              <h4>Same base, every method</h4>
              <CompareTable comp={comp} base={testBase} stageKey={stageKey} />
              <h4>Commission vs monthly base</h4>
              <TierChart comp={comp} stageKey={stageKey} marker={Number(testBase) * Number(comp.basePct || 100) / 100} />
            </Card>
          )}
          {plan && draft && <ImpactCard planId={plan.id} draft={draft} />}
        </section>
      </div>
    </div>
  );
}

function newComponent(d: PlanDefinition): PlanComponent {
  return { key: `comp_${Date.now().toString(36)}`, name: 'New component', commissionTypes: [], basePct: '100', method: 'FLAT', flatRatePct: '0', bands: [], sort: d.components.length + 1 };
}

// ------------------------------------------------------------------ component editor (C4)
function ComponentEditor({ comp, stages, onChange, onRemove }: { comp: PlanComponent; stages: { key: string; name: string }[]; onChange: (c: PlanComponent) => void; onRemove: () => void }) {
  const set = (patch: Partial<PlanComponent>) => onChange({ ...comp, ...patch });
  const setBand = (i: number, patch: Partial<TierBand>) => set({ bands: comp.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const toggle = (t: CommissionType) => set({ commissionTypes: comp.commissionTypes.includes(t) ? comp.commissionTypes.filter((x) => x !== t) : [...comp.commissionTypes, t] });
  const setMethod = (m: CalcMethod) => {
    const needsBands = m.startsWith('TIER_') && comp.bands.length === 0;
    set({ method: m, bands: needsBands ? [{ upperLimit: '5000', ratePct: comp.flatRatePct ?? '5', applyMode: 'WHOLE' }, { upperLimit: null, ratePct: '10', applyMode: 'SLICE' }] : comp.bands });
  };
  const addBand = () => {
    const bs = [...comp.bands];
    const last = bs[bs.length - 1];
    if (last && (last.upperLimit === null || last.upperLimit === '')) last.upperLimit = String(Number(bs.length > 1 ? bs[bs.length - 2].upperLimit : 0) + 5000);
    bs.push({ upperLimit: null, ratePct: last?.ratePct ?? '5', applyMode: 'SLICE' });
    set({ bands: bs });
  };
  return (
    <Card title={<>Component: <input value={comp.name} onChange={(e) => set({ name: e.target.value })} style={{ width: 'auto', display: 'inline-block', fontWeight: 700 }} aria-label="Component name" /></>}
      hint="Pick what counts towards this component and how the % is applied."
      actions={<button className="btn ghost sm" onClick={onRemove}>Remove component</button>}>
      <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 12, margin: '6px 0' }}>Sales that count (click to toggle)</div>
      <div className="chips">{ALL_TYPES.map((t) => <span key={t} role="button" tabIndex={0} className={`chip ${comp.commissionTypes.includes(t) ? '' : 'off'}`} onClick={() => toggle(t)} onKeyDown={(e) => e.key === 'Enter' && toggle(t)}>{COMMISSION_TYPE_LABELS[t]}</span>)}</div>
      <div className="row">
        <Field label="Base % (e.g. FOC counts 50% of price)"><input className="num" value={comp.basePct} onChange={(e) => set({ basePct: e.target.value })} /></Field>
        <Field label="Monthly cap S$ (blank = none)"><input className="num" value={comp.monthlyCap ?? ''} onChange={(e) => set({ monthlyCap: e.target.value === '' ? null : e.target.value })} /></Field>
        <Field label="Product categories (only these, comma separated)"><input value={(comp.categoryInclude ?? []).join(', ')} onChange={(e) => set({ categoryInclude: e.target.value ? e.target.value.split(',').map((x) => x.trim()).filter(Boolean) : undefined })} /></Field>
      </div>
      <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 12, margin: '12px 0 6px' }}>Calculation method</div>
      <div className="meth">
        {(['FLAT', 'TIER_WHOLE', 'TIER_SLICE', 'TIER_MIXED'] as CalcMethod[]).map((m) => (
          <button key={m} className={comp.method === m ? 'on' : ''} onClick={() => setMethod(m)}><b>{CALC_METHOD_LABELS[m].title}</b><span>{CALC_METHOD_LABELS[m].help}</span></button>
        ))}
      </div>
      <div style={{ marginTop: 6 }}><label style={{ fontSize: 12 }}><input type="checkbox" style={{ width: 'auto' }} checked={comp.method === 'FIXED_PER_UNIT'} onChange={(e) => set({ method: e.target.checked ? 'FIXED_PER_UNIT' : 'FLAT' })} /> Fixed S$ per item instead of %</label></div>

      {comp.method === 'FLAT' && <div className="row"><Field label="Rate %"><input className="num" value={comp.flatRatePct ?? ''} onChange={(e) => set({ flatRatePct: e.target.value })} /></Field><div /></div>}
      {comp.method === 'FIXED_PER_UNIT' && <div className="row"><Field label="Fixed S$ per item"><input className="num" value={comp.fixedAmount ?? ''} onChange={(e) => set({ fixedAmount: e.target.value })} /></Field><div /></div>}
      {comp.method.startsWith('TIER_') && (
        <>
          <h4>Tier bands</h4>
          <table>
            <thead><tr><th>Up to S$</th><th className="r">Standard %</th>{stages.map((s) => <th key={s.key} className="r">{s.name} %</th>)}{comp.method === 'TIER_MIXED' && <th>Applies</th>}<th /></tr></thead>
            <tbody>
              {comp.bands.map((b, i) => (
                <tr key={i}>
                  <td><input className="num" value={b.upperLimit ?? ''} placeholder="no cap" onChange={(e) => setBand(i, { upperLimit: e.target.value === '' ? null : e.target.value })} /></td>
                  <td><input className="num" value={b.ratePct} onChange={(e) => setBand(i, { ratePct: e.target.value })} /></td>
                  {stages.map((s) => (
                    <td key={s.key}><input className="num" placeholder="same" value={b.stageRates?.[s.key] ?? ''} onChange={(e) => setBand(i, { stageRates: { ...(b.stageRates ?? {}), [s.key]: e.target.value === '' ? null : e.target.value } })} /></td>
                  ))}
                  {comp.method === 'TIER_MIXED' && (
                    <td><select value={b.applyMode ?? 'WHOLE'} onChange={(e) => setBand(i, { applyMode: e.target.value as 'WHOLE' | 'SLICE' })}><option value="WHOLE">From $1 (whole)</option><option value="SLICE">Slice only</option></select></td>
                  )}
                  <td><button className="x" title="Remove band" onClick={() => set({ bands: comp.bands.filter((_, j) => j !== i) })}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={addBand}>+ Add band</button>
        </>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ calculator (C17/C18)
function TestResult({ comp, base, stageKey, stageName }: { comp: PlanComponent; base: string; stageKey: string; stageName: string }) {
  const r = useMemo(() => { try { return calcComponent(comp, base || '0', { stageKey, units: 1 }); } catch { return null; } }, [comp, base, stageKey]);
  if (!r) return <div className="errbox">Check the numbers in this component.</div>;
  return (
    <div className="res">
      <div className="ln">{comp.name} · {CALC_METHOD_LABELS[r.method].title} · {stageName}</div>
      <big>S$ {fmt(r.amount)}</big>
      {r.working.map((w, i) => <div key={i} className="ln">{w.text}</div>)}
      <div className="ln">Band {r.bandLabel}{r.gapToNext ? ` · S$${fmt(r.gapToNext)} more to the next band` : ''}</div>
    </div>
  );
}

function CompareTable({ comp, base, stageKey }: { comp: PlanComponent; base: string; stageKey: string }) {
  const rows = useMemo(() => { try { return compareMethods(comp, base || '0', stageKey); } catch { return []; } }, [comp, base, stageKey]);
  if (!rows.length) return <div className="hint">Flat / fixed component – no tier comparison.</div>;
  const cur = rows.find((r) => r.method === comp.method)?.amount ?? '0';
  return (
    <table>
      <thead><tr><th>Method</th><th className="r">Commission</th><th className="r">vs selected</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.method} style={r.method === comp.method ? { background: 'var(--pri-soft)', fontWeight: 700 } : undefined}>
          <td>{CALC_METHOD_LABELS[r.method].title}{r.method === comp.method ? ' (selected)' : ''}</td><td className="r"><Money v={r.amount} /></td><td className="r"><Diff v={D(r.amount).minus(D(cur)).toFixed(2)} /></td>
        </tr>))}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------------ impact preview (C19)
function ImpactCard({ planId, draft }: { planId: string; draft: PlanDefinition }) {
  const { api } = useApp();
  const [period, setPeriod] = useState(prevPeriod(thisPeriod()));
  const [res, setRes] = useState<ImpactResult | null>(null);
  const act = useAction();
  const run = () => act.run(async () => setRes(await api.impact(planId, draft, period)));
  useEffect(() => { setRes(null); }, [draft, period]);
  return (
    <Card title="Impact preview" hint="Re-runs a closed month for staff on this plan: published rules vs your draft." actions={<button className="btn sm" onClick={run} disabled={act.busy}>{act.busy ? 'Running…' : 'Run preview'}</button>}>
      <Field label="Month"><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
      <ErrorBox error={act.error} />
      {res && (
        <table style={{ marginTop: 10 }}>
          <thead><tr><th>Staff</th><th>Stage</th><th className="r">Published</th><th className="r">Draft</th><th className="r">Change</th></tr></thead>
          <tbody>
            {res.rows.map((r) => <tr key={r.staffId}><td>{r.staffName}</td><td>{r.stage}</td><td className="r"><Money v={r.published} /></td><td className="r"><Money v={r.draft} /></td><td className="r"><Diff v={r.change} /></td></tr>)}
            <tr><td><b>Total cost</b></td><td /><td className="r"><b><Money v={res.totalPublished} /></b></td><td className="r"><b><Money v={res.totalDraft} /></b></td><td className="r"><Diff v={res.totalChange} /></td></tr>
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ stages & incentives
function StagesEditor({ draft, update }: { draft: PlanDefinition; update: (fn: (d: PlanDefinition) => void) => void }) {
  return (
    <Card title="Stages" hint="Months since join date (join month = month 1). Use a stage column in the band table to give a different rate, e.g. New staff 4% on the first band.">
      <table>
        <thead><tr><th>Key</th><th>Name</th><th className="r">From month</th><th className="r">To month</th><th /></tr></thead>
        <tbody>{draft.stages.map((s, i) => (
          <tr key={i}>
            <td><input value={s.key} onChange={(e) => update((d) => { d.stages[i].key = e.target.value; })} /></td>
            <td><input value={s.name} onChange={(e) => update((d) => { d.stages[i].name = e.target.value; })} /></td>
            <td><input className="num" value={s.fromMonth} onChange={(e) => update((d) => { d.stages[i].fromMonth = Number(e.target.value) || 1; })} /></td>
            <td><input className="num" value={s.toMonth ?? ''} placeholder="open" onChange={(e) => update((d) => { d.stages[i].toMonth = e.target.value === '' ? null : Number(e.target.value); })} /></td>
            <td>{s.key !== 'std' && <button className="x" onClick={() => update((d) => { d.stages.splice(i, 1); })}>×</button>}</td>
          </tr>))}
        </tbody>
      </table>
      <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => update((d) => { d.stages.unshift({ key: `stage${d.stages.length + 1}`, name: 'New stage', fromMonth: 1, toMonth: 3 }); })}>+ Add stage</button>
    </Card>
  );
}

function IncentivesEditor({ draft, update }: { draft: PlanDefinition; update: (fn: (d: PlanDefinition) => void) => void }) {
  return (
    <Card title="Incentives" hint="Pays the highest row whose targets are all met (not cumulative)." actions={<button className="btn ghost sm" onClick={() => update((d) => { d.incentives.push({ key: `inc_${Date.now().toString(36)}`, name: 'Personal target', type: 'INDIVIDUAL_TARGET', individualMetricTypes: ['SVC', 'PKG_SALE', 'PRD'], groupMetric: 'SALON_CASH', rows: [{ individualTarget: '10000', amount: '50' }] }); })}>+ Incentive</button>}>
      {draft.incentives.length === 0 && <div className="hint">No incentives.</div>}
      {draft.incentives.map((inc, i) => (
        <div key={inc.key} style={{ borderTop: i ? '1px solid var(--line)' : undefined, paddingTop: i ? 10 : 0 }}>
          <div className="row">
            <Field label="Name"><input value={inc.name} onChange={(e) => update((d) => { d.incentives[i].name = e.target.value; })} /></Field>
            <Field label="Type"><select value={inc.type} onChange={(e) => update((d) => { d.incentives[i].type = e.target.value as typeof inc.type; })}><option value="INDIVIDUAL_TARGET">Individual target</option><option value="GROUP_AND_INDIVIDUAL">Group + individual target</option></select></Field>
          </div>
          <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 12, margin: '10px 0 4px' }}>Individual target measured on</div>
          <div className="chips">{ALL_TYPES.map((t) => <span key={t} className={`chip ${inc.individualMetricTypes.includes(t) ? '' : 'off'}`} onClick={() => update((d) => { const m = d.incentives[i].individualMetricTypes; d.incentives[i].individualMetricTypes = m.includes(t) ? m.filter((x) => x !== t) : [...m, t]; })}>{COMMISSION_TYPE_LABELS[t]}</span>)}</div>
          <table style={{ marginTop: 8 }}>
            <thead><tr>{inc.type === 'GROUP_AND_INDIVIDUAL' && <th className="r">Group target</th>}<th className="r">Individual target</th><th className="r">Incentive S$</th><th /></tr></thead>
            <tbody>{inc.rows.map((row, j) => (
              <tr key={j}>
                {inc.type === 'GROUP_AND_INDIVIDUAL' && <td><input className="num" value={row.groupTarget ?? ''} onChange={(e) => update((d) => { d.incentives[i].rows[j].groupTarget = e.target.value; })} /></td>}
                <td><input className="num" value={row.individualTarget} onChange={(e) => update((d) => { d.incentives[i].rows[j].individualTarget = e.target.value; })} /></td>
                <td><input className="num" value={row.amount} onChange={(e) => update((d) => { d.incentives[i].rows[j].amount = e.target.value; })} /></td>
                <td><button className="x" onClick={() => update((d) => { d.incentives[i].rows.splice(j, 1); })}>×</button></td>
              </tr>))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn ghost sm" onClick={() => update((d) => { d.incentives[i].rows.push({ groupTarget: inc.type === 'GROUP_AND_INDIVIDUAL' ? '0' : null, individualTarget: '0', amount: '0' }); })}>+ Row</button>
            <button className="btn ghost sm" onClick={() => update((d) => { d.incentives.splice(i, 1); })}>Remove incentive</button>
          </div>
        </div>
      ))}
    </Card>
  );
}

// ------------------------------------------------------------------ publish (C5)
function PublishBar({ plan, draft, dirty, hasErrors, onSaved }: { plan: PlanListItem; draft: PlanDefinition; dirty: boolean; hasErrors: boolean; onSaved: () => void }) {
  const { api, actor } = useApp();
  const [eff, setEff] = useState(() => { const t = today(); const [y, m] = t.split('-').map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`; });
  const [reason, setReason] = useState('');
  const act = useAction();
  const saveDraft = () => act.run(async () => { await api.saveDraft(plan.id, draft); onSaved(); });
  const publish = () => act.run(async () => { const r = await api.saveDraft(plan.id, draft); await api.publish(r.version.id, eff, reason); setReason(''); onSaved(); });
  const canPublish = actor.role === 'SUPER_ADMIN';
  return (
    <Card title="Save & publish" hint={`Current: ${plan.currentVersion ? `v${plan.currentVersion.versionNo} from ${plan.currentVersion.effectiveFrom}` : 'none'}. Past months keep the rules that applied then.`}>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <Field label="Effective from"><input type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></Field>
        <div style={{ flex: 2 }}><Field label="Change reason (required)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Q1-2027 quarterly review" /></Field></div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn ghost" onClick={saveDraft} disabled={act.busy || !canPublish}>{dirty ? 'Save draft' : 'Save draft (no changes)'}</button>
        <button className="btn" onClick={publish} disabled={act.busy || hasErrors || !reason.trim() || !canPublish}>Publish version</button>
      </div>
      {!canPublish && <div className="hint" style={{ marginTop: 8 }}>Only Super admin can change commission plans.</div>}
      <ErrorBox error={act.error} />
    </Card>
  );
}
