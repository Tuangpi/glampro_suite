import assert from "node:assert/strict";
import { test } from "node:test";
import { payrollInputHash } from "./payroll-close-state.js";
import {
  resolvePayrollCloseLegacyExclusion as resolve,
  type PayrollCloseLegacyRecords,
} from "./payroll-close-legacy.js";

function legacy(): PayrollCloseLegacyRecords["legacyCommissions"][number] {
  return {
    id: "legacy",
    tenantId: "salon",
    userId: "staff",
    saleId: "sale",
    saleLineId: null,
    sourceType: null,
    sourceId: null,
    ledgerVersion: null,
    amount: "10.0000000000",
    paidAt: null,
    reversesId: null,
    reconciliationRequired: false,
  };
}
function fixture(): PayrollCloseLegacyRecords {
  return {
    tenantId: "salon",
    periodKey: "2026-09",
    timeZone: "Asia/Singapore",
    lineageEvents: [],
    legacyCommissions: [],
    events: [
      {
        id: "event",
        tenantId: "salon",
        sourceKey: "source",
        sourceType: "SALE_LINE",
        sourceId: "sale-line",
        saleId: "sale",
        outletId: "branch",
        occurredAt: new Date("2026-09-15T02:00:00Z"),
        createdAt: new Date("2026-09-15T02:00:00Z"),
        evidence: {
          version: 1,
          status: "CAPTURED",
          postingStatus: "PENDING_RELEASE",
          currency: "SGD",
          lines: [
            {
              id: "line",
              staffId: "staff",
              outletId: "branch",
              commissionType: "SVC",
              baseAmount: "100.0000",
              units: "1.0000",
              businessDate: "2026-09-15",
              status: "EARNED",
              mode: "FOLLOW_PLAN",
              fallbackRatePct: "10",
            },
          ],
        },
      },
    ],
  };
}

test("supplied nonoverlapping inventory retains sources without activating earnings", () => {
  const input = fixture();
  input.legacyCommissions = [{ ...legacy(), saleId: "other-sale" }];
  const result = resolve(input);
  assert.equal(result.status, "LEGACY_EXCLUSION_EVIDENCE_READY");
  assert.equal(result.earningsActive, false);
  assert.equal(result.sources!.lines.length, 1);
  assert.equal(result.legacyEvidence.length, 1);
});

test("paid, unpaid, zero and unreleased legacy overlaps all fail closed", () => {
  for (const change of [
    {},
    { paidAt: new Date("2026-10-01T00:00:00Z") },
    { amount: "0" },
    { ledgerVersion: 1, sourceType: "SALE_LINE", sourceId: "other-line" },
    { userId: "other-staff", saleLineId: "different-line" },
  ]) {
    const input = fixture();
    input.legacyCommissions = [{ ...legacy(), ...change }];
    const result = resolve(input);
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.sources, null);
    assert.equal(result.blockers[0].code, "LEGACY_PAYOUT_NOT_EXCLUDED");
  }
});

test("offsetting reversal cannot prove the legacy payout path is disabled", () => {
  const input = fixture();
  input.legacyCommissions = [
    legacy(),
    { ...legacy(), id: "reversal", amount: "-10", reversesId: "legacy" },
  ];
  assert.equal(resolve(input).blockers.length, 2);
  assert.equal(resolve(input).sources, null);
});

test("unidentified or unreconciled legacy rows block rather than disappear", () => {
  for (const change of [{ saleId: null }, { saleId: "other-sale", reconciliationRequired: true }]) {
    const input = fixture();
    input.legacyCommissions = [{ ...legacy(), ...change }];
    assert.equal(resolve(input).status, "UNAVAILABLE");
  }
});

test("missing inventory, malformed money, foreign rows and duplicate IDs are rejected", () => {
  const input = fixture();
  assert.throws(() =>
    resolve({ ...input, legacyCommissions: undefined } as unknown as PayrollCloseLegacyRecords),
  );
  input.legacyCommissions = [{ ...legacy(), amount: "NaN" }];
  assert.throws(() => resolve(input));
  input.legacyCommissions = [{ ...legacy(), tenantId: "foreign" }];
  assert.throws(() => resolve(input), /another salon/);
  input.legacyCommissions = [legacy(), legacy()];
  assert.throws(() => resolve(input), /Duplicate/);
});

test("legacy clearance cannot override invalid captured source evidence", () => {
  const input = fixture();
  input.events[0].evidence = {};
  const result = resolve(input);
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.sources, null);
  assert.ok(result.sourceBlockers.length);
});

test("lineage sales are protected even when the current correction has a different sale", () => {
  const input = fixture();
  const prior = structuredClone(input.events[0]);
  prior.id = "prior";
  prior.sourceKey = "prior-key";
  prior.saleId = "prior-sale";
  input.lineageEvents = [prior];
  input.legacyCommissions = [{ ...legacy(), saleId: "prior-sale" }];
  assert.equal(resolve(input).sources, null);
});

test("evidence is deterministic, hashable and detached from caller records", () => {
  const input = fixture();
  input.legacyCommissions = [legacy(), { ...legacy(), id: "another" }];
  const result = resolve(input);
  input.legacyCommissions.reverse();
  assert.equal(payrollInputHash(result), payrollInputHash(resolve(input)));
  result.legacyEvidence[0].amount = "999";
  assert.notEqual(resolve(input).legacyEvidence[0].amount, "999");
  input.legacyCommissions[0].amount = "123";
  assert.notEqual(payrollInputHash(result), payrollInputHash(resolve(input)));
});
