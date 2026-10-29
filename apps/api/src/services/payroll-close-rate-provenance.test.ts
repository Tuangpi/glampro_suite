import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyOrdinaryPayrollRateProvenance } from "./payroll-close-rate-provenance.js";
import type { RuleCandidate } from "./commission-rules.js";

const at = new Date("2026-09-15T00:00:00.000Z");
const capturedAt = new Date("2026-09-15T00:01:00.000Z");
const rule = (overrides: Partial<RuleCandidate> = {}) => ({
  id: "rule",
  tenantId: "salon",
  staffId: "staff",
  itemKind: "SERVICE",
  scope: "ITEM",
  targetId: "service",
  rate: "10",
  effectiveAt: new Date("2026-09-01T00:00:00Z"),
  createdAt: new Date("2026-09-01T00:00:00Z"),
  ...overrides,
});
const fixture = () => ({
  itemId: "service",
  lines: [
    {
      id: "base",
      staffId: "staff",
      outletId: "branch",
      commissionType: "SVC",
      baseAmount: "100.0000",
      units: "1.0000",
      businessDate: "2026-09-15",
      mode: "FOLLOW_PLAN",
      status: "EARNED",
      fallbackRatePct: "10",
    },
  ],
  rateProvenance: {
    version: 1,
    rateAt: at.toISOString(),
    itemId: "service",
    category: null as string | null,
    selections: [
      {
        staffId: "staff",
        legacyServiceRate: "10",
        selection: { rate: "10", source: "LEGACY_STAFF", ruleId: null as string | null },
      },
    ],
  },
});
const verify = (evidence: unknown, rules = [] as ReturnType<typeof rule>[], itemType = "SERVICE") =>
  verifyOrdinaryPayrollRateProvenance(
    evidence,
    { itemId: "service", itemType },
    at,
    capturedAt,
    rules,
    "salon",
  );

test("ordinary rate replay retains captured legacy rate without current staff reads", () => {
  const evidence = fixture();
  assert.equal(verify(evidence).selections[0].selection.rate, "10");
  const detached = verify(evidence);
  detached.selections[0].legacyServiceRate = "99";
  assert.equal(verify(evidence).selections[0].legacyServiceRate, "10");
});

test("missing or altered rate, item, time, classification and staff evidence fails closed", () => {
  type Evidence = ReturnType<typeof fixture>;
  for (const mutate of [
    (value: Evidence) => {
      Reflect.deleteProperty(value, "rateProvenance");
    },
    (value: Evidence) => {
      value.lines[0].fallbackRatePct = "99";
    },
    (value: Evidence) => {
      value.rateProvenance.itemId = "foreign";
    },
    (value: Evidence) => {
      value.itemId = "foreign";
    },
    (value: Evidence) => {
      value.rateProvenance.rateAt = "2026-09-14T00:00:00.000Z";
    },
    (value: Evidence) => {
      value.rateProvenance.category = "changed";
    },
    (value: Evidence) => {
      value.rateProvenance.selections[0].staffId = "foreign";
    },
    (value: Evidence) => {
      value.rateProvenance.selections.push(value.rateProvenance.selections[0]);
    },
    (value: Evidence) => {
      value.rateProvenance.selections[0].legacyServiceRate = "101";
    },
  ]) {
    const evidence = fixture();
    mutate(evidence);
    assert.throws(() => verify(evidence), /RATE_PROVENANCE_UNCONFIRMED/);
  }
});

test("immutable rule identity and precedence are replayed, not just matching rate", () => {
  const evidence = fixture();
  const selection = evidence.rateProvenance.selections[0].selection;
  selection.source = "ITEM";
  selection.ruleId = "rule";
  assert.doesNotThrow(() => verify(evidence, [rule()]));
  assert.throws(() => verify(evidence), /RATE_PROVENANCE_UNCONFIRMED/);
  assert.throws(() => verify(evidence, [rule({ id: "different" })]), /RATE_PROVENANCE_UNCONFIRMED/);
  assert.throws(() => verify(evidence, [rule({ rate: "20" })]), /RATE_PROVENANCE_UNCONFIRMED/);
  assert.throws(
    () => verify(evidence, [{ ...rule(), tenantId: "foreign" }]),
    /RATE_PROVENANCE_UNCONFIRMED/,
  );
});

test("later-published backdated rules and future-effective rules do not rewrite captures", () => {
  const evidence = fixture();
  assert.doesNotThrow(() =>
    verify(evidence, [rule({ createdAt: new Date("2026-10-01T00:00:00Z") })]),
  );
  assert.doesNotThrow(() =>
    verify(evidence, [rule({ effectiveAt: new Date("2026-10-01T00:00:00Z") })]),
  );
  assert.throws(() => verify(evidence, [rule()]), /RATE_PROVENANCE_UNCONFIRMED/);
});

test("explicit zero product rate and inheritance replay without service fallback", () => {
  const evidence = fixture();
  evidence.lines[0].fallbackRatePct = "0";
  evidence.rateProvenance.selections[0].selection = { rate: "0", source: "NONE", ruleId: null };
  assert.doesNotThrow(() => verify(evidence, [], "PRODUCT"));
  evidence.rateProvenance.selections[0].selection = { rate: "0", source: "ITEM", ruleId: "rule" };
  assert.doesNotThrow(() =>
    verify(evidence, [rule({ itemKind: "PRODUCT", rate: "0" })], "PRODUCT"),
  );
  const service = fixture();
  service.lines[0].fallbackRatePct = "8";
  service.rateProvenance.selections[0].selection = {
    rate: "8",
    source: "COMPANY",
    ruleId: "company",
  };
  assert.doesNotThrow(() =>
    verify(service, [
      rule({ scope: "STAFF", targetId: null, rate: null }),
      rule({ id: "company", scope: "COMPANY", staffId: null, targetId: null, rate: "8" }),
    ]),
  );
});

test("capture before operation cannot establish historical rate provenance", () => {
  assert.throws(
    () =>
      verifyOrdinaryPayrollRateProvenance(
        fixture(),
        { itemId: "service", itemType: "SERVICE" },
        at,
        new Date("2026-09-14T00:00:00Z"),
        [],
        "salon",
      ),
    /RATE_PROVENANCE_UNCONFIRMED/,
  );
});

test("historical department selection uses frozen category and deterministic rule ordering", () => {
  const evidence = fixture();
  Object.assign(evidence.lines[0], { productCategory: "department" });
  evidence.rateProvenance.category = "department";
  evidence.rateProvenance.selections[0].selection = {
    rate: "10",
    source: "DEPARTMENT",
    ruleId: "z-rule",
  };
  const rules = [
    rule({ id: "a-rule", scope: "DEPARTMENT", targetId: "department", rate: "20" }),
    rule({ id: "z-rule", scope: "DEPARTMENT", targetId: "department" }),
  ];
  assert.doesNotThrow(() => verify(evidence, rules));
  assert.doesNotThrow(() => verify(evidence, [...rules].reverse()));
  evidence.rateProvenance.category = "today-category";
  assert.throws(() => verify(evidence, rules), /RATE_PROVENANCE_UNCONFIRMED/);
});
