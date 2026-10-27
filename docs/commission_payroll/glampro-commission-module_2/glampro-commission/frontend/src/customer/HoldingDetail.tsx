/** Customer profile › package payments and session log (C16, FR-ADJ-03/04, D-7 refund). */
import { useState } from 'react';
import { D, fmt, refundAmount } from '@glampro/commission-shared';
import { useApp } from '../AppContext';
import { Card, ErrorBox, Field, Money, today, useAction, useLoad } from '../components/ui';

export function HoldingDetail({ holdingId }: { holdingId: string }) {
  const { api, staff, toast } = useApp();
  const h = useLoad(() => api.holding(holdingId), [api, holdingId]);
  const [reason, setReason] = useState('');
  const [fix, setFix] = useState<{ lineId: string; staffId: string } | null>(null);
  const act = useAction();
  const d = h.data;
  const name = (id: string) => staff.find((s) => s.id === id)?.name ?? id;
  if (!d) return <ErrorBox error={h.error} />;
  const hd = d.holding;
  const projectedRefund = refundAmount(hd.cashCollected, hd.sessionsUsed, hd.sessionValue, '100');
  return (
    <div>
      <h2>peter · {hd.packageName}</h2>
      <div className="sub">Price S${fmt(hd.netPrice)} · {hd.sessionsTotal} sessions · session value S${fmt(hd.sessionValue)} · sold by {hd.sellers.map((s) => `${name(s.staffId)} ${s.splitPct}%`).join(' / ')} · status {hd.status}</div>
      <ErrorBox error={act.error} />
      <Card title="Payments (sales base to sellers)" hint={`Cash collected S$${fmt(hd.cashCollected)} · balance S$${fmt(D(hd.netPrice).minus(D(hd.cashCollected)).toString())}`}>
        <table>
          <thead><tr><th>Date</th><th>Source</th><th>Staff</th><th className="r">Base credited</th><th>Status</th></tr></thead>
          <tbody>{d.paymentLines.map((l) => <tr key={l.id}><td>{l.businessDate}</td><td>{l.sourceType}</td><td>{name(l.staffId)}</td><td className="r"><Money v={l.baseAmount} /></td><td><span className="pill mut">{l.status}</span></td></tr>)}</tbody>
        </table>
      </Card>
      <Card title="Sessions (on-course base to therapists)">
        <table>
          <thead><tr><th>#</th><th>Date</th><th>Performed by</th><th className="r">Base credited</th><th>Note</th><th /></tr></thead>
          <tbody>
            {d.sessions.map((s, i) => {
              const lines = d.redemptionLines.filter((l) => l.sourceId === s.id && l.status !== 'REVERSED');
              return (
                <tr key={s.id} style={s.voidedAt ? { opacity: 0.5 } : undefined}>
                  <td>{i + 1}</td><td>{s.businessDate}</td>
                  <td>{lines.map((l) => name(l.staffId)).join(', ') || s.performers.map((p) => name(p.staffId)).join(', ')}</td>
                  <td className="r"><Money v={lines.reduce((a, l) => a.plus(D(l.baseAmount)), D(0)).toFixed(2)} /></td>
                  <td>{s.voidedAt ? `voided: ${s.voidReason}` : s.overrideBy ? <span className="pill warn">PIN override</span> : ''}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {!s.voidedAt && lines[0] && <button className="btn ghost sm" onClick={() => setFix({ lineId: lines[0].id, staffId: lines[0].staffId })}>Correct staff</button>}{' '}
                    {!s.voidedAt && <button className="btn ghost sm" disabled={!reason.trim()} onClick={() => act.run(async () => { await api.voidSession(s.id, { reason, businessDate: today() }); h.reload(); toast('Session voided'); })}>Void</button>}
                  </td>
                </tr>);
            })}
            {Array.from({ length: hd.sessionsTotal - d.sessions.filter((s) => !s.voidedAt).length }).map((_, i) => (
              <tr key={`free${i}`}><td>{d.sessions.filter((s) => !s.voidedAt).length + i + 1}</td><td colSpan={5} className="hint">{d.sessions.filter((s) => !s.voidedAt).length + i < d.redeem.paid ? 'available' : 'locked until paid'}</td></tr>
            ))}
          </tbody>
        </table>
        {fix && (
          <div className="row" style={{ alignItems: 'flex-end', marginTop: 8 }}>
            <Field label="Correct staff"><select value={fix.staffId} onChange={(e) => setFix({ ...fix, staffId: e.target.value })}>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <div style={{ flex: '0 0 auto' }}><button className="btn" disabled={!reason.trim()} onClick={() => act.run(async () => { await api.correctStaff(fix.lineId, { newStaffId: fix.staffId, reason, businessDate: today() }); setFix(null); h.reload(); toast('Staff corrected'); })}>Save</button></div>
          </div>
        )}
        <Field label="Reason (required for void / correct staff / refund)"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Card>
      <Card title="Refund (manager)" hint={`D-7: only the sale commission on the refunded part is taken back; redemption commission stays. Refund now ≈ S$${fmt(projectedRefund)} (after S$100 admin fee).`}>
        <button className="btn danger" disabled={act.busy || !reason.trim() || hd.status === 'REFUNDED'} onClick={() => act.run(async () => { await api.refund(holdingId, { refundId: `rf_${Date.now().toString(36)}`, businessDate: today(), reason }); h.reload(); toast('Refunded'); })}>Refund package</button>
      </Card>
    </div>
  );
}
