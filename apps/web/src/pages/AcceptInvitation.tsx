import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { acceptOwnerInvitationSchema } from "@glampro_suite/shared";
import { ArrowRight, CheckCircle, Eye } from "@/components/icons";
import BrandMark from "@/components/ui/BrandMark";
import Button from "@/components/ui/Button";
import Field, { CONTROL_CLASS } from "@/components/ui/Field";
import IconButton from "@/components/ui/IconButton";
import { cn } from "@/lib/utils";

export default function AcceptInvitation() {
  // Read the fragment once; do not persist it or put it in API URLs.
  const [token] = useState(() => window.location.hash.slice(1));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    const input = acceptOwnerInvitationSchema.safeParse({ token, password });
    if (!input.success) {
      setError(input.error.issues[0].message);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/owner-invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.data),
        credentials: "omit",
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Unable to accept invitation.");
      setDone(true);
      setPassword("");
      setConfirm("");
      window.history.replaceState(null, "", window.location.pathname);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to accept invitation.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-2 px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-12 text-lg" />
          <p className="font-heavy text-lg text-ink">Glampro Suite</p>
        </div>
        <div className="rounded-card border border-line bg-surface p-6 sm:p-8">
          {done ? (
            <section aria-labelledby="invitation-success-heading" className="text-center">
              <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
                <CheckCircle className="size-7" aria-hidden />
              </div>
              <h1 id="invitation-success-heading" className="text-xl">
                Your account is ready
              </h1>
              <p role="status" className="mt-3 text-sm text-ink-muted">
                Your password has been set. Sign in with your email and new password to continue.
              </p>
              <Link
                to="/login"
                className="mt-6 inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-md bg-purple px-6 py-3 font-bold text-white shadow-purple-btn transition-colors hover:bg-purple-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple"
              >
                Continue to sign in
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <p className="mt-4 text-xs text-ink-muted">
                Sign in to verify your email and access your company.
              </p>
            </section>
          ) : (
            <>
              <h1 className="mb-3 text-xl">Set up your owner account</h1>
              <p className="text-sm text-ink-muted">
                Choose a strong password. Your invitation expires after 48 hours and can be used
                once.
              </p>
              {error && (
                <p role="alert" className="mt-4 text-sm text-danger">
                  {error}
                </p>
              )}
              {!token ? (
                <p role="alert" className="mt-4 text-sm text-danger">
                  Invitation link is missing. Ask your provider to resend it.
                </p>
              ) : (
                <form onSubmit={(event) => void submit(event)} className="mt-6 grid gap-4">
                  <Field label="New password" hint="At least 12 characters.">
                    {({ controlId, describedBy }) => (
                      <div className="relative">
                        <input
                          id={controlId}
                          className={cn(CONTROL_CLASS, "h-control px-3 pr-12")}
                          type={showPassword ? "text" : "password"}
                          autoComplete="new-password"
                          placeholder="Please enter your new password"
                          minLength={12}
                          maxLength={72}
                          required
                          aria-describedby={describedBy}
                          disabled={busy}
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                        />
                        <IconButton
                          label={showPassword ? "Hide new password" : "Show new password"}
                          icon={<Eye />}
                          className="absolute inset-y-0 right-0"
                          aria-controls={controlId}
                          onClick={() => setShowPassword((current) => !current)}
                          disabled={busy}
                        />
                      </div>
                    )}
                  </Field>
                  <Field label="Confirm password">
                    {({ controlId }) => (
                      <div className="relative">
                        <input
                          id={controlId}
                          className={cn(CONTROL_CLASS, "h-control px-3 pr-12")}
                          type={showConfirm ? "text" : "password"}
                          autoComplete="new-password"
                          placeholder="Please enter your new password again"
                          required
                          disabled={busy}
                          value={confirm}
                          onChange={(event) => setConfirm(event.target.value)}
                        />
                        <IconButton
                          label={showConfirm ? "Hide confirm password" : "Show confirm password"}
                          icon={<Eye />}
                          className="absolute inset-y-0 right-0"
                          aria-controls={controlId}
                          onClick={() => setShowConfirm((current) => !current)}
                          disabled={busy}
                        />
                      </div>
                    )}
                  </Field>
                  <Button size="lg" loading={busy} type="submit">
                    {busy ? "Setting up…" : "Set password"}
                  </Button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
