/**
 * Staff sign-in policy — the salon-wide half of "Privacy & security".
 *
 * The owner's decision and only the owner's: `PATCH /settings/security` is guarded
 * by `requireRole("SUPER_ADMIN")`. A manager who can rename the salon still cannot
 * bind their colleagues' sign-in.
 *
 * It is a separate card from `TwoFactorCard` on purpose. One screen, two questions
 * — "does my account ask for a code?" and "does this salon require one of
 * everybody?" — and merging them would put a switch that changes the whole team's
 * sign-in under a heading about "my account".
 *
 * Turning the policy **on** is confirmed in a modal: it changes what every
 * colleague meets at their next sign-in, and nobody can be warned beforehand.
 * Turning it off applies immediately — it removes a requirement, and the person
 * waiting at a sign-in screen is the one who benefits.
 *
 * The switch draws its position from `GET /settings/profile`, and the mutation
 * answers with the same profile, so the control shows what the server stored
 * rather than what was clicked.
 */
import { useState } from "react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Modal from "@/components/ui/Modal";
import Switch from "@/components/ui/Switch";
import { useSalonProfile, useUpdateSalonSecurityPolicy } from "@/hooks/useSettings";
import { getErrorMessage } from "@/lib/api";

export default function StaffSecurityPolicyCard() {
  const salon = useSalonProfile();
  const mutation = useUpdateSalonSecurityPolicy();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const required = salon.data?.requireStaffTwoFactor === true;
  const busy = mutation.isPending;

  async function save(next: boolean) {
    setError("");
    setSaved("");
    try {
      await mutation.mutateAsync({ requireStaffTwoFactor: next });
      setConfirming(false);
      setSaved(
        next
          ? "All staff now answer an email code when they sign in."
          : "Staff no longer need an email code when they sign in.",
      );
    } catch (cause) {
      setError(getErrorMessage(cause));
    }
  }

  return (
    <Card
      title="Staff sign-in policy"
      description="Applies to every staff account. Your own owner account follows its own setting instead."
    >
      <div className="flex flex-col gap-3">
        <Switch
          label="Require two-factor authentication for all staff"
          description="Every staff member answers a six-digit email code at sign-in, and cannot turn their own code off while this is on."
          meta={
            required ? (
              <Badge variant="success" dot>
                On
              </Badge>
            ) : (
              <Badge variant="neutral">Off</Badge>
            )
          }
          checked={required}
          disabled={salon.isPending || salon.isError || busy}
          loading={busy}
          onChange={(next) => {
            if (next) setConfirming(true);
            else void save(false);
          }}
        />

        {salon.isError ? (
          <p role="alert" className="text-sm text-danger">
            The salon's sign-in policy could not be loaded.
          </p>
        ) : null}
        {error && !confirming ? (
          <p role="alert" className="rounded-md bg-danger/5 px-3 py-2.5 text-sm text-danger">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-sm text-ink-body">
            {saved}
          </p>
        ) : null}
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        size="sm"
        title="Require email codes for all staff"
        description="Everyone except you will answer a code from their email the next time they sign in. Staff already signed in are asked to sign in again within the next 15 minutes."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => void save(true)}>
              Require for all staff
            </Button>
          </div>
        }
      >
        {error ? (
          <p role="alert" className="rounded-md bg-danger/5 px-3 py-2.5 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <p className="text-sm text-ink-body">
          Codes are sent to each person's own email address, so check that every staff member has
          one on file before turning this on.
        </p>
      </Modal>
    </Card>
  );
}
