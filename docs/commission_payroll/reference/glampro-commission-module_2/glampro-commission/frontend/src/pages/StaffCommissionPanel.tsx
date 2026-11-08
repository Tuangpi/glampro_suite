/** Staff › Edit staff › Commission plan (C6) and Payroll profile (C7). */
import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { Card, ErrorBox, Field, today, useAction, useLoad } from '../components/ui';

export function StaffCommissionPanel({ staffId, onChangeStaff }: { staffId: string; onChangeStaff: (id: string) => void }) {
  const { api, staff, toast } = useApp();
  const prof = useLoad(() => api.staffProfile(staffId), [api, staffId]);
  const plans = useLoad(() => api.plans(), [api]);
  const p = prof.data;
  const [form, setForm] = useState({ planId: '', fromDate: today(), joinDate: '', reason: '' });
  const [stageEnd, setStageEnd] = useState('');
  const [stageReason, setStageReason] = useState('');
  const [pay, setPay] = useState({ effectiveFrom: today(), basicSalary: '0', fixedOt: '0', fwlLevy: '0', payrollSalesAlertPct: '55' });
  useEffect(() => {
    if (!p) return;
    setForm((f) => ({ ...f, planId: p.current?.planId ?? plans.data?.[0]?.id ?? '', joinDate: p.staff.joinDate ?? '' }));
    setStageEnd(p.staff.stageEndOverride ? String(p.staff.stageEndOverride) : '');
    if (p.payroll) setPay({ effectiveFrom: today(), basicSalary: p.payroll.basicSalary, fixedOt: p.payroll.fixedOt, fwlLevy: p.payroll.fwlLevy, payrollSalesAlertPct: p.payroll.payrollSalesAlertPct });
  }, [p, plans.data]);
  const act = useAction();

  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
        <Field label="Staff member"><select value={staffId} onChange={(e) => onChangeStaff(e.target.value)}>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <div />
      </div>
      <ErrorBox error={prof.error || act.error} />
      {p && (
        <>
          <Card title="Commission plan" hint={`${p.staff.name} · ${p.staff.position ?? ''}`}>
            <div className="row">
              <div><div className="hint" style={{ margin: 0 }}>Current plan</div><b>{p.plan?.name ?? 'No plan – flat fallback rules'}</b></div>
              <div><div className="hint" style={{ margin: 0 }}>Tenure</div><b>{p.tenureMonth ? `Month ${p.tenureMonth}` : '—'}</b></div>
              <div><div className="hint" style={{ margin: 0 }}>Stage now</div><b>{p.stage?.name ?? '—'}</b></div>
            </div>
            {p.schedule.length > 0 && (
              <>
                <h4>Stage schedule (automatic from join date)</h4>
                <div className="timeline">{p.schedule.map((s) => (
                  <div key={s.stage.key} className={s.stage.key === p.stage?.key ? 'cur' : ''}>{s.stage.name}<br />{s.from} – {s.to ?? 'onwards'}</div>
                ))}</div>
              </>
            )}
            <h4>Assign / change plan</h4>
            <div className="row">
              <Field label="Join date"><input type="date" value={form.joinDate} onChange={(e) => setForm({ ...form, joinDate: e.target.value })} /></Field>
              <Field label="Plan"><select value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}>{plans.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
              <Field label="From date"><input type="date" value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value })} /></Field>
            </div>
            <Field label="Reason"><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. New hire / promotion" /></Field>
            <button className="btn" style={{ marginTop: 10 }} disabled={act.busy || !form.reason.trim()} onClick={() => act.run(async () => { await api.assignPlan(staffId, { planId: form.planId, fromDate: form.fromDate, reason: form.reason, joinDate: form.joinDate || undefined }); setForm({ ...form, reason: '' }); prof.reload(); toast('Plan assigned'); })}>Assign plan</button>

            <h4>Extend / shorten the first (new-staff) stage</h4>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <Field label="First stage ends at month (blank = follow plan)"><input className="num" value={stageEnd} onChange={(e) => setStageEnd(e.target.value)} /></Field>
              <Field label="Reason"><input value={stageReason} onChange={(e) => setStageReason(e.target.value)} /></Field>
              <div style={{ flex: '0 0 auto' }}><button className="btn ghost" disabled={act.busy || !stageReason.trim()} onClick={() => act.run(async () => { await api.setStageOverride(staffId, stageEnd ? Number(stageEnd) : null, stageReason); setStageReason(''); prof.reload(); toast('Stage updated'); })}>Save</button></div>
            </div>

            <h4>Plan history</h4>
            <table>
              <thead><tr><th>From</th><th>To</th><th>Plan</th><th>By</th><th>Reason</th></tr></thead>
              <tbody>{p.history.map((h) => <tr key={h.id}><td>{h.fromDate}</td><td>{h.toDate ?? '—'}</td><td>{plans.data?.find((x) => x.id === h.planId)?.name ?? h.planId}</td><td>{h.createdBy}</td><td>{h.reason}</td></tr>)}</tbody>
            </table>
          </Card>

          <Card title="Payroll profile" hint="Used for the monthly statement and Payroll/Sales %. Only Super admin can change salary data.">
            <div className="row">
              <Field label="Effective from"><input type="date" value={pay.effectiveFrom} onChange={(e) => setPay({ ...pay, effectiveFrom: e.target.value })} /></Field>
              <Field label="Basic salary"><input className="num" value={pay.basicSalary} onChange={(e) => setPay({ ...pay, basicSalary: e.target.value })} /></Field>
              <Field label="Fixed OT"><input className="num" value={pay.fixedOt} onChange={(e) => setPay({ ...pay, fixedOt: e.target.value })} /></Field>
              <Field label="FWL levy (company)"><input className="num" value={pay.fwlLevy} onChange={(e) => setPay({ ...pay, fwlLevy: e.target.value })} /></Field>
              <Field label="Payroll/Sales alert %"><input className="num" value={pay.payrollSalesAlertPct} onChange={(e) => setPay({ ...pay, payrollSalesAlertPct: e.target.value })} /></Field>
            </div>
            <button className="btn" style={{ marginTop: 10 }} disabled={act.busy} onClick={() => act.run(async () => { await api.savePayrollProfile(staffId, pay); prof.reload(); toast('Payroll profile saved'); })}>Save payroll profile</button>
          </Card>
        </>
      )}
    </div>
  );
}
