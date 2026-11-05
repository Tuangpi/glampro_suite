import { z } from "zod";
import { ownerSummarySchema } from "./ai-assistant.js";

export const assistantQuestions = {
  summary: "How is the business doing?",
  paid: "What are completed-sale paid amounts?",
  refunds: "How do refunds affect net paid?",
  average: "How is average ticket calculated?",
  appointments: "How many appointments are there?",
  customers: "How many new customers are there?",
  stock: "What is low stock?",
} as const;

/** Every topic the assistant can answer; the panel's suggested questions come from here. */
export type AssistantTopic = keyof typeof assistantQuestions;

/**
 * Everyday wording that maps to each topic, matched as whole words by the API.
 *
 * This is a fixed vocabulary, not natural-language understanding: there is no
 * model, no inference and no free-form generation. It exists so an owner can
 * type "how much did we take today" instead of the exact template. The API
 * refuses instruction/action/restricted-data wording before this list runs.
 */
export const assistantTopicKeywords: Record<AssistantTopic, readonly string[]> = {
  summary: [
    "how is the business doing",
    "how are we doing",
    "how is the salon doing",
    "how did we do",
    "business doing",
    "overview",
    "summary",
    "how are things",
  ],
  paid: [
    "what are completed sale paid amounts",
    "paid amounts",
    "paid amount",
    "completed sale paid",
    "completed sales",
    "completed receipts",
    "takings",
    "made",
    "make",
    "take",
    "took",
    "sales total",
    "total sales",
    "how much money",
  ],
  refunds: [
    "how do refunds affect net paid",
    "refund",
    "refunds",
    "refunded",
    "refunding",
    "net paid",
    "net",
    "minus refunds",
  ],
  average: [
    "how is average ticket calculated",
    "average ticket",
    "average sale",
    "average spend",
    "average",
    "per receipt",
    "per sale",
  ],
  appointments: [
    "how many appointments are there",
    "bookings",
    "booking",
    "appointment",
    "appointments",
    "booked",
    "how many appointments",
    "no shows",
  ],
  customers: [
    "how many new customers are there",
    "new customer",
    "new customers",
    "new clients",
    "new client",
    "customer records",
    "client records",
    "how many customers",
    "how many clients",
  ],
  stock: [
    "what is low stock",
    "low stock",
    "stock",
    "inventory",
    "restock",
    "reorder",
    "running low",
    "running out",
  ],
};
export const assistantExplanationInputSchema = z
  .object({
    question: z.string().trim().min(1).max(300),
    period: z.enum(["today", "yesterday", "last7", "custom"]).default("today"),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.period === "custom") {
      if (
        !value.from ||
        !value.to ||
        value.from > value.to ||
        (Date.parse(value.to) - Date.parse(value.from)) / 86400000 > 30
      )
        ctx.addIssue({
          code: "custom",
          message: "Choose an ordered range of at most 31 calendar days.",
          path: ["to"],
        });
    } else if (value.from || value.to)
      ctx.addIssue({
        code: "custom",
        message: "Dates require the custom period.",
        path: ["period"],
      });
  });
const assistantTopicNames = Object.keys(assistantQuestions) as [
  AssistantTopic,
  ...AssistantTopic[],
];
export const assistantExplanationSchema = z
  .object({
    status: z.enum(["answered", "clarify", "unsupported", "unavailable"]),
    mode: z.literal("deterministic"),
    topic: z.enum(assistantTopicNames).nullable(),
    answer: z.string().min(1).max(3000),
    evidence: ownerSummarySchema.nullable(),
    source: z.literal("owner-metrics").nullable(),
    asOf: z.iso.datetime(),
    limitations: z.array(z.string().max(500)).max(8),
    suggestions: z.array(z.string().max(100)).max(7),
  })
  .superRefine((value, ctx) => {
    if (
      value.status === "answered"
        ? !value.topic ||
          value.source !== "owner-metrics" ||
          !value.evidence ||
          value.asOf !== value.evidence.asOf
        : value.evidence !== null || value.source !== null || value.topic !== null
    )
      ctx.addIssue({
        code: "custom",
        message: "Answer status, topic and evidence must agree.",
        path: ["evidence"],
      });
  });
export type AssistantExplanationInput = z.infer<typeof assistantExplanationInputSchema>;
export type AssistantExplanation = z.infer<typeof assistantExplanationSchema>;
