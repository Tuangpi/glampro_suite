/**
 * Ask about your business — a bounded chat over the reporting figures.
 *
 * This is a conversation, not a form: the owner types in everyday words, the
 * panel keeps the turns on screen and every answer carries the period it was
 * asked for. What it is *not*: a language model. `POST /ai-assistant/explain`
 * resolves the wording to one supported topic and answers from the same shared
 * metrics Reports uses, so a failed request shows a failed turn rather than
 * borrowing an earlier figure.
 *
 * The transcript is component state only — nothing is stored server-side — and
 * `AssistantQuestions` remounts the workspace on an identity, role or
 * entitlement change, so one user cannot inherit another's turns.
 *
 * See docs/owner-explanations.md for the supported topics and limits.
 */
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from "react";
import { Link } from "react-router";
import {
  assistantQuestions,
  assistantExplanationSchema,
  type AssistantExplanation,
  type AssistantExplanationInput,
  type AssistantTopic,
} from "@glampro_suite/shared";
import {
  ArrowRight,
  Banknote,
  BarChart,
  Calendar,
  Package,
  Split,
  Star,
  TrendingUp,
  Users,
} from "@/components/icons";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { post } from "@/lib/api";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import { CONTROL_CLASS } from "@/components/ui/Field";

type Period = AssistantExplanationInput["period"];

const PERIODS: ReadonlyArray<{ id: Period; label: string }> = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7", label: "Last 7 days" },
  { id: "custom", label: "Custom" },
];

const PERIOD_NAMES: Record<Period, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 days",
  custom: "Custom range",
};

const FAILURE_COPY =
  "Verified answer unavailable. Check your access and retry. No previous figures have been substituted.";
const LIMIT_COPY = "You have reached the question limit. Wait 15 minutes before asking again.";

/**
 * One glyph per topic, so the empty state offers a scannable grid instead of a wall
 * of identical pills. Decorative — the question text carries the meaning, and the
 * labels come from `assistantQuestions` so the grid cannot drift from the topics the
 * API accepts.
 */
const TOPIC_ICONS: Record<AssistantTopic, ComponentType<SVGProps<SVGSVGElement>>> = {
  summary: BarChart,
  paid: Banknote,
  refunds: Split,
  average: TrendingUp,
  appointments: Calendar,
  customers: Users,
  stock: Package,
};

const SUGGESTIONS = (Object.keys(assistantQuestions) as AssistantTopic[]).map((topic) => ({
  topic,
  text: assistantQuestions[topic],
}));

interface Turn {
  id: number;
  question: string;
  period: Period;
  from?: string;
  to?: string;
  /** null while the request is in flight, or after it failed. */
  answer: AssistantExplanation | null;
  error: string;
  pending: boolean;
}

/** The period an answer was asked for, so a retry repeats the question, not the chip. */
interface PeriodRequest {
  period: Period;
  from?: string;
  to?: string;
}

export default function AssistantQuestions() {
  const { user, tenant, entitlements } = useAuth();
  if (
    !user ||
    !tenant ||
    !["SUPER_ADMIN", "MANAGER"].includes(user.globalRole) ||
    !entitlements.some((entry) => entry.code === "dashboard")
  )
    return null;
  return (
    <Workspace
      key={`${tenant.id}:${user.id}:${user.globalRole}:${entitlements
        .map((entry) => entry.code)
        .sort()
        .join(",")}`}
    />
  );
}

function Workspace() {
  const { entitlements } = useAuth();
  const { locale, timeZone } = useSalonFormatting();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [period, setPeriod] = useState<Period>("today");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(0);
  const endRef = useRef<HTMLDivElement | null>(null);
  const entitled = (code: string) => entitlements.some((entry) => entry.code === code);
  const customReady = period !== "custom" || (from !== "" && to !== "" && from <= to);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [turns]);

  async function send(question: string, at: PeriodRequest = { period, from, to }) {
    const text = question.trim();
    const ready = at.period !== "custom" || (!!at.from && !!at.to && at.from <= at.to);
    if (!text || busy || !ready) return;
    const id = nextId.current++;
    const window = at.period === "custom" ? { from: at.from!, to: at.to! } : {};
    setTurns((current) => [
      ...current,
      { id, question: text, period: at.period, ...window, answer: null, error: "", pending: true },
    ]);
    setDraft("");
    setBusy(true);
    try {
      const input: AssistantExplanationInput = { question: text, period: at.period, ...window };
      const answer = assistantExplanationSchema.parse(
        await post<unknown>("/ai-assistant/explain", input),
      );
      setTurns((current) =>
        current.map((entry) =>
          entry.id === id ? { ...entry, answer, pending: false, error: "" } : entry,
        ),
      );
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      setTurns((current) =>
        current.map((entry) =>
          entry.id === id
            ? { ...entry, pending: false, error: status === 429 ? LIMIT_COPY : FAILURE_COPY }
            : entry,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  /** Re-asks the same question for the same period, in place of the failed turn. */
  function retry(turn: Turn) {
    if (busy) return;
    setTurns((current) => current.filter((entry) => entry.id !== turn.id));
    void send(turn.question, { period: turn.period, from: turn.from, to: turn.to });
  }

  const stamp = (turn: Turn, answer: AssistantExplanation) => {
    const asOf = new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(answer.asOf));
    const window =
      turn.period === "custom" && turn.from && turn.to
        ? `${PERIOD_NAMES.custom} ${turn.from} to ${turn.to}`
        : PERIOD_NAMES[turn.period];
    return `${window}, salon-local · as of ${asOf}`;
  };

  return (
    <section
      aria-labelledby="assistant-chat-title"
      className="flex min-w-0 flex-col rounded-card border border-line bg-surface p-4 sm:p-6"
    >
      <h2 id="assistant-chat-title" className="text-lg">
        Ask about your business
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-ink-body">
        Read-only answers from the same figures Reports uses. No external AI provider, no saved
        history and no automatic actions.
      </p>

      <div
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className={`mt-4 flex flex-col gap-4 ${
          turns.length > 0 ? "max-h-[28rem] overflow-y-auto pr-1" : ""
        }`}
      >
        {turns.length === 0 && <Welcome busy={busy} onAsk={(text) => void send(text)} />}
        {turns.map((turn) => (
          <div key={turn.id} className="flex flex-col gap-3">
            <div className="flex justify-end">
              <p className="max-w-[36ch] rounded-card bg-purple px-4 py-2.5 text-sm text-white sm:max-w-[46ch]">
                {turn.question}
              </p>
            </div>
            {turn.pending && (
              <AssistantLine>
                <p role="status" className="animate-pulse text-sm text-ink-body">
                  Checking verified facts…
                </p>
              </AssistantLine>
            )}
            {turn.error !== "" && (
              <AssistantLine>
                <div className="flex max-w-[60ch] flex-col items-start gap-2 rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
                  <p role="alert">{turn.error}</p>
                  <Button variant="secondary" disabled={busy} onClick={() => retry(turn)}>
                    Retry question
                  </Button>
                </div>
              </AssistantLine>
            )}
            {turn.answer && (
              <AssistantLine>
                <Article
                  answer={turn.answer}
                  stamp={stamp(turn, turn.answer)}
                  entitled={entitled}
                />
              </AssistantLine>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        aria-label="Ask a business question"
        className="mt-4 flex flex-col gap-3 border-t border-line pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <div
          role="group"
          className="flex flex-wrap items-center gap-2"
          aria-label="Reporting period"
        >
          <span className="text-sm font-medium text-ink">Period</span>
          {PERIODS.map((entry) => (
            <Chip
              key={entry.id}
              selected={period === entry.id}
              disabled={busy}
              onSelect={() => setPeriod(entry.id)}
            >
              {entry.label}
            </Chip>
          ))}
        </div>
        {period === "custom" && (
          <div className="flex flex-wrap gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium text-ink">
              From date{" "}
              <input
                type="date"
                className={`${CONTROL_CLASS} min-h-control px-3 font-regular`}
                required
                value={from}
                disabled={busy}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium text-ink">
              To date (inclusive){" "}
              <input
                type="date"
                className={`${CONTROL_CLASS} min-h-control px-3 font-regular`}
                required
                min={from}
                value={to}
                disabled={busy}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
          </div>
        )}
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
          Your question
          <textarea
            rows={2}
            className={`${CONTROL_CLASS} resize-y p-3 font-regular`}
            value={draft}
            maxLength={300}
            placeholder="How much did we take today?"
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-ink-muted">
              {draft.length}/300 · Enter sends, Shift+Enter adds a line
            </p>
            <p className="text-xs text-ink-muted">Do not enter personal or clinical information.</p>
          </div>
          <Button type="submit" disabled={busy || !draft.trim() || !customReady} loading={busy}>
            Send
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * The panel's own turns hang off one avatar, so the log reads as a single voice
 * rather than as stray paragraphs.
 */
function AssistantLine({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-pill bg-purple-soft text-base text-purple"
      >
        <Star />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * What the panel shows before the first question: an opening line and the seven
 * supported questions as a two-column grid of icon-labelled cards.
 *
 * Nothing is asked on mount — the panel opens without a request, so it cannot show a
 * figure the owner did not ask for. A suggestion sends that exact template with the
 * period currently selected, and the grid steps aside once the conversation starts,
 * because the composer is then the obvious place to type.
 */
function Welcome({ busy, onAsk }: { busy: boolean; onAsk: (text: string) => void }) {
  return (
    <AssistantLine>
      <div className="rounded-card border border-line-soft bg-surface-muted p-4 sm:p-5">
        <p className="text-base font-heavy text-ink">What would you like to know?</p>
        <p className="mt-1 max-w-[60ch] text-sm text-ink-body">
          Pick a starting point, or type your own question below. Answers come from the same figures
          Reports uses, for the period you select.
        </p>
        <p className="mt-4 text-xs font-bold tracking-wide text-ink-muted uppercase">Try asking</p>
        <ul aria-label="Suggested questions" className="mt-2 grid gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map(({ topic, text }) => {
            const Icon = TOPIC_ICONS[topic];
            return (
              <li key={topic} className="min-w-0">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAsk(text)}
                  className="group flex min-h-control w-full items-center gap-3 rounded-md border border-line bg-surface px-3 py-2 text-left text-sm text-ink transition-colors hover:border-purple hover:bg-purple-softer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span
                    aria-hidden
                    className="flex size-8 shrink-0 items-center justify-center rounded-md bg-purple-soft text-base text-purple"
                  >
                    <Icon />
                  </span>
                  <span className="min-w-0 flex-1">{text}</span>
                  <ArrowRight
                    aria-hidden
                    className="size-4 shrink-0 text-ink-muted transition-colors group-hover:text-purple"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </AssistantLine>
  );
}

/**
 * One answered turn: the prose first, then the evidence and the caveats folded
 * away — a chat answer that opens with eight figures is not a chat answer.
 */
function Article({
  answer,
  stamp,
  entitled,
}: {
  answer: AssistantExplanation;
  stamp: string;
  entitled: (code: string) => boolean;
}) {
  return (
    <article aria-label="Verified answer" className="max-w-[70ch]">
      <p className="text-sm leading-relaxed text-ink">{answer.answer}</p>
      <p className="mt-1.5 text-xs text-ink-muted">{stamp}</p>
      {answer.evidence && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-ink-body">
            Show the figures and exact period
          </summary>
          <p className="mt-2 text-xs text-ink-body">
            {answer.evidence.timeZone} · {answer.evidence.from} ≤ record time &lt;{" "}
            {answer.evidence.to}
          </p>
          <dl className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
            <dt>Completed-sale paid amounts</dt>
            <dd>{answer.evidence.completedSalePaid}</dd>
            <dt>Recorded refunds</dt>
            <dd>{answer.evidence.refundsToday}</dd>
            <dt>Net paid</dt>
            <dd>{answer.evidence.netPaid}</dd>
            <dt>Completed receipts</dt>
            <dd>{answer.evidence.salesToday}</dd>
            <dt>Average ticket (before refunds)</dt>
            <dd>{answer.evidence.averageTicket}</dd>
            <dt>Non-cancelled booking starts</dt>
            <dd>{answer.evidence.appointmentsToday}</dd>
            <dt>Customer records created</dt>
            <dd>{answer.evidence.newCustomersToday}</dd>
            <dt>Current low-stock products / threshold</dt>
            <dd>
              {answer.evidence.lowStockCount} / {answer.evidence.lowStockThreshold}
            </dd>
          </dl>
        </details>
      )}
      {answer.limitations.length > 0 && (
        <details className="mt-1 text-sm">
          <summary className="cursor-pointer text-ink-body">
            What this answer can&rsquo;t tell you
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-body">
            {answer.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        {answer.source === "owner-metrics" && entitled("reports") && (
          <Link to="/reports" className="underline">
            Open reports (period is not applied automatically)
          </Link>
        )}
        {answer.topic === "stock" && entitled("catalogue") && (
          <Link to="/products" className="underline">
            Open current products
          </Link>
        )}
        {answer.topic === "appointments" && entitled("appointments") && (
          <Link to="/appointments" className="underline">
            Open appointments (period is not applied automatically)
          </Link>
        )}
      </div>
    </article>
  );
}
