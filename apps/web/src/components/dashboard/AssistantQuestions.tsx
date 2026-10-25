import { useState } from "react";
import { Link } from "react-router";
import {
  assistantQuestions,
  assistantExplanationSchema,
  type AssistantExplanation,
  type AssistantExplanationInput,
} from "@glampro_suite/shared";
import { useAuth } from "@/contexts/AuthContext";
import { post } from "@/lib/api";
import Button from "@/components/ui/Button";
import { CONTROL_CLASS } from "@/components/ui/Field";

export default function AssistantQuestions() {
  const { user, tenant, entitlements } = useAuth();
  if (
    !user ||
    !tenant ||
    !["SUPER_ADMIN", "MANAGER"].includes(user.globalRole) ||
    !entitlements?.some((entry) => entry.code === "dashboard")
  )
    return null;
  return (
    <Workspace
      key={`${tenant.id}:${user.id}:${entitlements
        .map((entry) => entry.code)
        .sort()
        .join(",")}`}
    />
  );
}

function Workspace() {
  const { entitlements } = useAuth();
  const [question, setQuestion] = useState<string>(assistantQuestions.summary);
  const [period, setPeriod] = useState<AssistantExplanationInput["period"]>("today");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState<AssistantExplanation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const entitled = (code: string) => entitlements.some((entry) => entry.code === code);
  const suggestions = Object.entries(assistantQuestions).filter(
    ([topic]) =>
      (topic !== "rebooking" && topic !== "quietDays") ||
      (topic === "rebooking"
        ? entitled("customers") && entitled("appointments")
        : entitled("catalogue") && entitled("appointments")),
  );
  function resetAnswer() {
    setResult(null);
    setError("");
  }
  async function ask() {
    resetAnswer();
    setBusy(true);
    try {
      const input = { question, period, ...(period === "custom" ? { from, to } : {}) };
      setResult(
        assistantExplanationSchema.parse(await post<unknown>("/ai-assistant/explain", input)),
      );
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      setError(
        status === 429
          ? "Explanation limit reached. Wait 15 minutes before retrying."
          : "Verified answer unavailable. Check your access and retry. No previous figures have been substituted.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="rounded-card border border-line bg-surface p-4 sm:p-6"
      aria-labelledby="assistant-questions-title"
    >
      <h2 id="assistant-questions-title" className="text-lg">
        Ask about verified business facts
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-ink-body">
        Bounded, read-only explanations. No external AI provider, saved conversation history or
        automatic actions. Choose a supported question; other wording may need clarification. Do not
        enter personal or clinical information.
      </p>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Supported questions">
        {suggestions.map(([topic, text]) => (
          <Button
            key={topic}
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setQuestion(text);
              resetAnswer();
            }}
          >
            {text}
          </Button>
        ))}
      </div>
      <form
        className="mt-4 grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink sm:col-span-2">
          Business question
          <textarea
            rows={3}
            className={`${CONTROL_CLASS} min-h-24 resize-y p-3 font-regular`}
            value={question}
            maxLength={300}
            disabled={busy}
            onChange={(e) => {
              setQuestion(e.target.value);
              resetAnswer();
            }}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-ink">
          Reporting period
          <select
            className={`${CONTROL_CLASS} min-h-control px-3 font-regular`}
            value={period}
            disabled={busy}
            onChange={(e) => {
              setPeriod(e.target.value as AssistantExplanationInput["period"]);
              resetAnswer();
            }}
          >
            <option value="today">Today (salon-local)</option>
            <option value="yesterday">Yesterday (salon-local)</option>
            <option value="last7">Last 7 calendar days, including today</option>
            <option value="custom">Custom (at most 31 calendar days)</option>
          </select>
        </label>
        {period === "custom" && (
          <>
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-ink">
              From date{" "}
              <input
                type="date"
                className={`${CONTROL_CLASS} min-h-control px-3 font-regular`}
                required
                value={from}
                disabled={busy}
                onChange={(e) => {
                  setFrom(e.target.value);
                  resetAnswer();
                }}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-ink">
              To date (inclusive){" "}
              <input
                type="date"
                className={`${CONTROL_CLASS} min-h-control px-3 font-regular`}
                required
                min={from}
                value={to}
                disabled={busy}
                onChange={(e) => {
                  setTo(e.target.value);
                  resetAnswer();
                }}
              />
            </label>
          </>
        )}
        <Button
          className="sm:col-span-2 sm:justify-self-start"
          type="submit"
          disabled={busy || !question.trim()}
        >
          Explain using verified facts
        </Button>
      </form>
      {busy && <p role="status">Checking verified facts…</p>}
      {error && <p role="alert">{error}</p>}
      {result && (
        <article className="mt-4 space-y-3" aria-label="Verified explanation">
          <p className="font-bold">
            {result.status} · deterministic · snapshot {result.asOf}
          </p>
          <p>{result.answer}</p>
          {result.evidence && (
            <details open>
              <summary>Reporting evidence and exact period</summary>
              <p>
                {result.evidence.timeZone} · {result.evidence.from} ≤ record time &lt;{" "}
                {result.evidence.to}
              </p>
              <dl>
                <dt>Completed-sale paid amounts</dt>
                <dd>{result.evidence.completedSalePaid}</dd>
                <dt>Recorded refunds</dt>
                <dd>{result.evidence.refundsToday}</dd>
                <dt>Net paid</dt>
                <dd>{result.evidence.netPaid}</dd>
                <dt>Completed receipts</dt>
                <dd>{result.evidence.salesToday}</dd>
                <dt>Average ticket (before refunds)</dt>
                <dd>{result.evidence.averageTicket}</dd>
                <dt>Non-cancelled booking starts</dt>
                <dd>{result.evidence.appointmentsToday}</dd>
                <dt>Customer records created</dt>
                <dd>{result.evidence.newCustomersToday}</dd>
                <dt>Current low-stock products / threshold</dt>
                <dd>
                  {result.evidence.lowStockCount} / {result.evidence.lowStockThreshold}
                </dd>
              </dl>
            </details>
          )}
          <p>
            Source: {result.source ?? "No business evidence queried"}. Refresh by submitting again;
            this snapshot does not update automatically.
          </p>
          <ul>
            {result.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {result.source === "owner-metrics" && entitled("reports") && (
            <Link to="/reports" className="underline">
              Open reports (period is not applied automatically)
            </Link>
          )}
          {result.topic === "stock" && entitled("catalogue") && (
            <Link to="/products" className="underline">
              Open current products
            </Link>
          )}
          {result.topic === "appointments" && entitled("appointments") && (
            <Link to="/appointments" className="underline">
              Open appointments (period is not applied automatically)
            </Link>
          )}
          {result.topic === "rebooking" && (
            <p>Use Rebooking recommendations on this dashboard for recipient evidence.</p>
          )}
          {result.topic === "quietDays" && (
            <p>
              Use Quiet-day opportunities on this dashboard to select a service and check openings.
            </p>
          )}
        </article>
      )}
    </section>
  );
}
