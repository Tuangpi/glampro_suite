/**
 * Account security — this person's second factor (Settings → Privacy & security).
 *
 * Two questions, two sources. Whether *this account* has a second factor is
 * `user.twoFactorEnabled` from `GET /auth/me`; whether the salon makes it
 * mandatory is `requireStaffTwoFactor` from `GET /settings/profile`. The card asks
 * both because the answers are independent: a staff member of a salon that requires
 * 2FA must not be shown a switch they could flip off, while an owner is outside that
 * policy altogether — their switch is live, and the sentence attached to it says what
 * turning it off costs, which is the payroll and prepaid writes that re-check the
 * flag at the point of use.
 *
 * Turning it on is an exchange, not a flip — a code is mailed and then answered —
 * so the modal opens immediately with sending feedback. The switch stays off
 * until the code is confirmed; sending an email alone does not enable security.
 *
 * `refreshProfile()` after each change keeps the switch honest: the state it draws
 * comes from the session, so the session is re-read rather than a local copy being
 * trusted.
 */
import { useEffect, useRef, useState } from "react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Switch from "@/components/ui/Switch";
import { showToast } from "@/components/ui/toast-store";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonProfile } from "@/hooks/useSettings";
import { getErrorMessage, post } from "@/lib/api";

/** Which dialog, if any, is open. One piece of state so two cannot both be. */
type Step = "idle" | "enroll" | "disable";

export default function TwoFactorCard({ onReturnToPayPlans }: { onReturnToPayPlans?: () => void }) {
  const { user, refreshProfile } = useAuth();
  const salon = useSalonProfile();
  const [step, setStep] = useState<Step>("idle");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const sendInFlight = useRef(false);
  const enrollmentAttempt = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      enrollmentAttempt.current += 1;
    };
  }, []);

  const isOwner = user?.globalRole === "SUPER_ADMIN";
  const enrolled = user?.twoFactorEnabled === true;
  const required = salon.data?.requireStaffTwoFactor === true;
  /** Whether the salon's policy reaches *this* account. It never reaches the owner. */
  const requiredHere = required && !isOwner;

  function resetDialog() {
    enrollmentAttempt.current += 1;
    setStep("idle");
    setCode("");
    setError("");
    setCodeSent(false);
  }

  function close() {
    // Sending can be dismissed; a submitted security change must finish first.
    if (pending && !sending) return;
    resetDialog();
  }

  /** Open immediately; late send responses must not reopen a dismissed dialog. */
  async function beginEnrollment() {
    if (sendInFlight.current || pending) return;
    sendInFlight.current = true;
    const attempt = ++enrollmentAttempt.current;
    setStep("enroll");
    setError("");
    setMessage("");
    setCode("");
    setCodeSent(false);
    setSending(true);
    setPending(true);
    try {
      await post("/auth/two-factor/enable", {});
      if (!mounted.current || attempt !== enrollmentAttempt.current) return;
      setCodeSent(true);
      showToast("success", "Verification code sent. Check your email.");
    } catch (cause) {
      if (!mounted.current || attempt !== enrollmentAttempt.current) return;
      setError(getErrorMessage(cause));
    } finally {
      sendInFlight.current = false;
      if (mounted.current) {
        setSending(false);
        setPending(false);
      }
    }
  }

  async function confirmEnrollment(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !codeSent || !/^\d{6}$/.test(code)) return;
    setError("");
    setPending(true);
    try {
      await post("/auth/two-factor/confirm", { code });
      await refreshProfile();
      resetDialog();
      showToast("success", "Email verification is now on.");
      setMessage(
        "Two-factor authentication is on. Future sign-ins need a six-digit code from your email.",
      );
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  async function turnOff() {
    setError("");
    setPending(true);
    try {
      await post("/auth/two-factor/disable", {});
      resetDialog();
      await refreshProfile();
      setMessage("Two-factor authentication is off. Signing in will use your password only.");
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card title="Account security">
      <div className="flex flex-col gap-3">
        <Switch
          label="Email verification code at sign-in"
          description={
            requiredHere
              ? "Your salon requires this for every staff account, so it stays on while the policy is in place."
              : isOwner
                ? "Get a six-digit email code when signing in. Required for pay plans and other protected owner actions."
                : "Ask for a six-digit code sent to your email each time you sign in."
          }
          meta={
            requiredHere ? (
              <Badge variant="warning">Required by your salon</Badge>
            ) : enrolled ? (
              <Badge variant="success" dot>
                On
              </Badge>
            ) : step === "enroll" ? (
              <Badge variant="warning">Setup in progress</Badge>
            ) : null
          }
          checked={enrolled}
          loading={pending}
          // The salon's policy holds the switch on for its staff, and the API
          // refuses that opt-out, so offering the click would only produce an error
          // the screen could have predicted. An owner is not bound by the policy, so
          // their switch stays live — that is the whole point of the setting.
          disabled={enrolled && requiredHere}
          onChange={(next) => {
            if (next) void beginEnrollment();
            else setStep("disable");
          }}
        />

        {enrolled && requiredHere ? (
          <p className="text-xs text-ink-muted">
            The owner can lift the requirement for the whole salon in Staff sign-in policy.
          </p>
        ) : null}

        {salon.isError ? (
          <p className="text-xs text-ink-muted">
            The salon's sign-in policy could not be loaded. Your own setting still applies.
          </p>
        ) : null}

        {error && step === "idle" ? (
          <p role="alert" className="rounded-md bg-danger/5 px-3 py-2.5 text-sm text-danger">
            {error}
          </p>
        ) : null}
        {message ? (
          <p role="status" className="text-sm text-ink-body">
            {message}
          </p>
        ) : null}
        {onReturnToPayPlans && enrolled ? (
          <Button variant="secondary" onClick={onReturnToPayPlans}>
            Back to Pay plans
          </Button>
        ) : null}
      </div>

      <Modal
        open={step === "enroll"}
        onClose={close}
        size="sm"
        title="Turn on email verification"
        description="Verify your email to finish setup. Email verification stays off until your code is confirmed."
      >
        <form className="flex flex-col gap-3" onSubmit={confirmEnrollment}>
          <p role="status" className="text-sm text-ink-muted">
            {sending
              ? "Sending verification code…"
              : codeSent
                ? "Code sent. Check your email and enter the six-digit code below."
                : "A verification code must be sent before you can finish setup."}
          </p>
          {error ? (
            <p role="alert" className="rounded-md bg-danger/5 px-3 py-2.5 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Input
            label="Verification code"
            placeholder="Please enter the code from your email"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            pattern="[0-9]{6}"
            hint="Six digits."
            required
            disabled={pending || !codeSent}
          />
          <Button
            variant="ghost"
            loading={sending}
            disabled={pending}
            onClick={() => void beginEnrollment()}
          >
            {sending ? "Sending code…" : codeSent ? "Resend code" : "Retry sending"}
          </Button>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              type="button"
              disabled={pending && !sending}
              onClick={close}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={pending && !sending}
              disabled={pending || !codeSent || !/^\d{6}$/.test(code)}
            >
              Verify and turn on
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={step === "disable"}
        onClose={close}
        size="sm"
        title="Turn off email verification"
        description={
          isOwner
            ? "Signing in will use only your password until you turn this back on. Screens that move money will keep asking for an owner with a second factor."
            : "Signing in will use only your password until you turn this back on."
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button variant="danger" loading={pending} onClick={() => void turnOff()}>
              Turn off email verification
            </Button>
          </div>
        }
      >
        {error ? (
          <p role="alert" className="rounded-md bg-danger/5 px-3 py-2.5 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </Modal>
    </Card>
  );
}
