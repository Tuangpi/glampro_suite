/**
 * Commission Base Ledger – the hooks Glampro's POS calls when money or sessions move (FR-BAS, FR-POS, FR-ADJ).
 *
 * Integration (see AI_HANDOFF.md §4): after Glampro completes a checkout, call the matching method
 * with the Glampro ids. Each call writes base lines (NO rates) – rates are applied at month end.
 *
 *   purchasePackage()    package line sold (creates commission holding + first payment)
 *   collectPayment()     later deposit / instalment / balance for a package          -> PKG_SALE
 *   redeemSession()      one session used (D-8 paid-sessions rule enforced)          -> PKG_RED
 *   recordService()      cash service / FOC                                          -> SVC / FOC
 *   recordProduct()      product sold                                                -> PRD
 *   recordValuePackage() value package sale / spend                                  -> VP_SALE / VP_SPEND
 *   refundPackage()      D-7: negative PKG_SALE on refunded part only               -> PKG_SALE (negative)
 *   voidSession()        reverse a redemption, session returned
 *   correctStaff()       move a line to the right staff member
 */
import {
  BaseLine, CommissionType, D, StaffSplit, allocateBySplit, canRedeem, minDeposit, money2, money4, refundAmount, sessionValue,
  valuePackageSpendBase,
} from '@glampro/commission-shared';
import type { CommissionMode, CommissionRepo, HoldingCommission, SessionUsage } from '../repo/types.js';
import { Actor, AppError, badRequest, conflict, forbidden, newId, notFound, nowIso, periodKeyOf, nextPeriodKey } from './util.js';

export interface PurchasePackageInput {
  holdingId: string; // Glampro holding id
  customerId: string;
  packageId: string;
  packageName: string;
  netPrice: string; // after discount, excl. GST
  sessions: number;
  sellers: StaffSplit[];
  payNow: string; // full amount or deposit
  paymentId: string;
  businessDate: string;
  minDepositPct?: string;
  saleCommMode?: CommissionMode;
  saleFixedAmount?: string | null;
  redCommMode?: CommissionMode;
  redFixedAmount?: string | null;
}

export class LedgerService {
  constructor(private repo: CommissionRepo) {}

  // ---------- helpers ----------
  private validateSplits(splits: StaffSplit[], what: string) {
    if (!splits?.length) throw badRequest(`${what}: at least one staff member is required`);
    if (splits.length > 4) throw badRequest(`${what}: maximum 4 staff per line`);
    const total = splits.reduce((s, x) => s.plus(D(x.splitPct)), D(0));
    if (!total.eq(100)) throw badRequest(`${what}: split % must total 100`);
  }

  /** If the business date's period is approved (locked), post to the next open period (FR-PAY-06). */
  private async openDate(salonId: string, businessDate: string): Promise<string> {
    let key = periodKeyOf(businessDate);
    let date = businessDate;
    for (let i = 0; i < 24; i++) {
      const p = await this.repo.getPeriod(salonId, key);
      if (p?.status !== 'APPROVED') return date;
      key = nextPeriodKey(key);
      date = `${key}-01`;
    }
    throw conflict('No open commission period found');
  }

  private makeLines(actor: Actor, args: {
    splits: StaffSplit[]; amount: string; type: CommissionType; businessDate: string; sourceType: BaseLine['sourceType']; sourceId: string;
    productCategory?: string | null; units?: number; fixedCommission?: string | null; reason?: string | null; holdingId?: string | null;
  }): BaseLine[] {
    const parts = allocateBySplit(args.amount, args.splits);
    const fixedParts = args.fixedCommission != null ? allocateBySplit(args.fixedCommission, args.splits) : null;
    return parts.map((p, i) => ({
      id: newId('cbl'),
      salonId: actor.salonId,
      staffId: p.split.staffId,
      commissionType: args.type,
      productCategory: args.productCategory ?? null,
      baseAmount: p.amount,
      splitPct: p.split.splitPct,
      units: args.units ?? 1,
      fixedCommission: fixedParts ? fixedParts[i].amount : null,
      businessDate: args.businessDate,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      holdingId: args.holdingId ?? null,
      status: 'EARNED',
      reversedById: null,
      reason: args.reason ?? null,
      createdBy: actor.userId,
      createdAt: nowIso(),
    }));
  }

  // ---------- packages ----------
  async purchasePackage(actor: Actor, i: PurchasePackageInput) {
    if (await this.repo.getHolding(i.holdingId)) throw conflict('Holding already registered');
    this.validateSplits(i.sellers, 'Sold by');
    if (D(i.netPrice).lte(0)) throw badRequest('Package price must be greater than 0');
    if (D(i.payNow).lte(0) || D(i.payNow).gt(D(i.netPrice))) throw badRequest('Pay-now amount must be > 0 and not more than the price');
    const settings = await this.repo.getSettings(actor.salonId);
    const minPct = i.minDepositPct ?? settings.defaultMinDepositPct;
    const min = minDeposit(i.netPrice, minPct);
    if (D(i.payNow).lt(D(min))) throw badRequest(`Minimum deposit is S$${min} (${minPct}%)`);

    const holding: HoldingCommission = {
      id: i.holdingId, salonId: actor.salonId, customerId: i.customerId, packageId: i.packageId, packageName: i.packageName,
      netPrice: money2(i.netPrice), sessionsTotal: i.sessions, sessionsUsed: 0, sessionValue: sessionValue(i.netPrice, i.sessions),
      cashCollected: '0.00', sellers: i.sellers, saleCommMode: i.saleCommMode ?? 'FOLLOW_PLAN', saleFixedAmount: i.saleFixedAmount ?? null,
      redCommMode: i.redCommMode ?? 'FOLLOW_PLAN', redFixedAmount: i.redFixedAmount ?? null, status: 'ACTIVE', createdAt: nowIso(),
    };
    await this.repo.saveHolding(holding);
    const pay = await this.collectPayment(actor, { holdingId: i.holdingId, amount: i.payNow, paymentId: i.paymentId, businessDate: i.businessDate }, true);
    return { holding: pay.holding, lines: pay.lines };
  }

  /** Deposit / instalment / balance – PKG_SALE base = cash collected (D-1, FR-BAS-04, FR-POS-05). */
  async collectPayment(actor: Actor, i: { holdingId: string; amount: string; paymentId: string; businessDate: string }, first = false) {
    const h = await this.repo.getHolding(i.holdingId);
    if (!h) throw notFound('Holding');
    if (h.status !== 'ACTIVE') throw conflict(`Holding is ${h.status}`);
    const balance = D(h.netPrice).minus(D(h.cashCollected));
    if (D(i.amount).lte(0) || D(i.amount).gt(balance)) throw badRequest(`Amount must be > 0 and not more than the balance S$${money2(balance)}`);
    const date = await this.openDate(actor.salonId, i.businessDate);
    let lines: BaseLine[] = [];
    if (h.saleCommMode !== 'EXCLUDE') {
      lines = this.makeLines(actor, {
        splits: h.sellers, amount: i.amount, type: 'PKG_SALE', businessDate: date, sourceType: 'PAYMENT', sourceId: i.paymentId, holdingId: h.id,
        fixedCommission: h.saleCommMode === 'FIXED' ? (first ? h.saleFixedAmount ?? '0' : '0') : null,
      });
      await this.repo.insertLines(lines);
    }
    h.cashCollected = money2(D(h.cashCollected).plus(D(i.amount)));
    await this.repo.saveHolding(h);
    await this.repo.audit({ salonId: actor.salonId, userId: actor.userId, action: 'PKG_PAYMENT', entity: 'holding', entityId: h.id, after: { amount: i.amount, paymentId: i.paymentId } });
    return { holding: h, lines };
  }

  /** D-8: only paid-for sessions can be redeemed; manager PIN override is logged (FR-POS-08). */
  async redeemSession(actor: Actor, i: {
    holdingId: string; performers: StaffSplit[]; businessDate: string; serviceId?: string | null; appointmentId?: string | null;
    override?: { managerId: string; reason: string } | null;
  }) {
    const h = await this.repo.getHolding(i.holdingId);
    if (!h) throw notFound('Holding');
    if (h.status !== 'ACTIVE') throw conflict(`Holding is ${h.status}`);
    this.validateSplits(i.performers, 'Performed by');
    const check = canRedeem(h);
    if (!check.ok) {
      const canOverride = h.sessionsUsed < h.sessionsTotal && !!i.override?.managerId && !!i.override?.reason;
      if (!canOverride) throw new AppError(409, 'SESSION_NOT_PAID', check.reason ?? 'Cannot redeem', { paidSessions: check.paid });
    }
    const date = await this.openDate(actor.salonId, i.businessDate);
    const usage: SessionUsage = {
      id: newId('su'), holdingId: h.id, usedAt: nowIso(), businessDate: date, serviceId: i.serviceId ?? null, appointmentId: i.appointmentId ?? null,
      sessionValue: h.sessionValue, performers: i.performers, overrideBy: check.ok ? null : i.override!.managerId,
      overrideReason: check.ok ? null : i.override!.reason, voidedAt: null, voidReason: null,
    };
    await this.repo.saveSessionUsage(usage);
    let lines: BaseLine[] = [];
    if (h.redCommMode !== 'EXCLUDE') {
      lines = this.makeLines(actor, {
        splits: i.performers, amount: h.sessionValue, type: 'PKG_RED', businessDate: date, sourceType: 'SESSION_USAGE', sourceId: usage.id, holdingId: h.id,
        fixedCommission: h.redCommMode === 'FIXED' ? h.redFixedAmount ?? '0' : null,
      });
      await this.repo.insertLines(lines);
    }
    h.sessionsUsed += 1;
    if (h.sessionsUsed >= h.sessionsTotal) h.status = 'COMPLETED';
    await this.repo.saveHolding(h);
    if (!check.ok) await this.repo.audit({ salonId: actor.salonId, userId: actor.userId, action: 'REDEEM_OVERRIDE', entity: 'holding', entityId: h.id, reason: i.override!.reason, after: { managerId: i.override!.managerId } });
    return { usage, lines, holding: h, sessionsLeft: h.sessionsTotal - h.sessionsUsed };
  }

  /** D-7: refund takes back only the sale commission on the refunded part; redemption stays (FR-ADJ-01/02). */
  async refundPackage(actor: Actor, i: { holdingId: string; refundId: string; businessDate: string; reason: string; adminFee?: string }) {
    this.requireManager(actor);
    if (!i.reason?.trim()) throw badRequest('Refund reason is required');
    const h = await this.repo.getHolding(i.holdingId);
    if (!h) throw notFound('Holding');
    if (h.status === 'REFUNDED') throw conflict('Already refunded');
    const settings = await this.repo.getSettings(actor.salonId);
    const amount = refundAmount(h.cashCollected, h.sessionsUsed, h.sessionValue, i.adminFee ?? settings.refundAdminFee);
    const date = await this.openDate(actor.salonId, i.businessDate);
    let lines: BaseLine[] = [];
    if (D(amount).gt(0) && h.saleCommMode !== 'EXCLUDE') {
      lines = this.makeLines(actor, { splits: h.sellers, amount: money4(D(amount).neg()), type: 'PKG_SALE', businessDate: date, sourceType: 'REFUND', sourceId: i.refundId, holdingId: h.id, reason: i.reason, fixedCommission: h.saleCommMode === 'FIXED' ? '0' : null });
      await this.repo.insertLines(lines);
    }
    h.cashCollected = money2(D(h.cashCollected).minus(D(amount)));
    h.status = 'REFUNDED';
    await this.repo.saveHolding(h);
    await this.repo.audit({ salonId: actor.salonId, userId: actor.userId, action: 'PKG_REFUND', entity: 'holding', entityId: h.id, after: { amount }, reason: i.reason });
    return { refundAmount: amount, lines, holding: h };
  }

  /** FR-ADJ-03: reverse a redemption and return the session. */
  async voidSession(actor: Actor, i: { sessionUsageId: string; reason: string; businessDate: string }) {
    this.requireManager(actor);
    if (!i.reason?.trim()) throw badRequest('Reason is required');
    const s = await this.repo.getSessionUsage(i.sessionUsageId);
    if (!s) throw notFound('Session');
    if (s.voidedAt) throw conflict('Session already voided');
    const lines = await this.repo.listLines({ salonId: actor.salonId, sourceId: s.id });
    const reversals = await this.reverseLines(actor, lines, i.reason, i.businessDate);
    s.voidedAt = nowIso();
    s.voidReason = i.reason;
    await this.repo.saveSessionUsage(s);
    const h = await this.repo.getHolding(s.holdingId);
    if (h) {
      h.sessionsUsed = Math.max(0, h.sessionsUsed - 1);
      if (h.status === 'COMPLETED') h.status = 'ACTIVE';
      await this.repo.saveHolding(h);
    }
    return { session: s, reversals };
  }

  /** FR-ADJ-04: move a base line to the correct staff member. */
  async correctStaff(actor: Actor, i: { lineId: string; newStaffId: string; reason: string; businessDate: string }) {
    this.requireManager(actor);
    if (!i.reason?.trim()) throw badRequest('Reason is required');
    const l = await this.repo.getLine(i.lineId);
    if (!l) throw notFound('Line');
    if (l.status === 'REVERSED') throw conflict('Line already reversed');
    const reversals = await this.reverseLines(actor, [l], i.reason, i.businessDate);
    const date = reversals.posted.length ? reversals.posted[0].businessDate : l.businessDate;
    const repost: BaseLine = { ...l, id: newId('cbl'), staffId: i.newStaffId, businessDate: date, status: 'EARNED', reversedById: null, sourceType: 'CORRECTION', reason: i.reason, createdBy: actor.userId, createdAt: nowIso() };
    await this.repo.insertLines([repost]);
    return { reversals, repost };
  }

  /**
   * Reverse lines: if the line's period is still open -> mark REVERSED.
   * If approved (locked) -> post a negative copy in the next open period (FR-PAY-06).
   */
  private async reverseLines(actor: Actor, lines: BaseLine[], reason: string, businessDate: string) {
    const marked: string[] = [];
    const posted: BaseLine[] = [];
    for (const l of lines) {
      const p = await this.repo.getPeriod(actor.salonId, periodKeyOf(l.businessDate));
      if (p?.status === 'APPROVED') {
        const neg: BaseLine = {
          ...l, id: newId('cbl'), baseAmount: money4(D(l.baseAmount).neg()), units: -(l.units ?? 0),
          fixedCommission: l.fixedCommission != null ? money4(D(l.fixedCommission).neg()) : null,
          businessDate: await this.openDate(actor.salonId, businessDate), sourceType: 'CORRECTION', status: 'EARNED', reason, createdBy: actor.userId, createdAt: nowIso(),
        };
        await this.repo.insertLines([neg]);
        posted.push(neg);
      } else {
        await this.repo.updateLineStatus(l.id, 'REVERSED');
        marked.push(l.id);
      }
    }
    await this.repo.audit({ salonId: actor.salonId, userId: actor.userId, action: 'LINES_REVERSE', entity: 'base_line', entityId: lines.map((x) => x.id).join(','), reason });
    return { marked, posted };
  }

  // ---------- services, products, value packages ----------
  async recordService(actor: Actor, i: { saleLineId: string; performers: StaffSplit[]; netAmount: string; businessDate: string; foc?: boolean }) {
    this.validateSplits(i.performers, 'Performed by');
    const date = await this.openDate(actor.salonId, i.businessDate);
    const lines = this.makeLines(actor, { splits: i.performers, amount: i.netAmount, type: i.foc ? 'FOC' : 'SVC', businessDate: date, sourceType: 'SALE_LINE', sourceId: i.saleLineId });
    await this.repo.insertLines(lines);
    return { lines };
  }

  async recordProduct(actor: Actor, i: { saleLineId: string; sellers: StaffSplit[]; netAmount: string; businessDate: string; productCategory?: string | null; quantity?: number }) {
    this.validateSplits(i.sellers, 'Sold by');
    const date = await this.openDate(actor.salonId, i.businessDate);
    const lines = this.makeLines(actor, { splits: i.sellers, amount: i.netAmount, type: 'PRD', businessDate: date, sourceType: 'SALE_LINE', sourceId: i.saleLineId, productCategory: i.productCategory, units: i.quantity ?? 1 });
    await this.repo.insertLines(lines);
    return { lines };
  }

  async recordValuePackage(actor: Actor, i: { kind: 'SALE' | 'SPEND'; sourceId: string; staff: StaffSplit[]; businessDate: string; paid: string; credit: string; creditSpent?: string }) {
    this.validateSplits(i.staff, i.kind === 'SALE' ? 'Sold by' : 'Performed by');
    const date = await this.openDate(actor.salonId, i.businessDate);
    const amount = i.kind === 'SALE' ? i.paid : valuePackageSpendBase(i.creditSpent ?? '0', i.paid, i.credit);
    const lines = this.makeLines(actor, { splits: i.staff, amount, type: i.kind === 'SALE' ? 'VP_SALE' : 'VP_SPEND', businessDate: date, sourceType: i.kind === 'SALE' ? 'PAYMENT' : 'SALE_LINE', sourceId: i.sourceId });
    await this.repo.insertLines(lines);
    return { lines };
  }

  async holdingDetail(salonId: string, holdingId: string) {
    const h = await this.repo.getHolding(holdingId);
    if (!h || h.salonId !== salonId) throw notFound('Holding');
    const sessions = await this.repo.listSessionUsage(holdingId);
    const lines = await this.repo.listLines({ salonId, holdingId, includeReversed: true });
    return {
      holding: h,
      redeem: canRedeem(h),
      sessions,
      paymentLines: lines.filter((l) => l.commissionType === 'PKG_SALE'),
      redemptionLines: lines.filter((l) => l.commissionType === 'PKG_RED'),
    };
  }

  private requireManager(actor: Actor) {
    if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'MANAGER') throw forbidden('Manager approval required');
  }
}
