/**
 * Demo shell with a Glampro-style sidebar. In Glampro, mount each page on your own routes instead:
 *   /settings/commission          -> <CommissionSettingsPage />
 *   /settings/commission/plans    -> <PlansOverviewPage />
 *   /staff/:id (commission tab)   -> <StaffCommissionPanel staffId=... />
 *   POS                           -> <PackageSalePanel />, <CustomerPackagesPanel />
 *   /customers/:id (packages)     -> <HoldingDetail holdingId=... />
 *   /reports/commission           -> <CommissionReportPage />
 */
import { useEffect, useState } from 'react';
import { useApp } from './AppContext';
import type { Role } from './api/client';
import { CommissionSettingsPage } from './pages/CommissionSettingsPage';
import { PlansOverviewPage } from './pages/PlansOverviewPage';
import { StaffCommissionPanel } from './pages/StaffCommissionPanel';
import { CommissionReportPage } from './pages/CommissionReportPage';
import { PosDemoPage } from './pos/PosDemoPage';
import { HoldingDetail } from './customer/HoldingDetail';

const PAGES = [
  { key: 'settings', label: 'Commission settings', title: 'Settings › Commission settings' },
  { key: 'plans', label: 'Plans & staff', title: 'Settings › Commission plans' },
  { key: 'staff', label: 'Staff plan', title: 'Staff › Commission plan' },
  { key: 'pos', label: 'POS', title: 'Sale' },
  { key: 'customer', label: 'Customer package', title: 'Customers › Package' },
  { key: 'report', label: 'Commission report', title: 'Reports › Commission & payroll' },
] as const;
type PageKey = (typeof PAGES)[number]['key'];

export function App() {
  const { api, actor, setRole, setStaff } = useApp();
  const [page, setPage] = useState<PageKey>(() => (location.hash.slice(1) as PageKey) || 'settings');
  const [staffId, setStaffId] = useState('st_mei');
  useEffect(() => { location.hash = page; }, [page]);
  useEffect(() => { api.overview().then((o) => setStaff(o.rows.map((r) => ({ id: r.staffId, name: r.name })))).catch(() => undefined); }, [api, setStaff]);
  const cur = PAGES.find((p) => p.key === page)!;
  return (
    <div className="app">
      <nav className="side" aria-label="Commission module">
        <div className="logo">G</div>
        {PAGES.map((p) => <button key={p.key} className={p.key === page ? 'on' : ''} onClick={() => setPage(p.key)}><i />{p.label}</button>)}
      </nav>
      <main>
        <header className="top">
          <div><h1>{cur.title}</h1><small>eurosense hair studio pte ltd · {api.mode === 'demo' ? 'demo mode (data resets on reload)' : 'live API'}</small></div>
          <label className="f" style={{ margin: 0, minWidth: 190 }}><span>Signed in as (demo)</span>
            <select value={actor.role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="SUPER_ADMIN">Super admin</option><option value="MANAGER">Manager</option><option value="CASHIER">Cashier</option><option value="STAFF">Staff</option>
            </select>
          </label>
        </header>
        <div className="wrap">
          {page === 'settings' && <CommissionSettingsPage />}
          {page === 'plans' && <PlansOverviewPage onOpenStaff={(id) => { setStaffId(id); setPage('staff'); }} />}
          {page === 'staff' && <StaffCommissionPanel staffId={staffId} onChangeStaff={setStaffId} />}
          {page === 'pos' && <PosDemoPage />}
          {page === 'customer' && <HoldingDetail holdingId="hold_peter_hairgrowth" />}
          {page === 'report' && <CommissionReportPage />}
        </div>
      </main>
    </div>
  );
}
