/** "Commission vs monthly base" chart for a tier component (FR-SET-08). Plain SVG, no chart library. */
import { CalcMethod, PlanComponent, curve } from '@glampro/commission-shared';

const COLORS: Record<string, string> = { TIER_WHOLE: '#6144E4', TIER_SLICE: '#1F8A4C', TIER_MIXED: '#F26B1D' };

export function TierChart({ comp, stageKey, marker }: { comp: PlanComponent; stageKey: string; marker: number }) {
  if (!comp.method.startsWith('TIER_') || !comp.bands.length) return <div className="hint">Chart is shown for tiered components.</div>;
  const limits = comp.bands.map((b) => Number(b.upperLimit)).filter((x) => x > 0);
  const maxB = Math.max(...limits, marker, 1000) * 1.2;
  const methods: CalcMethod[] = ['TIER_WHOLE', 'TIER_SLICE', 'TIER_MIXED'];
  const series = methods.map((m) => ({ m, pts: curve({ ...comp, monthlyCap: comp.monthlyCap }, m, maxB, 100, stageKey) }));
  const maxA = Math.max(1, ...series.flatMap((s) => s.pts.map((p) => p.amount)));
  const X = (b: number) => 44 + (b / maxB) * 406;
  const Y = (a: number) => 200 - (a / maxA) * 185;
  return (
    <div>
      <svg viewBox="0 0 460 222" width="100%" role="img" aria-label="Commission by method">
        <line x1="44" y1="200" x2="452" y2="200" stroke="#E6E8F2" />
        <line x1="44" y1="10" x2="44" y2="200" stroke="#E6E8F2" />
        <text x="44" y="214" fontSize="10" fill="#8A8FA8">0</text>
        <text x="452" y="214" fontSize="10" fill="#8A8FA8" textAnchor="end">S${Math.round(maxB).toLocaleString()}</text>
        <text x="40" y="16" fontSize="10" fill="#8A8FA8" textAnchor="end">{Math.round(maxA).toLocaleString()}</text>
        {series.map(({ m, pts }) => (
          <polyline key={m} fill="none" stroke={COLORS[m]} strokeWidth={m === comp.method ? 3 : 1.6} strokeDasharray={m === 'TIER_MIXED' ? '5 3' : undefined}
            points={pts.map((p) => `${X(p.base).toFixed(1)},${Y(p.amount).toFixed(1)}`).join(' ')} />
        ))}
        {marker > 0 && marker <= maxB && <line x1={X(marker)} y1="10" x2={X(marker)} y2="200" stroke="#1B2350" strokeDasharray="2 3" />}
      </svg>
      <div className="legend"><span><i style={{ background: COLORS.TIER_WHOLE }} />Whole amount</span><span><i style={{ background: COLORS.TIER_SLICE }} />By slice</span><span><i style={{ background: COLORS.TIER_MIXED }} />Mixed</span></div>
    </div>
  );
}
