/**
 * API + service tests on the in-memory repo with demo data.
 * Covers SRS TC-05/06, TC-09, TC-10, TC-12, TC-14, TC-18/19 and the Sept reconciliation through the API.
 */
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { HAIR_2022 } from '@glampro/commission-shared';
import { createApp } from '../src/api/app.js';
import { MemoryRepo } from '../src/repo/memoryRepo.js';
import { DEMO_SALON, seedDemo } from '../src/seed/demo.js';

const admin = { 'x-salon-id': DEMO_SALON, 'x-user-id': 'u_kenny', 'x-role': 'SUPER_ADMIN' };
const cashier = { 'x-salon-id': DEMO_SALON, 'x-user-id': 'u_cashier', 'x-role': 'CASHIER' };
let app: ReturnType<typeof createApp>;
let repo: MemoryRepo;

beforeEach(async () => {
  repo = new MemoryRepo();
  await seedDemo(repo);
  app = createApp(repo);
});

describe('September 2026 statements', () => {
  it('Alvin and Stella reconcile with the plans (E1, E2)', async () => {
    const calc = await request(app).post('/api/commission/periods/2026-09/calculate').set(admin);
    expect(calc.status).toBe(200);
    const alvin = await request(app).get('/api/commission/periods/2026-09/staff/st_alvin').set(admin);
    expect(alvin.body.result.commissionTotal).toBe('1187.69');
    expect(alvin.body.payroll.takeHome).toBe('3187.69');
    const stella = await request(app).get('/api/commission/periods/2026-09/staff/st_stella').set(admin);
    expect(stella.body.result.commissionTotal).toBe('1971.62');
    expect(stella.body.result.incentiveTotal).toBe('50.00');
    expect(stella.body.payroll.takeHome).toBe('4221.62');
    expect(stella.body.payroll.payrollSalesPct).toBe('44.3'); // (4,221.62 + 400) / 10,421.31 cash-type base in demo data
  });

  it('adjustments, approve & lock, CSV export (TC-19/20)', async () => {
    await request(app).post('/api/commission/periods/2026-09/calculate').set(admin);
    const adj = await request(app).post('/api/commission/periods/2026-09/adjustments').set(admin).send({ staffId: 'st_alvin', kind: 'UNPAID_LEAVE', amount: '184.62', reason: '2 days unpaid leave' });
    expect(adj.status).toBe(200);
    const st = await request(app).get('/api/commission/periods/2026-09/staff/st_alvin').set(admin);
    expect(st.body.payroll.takeHome).toBe('3003.07');
    expect((await request(app).post('/api/commission/periods/2026-09/approve').set(admin)).status).toBe(200);
    expect((await request(app).post('/api/commission/periods/2026-09/calculate').set(admin)).status).toBe(409);
    const csv = await request(app).get('/api/commission/periods/2026-09/export.csv').set(admin);
    expect(csv.text).toContain('TOTAL TAKE-HOME');
  });
});

describe('Packages: cash collected, D-8 and D-7', () => {
  it('deposit credits sellers by split; 3rd session blocked until paid (TC-09, TC-10)', async () => {
    const h = await request(app).get('/api/commission/holdings/hold_peter_hairgrowth').set(cashier);
    expect(h.body.holding.cashCollected).toBe('2000.00');
    expect(h.body.paymentLines.map((l: { staffId: string; baseAmount: string }) => [l.staffId, l.baseAmount])).toEqual([['st_stella', '1000.0000'], ['st_alvin', '1000.0000']]);
    const ok = await request(app).post('/api/commission/holdings/hold_peter_hairgrowth/redeem').set(cashier).send({ performers: [{ staffId: 'st_stella', splitPct: '100' }], businessDate: '2026-10-27' });
    expect(ok.status).toBe(200);
    const blocked = await request(app).post('/api/commission/holdings/hold_peter_hairgrowth/redeem').set(cashier).send({ performers: [{ staffId: 'st_alvin', splitPct: '100' }], businessDate: '2026-10-28' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('SESSION_NOT_PAID');
    const override = await request(app).post('/api/commission/holdings/hold_peter_hairgrowth/redeem').set(cashier).send({ performers: [{ staffId: 'st_alvin', splitPct: '100' }], businessDate: '2026-10-28', override: { managerId: 'u_mgr', reason: 'Customer paying tomorrow' } });
    expect(override.status).toBe(200);
    const pay = await request(app).post('/api/commission/holdings/hold_peter_hairgrowth/payments').set(cashier).send({ amount: '3000', paymentId: 'pay_2', businessDate: '2026-11-05' });
    expect(pay.body.lines.map((l: { businessDate: string; baseAmount: string }) => [l.businessDate, l.baseAmount])).toEqual([['2026-11-05', '1500.0000'], ['2026-11-05', '1500.0000']]);
  });

  it('refund takes back only the refunded part (TC-12)', async () => {
    await request(app).post('/api/commission/holdings/hold_peter_hairgrowth/payments').set(cashier).send({ amount: '3000', paymentId: 'pay_2', businessDate: '2026-11-05' });
    await request(app).post('/api/commission/holdings/hold_peter_hairgrowth/redeem').set(cashier).send({ performers: [{ staffId: 'st_stella', splitPct: '100' }], businessDate: '2026-11-06' });
    const denied = await request(app).post('/api/commission/holdings/hold_peter_hairgrowth/refund').set(cashier).send({ refundId: 'rf1', businessDate: '2026-11-20', reason: 'Moving overseas' });
    expect(denied.status).toBe(403);
    const r = await request(app).post('/api/commission/holdings/hold_peter_hairgrowth/refund').set(admin).send({ refundId: 'rf1', businessDate: '2026-11-20', reason: 'Moving overseas' });
    expect(r.body.refundAmount).toBe('2900.00');
    expect(r.body.lines.map((l: { baseAmount: string }) => l.baseAmount)).toEqual(['-1450.0000', '-1450.0000']);
    const lines = await request(app).get('/api/commission/lines?staffId=st_alvin&from=2026-10-01&to=2026-11-30').set(admin);
    expect(lines.body.filter((l: { commissionType: string }) => l.commissionType === 'PKG_RED').length).toBe(2); // redemption stays
  });

  it('split must total 100% (TC-18 style validation)', async () => {
    const res = await request(app).post('/api/commission/lines/service').set(cashier).send({ saleLineId: 'sl1', performers: [{ staffId: 'st_mei', splitPct: '60' }], netAmount: '80', businessDate: '2026-10-27' });
    expect(res.status).toBe(400);
  });
});

describe('Plans, stages and settings', () => {
  it('new staff stage: Mei Oct = New staff, commission 329.00 (TC-05)', async () => {
    const r = await request(app).get('/api/commission/periods/2026-10/staff/st_mei').set(admin);
    expect(r.body.result.stageName).toBe('New staff');
    expect(r.body.result.commissionTotal).toBe('329.00');
  });

  it('draft → impact → publish with effective date (TC-14, TC-23)', async () => {
    const draft = JSON.parse(JSON.stringify(HAIR_2022));
    draft.components.find((c: { key: string }) => c.key === 'on_course').method = 'TIER_SLICE';
    const d = await request(app).put('/api/commission/plans/plan_hair_2022/draft').set(admin).send({ definition: draft });
    expect(d.status).toBe(200);
    const impact = await request(app).post('/api/commission/plans/plan_hair_2022/impact').set(admin).send({ definition: draft, periodKey: '2026-09' });
    expect(impact.body.rows.find((r: { staffId: string }) => r.staffId === 'st_alvin').change).toBe('-140.00');
    const noReason = await request(app).post(`/api/commission/versions/${d.body.version.id}/publish`).set(admin).send({ effectiveFrom: '2027-01-01', reason: '' });
    expect(noReason.status).toBe(400);
    const pub = await request(app).post(`/api/commission/versions/${d.body.version.id}/publish`).set(admin).send({ effectiveFrom: '2027-01-01', reason: 'Q1 review' });
    expect(pub.status).toBe(200);
    const sep = await request(app).get('/api/commission/periods/2026-09/staff/st_alvin').set(admin);
    expect(sep.body.result.commissionTotal).toBe('1187.69'); // old rules still apply to past months
  });

  it('only Super admin may change plans', async () => {
    const res = await request(app).put('/api/commission/plans/plan_hair_2022/draft').set({ ...admin, 'x-role': 'MANAGER' }).send({ definition: HAIR_2022 });
    expect(res.status).toBe(403);
  });

  it('simulate returns working lines and method comparison', async () => {
    const res = await request(app).post('/api/commission/simulate').set(admin).send({ component: HAIR_2022.components[2], base: '8985.50' });
    expect(res.body.result.amount).toBe('628.99');
    expect(res.body.compare.map((c: { amount: string }) => c.amount)).toEqual(['628.99', '488.99', '488.99']);
  });

  it('overview cards and staff without plan', async () => {
    const res = await request(app).get('/api/commission/overview?period=2026-10').set(admin);
    expect(res.body.cards.staffWithoutPlan).toBe(1);
    expect(res.body.rows.length).toBe(6);
  });
});
