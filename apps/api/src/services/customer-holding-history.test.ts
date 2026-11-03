import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capturePayrollPackagePurchase } from "@glampro_suite/shared";
import {
  buildCustomerHoldingHistory,
  type CustomerHoldingHistorySource,
  type SessionHoldingSource,
  type ValueHoldingSource,
} from "./customer-holding-history.js";

/**
 * Customer holding payment/session history (FR-RPT-06).
 *
 * The bucket rules are the risky part, so they are exercised here against loaded evidence
 * rather than through HTTP: a legacy row must never read as a known zero, credit must
 * never join package value, and receivables must never be divided across holdings.
 */

const AS_OF = new Date("2026-11-03T04:00:00.000Z");
const PURCHASED_AT = new Date("2026-10-01T02:00:00.000Z");

/** 400.00 for four sessions: 363.00 net + 37.00 tax, so one session is exactly 100.00. */
const purchase = capturePayrollPackagePurchase({
  saleId: "sale-1",
  saleLineId: "line-1",
  packageId: "package-1",
  originalCustomerId: "customer-1",
  outletId: "outlet-1",
  purchasedAt: PURCHASED_AT.toISOString(),
  currency: "SGD",
  grantedSessions: 4,
  grossCents: "40000",
  netCents: "36300",
  taxCents: "3700",
  sellers: [{ staffId: "staff-1", share: 10000 }],
});
const valuePurchase = {
  version: 1,
  saleId: "sale-2",
  saleLineId: "line-2",
  currency: "SGD",
  paidNet: "40.03",
  credit: "50.00",
  sellers: [{ staffId: "staff-1", share: 10000 }],
};

function sessionRow(overrides: Partial<SessionHoldingSource> = {}): SessionHoldingSource {
  return {
    id: "holding-1",
    name: "Aloha Bundle",
    granted: 4,
    remaining: 2,
    expiresAt: null,
    createdAt: PURCHASED_AT,
    snapshot: purchase,
    valuation: { availableOrdinals: [{ first: 3, last: 4 }] },
    refunded: false,
    ...overrides,
  };
}

function valueRow(overrides: Partial<ValueHoldingSource> = {}): ValueHoldingSource {
  return {
    id: "value-1",
    name: "Prepaid 50",
    granted: "50.00",
    remaining: "40.03",
    expiresAt: null,
    createdAt: new Date("2026-10-02T02:00:00.000Z"),
    snapshot: valuePurchase,
    refunded: false,
    ...overrides,
  };
}

function build(overrides: Partial<CustomerHoldingHistorySource> = {}) {
  return buildCustomerHoldingHistory("customer-1", {
    asOf: AS_OF,
    sessionHoldings: [],
    valueHoldings: [],
    payments: [],
    usage: [],
    outstanding: [],
    ...overrides,
  });
}

describe("customer holding history rows", () => {
  it("values remaining sessions from the frozen snapshot, splitting net and tax", () => {
    const report = build({ sessionHoldings: [sessionRow()] });
    assert.equal(report.active.holdings, 1);
    assert.equal(report.active.sessionsRemaining, 2);
    assert.equal(report.active.net, "181.50");
    assert.equal(report.active.originalTax, "18.50");
    assert.equal(report.active.gross, "200.00");
    const row = report.holdings[0]!;
    assert.equal(row.status, "ACTIVE");
    assert.deepEqual(row.sessions, { granted: 4, remaining: 2 });
    assert.deepEqual(row.value, { net: "181.50", originalTax: "18.50", gross: "200.00" });
    assert.deepEqual(row.missingEvidence, []);
  });

  it("puts unused sessions past their expiry in the expired bucket, not the active one", () => {
    const report = build({
      sessionHoldings: [sessionRow({ expiresAt: new Date("2026-11-01T00:00:00.000Z") })],
    });
    assert.equal(report.holdings[0]!.status, "EXPIRED");
    assert.equal(report.active.gross, "0.00");
    assert.equal(report.expired.gross, "200.00");
    assert.equal(report.expired.sessionsRemaining, 2);
  });

  it("keeps a fully spent holding out of both value buckets", () => {
    const report = build({ sessionHoldings: [sessionRow({ remaining: 0, valuation: null })] });
    assert.equal(report.holdings[0]!.status, "EXHAUSTED");
    assert.equal(report.active.gross, "0.00");
    assert.equal(report.expired.gross, "0.00");
    assert.equal(report.unvalued.active.holdings, 0);
  });

  it("counts a legacy holding as unvalued instead of a known zero", () => {
    const report = build({
      sessionHoldings: [
        sessionRow({ id: "holding-legacy", snapshot: null, valuation: null, remaining: 3 }),
      ],
    });
    const row = report.holdings[0]!;
    assert.equal(row.value, null);
    assert.equal(row.purchasedAt, PURCHASED_AT.toISOString());
    assert.deepEqual(row.missingEvidence, ["ORIGINAL_PURCHASE_EVIDENCE"]);
    assert.deepEqual(report.unvalued.active, { holdings: 1, sessionsRemaining: 3 });
    assert.equal(report.active.holdings, 0);
    assert.equal(report.active.gross, "0.00");
  });

  it("names an unreadable snapshot rather than treating it as absent", () => {
    const report = build({
      sessionHoldings: [sessionRow({ snapshot: { version: 9 }, snapshotUnreadable: true })],
    });
    assert.equal(report.holdings[0]!.value, null);
    assert.deepEqual(report.holdings[0]!.missingEvidence, [
      "ORIGINAL_PURCHASE_EVIDENCE_UNREADABLE",
      "ORIGINAL_PURCHASE_EVIDENCE",
    ]);
  });

  it("refuses to value ordinals outside the grant and reports the gap", () => {
    const report = build({
      sessionHoldings: [sessionRow({ valuation: { availableOrdinals: [{ first: 5, last: 6 }] } })],
    });
    assert.equal(report.holdings[0]!.value, null);
    assert.deepEqual(report.holdings[0]!.missingEvidence, ["REMAINING_ORDINALS_UNREADABLE"]);
    assert.deepEqual(report.unvalued.active, { holdings: 1, sessionsRemaining: 2 });
  });

  it("downgrades a valuation whose ordinals disagree with the holding balance", () => {
    const report = build({
      sessionHoldings: [
        sessionRow({ remaining: 3, valuation: { availableOrdinals: [{ first: 3, last: 4 }] } }),
      ],
    });
    assert.equal(report.holdings[0]!.value, null);
    assert.deepEqual(report.holdings[0]!.missingEvidence, ["VALUATION_MISMATCH"]);
    assert.equal(report.active.gross, "0.00");
    assert.deepEqual(report.unvalued.active, { holdings: 1, sessionsRemaining: 3 });
  });
});

describe("customer holding history history and separation", () => {
  it("keeps payments and usage in time order, with a reverted draw still visible", () => {
    const report = build({
      sessionHoldings: [sessionRow()],
      payments: [
        {
          saleLineId: "line-1",
          id: "collection-2",
          occurredAt: new Date("2026-10-01T05:00:00.000Z"),
          grossCents: 20000n,
          netCents: 18150n,
          taxCents: 1850n,
        },
        {
          saleLineId: "line-1",
          id: "collection-1",
          occurredAt: new Date("2026-10-01T02:00:00.000Z"),
          grossCents: 20000n,
          netCents: 18150n,
          taxCents: 1850n,
        },
        {
          saleLineId: "unrelated-line",
          id: "collection-9",
          occurredAt: new Date("2026-10-01T02:00:00.000Z"),
          grossCents: 500n,
          netCents: 500n,
          taxCents: 0n,
        },
      ],
      usage: [
        {
          id: "use-2",
          holdingId: "holding-1",
          itemType: "PACKAGE",
          saleId: "sale-3",
          quantity: 1,
          amount: null,
          usedAt: new Date("2026-10-12T03:00:00.000Z"),
          revertedAt: new Date("2026-10-20T00:00:00.000Z"),
        },
        {
          id: "use-1",
          holdingId: "holding-1",
          itemType: "PACKAGE",
          saleId: "sale-4",
          quantity: 1,
          amount: null,
          usedAt: new Date("2026-10-09T03:00:00.000Z"),
          revertedAt: null,
        },
      ],
    });
    const row = report.holdings[0]!;
    assert.deepEqual(
      row.payments.map((payment) => payment.id),
      ["collection-1", "collection-2"],
    );
    assert.deepEqual(
      row.usage.map((draw) => draw.id),
      ["use-1", "use-2"],
    );
    assert.equal(row.usage[1]!.revertedAt, "2026-10-20T00:00:00.000Z");
    assert.equal(row.payments[0]!.netCents, "18150");
  });

  it("reports source-sale receivables whole, never divided across holdings", () => {
    const report = build({
      sessionHoldings: [sessionRow(), sessionRow({ id: "holding-2" })],
      outstanding: [
        { saleId: "sale-1", unpaidAmount: "100.00" },
        { saleId: "sale-unrelated", unpaidAmount: "900.00" },
      ],
    });
    assert.deepEqual(report.receivable, {
      sales: 1,
      holdings: 2,
      sourceSaleOutstanding: "100.00",
    });
  });

  it("separates expired credit and flags a balance above its grant", () => {
    const report = build({
      valueHoldings: [
        valueRow({ expiresAt: new Date("2026-11-02T00:00:00.000Z") }),
        valueRow({ id: "value-2", remaining: "60.00" }),
      ],
    });
    assert.deepEqual(report.credit.expired, { holdings: 1, remaining: "40.03" });
    assert.equal(report.credit.active.remaining, "60.00");
    assert.deepEqual(report.holdings.find((row) => row.holdingId === "value-2")!.missingEvidence, [
      "CREDIT_BALANCE_EXCEEDS_GRANT",
    ]);
  });

  it("drops a refunded value-package credit from every bucket", () => {
    const report = build({ valueHoldings: [valueRow({ refunded: true })] });
    assert.equal(report.holdings[0]!.status, "REFUNDED");
    assert.deepEqual(report.credit.active, { holdings: 0, remaining: "0.00" });
  });

  it("orders holdings newest first across both ledgers", () => {
    const report = build({
      sessionHoldings: [sessionRow({ createdAt: PURCHASED_AT })],
      valueHoldings: [valueRow({ createdAt: new Date("2026-10-03T02:00:00.000Z") })],
    });
    assert.deepEqual(
      report.holdings.map((row) => row.holdingId),
      ["value-1", "holding-1"],
    );
  });
});
