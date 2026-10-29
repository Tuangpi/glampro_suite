import assert from "node:assert/strict";
import { test } from "node:test";
import { runAsTenant } from "../lib/tenant-context.js";
import { appendPayrollSource } from "./payroll-source-event.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

test("source writer freezes fallback selection, legacy staff rate, item and department at capture", async () => {
  const at = new Date("2026-09-15T00:00:00Z");
  const tx = {
    payrollSourceEvent: {
      findFirst: async () => null,
      create: async ({ data }: { data: unknown }) => data,
    },
    sale: { findFirstOrThrow: async () => ({ outletId: "branch", collectionCurrency: "SGD" }) },
    tenant: { findUniqueOrThrow: async () => ({ timeZone: "Asia/Singapore" }) },
    commissionRule: { findMany: async () => [] },
    user: { findFirst: async () => ({ commissionRate: "12.50" }) },
  } as unknown as PayrollCloseTransaction;
  const captured = await runAsTenant(
    "salon",
    () =>
      appendPayrollSource(tx, {
        sourceKey: "sale-line:line",
        sourceType: "SALE_LINE",
        sourceId: "line",
        saleId: "sale",
        occurredAt: at,
        reason: "Capture operational service",
        commissionType: "SVC",
        baseAmount: "100.0000",
        units: "1.0000",
        shares: [{ staffId: "staff", share: 10000 }],
        itemId: "service",
        category: "department",
      }),
    "owner",
  );
  const evidence = captured.evidence as {
    rateProvenance: unknown;
    lines: { productCategory: string; fallbackRatePct: string }[];
  };
  assert.deepEqual(evidence.rateProvenance, {
    version: 1,
    rateAt: at.toISOString(),
    itemId: "service",
    category: "department",
    selections: [
      {
        staffId: "staff",
        legacyServiceRate: "12.50",
        selection: { rate: "12.50", source: "LEGACY_STAFF", ruleId: null },
      },
    ],
  });
  assert.equal(evidence.lines[0].productCategory, "department");
  assert.equal(evidence.lines[0].fallbackRatePct, "12.50");
});
