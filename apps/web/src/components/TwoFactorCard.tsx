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
 * so it opens a modal. A switch that appeared to succeed before the code was
 * entered would be lying until the mail arrived, which is the one thing a security
 * screen cannot do.
 *
 * `refreshProfile()` after each change keeps the switch honest: the state it draws
 * comes from the session, so the session is re-read rather than a local copy being
 * trusted.
 */
import { useState } from "react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Switch from "@/components/ui/Switch";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonProfile } from "@/hooks/useSettings";
import { getErrorMessage, post } from "@/lib/api";

/** Which dialog, if any, is open. One piece of state so two cannot both be. */
type Step = "idle" | "enroll" | "disable";

export default function TwoFactorCard() {
  const { user, refreshProfile } = useAuth();
  const salon = useSalonProfile();
  const [step, setStep] = useState<Step>("idle");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const isOwner = user?.globalRole === "SUPER_ADMIN";
  const enrolled = user?.twoFactorEnabled === true;
  const required = salon.data?.requireStaffTwoFactor === true;
  /** Whether the salon's policy reaches *this* account. It never reaches the owner. */
  const requiredHere = required && !isOwner;

  function close() {
    setStep("idle");
    setCode("");
    setError("");
  }

  /** Sends the enrollment code; the modal it opens is where it is answered. */
  async function beginEnrollment() {
    setError("");
    setMessage("");
    setCode("");
    setPending(true);
    try {
      await post("/auth/two-factor/enable", {});
      setStep("enroll");
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  async function confirmEnrollment(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      await post("/auth/two-factor/confirm", { code });
      close();
      await refreshProfile();
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
      close();
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
                ? "Owners answer a six-digit code when this is on. With it off you still sign in, but the screens that move money — payroll close, prepaid and package refunds, session transfers, commission rules — keep asking for an owner who has one."
                : "Ask for a six-digit code sent to your email each time you sign in."
          }
          meta={
            requiredHere ? (
              <Badge variant="warning">Required by your salon</Badge>
            ) : enrolled ? (
              <Badge variant="success" dot>
                On
              </Badge>
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
      </div>

      <Modal
        open={step === "enroll"}
        onClose={close}
        size="sm"
        title="Turn on email verification"
        description="We sent a six-digit code to your email address. Enter it to finish turning two-factor authentication on."
      >
        <form className="flex flex-col gap-3" onSubmit={confirmEnrollment}>
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
            hint="Six digits."
            required
            disabled={pending}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
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
