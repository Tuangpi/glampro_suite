import { useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import { useAuth } from "@/contexts/AuthContext";
import { getErrorMessage, post } from "@/lib/api";

/** Enabling is harmless to repeat; owners are enrolled during verified login. */
export default function TwoFactorCard() {
  const { user } = useAuth();
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");

  async function submit() {
    setPending(true);
    setMessage("");
    try {
      if (!sent) {
        await post("/auth/two-factor/enable", {});
        setSent(true);
        setMessage("Check your email for a six-digit verification code.");
      } else {
        await post("/auth/two-factor/confirm", { code });
        setSent(false);
        setCode("");
        setMessage("Two-factor authentication is enabled. Future sign-ins require an email code.");
      }
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card title="Account security">
      <p className="text-sm text-ink-muted">
        {user?.globalRole === "SUPER_ADMIN"
          ? "Owners must verify an email code when signing in. Two-factor authentication cannot be disabled."
          : "Protect your account by requiring an email code when signing in."}
      </p>
      {user?.globalRole !== "SUPER_ADMIN" ? (
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {sent ? (
            <Input
              label="Enrollment verification code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              required
              disabled={pending}
            />
          ) : null}
          <Button type="submit" loading={pending}>
            {sent ? "Confirm two-factor authentication" : "Enable two-factor authentication"}
          </Button>
          {sent ? (
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                setSent(false);
                setCode("");
                setMessage("");
              }}
            >
              Start again
            </Button>
          ) : null}
        </form>
      ) : null}
      {message ? (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      ) : null}
    </Card>
  );
}
