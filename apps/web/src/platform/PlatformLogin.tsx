/**
 * Operator sign-in — the platform console's front door.
 *
 * Same two-column shape as the salon's `Login`: an `aria-hidden` navy panel in
 * `--sp-navy` above `lg`, the form on the right, and the brand mark drawn by the
 * form itself below `lg` so the screen still says whose it is at every width.
 * It is a separate page rather than a component of the shell because it is a
 * separate audience — it is the only thing here that should be reachable before
 * an operator is known.
 *
 * Email verification is decided by the server, not by this form: `login` either
 * answers with a session or with a challenge, and only `verify` turns that
 * challenge into one. Nothing is claimed to have been emailed before the server
 * says so, and a failed request keeps the typed values so the operator can
 * correct a typo instead of typing it all again.
 */
import { useState, type FormEvent } from "react";

import { Briefcase, CheckCircle, Lock } from "@/components/icons";
import BrandMark from "@/components/ui/BrandMark";
import Button from "@/components/ui/Button";
import Field, { CONTROL_CLASS } from "@/components/ui/Field";
import IconButton from "@/components/ui/IconButton";
import Input from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import type { PlatformAdminProfile } from "@glampro_suite/shared";
import { platformApi } from "./api";

const HIGHLIGHTS = [
  { icon: Briefcase, label: "Onboard a salon and invite its owner" },
  { icon: CheckCircle, label: "Change plans, modules and company access" },
  { icon: Lock, label: "Operator access stays separate from every salon" },
] as const;

export default function PlatformLogin({
  onSignedIn,
}: {
  onSignedIn: (admin: PlatformAdminProfile) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (challenge) {
        const admin = await platformApi.verify({ challenge, code });
        setChallenge(null);
        setCode("");
        onSignedIn(admin);
      } else {
        const result = await platformApi.login({ email, password });
        setPassword("");
        // Verification off: the password check already issued the session.
        if ("admin" in result) {
          setChallenge(null);
          onSignedIn(result.admin);
        } else setChallenge(result.challenge);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg lg:flex-row">
      <aside
        aria-hidden
        className="relative hidden w-[var(--app-auth-panel-w)] shrink-0 flex-col justify-between overflow-hidden bg-navy p-10 lg:flex xl:p-14"
      >
        <div className="pointer-events-none absolute -top-24 -right-20 size-72 rounded-full bg-gradient-to-br from-[var(--sp-purple-grad-a)] to-[var(--sp-purple-grad-b)] opacity-25 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <BrandMark className="size-12 text-lg" />
          <div>
            <p className="font-heavy text-lg text-white">Glampro</p>
            <p className="text-xs text-ink-on-dark">Platform administration</p>
          </div>
        </div>

        <div className="relative">
          <p className="text-2xl font-heavy text-white">The console behind every salon.</p>
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

        <p className="relative text-xs text-ink-on-dark">
          Operator access is separate from every company account.
        </p>
      </aside>

      <main className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            {/* The panel carries the mark above `lg`; below it the form does. */}
            <BrandMark className="size-12 text-lg lg:hidden" />
            <div>
              <h1 className="text-xl">Operator sign in</h1>
              <p className="mt-1 text-sm text-ink-muted">
                {challenge
                  ? "Enter the six-digit code sent to your administrator email."
                  : "For Glampro platform administrators only. Company accounts use the salon portal."}
              </p>
            </div>
          </div>

          <div className="rounded-card border border-line bg-surface p-6">
            <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
              {error ? (
                <p role="alert" className="rounded-md bg-danger/5 px-3 py-2.5 text-sm text-danger">
                  {error}
                </p>
              ) : null}

              {challenge ? (
                <>
                  <Input
                    label="Verification code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    disabled={busy}
                    required
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setChallenge(null);
                      setCode("");
                      setError("");
                    }}
                  >
                    Back to sign in
                  </Button>
                </>
              ) : (
                <>
                  <Input
                    label="Email"
                    type="email"
                    autoComplete="username"
                    placeholder="you@glampro.example"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={busy}
                    required
                  />

                  {/* `Field` + `CONTROL_CLASS` exactly as `Input` composes them,
                      so the reveal button can dock inside the control. */}
                  <Field label="Password">
                    {({ controlId }) => (
                      <div className="relative">
                        <input
                          id={controlId}
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          disabled={busy}
                          maxLength={200}
                          className={cn(CONTROL_CLASS, "h-control px-3 pr-12")}
                          required
                        />
                        <IconButton
                          label={showPassword ? "Hide password" : "Show password"}
                          icon={<Lock />}
                          className="absolute inset-y-0 right-0"
                          disabled={busy}
                          onClick={() => setShowPassword((current) => !current)}
                        />
                      </div>
                    )}
                  </Field>
                </>
              )}

              <Button type="submit" size="lg" loading={busy} className="mt-1 w-full">
                {busy ? "Please wait…" : challenge ? "Verify and sign in" : "Continue"}
              </Button>
            </form>
          </div>

          <p className="mt-5 text-center text-xs text-ink-faint">
            {challenge
              ? "Codes expire after ten minutes. Sessions are not saved across page reloads."
              : "Sign-in may also ask for a six-digit email code. Sessions are not saved across page reloads."}
          </p>
        </div>
      </main>
    </div>
  );
}
