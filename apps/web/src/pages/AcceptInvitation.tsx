import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { acceptOwnerInvitationSchema } from "@glampro_suite/shared";

export default function AcceptInvitation() {
  // Read the fragment once; do not persist it or put it in API URLs.
  const [token] = useState(() => window.location.hash.slice(1));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
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
    <main className="mx-auto max-w-md p-8">
      <h1 className="mb-4 text-2xl font-bold">Set up your owner account</h1>
      {done ? (
        <>
          <p>Your password is set. Sign in to verify your email and access your company.</p>
          <Link to="/login">Go to sign in</Link>
        </>
      ) : (
        <>
          <p>
            Choose a strong password. Your invitation expires after 48 hours and can be used once.
          </p>
          {error && <p role="alert">{error}</p>}
          {!token ? (
            <p role="alert">Invitation link is missing. Ask your provider to resend it.</p>
          ) : (
            <form onSubmit={(event) => void submit(event)} className="mt-6 grid gap-4">
              <label>
                New password
                <input
                  className="block w-full rounded border p-3"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={72}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label>
                Confirm password
                <input
                  className="block w-full rounded border p-3"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />
              </label>
              <button
                className="rounded bg-purple-800 p-3 text-white"
                disabled={busy}
                type="submit"
              >
                {busy ? "Setting up…" : "Set password"}
              </button>
            </form>
          )}
        </>
      )}
    </main>
  );
}
