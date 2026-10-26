import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  publishCommissionAttributionPolicySchema,
  type CommissionAttributionPolicyView,
  type PublishCommissionAttributionPolicy,
} from "@glampro_suite/shared";
import { get, getErrorMessage, post } from "@/lib/api";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Checkbox from "@/components/ui/Checkbox";
import Input from "@/components/ui/Input";

const queryKey = ["commission-attribution-policy"];
const controls = [
  {
    key: "requireSellers",
    label: "Require sellers",
    hint: "Require explicit seller attribution on every sale line before completion.",
  },
  {
    key: "requireServicePerformers",
    label: "Require service performers",
    hint: "Require performer attribution on service lines before completion, including held sales.",
  },
  {
    key: "requireRedemptionPerformers",
    label: "Require package redemption performers",
    hint: "Require a resolved session or whole-set split. If covered lines have missing or different splits, select explicit performers on the package tender.",
  },
] as const;

export default function CommissionAttributionPolicy({ canEdit }: { canEdit: boolean }) {
  const client = useQueryClient();
  const policy = useQuery({
    queryKey,
    queryFn: () => get<CommissionAttributionPolicyView>("/commissions/attribution-policy"),
    staleTime: 0,
  });
  // Pin all flags AND revision on first edit. Refetch must never silently rebase an old draft.
  const [draft, setDraft] = useState<CommissionAttributionPolicyView | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const publish = useMutation({
    mutationFn: (input: PublishCommissionAttributionPolicy) =>
      post<CommissionAttributionPolicyView>("/commissions/attribution-policy", input),
    retry: false,
  });
  const displayed = draft ?? policy.data;
  const staleDraft = !!draft && !!policy.data && draft.revision !== policy.data.revision;
  const busy = policy.isFetching || publish.isPending;

  async function save() {
    if (!canEdit || !displayed || busy || policy.isError || staleDraft) return;
    setError("");
    setNotice("");
    const parsed = publishCommissionAttributionPolicySchema.safeParse({
      requireSellers: displayed.requireSellers,
      requireServicePerformers: displayed.requireServicePerformers,
      requireRedemptionPerformers: displayed.requireRedemptionPerformers,
      expectedRevision: displayed.revision,
      reason,
    });
    if (!parsed.success) {
      setError("Enter a policy change reason between 3 and 500 characters.");
      return;
    }
    try {
      const saved = await publish.mutateAsync(parsed.data);
      client.setQueryData(queryKey, saved);
      setDraft(null);
      setReason("");
      setNotice("Attribution policy published. Existing attribution and earnings are unchanged.");
    } catch (cause) {
      setError(getErrorMessage(cause));
    }
  }

  async function reload() {
    setNotice("");
    const result = await policy.refetch();
    if (result.isError) {
      setError(getErrorMessage(result.error));
      return;
    }
    setDraft(null);
    setReason("");
    setError("");
  }

  return (
    <Card title="Required commission attribution">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">
          Salon-wide requirements are checked when a sale completes, including held sales. Defaults
          are optional. These settings do not enable new commission earnings or confirm package
          collection eligibility. Previously completed sales are not rewritten.
        </p>
        {policy.isPending && <p role="status">Loading attribution policy…</p>}
        {policy.isError && (
          <p role="alert">Unable to load attribution policy. Reload before publishing.</p>
        )}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {staleDraft && (
          <p role="alert">
            Attribution policy changed. Reload and discard your draft before publishing.
          </p>
        )}
        {displayed && (
          <fieldset
            disabled={!canEdit || busy || policy.isError || staleDraft}
            className="flex flex-col gap-3"
          >
            <legend>Attribution requirements</legend>
            {controls.map(({ key, label, hint }) => (
              <Checkbox
                key={key}
                label={label}
                hint={hint}
                checked={displayed[key]}
                onChange={(event) => {
                  setDraft({ ...displayed, [key]: event.target.checked });
                  setNotice("");
                }}
              />
            ))}
            {canEdit && (
              <>
                <Input
                  label="Attribution policy change reason"
                  value={reason}
                  maxLength={500}
                  onChange={(event) => {
                    setDraft(displayed);
                    setReason(event.target.value);
                    setNotice("");
                  }}
                />
                <Button
                  disabled={reason.trim().length < 3}
                  loading={publish.isPending}
                  onClick={() => void save()}
                >
                  Publish attribution policy
                </Button>
              </>
            )}
          </fieldset>
        )}
        <Button variant="secondary" disabled={busy} onClick={() => void reload()}>
          Reload attribution policy{draft || reason ? " and discard draft" : ""}
        </Button>
      </div>
    </Card>
  );
}
