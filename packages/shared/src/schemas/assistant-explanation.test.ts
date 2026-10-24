import assert from "node:assert/strict";
import { it } from "node:test";
import {
  assistantExplanationInputSchema,
  assistantExplanationSchema,
} from "./assistant-explanation.js";

it("bounds questions and rejects untrusted context, actions and invalid periods", () => {
  assert.deepEqual(assistantExplanationInputSchema.parse({ question: " Sales? " }), {
    question: "Sales?",
    period: "today",
  });
  for (const input of [
    { question: " " },
    { question: "x".repeat(301) },
    { question: ["sales"] },
    { question: "sales", tenantId: "other" },
    { question: "sales", evidence: {} },
    { question: "sales", provider: "external" },
    { question: "sales", action: "send" },
    { question: "sales", period: "lastMonth" },
    { question: "sales", from: "2026-10-01" },
    { question: "sales", period: "custom" },
    { question: "sales", period: "custom", from: "2026-02-30", to: "2026-03-01" },
    { question: "sales", period: "custom", from: "2026-10-02", to: "2026-10-01" },
    { question: "sales", period: "custom", from: "2026-01-01", to: "2026-02-01" },
  ])
    assert.equal(
      assistantExplanationInputSchema.safeParse(input).success,
      false,
      JSON.stringify(input),
    );
  assert.equal(
    assistantExplanationInputSchema.safeParse({
      question: "sales",
      period: "custom",
      from: "2026-01-01",
      to: "2026-01-31",
    }).success,
    true,
  );
});

it("requires consistent evidence for answered facts and none for refusals or policy", () => {
  const base = {
    status: "unsupported",
    mode: "deterministic",
    topic: null,
    answer: "Unsupported.",
    evidence: null,
    source: null,
    asOf: "2026-10-24T01:00:00.000Z",
    limitations: [],
    suggestions: [],
  };
  assert.equal(assistantExplanationSchema.safeParse(base).success, true);
  assert.equal(
    assistantExplanationSchema.safeParse({
      ...base,
      status: "answered",
      topic: "paid",
      source: "owner-metrics",
    }).success,
    false,
  );
  assert.equal(
    assistantExplanationSchema.safeParse({ ...base, source: "owner-metrics" }).success,
    false,
  );
  assert.equal(
    assistantExplanationSchema.safeParse({
      ...base,
      status: "answered",
      topic: "rebooking",
      source: "rebooking-policy",
    }).success,
    true,
  );
  assert.equal(
    assistantExplanationSchema.safeParse({
      ...base,
      status: "answered",
      topic: "rebooking",
      source: "quiet-day-policy",
    }).success,
    false,
  );
});
