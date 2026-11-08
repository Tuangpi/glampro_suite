import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  COMMISSION_KIND_LABELS,
  bulkPublishCommissionRulesSchema,
  type CommissionConfiguration,
  type CommissionKind,
} from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { get, getErrorMessage, post } from "@/lib/api";

type RateEdit = { behavior: "custom" | "inherit"; value: string };

export default function StaffCommissionRates({
  staffId,
  canEdit,
}: {
  staffId: string;
  canEdit: boolean;
}) {
  const client = useQueryClient();
  const config = useQuery({
    queryKey: ["commissions", staffId, 1],
    queryFn: () => get<CommissionConfiguration>("/commissions", { staffId, page: 1 }),
    staleTime: 0,
  });
  const company = useQuery({
    queryKey: ["commissions", "company", 1],
    queryFn: () => get<CommissionConfiguration>("/commissions", { page: 1 }),
    staleTime: 0,
  });
  const [draft, setDraft] = useState<{
    revision: string | null;
    edits: Partial<Record<CommissionKind, RateEdit>>;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const publish = useMutation({
    mutationFn: (input: unknown) => post("/commissions/bulk", input),
    retry: false,
  });
  const busy = config.isFetching || company.isFetching || publish.isPending;
  const stale = !!draft && !!config.data && draft.revision !== config.data.revision;
  const failed = config.isError || company.isError;
  const edits = Object.entries(draft?.edits ?? {}) as [CommissionKind, RateEdit][];

  function edit(kind: CommissionKind, value: RateEdit) {
    if (!config.data) return;
    setNotice("");
    setDraft((current) => ({
      revision: current ? current.revision : config.data!.revision,
      edits: { ...current?.edits, [kind]: value },
    }));
  }

  async function reload() {
    const results = await Promise.all([config.refetch(), company.refetch()]);
    if (results.some((result) => result.isError)) {
      setError("Unable to reload commission defaults. Your draft has been kept.");
      return;
    }
    setDraft(null);
    setReason("");
    setEffectiveAt("");
    setError("");
    setNotice("");
  }

  async function save() {
    if (!canEdit || busy || stale || failed || !draft || !edits.length) return;
    setError("");
    setNotice("");
    try {
      const input = bulkPublishCommissionRulesSchema.parse({
        expectedRevision: draft.revision,
        reason,
        ...(effectiveAt ? { effectiveAt: new Date(effectiveAt).toISOString() } : {}),
        rules: edits.map(([itemKind, value]) => {
          if (value.behavior === "custom" && !value.value.trim())
            throw Error("Enter a percentage for each custom rate.");
          return {
            staffId,
            itemKind,
            scope: "STAFF",
            targetId: null,
            rate: value.behavior === "inherit" ? null : Number(value.value),
          };
        }),
      });
      await publish.mutateAsync(input);
      setDraft(null);
      setReason("");
      setEffectiveAt("");
      setNotice("Rate changes published. Previously earned commissions are unchanged.");
      await client.invalidateQueries({ queryKey: ["commissions"] });
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name === "ZodError"
          ? "Check percentages (0–100, two decimals), change reason and effective time."
          : getErrorMessage(cause),
      );
    }
  }

  return (
    <Card
      title="Default rates"
      description="Set this person's base percentages by commission type."
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">
          Custom 0% explicitly earns nothing. Use company default opts into inheritance;
          unconfigured services retain their legacy staff rate. Item, package and department
          overrides take precedence. These defaults are not a guaranteed award under a pay plan.
        </p>
        <Link
          className="text-sm font-medium text-purple underline"
          to="/settings?section=team&team=rates"
        >
          Compare team rates
        </Link>
        <p className="text-sm text-ink-muted">
          Publishing rates does not activate new earnings or change existing snapshots.
        </p>
        {(config.isPending || company.isPending) && (
          <p role="status">Loading commission defaults…</p>
        )}
        {failed && (
          <p role="alert">Unable to load commission defaults. Reload before publishing.</p>
        )}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {stale && (
          <p role="alert">
            Commission settings changed. Reload and discard your draft before publishing.
          </p>
        )}
        {config.data && company.data && (
          <fieldset disabled={!canEdit || busy || stale || failed} className="flex flex-col gap-4">
            <legend className="sr-only">Individual commission defaults</legend>
            {Object.entries(COMMISSION_KIND_LABELS).map(([key, label]) => {
              const kind = key as CommissionKind;
              const rule = config.data.current.find(
                (row) => row.scope === "STAFF" && row.itemKind === kind,
              );
              const shared = company.data.current.find(
                (row) => row.scope === "COMPANY" && row.itemKind === kind,
              );
              const fallback = shared?.rate ?? (kind === "FOC" ? "5" : "0");
              const original = rule ? (rule.rate === null ? "inherit" : "custom") : "unconfigured";
              const value = draft?.edits[kind];
              const behavior = value?.behavior ?? original;
              const currentRate =
                rule?.rate ??
                (kind === "SERVICE" && !rule ? config.data.legacyServiceRate : fallback);
              return (
                <div
                  key={kind}
                  className="grid gap-3 border-b border-line-soft pb-4 sm:grid-cols-2"
                >
                  <div>
                    <Select
                      label={`${label} setting`}
                      value={behavior}
                      options={[
                        ...(!rule
                          ? [
                              {
                                value: "unconfigured",
                                label: "Unconfigured (keep existing fallback)",
                                disabled: true,
                              },
                            ]
                          : []),
                        { value: "inherit", label: "Use company default" },
                        { value: "custom", label: "Custom rate" },
                      ]}
                      onChange={(event) =>
                        edit(kind, {
                          behavior: event.target.value as RateEdit["behavior"],
                          value: value?.value ?? rule?.rate ?? "",
                        })
                      }
                    />
                    <p className="mt-1 text-xs text-ink-muted">
                      Current default: {currentRate}% · Company fallback: {fallback}%
                    </p>
                  </div>
                  {behavior === "custom" && (
                    <Input
                      label={`${label} percentage`}
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={value?.value ?? rule?.rate ?? ""}
                      onChange={(event) =>
                        edit(kind, { behavior: "custom", value: event.target.value })
                      }
                    />
                  )}
                </div>
              );
            })}
            {canEdit && (
              <>
                <Input
                  label="Rate change reason"
                  value={reason}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                />
                <Input
                  label="Rates effective from (browser time zone; blank means now)"
                  type="datetime-local"
                  value={effectiveAt}
                  onChange={(event) => setEffectiveAt(event.target.value)}
                />
                <Button
                  disabled={!edits.length || reason.trim().length < 3}
                  loading={publish.isPending}
                  onClick={() => void save()}
                >
                  Publish rate changes
                </Button>
              </>
            )}
          </fieldset>
        )}
        <Button variant="secondary" disabled={busy} onClick={() => void reload()}>
          {draft ? "Reload defaults and discard draft" : "Reload defaults"}
        </Button>
      </div>
    </Card>
  );
}
