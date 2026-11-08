/**
 * Demo data (Eurosense sample) for the in-memory server and the UI demo.
 * Reproduces the September 2026 salary sheets so you can compare results (SRS §8 E1/E2).
 */
import { BaseLine, CommissionType, SEED_PLANS } from '@glampro/commission-shared';
import type { CommissionRepo } from '../repo/types.js';
import { LedgerService } from '../services/ledgerService.js';

export const DEMO_SALON = 'salon_eurosense';
export const DEMO_ADMIN = { userId: 'u_kenny', salonId: DEMO_SALON, role: 'SUPER_ADMIN' as const };

export async function seedDemo(repo: CommissionRepo) {
  for (const p of SEED_PLANS) {
    await repo.savePlan({ id: p.id, salonId: DEMO_SALON, name: p.name, positions: p.positions, status: 'ACTIVE' });
    await repo.saveVersion({ id: `${p.id}_v1`, planId: p.id, versionNo: 1, effectiveFrom: p.effectiveFrom, reason: 'Initial scheme', status: 'PUBLISHED', definition: p.definition, publishedBy: 'u_kenny', publishedAt: '2026-10-27T00:00:00Z' });
  }
  const staff = [
    { id: 'st_alvin', name: 'Alvin (Chang Kah Weng)', position: 'Hair therapist', joinDate: '2021-03-01', plan: 'plan_hair_2022', basic: '2000', fwl: '800' },
    { id: 'st_stella', name: 'Stella', position: 'Nail technician', joinDate: '2019-05-01', plan: 'plan_tp_2019', basic: '2200', fwl: '400' },
    { id: 'st_mei', name: 'Mei Lim', position: 'Hair stylist', joinDate: '2026-09-10', plan: 'plan_hair_2022', basic: '1800', fwl: '0' },
    { id: 'st_siti', name: 'Siti', position: 'Hair stylist', joinDate: '2022-06-01', plan: 'plan_hair_2022', basic: '2400', fwl: '0' },
    { id: 'st_joy', name: 'Joy', position: 'Nail technician', joinDate: '2024-02-01', plan: 'plan_tp_2019', basic: '1900', fwl: '400' },
    { id: 'st_rina', name: 'Rina (front desk)', position: 'Receptionist', joinDate: '2023-01-01', plan: null, basic: '2100', fwl: '0' },
  ];
  for (const s of staff) {
    await repo.saveStaff({ id: s.id, salonId: DEMO_SALON, name: s.name, position: s.position, joinDate: s.joinDate, active: true, stageEndOverride: null });
    if (s.plan) await repo.saveAssignment({ id: `asg_${s.id}`, staffId: s.id, planId: s.plan, fromDate: s.joinDate, toDate: null, reason: 'Initial', createdBy: 'u_kenny', createdAt: '2026-10-27T00:00:00Z' });
    await repo.savePayrollProfile({ staffId: s.id, effectiveFrom: '2019-01-01', basicSalary: s.basic, fixedOt: '0', fwlLevy: s.fwl, payrollSalesAlertPct: '55' });
  }
  await repo.saveSettings({ salonId: DEMO_SALON, requireStaffOnLines: true, refundAdminFee: '100', defaultMinDepositPct: '30', joinAfterDayCountsNextMonth: null, negativeBase: 'CARRY_FORWARD', fallbackRates: { PRD: '5' } });

  let n = 0;
  const L = (staffId: string, t: CommissionType, amt: string, date: string, cat: string | null = null): BaseLine => ({
    id: `demo_${++n}`, salonId: DEMO_SALON, staffId, commissionType: t, productCategory: cat, baseAmount: amt, splitPct: '100', units: 1,
    businessDate: date, sourceType: 'SALE_LINE', sourceId: `demo_src_${n}`, holdingId: null, status: 'EARNED', createdBy: 'seed', createdAt: `${date}T10:00:00Z`,
  });
  // September 2026 – figures from the salary sheets (package on sales-value basis, as the sheets did)
  await repo.insertLines([
    L('st_alvin', 'SVC', '159.0000', '2026-09-12'), L('st_alvin', 'PKG_SALE', '6671.0000', '2026-09-18'), L('st_alvin', 'PKG_RED', '8985.5000', '2026-09-20'), L('st_alvin', 'FOC', '492.0000', '2026-09-21'),
    L('st_stella', 'SVC', '1087.0000', '2026-09-05'), L('st_stella', 'PKG_RED', '12071.8400', '2026-09-15'), L('st_stella', 'PRD', '78.0000', '2026-09-16'), L('st_stella', 'PKG_SALE', '9256.3100', '2026-09-25'),
    L('st_mei', 'SVC', '1800.0000', '2026-09-20'), L('st_mei', 'PKG_RED', '1200.0000', '2026-09-24'),
    L('st_siti', 'SVC', '4900.0000', '2026-09-08'), L('st_siti', 'PKG_SALE', '7500.0000', '2026-09-19'), L('st_siti', 'PKG_RED', '16200.0000', '2026-09-22'), L('st_siti', 'PRD', '650.0000', '2026-09-23'),
    L('st_joy', 'SVC', '3100.0000', '2026-09-09'), L('st_joy', 'PKG_RED', '4100.0000', '2026-09-14'), L('st_joy', 'PKG_SALE', '4800.0000', '2026-09-26'), L('st_joy', 'PRD', '120.0000', '2026-09-27', 'Beauty'),
    L('st_rina', 'PRD', '900.0000', '2026-09-10'),
  ]);
  // October 2026 month-to-date
  await repo.insertLines([
    L('st_alvin', 'SVC', '1240.0000', '2026-10-05'), L('st_alvin', 'PKG_SALE', '4000.0000', '2026-10-11'), L('st_alvin', 'PKG_RED', '6400.0000', '2026-10-15'),
    L('st_mei', 'SVC', '2100.0000', '2026-10-06'), L('st_mei', 'PKG_SALE', '1500.0000', '2026-10-13'), L('st_mei', 'PKG_RED', '3000.0000', '2026-10-16'), L('st_mei', 'FOC', '200.0000', '2026-10-17'), L('st_mei', 'PRD', '300.0000', '2026-10-18'),
    L('st_stella', 'SVC', '980.0000', '2026-10-04'), L('st_stella', 'PKG_SALE', '7120.0000', '2026-10-14'), L('st_stella', 'PKG_RED', '9800.0000', '2026-10-19'),
    L('st_siti', 'SVC', '5200.0000', '2026-10-07'), L('st_siti', 'PKG_RED', '11800.0000', '2026-10-21'),
    L('st_joy', 'SVC', '2600.0000', '2026-10-08'), L('st_joy', 'PKG_SALE', '3900.0000', '2026-10-20'),
  ]);
  // A package with a deposit (E5): S$5,000, 5 sessions, Stella 50% / Alvin 50%, deposit 2,000
  const ledger = new LedgerService(repo);
  await ledger.purchasePackage(DEMO_ADMIN, {
    holdingId: 'hold_peter_hairgrowth', customerId: 'cust_peter', packageId: 'pkg_hair_growth_a_x5', packageName: 'hair growth A - X5', netPrice: '5000', sessions: 5,
    sellers: [{ staffId: 'st_stella', splitPct: '50' }, { staffId: 'st_alvin', splitPct: '50' }], payNow: '2000', paymentId: 'pay_demo_1', businessDate: '2026-10-25',
  });
  await ledger.redeemSession(DEMO_ADMIN, { holdingId: 'hold_peter_hairgrowth', performers: [{ staffId: 'st_alvin', splitPct: '100' }], businessDate: '2026-10-26' });
}
