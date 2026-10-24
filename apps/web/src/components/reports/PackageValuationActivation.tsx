import { useState } from "react";
import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import Input from "@/components/ui/Input";
import { useAuth } from "@/contexts/AuthContext";
import { useActivatePackageValuation } from "@/hooks/useReports";
import { getErrorMessage } from "@/lib/api";

export default function PackageValuationActivation() {
  const { user, isReadOnly } = useAuth();
  const activation = useActivatePackageValuation();
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const permitted = !!user && ["SUPER_ADMIN", "MANAGER"].includes(user.globalRole);
  if (!permitted || isReadOnly) {
    return <p>Activation requires an owner or manager in a writable salon.</p>;
  }
  if (activation.isSuccess) {
    return (
      <p role="status">Activation recorded. Refresh package value to view the current snapshot.</p>
    );
  }
  return (
    <form
      aria-label="Activate package valuation"
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!confirmed || !reason.trim() || activation.isPending) return;
        activation.mutate({
          policyVersion: 1,
          currency: "SGD",
          reason: reason.trim(),
          confirmed: true,
        });
      }}
    >
      <p className="text-sm text-ink-muted">
        One-time company-wide activation uses the server time, policy 1 and SGD for future completed
        purchases. Existing holdings remain unvalued, with no backfill or historical closing
        balances. This confirmation cannot be edited or undone. Owners require two-factor
        authentication. No accounting or GST entries are created.
      </p>
      <Input
        label="Activation reason"
        value={reason}
        required
        maxLength={2000}
        disabled={activation.isPending}
        onChange={(event) => setReason(event.target.value)}
      />
      <Checkbox
        label="I confirm future package purchases are in SGD and approve policy 1 with no legacy backfill."
        checked={confirmed}
        disabled={activation.isPending}
        onChange={(event) => setConfirmed(event.target.checked)}
      />
      {activation.isError && (
        <p role="alert">
          Activation could not be confirmed: {getErrorMessage(activation.error)}. Refresh to check
          whether it was recorded before retrying.
        </p>
      )}
      <Button type="submit" loading={activation.isPending} disabled={!confirmed || !reason.trim()}>
        Activate package valuation
      </Button>
    </form>
  );
}
