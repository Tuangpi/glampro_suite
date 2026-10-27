/** Settings › Commission plans (C1) and staff month-to-date overview (C2). */
import { fmt } from '@glampro/commission-shared';
import { useApp } from '../AppContext';
import { Card, ErrorBox, Money, thisPeriod, useLoad } from '../components/ui';

export function PlansOverviewPage({ onOpenStaff }: { onOpenStaff: (staffId: string) => void }) {
  const { api } = useApp();
  const plans = useLoad(() => api.plans(), [api]);
  const ov = useLoad(() => api.overview(thisPeriod()), [api]);
  return (
    <div>
      <h2>Commission plans</h2>
      <div className="sub">A plan holds the tiers, stages and incentives. Staff get a plan when they join; edit the plan once and everyone on it follows from the effective date.</div>
      <ErrorBox error={plans.error || ov.error} />
      <Card title="Plans">
        <table>
          <thead><tr><th>Plan</th><th>For position</th><th>Components</th><th>Stages</th><th className="r">Staff</th><th>Current version</th><th>Draft</th></tr></thead>
          <tbody>{plans.data?.map((p) => {
            const def = (p.currentVersion ?? p.draftVersion)?.definition;
            return (
              <tr key={p.id}>
                <td><b>{p.name}</b></td><td>{p.positions.join(', ')}</td>
                <td>{def?.components.map((c) => c.name).join(' · ')}</td>
                <td>{def?.stages.map((s) => s.name).join(' · ')}</td>
                <td className="r">{p.staffCount}</td>
                <td>{p.currentVersion ? `v${p.currentVersion.versionNo} · from ${p.currentVersion.effectiveFrom}` : '—'}</td>
                <td>{p.draftVersion ? <span className="pill warn">Draft v{p.draftVersion.versionNo}</span> : <span className="pill ok">None</span>}</td>
              </tr>);
          })}</tbody>
        </table>
      </Card>
      <Card title={`Staff on plans · ${ov.data?.periodKey ?? ''} month to date`} hint={`Salon cash collected this month: S$${ov.data ? fmt(ov.data.groupMetric) : '–'}`}>
        <table>
          <thead><tr><th>Staff</th><th>Plan</th><th>Stage</th><th>Main tier component</th><th className="r">MTD base</th><th className="r">Rate now</th><th className="r">To next band</th><th className="r">Est. commission</th><th /></tr></thead>
          <tbody>{ov.data?.rows.map((r) => (
            <tr key={r.staffId}>
              <td><b>{r.name}</b>{r.joinDate && <div className="hint" style={{ margin: 0 }}>joined {r.joinDate}</div>}</td>
              <td>{r.planName}</td>
              <td>{r.stage === 'Standard' ? r.stage : <span className="pill warn">{r.stage}{r.tenureMonth ? ` · month ${r.tenureMonth}` : ''}</span>}</td>
              <td>{r.mainComponent ?? '—'}</td>
              <td className="r"><Money v={r.mainBase} /></td>
              <td className="r">{r.currentRate ? `${r.currentRate}%` : '—'}</td>
              <td className="r">{r.gapToNext ? <>S$<Money v={r.gapToNext} /></> : '—'}</td>
              <td className="r"><b><Money v={r.estimate} /></b></td>
              <td><button className="btn ghost sm" onClick={() => onOpenStaff(r.staffId)}>Open</button></td>
            </tr>))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
