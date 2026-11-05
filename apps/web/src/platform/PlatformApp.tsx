/**
 * The platform console's route table and session.
 *
 * Until now this component faked routing: it read `useLocation`, compared it to
 * the one path it could draw, and `Navigate`d whenever the two disagreed — so
 * `/platform/companies/:id` was a URL you could not have, and a company's delete
 * button lived one scroll away from the operator's own password form. It is now
 * what it looks like: `/platform` is the directory, `/platform/companies/new` and
 * `/platform/companies/:id` are pages, and `/platform/account` is where the
 * operator's password and second factor live, on their own screen.
 *
 * The session is state here, and one token in the tab's `sessionStorage`: the console
 * exchanges that token for a fresh session on the first render, so a reload lands back
 * where the operator was instead of asking for a password and a second factor again.
 * `docs/platform-console.md` states what is kept and what is not — the access token is
 * never written, closing the tab ends the session, and a new tab starts signed out.
 *
 * While that exchange is in flight nothing else renders: showing the sign-in form
 * first would flash a password prompt at an operator who is already signed in.
 *
 * An unknown path under `/platform` falls back to the directory rather than a
 * blank screen, and an unauthenticated one goes to the sign-in page, carrying
 * nothing with it.
 */
import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import type { PlatformAdminProfile } from "@glampro_suite/shared";

import { platformApi } from "./api";
import Account from "./Account";
import CompaniesPage from "./CompaniesPage";
import CompanyDetailPage from "./CompanyDetailPage";
import CreateCompanyPage from "./CreateCompanyPage";
import PlatformLogin from "./PlatformLogin";
import PlatformShell from "./PlatformShell";

export default function PlatformApp() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [admin, setAdmin] = useState<PlatformAdminProfile | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // One exchange per mount: the tab's kept refresh token, if it has one.
  useEffect(() => {
    let live = true;
    void platformApi
      .restore()
      .then((resumed) => {
        if (!live) return;
        if (resumed.admin) setAdmin(resumed.admin);
        setNotice(resumed.error ?? "");
        setRestoring(false);
      })
      .catch(() => {
        if (live) setRestoring(false);
      });
    return () => {
      live = false;
    };
  }, []);

  function signedIn(next: PlatformAdminProfile) {
    setAdmin(next);
    setNotice("");
    setError("");
    navigate("/platform", { replace: true });
  }

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      await platformApi.logout();
      setAdmin(null);
      setNotice("");
      navigate("/platform/login", { replace: true });
    } catch (cause) {
      // Retain local state on logout failure so the operator can retry server
      // revocation. Do not claim a failed network request ended the session.
      setError(cause instanceof Error ? cause.message : "Session request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (restoring) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-6">
        <p role="status" className="text-sm text-ink-muted">
          Restoring your session…
        </p>
      </div>
    );
  }

  if (!admin) {
    if (pathname !== "/platform/login") return <Navigate to="/platform/login" replace />;
    return <PlatformLogin notice={notice} onSignedIn={signedIn} />;
  }

  return (
    <PlatformShell
      name={admin.name}
      email={admin.email}
      busy={busy}
      onSignOut={() => void signOut()}
    >
      {error ? (
        <p role="alert" className="mb-4 rounded-md bg-danger/5 px-3 py-2.5 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Routes>
        <Route index element={<CompaniesPage />} />
        <Route path="companies/new" element={<CreateCompanyPage />} />
        <Route path="companies/:id" element={<CompanyDetailPage />} />
        <Route path="account" element={<Account admin={admin} onChange={setAdmin} />} />
        <Route path="*" element={<Navigate to="/platform" replace />} />
      </Routes>
    </PlatformShell>
  );
}
