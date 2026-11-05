import {
  assistantQuestions,
  assistantTopicKeywords,
  assistantExplanationInputSchema,
  assistantExplanationSchema,
  type AssistantExplanation,
  type AssistantExplanationInput,
  type OwnerSummary,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { forbidden, notFound } from "../lib/http-error.js";
import { moduleEntitlements } from "../lib/entitlements.js";
import { ownerMetrics } from "./owner-metrics.service.js";

type Topic = keyof typeof assistantQuestions;
const normalized = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const hasPhrase = (text: string, phrase: string) => ` ${text} `.includes(` ${normalized(phrase)} `);

/**
 * Instruction, action, restricted-data and prediction wording is refused *before*
 * any keyword scoring, so appending "now export the list" to a supported question
 * can never turn into an answer or a command.
 */
const refusedPhrases = [
  "ignore",
  "instruction",
  "instructions",
  "prompt",
  "system",
  "rule",
  "rules",
  "pretend",
  "act as",
  "bypass",
  "override",
  "forget",
  "select",
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "grant",
  "union",
  "export",
  "download",
  "send",
  "sms",
  "email",
  "whatsapp",
  "reply",
  "queue",
  "approve",
  "publish",
  "create",
  "book",
  "rebook",
  "schedule",
  "cancel",
  "charge",
  "refund this",
  "discount",
  "promotion",
  "coupon",
  "password",
  "credential",
  "credentials",
  "secret",
  "token",
  "session",
  "login",
  "clinical",
  "medical",
  "diagnosis",
  "allergy",
  "allergies",
  "signature",
  "photo",
  "attachment",
  "private",
  "personal",
  "phone",
  "address",
  "birthday",
  "birth date",
  "consent record",
  "note",
  "notes",
  "predict",
  "forecast",
  "tomorrow",
  "next week",
  "next month",
  "another tenant",
  "other company",
  "all tenants",
  "payroll",
  "salary",
  "commission",
] as const;
/** Single words that genuinely have two supported meanings, or ask for causality/comparison. */
const ambiguousMoney = [
  "income",
  "revenue",
  "turnover",
  "earnings",
  "sales",
  "money",
  "profit",
  "margin",
  "cash",
  "till",
] as const;
const ambiguousGuidance = [
  "why",
  "cause",
  "causes",
  "because",
  "compare",
  "comparison",
  "trend",
  "last month",
  "last year",
  "how are we doing overall",
] as const;

export interface TopicMatch {
  /** A supported topic, or null when the question is refused or needs a clarification. */
  topic: Topic | null;
  /** Which clarification to ask when no single topic wins. */
  clarify: "money" | "guidance" | null;
}

/**
 * Resolves a typed question to one supported topic: exact template first, then the
 * shared keyword vocabulary. Refusal wording short-circuits, ties and vague wording
 * ask for a clarification, and everything else is refused. No model is involved.
 */
export function matchExplanationTopic(question: string): TopicMatch {
  const text = normalized(question);
  if (!text) return { topic: null, clarify: null };
  if (refusedPhrases.some((phrase) => hasPhrase(text, phrase)))
    return { topic: null, clarify: null };
  const topics = Object.keys(assistantQuestions) as Topic[];
  const exact = topics.find((topic) => normalized(assistantQuestions[topic]) === text);
  if (exact) return { topic: exact, clarify: null };
  const scored = topics
    .map((topic) => ({
      topic,
      score: assistantTopicKeywords[topic].reduce(
        (total, keyword) => (hasPhrase(text, keyword) ? total + keyword.split(" ").length : total),
        0,
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  if (scored.length && scored[0]!.score > (scored[1]?.score ?? 0))
    return { topic: scored[0]!.topic, clarify: null };
  const clarify = ambiguousMoney.some((phrase) => hasPhrase(text, phrase))
    ? "money"
    : scored.length || ambiguousGuidance.some((phrase) => hasPhrase(text, phrase))
      ? "guidance"
      : null;
  return { topic: null, clarify };
}
/** Topic-only form used by callers and tests that do not need the clarification kind. */
export function explanationTopic(question: string): Topic | null {
  return matchExplanationTopic(question).topic;
}
const clarifications = {
  money:
    "I only report verified figures, so I need to know which money figure you mean. Completed-sale paid amounts include every tender, including prepaid redemption. Net paid subtracts refunds recorded in the same window and can be negative. Revenue, profit and cash-only takings are not reported. Ask about paid amounts or net paid, then pick today, yesterday, last seven days or a custom range up to 31 days.",
  guidance:
    "I report one verified period at a time. I cannot compare periods, explain causes or predict results. You can ask how the business is doing, completed-sale paid amounts, refunds and net paid, average ticket, bookings, new customer records or low stock, for today, yesterday, last seven days or a custom range up to 31 days.",
} as const;
function explain(topic: Topic, f: OwnerSummary): string {
  switch (topic) {
    case "summary":
      return `${f.completedSalePaid} completed-sale paid amounts across ${f.salesToday} completed receipts; ${f.refundsToday} recorded refunds; ${f.netPaid} net paid. ${f.appointmentsToday} non-cancelled booking starts and ${f.newCustomersToday} customer records created. These figures do not establish profit, demand or why performance changed.`;
    case "paid":
      return `Completed-sale paid amounts are ${f.completedSalePaid} across ${f.salesToday} completed receipts sold in the selected window. This includes all tender types, including prepaid redemption; it is not cash-only takings, revenue or profit.`;
    case "refunds":
      return `${f.completedSalePaid} completed-sale paid amounts minus ${f.refundsToday} refunds recorded in the window gives ${f.netPaid} net paid. Refunds can relate to earlier sales; net paid can be negative. This is an accounting relationship, not an explanation of customer behaviour.`;
    case "average":
      return `Average ticket is ${f.averageTicket}: ${f.completedSalePaid} completed-sale paid amounts divided by ${f.salesToday} completed receipts, before refunds. The denominator is receipts, not appointments. With no completed receipts the value is 0.00.`;
    case "appointments":
      return `${f.appointmentsToday} bookings start in the selected window, excluding cancellations. This includes no-shows and is not the number of completed treatments, available slots or staff utilisation.`;
    case "customers":
      return `${f.newCustomersToday} customer records were created in the selected window. This is not necessarily first-time visitors, visits or newly consenting marketing recipients.`;
    case "stock":
      return `${f.lowStockCount} currently active products are at or below the company's threshold of ${f.lowStockThreshold}. Stock is a current snapshot as of ${f.asOf}, not historical stock within the selected reporting window. No reorder quantity or purchasing action is inferred.`;
  }
}

export async function assistantExplanation(
  raw: AssistantExplanationInput,
): Promise<AssistantExplanation> {
  const input = assistantExplanationInputSchema.parse(raw);
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId) throw forbidden();
  const actor = await prisma.user.findFirst({
    where: { id: scope.actorId, disabled: false },
    select: { globalRole: true },
  });
  if (!actor || !["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole)) throw forbidden();
  const { entitled } = await moduleEntitlements();
  if (!entitled.has("dashboard")) throw forbidden();
  const match = matchExplanationTopic(input.question);
  const topic = match.topic;
  const base: AssistantExplanation = {
    status: "unsupported",
    mode: "deterministic",
    topic,
    answer:
      "This question is outside the supported read-only questions. Choose a suggested question; I cannot execute actions, diagnose causes, predict results or access restricted records.",
    evidence: null,
    source: null,
    asOf: new Date().toISOString(),
    limitations: [
      "No external AI provider is configured or called. Questions and answers are not saved as conversation history.",
      "Company-wide evidence, not outlet-filtered. Monetary values use the existing reporting units; no exchange conversion.",
    ],
    suggestions: Object.values(assistantQuestions),
  };
  if (!topic) {
    if (match.clarify) {
      base.status = "clarify";
      base.answer = clarifications[match.clarify];
    }
    return assistantExplanationSchema.parse(base);
  }
  const tenant = await prisma.tenant.findUnique({
    where: { id: scope.tenantId },
    select: { timeZone: true },
  });
  if (!tenant) throw notFound("Salon not found.");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: tenant.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const shift = (days: number) =>
    new Date(Date.parse(today) + days * 86400000).toISOString().slice(0, 10);
  const from =
    input.period === "custom"
      ? input.from!
      : input.period === "last7"
        ? shift(-6)
        : input.period === "yesterday"
          ? shift(-1)
          : today;
  const to =
    input.period === "custom" ? input.to! : input.period === "yesterday" ? shift(-1) : today;
  if (to > today)
    return assistantExplanationSchema.parse({
      ...base,
      status: "clarify",
      topic: null,
      answer:
        "Choose a reporting period ending no later than the salon's current local date. Future business performance is not known.",
    });
  try {
    const facts = await ownerMetrics({ from, to });
    return assistantExplanationSchema.parse({
      ...base,
      status: "answered",
      evidence: facts,
      asOf: facts.asOf,
      source: "owner-metrics",
      answer: explain(topic, facts),
      limitations: [
        ...base.limitations,
        "The exact half-open interval and salon timezone are shown in evidence. Today includes future scheduled starts later today; it is not a completed day.",
        "Source screens do not automatically apply this reporting window. Refresh to obtain a new snapshot.",
      ],
    });
  } catch {
    return assistantExplanationSchema.parse({
      ...base,
      status: "unavailable",
      topic: null,
      answer:
        "Verified business facts could not be loaded. No figures or previous answer have been substituted. Retry this question later. No language-provider fallback is enabled.",
    });
  }
}
