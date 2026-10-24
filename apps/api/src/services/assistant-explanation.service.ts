import {
  assistantQuestions,
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
    .replace(/[?!.]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
/** Exact supported phrases only: never extract SQL, instructions or actions from text. */
export function explanationTopic(question: string): Topic | null {
  return (
    (Object.keys(assistantQuestions) as Topic[]).find(
      (topic) => normalized(assistantQuestions[topic]) === normalized(question),
    ) ?? null
  );
}
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
    default:
      throw new Error("Policy topics do not use business metrics.");
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
  const topic = explanationTopic(input.question);
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
    suggestions: Object.entries(assistantQuestions)
      .filter(
        ([key]) =>
          (key !== "rebooking" && key !== "quietDays") ||
          (key === "rebooking"
            ? entitled.has("customers") && entitled.has("appointments")
            : entitled.has("catalogue") && entitled.has("appointments")),
      )
      .map(([, question]) => question),
  };
  if (!topic) {
    if (
      [
        "income",
        "sales",
        "why",
        "how are we doing",
        "what about last month",
        "compare periods",
      ].includes(normalized(input.question))
    ) {
      base.status = "clarify";
      base.answer =
        "Please choose a specific supported question and an explicit period. Income may mean completed-sale paid amounts or net paid; they are different. Comparisons and causal explanations are not supported.";
    }
    return assistantExplanationSchema.parse(base);
  }
  if (topic === "rebooking" || topic === "quietDays") {
    const codes =
      topic === "rebooking" ? ["customers", "appointments"] : ["catalogue", "appointments"];
    if (!codes.every((code) => entitled.has(code)))
      throw forbidden("Source module is not entitled.", "MODULE_NOT_ENTITLED");
    return assistantExplanationSchema.parse({
      ...base,
      status: "answered",
      source: topic === "rebooking" ? "rebooking-policy" : "quiet-day-policy",
      answer:
        topic === "rebooking"
          ? "Rebooking recommendations require an overdue latest completed visit, the explicit service interval (or company fallback), current consent for the exact preferred enabled channel/destination, no upcoming booking and no conflicting recent, active or uncertain rebooking job. Open Rebooking recommendations for current recipient evidence. This answer does not check any individual customer and does not save, approve or send a message."
          : "Quiet-day opportunities screen tomorrow through seven salon-local days for fewer than three non-cancelled booking starts per day, then run existing staff, shift, conflict and resource checks for one selected service. Search is bounded to ten staff and 120 slot checks, with at most one opening per day. Use Quiet-day opportunities for current evidence. This rule is not utilisation, demand, profit, a reservation or a guarantee; only regular-price suggestions are supported.",
      limitations: [
        ...base.limitations,
        "Policy explanation only. The selected reporting period is not applied to eligibility or availability; no fresh recipient or slot search was performed.",
      ],
    });
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
      answer:
        "Verified business facts could not be loaded. No figures or previous answer have been substituted. Retry this question later. No language-provider fallback is enabled.",
    });
  }
}
