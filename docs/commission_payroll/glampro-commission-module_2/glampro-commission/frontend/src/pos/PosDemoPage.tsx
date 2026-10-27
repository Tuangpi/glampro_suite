/**
 * POS pieces (C8–C11): sell a package with Sold by split + deposit; redeem / collect balance for the
 * customer's packages with Performed by split and the D-8 paid-sessions rule (manager override).
 * In Glampro, call the same api methods from your existing checkout after payment succeeds.
 */
import { useState } from 'react';
import { D, StaffSplit, fmt, minDeposit, paidSessions, sessionValue } from '@glampro/commission-shared';
import { useApp } from '../AppContext';
import { ApiError } from '../api/client';
import { Card, ErrorBox, Field, Money, today, useAction, useLoad } from '../components/ui';
import { SplitEditor } from '../components/SplitEditor';

const CATALOG = [
  { id: 'pkg_hair_growth_a_x5', name: 'hair growth A - X5', price: '5000', sessions: 5, minDepositPct: '30' },
  { id: 'pkg_scalp_detox_x10', name: 'Scalp detox X10', price: '1200', sessions: 10, minDepositPct: '30' },
];

export function PosDemoPage() {
  return <div className="grid2"><PackageSalePanel /><CustomerPackagesPanel holdingIds={['hold_peter_hairgrowth']} /></div>;
}

export function PackageSalePanel() {
  const { api, staff, actor, toast } = useApp();
  const [pkgId, setPkgId] = useState(CATALOG[0].id);
  const pkg = CATALOG.find((p) => p.id === pkgId)!;
  const [sellers, setSellers] = useState<StaffSplit[]>([{ staffId: 'st_stella', splitPct: '50' }, { staffId: 'st_alvin', splitPct: '50' }]);
  const [payNow, setPayNow] = useState('2000');
  const act = useAction();
  const min = minDeposit(pkg.price, pkg.minDepositPct);
  const sv = sessionValue(pkg.price, pkg.sessions);
  const paid = D(payNow || '0');
  return (
    <Card title="Sell a package" hint="Sales base credited now = cash collected × split (not the package price).">
      <Field label="Package"><select value={pkgId} onChange={(e) => setPkgId(e.target.value)}>{CATALOG.map((p) => <option key={p.id} value={p.id}>{p.name} – S${fmt(p.price)} / {p.sessions} sessions</option>)}</select></Field>
      <SplitEditor label="Sold by" value={sellers} onChange={setSellers} staff={staff} />
      <div className="row">
        <Field label={`Pay now (min S$${fmt(min)})`}><input className="num" value={payNow} onChange={(e) => setPayNow(e.target.value)} /></Field>
        <Field label="Balance due on holding"><input className="num" readOnly value={fmt(D(pkg.price).minus(paid).toString())} /></Field>
      </div>
      <div className="hint" style={{ marginTop: 8 }}>Session value S${fmt(sv)} · sessions unlocked by this payment: <b>{paidSessions(payNow || '0', sv, pkg.sessions)}</b> of {pkg.sessions}</div>
      <table><tbody>{sellers.map((s) => <tr key={s.staffId}><td>{staff.find((x) => x.id === s.staffId)?.name ?? s.staffId}</td><td className="r">sales base S$<Money v={paid.mul(D(s.splitPct || '0')).div(100).toFixed(2)} /></td></tr>)}</tbody></table>
      <button className="btn" style={{ marginTop: 10, width: '100%' }} disabled={act.busy} onClick={() => act.run(async () => {
        const id = `hold_${Date.now().toString(36)}`;
        await api.purchasePackage({ holdingId: id, customerId: 'cust_peter', packageId: pkg.id, packageName: pkg.name, netPrice: pkg.price, sessions: pkg.sessions, sellers, payNow, paymentId: `pay_${id}`, businessDate: today(), minDepositPct: pkg.minDepositPct });
        toast(`Package sold – holding ${id}`);
      })}>Take payment S${fmt(payNow || '0')}</button>
      <ErrorBox error={act.error} />
      <div className="hint" style={{ marginTop: 6 }}>Signed in as {actor.role}</div>
    </Card>
  );
}

export function CustomerPackagesPanel({ holdingIds }: { holdingIds: string[] }) {
  return <div>{holdingIds.map((id) => <HoldingRedeemCard key={id} holdingId={id} />)}</div>;
}

function HoldingRedeemCard({ holdingId }: { holdingId: string }) {
  const { api, staff, toast } = useApp();
  const h = useLoad(() => api.holding(holdingId), [api, holdingId]);
  const [performers, setPerformers] = useState<StaffSplit[]>([{ staffId: 'st_alvin', splitPct: '100' }]);
  const [needOverride, setNeedOverride] = useState<string | null>(null);
  const [ov, setOv] = useState({ managerId: 'u_manager', reason: '' });
  const [amount, setAmount] = useState('');
  const act = useAction();
  const d = h.data;
  const redeem = (override?: { managerId: string; reason: string }) => act.run(async () => {
    try {
      await api.redeem(holdingId, { performers, businessDate: today(), override: override ?? null });
      setNeedOverride(null); h.reload(); toast('Session redeemed');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SESSION_NOT_PAID') { setNeedOverride(e.message); return; }
      throw e;
    }
  });
  if (!d) return <Card title="Customer package"><ErrorBox error={h.error} /></Card>;
  const balance = D(d.holding.netPrice).minus(D(d.holding.cashCollected));
  return (
    <Card title={`peter – ${d.holding.packageName}`} hint={`Sessions left ${d.holding.sessionsTotal - d.holding.sessionsUsed} of ${d.holding.sessionsTotal} · paid for ${d.redeem.paid} · session value S$${fmt(d.holding.sessionValue)}`}
      actions={<span className={`pill ${balance.gt(0) ? 'warn' : 'ok'}`}>Balance due S${fmt(balance.toString())}</span>}>
      <SplitEditor label="Performed by" value={performers} onChange={setPerformers} staff={staff} />
      <button className="btn" style={{ marginTop: 10 }} disabled={act.busy || d.holding.status !== 'ACTIVE'} onClick={() => redeem()}>Redeem 1 session</button>
      {needOverride && (
        <div className="warnbox">
          {needOverride}
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label="Manager"><input value={ov.managerId} onChange={(e) => setOv({ ...ov, managerId: e.target.value })} /></Field>
            <Field label="Reason (PIN override)"><input value={ov.reason} onChange={(e) => setOv({ ...ov, reason: e.target.value })} /></Field>
            <div style={{ flex: '0 0 auto' }}><button className="btn danger sm" disabled={!ov.reason.trim()} onClick={() => redeem(ov)}>Override & redeem</button></div>
          </div>
        </div>
      )}
      {balance.gt(0) && (
        <div className="row" style={{ alignItems: 'flex-end', marginTop: 10 }}>
          <Field label="Collect balance S$"><input className="num" value={amount} placeholder={balance.toFixed(2)} onChange={(e) => setAmount(e.target.value)} /></Field>
          <div style={{ flex: '0 0 auto' }}><button className="btn ghost" disabled={act.busy} onClick={() => act.run(async () => { await api.collectPayment(holdingId, { amount: amount || balance.toFixed(2), paymentId: `pay_${Date.now().toString(36)}`, businessDate: today() }); setAmount(''); h.reload(); toast('Payment collected'); })}>Collect</button></div>
        </div>
      )}
      <ErrorBox error={act.error} />
    </Card>
  );
}
