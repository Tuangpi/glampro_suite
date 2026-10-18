/**
 * Sign in.
 *
 * The one screen the rebuild has no handoff drawing for — `design/handoff/`
 * ships eleven screens and none of them is this one. Its shape is therefore a
 * deliberate invention from the delivered primitives and icons, recorded in
 * [ADR 0008](../../../../PROJECT.md#adr-0008) and closed as Q24
 * in `PROJECT.md#adr-0008`.
 *
 * From `lg` up it is two columns: an `aria-hidden` brand panel in `--sp-navy` and
 * the form. Below that the panel is hidden and the form draws the mark itself,
 * so a tablet loses the decoration and none of the meaning — the heading, the
 * one-line summary and the "Trouble signing in?" line are on every width.
 *
 * What is *not* invented: every colour, radius and spacing is a token — the
 * panel is `--sp-navy`, the handoff's own on-dark text pair and its
 * `--sp-navy-tint-14` chips — the mark is the purple-gradient "G" tile that
 * `AppShell` and `favicon.svg` already draw, the email field is `Input`, and the
 * password field is `Field` + `CONTROL_CLASS`, the same two things `Input`
 * composes, so the reveal button can dock inside the control without `Input`
 * growing a feature no other screen asked for.
 */
import { useState, type ComponentType, type FormEvent, type SVGProps } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { Calendar, Cart, Eye, Package, Users } from "@/components/icons";
import Button from "@/components/ui/Button";
import Field, { CONTROL_CLASS } from "@/components/ui/Field";
import IconButton from "@/components/ui/IconButton";
import Input from "@/components/ui/Input";
import { useAuth } from "@/contexts/AuthContext";
import { getErrorCode, getErrorMessage, getValidationDetails } from "@/lib/api";
import { consumeAuthNotice } from "@/lib/auth-storage";
import { cn } from "@/lib/utils";

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Read and clear the notice the 401 handler left, so a redirect explains
  // itself instead of dropping the user on a blank form.
  const [authNotice] = useState(() => consumeAuthNotice());

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [isSuspended, setIsSuspended] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Reveal, not a second field: the value is the same state either way, so
  // toggling cannot lose what was typed.
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setIsSuspended(false);
    setFieldErrors({});
    setSubmitting(true);

    try {
      await signIn(email, password);
      navigate(safeNext(searchParams.get("next")), { replace: true });
    } catch (error) {
      const details = getValidationDetails(error);
      setFieldErrors({
        ...(details.email ? { email: details.email } : {}),
        ...(details.password ? { password: details.password } : {}),
      });

      const code = getErrorCode(error);
      setNotice(messageFor(code, getErrorMessage(error)));
      setIsSuspended(code === "TENANT_SUSPENDED");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Branding only, so it is `aria-hidden` and the form's `h1` stays the
          page's one heading. Below `lg` it is hidden and the form draws the
          mark itself. */}
      <aside
        aria-hidden
        className="relative hidden w-[var(--app-auth-panel-w)] shrink-0 flex-col justify-between overflow-hidden bg-navy p-10 lg:flex xl:p-14"
      >
        {/* A wash of the brand gradient behind the copy — two existing tokens
            and an opacity, which is why it needs no new colour. */}
        <div className="pointer-events-none absolute -top-24 -right-20 size-72 rounded-full bg-gradient-to-br from-[var(--sp-purple-grad-a)] to-[var(--sp-purple-grad-b)] opacity-25 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <BrandMark className="size-12 text-lg" />
          <div>
            <p className="font-heavy text-lg text-white">Glampro</p>
            <p className="text-xs text-ink-on-dark">Salon management</p>
          </div>
        </div>

        <div className="relative">
          <p className="text-2xl font-heavy text-white">Run the whole salon from one screen.</p>

          {/* Each line names something the app already does, on one of the
              handoff's own icons, so the panel cannot overpromise. */}
          <ul className="mt-8 flex flex-col gap-4">
            {HIGHLIGHTS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--sp-navy-tint-14)] text-ink-on-dark-accent">
                  <Icon className="size-4.5" aria-hidden />
                </span>
                <span className="text-sm text-ink-on-dark">{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            {/* The panel carries the mark above `lg`; below it the form does, so
                the screen says whose it is at every width. */}
            <BrandMark className="size-12 text-lg lg:hidden" />
            <div>
              <h1 className="text-xl">Sign in to Glampro Suite</h1>
              <p className="mt-1 text-sm text-ink-muted">
                Point of sale, appointments, customers, stock and reporting.
              </p>
            </div>
          </div>

          {/* The Dashboard/Settings section recipe. `Card` is deliberately not
              used here: its body padding is sized for a table, and it would
              crowd the first control of a form. */}
          <div className="rounded-card border border-line bg-surface p-6">
            <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
              {authNotice ? <Notice tone="info">{authNotice}</Notice> : null}
              {notice ? <Notice tone={isSuspended ? "read-only" : "error"}>{notice}</Notice> : null}

              <Input
                label="Email"
                type="email"
                name="email"
                autoComplete="username"
                placeholder="you@salon.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                error={fieldErrors.email}
                disabled={submitting}
                required
              />

              {/* Hand-composed rather than `Input`, because the control needs a
                  button inside it. `Field` + `CONTROL_CLASS` is exactly what
                  `Input` renders, so the label, error and `aria-describedby`
                  wiring is identical and no other screen's DOM moves. */}
              <Field label="Password" error={fieldErrors.password}>
                {({ controlId, describedBy }) => (
                  <div className="relative">
                    <input
                      id={controlId}
                      type={showPassword ? "text" : "password"}
                      name="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={submitting}
                      aria-invalid={fieldErrors.password ? true : undefined}
                      aria-describedby={describedBy}
                      className={cn(CONTROL_CLASS, "h-control px-3 pr-12")}
                      required
                    />
                    {/* Docked inside the control, at the handoff's 44px minimum
                        tap target, so the form stays one column wide. */}
                    <IconButton
                      label={showPassword ? "Hide password" : "Show password"}
                      icon={<Eye />}
                      className="absolute inset-y-0 right-0"
                      onClick={() => setShowPassword((current) => !current)}
                      disabled={submitting}
                    />
                  </div>
                )}
              </Field>

              <Button type="submit" size="lg" loading={submitting} className="mt-1 w-full">
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </div>

          <p className="mt-5 text-center text-xs text-ink-faint">
            Trouble signing in? Contact the person who manages your salon&rsquo;s subscription.
          </p>
        </div>
      </main>
    </div>
  );
}

/**
 * The brand mark: the purple-gradient "G" that `AppShell`'s rail and
 * `favicon.svg` already draw.
 *
 * It replaced the ported `Lock` glyph this screen used to show. `Lock` itself is
 * untouched and still exported — the handoff's 41-icon port is one-for-one
 * (PROJECT.md#design-4) — it is simply no longer this page's subject: a
 * purple "G" reads as *this* product, a padlock reads as any sign-in form.
 */
function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[var(--sp-purple-grad-a)] to-[var(--sp-purple-grad-b)] font-heavy text-white shadow-purple-btn",
        className,
      )}
    >
      G
    </span>
  );
}

/**
 * What the panel claims, one ported icon each. Typed as `ComponentType` so the
 * entries are interchangeable and a fifth cannot arrive in a shape the list
 * cannot render.
 */
const HIGHLIGHTS: ReadonlyArray<{
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
}> = [
  { icon: Cart, label: "Ring up a sale in a few taps" },
  { icon: Calendar, label: "Book and move appointments" },
  { icon: Users, label: "Customers, with their member prices" },
  { icon: Package, label: "Stock, and what is running low" },
];

type NoticeTone = "info" | "error" | "read-only";

/**
 * `read-only` is deliberately purple rather than amber, and that is a recorded
 * choice rather than a constraint. Amber had no token when this screen was
 * written — that was Q23 — and Q23 has since closed:
 * [ADR 0009](../../../../PROJECT.md#adr-0009)
 * added `--sp-amber-bg` / `--sp-amber-text` from the handoff's own CSS. So this
 * banner *can* move; it has not been moved, because purple is distinguishable
 * from both neutral and red and a suspended salon is not an error state.
 */
const NOTICE_CLASS: Record<NoticeTone, string> = {
  info: "bg-surface-2 text-ink-body",
  error: "bg-danger/5 text-danger",
  "read-only": "bg-purple-soft text-purple",
};

function Notice({ tone, children }: { tone: NoticeTone; children: React.ReactNode }) {
  return (
    <p role="status" className={`rounded-md px-3 py-2.5 text-sm ${NOTICE_CLASS[tone]}`}>
      {children}
    </p>
  );
}

/**
 * The salon is closed to this account, so signing in again will not help.
 * `roadmap.md` asks for the distinction to be visible rather than a generic
 * failure.
 */
const LOCKOUT_CODES = new Set(["TENANT_EXPIRED", "TENANT_CANCELLED", "TENANT_NOT_FOUND"]);

function messageFor(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  if (code === "INVALID_CREDENTIALS") return "That email and password combination is not right.";
  if (LOCKOUT_CODES.has(code)) return `${fallback} This account cannot sign in.`;
  if (code === "TENANT_SUSPENDED") {
    return `${fallback} You can sign in, but changes are disabled while the subscription is suspended.`;
  }
  if (code === "RATE_LIMITED") return "Too many attempts. Please wait 15 minutes and try again.";
  return fallback;
}

/**
 * `?next=` is attacker-controllable, so it is accepted only as a same-origin
 * absolute path. `//evil.example` and `https://evil.example` are both rejected;
 * without this the login screen is an open redirect.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}
