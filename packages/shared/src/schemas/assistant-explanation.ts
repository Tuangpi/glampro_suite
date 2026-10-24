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
  rebooking: "How are rebooking recommendations selected?",
  quietDays: "How are quiet-day opportunities selected?",
} as const;
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
export const assistantExplanationSchema = z
  .object({
    status: z.enum(["answered", "clarify", "unsupported", "unavailable"]),
    mode: z.literal("deterministic"),
    topic: z
      .enum([
        "summary",
        "paid",
        "refunds",
        "average",
        "appointments",
        "customers",
        "stock",
        "rebooking",
        "quietDays",
      ])
      .nullable(),
    answer: z.string().min(1).max(3000),
    evidence: ownerSummarySchema.nullable(),
    source: z.enum(["owner-metrics", "rebooking-policy", "quiet-day-policy"]).nullable(),
    asOf: z.iso.datetime(),
    limitations: z.array(z.string().max(500)).max(8),
    suggestions: z.array(z.string().max(100)).max(9),
  })
  .superRefine((value, ctx) => {
    const policy = value.topic === "rebooking" || value.topic === "quietDays";
    const source = value.topic === "rebooking" ? "rebooking-policy" : "quiet-day-policy";
    if (
      value.status === "answered"
        ? !value.topic ||
          (policy
            ? value.source !== source || value.evidence !== null
            : value.source !== "owner-metrics" ||
              !value.evidence ||
              value.asOf !== value.evidence.asOf)
        : value.evidence !== null || value.source !== null
    )
      ctx.addIssue({
        code: "custom",
        message: "Answer status, topic and evidence must agree.",
        path: ["evidence"],
      });
  });
export type AssistantExplanationInput = z.infer<typeof assistantExplanationInputSchema>;
export type AssistantExplanation = z.infer<typeof assistantExplanationSchema>;
