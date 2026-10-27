/** Staff split editor for "Sold by" / "Performed by" (FR-POS-01/02). Max 4 staff, total must be 100%. */
import type { StaffSplit } from '@glampro/commission-shared';
import { D } from '@glampro/commission-shared';

export interface StaffOption { id: string; name: string }

export function SplitEditor({ label, value, onChange, staff }: { label: string; value: StaffSplit[]; onChange: (v: StaffSplit[]) => void; staff: StaffOption[] }) {
  const total = value.reduce((s, x) => s.plus(D(x.splitPct || '0')), D(0));
  const set = (i: number, patch: Partial<StaffSplit>) => onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const add = () => {
    if (value.length >= 4) return;
    const free = staff.find((s) => !value.some((v) => v.staffId === s.id));
    const n = value.length + 1;
    const even = (100 / n).toFixed(2);
    const next = [...value, { staffId: free?.id ?? staff[0]?.id ?? '', splitPct: even }].map((x, i, arr) => ({ ...x, splitPct: i === arr.length - 1 ? (100 - Number(even) * (arr.length - 1)).toFixed(2) : even }));
    onChange(next);
  };
  return (
    <div>
      <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 12, margin: '10px 0 4px' }}>{label}</div>
      {value.map((s, i) => (
        <div key={i} className="row" style={{ alignItems: 'center', marginBottom: 6 }}>
          <select value={s.staffId} onChange={(e) => set(i, { staffId: e.target.value })} style={{ flex: 3 }}>
            {staff.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <input className="num" style={{ flex: 1 }} value={s.splitPct} onChange={(e) => set(i, { splitPct: e.target.value })} aria-label="Split %" />
          <span style={{ flex: '0 0 auto', minWidth: 0 }}>%</span>
          {value.length > 1 && <button className="x" title="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>}
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button className="btn ghost sm" onClick={add} disabled={value.length >= 4}>+ staff</button>
        <span className={`pill ${total.eq(100) ? 'ok' : 'bad'}`}>Total {total.toString()}%</span>
      </div>
    </div>
  );
}
