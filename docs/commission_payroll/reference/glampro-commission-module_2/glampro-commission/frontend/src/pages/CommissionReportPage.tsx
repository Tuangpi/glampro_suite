/** Reports › Commission & payroll (C14 period summary, C15 staff statement, FR-PAY). */
import { useEffect, useState } from 'react';
import { fmt } from '@glampro/commission-shared';
import { useApp } from '../AppContext';
import type { Statement } from '../api/client';
import { Card, ErrorBox, Field, Money, prevPeriod, thisPeriod, useAction, useLoad } from '../components/ui';

export function CommissionReportPage() {
  const { api, toast } = useApp();
  const [period, setPeriod] = useState(prevPeriod(thisPeriod()));
  const sum = useLoad(() => api.periodSummary(period), [api, period]);
  const [staffId, setStaffId] = useState<string | null>(null);
  const act = useAction();
  const status = sum.data?.period.status ?? 'OPEN';
  useEffect(() => { if (!staffId && sum.data?.rows.length) setStaffId(sum.data.rows[0].result.staffId); }, [sum.data, staffId]);
  const selected = sum.data?.rows.find((r) => r.result.staffId === staffId) ?? null;

  const download = () => act.run(async () => {
    const csv = await api.exportCsv(period);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `commission-${period}.csv`; a.click(); URL.revokeObjectURL(url);
  });

  return (
    <div>
      <h2>Commission & payroll</h2>
      <div className="sub">Calculate the month, review each statement, add adjustments, then approve & lock.</div>
      <Card title={`Period ${period}`} hint={<>Status <span className={`pill ${status === 'APPROVED' ? 'ok' : 'warn'}`}>{status}</span> · Salon cash collected S${sum.data ? fmt(sum.data.groupMetric) : '–'}</>}
        actions={<>
          <input type="month" value={period} onChange={(e) => { setPeriod(e.target.value); setStaffId(null); }} style={{ width: 160 }} aria-label="Period" />
          <button className="btn ghost sm" disabled={act.busy || status === 'APPROVED'} onClick={() => act.run(async () => { await api.calculate(period); sum.reload(); toast('Calculated'); })}>Calculate</button>
          <button className="btn ghost sm" disabled={act.busy} onClick={download}>Export CSV</button>
          <button className="btn sm" disabled={act.busy || status !== 'CALCULATED'} onClick={() => act.run(async () => { await api.approve(period); sum.reload(); toast('Approved & locked'); })}>Approve & lock</button>
        </>}>
        <ErrorBox error={sum.error || act.error} />
        <table>
          <thead><tr><th>Staff</th><th>Plan · stage</th><th className="r">Commission</th><th className="r">Incentive</th><th className="r">Take-home</th><th className="r">Collection</th><th className="r">Payroll/Sales</th></tr></thead>
          <tbody>{sum.data?.rows.map((r) => (
            <tr key={r.result.staffId} onClick={() => setStaffId(r.result.staffId)} style={{ cursor: 'pointer', background: r.result.staffId === staffId ? 'var(--pri-soft)' : undefined }}>
              <td><b>{r.staff?.name ?? r.result.staffId}</b></td>
              <td>{r.result.planId ? r.result.stageName : 'Flat fallback'}</td>
              <td className="r"><Money v={r.payroll.commission} /></td><td className="r"><Money v={r.payroll.incentive} /></td>
              <td className="r"><b><Money v={r.payroll.takeHome} /></b></td><td className="r"><Money v={r.payroll.collection} /></td>
              <td className="r">{r.payroll.payrollSalesPct ? <span className={`pill ${r.payroll.alert ? 'bad' : 'ok'}`}>{r.payroll.payrollSalesPct}%</span> : '—'}</td>
            </tr>))}
          </tbody>
        </table>
      </Card>
      {selected && <StatementCard st={selected} period={period} locked={status === 'APPROVED'} onChanged={sum.reload} />}
    </div>
  );
}

function StatementCard({ st, period, locked, onChanged }: { st: Statement; period: string; locked: boolean; onChanged: () => void }) {
  const { api, toast } = useApp();
  const [adj, setAdj] = useState({ kind: 'UNPAID_LEAVE' as const as 'UNPAID_LEAVE' | 'OVERTIME' | 'ADDITION' | 'DEDUCTION' | 'COMMISSION_ADJ', amount: '', reason: '' });
  const act = useAction();
  const r = st.result;
  const p = st.payroll;
  return (
    <Card title={`${st.staff?.name ?? r.staffId} – statement ${period}`} hint={r.planId ? `Stage: ${r.stageName}${r.tenureMonth ? ` (month ${r.tenureMonth})` : ''}` : 'No plan – flat fallback rules'}>
      <div className="grid2">
        <div>
          <table>
            <thead><tr><th>Component</th><th className="r">Pooled base</th><th>Band reached</th><th className="r">Rate</th><th className="r">Commission</th><th>Next band</th></tr></thead>
            <tbody>
              {r.components.map((c) => (
                <tr key={c.componentKey} title={c.working.map((w) => w.text).join('\n')}>
                  <td>{c.componentName}{c.capped && <span className="pill warn"> capped</span>}</td>
                  <td className="r"><Money v={c.pooledBase} /></td><td>{c.bandLabel}</td><td className="r">{c.ratePct ? `${c.ratePct}%` : '—'}</td>
                  <td className="r"><Money v={c.amount} /></td><td className="hint" style={{ margin: 0 }}>{c.gapToNext ? `S$${fmt(c.gapToNext)} more` : ''}</td>
                </tr>))}
              {r.incentives.map((i) => (
                <tr key={i.ruleKey}><td>{i.name}</td><td className="r"><Money v={i.individualMetric} /></td><td>{i.rowIndex === null ? 'not met' : `row ${i.rowIndex + 1} met`}</td><td /><td className="r"><Money v={i.amount} /></td><td /></tr>
              ))}
            </tbody>
          </table>
          <div className="hint" style={{ marginTop: 6 }}>Hover a row to see the working.</div>
        </div>
        <div>
          <table><tbody>
            <tr><td>Basic salary</td><td className="r"><Money v={p.basicSalary} /></td></tr>
            <tr><td>Fixed OT</td><td className="r"><Money v={p.fixedOt} /></td></tr>
            <tr><td>Unpaid leave (−)</td><td className="r"><Money v={p.unpaidLeave} /></td></tr>
            <tr><td>Commission</td><td className="r"><Money v={p.commission} /></td></tr>
            <tr><td>Incentive</td><td className="r"><Money v={p.incentive} /></td></tr>
            <tr><td>Overtime</td><td className="r"><Money v={p.overtime} /></td></tr>
            <tr><td>Other additions / deductions (−)</td><td className="r"><Money v={p.additions} /> / <Money v={p.deductions} /></td></tr>
            <tr><td><b>Total take-home</b></td><td className="r"><b><Money v={p.takeHome} /></b></td></tr>
            <tr><td className="hint">FWL borne by company</td><td className="r hint"><Money v={p.fwlLevy} /></td></tr>
            <tr><td className="hint">Payroll/Sales</td><td className="r">{p.payrollSalesPct ? `${p.payrollSalesPct}%` : '—'}</td></tr>
          </tbody></table>
        </div>
      </div>
      <h4>Adjustments</h4>
      <table>
        <thead><tr><th>Kind</th><th className="r">Amount</th><th>Reason</th></tr></thead>
        <tbody>{st.adjustments.map((a) => <tr key={a.id}><td>{a.kind}</td><td className="r"><Money v={a.amount} /></td><td>{a.reason}</td></tr>)}</tbody>
      </table>
      {!locked && (
        <div className="row" style={{ alignItems: 'flex-end', marginTop: 6 }}>
          <Field label="Kind"><select value={adj.kind} onChange={(e) => setAdj({ ...adj, kind: e.target.value as typeof adj.kind })}><option value="UNPAID_LEAVE">Unpaid leave (−)</option><option value="OVERTIME">Overtime (+)</option><option value="ADDITION">Other addition (+)</option><option value="DEDUCTION">Other deduction (−)</option><option value="COMMISSION_ADJ">Commission adjustment (+/−)</option></select></Field>
          <Field label="Amount S$"><input className="num" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} /></Field>
          <div style={{ flex: 2 }}><Field label="Reason"><input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} /></Field></div>
          <div style={{ flex: '0 0 auto' }}><button className="btn ghost" disabled={act.busy || !adj.amount || !adj.reason.trim()} onClick={() => act.run(async () => { await api.addAdjustment(period, { staffId: r.staffId, ...adj }); setAdj({ ...adj, amount: '', reason: '' }); onChanged(); toast('Adjustment added'); })}>Add</button></div>
        </div>
      )}
      <ErrorBox error={act.error} />
    </Card>
  );
}
