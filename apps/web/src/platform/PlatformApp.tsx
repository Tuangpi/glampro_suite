import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router";
import type { PlatformAdminProfile } from "@glampro_suite/shared";
import { platformApi } from "./api";
import Companies from "./Companies";
import "./style.css";

export default function PlatformApp() {
  const { pathname } = useLocation();
  const [admin, setAdmin] = useState<PlatformAdminProfile | null>(null);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (challenge) {
        setAdmin(await platformApi.verify({ challenge, code }));
        setChallenge(null);
        setCode("");
      } else {
        const result = await platformApi.login({ email, password });
        setChallenge(result.challenge);
        setPassword("");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function sessionAction(action: "check" | "logout") {
    setBusy(true);
    setError("");
    try {
      if (action === "logout") {
        await platformApi.logout();
        setAdmin(null);
      } else setAdmin(await platformApi.profile());
    } catch (cause) {
      // Retain local state on logout failure so the operator can retry server
      // revocation. Do not claim a failed network request ended the session.
      setError(cause instanceof Error ? cause.message : "Session request failed.");
    } finally {
      setBusy(false);
    }
  }

  const destination = admin ? "/platform" : "/platform/login";
  if (pathname !== destination) return <Navigate to={destination} replace />;

  return (
    <div className={`platform-portal ${admin ? "platform-workspace" : "platform-auth"}`}>
      <main>
        <header className="portal-header">
          <div className="brand-group">
            <span className="brand-mark" aria-hidden="true">
              G
            </span>
            <div>
              <span className="brand">Glampro Suite</span>
              <span className="brand-caption">Platform administration</span>
            </div>
          </div>
          {admin && (
            <div className="operator-menu">
              <div className="operator-identity">
                <strong>{admin.name}</strong>
                <span>{admin.email}</span>
              </div>
              <button
                className="button-secondary"
                disabled={busy}
                onClick={() => void sessionAction("check")}
              >
                Check session
              </button>
              <button
                className="button-secondary"
                disabled={busy}
                onClick={() => void sessionAction("logout")}
              >
                Sign out
              </button>
            </div>
          )}
        </header>
        {error && <p role="alert">{error}</p>}
        {admin ? (
          <section className="workspace-content">
            <p className="workspace-greeting">Welcome, {admin.name}</p>
            <Companies />
          </section>
        ) : (
          <section>
            <h1>{challenge ? "Verify your identity" : "Operator sign in"}</h1>
            <p>
              {challenge
                ? "Enter the six-digit code sent to your administrator email."
                : "For Glampro platform administrators only. Company accounts use the salon portal."}
            </p>
            <form onSubmit={(event) => void submit(event)}>
              {challenge ? (
                <label>
                  Verification code
                  <input
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                  />
                </label>
              ) : (
                <>
                  <label>
                    Email
                    <input
                      type="email"
                      autoComplete="username"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      maxLength={200}
                      required
                    />
                  </label>
                </>
              )}
              <button type="submit" disabled={busy}>
                {busy ? "Please wait…" : challenge ? "Verify and sign in" : "Continue"}
              </button>
              {challenge && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setChallenge(null);
                    setCode("");
                    setError("");
                  }}
                >
                  Back to sign in
                </button>
              )}
            </form>
            <p className="note">
              Email verification is required. Sessions are not saved across page reloads.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
