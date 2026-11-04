/**
 * The operator's own account — `/platform/account`.
 *
 * Kept off the company screens on purpose: nothing here touches a tenant, and an
 * operator changing their password should not be standing next to a company's
 * delete button. In the old console this was a panel that opened *inside* the
 * company list; it is now a route, so it can be linked to, reloaded, and left
 * with the browser's Back button.
 *
 * Every state comes from the server. The email-verification switch shows
 * `admin.twoFactorEnabled` — not a local copy — because the server is the only
 * thing that knows whether a code was confirmed. Turning it **on** sends a code
 * first: if mail delivery is broken, the operator must not be able to lock
 * themselves out of the console by trusting a switch that never worked.
 */
import { useState, type FormEvent } from "react";
import { platformPasswordChangeSchema, type PlatformAdminProfile } from "@glampro_suite/shared";

import { Check, Mail } from "@/components/icons";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Switch from "@/components/ui/Switch";
import { cn, getInitials } from "@/lib/utils";
import { platformApi } from "./api";

/** The three promises `adminPasswordSchema` actually makes — no more, no less. */
const COMMON_DEFAULTS = new Set(["admin12345", "password12345", "changeme12345"]);

export default function Account({
  admin,
  onChange,
}: {
  admin: PlatformAdminProfile;
  onChange: (admin: PlatformAdminProfile) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  /** Which way the email-verification modal is asking. */
  const [twoFactor, setTwoFactor] = useState<"enable" | "disable" | null>(null);
  const [code, setCode] = useState("");
  const [modalPassword, setModalPassword] = useState("");
  const [modalError, setModalError] = useState("");

  async function perform(action: () => Promise<string>, onError?: (message: string) => void) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setNotice(await action());
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Account request failed.";
      // One place or the other: an alert behind the modal is not an alert.
      if (onError) onError(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  }

  function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform(async () => {
      if (newPassword !== confirmPassword) throw new Error("The two new passwords do not match.");
      const input = platformPasswordChangeSchema.safeParse({ currentPassword, newPassword });
      if (!input.success) throw new Error(input.error.issues[0].message);
      const result = await platformApi.changePassword(input.data);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      return result.revokedSessions
        ? `Password updated. ${result.revokedSessions} other ${
            result.revokedSessions === 1 ? "session was" : "sessions were"
          } signed out.`
        : "Password updated. No other sessions were open.";
    });
  }

  /** Opening the enable modal sends the code; confirming is a separate press. */
  async function startEnrollment() {
    setTwoFactor("enable");
    setCode("");
    setModalError("");
    await perform(async () => {
      await platformApi.enrollTwoFactor();
      return `We emailed a six-digit code to ${admin.email}.`;
    }, setModalError);
  }

  async function confirmEnrollment() {
    await perform(async () => {
      onChange(await platformApi.confirmTwoFactor(code));
      setTwoFactor(null);
      setCode("");
      return "Email verification is on. Sign-in now asks for a code.";
    }, setModalError);
  }

  async function disable() {
    await perform(async () => {
      onChange(await platformApi.disableTwoFactor({ currentPassword: modalPassword }));
      setTwoFactor(null);
      setModalPassword("");
      return "Email verification is off. Sign-in uses only your password.";
    }, setModalError);
  }

  const requirements = [
    { label: "At least 12 characters", met: newPassword.length >= 12 },
    {
      label: "Not a demo or common default password",
      met: newPassword.length > 0 && !COMMON_DEFAULTS.has(newPassword.toLowerCase()),
    },
    {
      label: "Both new passwords match",
      met: confirmPassword.length > 0 && newPassword === confirmPassword,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
          Operator account
        </p>
        <h1 className="text-2xl">Account &amp; security</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Your sign-in, your password and your second factor. Nothing here touches a company.
        </p>
      </header>

      {error ? (
        <p role="alert" className="rounded-md bg-danger/5 px-3 py-2.5 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded-md bg-success-soft px-3 py-2.5 text-sm text-success-text"
        >
          {notice}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Signed in as" className="lg:col-span-1">
          <div className="flex flex-col items-start gap-3 px-2 pt-2 pb-1">
            <span
              aria-hidden
              className="flex size-12 items-center justify-center rounded-pill bg-purple-soft text-sm font-bold text-purple"
            >
              {getInitials(admin.name)}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{admin.name}</p>
              <p className="text-sm break-words text-ink-muted">{admin.email}</p>
            </div>
            <Badge variant={admin.twoFactorEnabled ? "success" : "neutral"} dot>
              {admin.twoFactorEnabled ? "Email verification on" : "Password only"}
            </Badge>
            <p className="text-xs text-ink-muted">
              Sessions are not saved across page reloads, and signing out revokes this one on the
              server.
            </p>
          </div>
        </Card>

        <Card
          title="Change password"
          description="Your other sessions are signed out when this succeeds."
          className="lg:col-span-2"
        >
          <form className="flex flex-col gap-3 px-2 pt-2 pb-1" onSubmit={changePassword}>
            <Input
              label="Current password"
              type="password"
              autoComplete="current-password"
              maxLength={200}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              disabled={busy}
              required
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="New password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={200}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                disabled={busy}
                required
              />
              <Input
                label="Confirm new password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={200}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={busy}
                required
              />
            </div>

            {/* The rules the server actually enforces, shown while typing — the
                old form stated a length and left the rest to a rejection. */}
            <ul aria-label="Password requirements" className="flex flex-col gap-1 pt-1">
              {requirements.map((requirement) => (
                <li
                  key={requirement.label}
                  className={cn(
                    "flex items-center gap-2 text-xs",
                    requirement.met ? "text-success-text" : "text-ink-muted",
                  )}
                >
                  <Check aria-hidden className="size-3.5 shrink-0" />
                  {requirement.label}
                  <span className="sr-only">{requirement.met ? " — met" : " — not met yet"}</span>
                </li>
              ))}
            </ul>

            <div>
              <Button type="submit" loading={busy}>
                Update password
              </Button>
            </div>
          </form>
        </Card>
      </div>

      <Card
        title="Email verification"
        description="A second factor on sign-in, sent to your administrator email."
      >
        <div className="px-2 pt-2 pb-1">
          <Switch
            label="Email verification"
            checked={admin.twoFactorEnabled}
            loading={busy}
            onChange={(next) => {
              if (next) void startEnrollment();
              else {
                setTwoFactor("disable");
                setModalPassword("");
                setModalError("");
              }
            }}
            description={
              admin.twoFactorEnabled
                ? "On. Sign-in asks for a six-digit code sent to your email."
                : "Off. Sign-in uses only your password."
            }
          />
          <p className="mt-3 flex items-start gap-2 text-xs text-ink-muted">
            <Mail aria-hidden className="mt-0.5 shrink-0" />
            Turning this on needs an email code first, so a broken mail server cannot lock you out
            of the console.
          </p>
        </div>
      </Card>

      {/* Enabling is a two-step the operator can see: the code is requested when
          the modal opens, and nothing flips until the server accepts it. */}
      <Modal
        open={twoFactor === "enable"}
        onClose={() => setTwoFactor(null)}
        size="sm"
        title="Turn on email verification"
        description={`We send a six-digit code to ${admin.email}. Sign-in will ask for it from then on.`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setTwoFactor(null)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              disabled={code.length !== 6}
              onClick={() => void confirmEnrollment()}
            >
              Confirm email verification
            </Button>
          </div>
        }
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void confirmEnrollment();
          }}
        >
          {modalError ? (
            <p role="alert" className="rounded-md bg-danger/5 px-3 py-2.5 text-sm text-danger">
              {modalError}
            </p>
          ) : null}
          <Input
            label="Verification code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            disabled={busy}
            hint="Codes expire after ten minutes."
            required
          />
        </form>
      </Modal>

      {/* Turning it off re-proves the password that guards it. */}
      <Modal
        open={twoFactor === "disable"}
        onClose={() => setTwoFactor(null)}
        size="sm"
        title="Turn off email verification"
        description="Sign-in will use only your password until you turn this back on."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setTwoFactor(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={modalPassword.length === 0}
              onClick={() => void disable()}
            >
              Turn off email verification
            </Button>
          </div>
        }
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void disable();
          }}
        >
          {modalError ? (
            <p role="alert" className="rounded-md bg-danger/5 px-3 py-2.5 text-sm text-danger">
              {modalError}
            </p>
          ) : null}
          <Input
            label="Your password"
            type="password"
            autoComplete="current-password"
            maxLength={200}
            value={modalPassword}
            onChange={(event) => setModalPassword(event.target.value)}
            disabled={busy}
            required
          />
        </form>
      </Modal>
    </div>
  );
}
