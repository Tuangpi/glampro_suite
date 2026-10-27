/** Small UI kit – plain React + CSS (no UI library) so it drops into any React app. */
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { D, fmt } from '@glampro/commission-shared';
import { ApiError } from '../api/client';

export const Money = ({ v }: { v: string | null | undefined }) => <>{v === null || v === undefined ? '—' : fmt(v)}</>;

export function Card({ title, hint, actions, children }: { title?: ReactNode; hint?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
          <div>{title && <h3>{title}</h3>}{hint && <div className="hint">{hint}</div>}</div>
          {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="f"><span>{label}</span>{children}</label>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);
  const details = error instanceof ApiError && Array.isArray(error.details) ? (error.details as unknown[]) : [];
  return <div className="errbox">{msg}{details.length > 0 && <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>{details.map((d, i) => <li key={i}>{typeof d === 'string' ? d : JSON.stringify(d)}</li>)}</ul>}</div>;
}

export function Diff({ v }: { v: string }) {
  const d = D(v);
  if (d.isZero()) return <span className="pill mut">same</span>;
  return <span className={`pill ${d.gt(0) ? 'bad' : 'ok'}`}>{d.gt(0) ? '+' : ''}{fmt(v)}</span>;
}

/** Load data with loading / error state; `reload()` to refresh. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    fn().then((d) => { setData(d); setError(null); }).catch(setError).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

/** Run an action with busy + error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(e); return undefined; } finally { setBusy(false); }
  };
  return { busy, error, run, setError };
}

export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
export const thisPeriod = () => today().slice(0, 7);
export function prevPeriod(p: string) { const [y, m] = p.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
