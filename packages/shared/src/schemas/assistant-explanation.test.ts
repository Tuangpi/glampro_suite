import assert from "node:assert/strict";
import { it } from "node:test";
import {
  assistantQuestions,
  assistantTopicKeywords,
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

it("requires consistent evidence for answered facts and none for refusals or clarifications", () => {
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
  const evidence = {
    incomeToday: "0.00",
    completedSalePaid: "0.00",
    refundsToday: "0.00",
    netPaid: "0.00",
    salesToday: 0,
    averageTicket: "0.00",
    appointmentsToday: 0,
    newCustomersToday: 0,
    lowStockCount: 0,
    lowStockThreshold: 5,
    timeZone: "Asia/Singapore",
    from: "2026-10-23T16:00:00.000Z",
    to: "2026-10-24T16:00:00.000Z",
    asOf: "2026-10-24T01:00:00.000Z",
  };
  assert.equal(assistantExplanationSchema.safeParse(base).success, true);
  const answered = {
    ...base,
    status: "answered",
    topic: "paid",
    source: "owner-metrics",
    evidence,
  };
  assert.equal(assistantExplanationSchema.safeParse(answered).success, true);
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
    assistantExplanationSchema.safeParse({ ...answered, asOf: "2026-10-24T02:00:00.000Z" }).success,
    false,
  );
  assert.equal(
    assistantExplanationSchema.safeParse({ ...answered, evidence: null }).success,
    false,
  );
  assert.equal(
    assistantExplanationSchema.safeParse({ ...base, source: "owner-metrics" }).success,
    false,
  );
  assert.equal(assistantExplanationSchema.safeParse({ ...base, topic: "paid" }).success, false);
  assert.equal(assistantExplanationSchema.safeParse({ ...base, evidence }).success, false);
  assert.equal(
    assistantExplanationSchema.safeParse({
      ...base,
      status: "answered",
      topic: "rebooking",
      source: "rebooking-policy",
    }).success,
    false,
  );
  assert.equal(
    assistantExplanationSchema.safeParse({
      ...base,
      status: "answered",
      topic: "quietDays",
      source: "owner-metrics",
    }).success,
    false,
  );
});

it("keeps the keyword vocabulary in step with the supported topics", () => {
  assert.deepEqual(
    Object.keys(assistantTopicKeywords).sort(),
    Object.keys(assistantQuestions).sort(),
  );
  assert.ok(!("rebooking" in assistantQuestions));
  for (const [topic, keywords] of Object.entries(assistantTopicKeywords)) {
    assert.ok(keywords.length > 0, topic);
    assert.equal(new Set(keywords).size, keywords.length, topic);
    for (const keyword of keywords) {
      assert.equal(keyword, keyword.trim().toLowerCase(), keyword);
      assert.ok(keyword.length > 0);
    }
  }
  const suggested = Object.values(assistantQuestions);
  assert.equal(suggested.length, 7);
  assert.equal(
    assistantExplanationSchema.safeParse({
      status: "unsupported",
      mode: "deterministic",
      topic: null,
      answer: "Unsupported.",
      evidence: null,
      source: null,
      asOf: "2026-10-24T01:00:00.000Z",
      limitations: [],
      suggestions: suggested,
    }).success,
    true,
  );
});
