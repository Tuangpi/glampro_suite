/**
 * Express REST API for the commission module. Mount under /api/commission in Glampro:
 *     app.use('/api/commission', createCommissionRouter(repo));
 *
 * AUTH: `actorFrom()` below reads demo headers (x-salon-id, x-user-id, x-role).
 * Replace it with Glampro's real session / JWT middleware (see AI_HANDOFF.md §4).
 */
import cors from 'cors';
import express, { NextFunction, Request, Response, Router } from 'express';
import { ZodError, ZodTypeAny, z } from 'zod';
import type { CommissionRepo } from '../repo/types.js';
import { LedgerService } from '../services/ledgerService.js';
import { PeriodService } from '../services/periodService.js';
import { PlanService } from '../services/planService.js';
import { StaffService } from '../services/staffService.js';
import { Actor, AppError, forbidden } from '../services/util.js';
import { periodKey, schemas } from './schemas.js';

function actorFrom(req: Request): Actor {
  const salonId = String(req.header('x-salon-id') ?? '');
  const userId = String(req.header('x-user-id') ?? '');
  const role = String(req.header('x-role') ?? 'STAFF') as Actor['role'];
  if (!salonId || !userId) throw new AppError(401, 'UNAUTHENTICATED', 'Missing salon / user');
  if (!['SUPER_ADMIN', 'MANAGER', 'STAFF', 'CASHIER'].includes(role)) throw forbidden('Unknown role');
  return { salonId, userId, role };
}

const body = <S extends ZodTypeAny>(schema: S, req: Request): z.infer<S> => schema.parse(req.body);
type H = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: H) => (req: Request, res: Response, next: NextFunction) => fn(req, res).then((data) => { if (!res.headersSent) res.json(data); }).catch(next);

export function createCommissionRouter(repo: CommissionRepo): Router {
  const r = Router();
  const plans = new PlanService(repo);
  const ledger = new LedgerService(repo);
  const periods = new PeriodService(repo);
  const staff = new StaffService(repo);
  const managerOnly = (a: Actor) => { if (a.role !== 'SUPER_ADMIN' && a.role !== 'MANAGER') throw forbidden(); };

  // ---- dashboard & settings (FR-SET-01) ----
  r.get('/overview', h(async (req) => staff.overview(actorFrom(req).salonId, req.query.period ? periodKey.parse(req.query.period) : undefined)));
  r.get('/settings', h(async (req) => repo.getSettings(actorFrom(req).salonId)));
  r.put('/settings', h(async (req) => {
    const a = actorFrom(req);
    if (a.role !== 'SUPER_ADMIN') throw forbidden();
    return repo.saveSettings({ ...body(schemas.settings, req), salonId: a.salonId });
  }));

  // ---- plans (FR-PLN, FR-SET) ----
  r.get('/plans', h(async (req) => plans.list(actorFrom(req).salonId)));
  r.post('/plans', h(async (req) => plans.create(actorFrom(req), body(schemas.createPlan, req))));
  r.get('/plans/:planId', h(async (req) => plans.get(req.params.planId)));
  r.patch('/plans/:planId', h(async (req) => plans.update(actorFrom(req), req.params.planId, body(schemas.updatePlan, req))));
  r.put('/plans/:planId/draft', h(async (req) => plans.saveDraft(actorFrom(req), req.params.planId, body(schemas.saveDraft, req).definition)));
  r.post('/versions/:versionId/publish', h(async (req) => { const b = body(schemas.publish, req); return plans.publish(actorFrom(req), req.params.versionId, b.effectiveFrom, b.reason); }));
  r.post('/simulate', h(async (req) => { actorFrom(req); const b = body(schemas.simulate, req); return plans.simulate(b.component, b.base, b.stageKey, b.units); }));
  r.post('/plans/:planId/impact', h(async (req) => { const b = body(schemas.impact, req); return plans.impact(actorFrom(req), req.params.planId, b.definition, b.periodKey); }));

  // ---- staff (FR-ASN, FR-STG-04, FR-PAY-02) ----
  r.get('/staff/:staffId', h(async (req) => staff.commissionProfile(actorFrom(req).salonId, req.params.staffId)));
  r.post('/staff/:staffId/assignments', h(async (req) => staff.assignPlan(actorFrom(req), req.params.staffId, body(schemas.assign, req))));
  r.put('/staff/:staffId/stage-override', h(async (req) => { const b = body(schemas.stageOverride, req); return staff.setStageOverride(actorFrom(req), req.params.staffId, b.endMonth, b.reason); }));
  r.put('/staff/:staffId/payroll-profile', h(async (req) => staff.savePayrollProfile(actorFrom(req), { ...body(schemas.payrollProfile, req), staffId: req.params.staffId })));

  // ---- POS hooks / ledger (FR-BAS, FR-POS, FR-ADJ) ----
  r.post('/holdings', h(async (req) => ledger.purchasePackage(actorFrom(req), body(schemas.purchasePackage, req))));
  r.get('/holdings/:holdingId', h(async (req) => ledger.holdingDetail(actorFrom(req).salonId, req.params.holdingId)));
  r.post('/holdings/:holdingId/payments', h(async (req) => ledger.collectPayment(actorFrom(req), { ...body(schemas.collectPayment, req), holdingId: req.params.holdingId })));
  r.post('/holdings/:holdingId/redeem', h(async (req) => ledger.redeemSession(actorFrom(req), { ...body(schemas.redeem, req), holdingId: req.params.holdingId })));
  r.post('/holdings/:holdingId/refund', h(async (req) => ledger.refundPackage(actorFrom(req), { ...body(schemas.refund, req), holdingId: req.params.holdingId })));
  r.post('/sessions/:sessionUsageId/void', h(async (req) => ledger.voidSession(actorFrom(req), { ...body(schemas.voidSession, req), sessionUsageId: req.params.sessionUsageId })));
  r.post('/lines/:lineId/correct-staff', h(async (req) => ledger.correctStaff(actorFrom(req), { ...body(schemas.correctStaff, req), lineId: req.params.lineId })));
  r.post('/lines/service', h(async (req) => ledger.recordService(actorFrom(req), body(schemas.service, req))));
  r.post('/lines/product', h(async (req) => ledger.recordProduct(actorFrom(req), body(schemas.product, req))));
  r.post('/lines/value-package', h(async (req) => ledger.recordValuePackage(actorFrom(req), body(schemas.valuePackage, req))));
  r.get('/lines', h(async (req) => {
    const a = actorFrom(req);
    const staffId = req.query.staffId ? String(req.query.staffId) : undefined;
    if (a.role === 'STAFF' && staffId !== a.userId) throw forbidden('Staff can only see their own lines');
    return repo.listLines({ salonId: a.salonId, staffId, from: req.query.from as string | undefined, to: req.query.to as string | undefined, includeReversed: req.query.includeReversed === 'true' });
  }));

  // ---- periods & payroll (FR-CAL, FR-PAY, FR-RPT) ----
  r.post('/periods/:periodKey/calculate', h(async (req) => periods.calculate(actorFrom(req), periodKey.parse(req.params.periodKey))));
  r.get('/periods/:periodKey', h(async (req) => { const a = actorFrom(req); managerOnly(a); return periods.summary(a.salonId, periodKey.parse(req.params.periodKey)); }));
  r.get('/periods/:periodKey/staff/:staffId', h(async (req) => {
    const a = actorFrom(req);
    if (a.role === 'STAFF' && a.userId !== req.params.staffId) throw forbidden('Staff can only see their own statement');
    return periods.statement(a.salonId, periodKey.parse(req.params.periodKey), req.params.staffId);
  }));
  r.post('/periods/:periodKey/adjustments', h(async (req) => periods.addAdjustment(actorFrom(req), { ...body(schemas.adjustment, req), periodKey: periodKey.parse(req.params.periodKey) })));
  r.post('/periods/:periodKey/approve', h(async (req) => periods.approve(actorFrom(req), periodKey.parse(req.params.periodKey))));
  r.get('/periods/:periodKey/export.csv', async (req, res, next) => {
    try {
      const a = actorFrom(req);
      managerOnly(a);
      const key = periodKey.parse(req.params.periodKey);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="commission-${key}.csv"`);
      res.send('﻿' + (await periods.exportCsv(a.salonId, key)));
    } catch (e) { next(e); }
  });

  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) return res.status(400).json({ code: 'VALIDATION', message: 'Invalid request', details: err.issues });
    if (err instanceof AppError) return res.status(err.status).json({ code: err.code, message: err.message, details: err.details });
    console.error(err);
    return res.status(500).json({ code: 'SERVER_ERROR', message: (err as Error)?.message ?? 'Unexpected error' });
  });
  return r;
}

export function createApp(repo: CommissionRepo) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/commission', createCommissionRouter(repo));
  app.use((_req, res) => res.status(404).json({ code: 'NOT_FOUND', message: 'Unknown route' }));
  return app;
}
