/**
 * Sharing one holding with the customer's family, or taking it back to private.
 *
 * Sharing is explicit and never moves money: the holding keeps its balance, its expiry
 * and its owner, and only who may spend it changes. The family is read here rather than
 * on the tab, so a profile that never shares anything never fetches it — which is why a
 * customer with no family yet is told to create one instead of being sent to a page.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PrepaidFamily, PrepaidHolding } from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import { queryKeys } from "@/constants/queryKeys";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { get, getErrorMessage, post } from "@/lib/api";

export default function ShareHoldingDialog({
  customerId,
  holding,
  refreshing,
  onClose,
  onSaved,
}: {
  customerId: string;
  holding: PrepaidHolding;
  /** The owned list is mid-refetch, so `holding.updatedAt` may no longer be current. */
  refreshing: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const { formatPrice, formatDateTime } = useSalonFormatting();
  const client = useQueryClient();
  const family = useQuery({
    queryKey: queryKeys.customers.prepaidFamily(customerId),
    queryFn: () => get<PrepaidFamily | null>(`/customers/${customerId}/prepaid-family`),
  });
  const sharing = !holding.sharedFamilyId;
  const targetFamilyId = family.data?.id ?? null;
  const noFamily = sharing && !family.isPending && !family.isError && !targetFamilyId;
  const mutation = useMutation({
    mutationFn: () =>
      post(`/customers/${customerId}/prepaid/${holding.id}/sharing`, {
        familyId: sharing ? targetFamilyId : null,
        expectedUpdatedAt: holding.updatedAt,
        reason: reason.trim(),
        confirmed: true,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.customers.all() });
      onSaved();
    },
    // A refusal means the server saw a different holding or family, so the tick
    // the manager gave no longer describes what would be written.
    onError: () => setConfirmed(false),
  });
  const blocked = mutation.isPending || refreshing || family.isPending;
  return (
    <Modal
      open
      title="Confirm prepaid family change"
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
    >
      <p>
        {sharing ? "Share" : "Make private"} <strong>{holding.name}</strong> ·{" "}
        {formatPrice(holding.amountRemaining)} ·{" "}
        {holding.expiresAt ? `Expires ${formatDateTime(holding.expiresAt)}` : "No expiry"}
      </p>
      <p>
        Sharing gives current family members permission to spend this holding. Changing or leaving a
        family makes your shared holdings private; it never transfers value or restarts expiry.
      </p>
      {family.isError ? (
        <div role="alert">
          {getErrorMessage(family.error)}{" "}
          <Button onClick={() => void family.refetch()}>Retry family</Button>
        </div>
      ) : null}
      {noFamily ? (
        <p role="status">
          This customer has no prepaid family yet. Create one in Family sharing, then share this
          holding with it.
        </p>
      ) : null}
      {sharing && targetFamilyId ? (
        <p className="text-sm text-ink-muted">
          Shared with <strong>{family.data?.name}</strong>
        </p>
      ) : null}
      <Input
        label="Family change reason"
        placeholder="e.g. Credit split after the children turned 18"
        value={reason}
        maxLength={2000}
        disabled={blocked}
        onChange={(event) => {
          setReason(event.target.value);
          setConfirmed(false);
        }}
      />
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={blocked || noFamily || Boolean(family.isError)}
          onChange={(event) => setConfirmed(event.target.checked)}
        />{" "}
        I confirm this sharing change.
      </label>
      {mutation.isError ? (
        <p role="alert">
          {getErrorMessage(mutation.error)} Reload current family and balances before retrying a
          stale change.
        </p>
      ) : null}
      <Button
        disabled={blocked || !confirmed || !reason.trim() || noFamily || Boolean(family.isError)}
        onClick={() => mutation.mutate()}
      >
        Confirm family change
      </Button>
      <Button disabled={mutation.isPending} onClick={onClose}>
        Cancel family change
      </Button>
    </Modal>
  );
}
